/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { analyzeDxfBytes, CadAnalysisError } from './analyze'
import type { DxfAnalysis, SceneEntity } from './types'

/**
 * Referans çizimler scripts/cad-fixtures/generate.py ile ezdxf kullanılarak üretilir.
 * Beklenen değerler kuruluş ölçülerinden ve ezdxf'in bağımsız blok açma hesabından gelir.
 */
const DIR = fileURLToPath(new URL('./__fixtures__', import.meta.url))
const expected = JSON.parse(readFileSync(join(DIR, 'expected.json'), 'utf-8'))
const load = (name: string) => new Uint8Array(readFileSync(join(DIR, name)))
const analyze = (name: string) => analyzeDxfBytes(load(name))

const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)))
const top = (a: DxfAnalysis) => a.scene.entities.filter((e) => e.owner === -1)
const byType = (a: DxfAnalysis, t: string) => a.scene.entities.filter((e) => e.type === t)

describe('DXF birimleri', () => {
  for (const name of ['units_mm.dxf', 'units_cm.dxf', 'units_m.dxf', 'units_inch.dxf']) {
    it(`${name}: birim okunur ve dikdörtgen mm'ye doğru çevrilir`, () => {
      const a = analyze(name)
      const exp = expected[name]
      expect(a.report.units.code).toBe(exp.insunits)
      close(a.report.units.mmPerUnit!, exp.mmPerUnit, 1e-9)
      const r = top(a).find((e) => e.rect)!
      expect(r).toBeTruthy()
      close(r.rect!.w, exp.rect_drawing_units[0], 1e-9)
      close(r.rect!.h, exp.rect_drawing_units[1], 1e-9)
      const k = a.report.units.mmPerUnit!
      close(r.rect!.w * k, 1200, 1e-9)
      close(r.rect!.h * k, 1500, 1e-9)
      close(r.area! * k * k, exp.area_mm2, 1e-9)
      close(r.length! * k, exp.perimeter_mm, 1e-9)
      expect(a.report.warnings.find((w) => w.code === 'units-unknown')).toBeUndefined()
    })
  }

  it('birimsiz çizimde birim bilinmiyor olarak işaretlenir ve hata uyarısı verilir', () => {
    const a = analyze('units_unitless.dxf')
    expect(a.report.units.mmPerUnit).toBeNull()
    const w = a.report.warnings.find((x) => x.code === 'units-unknown')
    expect(w?.severity).toBe('hata')
  })
})

describe('Blok dönüşümleri', () => {
  const a = analyze('blocks_transform.dxf')
  for (const exp of expected['blocks_transform.dxf'].inserts) {
    it(`${exp.key}: dünya sınır kutusu ezdxf ile aynı`, () => {
      const ins = a.scene.inserts.find((i) => i.handle === exp.handle)!
      expect(ins).toBeTruthy()
      expect(ins.block).toBe(exp.block)
      for (let i = 0; i < 4; i++) close(ins.bbox[i], exp.bbox[i], 1e-9)
    })
  }

  it('aynalı referans "mirrored" olarak işaretlenir; döndürme açısı okunur', () => {
    const mir = a.scene.inserts.find((i) => i.handle === expected['blocks_transform.dxf'].inserts[3].handle)!
    expect(mir.mirrored).toBe(true)
    const neg = a.scene.inserts.find((i) => i.handle === expected['blocks_transform.dxf'].inserts[5].handle)!
    expect(neg.mirrored).toBe(true)
    const r90 = a.scene.inserts.find((i) => i.handle === expected['blocks_transform.dxf'].inserts[1].handle)!
    close(r90.rotationDeg, 90, 1e-9)
  })

  it('blok içindeki 0 katmanı referansın katmanını alır', () => {
    for (const e of a.scene.entities.filter((x) => x.insert >= 0)) expect(e.layer).toBe('DOGRAMA')
  })

  it('ölçeklenmiş blokta dikdörtgen ölçüsü dönüşümle birlikte değişir', () => {
    const ins = a.scene.inserts.find((i) => i.handle === expected['blocks_transform.dxf'].inserts[2].handle)!
    const rect = a.scene.entities.slice(ins.firstEntity, ins.endEntity).find((e) => e.rect)!
    close(rect.rect!.w, 2400, 1e-9)
    close(rect.rect!.h, 1500, 1e-9)
  })

  it('MINSERT dizisi tüm hücreleriyle açılır', () => {
    const m = analyze('minsert.dxf')
    expect(m.scene.inserts.length).toBe(expected['minsert.dxf'].instances)
    const bb = m.scene.bbox!
    for (let i = 0; i < 4; i++) close(bb[i], expected['minsert.dxf'].bbox[i], 1e-9)
  })
})

