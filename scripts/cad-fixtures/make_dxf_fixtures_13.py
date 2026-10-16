#!/usr/bin/env python3
"""
LEONX OS — Faz 13 DXF mimari test çizimleri (yalnızca geliştirme aracı).

Gerçek ofis çizimlerine benzer şekilde TEK model uzayında yan yana duran paftalar üretir:
  - Normal kat planı ("1.-3. KATLAR" — kat tekrarı), duvarlar, doğrama blokları ve poz etiketleri
  - Ayrı bir bölgede metin tablosu olarak DOĞRAMA ÇİZELGESİ
Revizyon 2 dosyası, revizyon karşılaştırması için bilinen farklar içerir.

Beklenen sonuçlar dosyanın yanında <ad>.expected.json olarak yazılır; testler Python gerektirmez.
Kullanım: pip install ezdxf==1.4.4 && python3 scripts/cad-fixtures/make_dxf_fixtures_13.py
"""
import json
import os

import ezdxf

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'cad', '__fixtures__')
os.makedirs(OUT, exist_ok=True)

LABEL_H = 125  # mm (1/50 ölçekte 2,5 mm)
TITLE_H = 250


def rect(space, x, y, w, h, layer='0'):
    space.add_lwpolyline([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], close=True, dxfattribs={'layer': layer})


def window_block(doc, name, w, h, sashes=1):
    blk = doc.blocks.new(name, base_point=(0, 0))
    rect(blk, 0, 0, w, h)
    rect(blk, 60, 60, w - 120, h - 120)
    for i in range(1, sashes):
        x = w * i / sashes
        blk.add_line((x, 60), (x, h - 60))


def text(msp, s, x, y, h=LABEL_H, layer='YAZI'):
    msp.add_text(s, height=h, dxfattribs={'insert': (x, y), 'layer': layer})


def build(name, pozlar, plan, floors_title, schedule):
    """
    pozlar:   {kod: (blok, w, h)}
    plan:     [(kod, x, y)] — plandaki blok + etiket yerleşimi
    schedule: [(kod, tip, malzeme, en_cm, boy_cm, adet)]
    """
    doc = ezdxf.new('R2018', setup=True)
    doc.units = ezdxf.units.MM
    msp = doc.modelspace()
    for code, (blk, w, h) in pozlar.items():
        if blk not in doc.blocks:
            window_block(doc, blk, w, h, 2 if w >= 1000 else 1)

    # ---------------- Bölge A: kat planı (0..20000 × 0..12000)
    for x0, y0, x1, y1 in [(0, 0, 20000, 0), (20000, 0, 20000, 12000), (20000, 12000, 0, 12000), (0, 12000, 0, 0)]:
        msp.add_line((x0, y0), (x1, y1), dxfattribs={'layer': 'DUVAR'})
        msp.add_line((x0 + (250 if x0 == x1 else 0), y0 + (250 if y0 == y1 else 0)), (x1 + (250 if x0 == x1 else 0), y1 + (250 if y0 == y1 else 0)), dxfattribs={'layer': 'DUVAR'})
    for code, x, y in plan:
        blk, w, h = pozlar[code]
        msp.add_blockref(blk, (x, y), dxfattribs={'layer': 'DOGRAMA'})
        text(msp, code, x + w / 2 - LABEL_H, y - 3 * LABEL_H, layer='POZ_NO')
    text(msp, 'SALON', 6000, 6000)
    text(msp, 'YATAK ODASI', 14000, 6000)
    text(msp, floors_title, 0, -1800, TITLE_H, 'PAFTA')
    text(msp, 'ÖLÇEK 1/50', 0, -2300, LABEL_H, 'PAFTA')

    # ---------------- Bölge B: doğrama çizelgesi (x = 40000)
    sx, sy = 40000, 10000
    text(msp, 'DOĞRAMA ÇİZELGESİ', sx, sy + 1000, TITLE_H, 'PAFTA')
    cols = [('POZ NO', 0), ('TİP', 1500), ('MALZEME', 3500), ('EN (cm)', 5500), ('BOY (cm)', 7000), ('ADET', 8500)]
    for t, dx in cols:
        text(msp, t, sx + dx, sy)
    for i, (code, tip, mal, en, boy, adet) in enumerate(schedule):
        y = sy - (i + 1) * 400
        for v, (_, dx) in zip([code, tip, mal, str(en), str(boy), str(adet)], cols):
            text(msp, v, sx + dx, y)
    # Tablo çizgileri
    rows = len(schedule) + 1
    for r in range(rows + 1):
        y = sy + 300 - r * 400
        msp.add_line((sx - 100, y), (sx + 9500, y), dxfattribs={'layer': 'TABLO'})
    for _, dx in cols + [('', 9500)]:
        msp.add_line((sx + dx - 100, sy + 300), (sx + dx - 100, sy + 300 - rows * 400), dxfattribs={'layer': 'TABLO'})
    doc.saveas(os.path.join(OUT, name))


