/**
 * Tahmini maliyet toplamları.
 *
 *  - Satır tutarı = miktar (3 ondalık) × birim maliyet (kuruş), yarım yukarı → kuruş.
 *  - Fiyatı tanımlanmamış satır (unit_cost = null) toplamlara KATILMAZ; sayısı ayrıca bildirilir.
 *  - Para birimi bazında ara toplamlar her zaman hesaplanır.
 *  - Ana para birimindeki toplam YALNIZ gereken tüm kurlar girilmişse hesaplanır; aksi hâlde null
 *    ve eksik kurlar listelenir (uydurma birleşik toplam üretilmez).
 *  - Fire oranı yalnız malzeme gruplarına, genel gider oranı (doğrudan + fire) toplamına uygulanır.
 *    Ana para biriminde: her satır önce çevrilir (yuvarlanır), oranlar çevrilmiş toplamlara uygulanır
 *    — veritabanındaki public.leonx_finance_budget_check ile birebir aynı.
 */
import { mulDiv, toCents, toMilliQty } from '@/quote/money'
import type { Currency } from '@/quote/types'
import { convertCents, type FxContext, type FxRateLike, resolveRate } from './fx'
import { type CostGroup, MATERIAL_GROUPS } from './types'

/** Yüzde (3 ondalık) → yüz binde bir (%12,345 → 12345); 100 000 = %100 */
export function toPctMilli(pct: number | null | undefined): number {
  if (pct == null || !Number.isFinite(pct)) return 0
  return Math.round(Number((pct * 1000).toPrecision(15)))
}
export const PCT_MILLI_DEN = 100_000

/** Yüzde payı: tutar × yüzde, yarım yukarı */
export function pctOf(cents: number, pct: number): number {
  return Math.sign(cents) * mulDiv(Math.abs(cents), toPctMilli(pct), PCT_MILLI_DEN)
}

/** Satır tutarı (kuruş); fiyat tanımlanmamışsa null */
export function lineAmount(quantity: number, unitCost: number | null): number | null {
  if (unitCost == null) return null
  return mulDiv(toMilliQty(quantity), toCents(unitCost), 1000)
}

export interface EstimateLine {
  cost_group: CostGroup
  quantity: number
  unit_cost: number | null
  currency: Currency
}

export interface CurrencyTotals {
  direct: number
  material: number
  waste: number
  overhead: number
  total: number
  lines: number
}

export interface BaseTotals {
  currency: Currency
  direct: number
  material: number
  waste: number
  overhead: number
  total: number
}

export interface EstimateResult {
  /** Satır tutarları (kendi para biriminde), girdiyle aynı sıra; fiyatsızsa null */
  amounts: (number | null)[]
  perCurrency: Partial<Record<Currency, CurrencyTotals>>
  /** Grup bazında para birimi toplamları ve (kur tamamsa) ana birim karşılığı */
  byGroup: { group: CostGroup; perCurrency: Partial<Record<Currency, number>>; base: number | null }[]
  unpriced: number
  /** Ana para birimine çevrilemeyen para birimleri (kur girilmemiş) */
  missingRates: Currency[]
  /** Kullanılan kurlar (para birimi → kayıt) */
  usedRates: Partial<Record<Currency, FxRateLike>>
  /** Ana birim toplamı; kur eksikse null */
  base: BaseTotals | null
  /** Tüm satırlar fiyatlı ve çevrilebilir mi (bütçe aşımı kontrolü yalnız bu durumda) */
  complete: boolean
}

export interface EstimateOptions {
  fx: FxContext
  /** Tahmini satırlar için kur tarihi (bugün) */
  date: string
  wastePct: number
  overheadPct: number
}

const emptyTotals = (): CurrencyTotals => ({ direct: 0, material: 0, waste: 0, overhead: 0, total: 0, lines: 0 })

