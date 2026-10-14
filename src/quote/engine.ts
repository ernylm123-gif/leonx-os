/**
 * Teklif hesap motoru — miktar, maliyet, satış fiyatı, indirim, KDV ve kâr.
 *
 * Miktar (faturalanan birim)
 *   m²        birim alan = En × Boy (mm → m², 3 ondalık) · miktar = birim alan × adet
 *   mtül / m  birim uzunluk = En (mm → m, 3 ondalık) · miktar = birim uzunluk × adet
 *   adet, takım, kg, götürü  miktar = adet
 *   "Birim ölçü" girilirse (ör. düzensiz şekilli pozun metraj alanı) En × Boy yerine o kullanılır.
 *
 * Maliyet (birim başına)
 *   doğrudan = malzeme × (1 + fire) + işçilik + montaj + diğer
 *   genel gider = doğrudan × genel gider oranı
 * Satış birim fiyatı
 *   elle girildiyse o; değilse doğrudan × (1 + genel gider) × (1 + kâr oranı)
 *   Kâr oranı maliyet üzerine eklenen paydır (markup). Kâr marjı = kâr / net satış. İkisi ayrı gösterilir.
 *
 * Teklif
 *   ara toplam = kalem tutarları + nakliye + diğer giderler   (basit teklifte: götürü bedel + nakliye + diğer)
 *   indirim (yüzde veya tutar) → net → KDV → genel toplam
 *   Nakliye ve diğer giderler müşteriye ayrı satır olarak yansıtılır ve maliyete aynen eklenir.
 */
import { mulDiv, toBp, toCents, toMilliQty } from './money'
import type { Quote, QuoteItemInput, QuoteUnit } from './types'

export interface ItemCalc {
  ok: boolean
  errors: string[]
  warnings: string[]
  /** Birim ölçü (m² veya m), milli; ölçülmeyen birimlerde null */
  unitMeasure: number | null
  /** Faturalanan miktar, milli (m², m veya adet) */
  qty: number
  /** Birim doğrudan maliyet (fire dahil), kuruş */
  unitDirectCost: number
  /** Birim satış fiyatı, kuruş */
  unitPrice: number
  /** Birim fiyat elle mi girildi */
  manualPrice: boolean
  /** Satır tutarı = birim fiyat × miktar, kuruş */
  lineTotal: number
  lineDirectCost: number
  lineOverhead: number
  /** Satır kârı (satış − doğrudan − genel gider) */
  lineProfit: number
}

export interface QuoteCalcParams {
  pricing_mode: Quote['pricing_mode']
  lump_sum: number | null
  lump_cost: number | null
  waste_pct: number
  overhead_pct: number
  profit_pct: number
  shipping_amount: number
  other_amount: number
  discount_kind: Quote['discount_kind']
  discount_value: number
  vat_pct: number
}

export interface QuoteTotals {
  items: ItemCalc[]
  itemsTotal: number
  shipping: number
  other: number
  subtotal: number
  discount: number
  net: number
  vatBp: number
  vat: number
  grandTotal: number
  /** Maliyet (bilinmiyorsa null: basit teklifte maliyet girilmemiş) */
  directCost: number | null
  overheadCost: number | null
  totalCost: number | null
  profit: number | null
  /** Kâr oranı (maliyet üzerine), baz puan */
  markupBp: number | null
  /** Kâr marjı (net satış içindeki pay), baz puan */
  marginBp: number | null
  /** Doğrulanmamış ölçülü kalem sayısı ve tutarı */
  unverified: { items: number; amount: number }
  invalidItems: number
  /** Fiyatı sıfır olan kalemler (detaylı teklifte) */
  unpricedItems: number
}

/** Satır tutarı üst sınırı (kuruş) ve miktar üst sınırı (milli) */
const MAX_LINE_CENTS = 100_000_000_000_000n
const MAX_QTY_MILLI = 100_000_000_000

const MEASURED: Partial<Record<QuoteUnit, 'alan' | 'uzunluk'>> = { m2: 'alan', mtul: 'uzunluk', m: 'uzunluk' }

