import { describe, expect, it } from 'vitest'
import { computeItem } from '@/quantity/engine'
import { emptyItem } from '@/quantity/types'
import type { QuantityItem } from '@/quantity/types'
import { computeQuote, computeQuoteItem, emptyQuoteItem, type QuoteCalcParams } from './engine'
import { quantityToQuoteItems } from './fromQuantity'
import { formatMoney, fromMm, mulDiv, parseMoneyInput, toBp, toCents, toMm } from './money'
import type { QuoteItemInput } from './types'

const P: QuoteCalcParams = {
  pricing_mode: 'detayli',
  lump_sum: null,
  lump_cost: null,
  waste_pct: 0,
  overhead_pct: 0,
  profit_pct: 0,
  shipping_amount: 0,
  other_amount: 0,
  discount_kind: 'yok',
  discount_value: 0,
  vat_pct: 20,
}
const item = (o: Partial<QuoteItemInput>): QuoteItemInput => ({ ...emptyQuoteItem(), description: 'x', ...o })

describe('birim dönüşümleri', () => {
  it('mm, cm ve m hatasız milimetreye çevrilir', () => {
    expect(toMm(1500, 'mm')).toBe(1500)
    expect(toMm(150, 'cm')).toBe(1500)
    expect(toMm(1.5, 'm')).toBe(1500)
    expect(toMm(0.1, 'm')).toBe(100) // 0.1 × 1000 kayan nokta hatası yok
    expect(toMm(33.33, 'cm')).toBe(333.3)
    expect(toMm(1.2345, 'm')).toBe(1234.5)
    expect(fromMm(1500, 'm')).toBe(1.5)
    expect(fromMm(1234.5, 'cm')).toBe(123.45)
  })

  it('para ve yüzde girişleri tamsayıya çevrilir', () => {
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(1.005)).toBe(101)
    expect(toBp(20)).toBe(2000)
    expect(toBp(12.5)).toBe(1250)
    expect(parseMoneyInput('12.500,50')).toBe(1_250_050)
    expect(parseMoneyInput('1250,5')).toBe(125_050)
    expect(parseMoneyInput('-5')).toBeNull()
    expect(parseMoneyInput('abc')).toBeNull()
    expect(mulDiv(5, 1, 10)).toBe(1) // 0,5 → yarım yukarı
    expect(mulDiv(4, 1, 10)).toBe(0)
  })

  it('para birimi biçimi (TRY, EUR, USD)', () => {
    const n = (s: string) => s.replace(/\s/g, ' ')
    expect(n(formatMoney(1_234_567, 'TRY'))).toMatch(/12\.345,67/)
    expect(formatMoney(100, 'TRY')).toContain('₺')
    expect(formatMoney(100, 'EUR')).toContain('€')
    expect(formatMoney(100, 'USD')).toContain('$')
  })
})

describe('kalem miktarı', () => {
  it('1500 mm × 2000 mm × 4 adet = 12 m²', () => {
    const c = computeQuoteItem(item({ unit: 'm2', width_mm: 1500, height_mm: 2000, quantity: 4, unit_price: 1000 }), P)
    expect(c.unitMeasure).toBe(3000)
    expect(c.qty).toBe(12_000)
    expect(c.lineTotal).toBe(1_200_000) // 12 m² × 1000,00
  })

  it('cm ve m ile girilen ölçü aynı sonucu verir', () => {
    const a = computeQuoteItem(item({ unit: 'm2', width_mm: toMm(150, 'cm'), height_mm: toMm(200, 'cm'), quantity: 4, unit_price: 1000 }), P)
    const b = computeQuoteItem(item({ unit: 'm2', width_mm: toMm(1.5, 'm'), height_mm: toMm(2, 'm'), quantity: 4, unit_price: 1000 }), P)
    expect(a.qty).toBe(12_000)
    expect(b.qty).toBe(12_000)
  })

  it('birim alan 3 ondalığa yuvarlanır, satır = birim × adet', () => {
    // 1234 × 987 = 1,217958 m² → 1,218 · × 3 = 3,654 m²
    const c = computeQuoteItem(item({ unit: 'm2', width_mm: 1234, height_mm: 987, quantity: 3, unit_price: 100 }), P)
    expect(c.unitMeasure).toBe(1218)
    expect(c.qty).toBe(3654)
    expect(c.lineTotal).toBe(36_540)
  })

  it('mtül: En uzunluk kabul edilir; birim ölçü girilirse o kullanılır', () => {
    expect(computeQuoteItem(item({ unit: 'mtul', width_mm: 12_500, quantity: 2, unit_price: 900 }), P).qty).toBe(25_000)
    expect(computeQuoteItem(item({ unit: 'mtul', manual_measure: 7.25, quantity: 1, unit_price: 900 }), P).qty).toBe(7250)
  })

  it('adet, takım, götürü: miktar = adet; ondalık adet desteklenir', () => {
    expect(computeQuoteItem(item({ unit: 'adet', quantity: 3, unit_price: 50 }), P).lineTotal).toBe(15_000)
    expect(computeQuoteItem(item({ unit: 'kg', quantity: 12.345, unit_price: 10 }), P).lineTotal).toBe(12_345)
    expect(computeQuoteItem(item({ unit: 'goturu', quantity: 1, unit_price: 25_000 }), P).lineTotal).toBe(2_500_000)
  })

  it('eksik ölçü ve sıfır adet hata verir, toplama katılmaz', () => {
    const a = computeQuoteItem(item({ unit: 'm2', width_mm: 1000, quantity: 1, unit_price: 100 }), P)
    expect(a.ok).toBe(false)
    expect(a.lineTotal).toBe(0)
    const b = computeQuoteItem(item({ unit: 'adet', quantity: 0, unit_price: 100 }), P)
    expect(b.ok).toBe(false)
  })

  it('düzensiz şekil: birim ölçü (metraj alanı) En × Boy yerine kullanılır', () => {
    const c = computeQuoteItem(item({ unit: 'm2', width_mm: 2000, height_mm: 2000, manual_measure: 3.142, quantity: 2, unit_price: 100 }), P)
    expect(c.unitMeasure).toBe(3142)
    expect(c.qty).toBe(6284)
  })
})

