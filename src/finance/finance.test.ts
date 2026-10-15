import { describe, expect, it } from 'vitest'
import { emptyItem, type QuantityItem } from '@/quantity/types'
import { lastMonths, monthlyCashflow } from './cashflow'
import { actualTotals, estimateTotals, lineAmount, overrunStep, pctOf, toPctMilli } from './estimate'
import { fromApprovedTakeoff } from './fromTakeoff'
import { convertCents, type FxRateLike, parseRateInput, pickRate, rateToMicro } from './fx'
import { profitability, ratioBp } from './profit'
import { receivables } from './receivables'
import { summarizeProject } from './summary'
import type { CostRate } from './types'

const TODAY = '2026-10-15'
const rate = (o: Partial<FxRateLike>): FxRateLike => ({ id: o.id ?? crypto.randomUUID(), rate_date: '2026-10-12', from_currency: 'EUR', to_currency: 'TRY', rate: 34.123457, project_id: null, created_at: '2026-10-12T10:00:00Z', ...o })

describe('para ve kur', () => {
  it('satır tutarı tamsayı kuruşla: 12,345 × 1234,56 = 15.240,64 (yarım yukarı)', () => {
    expect(lineAmount(12.345, 1234.56)).toBe(1_524_064)
    expect(lineAmount(3, null)).toBeNull()
    // 10 × (0,1 × 0,1) kayan nokta birikimi olmadan tam 0,10
    let sum = 0
    for (let i = 0; i < 10; i++) sum += lineAmount(0.1, 0.1)!
    expect(sum).toBe(10)
    expect(lineAmount(0.333, 0.03)).toBe(1) // 0,00999 → 0,01
  })

  it('yüzde (3 ondalık) ve kur (6 ondalık) tam sayıya çevrilir', () => {
    expect(toPctMilli(12.345)).toBe(12_345)
    expect(pctOf(1_000_000, 5.125)).toBe(51_250)
    expect(pctOf(1, 50)).toBe(1) // 0,5 kuruş → 1 (yarım yukarı)
    expect(rateToMicro(34.1234567)).toBe(34_123_457)
    expect(convertCents(10_000, rateToMicro(34.123457))).toBe(341_235) // 3412,3457 → 3412,35
    expect(convertCents(-10_000, rateToMicro(34.123457))).toBe(-341_235)
    expect(parseRateInput('34,1234567')).toBe(34.123457)
    expect(parseRateInput('34.5')).toBe(34.5)
    expect(parseRateInput('0')).toBeNull()
    expect(parseRateInput('abc')).toBeNull()
  })

  it('kur seçimi: projeye özel > genel, tarih ≤ işlem günü, ters yön ve girilmemiş kur yok', () => {
    const rates = [
      rate({ id: 'g1', rate_date: '2026-10-12', rate: 34 }),
      rate({ id: 'g2', rate_date: '2026-10-14', rate: 35 }),
      rate({ id: 'p1', rate_date: '2026-10-01', rate: 36.5, project_id: 'P' }),
      rate({ id: 'f', rate_date: '2026-10-20', rate: 99 }),
    ]
    expect(pickRate(rates, 'EUR', 'TRY', TODAY, 'P')?.id).toBe('p1')
    expect(pickRate(rates, 'EUR', 'TRY', TODAY, 'Q')?.id).toBe('g2')
    expect(pickRate(rates, 'EUR', 'TRY', '2026-10-13', 'Q')?.id).toBe('g1')
    expect(pickRate(rates, 'EUR', 'TRY', '2026-10-11', 'Q')).toBeNull()
    expect(pickRate(rates, 'TRY', 'EUR', TODAY, 'P')).toBeNull()
    expect(pickRate(rates, 'USD', 'TRY', TODAY, 'P')).toBeNull()
  })
})

