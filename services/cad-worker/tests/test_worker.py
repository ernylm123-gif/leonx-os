"""
CAD dönüştürme servisi testleri.

Gerçek AutoCAD DWG örnekleri LibreDWG kaynak paketindeki test verisinden okunur (depoya eklenmez;
lisansları ayrı). Yol: LIBREDWG_TESTDATA (ör. .../libredwg-0.13.3/test/test-data). Ayarlı değilse
gerçek DWG gerektiren testler atlanır ve bu açıkça raporlanır — CI'da her zaman ayarlıdır.
"""
from __future__ import annotations

import base64
import io
import os
import time

import ezdxf
import jwt
import pytest
from ezdxf import recover
from fastapi.testclient import TestClient

from leonx_cad.convert import ConversionError, convert_dwg, detect_dwg, run_tool
from leonx_cad.qc import quality_check
from leonx_cad.render import render_pdf
from leonx_cad.repair import repair_text_breaks

DATA = os.environ.get('LIBREDWG_TESTDATA', '')
needs_dwg = pytest.mark.skipif(not DATA or not os.path.isdir(DATA), reason='LIBREDWG_TESTDATA ayarlı değil')
SECRET = 'test-secret-yalniz-test-icin-en-az-32-bayt-uzunlukta'
OWNER = '11111111-1111-1111-1111-111111111111'

MODERN = ['example_2000.dwg', 'example_2004.dwg', 'example_2007.dwg', 'example_2010.dwg', 'example_2013.dwg', 'example_2018.dwg']


def dwg(name: str) -> bytes:
    with open(os.path.join(DATA, name), 'rb') as f:
        return f.read()


# --------------------------------------------------------------------------- girdi denetimi
def test_dwg_olmayan_dosya_reddedilir():
    with pytest.raises(ConversionError) as e:
        detect_dwg(b'0\nSECTION\n' + b'x' * 200)
    assert e.value.code == 'gecersiz'
    with pytest.raises(ConversionError):
        detect_dwg(b'AC1032')  # çok küçük


def test_eski_ve_bilinmeyen_surumler_acikca_reddedilir():
    with pytest.raises(ConversionError) as e:
        detect_dwg(b'AC1009' + b'\0' * 200)
    assert e.value.code == 'surum_desteklenmiyor'


def test_boyut_siniri():
    with pytest.raises(ConversionError) as e:
        detect_dwg(b'AC1032' + b'\0' * (50 * 1024 * 1024))
    assert e.value.code == 'cok_buyuk'


def test_zaman_asiminda_surec_oldurulur(tmp_path):
    t0 = time.monotonic()
    r = run_tool(['/bin/sleep', '30'], str(tmp_path), timeout_s=1)
    assert r.timed_out and time.monotonic() - t0 < 10


# --------------------------------------------------------------------------- metin onarımı
def test_satir_sonu_onarimi_yalniz_metin_degerlerinde_ve_dogru_dosyaya_dokunmaz():
    good = '0\nSECTION\n2\nENTITIES\n0\nMTEXT\n8\n0\n1\nTEK SATIR\n0\nENDSEC\n0\nEOF\n'.encode()
    out, n = repair_text_breaks(good)
    assert (out, n) == (good, 0)
    broken = '0\nSECTION\n2\nENTITIES\n0\nMTEXT\n8\n0\n1\nILK SATIR\nIKINCI SATIR.}\n0\nENDSEC\n0\nEOF\n'.encode()
    out, n = repair_text_breaks(broken)
    assert n == 1
    assert b'ILK SATIR\\PIKINCI SATIR.}' in out


# --------------------------------------------------------------------------- gerçek DWG
@needs_dwg
@pytest.mark.parametrize('name', MODERN)
def test_gercek_autocad_dwg_donusur_ve_kayip_yok(name):
    data = dwg(name)
    c = convert_dwg(data)
    assert c.version.startswith('AC10')
    q = quality_check(data, c.dxf)
    assert q.dxf_valid and q.audit_errors == 0
    assert q.lost == {}, f'kayıp: {q.lost}'
    assert q.units == 'mm'
    assert {'Model', 'Layout1'} <= set(q.layouts)
    # blok, öznitelik ve ölçüler korunur
    for t in ('INSERT', 'ATTDEF', 'DIMENSION', 'MTEXT', 'LWPOLYLINE'):
        assert q.counts_dxf.get(t, 0) == q.counts_dwg.get(t, 0) > 0, t


