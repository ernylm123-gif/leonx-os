#!/usr/bin/env python3
"""
LEONX OS — CAD test çizimleri üreticisi (yalnızca geliştirme aracı).

Bilinen ölçülerle DXF dosyaları üretir ve beklenen sonuçları `expected.json` dosyasına yazar.
Beklenen değerler iki bağımsız kaynaktan gelir:
  1. Çizimin kuruluş parametreleri (ör. 1200 × 1500 mm pencere)
  2. ezdxf kütüphanesinin kendi blok açma ve sınır kutusu hesabı (ezdxf.bbox)
Böylece LEONX DXF çekirdeği, kendi kodundan bağımsız bir referansla karşılaştırılır.

Kullanım:  pip install ezdxf==1.4.4 && python3 scripts/cad-fixtures/generate.py
Çıktı:     src/cad/__fixtures__/*.dxf ve expected.json (depoya eklenir; testler Python gerektirmez)
"""
import json
import math
import os
import random

import ezdxf
from ezdxf import bbox as ezbbox
from ezdxf.math import Vec2

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'cad', '__fixtures__')
os.makedirs(OUT, exist_ok=True)
expected = {}


def new_doc(units, version='R2018'):
    doc = ezdxf.new(version, setup=True)
    if units is None:
        doc.header['$INSUNITS'] = 0
    else:
        doc.units = units
    return doc


def save(doc, name):
    path = os.path.join(OUT, name)
    doc.saveas(path)
    return path


def bb(entities):
    box = ezbbox.extents(entities, fast=False)
    return [box.extmin.x, box.extmin.y, box.extmax.x, box.extmax.y]


def rect(msp_or_block, x, y, w, h, **attribs):
    return msp_or_block.add_lwpolyline([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], close=True, dxfattribs=attribs)


# --------------------------------------------------------------------------- 1. Birimler
# Aynı 1200 × 1500 mm pencere, farklı çizim birimleriyle
for units, code, factor, name in [
    (ezdxf.units.MM, 4, 1.0, 'units_mm.dxf'),
    (ezdxf.units.CM, 5, 0.1, 'units_cm.dxf'),
    (ezdxf.units.M, 6, 0.001, 'units_m.dxf'),
    (ezdxf.units.IN, 1, 1 / 25.4, 'units_inch.dxf'),
    (None, 0, 1.0, 'units_unitless.dxf'),
]:
    doc = new_doc(units)
    msp = doc.modelspace()
    rect(msp, 100 * factor, 200 * factor, 1200 * factor, 1500 * factor, layer='DOGRAMA')
    save(doc, name)
    expected[name] = {
        'insunits': code,
        'mmPerUnit': None if code == 0 else 1 / factor,
        'rect_drawing_units': [1200 * factor, 1500 * factor],
        'rect_mm': [1200, 1500],
        'area_mm2': 1200 * 1500,
        'perimeter_mm': 2 * (1200 + 1500),
    }

# --------------------------------------------------------------------------- 2. Blok dönüşümleri
doc = new_doc(ezdxf.units.MM)
msp = doc.modelspace()
blk = doc.blocks.new('PENCERE_1200x1500', base_point=(0, 0))
rect(blk, 0, 0, 1200, 1500, layer='0')
blk.add_line((600, 0), (600, 1500), dxfattribs={'layer': '0'})
kapi = doc.blocks.new('KAPI', base_point=(100, 50))
rect(kapi, 100, 50, 900, 2100, layer='0')
cases = [
    ('duz', 'PENCERE_1200x1500', (0, 0), {}, ),
    ('dondurulmus_90', 'PENCERE_1200x1500', (5000, 0), {'rotation': 90}),
    ('olcekli_2x1', 'PENCERE_1200x1500', (10000, 0), {'xscale': 2, 'yscale': 1}),
    ('aynali_x', 'PENCERE_1200x1500', (15000, 0), {'xscale': -1}),
    ('dondurulmus_30_olcek_0.5', 'PENCERE_1200x1500', (20000, 0), {'rotation': 30, 'xscale': 0.5, 'yscale': 0.5}),
    ('extrusion_negatif_z', 'PENCERE_1200x1500', (25000, 0), {'extrusion': (0, 0, -1)}),
    ('taban_noktali_kapi', 'KAPI', (30000, 0), {}),
    ('taban_noktali_kapi_45', 'KAPI', (35000, 0), {'rotation': 45}),
]
exp_inserts = []
for key, block, ins, attribs in cases:
    ref = msp.add_blockref(block, ins, dxfattribs={'layer': 'DOGRAMA', **attribs})
    ref.dxf.handle  # tanıtıcı atanır
    virtual = list(ref.virtual_entities())
    exp_inserts.append({'key': key, 'handle': ref.dxf.handle, 'block': block, 'bbox': bb(virtual)})