/** Kalemin birim ölçüsü (milli m² veya milli m) */
function unitMeasureOf(item: Pick<QuoteItemInput, 'unit' | 'width_mm' | 'height_mm' | 'manual_measure'>): { value: number | null; error?: string } {
  const kind = MEASURED[item.unit]
  if (!kind) return { value: null }
  if (item.manual_measure != null) {
    const v = toMilliQty(item.manual_measure)
    return v > 0 ? { value: v } : { value: null, error: 'Birim ölçü sıfırdan büyük olmalı' }
  }
  const w = item.width_mm ?? 0
  if (kind === 'alan') {
    const h = item.height_mm ?? 0
    if (!(w > 0) || !(h > 0)) return { value: null, error: 'm² için En ve Boy (veya birim ölçü) girin' }
    // dmm × dmm = 1/100 mm² ; 1 m² = 10^8 (1/100 mm²) → milli m² = dmm² / 10^5
    const dw = Math.round(w * 10)
    const dh = Math.round(h * 10)
    return { value: mulDiv(dw, dh, 100_000) }
  }
  if (!(w > 0)) return { value: null, error: `${item.unit === 'mtul' ? 'mtül' : 'm'} için En (uzunluk) veya birim ölçü girin` }
  // dmm → milli m: 1 m = 10 000 dmm → milli = dmm / 10
  return { value: mulDiv(Math.round(w * 10), 1, 10) }
}

export function computeQuoteItem(item: QuoteItemInput, p: Pick<QuoteCalcParams, 'waste_pct' | 'overhead_pct' | 'profit_pct' | 'pricing_mode'>): ItemCalc {
  const errors: string[] = []
  const warnings: string[] = []
  const pieces = toMilliQty(item.quantity)
  if (!(pieces > 0)) errors.push('Adet / miktar sıfırdan büyük olmalı')
  const m = unitMeasureOf(item)
  if (m.error) errors.push(m.error)
  const qty = m.value != null ? mulDiv(m.value, pieces, 1000) : pieces
  if (!item.measure_verified) warnings.push('Ölçü doğrulanmadı (metraj kaynağında onay bekliyor)')

  const wasteBp = toBp(p.waste_pct)
  const ohBp = toBp(p.overhead_pct)
  const prBp = toBp(p.profit_pct)
  const material = toCents(item.material_cost)
  const unitDirectCost = mulDiv(material, 10_000 + wasteBp, 10_000) + toCents(item.labor_cost) + toCents(item.install_cost) + toCents(item.other_cost)
  const manualPrice = item.unit_price != null
  const unitPrice = manualPrice ? toCents(item.unit_price) : mulDiv(unitDirectCost, (10_000 + ohBp) * (10_000 + prBp), 100_000_000)
  // Tek satır üst sınırı: 1 trilyon (veritabanı tutar alanı ve güvenli tamsayı sınırının altında)
  if (errors.length === 0 && (qty > MAX_QTY_MILLI || BigInt(qty) * BigInt(Math.max(unitPrice, unitDirectCost)) > MAX_LINE_CENTS * 1000n)) {
    errors.push('Satır tutarı çok büyük; miktarı veya birim fiyatı kontrol edin')
  }
  const ok = errors.length === 0
  const lineTotal = ok ? mulDiv(qty, unitPrice, 1000) : 0
  const lineDirectCost = ok ? mulDiv(qty, unitDirectCost, 1000) : 0
  const lineOverhead = mulDiv(lineDirectCost, ohBp, 10_000)
  if (ok && p.pricing_mode === 'detayli' && unitPrice === 0) warnings.push('Birim fiyat veya maliyet girilmedi')
  return {
    ok,
    errors,
    warnings,
    unitMeasure: m.value,
    qty: ok ? qty : 0,
    unitDirectCost,
    unitPrice,
    manualPrice,
    lineTotal,
    lineDirectCost,
    lineOverhead,
    lineProfit: lineTotal - lineDirectCost - lineOverhead,
  }
}