@needs_dwg
def test_uzun_mtext_iceren_2018_dinamik_blok_cizimi_onarilarak_okunur():
    data = dwg('2018/Dynblocks.dwg')
    c = convert_dwg(data)
    assert c.repaired_texts >= 1
    q = quality_check(data, c.dxf)
    assert q.dxf_valid and q.audit_errors == 0


@needs_dwg
def test_pdf_onizleme_model_ve_layoutlar_kendi_kagit_boyutunda():
    c = convert_dwg(dwg('example_2018.dwg'))
    p = render_pdf(c.dxf)
    assert p.pdf.startswith(b'%PDF')
    names = [pg.name for pg in p.pages]
    assert names[0] == 'Model' and 'Layout1' in names
    lay = next(pg for pg in p.pages if pg.name == 'Layout1')
    assert lay.scale_note == 'layout kâğıt boyutu' and lay.width_mm > lay.height_mm


# --------------------------------------------------------------------------- HTTP servisi
@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv('SUPABASE_JWT_SECRET', SECRET)
    monkeypatch.delenv('SUPABASE_URL', raising=False)
    monkeypatch.setenv('ALLOWED_USER_IDS', OWNER)
    from leonx_cad.app import create_app

    return TestClient(create_app())


def token(sub=OWNER, secret=SECRET, aud='authenticated', exp=600):
    return jwt.encode({'sub': sub, 'aud': aud, 'exp': int(time.time()) + exp, 'role': 'authenticated'}, secret, algorithm='HS256')


def test_kimlik_dogrulama_yapilandirilmadan_servis_baslamaz(monkeypatch):
    for k in ('SUPABASE_JWT_SECRET', 'SUPABASE_URL', 'CAD_WORKER_INSECURE_DEV'):
        monkeypatch.delenv(k, raising=False)
    from leonx_cad.app import create_app

    with pytest.raises(RuntimeError):
        create_app()


def test_yetkisiz_istekler_reddedilir(client):
    files = {'dosya': ('a.dwg', b'AC1032' + b'\0' * 200)}
    assert client.post('/v1/dwg/donustur', files=files).status_code == 401
    assert client.post('/v1/dwg/donustur', files=files, headers={'Authorization': 'Bearer bozuk'}).status_code == 401
    assert client.post('/v1/dwg/donustur', files=files, headers={'Authorization': f'Bearer {token(secret="baska-bir-anahtar-en-az-32-bayt-uzunlukta-x")}'}).status_code == 401
    assert client.post('/v1/dwg/donustur', files=files, headers={'Authorization': f'Bearer {token(exp=-10)}'}).status_code == 401
    assert client.post('/v1/dwg/donustur', files=files, headers={'Authorization': f'Bearer {token(sub="baska-kullanici")}'}).status_code == 403


def test_dwg_olmayan_dosya_422(client):
    r = client.post('/v1/dwg/donustur', files={'dosya': ('a.dwg', b'%PDF-1.4' + b'x' * 300)}, headers={'Authorization': f'Bearer {token()}'})
    assert r.status_code == 422 and r.json()['detail']['kod'] == 'gecersiz'


@needs_dwg
def test_servis_ucdan_uca_dwg_dxf_pdf(client):
    r = client.post('/v1/dwg/donustur?pdf=1', files={'dosya': ('ornek.dwg', dwg('example_2018.dwg'))}, headers={'Authorization': f'Bearer {token()}'})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j['surum'] == 'AC1032' and j['kalite']['status'] in ('tamam', 'eksik')
    dxf = base64.b64decode(j['dxf'])
    doc, aud = recover.read(io.BytesIO(dxf))
    assert len(aud.errors) == 0 and len(doc.modelspace()) > 0
    assert base64.b64decode(j['pdf']).startswith(b'%PDF')
    assert j['pdf_rapor']['pages'][0]['name'] == 'Model'


def test_ezdxf_surumu_sabit():
    assert ezdxf.__version__ == '1.4.4'