describe('tahmini maliyet toplamları', () => {
  const lines = [
    { cost_group: 'profil' as const, quantity: 12, unit_cost: 1000, currency: 'TRY' as const },
    { cost_group: 'cam' as const, quantity: 1, unit_cost: 100, currency: 'EUR' as const },
    { cost_group: 'montaj' as const, quantity: 4, unit_cost: 250.5, currency: 'TRY' as const },
    { cost_group: 'aksesuar' as const, quantity: 2, unit_cost: null, currency: 'TRY' as const },
  ]

  it('kur yoksa birleşik toplam üretilmez; para birimi bazında ara toplamlar ve eksik kur bildirilir', () => {
    const r = estimateTotals(lines, { fx: { base: 'TRY', rates: [], projectId: 'P' }, date: TODAY, wastePct: 5, overheadPct: 10 })
    expect(r.base).toBeNull()
    expect(r.missingRates).toEqual(['EUR'])
    expect(r.perCurrency.TRY).toMatchObject({ direct: 1_300_200, material: 1_200_000, waste: 60_000, overhead: 136_020, total: 1_496_220, lines: 2 })
    expect(r.perCurrency.EUR).toMatchObject({ direct: 10_000, material: 10_000, waste: 500, overhead: 1_050, total: 11_550 })
    expect(r.unpriced).toBe(1)
    expect(r.amounts).toEqual([1_200_000, 10_000, 100_200, null])
    expect(r.complete).toBe(false)
    expect(r.byGroup.find((g) => g.group === 'cam')?.base).toBeNull()
  })

  it('kur girilince ana birim toplamı: satır çevrilir, fire malzemeye, genel gider toplama', () => {
    const r = estimateTotals(lines, { fx: { base: 'TRY', rates: [rate({})], projectId: 'P' }, date: TODAY, wastePct: 5, overheadPct: 10 })
    // EUR 100,00 × 34,123457 = 3412,35 TRY
    expect(r.base).toEqual({ currency: 'TRY', direct: 1_641_435, material: 1_541_235, waste: 77_062, overhead: 171_850, total: 1_890_347 })
    expect(r.usedRates.EUR?.rate).toBe(34.123457)
    expect(r.complete).toBe(false) // fiyatı tanımlanmamış satır var
    const full = estimateTotals(lines.slice(0, 3), { fx: { base: 'TRY', rates: [rate({})], projectId: 'P' }, date: TODAY, wastePct: 0, overheadPct: 0 })
    expect(full.complete).toBe(true)
    expect(full.base?.total).toBe(1_641_435)
  })

  it('veritabanı bütçe kontrolüyle aynı: 15.240,64 + 12.000 = 27.240,64; aşım basamağı', () => {
    const r = estimateTotals(
      [
        { cost_group: 'iscilik', quantity: 12.345, unit_cost: 1234.56, currency: 'TRY' },
        { cost_group: 'profil', quantity: 12, unit_cost: 1000, currency: 'TRY' },
        { cost_group: 'montaj', quantity: 4, unit_cost: 0, currency: 'TRY' },
      ],
      { fx: { base: 'TRY', rates: [], projectId: 'P' }, date: TODAY, wastePct: 0, overheadPct: 0 },
    )
    expect(r.base?.total).toBe(2_724_064)
    expect(overrunStep(2_810_000, 2_724_064)).toBe(0)
    expect(overrunStep(3_210_000, 2_724_064)).toBe(1)
    expect(overrunStep(2_724_064, 2_724_064)).toBeNull()
    expect(overrunStep(10, 0)).toBeNull()
  })

  it('gerçekleşen gider: KDV ayrı, faturadaki kur, kuru olmayan gider çevrilmez', () => {
    const exp = (o: Partial<Parameters<typeof actualTotals>[0][number]>) => ({ amount: 0, vat_amount: 0, currency: 'TRY' as const, expense_date: TODAY, fx_rate_to_base: null, fx_to_currency: null, ...o })
    const r = actualTotals(
      [
        exp({ amount: 20_000, vat_amount: 4_000 }),
        exp({ amount: 100, currency: 'EUR', fx_rate_to_base: 40, fx_to_currency: 'TRY' }),
        exp({ amount: 10, currency: 'EUR' }),
        exp({ amount: 900_000, currency: 'USD' }),
      ],
      { base: 'TRY', rates: [rate({ rate_date: '2026-10-01', rate: 35 })], projectId: 'P' },
    )
    expect(r.baseNet).toBe(2_000_000 + 400_000 + 35_000)
    expect(r.perCurrency.TRY).toEqual({ net: 2_000_000, vat: 400_000, count: 1 })
    expect(r.unconverted).toBe(1)
    expect(r.missingRates).toEqual(['USD'])
    expect(r.complete).toBe(false)
  })
})