export function computeQuote(params: QuoteCalcParams, items: QuoteItemInput[]): QuoteTotals {
  const calcs = items.map((i) => computeQuoteItem(i, params))
  const detailed = params.pricing_mode === 'detayli'
  const itemsTotal = detailed ? calcs.reduce((s, c) => s + c.lineTotal, 0) : toCents(params.lump_sum)
  const shipping = toCents(params.shipping_amount)
  const other = toCents(params.other_amount)
  const subtotal = itemsTotal + shipping + other
  let discount = 0
  if (params.discount_kind === 'yuzde') discount = mulDiv(subtotal, Math.min(toBp(params.discount_value), 10_000), 10_000)
  else if (params.discount_kind === 'tutar') discount = Math.min(toCents(params.discount_value), subtotal)
  const net = subtotal - discount
  const vatBp = toBp(params.vat_pct)
  const vat = mulDiv(net, vatBp, 10_000)

  let directCost: number | null
  let overheadCost: number | null
  if (detailed) {
    directCost = calcs.reduce((s, c) => s + c.lineDirectCost, 0)
    overheadCost = calcs.reduce((s, c) => s + c.lineOverhead, 0)
  } else if (params.lump_cost != null) {
    directCost = toCents(params.lump_cost)
    overheadCost = mulDiv(directCost, toBp(params.overhead_pct), 10_000)
  } else {
    directCost = null
    overheadCost = null
  }
  const totalCost = directCost == null || overheadCost == null ? null : directCost + overheadCost + shipping + other
  const profit = totalCost == null ? null : net - totalCost
  const ratio = (num: number, den: number) => (den > 0 ? Math.sign(num) * mulDiv(Math.abs(num), 10_000, den) : null)

  const unverifiedCalcs = calcs.filter((c, i) => !items[i].measure_verified && c.ok)
  return {
    items: calcs,
    itemsTotal,
    shipping,
    other,
    subtotal,
    discount,
    net,
    vatBp,
    vat,
    grandTotal: net + vat,
    directCost,
    overheadCost,
    totalCost,
    profit,
    markupBp: profit == null || totalCost == null ? null : ratio(profit, totalCost),
    marginBp: profit == null ? null : ratio(profit, net),
    unverified: { items: items.filter((i) => !i.measure_verified).length, amount: unverifiedCalcs.reduce((s, c) => s + c.lineTotal, 0) },
    invalidItems: calcs.filter((c) => !c.ok).length,
    unpricedItems: detailed ? calcs.filter((c) => c.ok && c.unitPrice === 0).length : 0,
  }
}

/** Boş kalem (formlar ve aktarma için) */
export function emptyQuoteItem(sort = 0): QuoteItemInput {
  return {
    sort_order: sort,
    poz_code: null,
    description: '',
    system_type: null,
    width_mm: null,
    height_mm: null,
    dim_unit: 'mm',
    quantity: 1,
    unit: 'adet',
    manual_measure: null,
    material_cost: 0,
    labor_cost: 0,
    install_cost: 0,
    other_cost: 0,
    unit_price: null,
    notes: null,
    source: 'elle',
    source_item_id: null,
    source_takeoff_id: null,
    source_label: null,
    measure_verified: true,
  }
}

/** Kalem için ölçü özeti: "1500 × 2000 mm" / "12,5 m" / "—" */
export function itemDims(i: Pick<QuoteItemInput, 'width_mm' | 'height_mm' | 'unit'>): string {
  const n = (v: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(v)
  if (i.width_mm && i.height_mm) return `${n(i.width_mm)} × ${n(i.height_mm)} mm`
  if (i.width_mm) return `${n(i.width_mm)} mm`
  return '—'
}

/** Kayıtlı kalemden yalnızca istemcinin yazabildiği alanlar (güncelleme ve kopyalama için) */
export function itemInputOf(i: QuoteItemInput): QuoteItemInput {
  return {
    sort_order: i.sort_order,
    poz_code: i.poz_code,
    description: i.description,
    system_type: i.system_type,
    width_mm: i.width_mm,
    height_mm: i.height_mm,
    dim_unit: i.dim_unit,
    quantity: i.quantity,
    unit: i.unit,
    manual_measure: i.manual_measure,
    material_cost: i.material_cost,
    labor_cost: i.labor_cost,
    install_cost: i.install_cost,
    other_cost: i.other_cost,
    unit_price: i.unit_price,
    notes: i.notes,
    source: i.source,
    source_item_id: i.source_item_id,
    source_takeoff_id: i.source_takeoff_id,
    source_label: i.source_label,
    measure_verified: i.measure_verified,
  }
}
