#!/usr/bin/env python3
"""
PDF raporları için Inter yazı tipi (SIL OFL 1.1) TrueType alt kümeleri üretir.
Kaynak: sistemdeki Inter OTF (CFF) dosyaları → kübik eğriler ikinci dereceye (cu2qu) çevrilir,
Latin + Türkçe + teknik semboller için alt küme alınır. pdf-lib/fontkit TrueType gömmede
en kararlı sonucu verir.

Kullanım: pip install fonttools==4.66.1 && python3 scripts/cad-fixtures/make_pdf_fonts.py
"""
import os
from fontTools.ttLib import TTFont, newTable
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools import subset

SRC = '/usr/share/fonts/opentype/inter'
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets', 'fonts')
UNICODES = list(range(0x20, 0x7F)) + list(range(0xA0, 0x180)) + [
    0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x20AC, 0x20BA, 0x2212, 0x00D7,
    0x2264, 0x2265, 0x2248, 0x00B2, 0x00B3, 0x00B0, 0x00B1, 0x00D8, 0x2192, 0x2713, 0x2116,
]


def otf_to_ttf(src, dst):
    font = TTFont(src)
    glyph_order = font.getGlyphOrder()
    gs = font.getGlyphSet()
    glyf = newTable('glyf')
    glyf.glyphOrder = glyph_order
    glyf.glyphs = {}
    for name in glyph_order:
        pen = TTGlyphPen(gs)
        try:
            gs[name].draw(Cu2QuPen(pen, max_err=1.0, reverse_direction=True))
            glyf.glyphs[name] = pen.glyph()
        except Exception:
            glyf.glyphs[name] = TTGlyphPen(gs).glyph()
    font['glyf'] = glyf
    font['loca'] = newTable('loca')
    del font['CFF ']
    if 'VORG' in font:
        del font['VORG']
    font['maxp'] = newTable('maxp')
    font['maxp'].tableVersion = 0x00010000
    for attr in ('maxZones', 'maxTwilightPoints', 'maxStorage', 'maxFunctionDefs', 'maxInstructionDefs', 'maxStackElements', 'maxSizeOfInstructions', 'maxComponentElements'):
        setattr(font['maxp'], attr, 0)
    font['maxp'].maxZones = 1
    font['head'].glyphDataFormat = 0
    font['post'].formatType = 2.0
    font['post'].extraNames = []
    font['post'].mapping = {}
    font['post'].glyphOrder = glyph_order
    font.sfntVersion = '\x00\x01\x00\x00'
    font.save(dst)


for style in ('Regular', 'SemiBold'):
    tmp = f'/tmp/Inter-{style}-full.ttf'
    otf_to_ttf(os.path.join(SRC, f'Inter-{style}.otf'), tmp)
    opts = subset.Options()
    opts.layout_features = ['kern', 'liga', 'tnum']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    opts.drop_tables += ['GSUB']
    f = TTFont(tmp)
    s = subset.Subsetter(opts)
    s.populate(unicodes=UNICODES)
    s.subset(f)
    out = os.path.join(OUT, f'Inter-{style}.ttf')
    f.save(out)
    print(out, os.path.getsize(out))