describe('maliyet, kâr, indirim, KDV', () => {
  it('fire yalnızca malzemeye, genel gider ve kâr maliyet üzerine uygulanır', () => {
    // malzeme 1000, fire %5 → 1050; +işçilik 200 + montaj 150 = 1400 doğrudan
    // genel gider %10 → 1540; kâr oranı %25 → 1925,00 birim fiyat
    const p = { ...P, waste_pct: 5, overhead_pct: 10, profit_pct: 25 }
    const c = computeQuoteItem(item({ unit: 'adet', quantity: 2, material_cost: 1000, labor_cost: 200, install_cost: 150 }), p)
    expect(c.unitDirectCost).toBe(140_000)
    expect(c.unitPrice).toBe(192_500)
    expect(c.lineTotal).toBe(385_000)
    expect(c.lineDirectCost).toBe(280_000)
    expect(c.lineOverhead).toBe(28_000)
    expect(c.lineProfit).toBe(77_000)
  })

  it('kâr oranı (maliyet üzerine) ve kâr marjı (satış içinde) ayrı hesaplanır', () => {
    // maliyet 1000, kâr oranı %25 → satış 1250; kâr 250 → oran %25, marj %20
    const t = computeQuote({ ...P, profit_pct: 25, vat_pct: 0 }, [item({ unit: 'adet', quantity: 1, material_cost: 1000 })])
    expect(t.net).toBe(125_000)
    expect(t.totalCost).toBe(100_000)
    expect(t.profit).toBe(25_000)
    expect(t.markupBp).toBe(2500)
    expect(t.marginBp).toBe(2000)
  })

  it('elle birim fiyat maliyetten bağımsızdır; kâr gerçek farktan hesaplanır', () => {
    const t = computeQuote({ ...P, profit_pct: 50, vat_pct: 0 }, [item({ unit: 'adet', quantity: 1, material_cost: 800, unit_price: 1000 })])
    expect(t.net).toBe(100_000)
    expect(t.profit).toBe(20_000)
    expect(t.items[0].manualPrice).toBe(true)
  })

  it('yüzde indirim, tutar indirim, KDV ve genel toplam', () => {
    const items = [item({ unit: 'm2', width_mm: 1500, height_mm: 2000, quantity: 4, unit_price: 1000 })] // 12.000,00
    const pct = computeQuote({ ...P, discount_kind: 'yuzde', discount_value: 10, shipping_amount: 500 }, items)
    expect(pct.subtotal).toBe(1_250_000)
    expect(pct.discount).toBe(125_000)
    expect(pct.net).toBe(1_125_000)
    expect(pct.vat).toBe(225_000)
    expect(pct.grandTotal).toBe(1_350_000)
    const amt = computeQuote({ ...P, discount_kind: 'tutar', discount_value: 999_999, vat_pct: 10 }, items)
    expect(amt.discount).toBe(1_200_000) // ara toplamı aşamaz
    expect(amt.net).toBe(0)
    expect(amt.grandTotal).toBe(0)
  })

  it('KDV oranı değiştirilebilir (%0, %1, %10, %20)', () => {
    const items = [item({ unit: 'adet', quantity: 1, unit_price: 1000 })]
    expect([0, 1, 10, 20].map((v) => computeQuote({ ...P, vat_pct: v }, items).vat)).toEqual([0, 1000, 10_000, 20_000])
  })

  it('yuvarlama: satırlar toplamı = ara toplam, KDV tek seferde yuvarlanır', () => {
    const items = Array.from({ length: 7 }, (_, i) => item({ unit: 'm2', width_mm: 1111 + i, height_mm: 1333, quantity: 3, unit_price: 1234.56 }))
    const t = computeQuote({ ...P, vat_pct: 20 }, items)
    expect(t.items.reduce((s, c) => s + c.lineTotal, 0)).toBe(t.itemsTotal)
    expect(t.vat).toBe(mulDiv(t.net, 2000, 10_000))
    expect(t.grandTotal).toBe(t.net + t.vat)
    expect(Number.isInteger(t.grandTotal)).toBe(true)
  })

  it('basit teklif: götürü bedel; maliyet girilmediyse kâr bilinmez', () => {
    const t = computeQuote({ ...P, pricing_mode: 'toplam', lump_sum: 250_000, shipping_amount: 5000 }, [item({ unit: 'adet', quantity: 10 })])
    expect(t.subtotal).toBe(25_500_000)
    expect(t.grandTotal).toBe(30_600_000)
    expect(t.profit).toBeNull()
    expect(t.unpricedItems).toBe(0)
    const c = computeQuote({ ...P, pricing_mode: 'toplam', lump_sum: 1000, lump_cost: 800, vat_pct: 0 }, [])
    expect(c.profit).toBe(20_000)
  })

  it('büyük tutarlar tam hesaplanır; gerçek dışı tutar hata verir, sessizce bozulmaz', () => {
    // 50.000 m² × 12.345,67 = 617.283.500,00
    const big = computeQuote({ ...P, vat_pct: 20 }, [item({ unit: 'm2', manual_measure: 50_000, quantity: 1, unit_price: 12_345.67 })])
    expect(big.itemsTotal).toBe(61_728_350_000)
    expect(big.grandTotal).toBe(74_074_020_000)
    expect(Number.isSafeInteger(big.grandTotal)).toBe(true)
    const absurd = computeQuote(P, [item({ unit: 'm2', manual_measure: 99_999, quantity: 9999, unit_price: 999_999 })])
    expect(absurd.invalidItems).toBe(1)
    expect(absurd.grandTotal).toBe(0)
    expect(absurd.items[0].errors.join()).toMatch(/çok büyük/)
  })

  it('doğrulanmamış ölçüler ayrıca sayılır ve uyarı verir', () => {
    const t = computeQuote(P, [
      item({ unit: 'adet', quantity: 1, unit_price: 100, measure_verified: false }),
      item({ unit: 'adet', quantity: 1, unit_price: 50 }),
    ])
    expect(t.unverified).toEqual({ items: 1, amount: 10_000 })
    expect(t.items[0].warnings.join()).toMatch(/doğrulanmadı/)
  })
})

