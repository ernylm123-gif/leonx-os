"""
Dönüşüm kalite kontrolü: DWG'nin kendi nesne envanteri (LibreDWG `dwgread -O JSON`) ile üretilen
DXF'in envanteri (ezdxf) karşılaştırılır. Kaybolan nesne, katman, blok, öznitelik, ölçü ve layout
bilgisi raporlanır. ezdxf denetimi (audit) DXF'in yapısal geçerliliğini ayrıca doğrular.
"""
from __future__ import annotations

import collections
import io
import json
import os
import tempfile
from dataclasses import asdict, dataclass, field

import ezdxf
from ezdxf import recover

from .convert import libredwg_bin, run_tool

# Karşılaştırılan nesne türleri (DWG adı → DXF adı)
KEY_TYPES = {
    'LINE': 'LINE', 'LWPOLYLINE': 'LWPOLYLINE', 'POLYLINE_2D': 'POLYLINE', 'POLYLINE_3D': 'POLYLINE', 'ARC': 'ARC',
    'CIRCLE': 'CIRCLE', 'ELLIPSE': 'ELLIPSE', 'SPLINE': 'SPLINE', 'TEXT': 'TEXT', 'MTEXT': 'MTEXT', 'INSERT': 'INSERT',
    'MINSERT': 'INSERT', 'ATTRIB': 'ATTRIB', 'ATTDEF': 'ATTDEF', 'HATCH': 'HATCH', 'LEADER': 'LEADER', 'MULTILEADER': 'MULTILEADER',
    'TABLE': 'ACAD_TABLE', 'VIEWPORT': 'VIEWPORT', 'SOLID': 'SOLID', 'POINT': 'POINT',
}
DIM_PREFIX = 'DIMENSION'

UNITS = {0: None, 1: 'inch', 2: 'foot', 4: 'mm', 5: 'cm', 6: 'm'}


@dataclass
class QcReport:
    status: str  # 'tamam' | 'eksik' | 'basarisiz'
    dxf_valid: bool
    audit_errors: int
    units: str | None
    counts_dwg: dict[str, int] = field(default_factory=dict)
    counts_dxf: dict[str, int] = field(default_factory=dict)
    lost: dict[str, int] = field(default_factory=dict)
    layers: dict[str, int] = field(default_factory=dict)
    blocks: dict[str, int] = field(default_factory=dict)
    layouts: list[str] = field(default_factory=list)
    xrefs: list[str] = field(default_factory=list)
    proxy_entities: int = 0
    notes: list[str] = field(default_factory=list)

    def to_dict(self):
        return asdict(self)


def dwg_inventory(dwg: bytes, timeout_s: int = 90) -> dict:
    """LibreDWG ile DWG nesne sayıları (dönüştürmeden bağımsız okuma)."""
    tool = libredwg_bin('dwgread')
    with tempfile.TemporaryDirectory(prefix='leonx-inv-') as tmp:
        src = os.path.join(tmp, 'girdi.dwg')
        out = os.path.join(tmp, 'envanter.json')
        with open(src, 'wb') as f:
            f.write(dwg)
        r = run_tool([tool, '-O', 'JSON', '-o', out, src], tmp, timeout_s)
        if r.timed_out or not os.path.exists(out):
            return {'ok': False}
        with open(out, 'rb') as f:
            data = json.loads(f.read().decode('utf-8', 'replace'))
    ents: collections.Counter = collections.Counter()
    layers = blocks = 0
    xrefs: list[str] = []
    for o in data.get('OBJECTS', []):
        e = o.get('entity')
        if e:
            if e.startswith(DIM_PREFIX):
                ents['DIMENSION'] += 1
            elif e in KEY_TYPES:
                ents[KEY_TYPES[e]] += 1
            elif e in ('PROXY_ENTITY', 'UNKNOWN_ENT'):
                ents['PROXY'] += 1
        else:
            kind = o.get('object')
            if kind == 'LAYER':
                layers += 1
            elif kind == 'BLOCK_HEADER':
                name = str(o.get('name', ''))
                if not name.startswith('*'):
                    blocks += 1
                if o.get('xref_pname'):
                    xrefs.append(f"{name} → {o.get('xref_pname')}")
    return {'ok': True, 'entities': dict(ents), 'layers': layers, 'blocks': blocks, 'xrefs': xrefs}


def dxf_inventory(dxf: bytes) -> tuple[dict, object]:
    doc, auditor = recover.read(io.BytesIO(dxf))
    ents: collections.Counter = collections.Counter()
    for e in doc.entitydb.values():
        if not isinstance(e, ezdxf.entities.DXFGraphic) or e.is_alive is False:
            continue
        t = e.dxftype()
        if t == 'DIMENSION' or t.startswith('ARC_DIMENSION'):
            ents['DIMENSION'] += 1
        elif t in KEY_TYPES.values():
            ents[t] += 1
        elif t == 'ACAD_PROXY_ENTITY':
            ents['PROXY'] += 1
    blocks = sum(1 for b in doc.blocks if not b.name.startswith('*'))
    return {
        'entities': dict(ents),
        'layers': len(doc.layers),
        'blocks': blocks,
        'layouts': [l.name for l in doc.layouts],
        'units': UNITS.get(doc.header.get('$INSUNITS', 0)),
        'audit_errors': len(auditor.errors),
    }, doc


def quality_check(dwg: bytes, dxf: bytes) -> QcReport:
    notes: list[str] = []
    try:
        dx, _doc = dxf_inventory(dxf)
    except Exception as e:  # yapısal olarak bozuk DXF
        return QcReport(status='basarisiz', dxf_valid=False, audit_errors=-1, units=None, notes=[f'Üretilen DXF okunamadı: {str(e)[:200]}'])
    inv = dwg_inventory(dwg)
    lost: dict[str, int] = {}
    if inv.get('ok'):
        for t, n in inv['entities'].items():
            if t == 'PROXY':  # okunamayan özel nesneler ayrıca bildirilir
                continue
            m = dx['entities'].get(t, 0)
            if m < n:
                lost[t] = n - m
        if dx['layers'] < inv['layers']:
            lost['LAYER'] = inv['layers'] - dx['layers']
        if dx['blocks'] < inv['blocks']:
            lost['BLOCK'] = inv['blocks'] - dx['blocks']
    else:
        notes.append('DWG envanteri okunamadı; kayıp denetimi yapılamadı.')
    if dx['units'] is None:
        notes.append('Çizim birimi ($INSUNITS) tanımsız: ölçüler kalibrasyon olmadan kesin kabul edilmez.')
    proxy = inv.get('entities', {}).get('PROXY', 0) if inv.get('ok') else 0
    if proxy:
        notes.append(f'{proxy} özel (proxy) nesne var; bunlar okunamaz ve analize girmez.')
    xrefs = inv.get('xrefs', []) if inv.get('ok') else []
    if xrefs:
        notes.append(f'{len(xrefs)} dış referans (XREF) var; dış dosyaların içeriği bu dönüşüme dahil değildir.')
    status = 'tamam' if not lost and dx['audit_errors'] == 0 and inv.get('ok') else 'eksik'
    return QcReport(
        status=status,
        dxf_valid=True,
        audit_errors=dx['audit_errors'],
        units=dx['units'],
        counts_dwg=inv.get('entities', {}),
        counts_dxf=dx['entities'],
        lost=lost,
        layers={'dwg': inv.get('layers', -1), 'dxf': dx['layers']},
        blocks={'dwg': inv.get('blocks', -1), 'dxf': dx['blocks']},
        layouts=dx['layouts'],
        xrefs=xrefs,
        proxy_entities=proxy,
        notes=notes,
    )