describe('İç içe bloklar', () => {
  const a = analyze('nested_blocks.dxf')
  const exp = expected['nested_blocks.dxf']

  it('iki seviyeli blok doğru dünya koordinatlarına açılır', () => {
    const rect = a.scene.entities.find((e) => e.type === 'LWPOLYLINE')!
    const pts: number[][] = []
    for (let i = 0; i < rect.count; i++) pts.push([a.scene.coords[rect.start + 2 * i], a.scene.coords[rect.start + 2 * i + 1]])
    expect(pts.length).toBe(4)
    for (let i = 0; i < 4; i++) {
      close(pts[i][0], exp.inner_rect_world[i][0], 1e-9)
      close(pts[i][1], exp.inner_rect_world[i][1], 1e-9)
    }
    close(rect.rect!.w * rect.rect!.h, exp.inner_rect_size[0] * exp.inner_rect_size[1], 1e-9)
    const ins = a.scene.inserts.find((i) => i.depth === 2)!
    expect(ins.parent).toBeGreaterThanOrEqual(0)
  })

  it('katman ve BYBLOCK renk zincir boyunca miras alınır; sabit katman korunur', () => {
    const rect = a.scene.entities.find((e) => e.type === 'LWPOLYLINE')!
    expect(rect.layer).toBe(exp.inner_rect_layer)
    expect(rect.rgb).toBe(exp.inner_rect_rgb)
    const line = a.scene.entities.find((e) => e.type === 'LINE' && e.layer === 'SABIT')
    expect(line).toBeTruthy()
  })

  it('sahne sınırı ezdxf ile aynı', () => {
    for (let i = 0; i < 4; i++) close(a.scene.bbox![i], exp.bbox[i], 1e-9)
  })

  it('döngüsel blok referansı sonsuz döngüye girmeden raporlanır', () => {
    const c = analyze('cycle.dxf')
    expect(c.report.warnings.some((w) => w.code === 'block-cycle')).toBe(true)
    expect(c.scene.entities.length).toBeGreaterThan(0)
  })
})

describe('Nesne türleri ve ölçüler', () => {
  const a = analyze('entities.dxf')
  const exp = expected['entities.dxf']
  const find = (pred: (e: SceneEntity) => boolean) => a.scene.entities.find(pred)!

  it('LINE uzunluğu', () => close(find((e) => e.type === 'LINE' && e.layer === 'CIZGI').length!, exp.line_length))

  it('bulge ile kemerli pencere: alan ve çevre analitik', () => {
    const k = find((e) => e.layer === 'KEMER')
    expect(k.exact).toBe(true)
    close(k.area!, exp.kemer_area, 1e-12)
    close(k.length!, exp.kemer_perimeter, 1e-12)
    expect(k.rect).toBeUndefined()
  })

  it('ARC, CIRCLE, ELLIPSE ölçüleri', () => {
    close(find((e) => e.type === 'ARC').length!, exp.arc_length, 1e-12)
    const c = find((e) => e.type === 'CIRCLE')
    close(c.area!, exp.circle_area, 1e-12)
    close(c.length!, exp.circle_length, 1e-12)
    expect(c.circle![2]).toBe(250)
    const el = find((e) => e.type === 'ELLIPSE')
    close(el.area!, exp.ellipse_area, 1e-9)
    expect(el.exact).toBe(false)
  })

  it('SPLINE çizilir ve yaklaşık olarak işaretlenir', () => {
    const s = find((e) => e.type === 'SPLINE')
    expect(s.count).toBeGreaterThan(10)
    expect(s.exact).toBe(false)
  })

  it('Türkçe TEXT ve biçim kodlu MTEXT doğru okunur', () => {
    expect(find((e) => e.type === 'TEXT').text!.value).toBe(exp.text)
    expect(find((e) => e.type === 'MTEXT').text!.value).toBe(exp.mtext)
  })

  it('DIMENSION ölçü değeri ve elle değiştirilmiş metin ayırt edilir', () => {
    const dims = byType(a, 'DIMENSION').filter((e) => e.kind === 'group')
    expect(dims.length).toBe(2)
    const normal = dims.find((d) => !d.dim!.override)!
    close(normal.dim!.measurement!, exp.dim_measurement)
    // Stil katsayısı (DIMLFAC=100): görünen metin geometriden farklıdır; ikisi ayrı saklanır
    expect(normal.dim!.displayedValues).toContain(exp.dim_displayed_value)
    const over = dims.find((d) => d.dim!.override)!
    close(over.dim!.measurement!, exp.dim_measurement)
    expect(over.dim!.displayed).toBe(exp.dim_override_text)
  })

  it('HATCH: delikli alan ve yaylı kenar sınırı', () => {
    const hatches = byType(a, 'HATCH').filter((e) => e.kind === 'group')
    expect(hatches.length).toBe(2)
    const holed = hatches.find((h) => h.hatch!.loops === 2)!
    close(holed.area!, exp.hatch_area_with_hole, 1e-12)
    const edge = hatches.find((h) => h.hatch!.loops === 1)!
    // Yay parçalı yaklaşık: 2.5° adımla bağıl hata < 1e-3
    close(edge.area!, exp.hatch_edge_area, 1e-3)
    expect(edge.exact).toBe(false)
  })

  it('desteklenmeyen nesneler sessizce atlanmaz, raporda listelenir', () => {
    for (const t of exp.unsupported) {
      const c = a.report.counts.find((x) => x.type === t)!
      expect(c.level).toBe('desteklenmiyor')
      expect(c.drawn).toBe(0)
      expect(a.report.warnings.some((w) => w.code === `unsupported:${t}`)).toBe(true)
    }
  })

  it('kağıt alanı nesneleri model görünümüne alınmaz ve raporlanır', () => {
    expect(a.report.paperSpaceSkipped).toBe(exp.paper_space_skipped)
  })

  it('POINT, SOLID ve LEADER çizilir', () => {
    // Ölçü bloklarındaki tanım noktaları ölçüye aittir; bağımsız nokta yalnızca bir tane
    expect(byType(a, 'POINT').filter((e) => e.owner === -1).length).toBe(1)
    close(find((e) => e.type === 'SOLID').area!, 1000 * 1000)
    expect(byType(a, 'LEADER').length).toBe(1)
  })
})