describe('metrajdan aktarma', () => {
  const tk = { id: 'tk', revision: 2, name: 'Uygulama' }
  const q = (o: Partial<QuantityItem>): QuantityItem =>
    ({ ...emptyItem(), id: crypto.randomUUID(), takeoff_id: 'tk', project_id: 'p', created_by: null, created_at: '', updated_at: '', version: 1, ...o }) as QuantityItem

  it('dikdörtgen pencere: aynı m², kaynak ve doğrulama durumu aktarılır', () => {
    const src = q({ poz_code: 'P1', category: 'al_pencere', width_mm: 1500, height_mm: 2000, quantity: 4, verification: 'onaylandi' })
    const { items } = quantityToQuoteItems([src], tk)
    const c = computeQuoteItem(items[0], P)
    expect(items[0]).toMatchObject({ poz_code: 'P1', unit: 'm2', source: 'metraj', source_item_id: src.id, measure_verified: true })
    expect(items[0].source_label).toContain('Metraj Rev 2')
    expect(c.qty).toBe(12_000)
    expect(c.qty).toBe((computeItem(src).primary!.centi * 10))
  })

  it('kemerli poz: teklif alanı metraj alanıyla aynı', () => {
    const src = q({ poz_code: 'K1', category: 'al_pencere', shape: 'kemerli', width_mm: 1200, height_mm: 2000, rise_mm: 300, quantity: 2 })
    const r = computeItem(src)
    const { items } = quantityToQuoteItems([src], tk)
    expect(computeQuoteItem(items[0], P).qty).toBe(r.unit.frameArea! * 2)
  })

  it('korkuluk mtül, bekleyen ölçü doğrulanmadı işaretlenir, reddedilen aktarılmaz', () => {
    const { items, skipped } = quantityToQuoteItems(
      [
        q({ poz_code: 'KR', category: 'korkuluk', unit: 'mtul', width_mm: 8400, quantity: 1, verification: 'bekliyor' }),
        q({ poz_code: 'X', category: 'al_pencere', width_mm: 1000, height_mm: 1000, verification: 'reddedildi' }),
      ],
      tk,
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ unit: 'mtul', measure_verified: false })
    expect(computeQuoteItem(items[0], P).qty).toBe(8400)
    expect(skipped[0].poz).toBe('X')
  })
})