save(doc, 'blocks_transform.dxf')
expected['blocks_transform.dxf'] = {'inserts': exp_inserts}

# MINSERT: 3 sütun × 2 satır
doc = new_doc(ezdxf.units.MM)
msp = doc.modelspace()
blk = doc.blocks.new('P1', base_point=(0, 0))
rect(blk, 0, 0, 1000, 1200, layer='0')
m = msp.add_blockref('P1', (0, 0), dxfattribs={'rotation': 0})
m.grid(size=(2, 3), spacing=(2000, 1500))
# Not: ezdxf virtual_entities() MINSERT dizisini açmaz; multi_insert() tüm hücreleri verir
virtual = [v for cell in m.multi_insert() for v in cell.virtual_entities()]
save(doc, 'minsert.dxf')
expected['minsert.dxf'] = {'instances': 6, 'bbox': bb(virtual)}

# --------------------------------------------------------------------------- 3. İç içe bloklar
doc = new_doc(ezdxf.units.MM)
doc.layers.add('DOGRAMA', color=3)
msp = doc.modelspace()
inner = doc.blocks.new('ICTE', base_point=(0, 0))
rect(inner, 0, 0, 100, 200, layer='0', color=0)  # BYBLOCK renk, 0 katmanı
inner.add_line((0, 0), (100, 200), dxfattribs={'layer': 'SABIT', 'color': 5})
outer = doc.blocks.new('DISTA', base_point=(0, 0))
outer.add_blockref('ICTE', (500, 0), dxfattribs={'rotation': 90, 'xscale': 2, 'yscale': 2, 'layer': '0', 'color': 0})
outer.add_line((0, 0), (300, 0), dxfattribs={'layer': '0'})
top = msp.add_blockref('DISTA', (1000, 1000), dxfattribs={'rotation': 45, 'xscale': 1.5, 'yscale': 1.5, 'layer': 'DOGRAMA', 'color': 1})


def explode_all(e, depth=0):
    out = []
    for v in e.virtual_entities():
        if v.dxftype() == 'INSERT':
            out.extend(explode_all(v, depth + 1))
        else:
            out.append(v)
    return out


flat = explode_all(top)
poly = [v for v in flat if v.dxftype() == 'LWPOLYLINE'][0]
pts = [list(p) for p in poly.vertices_in_wcs()]
save(doc, 'nested_blocks.dxf')
expected['nested_blocks.dxf'] = {
    'inner_rect_world': [[p[0], p[1]] for p in pts],
    'inner_rect_layer': 'DOGRAMA',
    'inner_rect_rgb': 0xFF0000,
    'sabit_line_layer': 'SABIT',
    'bbox': bb(flat),
    'depth': 2,
    'inner_rect_size': [100 * 2 * 1.5, 200 * 2 * 1.5],
}

# Döngüsel blok (A → B → A) — AutoCAD'de oluşamaz ama bozuk dosyalarda görülebilir
doc = new_doc(ezdxf.units.MM)
msp = doc.modelspace()
a = doc.blocks.new('A')
b = doc.blocks.new('B')
a.add_line((0, 0), (10, 0))
a.add_blockref('B', (0, 10))
b.add_line((0, 0), (0, 10))
b.add_blockref('A', (10, 0))
msp.add_blockref('A', (0, 0))
msp.add_blockref('YOK_BLOK', (0, 0)) if False else None
save(doc, 'cycle.dxf')
expected['cycle.dxf'] = {'warning': 'block-cycle'}

