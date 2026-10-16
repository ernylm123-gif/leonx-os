import { describe, expect, it } from 'vitest'
import { type ScoredCandidate, compareFormats, pozDiffTable } from './metrics'

const c = (code: string, w: number | null, h: number | null, count: number, extra: Partial<ScoredCandidate> = {}): ScoredCandidate => ({
  code,
  width_mm: w,
  height_mm: h,
  count,
  category: 'al_pencere',
  level: 'orta',
  ...extra,
})

describe('metraj farkı tablosu', () => {
  it('doğru / farklı / eksik / fazla satırları ve alan farkı', () => {
    const rows = pozDiffTable(
      [c('P-01', 1200, 1500, 4), c('P2', 800, 1200, 2), c('X9', 500, 500, 1, { level: 'dusuk' })],
      [
        { code: 'P01', width_mm: 1200, height_mm: 1500, count: 4 },
        { code: 'P2', width_mm: 800, height_mm: 1200, count: 3 },
        { code: 'K1', width_mm: 900, height_mm: 2100, count: 1 },
      ],
    )
    const by = Object.fromEntries(rows.map((r) => [r.kod, r]))
    expect(by.P01.durum).toBe('dogru')
    expect(by.P01.alanFarkM2).toBe(0)
    expect(by.P2.durum).toBe('farkli')
    expect(by.P2.notlar).toEqual(['adet 2 (beklenen 3)'])
    expect(by.P2.alanFarkM2).toBe(-0.96)
    expect(by.K1.durum).toBe('eksik')
    expect(by.X9.durum).toBe('fazla')
  })

  it('ölçüsü bilinmeyen adayda alan farkı hesaplanmaz (uydurulmaz)', () => {
    const [r] = pozDiffTable([c('P1', null, null, 2)], [{ code: 'P1', width_mm: 1000, height_mm: 1000, count: 2 }])
    expect(r.durum).toBe('farkli')
    expect(r.alanFarkM2).toBeNull()
  })
})

describe('biçimler arası uyum (PDF ↔ DWG/DXF)', () => {
  it('ortak pozlar, yalnız bir biçimde olanlar ve farklar', () => {
    const r = compareFormats([c('P1', 1200, 1500, 4), c('P2', 800, 1200, 2), c('K1', 900, 2100, 1)], [c('P-1', 1200, 1500, 4), c('P2', 800, 1200, 3), c('S1', 2000, 2200, 1)])
    expect(r.ortak).toBe(2)
    expect(r.yalnizA).toEqual(['K1'])
    expect(r.yalnizB).toEqual(['S1'])
    expect(r.farklar).toEqual(['P2: adet 2 ↔ 3'])
    // birleşim 4 poz, birebir aynı olan yalnız P1
    expect(r.uyum).toBe(0.25)
  })
})
