"""
DXF metin onarımı: LibreDWG `dwg2dxf`, çok satırlı metin değerlerindeki satır sonunu kaçışsız
yazabiliyor (ör. MTEXT notları). ASCII DXF'te her değer tek satır olduğundan, metnin devamı grup
kodu yerine okunur ve dosya bozulur.

Onarım: grup kodu beklenen satır bir tamsayı değilse, önceki DEĞERİN devamıdır. Bu satırlar
önceki değere MTEXT paragraf işaretiyle (\\P) eklenir. Yalnız metin taşıyan grup kodlarında
(1, 3) yapılır; başka bir yerde bozulma varsa onarılmaz ve dosya bozuk bildirilir.
"""
from __future__ import annotations

TEXT_CODES = {1, 3}


def _is_code(s: str) -> bool:
    t = s.strip()
    return t.lstrip('-').isdigit() and len(t) <= 4


def repair_text_breaks(dxf: bytes) -> tuple[bytes, int]:
    """Bozuk metin satırlarını birleştirir; (onarılmış DXF, onarılan değer sayısı) döner."""
    text = dxf.decode('utf-8', 'surrogateescape')
    eol = '\r\n' if '\r\n' in text[:4096] else '\n'
    lines = text.split(eol)
    out: list[str] = []
    fixed = 0
    i = 0
    n = len(lines)
    while i < n:
        code_line = lines[i]
        if i + 1 >= n:
            out.append(code_line)
            break
        value = lines[i + 1]
        i += 2
        try:
            code = int(code_line.strip())
        except ValueError:
            # Hizalama zaten bozuk ve önceki değer metin değil: dokunmadan bırak (doğrulama yakalar)
            out.extend([code_line, value])
            continue
        if code in TEXT_CODES:
            joined = False
            while i < n and not _is_code(lines[i]):
                value = f'{value}\\P{lines[i]}'
                i += 1
                joined = True
            if joined:
                fixed += 1
        out.extend([code_line, value])
    return eol.join(out).encode('utf-8', 'surrogateescape'), fixed
