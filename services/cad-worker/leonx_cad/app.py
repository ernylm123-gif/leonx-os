"""
LEONX CAD dönüştürme servisi (HTTP).

  POST /v1/dwg/donustur   çok parçalı form: dosya=<DWG>  [?pdf=1]
     → { surum, surum_adi, sure_sn, onarilan_metin, uyarilar, kalite, dxf (base64), pdf (base64|null), pdf_rapor }
  GET  /saglik            → { durum: "hazir", libredwg: "<sürüm>" }

Kimlik doğrulama: Supabase oturum belirteci (Authorization: Bearer …).
  - ES256/RS256 belirteçler SUPABASE_URL'deki JWKS anahtarlarıyla (asimetrik) doğrulanır,
  - HS256 belirteçler SUPABASE_JWT_SECRET ile (eski yöntem); ikisi birlikte ayarlanabilir.
  - Belirtecin algoritması için yöntem yapılandırılmamışsa istek reddedilir.
  - ALLOWED_USER_IDS (virgülle) verilirse yalnız bu kullanıcılar kullanabilir.
Hiçbiri ayarlı değilse servis başlamaz (CAD_WORKER_INSECURE_DEV=1 yalnız yerel geliştirme içindir).

Dosyalar diske kalıcı yazılmaz: her istek kendi geçici dizininde işlenir ve silinir; dosya içeriği
günlüklere yazılmaz.
"""
from __future__ import annotations

import asyncio
import base64
import os
import subprocess

import jwt
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from .convert import MAX_INPUT_BYTES, ConversionError, detect_dwg, libredwg_bin
from .job import JOB_MEMORY_MB, JOB_TIMEOUT_S, RENDER_MEMORY_MB, RENDER_TIMEOUT_S, run_job

MAX_PARALLEL = int(os.environ.get('CAD_WORKER_PARALLEL', '2'))
_slots = asyncio.Semaphore(MAX_PARALLEL)


class AuthConfig:
    def __init__(self) -> None:
        self.supabase_url = os.environ.get('SUPABASE_URL', '').rstrip('/')
        self.secret = os.environ.get('SUPABASE_JWT_SECRET', '')
        self.allowed = {u.strip() for u in os.environ.get('ALLOWED_USER_IDS', '').split(',') if u.strip()}
        self.insecure = os.environ.get('CAD_WORKER_INSECURE_DEV') == '1'
        self.jwks = jwt.PyJWKClient(f'{self.supabase_url}/auth/v1/.well-known/jwks.json', cache_keys=True) if self.supabase_url else None
        if not (self.jwks or self.secret or self.insecure):
            raise RuntimeError('Kimlik doğrulama yapılandırılmadı: SUPABASE_URL veya SUPABASE_JWT_SECRET gerekli.')

    def verify(self, token: str) -> str:
        if self.insecure and not (self.jwks or self.secret):
            return 'gelistirme'  # yalnız yerel geliştirme: doğrulama yöntemi yok, belirteç ayrıştırılmaz
        try:
            # Supabase projesi asimetrik imza anahtarlarına (JWKS) geçmişse ES256/RS256, eski
            # yöntemdeyse HS256 belirteç üretir; algoritma belirtecin başlığından seçilir ve yalnız
            # yapılandırılmış yöntem kabul edilir (HS256 belirteç JWKS anahtarıyla doğrulanmaz).
            alg = jwt.get_unverified_header(token).get('alg')
            if alg in ('ES256', 'RS256') and self.jwks:
                key = self.jwks.get_signing_key_from_jwt(token).key
                claims = jwt.decode(token, key, algorithms=[alg], audience='authenticated')
            elif alg == 'HS256' and self.secret:
                claims = jwt.decode(token, self.secret, algorithms=['HS256'], audience='authenticated')
            else:
                raise HTTPException(401, 'Oturum doğrulanamadı.')
        except jwt.PyJWTError:
            raise HTTPException(401, 'Oturum doğrulanamadı.') from None
        sub = str(claims.get('sub', ''))
        if not sub or (self.allowed and sub not in self.allowed):
            raise HTTPException(403, 'Bu hesap dönüştürme servisini kullanamaz.')
        return sub


def create_app() -> FastAPI:
    auth = AuthConfig()
    app = FastAPI(title='LEONX CAD dönüştürücü', docs_url=None, redoc_url=None, openapi_url=None)
    origins = [o.strip() for o in os.environ.get('ALLOWED_ORIGINS', 'https://leonx-os.vercel.app').split(',') if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=['POST', 'GET'], allow_headers=['Authorization'], max_age=600)

    def user(authorization: str = Header(default='')) -> str:
        if not authorization.lower().startswith('bearer '):
            if auth.insecure:
                return 'gelistirme'
            raise HTTPException(401, 'Oturum belirteci gerekli.')
        return auth.verify(authorization[7:].strip())

    @app.get('/saglik')
    def saglik():
        try:
            out = subprocess.run([libredwg_bin('dwg2dxf'), '--version'], capture_output=True, timeout=10, check=False)
            ver = out.stdout.decode('utf-8', 'replace').strip().splitlines()[0] if out.stdout else 'bilinmiyor'
        except Exception:
            raise HTTPException(503, 'Dönüştürücü kullanılamıyor.') from None
        return {'durum': 'hazir', 'libredwg': ver}

    @app.post('/v1/dwg/donustur')
    async def donustur(dosya: UploadFile = File(...), pdf: bool = Query(False), _uid: str = Depends(user)):
        data = await dosya.read(MAX_INPUT_BYTES + 1)
        if len(data) > MAX_INPUT_BYTES:
            raise HTTPException(413, f'Dosya {MAX_INPUT_BYTES // (1024 * 1024)} MB sınırını aşıyor.')
        if _slots.locked():
            raise HTTPException(429, 'Dönüştürücü meşgul; birazdan tekrar deneyin.')
        async with _slots:
            try:
                detect_dwg(data)  # imza/sürüm/boyut: alt süreç başlatmadan önce
                conv = await run_in_threadpool(run_job, 'donustur', data, memory_mb=JOB_MEMORY_MB, timeout_s=JOB_TIMEOUT_S)
            except ConversionError as e:
                raise HTTPException(422, {'kod': e.code, 'mesaj': e.message}) from None
            res = conv.result
            dxf = conv.files.get('cikti.dxf')
            valid = bool(dxf) and res['kalite']['dxf_valid']
            pdf_bytes, pdf_report = None, None
            if pdf and valid:
                try:
                    out = await run_in_threadpool(run_job, 'pdf', dxf, memory_mb=RENDER_MEMORY_MB, timeout_s=RENDER_TIMEOUT_S)
                    pdf_bytes, pdf_report = out.files.get('onizleme.pdf'), out.result.get('pdf_rapor')
                except ConversionError as e:  # önizleme başarısızlığı dönüşümü geçersiz kılmaz
                    res['kalite']['notes'].append(f'PDF önizleme üretilemedi: {e.message}')
        return {
            **res,
            'dxf': base64.b64encode(dxf).decode('ascii') if valid else None,
            'pdf': base64.b64encode(pdf_bytes).decode('ascii') if pdf_bytes else None,
            'pdf_rapor': pdf_report,
        }

    return app