describe('kârlılık', () => {
  it('tahmini kâr, marj (kâr/satış) ve maliyet üzerinden kâr (kâr/maliyet) ayrı; KDV kâra girmez', () => {
    const r = profitability({ saleNet: 10_000_000, vatPct: 20, estimatedCost: 7_500_000, actualCost: 8_000_000, stageClosed: false })
    expect(r.vat).toBe(2_000_000)
    expect(r.saleGross).toBe(12_000_000)
    expect(r.expected).toEqual({ cost: 7_500_000, profit: 2_500_000, marginBp: 2_500, markupBp: 3_333 })
    expect(r.variance).toEqual({ amount: 500_000, bp: 667 })
    expect(r.forecast).toEqual({ cost: 8_000_000, profit: 2_000_000, marginBp: 2_000, markupBp: 2_500 })
    expect(r.realized).toBeNull()
  })

  it('gerçekleşen kâr yalnız kapanmış projede', () => {
    const r = profitability({ saleNet: 10_000_000, vatPct: 20, estimatedCost: 7_500_000, actualCost: 8_000_000, stageClosed: true })
    expect(r.realized).toEqual({ cost: 8_000_000, profit: 2_000_000, marginBp: 2_000, markupBp: 2_500 })
    const noActual = profitability({ saleNet: 10_000_000, vatPct: 20, estimatedCost: 7_500_000, actualCost: null, stageClosed: true })
    expect(noActual.realized).toBeNull()
  })

  it('zarar ve eksik veri', () => {
    const r = profitability({ saleNet: 1_000_000, vatPct: 0, estimatedCost: 1_200_000, actualCost: 0, stageClosed: false })
    expect(r.expected).toEqual({ cost: 1_200_000, profit: -200_000, marginBp: -2_000, markupBp: -1_667 })
    expect(r.forecast?.cost).toBe(1_200_000)
    const none = profitability({ saleNet: null, vatPct: 20, estimatedCost: 1, actualCost: 0, stageClosed: false })
    expect(none.expected).toBeNull()
    expect(none.vat).toBeNull()
    expect(ratioBp(1, 0)).toBeNull()
  })
})

describe('tahsilat (FIFO)', () => {
  const s = (id: string, due: string, amount: number, currency: 'TRY' | 'EUR' = 'TRY', sort = 0) => ({ id, due_date: due, amount, currency, sort_order: sort })
  const c = (id: string, amount: number, schedule_id: string | null = null, currency: 'TRY' | 'EUR' = 'TRY') => ({ id, amount, currency, schedule_id })

  it('bağlanmamış tahsilat en eski vadeden dağıtılır; durumlar', () => {
    const r = receivables([s('A', '2026-10-05', 1000, 'TRY', 1), s('B', '2026-10-17', 2000, 'TRY', 2), s('C', '2026-11-24', 500, 'TRY', 3)], [c('x', 1200)], TODAY)
    expect(r.rows.map((x) => [x.id, x.collected, x.outstanding, x.status])).toEqual([
      ['A', 100_000, 0, 'tahsil_edildi'],
      ['B', 20_000, 180_000, 'kismi'],
      ['C', 0, 50_000, 'bekliyor'],
    ])
    expect(r.perCurrency.TRY).toMatchObject({ planned: 350_000, collected: 120_000, outstanding: 230_000, overdue: 0, unallocated: 0, openCount: 2 })
  })

  it('taksiti aşan bağlı ödeme negatif kalan üretmez; fazlası sıradaki açık taksite, kalan fazlası avans', () => {
    const sched = [s('A', '2026-10-05', 1000, 'TRY', 1), s('D', '2026-10-10', 3000, 'TRY', 4), s('B', '2026-10-17', 2000, 'TRY', 2), s('C', '2026-11-24', 500, 'TRY', 3)]
    const r = receivables(sched, [c('x', 1200), c('y', 2500, 'C')], TODAY)
    expect(r.byId.get('A')).toMatchObject({ collected: 100_000, status: 'tahsil_edildi' })
    expect(r.byId.get('D')).toMatchObject({ collected: 220_000, outstanding: 80_000, status: 'gecikti' })
    expect(r.byId.get('B')).toMatchObject({ collected: 0, outstanding: 200_000, status: 'bekliyor' })
    expect(r.byId.get('C')).toMatchObject({ collected: 50_000, outstanding: 0, status: 'tahsil_edildi' })
    expect(r.perCurrency.TRY).toMatchObject({ overdue: 80_000, overdueCount: 1, outstanding: 280_000, unallocated: 0 })
    const over = receivables([s('A', '2026-10-05', 1000)], [c('x', 1500)], TODAY)
    expect(over.byId.get('A')).toMatchObject({ outstanding: 0 })
    expect(over.perCurrency.TRY?.unallocated).toBe(50_000)
  })

  it('para birimleri karışmaz; silinmiş taksite bağlı tahsilat havuza düşer', () => {
    const r = receivables([s('A', '2026-10-20', 1000, 'TRY'), s('E', '2026-10-20', 100, 'EUR')], [c('x', 50, null, 'EUR'), c('y', 10, 'silinmis', 'TRY')], TODAY)
    expect(r.byId.get('A')).toMatchObject({ collected: 1_000, outstanding: 99_000, status: 'kismi' })
    expect(r.byId.get('E')).toMatchObject({ collected: 5_000, outstanding: 5_000 })
    expect(r.perCurrency.EUR?.collected).toBe(5_000)
  })
})

