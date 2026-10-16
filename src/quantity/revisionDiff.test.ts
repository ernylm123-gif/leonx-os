import { describe, expect, it } from 'vitest'
import type { CostRate } from '@/finance/types'
import type { QuoteItem } from '@/quote/types'
import { diffRevisions } from './revisionDiff'
import { emptyItem, type QuantityItem, type QuantityItemInput } from './types'

let n = 0
const it_ = (p: Partial<QuantityItemInput>): QuantityItem => ({
  ...emptyItem({ category: 'pvc_pencere', verification: 'onaylandi', ...p }),
  id: `i${++n}`,
  takeoff_id: 't',
  project_id: 'p',
  created_by: null,
  created_at: '',
  updated_at: '',
  version: 1,
})

const rate = (p: Partial<CostRate>): CostRate =>
  ({
    id: `r${++n}`,
    code: 'PVC-M2',
    name: 'PVC pencere m²',
    cost_group: 'malzeme',
    unit: 'm2',
    currency: 'TRY',
    unit_cost: 2500,
    quantity_category: 'pvc_pencere',
    valid_from: '2026-01-01',
    active: true,
    notes: null,
    version: 1,
    created_at: '',
    updated_at: '',
    created_by: null,
    ...p,
  }) as CostRate

const OLD = [
  it_({ poz_code: 'P-01', width_mm: 1200, height_mm: 1500, quantity: 6 }),
  it_({ poz_code: 'P2', width_mm: 800, height_mm: 1200, quantity: 3 }),
  it_({ poz_code: 'K1', category: 'al_kapi', width_mm: 900, height_mm: 2100, quantity: 4 }),
  it_({ poz_code: 'S1', category: 'surme', width_mm: 3000, height_mm: 2400, quantity: 2 }),
]
const NEW = [
  it_({ poz_code: 'P1', width_mm: 1300, height_mm: 1500, quantity: 6 }),
  it_({ poz_code: 'P2', width_mm: 800, height_mm: 1200, quantity: 3 }),
  it_({ poz_code: 'P3', width_mm: 1000, height_mm: 1000, quantity: 3 }),
  it_({ poz_code: 'S1', category: 'surme', width_mm: 3000, height_mm: 2400, quantity: 2 }),
]

