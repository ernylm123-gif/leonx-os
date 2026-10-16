#!/usr/bin/env python3
"""
LEONX OS — CAD motoru denetim fikstürleri (blok öznitelikleri ve kâğıt uzayı).

Gerçek ofis çizimlerinde sık görülen iki durum:
  1. Doğrama blokları POZ/EN/BOY/TIP/MALZEME özniteliği taşır; plan üzerinde ayrıca poz yazısı yoktur.
     Blok adı genel olabilir ("PENCERE_GENEL"); tip/malzeme yalnız öznitelikte yazar.
  2. Antet ve doğrama çizelgesi kâğıt uzayındaki (layout) paftadadır, plan model uzayındadır.
Beklenen sonuçlar <ad>.expected.json dosyalarına yazılır.
Kullanım: pip install ezdxf==1.4.4 && python3 scripts/cad-fixtures/make_dxf_fixtures_cad.py
"""
import json
import os

import ezdxf

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'cad', '__fixtures__')


def save(doc, name, expected):
    doc.saveas(os.path.join(OUT, name + '.dxf'))
    with open(os.path.join(OUT, name + '.expected.json'), 'w', encoding='utf-8') as f:
        json.dump(expected, f, ensure_ascii=False, indent=2)


# 1) Öznitelikli bloklar (yazı etiketi yok)
doc = ezdxf.new('R2018', setup=True)
doc.units = ezdxf.units.MM
msp = doc.modelspace()
blk = doc.blocks.new('PENCERE_GENEL')
blk.add_lwpolyline([(0, 0), (1, 0), (1, 1), (0, 1)], close=True)
for tag, dy in [('POZ', -0.2), ('EN', -0.35), ('BOY', -0.5), ('TIP', -0.65), ('MALZEME', -0.8), ('SERI', -0.95)]:
    blk.add_attdef(tag, (0, dy), dxfattribs={'height': 0.1})
for x, (poz, en, boy, tip, mal, seri) in enumerate([
    ('P1', 1200, 1500, 'PENCERE', 'PVC', '70 SERİ'),
    ('P1', 1200, 1500, 'PENCERE', 'PVC', '70 SERİ'),
    ('P2', 800, 1200, 'PENCERE', 'PVC', '70 SERİ'),
    ('K1', 900, 2100, 'KAPI', 'ALÜMİNYUM', 'ISI YALITIMLI'),
]):
    r = msp.add_blockref('PENCERE_GENEL', (x * 3000, 0), dxfattribs={'xscale': en, 'yscale': boy})
    r.add_auto_attribs({'POZ': poz, 'EN': str(en), 'BOY': str(boy), 'TIP': tip, 'MALZEME': mal, 'SERI': seri})
# P5: öznitelik cm ve geometriyle UYUŞMUYOR (EN 110 cm, blok 1000 mm) → çelişki
b5 = doc.blocks.new('PVC_P5')
b5.add_lwpolyline([(0, 0), (1000, 0), (1000, 1000), (0, 1000)], close=True)
b5.add_attdef('POZ', (0, -200), dxfattribs={'height': 100})
b5.add_attdef('EN_CM', (0, -350), dxfattribs={'height': 100})
b5.add_attdef('BOY_CM', (0, -500), dxfattribs={'height': 100})
r = msp.add_blockref('PVC_P5', (15000, 0))
r.add_auto_attribs({'POZ': 'P5', 'EN_CM': '110', 'BOY_CM': '100'})
save(doc, 'cad_oznitelik_bloklar', {
    'pozlar': {
        'P1': {'adet': 2, 'w': 1200, 'h': 1500, 'kategori': 'pvc_pencere', 'malzeme': 'PVC', 'sistem': '70 SERİ'},
        'P2': {'adet': 1, 'w': 800, 'h': 1200, 'kategori': 'pvc_pencere', 'malzeme': 'PVC'},
        'K1': {'adet': 1, 'w': 900, 'h': 2100, 'kategori': 'al_kapi', 'malzeme': 'ALÜMİNYUM'},
        'P5': {'adet': 1, 'w': 1000, 'h': 1000, 'celiski': 'olcu'},
    },
})

# 2) Kâğıt uzayında antet + çizelge, model uzayında plan
doc = ezdxf.new('R2018', setup=True)
doc.units = ezdxf.units.MM
msp = doc.modelspace()
w = doc.blocks.new('PVC_P1_1200x1500')
w.add_lwpolyline([(0, 0), (1200, 0), (1200, 1500), (0, 1500)], close=True)
for x in (0, 3000):
    msp.add_blockref('PVC_P1_1200x1500', (x, 0))
    msp.add_text('P1', height=125, dxfattribs={'insert': (x + 500, -400)})
ps = doc.layout('Layout1')
ps.add_text('PROJE: GÜNEŞ KONUTLARI', height=5, dxfattribs={'insert': (10, 280)})
ps.add_text('PAFTA: DOĞRAMA ÇİZELGESİ', height=3.5, dxfattribs={'insert': (10, 270)})
for i, row in enumerate([('POZ NO', 'TİP', 'MALZEME', 'EN (cm)', 'BOY (cm)', 'ADET'), ('P1', 'PENCERE', 'PVC', '120', '150', '2')]):
    for j, v in enumerate(row):
        ps.add_text(v, height=2.5, dxfattribs={'insert': (20 + j * 30, 200 - i * 8)})
save(doc, 'cad_kagit_uzayi_cizelge', {
    'layout_sayisi': 1,
    'pozlar': {'P1': {'adet': 2, 'w': 1200, 'h': 1500, 'kategori': 'pvc_pencere', 'malzeme': 'PVC', 'cizelge': 2}},
})
print('ok')