export function estimateTotals(lines: readonly EstimateLine[], o: EstimateOptions): EstimateResult {
  const amounts = lines.map((l) => lineAmount(l.quantity, l.unit_cost))
  const perCurrency: Partial<Record<Currency, CurrencyTotals>> = {}
  const groupMap = new Map<CostGroup, { perCurrency: Partial<Record<Currency, number>>; base: number; ok: boolean }>()
  const usedRates: Partial<Record<Currency, FxRateLike>> = {}
  const missing = new Set<Currency>()
  let unpriced = 0
  let baseDirect = 0
  let baseMaterial = 0

  lines.forEach((l, i) => {
    const amt = amounts[i]
    if (amt == null) {
      unpriced++
      return
    }
    const t = (perCurrency[l.currency] ??= emptyTotals())
    t.direct += amt
    t.lines++
    const material = MATERIAL_GROUPS.includes(l.cost_group)
    if (material) t.material += amt
    const g = groupMap.get(l.cost_group) ?? { perCurrency: {}, base: 0, ok: true }
    g.perCurrency[l.currency] = (g.perCurrency[l.currency] ?? 0) + amt
    const r = resolveRate(o.fx, l.currency, o.date)
    if (!r) {
      missing.add(l.currency)
      g.ok = false
    } else {
      if (r.rate) usedRates[l.currency] = r.rate
      const conv = convertCents(amt, r.micro)
      baseDirect += conv
      if (material) baseMaterial += conv
      g.base += conv
    }
    groupMap.set(l.cost_group, g)
  })

  for (const t of Object.values(perCurrency)) {
    t.waste = pctOf(t.material, o.wastePct)
    t.overhead = pctOf(t.direct + t.waste, o.overheadPct)
    t.total = t.direct + t.waste + t.overhead
  }

  let base: BaseTotals | null = null
  if (missing.size === 0) {
    const waste = pctOf(baseMaterial, o.wastePct)
    const overhead = pctOf(baseDirect + waste, o.overheadPct)
    base = { currency: o.fx.base, direct: baseDirect, material: baseMaterial, waste, overhead, total: baseDirect + waste + overhead }
  }
  const byGroup = [...groupMap.entries()].map(([group, g]) => ({ group, perCurrency: g.perCurrency, base: g.ok ? g.base : null }))
  return {
    amounts,
    perCurrency,
    byGroup,
    unpriced,
    missingRates: [...missing],
    usedRates,
    base,
    complete: base !== null && unpriced === 0 && lines.length > 0,
  }
}

// ------------------------------------------------------------------ gerçekleşen giderler

export interface ActualExpense {
  amount: number
  vat_amount: number
  currency: Currency
  expense_date: string
  fx_rate_to_base: number | null
  fx_to_currency: Currency | null
  paid?: boolean
}

export interface ActualResult {
  /** Para birimi bazında KDV hariç toplam ve KDV */
  perCurrency: Partial<Record<Currency, { net: number; vat: number; count: number }>>
  /** Ana birime çevrilebilen giderlerin KDV hariç toplamı */
  baseNet: number
  /** Çevrilemeyen gider sayısı ve para birimleri */
  unconverted: number
  missingRates: Currency[]
  /** Tüm giderler çevrildi mi */
  complete: boolean
}

/**
 * Gerçekleşen gider toplamı (KDV hariç). Çevrim önceliği: aynı birim → faturadaki kur (hedef birim ana
 * birimse) → kur tablosu (gider tarihindeki). Çevrilemeyen gider ana birim toplamına katılmaz.
 */
export function actualTotals(expenses: readonly ActualExpense[], fx: FxContext): ActualResult {
  const perCurrency: ActualResult['perCurrency'] = {}
  const missing = new Set<Currency>()
  let baseNet = 0
  let unconverted = 0
  for (const e of expenses) {
    const net = toCents(e.amount)
    const vat = toCents(e.vat_amount)
    const t = (perCurrency[e.currency] ??= { net: 0, vat: 0, count: 0 })
    t.net += net
    t.vat += vat
    t.count++
    let micro: number | null = null
    if (e.currency === fx.base) micro = 1_000_000
    else if (e.fx_rate_to_base != null && e.fx_to_currency === fx.base) micro = Math.round(Number((e.fx_rate_to_base * 1_000_000).toPrecision(15)))
    else micro = resolveRate(fx, e.currency, e.expense_date)?.micro ?? null
    if (micro == null) {
      unconverted++
      missing.add(e.currency)
    } else baseNet += convertCents(net, micro)
  }
  return { perCurrency, baseNet, unconverted, missingRates: [...missing], complete: unconverted === 0 }
}

/** Bütçe aşım eşiği (veritabanıyla aynı): her %10'luk aşım bir basamak; aşım yoksa null */
export function overrunStep(actualBase: number, estimatedBase: number): number | null {
  if (!(estimatedBase > 0) || actualBase <= estimatedBase) return null
  return Math.floor(((actualBase - estimatedBase) * 10) / estimatedBase)
}