describe('metraj revizyon karşılaştırması', () => {
  it('eklenen, silinen, değişen ve aynı pozlar (P-01 = P1 eşleşir)', () => {
    const d = diffRevisions(OLD, NEW)
    const st = Object.fromEntries(d.rows.map((r) => [r.poz, r.status]))
    expect(st).toEqual({ P1: 'degisen', P3: 'eklenen', K1: 'silinen', P2: 'ayni', S1: 'ayni' })
    expect(d.counts).toEqual({ eklenen: 1, silinen: 1, degisen: 1, ayni: 2 })
    expect(d.rows.find((r) => r.poz === 'P1')!.changes).toEqual(['En 1200 mm → 1300 mm'])
  })

  it('metraj farkı motorun tamsayı sonuçlarıyla: P1 (1,30−1,20)×1,50×6 = 0,90 m²', () => {
    const d = diffRevisions(OLD, NEW)
    const p1 = d.rows.find((r) => r.poz === 'P1')!
    expect(p1.deltaUnit).toBe('m2')
    expect(p1.deltaCenti).toBe(90)
    expect(d.rows.find((r) => r.poz === 'P3')!.deltaCenti).toBe(300) // 1×1×3
    expect(d.rows.find((r) => r.poz === 'K1')!.deltaCenti).toBe(-756) // 0,9×2,1×4 = 7,56
  })

  it('maliyet farkı yalnız katalog fiyatıyla; fiyatı olmayan satır uydurulmaz ve toplama girmez', () => {
    const d = diffRevisions(OLD, NEW, { rates: [rate({})], today: '2026-10-15' })
    const p1 = d.rows.find((r) => r.poz === 'P1')!
    expect(p1.costDelta).toEqual([{ currency: 'TRY', cents: 225_000 }]) // 0,90 m² × 2.500 TL
    expect(d.rows.find((r) => r.poz === 'P3')!.costDelta).toEqual([{ currency: 'TRY', cents: 750_000 }])
    const k1 = d.rows.find((r) => r.poz === 'K1')!
    expect(k1.costMissing).toBe(true) // al_kapi için katalog fiyatı yok
    expect(k1.costDelta).toEqual([])
    expect(d.unpricedCost).toBe(1)
    expect(d.costTotals).toEqual([{ currency: 'TRY', cents: 975_000 }])
  })

  it('farklı para birimleri toplanmaz', () => {
    const d = diffRevisions(OLD, NEW, { rates: [rate({}), rate({ code: 'KAPI', quantity_category: 'al_kapi', unit: 'adet', currency: 'EUR', unit_cost: 400 })], today: '2026-10-15' })
    expect(d.costTotals).toEqual(
      expect.arrayContaining([
        { currency: 'TRY', cents: 975_000 },
        { currency: 'EUR', cents: -160_000 },
      ]),
    )
    expect(d.costTotals).toHaveLength(2)
  })

  it('geleceğe tarihli veya pasif katalog kaydı kullanılmaz', () => {
    const d = diffRevisions(OLD, NEW, { rates: [rate({ valid_from: '2027-01-01' })], today: '2026-10-15' })
    expect(d.costTotals).toEqual([])
    expect(d.unpricedCost).toBe(3)
  })

  it('teklif farkı teklif kaleminin birim fiyatıyla; teklifte olmayan poz işaretlenir', () => {
    const qi = { poz_code: 'P01', unit: 'm2', quantity: 6, width_mm: 1200, height_mm: 1500, dim_unit: 'mm', manual_measure: null, unit_price: 4000, material_cost: 0, labor_cost: 0, install_cost: 0, other_cost: 0, measure_verified: true } as unknown as QuoteItem
    const d = diffRevisions(OLD, NEW, { quote: { currency: 'TRY', params: { waste_pct: 0, overhead_pct: 0, profit_pct: 0, pricing_mode: 'detayli' }, items: [qi] } })
    expect(d.rows.find((r) => r.poz === 'P1')!.quoteDelta).toEqual({ currency: 'TRY', cents: 360_000 }) // 0,90 × 4.000
    expect(d.rows.find((r) => r.poz === 'P3')!.quoteMissing).toBe(true)
    expect(d.quoteTotal).toEqual({ currency: 'TRY', cents: 360_000 })
    expect(d.unpricedQuote).toBe(2)
  })

  it('reddedilen pozlar karşılaştırmaya girmez; kat/mahal ayrı anahtardır', () => {
    const a = [it_({ poz_code: 'P1', floor: '1. Kat', width_mm: 1000, height_mm: 1000 }), it_({ poz_code: 'P9', verification: 'reddedildi', width_mm: 1000, height_mm: 1000 })]
    const b = [it_({ poz_code: 'P1', floor: '1. KAT', width_mm: 1000, height_mm: 1000 }), it_({ poz_code: 'P1', floor: '2. Kat', width_mm: 1000, height_mm: 1000 })]
    const d = diffRevisions(a, b)
    expect(d.rows.map((r) => [r.poz, r.where, r.status])).toEqual([
      ['P1', '2. Kat', 'eklenen'],
      ['P1', '1. KAT', 'ayni'], // yeni sürümün yazımı gösterilir
    ])
  })

  it('birim değişirse fark alınmaz', () => {
    const d = diffRevisions([it_({ poz_code: 'X1', category: 'korkuluk', width_mm: 3000, unit: 'mtul' })], [it_({ poz_code: 'X1', category: 'pvc_pencere', width_mm: 1000, height_mm: 1000 })])
    expect(d.rows[0].deltaCenti).toBeNull()
  })
})