# --------------------------------------------------------------------------- 4. Nesne türleri
doc = new_doc(ezdxf.units.MM)
msp = doc.modelspace()
msp.add_line((0, 0), (1000, 0), dxfattribs={'layer': 'CIZGI'})
# Kemerli pencere: 1000 genişlik, 1200 düz yükseklik + yarım daire üst (bulge = 1)
kemer = msp.add_lwpolyline([(0, 0, 0), (1000, 0, 0), (1000, 1200, 1), (0, 1200, 0)], format='xyb', close=True, dxfattribs={'layer': 'KEMER'})
msp.add_arc((5000, 0), radius=500, start_angle=0, end_angle=90)
msp.add_circle((7000, 0), radius=250)
msp.add_ellipse((9000, 0), major_axis=(400, 0), ratio=0.5)
msp.add_spline([(10000, 0), (10500, 500), (11000, 0), (11500, 500)])
msp.add_text('Şeffaf Cam ĞÜŞİÖÇ ğüşıöç', height=100, dxfattribs={'layer': 'METIN', 'insert': (0, 3000)})
msp.add_mtext('{\\fArial|b1;KALIN} satır\\Pikinci \\S1/2; %%c50', dxfattribs={'char_height': 80, 'insert': (0, 4000), 'layer': 'METIN'})
dim = msp.add_linear_dim(base=(0, -500), p1=(0, 0), p2=(1000, 0), dimstyle='EZDXF', dxfattribs={'layer': 'OLCU'})
dim.render()
# Elle değiştirilmiş ölçü metni
dim2 = msp.add_linear_dim(base=(0, -1000), p1=(0, 0), p2=(1000, 0), text='1250', dimstyle='EZDXF', dxfattribs={'layer': 'OLCU'})
dim2.render()
hatch = msp.add_hatch(color=2, dxfattribs={'layer': 'TARAMA'})
hatch.paths.add_polyline_path([(20000, 0), (21000, 0), (21000, 1000), (20000, 1000)], is_closed=True, flags=1)
hatch.paths.add_polyline_path([(20250, 250), (20750, 250), (20750, 750), (20250, 750)], is_closed=True, flags=16)
h2 = msp.add_hatch(color=3, dxfattribs={'layer': 'TARAMA'})
ep = h2.paths.add_edge_path(flags=1)
ep.add_line((23000, 0), (24000, 0))
ep.add_arc((24000, 500), radius=500, start_angle=270, end_angle=90, ccw=True)
ep.add_line((24000, 1000), (23000, 1000))
ep.add_line((23000, 1000), (23000, 0))
msp.add_point((30000, 0))
msp.add_solid([(31000, 0), (32000, 0), (31000, 1000), (32000, 1000)])
msp.add_leader([(33000, 0), (33500, 500), (34000, 500)])
msp.add_xline((0, 0), (1, 1))
msp.add_ray((0, 0), (1, 0))
# Kağıt alanı nesnesi: model görünümüne dahil edilmemeli
doc.layout('Layout1').add_line((0, 0), (100, 100))
save(doc, 'entities.dxf')
expected['entities.dxf'] = {
    'line_length': 1000,
    'kemer_area': 1000 * 1200 + math.pi * 500 ** 2 / 2,
    'kemer_perimeter': 1000 + 1200 * 2 + math.pi * 500,
    'arc_length': 500 * math.pi / 2,
    'circle_area': math.pi * 250 ** 2,
    'circle_length': 2 * math.pi * 250,
    'ellipse_area': math.pi * 400 * 200,
    'text': 'Şeffaf Cam ĞÜŞİÖÇ ğüşıöç',
    'mtext': 'KALIN satır\nikinci 1/2 Ø50',
    'dim_measurement': 1000,
    # ezdxf'in EZDXF ölçü stili DIMLFAC=100 kullanır: görünen metin 100000 olur (stil katsayısı senaryosu)
    'dim_displayed_value': 100000,
    'dim_override_text': '1250',
    'hatch_area_with_hole': 1000 * 1000 - 500 * 500,
    'hatch_edge_area': 1000 * 1000 + math.pi * 500 ** 2 / 2,
    'unsupported': ['XLINE', 'RAY'],
    'paper_space_skipped': 1,
}

