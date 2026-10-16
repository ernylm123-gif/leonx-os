"""
Ağır adımların yalıtılmış süreçte çalıştırılması.

HTTP sunucusu DWG/DXF'i kendi belleğine açmaz: dönüştürme + kalite denetimi ve PDF önizleme, her biri
kendi bellek (RLIMIT_AS) ve süre sınırıyla ayrı bir Python sürecinde çalışır. Sınır aşılırsa yalnız o
süreç biter; sunucu ayakta kalır ve kullanıcıya nedeni bildirilir. PDF önizleme başarısız olsa bile
DXF ve kalite raporu teslim edilir.

  python -m leonx_cad.job donustur <girdi.dwg> <çıktı_dizini>   → cikti.dxf + sonuc.json
  python -m leonx_cad.job pdf      <girdi.dxf> <çıktı_dizini>   → onizleme.pdf + sonuc.json
Hata: sonuc.json = {"hata": {"kod": …, "mesaj": …}} ve sıfırdan farklı çıkış kodu.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from dataclasses import dataclass

from .convert import DEFAULT_TIMEOUT_S, ConversionError, run_tool

# Süreç bellek sınırları (MB). Küçük sunucularda (512 MB) ortam değişkeniyle düşürülür.
JOB_MEMORY_MB = int(os.environ.get('CAD_WORKER_JOB_MEMORY_MB', '2048'))
RENDER_MEMORY_MB = int(os.environ.get('CAD_WORKER_RENDER_MEMORY_MB', '1536'))
RENDER_TIMEOUT_S = int(os.environ.get('CAD_WORKER_RENDER_TIMEOUT_S', '120'))
# Dönüştürme (dwg2dxf) + envanter (dwgread) art arda çalışır
JOB_TIMEOUT_S = 2 * DEFAULT_TIMEOUT_S + 30

_PKG_PARENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@dataclass
class JobOutput:
    result: dict
    files: dict[str, bytes]


def _child_env() -> dict[str, str]:
    env = {'PYTHONPATH': _PKG_PARENT, 'MPLCONFIGDIR': os.environ.get('MPLCONFIGDIR', '/tmp/mpl'),
           # BLAS iş parçacıkları sanal belleği şişirir; tek iş parçacığı yeterli
           'OPENBLAS_NUM_THREADS': '1', 'OMP_NUM_THREADS': '1'}
    for k in ('LIBREDWG_BIN', 'CAD_WORKER_TOOL_MEMORY_MB'):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


def run_job(mode: str, data: bytes, *, memory_mb: int, timeout_s: int) -> JobOutput:
    """İşi ayrı süreçte çalıştırır; başarısızlıkta ConversionError yükseltir."""
    in_name, outs = {'donustur': ('girdi.dwg', ('cikti.dxf',)), 'pdf': ('girdi.dxf', ('onizleme.pdf',))}[mode]
    with tempfile.TemporaryDirectory(prefix='leonx-job-') as tmp:
        src = os.path.join(tmp, in_name)
        with open(src, 'wb') as f:
            f.write(data)
        r = run_tool([sys.executable, '-s', '-m', 'leonx_cad.job', mode, src, tmp], tmp, timeout_s, memory_mb, extra_env=_child_env())
        report = os.path.join(tmp, 'sonuc.json')
        result = None
        if os.path.exists(report):
            try:
                with open(report, encoding='utf-8') as f:
                    result = json.load(f)
            except ValueError:  # süreç yazarken sonlandıysa
                result = None
        if r.timed_out:
            raise ConversionError('zaman_asimi', f'İşlem {timeout_s} saniyede bitmedi.')
        if result and 'hata' in result:
            raise ConversionError(result['hata']['kod'], result['hata']['mesaj'])
        if r.returncode != 0 or result is None:
            raise ConversionError('bellek', 'İşlem sunucunun bellek veya süre sınırını aştı; çizim bu sunucuda işlenemedi.')
        files = {}
        for name in outs:
            p = os.path.join(tmp, name)
            if os.path.exists(p):
                with open(p, 'rb') as f:
                    files[name] = f.read()
        return JobOutput(result, files)


# --------------------------------------------------------------------------- alt süreç tarafı
def _write(outdir: str, payload: dict) -> None:
    # Önce geçici dosyaya, sonra adını değiştirerek: yarım kalmış sonuç okunmaz
    tmp = os.path.join(outdir, 'sonuc.json.yaziliyor')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False)
    os.replace(tmp, os.path.join(outdir, 'sonuc.json'))


def _main(argv: list[str]) -> int:
    mode, src, outdir = argv[1], argv[2], argv[3]
    with open(src, 'rb') as f:
        data = f.read()
    try:
        if mode == 'donustur':
            from .convert import convert_dwg
            from .qc import quality_check

            conv = convert_dwg(data)
            qc = quality_check(data, conv.dxf)
            with open(os.path.join(outdir, 'cikti.dxf'), 'wb') as f:
                f.write(conv.dxf)
            _write(outdir, {'surum': conv.version, 'surum_adi': conv.release, 'sure_sn': round(conv.seconds, 3),
                            'onarilan_metin': conv.repaired_texts, 'uyarilar': conv.log_warnings[:50], 'kalite': qc.to_dict()})
        elif mode == 'pdf':
            from .render import render_pdf

            res = render_pdf(data)
            if res.pdf:
                with open(os.path.join(outdir, 'onizleme.pdf'), 'wb') as f:
                    f.write(res.pdf)
            _write(outdir, {'pdf_rapor': res.report()})
        else:
            return 2
    except ConversionError as e:
        _write(outdir, {'hata': {'kod': e.code, 'mesaj': e.message}})
        return 3
    except MemoryError:
        _write(outdir, {'hata': {'kod': 'bellek', 'mesaj': 'Çizim sunucunun bellek sınırını aştı; bu sunucuda işlenemedi.'}})
        return 4
    return 0


if __name__ == '__main__':
    sys.exit(_main(sys.argv))