describe('nakit akışı', () => {
  it('son 6 ay, para birimi bazında; ödenmemiş gider çıkış sayılmaz', () => {
    expect(lastMonths('2026-02-10', 3)).toEqual(['2025-12', '2026-01', '2026-02'])
    const r = monthlyCashflow(
      [
        { received_date: '2026-10-01', amount: 1200, currency: 'TRY' },
        { received_date: '2026-09-30', amount: 50, currency: 'EUR' },
        { received_date: '2025-01-01', amount: 1, currency: 'TRY' },
      ],
      [
        { expense_date: '2026-10-02', amount: 100, vat_amount: 20, currency: 'TRY', paid: true },
        { expense_date: '2026-10-02', amount: 999, vat_amount: 0, currency: 'TRY', paid: false },
      ],
      TODAY,
    )
    expect(r.map((m) => m.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
    expect(r[5].perCurrency.TRY).toEqual({ in: 120_000, out: 12_000 })
    expect(r[4].perCurrency.EUR).toEqual({ in: 5_000, out: 0 })
    expect(r[4].perCurrency.TRY).toBeUndefined()
  })
})

describe('onaylı metrajdan maliyet', () => {
  const item = (o: Partial<QuantityItem>): QuantityItem => ({
    ...emptyItem(),
    id: o.id ?? crypto.randomUUID(),
    takeoff_id: 'T1',
    project_id: 'P',
    created_by: null,
    created_at: '',
    updated_at: '',
    version: 1,
    ...o,
  })
  const costRate = (o: Partial<CostRate>): CostRate => ({
    id: o.id ?? crypto.randomUUID(),
    code: 'X',
    name: 'Kalem',
    cost_group: 'profil',
    unit: 'm2',
    currency: 'TRY',
    unit_cost: 100,
    quantity_category: 'al_pencere',
    valid_from: '2026-01-01',
    active: true,
    notes: null,
    created_by: null,
    created_at: '',
    updated_at: '',
    version: 1,
    ...o,
  })
  const takeoff = { id: 'T1', project_id: 'P', status: 'onaylandi' as const, revision: 2, name: 'Uygulama' }
  const items = [
    item({ id: 'i1', poz_code: 'P1', category: 'al_pencere', width_mm: 1500, height_mm: 2000, quantity: 4, verification: 'onaylandi' }),
    item({ id: 'i2', poz_code: 'P2', category: 'al_pencere', width_mm: 1000, height_mm: 1000, verification: 'bekliyor' }),
    item({ id: 'i3', poz_code: 'P3', category: 'al_pencere', width_mm: 1000, height_mm: 1000, verification: 'reddedildi' }),
    item({ id: 'i4', poz_code: 'KR1', category: 'korkuluk', unit: 'mtul', width_mm: 8400, verification: 'onaylandi' }),
  ]
  const rates = [
    costRate({ id: 'r-prof', code: 'AL-PROF', name: 'Alüminyum profil', unit: 'mtul', unit_cost: 250, cost_group: 'profil' }),
    costRate({ id: 'r-prof-old', code: 'AL-PROF', name: 'Eski fiyat', unit: 'mtul', unit_cost: 1, cost_group: 'profil', valid_from: '2025-01-01' }),
    costRate({ id: 'r-cam', code: 'CAM', name: 'Isıcam', unit: 'm2', unit_cost: 900, cost_group: 'cam', currency: 'EUR' }),
    costRate({ id: 'r-mon', code: 'MON', name: 'Montaj', unit: 'adet', unit_cost: 400, cost_group: 'montaj' }),
    costRate({ id: 'r-gelecek', code: 'GEL', name: 'Gelecek fiyat', unit: 'adet', unit_cost: 5, cost_group: 'aksesuar', valid_from: '2027-01-01' }),
    costRate({ id: 'r-pasif', code: 'PAS', name: 'Pasif', unit: 'adet', unit_cost: 5, cost_group: 'aksesuar', active: false }),
    costRate({ id: 'r-saat', code: 'SAAT', name: 'Usta saati', unit: 'saat', unit_cost: 5, cost_group: 'iscilik' }),
  ]

  it('yalnız onaylı pozlar; katalog fiyatı; çevre bazlı tahmini etiketi; fiyatsız iş sıfır değil boş', () => {
    const r = fromApprovedTakeoff(takeoff, items, rates, [], TODAY)
    expect(r.excluded).toEqual([
      { poz: 'P2', reason: 'Ölçü doğrulaması bekliyor' },
      { poz: 'P3', reason: 'Metrajda reddedilmiş' },
    ])
    const p1 = r.lines.filter((l) => l.poz === 'P1')
    expect(p1.map((l) => [l.cost_group, l.quantity, l.unit, l.unit_cost, l.currency, l.measure_basis])).toEqual([
      ['profil', 28, 'mtul', 250, 'TRY', 'cevre'],
      ['cam', 12, 'm2', 900, 'EUR', 'alan'],
      ['montaj', 4, 'adet', 400, 'TRY', 'adet'],
    ])
    expect(p1.find((l) => l.cost_group === 'profil')?.description).toContain('çevre bazlı tahmini')
    const kr = r.lines.find((l) => l.poz === 'KR1')!
    expect(kr).toMatchObject({ unit_cost: null, needsPrice: true, quantity: 8.4, unit: 'mtul', measure_basis: 'uzunluk', source: 'metraj', source_item_id: 'i4', source_takeoff_id: 'T1' })
    expect(r.lines.every((l) => l.source_takeoff_id === 'T1')).toBe(true)
    expect(r.blockedByTakeoff).toBeNull()
  })

  it('tekrar aktarım önerilmez; başka revizyon aktarılmışsa engellenir; onaysız sürüm hiç aktarılmaz', () => {
    const again = fromApprovedTakeoff(takeoff, items, rates, [{ source: 'metraj', source_item_id: 'i1', source_takeoff_id: 'T1', cost_group: 'montaj' }], TODAY)
    expect(again.alreadyImported).toBe(1)
    expect(again.lines.some((l) => l.key === 'i1:montaj')).toBe(false)
    const blocked = fromApprovedTakeoff(takeoff, items, rates, [{ source: 'metraj', source_item_id: 'eski', source_takeoff_id: 'T0', cost_group: 'profil' }], TODAY)
    expect(blocked.blockedByTakeoff).toBe('T0')
    const draft = fromApprovedTakeoff({ ...takeoff, status: 'taslak' }, items, rates, [], TODAY)
    expect(draft.lines).toEqual([])
    expect(draft.excluded).toHaveLength(4)
    expect(draft.excluded[0].reason).toBe('Metraj sürümü onaylı değil')
  })
})

describe('proje özeti', () => {
  it('kur eksikse tahmini kâr üretilmez; neden açıklanır', () => {
    const budget = { id: 'b', project_id: 'P', currency: 'TRY' as const, sale_net_amount: 50_000, vat_pct: 20, source_quote_id: null, quote_snapshot_net: null, quote_snapshot_currency: null, quote_snapshot_vat_pct: null, quote_snapshot_label: null, quote_snapshot_at: null, waste_pct: 0, overhead_pct: 0, notes: null, created_by: null, created_at: '', updated_at: '', version: 1 }
    const line = { id: 'l', project_id: 'P', sort_order: 0, cost_group: 'cam' as const, description: 'Cam', quantity: 10, unit: 'm2' as const, unit_cost: 100, currency: 'EUR' as const, source: 'elle' as const, source_takeoff_id: null, source_item_id: null, cost_rate_id: null, measure_basis: null, notes: null, created_by: null, created_at: '', updated_at: '', version: 1 }
    const s = summarizeProject({ id: 'P', stage: 'uretimde' }, { budget, lines: [line], expenses: [], schedule: [], collections: [] }, [], TODAY)
    expect(s.estimateIssue).toBe('Kur girilmemiş: EUR→TRY')
    expect(s.profit.expected).toBeNull()
    expect(s.estimate.perCurrency.EUR?.total).toBe(100_000)
    const ok = summarizeProject({ id: 'P', stage: 'teslim_edildi' }, { budget, lines: [line], expenses: [], schedule: [], collections: [] }, [rate({ rate: 35 })], TODAY)
    expect(ok.profit.expected).toEqual({ cost: 3_500_000, profit: 1_500_000, marginBp: 3_000, markupBp: 4_286 })
    expect(ok.profit.realized).toEqual({ cost: 0, profit: 5_000_000, marginBp: 10_000, markupBp: null })
  })
})