# --------------------------------------------------------------------------- 5. Kod sayfası (ANSI_1254)
doc = ezdxf.new('R2000')
doc.units = ezdxf.units.MM
doc.header['$DWGCODEPAGE'] = 'ANSI_1254'
doc.modelspace().add_text('PENCERE ÇIKIŞ - ĞÜŞİÖÇ ğüşıöç', height=50, dxfattribs={'insert': (0, 0), 'layer': 'MAHAL_İSİM'})
doc.saveas(os.path.join(OUT, 'encoding_cp1254_mislabeled.dxf'), encoding='cp1254')
# ezdxf başlığa ANSI_1252 yazar: Türk çizimlerinde de sık görülen "yanlış etiketli" durum.
raw = open(os.path.join(OUT, 'encoding_cp1254_mislabeled.dxf'), 'rb').read()
assert b'ANSI_1252' in raw
open(os.path.join(OUT, 'encoding_cp1254.dxf'), 'wb').write(raw.replace(b'ANSI_1252', b'ANSI_1254'))
expected['encoding_cp1254.dxf'] = {'text': 'PENCERE ÇIKIŞ - ĞÜŞİÖÇ ğüşıöç', 'layer': 'MAHAL_İSİM'}
expected['encoding_cp1254_mislabeled.dxf'] = {'text': 'PENCERE ÇIKIŞ - ĞÜŞİÖÇ ğüşıöç', 'layer': 'MAHAL_İSİM', 'warning': 'encoding-fixed'}

# --------------------------------------------------------------------------- 6. Doğrama görünüş paftası (poz tespiti için)
doc = new_doc(ezdxf.units.MM)
doc.layers.add('PENCERE', color=4)
doc.layers.add('KAPI', color=6)
doc.layers.add('OLCU', color=1)
doc.layers.add('POZ_NO', color=2)
msp = doc.modelspace()
# Milimetre çizim, milimetre ölçü metni (DIMLFAC = 1)
doc.dimstyles.new('LEONX', dxfattribs={'dimlfac': 1, 'dimtxt': 100, 'dimasz': 60, 'dimexe': 40, 'dimexo': 20, 'dimdec': 0})


def window_block(name, w, h, sashes=1):
    blk = doc.blocks.new(name, base_point=(0, 0))
    rect(blk, 0, 0, w, h, layer='0')
    # İç kasa / kanat çizgileri (dış çerçevenin içinde): ayrı poz sayılmamalı
    rect(blk, 60, 60, w - 120, h - 120, layer='0')
    for i in range(1, sashes):
        x = w * i / sashes
        blk.add_line((x, 60), (x, h - 60), dxfattribs={'layer': '0'})
    return blk


window_block('PVC_P1_1200x1500', 1200, 1500, 2)
window_block('ALU_K1_900x2100', 900, 2100, 1)
# P1: 3 adet blok referansı (aynı poz)
for i, x in enumerate([0, 2000, 4000]):
    msp.add_blockref('PVC_P1_1200x1500', (x, 0), dxfattribs={'layer': 'PENCERE'})
msp.add_text('P1', height=150, dxfattribs={'insert': (500, -400), 'layer': 'POZ_NO'})
d = msp.add_linear_dim(base=(0, -250), p1=(0, 0), p2=(1200, 0), dimstyle='LEONX', dxfattribs={'layer': 'OLCU'})
d.render()
d = msp.add_linear_dim(base=(-250, 0), p1=(0, 0), p2=(0, 1500), angle=90, dimstyle='LEONX', dxfattribs={'layer': 'OLCU'})
d.render()
# K1: kapı, 2 adet
for x in [7000, 9000]:
    msp.add_blockref('ALU_K1_900x2100', (x, 0), dxfattribs={'layer': 'KAPI'})