POZ = {
    'P1': ('PVC_P1_1200x1500', 1200, 1500),
    'P2': ('PVC_P2_800x1200', 800, 1200),
    'K1': ('ALU_K1_900x2100', 900, 2100),
    'P3': ('PVC_P3_1000x1000', 1000, 1000),
}

# ---------------------------------------------------------------- Revizyon 1
build(
    'mimari_plan_cizelge.dxf',
    POZ,
    [('P1', 1000, 12000), ('P1', 4000, 12000), ('P2', 9000, 12000), ('K1', 15000, 0)],
    '1.-3. KATLAR NORMAL KAT PLANI',
    [
        ('P1', 'PENCERE', 'PVC', 120, 150, 6),
        ('P2', 'PENCERE', 'PVC', 80, 120, 3),
        ('K1', 'KAPI', 'ALÜMİNYUM', 90, 210, 4),  # plan: 1 × 3 kat = 3 → çelişki
        ('S1', 'SÜRME', 'ALÜMİNYUM', 300, 240, 2),  # yalnız çizelgede
    ],
)
expected1 = {
    'units_mm_per_unit': 1,
    'floor_multiplier': 3,
    'pozlar': {
        'P1': {'adet': 6, 'w': 1200, 'h': 1500, 'malzeme': 'pvc', 'plan': 2, 'cizelge': 6},
        'P2': {'adet': 3, 'w': 800, 'h': 1200, 'malzeme': 'pvc', 'plan': 1, 'cizelge': 3},
        'K1': {'adet': None, 'w': 900, 'h': 2100, 'malzeme': 'aluminyum', 'plan': 1, 'cizelge': 4, 'celiski': 'adet'},
        'S1': {'adet': 2, 'w': 3000, 'h': 2400, 'malzeme': 'aluminyum', 'plan': 0, 'cizelge': 2},
    },
}

# ---------------------------------------------------------------- Revizyon 2 (bilinen farklar)
POZ2 = dict(POZ)
POZ2['P1'] = ('PVC_P1_1300x1500', 1300, 1500)
build(
    'mimari_plan_cizelge_rev2.dxf',
    POZ2,
    [('P1', 1000, 12000), ('P1', 4000, 12000), ('P2', 9000, 12000), ('P3', 12000, 12000)],
    '1.-3. KATLAR NORMAL KAT PLANI',
    [
        ('P1', 'PENCERE', 'PVC', 130, 150, 6),  # en 120 → 130
        ('P2', 'PENCERE', 'PVC', 80, 120, 3),  # aynı
        ('P3', 'PENCERE', 'PVC', 100, 100, 3),  # yeni
        ('S1', 'SÜRME', 'ALÜMİNYUM', 300, 240, 2),  # aynı; K1 silindi
    ],
)
expected2 = {
    'farklar': {'eklenen': ['P3'], 'silinen': ['K1'], 'degisen': ['P1'], 'ayni': ['P2', 'S1']},
}

for n, e in [('mimari_plan_cizelge', expected1), ('mimari_plan_cizelge_rev2', expected2)]:
    with open(os.path.join(OUT, n + '.expected.json'), 'w', encoding='utf-8') as f:
        json.dump(e, f, ensure_ascii=False, indent=2)
print('ok')
