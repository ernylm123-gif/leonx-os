import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { analyzeDxfBytes } from './analyze'
import { attrDimMm, collectAttributes, detectDxf } from './dxfSemantic'
import type { PdfPozCandidate } from './pdf/archAnalyze'

const load = (n: string) => analyzeDxfBytes(new Uint8Array(readFileSync(`src/cad/__fixtures__/${n}.dxf`)))
const exp = (n: string) => JSON.parse(readFileSync(`src/cad/__fixtures__/${n}.expected.json`, 'utf8'))
const run = (n: string) => {
  const a = load(n)
  const mm = a.report.units.mmPerUnit
  return { a, r: detectDxf(a.scene, { mmPerUnit: mm, unitsVerified: mm != null, paper: a.paper }) }
}
const conflictsOf = (c: { reasons: string[] } & Partial<PdfPozCandidate>) => [...(c.conflicts ?? []).map((x) => x.kind), ...c.reasons.filter((r) => r.startsWith('Çelişki')).map(() => 'olcu')]

describe('DXF blok öznitelikleri (ATTRIB)', () => {
  it('öznitelikten poz, adet, ölçü, iş grubu ve teknik özellik; tip/malzeme blok adının önüne geçer', () => {
    const e = exp('cad_oznitelik_bloklar')
    const { r } = run('cad_oznitelik_bloklar')
    const m = new Map(r.candidates.map((c) => [c.code, c]))
    expect([...m.keys()].sort()).toEqual(Object.keys(e.pozlar).sort())
    for (const [code, x] of Object.entries<Record<string, unknown>>(e.pozlar)) {
      const c = m.get(code)! as PdfPozCandidate
      expect([c.count, c.width_mm, c.height_mm], code).toEqual([x.adet, x.w, x.h])
      if (x.kategori) expect(c.category, code).toBe(x.kategori)
      if (x.malzeme) expect(c.attrs?.malzeme, code).toMatchObject({ value: x.malzeme, status: 'dogrulandi' })
      if (x.sistem) expect(c.attrs?.sistem?.value, code).toBe(x.sistem)
      if (x.celiski) expect(conflictsOf(c), code).toContain(x.celiski)
    }
    // K1 bloğunun adı "PENCERE_GENEL" ama özniteliği KAPI: kapı olarak sınıflanır ve kanıt yazılır
    expect(m.get('K1')!.evidence.join(' ')).toMatch(/blok özniteliğinden/)
  })

  it('öznitelik ölçü birimi: etikette yazıyorsa o; yoksa geometriyle eşleşen; o da yoksa varsayım olarak işaretlenir', () => {
    expect(attrDimMm(110, 'cm', null)).toEqual({ mm: 1100, how: 'etiket' })
    expect(attrDimMm(120, null, 1200)).toEqual({ mm: 1200, how: 'geometri' })
    expect(attrDimMm(1.2, null, 1200)).toEqual({ mm: 1200, how: 'geometri' })
    expect(attrDimMm(120, null, null)).toEqual({ mm: 1200, how: 'varsayim' })
    expect(attrDimMm(1200, null, null)).toEqual({ mm: 1200, how: 'varsayim' })
  })

  it('öznitelikler poz koduna göre toplanır (P-01 = P1); boş değerler yok sayılır', () => {
    const g = collectAttributes(load('cad_oznitelik_bloklar').scene)
    expect(g.get('P1')!.inserts).toHaveLength(2)
    expect(g.get('P5')!.unit).toBe('cm')
  })
})

describe('DXF kâğıt uzayı (layout)', () => {
  it('layout ayrı pafta olarak okunur: çizelge adedi ve malzeme plana bağlanır', () => {
    const e = exp('cad_kagit_uzayi_cizelge')
    const { a, r } = run('cad_kagit_uzayi_cizelge')
    expect(a.paper).toHaveLength(e.layout_sayisi)
    expect(a.report.paperSpaceSkipped).toBeGreaterThan(0) // model görünümünde gösterilmez, analizde okunur
    const p1 = r.candidates.find((c) => c.code === 'P1') as PdfPozCandidate
    const x = e.pozlar.P1
    expect([p1.count, p1.width_mm, p1.height_mm, p1.category, p1.scheduleQty]).toEqual([x.adet, x.w, x.h, x.kategori, x.cizelge])
    expect(p1.attrs.malzeme?.value).toBe(x.malzeme)
    expect(p1.evidence.join(' ')).toMatch(/kâğıt uzayı/)
    // kâğıt uzayındaki nesne kimlikleri model görünümünde işaretlenmez
    expect(p1.instances.every((i) => (i.page ?? 1) === 1)).toBe(true)
    expect(r.semantic.pages).toHaveLength(2)
  })

  it('kâğıt uzayı olmayan çizimde ek pafta oluşmaz', () => {
    expect(load('mimari_plan_cizelge').paper).toEqual([])
  })
})