msp.add_text('K1', height=150, dxfattribs={'insert': (7300, -400), 'layer': 'POZ_NO'})
# Bloksuz çizilmiş sabit cam: kapalı polyline 2000 × 800 (+ aynı yerde yinelenmiş kopya: çift sayılmamalı)
rect(msp, 12000, 0, 2000, 800, layer='PENCERE')
rect(msp, 12000, 0, 2000, 800, layer='PENCERE')
msp.add_text('S1', height=150, dxfattribs={'insert': (12800, -400), 'layer': 'POZ_NO'})
# Dört ayrı çizgiden oluşan pencere 1000 × 1000
for (x1, y1, x2, y2) in [(16000, 0, 17000, 0), (17000, 0, 17000, 1000), (17000, 1000, 16000, 1000), (16000, 1000, 16000, 0)]:
    msp.add_line((x1, y1), (x2, y2), dxfattribs={'layer': 'PENCERE'})
msp.add_text('P2', height=150, dxfattribs={'insert': (16400, -400), 'layer': 'POZ_NO'})
# Yamuk (merdiven) pencere: alt 1500, sol 600, sağ 1200
msp.add_lwpolyline([(19000, 0), (20500, 0), (20500, 1200), (19000, 600)], close=True, dxfattribs={'layer': 'PENCERE'})
msp.add_text('P3', height=150, dxfattribs={'insert': (19600, -400), 'layer': 'POZ_NO'})
save(doc, 'window_schedule.dxf')
expected['window_schedule.dxf'] = {
    'groups': [
        {'source': 'block', 'block': 'PVC_P1_1200x1500', 'count': 3, 'w': 1200, 'h': 1500, 'label': 'P1', 'material': 'pvc'},
        {'source': 'block', 'block': 'ALU_K1_900x2100', 'count': 2, 'w': 900, 'h': 2100, 'label': 'K1', 'material': 'aluminyum'},
        {'source': 'polyline', 'count': 1, 'w': 2000, 'h': 800, 'label': 'S1', 'duplicate_removed': 1},
        {'source': 'lines', 'count': 1, 'w': 1000, 'h': 1000, 'label': 'P2'},
        {'source': 'polygon', 'count': 1, 'shape': 'trapez', 'area': (600 + 1200) / 2 * 1500, 'label': 'P3'},
    ],
    'dimension_values': [1200, 1500],
}

# --------------------------------------------------------------------------- 7. Bozuk dosyalar
good = open(os.path.join(OUT, 'units_mm.dxf'), 'rb').read()
open(os.path.join(OUT, 'corrupt_truncated.dxf'), 'wb').write(good[: len(good) // 2])
lines = good.decode('utf-8').split('\n')
# ENTITIES bölümünde bir grup kodunu bozuk yap
idx = lines.index('ENTITIES')
lines[idx + 3] = 'XYZ'
open(os.path.join(OUT, 'corrupt_badcode.dxf'), 'wb').write('\n'.join(lines).encode('utf-8'))
open(os.path.join(OUT, 'fake.dwg'), 'wb').write(b'AC1032' + bytes(random.Random(1).randrange(256) for _ in range(200)))
open(os.path.join(OUT, 'binary.dxf'), 'wb').write(b'AutoCAD Binary DXF\r\n\x1a\x00' + b'\x00' * 50)
open(os.path.join(OUT, 'not_cad.dxf'), 'wb').write('Bu bir metin dosyasıdır.\n'.encode('utf-8'))
expected['corrupt'] = {
    'corrupt_truncated.dxf': 'partial-or-syntax',
    'corrupt_badcode.dxf': 'syntax',
    'fake.dwg': 'dwg',
    'binary.dxf': 'dxf-binary',
    'not_cad.dxf': 'unknown',
}

with open(os.path.join(OUT, 'expected.json'), 'w', encoding='utf-8') as f:
    json.dump(expected, f, ensure_ascii=False, indent=2)
print('Üretilen dosyalar:', sorted(os.listdir(OUT)))