describe('Karakter kodlaması', () => {
  it('ANSI_1254 (Türkçe) kod sayfası', () => {
    const a = analyze('encoding_cp1254.dxf')
    const t = a.scene.entities.find((e) => e.type === 'TEXT')!
    expect(t.text!.value).toBe(expected['encoding_cp1254.dxf'].text)
    expect(t.layer).toBe(expected['encoding_cp1254.dxf'].layer)
    expect(a.report.encoding).toBe('windows-1254')
  })

  it('yanlış etiketli (ANSI_1252) Türkçe dosya düzeltilir ve uyarı verilir', () => {
    const a = analyze('encoding_cp1254_mislabeled.dxf')
    const t = a.scene.entities.find((e) => e.type === 'TEXT')!
    expect(t.text!.value).toBe(expected['encoding_cp1254_mislabeled.dxf'].text)
    expect(a.report.warnings.some((w) => w.code === 'encoding-fixed')).toBe(true)
  })
})

describe('Bozuk ve desteklenmeyen dosyalar', () => {
  const expectCode = (name: string, code: string) => {
    try {
      analyze(name)
    } catch (e) {
      expect(e).toBeInstanceOf(CadAnalysisError)
      expect((e as CadAnalysisError).code).toBe(code)
      return
    }
    throw new Error(`${name} hata vermeliydi`)
  }

  it('DWG dosyası okunuyormuş gibi davranılmaz; sürüm bilgisiyle reddedilir', () => {
    try {
      analyze('fake.dwg')
      throw new Error('hata bekleniyordu')
    } catch (e) {
      expect((e as CadAnalysisError).code).toBe('dwg')
      expect((e as CadAnalysisError).detail).toContain('AC1032')
      expect((e as CadAnalysisError).detail).toContain('2018')
    }
  })
  it('ikili DXF reddedilir', () => expectCode('binary.dxf', 'dxf-binary'))
  it('DXF olmayan içerik reddedilir', () => expectCode('not_cad.dxf', 'unknown'))
  it('bozuk grup kodu sözdizimi hatası verir', () => expectCode('corrupt_badcode.dxf', 'syntax'))
  it('boş dosya reddedilir', () => {
    expect(() => analyzeDxfBytes(new Uint8Array())).toThrow(CadAnalysisError)
  })

  it('yarıda kesilmiş dosya: ya sözdizimi hatası ya da "eksik dosya" uyarısı — asla sessiz başarı değil', () => {
    try {
      const a = analyze('corrupt_truncated.dxf')
      expect(a.report.warnings.some((w) => w.code === 'parse:no-eof')).toBe(true)
    } catch (e) {
      expect((e as CadAnalysisError).code).toBe('syntax')
    }
  })
})
