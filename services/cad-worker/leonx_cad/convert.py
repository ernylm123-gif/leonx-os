"""
DWG → DXF dönüştürme (GNU LibreDWG `dwg2dxf`).

Güvenlik:
  - Dönüştürücü ayrı süreçte, kabuk kullanılmadan, geçici bir dizinde çalışır.
  - Süreç sınırları: CPU süresi, bellek (adres alanı), yazılabilir dosya boyutu, alt süreç sayısı.
  - Duvar saati zaman aşımı; aşılırsa süreç grubu öldürülür.
  - Girdi yalnız DWG imzasıyla (AC10xx) kabul edilir; boyut sınırı uygulanır.
  - Ağ erişimi kapsayıcı düzeyinde kapatılmalıdır (Dockerfile / çalıştırma notları).

LibreDWG GPL-3.0'dır ve burada ayrı bir program olarak çağrılır (bağlanmaz); uygulama koduyla
birleştirilmez. Bkz. services/cad-worker/LISANSLAR.md.
"""
from __future__ import annotations

import os
import resource
import shutil
import signal
import subprocess
import tempfile
import time
from dataclasses import dataclass, field

from .repair import repair_text_breaks

MAX_INPUT_BYTES = 50 * 1024 * 1024
DEFAULT_TIMEOUT_S = 90
DEFAULT_MEMORY_MB = 1024
MAX_OUTPUT_MB = 400

# DWG sürüm imzaları (dosyanın ilk 6 baytı)
DWG_VERSIONS = {
    'AC1012': 'R13', 'AC1014': 'R14', 'AC1015': 'AutoCAD 2000', 'AC1018': 'AutoCAD 2004',
    'AC1021': 'AutoCAD 2007', 'AC1024': 'AutoCAD 2010', 'AC1027': 'AutoCAD 2013', 'AC1032': 'AutoCAD 2018',
}
# Desteklenen en eski sürüm R13; daha eski (R12 ve öncesi) çizimler mimari işlerde kullanılmaz
SUPPORTED = set(DWG_VERSIONS)


class ConversionError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class ToolResult:
    returncode: int
    seconds: float
    log: str
    timed_out: bool = False


@dataclass
class DwgConversion:
    version: str
    release: str
    dxf: bytes
    seconds: float
    log_warnings: list[str] = field(default_factory=list)
    #: Kaçışsız satır sonu nedeniyle onarılan metin değeri sayısı (bkz. repair.py)
    repaired_texts: int = 0


def libredwg_bin(tool: str) -> str:
    base = os.environ.get('LIBREDWG_BIN')
    path = os.path.join(base, tool) if base else shutil.which(tool)
    if not path or not os.path.exists(path):
        raise ConversionError('donusturucu_yok', f'{tool} bulunamadı (LIBREDWG_BIN ayarlanmalı).')
    return path


def detect_dwg(data: bytes) -> tuple[str, str]:
    if len(data) < 128:
        raise ConversionError('gecersiz', 'Dosya çok küçük; geçerli bir DWG değil.')
    if len(data) > MAX_INPUT_BYTES:
        raise ConversionError('cok_buyuk', f'Dosya {MAX_INPUT_BYTES // (1024 * 1024)} MB sınırını aşıyor.')
    sig = data[:6].decode('ascii', 'replace')
    if not sig.startswith('AC'):
        raise ConversionError('gecersiz', 'DWG imzası bulunamadı (dosya DWG değil).')
    if sig not in SUPPORTED:
        raise ConversionError('surum_desteklenmiyor', f'DWG sürümü {sig} desteklenmiyor (R13–AutoCAD 2018 arası desteklenir).')
    return sig, DWG_VERSIONS[sig]


def _limits(memory_mb: int, cpu_s: int):
    def apply():
        os.setsid()  # zaman aşımında tüm süreç grubu öldürülebilsin
        mem = memory_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s))
        out = MAX_OUTPUT_MB * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_FSIZE, (out, out))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    return apply


def run_tool(args: list[str], cwd: str, timeout_s: int = DEFAULT_TIMEOUT_S, memory_mb: int = DEFAULT_MEMORY_MB) -> ToolResult:
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}
    if os.environ.get('LD_LIBRARY_PATH'):
        env['LD_LIBRARY_PATH'] = os.environ['LD_LIBRARY_PATH']
    t0 = time.monotonic()
    p = subprocess.Popen(args, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         preexec_fn=_limits(memory_mb, timeout_s), close_fds=True)
    try:
        out, _ = p.communicate(timeout=timeout_s)
        return ToolResult(p.returncode, time.monotonic() - t0, out.decode('utf-8', 'replace')[-20000:])
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        p.communicate()
        return ToolResult(-9, time.monotonic() - t0, '', timed_out=True)


def convert_dwg(data: bytes, timeout_s: int = DEFAULT_TIMEOUT_S, memory_mb: int = DEFAULT_MEMORY_MB) -> DwgConversion:
    sig, release = detect_dwg(data)
    tool = libredwg_bin('dwg2dxf')
    with tempfile.TemporaryDirectory(prefix='leonx-dwg-') as tmp:
        src = os.path.join(tmp, 'girdi.dwg')
        dst = os.path.join(tmp, 'cikti.dxf')
        with open(src, 'wb') as f:
            f.write(data)
        r = run_tool([tool, '-y', '-o', dst, src], tmp, timeout_s, memory_mb)
        if r.timed_out:
            raise ConversionError('zaman_asimi', f'Dönüştürme {timeout_s} saniyede bitmedi.')
        if not os.path.exists(dst) or os.path.getsize(dst) == 0:
            raise ConversionError('basarisiz', f'Dönüştürücü DXF üretemedi (çıkış kodu {r.returncode}).')
        with open(dst, 'rb') as f:
            dxf = f.read()
    dxf, repaired = repair_text_breaks(dxf)
    warnings = [ln.strip() for ln in r.log.splitlines() if ln.strip().upper().startswith(('ERROR', 'WARNING'))]
    return DwgConversion(version=sig, release=release, dxf=dxf, seconds=r.seconds, log_warnings=warnings[:200], repaired_texts=repaired)
