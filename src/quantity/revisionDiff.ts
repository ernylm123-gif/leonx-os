/**
 * Metraj revizyon karşılaştırması (Faz 13): bir projenin iki metraj sürümünü (ör. eski ve yeni pafta
 * analizi) poz bazında karşılaştırır.
 *
 *  - Eşleştirme anahtarı: poz kodu (P-01 = P01 = P1) + kat + mahal. Aynı anahtarlı birden çok satır
 *    toplanır.
 *  - Durum: eklenen / silinen / değişen (ölçü, adet, iş grubu, şekil) / aynı.
 *  - Metraj farkı metraj motorunun tamsayı sonuçlarıyla hesaplanır (×100); birim değiştiyse fark
 *    alınmaz, iki değer ayrı gösterilir.
 *  - Maliyet farkı YALNIZ kullanıcının katalogda tanımladığı birim maliyetlerden, teklif farkı yalnız
 *    projedeki teklif kaleminin birim fiyatından hesaplanır. Fiyat yoksa tutar uydurulmaz; satır
 *    "fiyat tanımlı değil" olarak işaretlenir. Farklı para birimleri toplanmaz.
 *  - Reddedilen pozlar karşılaştırmaya alınmaz (metrajda yok sayılır).
 */
import { canonCode } from '@/cad/pdf/labels'
import { currentRates, measureFor } from '@/finance/fromTakeoff'
import type { CostRate } from '@/finance/types'
import { computeQuoteItem, type QuoteCalcParams } from '@/quote/engine'
import type { Currency, QuoteItem, QuoteUnit } from '@/quote/types'
import { computeItem, type ItemResult } from './engine'
import { CATEGORY_INFO, type QuantityItem, type QuantityUnit } from './types'

export type DiffStatus = 'eklenen' | 'silinen' | 'degisen' | 'ayni'

export interface DiffSide {
  items: QuantityItem[]
  pieces: number
  width_mm: number | null
  height_mm: number | null
  category: string
  shape: string
  /** Metraj miktarı ×100 (kategori birimi) */
  primaryCenti: number | null
  primaryUnit: QuantityUnit | null
  /** Toplam doğrama alanı ×100 (m²) ve çevre ×100 (m) */
  frameAreaCenti: number
  perimeterCenti: number
  errors: string[]
}

export interface MoneyDelta {
  currency: Currency
  /** Kuruş */
  cents: number
}

export interface DiffRow {
  key: string
  poz: string
  where: string
  status: DiffStatus
  changes: string[]
  old: DiffSide | null
  new: DiffSide | null
  /** Metraj farkı ×100; birim değiştiyse veya hesaplanamıyorsa null */
  deltaCenti: number | null
  deltaUnit: QuantityUnit | null
  /** Katalog maliyet farkı (para birimi başına); fiyat yoksa boş + costMissing */
  costDelta: MoneyDelta[]
  costMissing: boolean
  /** Teklif tutarı farkı (teklifte bu poz varsa) */
  quoteDelta: MoneyDelta | null
  quoteMissing: boolean
}

export interface RevisionDiff {
  rows: DiffRow[]
  counts: Record<DiffStatus, number>
  /** Para birimi başına toplam maliyet farkı (yalnız fiyatı tanımlı satırlar) */
  costTotals: MoneyDelta[]
  quoteTotal: MoneyDelta | null
  /** Fiyatı tanımlı olmayan değişen satır sayısı (toplama dahil değil) */
  unpricedCost: number
  unpricedQuote: number
}

export interface QuoteContext {
  currency: Currency
  params: Pick<QuoteCalcParams, 'waste_pct' | 'overhead_pct' | 'profit_pct' | 'pricing_mode'>
  items: readonly QuoteItem[]
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLocaleUpperCase('tr-TR')
export const diffKey = (i: Pick<QuantityItem, 'poz_code' | 'floor' | 'space'>) => [canonCode(i.poz_code), norm(i.floor), norm(i.space)].join('|')

function side(items: QuantityItem[]): DiffSide {
  const results: ItemResult[] = items.map(computeItem)
  const first = items[0]
  const errors = results.flatMap((r) => r.errors.map((e) => e.message))
  const units = new Set(results.map((r) => r.primary?.unit ?? null))
  const unit = units.size === 1 ? [...units][0] : null
  const same = <T,>(f: (i: QuantityItem) => T): T | null => (items.every((i) => f(i) === f(first)) ? f(first) : null)
  return {
    items,
    pieces: items.reduce((s, i) => s + i.quantity, 0),
    width_mm: same((i) => i.width_mm),
    height_mm: same((i) => i.height_mm),
    category: same((i) => i.category) ?? 'karisik',
    shape: same((i) => i.shape) ?? 'karisik',
    primaryCenti: errors.length || unit == null ? null : results.reduce((s, r) => s + (r.primary?.centi ?? 0), 0),
    primaryUnit: unit,
    frameAreaCenti: results.reduce((s, r) => s + (r.ok ? r.total.frameArea : 0), 0),
    perimeterCenti: results.reduce((s, r) => s + (r.ok ? r.total.perimeter : 0), 0),
    errors,
  }
}

/** Bir tarafın katalog maliyeti (para birimi başına kuruş); eşleşen fiyat yoksa null */
function costOf(s: DiffSide | null, catalog: readonly CostRate[]): Map<Currency, number> | null {
  const m = new Map<Currency, number>()
  if (!s) return m
  let priced = false
  for (const it of s.items) {
    const r = computeItem(it)
    if (!r.ok) return null
    const rates = catalog.filter((x) => x.quantity_category === it.category)
    for (const rate of rates) {
      const q = measureFor(rate.unit, rate.cost_group, r, it.quantity)
      if (!q) continue
      priced = true
      // miktar 2 ondalık, birim maliyet 2 ondalık → kuruş
      const cents = Math.round(Math.round(q.qty * 100) * Math.round(rate.unit_cost * 100) / 100)
      m.set(rate.currency, (m.get(rate.currency) ?? 0) + cents)
    }
    if (!rates.length) return null
  }
  return priced || !s.items.length ? m : null
}

/** Teklifteki ölçü birimine göre tarafın miktarı (milli: m², m veya adet ×1000) */
function quoteQtyMilli(s: DiffSide | null, unit: QuoteUnit): number | null {
  if (!s) return 0
  switch (unit) {
    case 'm2':
      return s.frameAreaCenti * 10
    case 'mtul':
    case 'm':
      return s.perimeterCenti * 10
    case 'adet':
    case 'takim':
      return s.pieces * 1000
    default:
      return null
  }
}

function addMoney(list: MoneyDelta[], currency: Currency, cents: number) {
  const x = list.find((m) => m.currency === currency)
  if (x) x.cents += cents
  else list.push({ currency, cents })
}

export function diffRevisions(
  oldItems: readonly QuantityItem[],
  newItems: readonly QuantityItem[],
  opts: { rates?: readonly CostRate[]; today?: string; quote?: QuoteContext | null } = {},
): RevisionDiff {
  const catalog = currentRates(opts.rates ?? [], opts.today ?? new Date().toISOString().slice(0, 10))
  const group = (items: readonly QuantityItem[]) => {
    const g = new Map<string, QuantityItem[]>()
    for (const i of items) {
      if (i.verification === 'reddedildi') continue
      const k = diffKey(i)
      const arr = g.get(k)
      if (arr) arr.push(i)
      else g.set(k, [i])
    }
    return g
  }
  const A = group(oldItems)
  const B = group(newItems)
  const quoteByCode = new Map<string, QuoteItem>()
  for (const q of opts.quote?.items ?? []) if (q.poz_code && !quoteByCode.has(canonCode(q.poz_code))) quoteByCode.set(canonCode(q.poz_code), q)

  const keys = [...new Set([...A.keys(), ...B.keys()])]
  const rows: DiffRow[] = []
  const costTotals: MoneyDelta[] = []
  const quoteSum: MoneyDelta[] = []
  let unpricedCost = 0
  let unpricedQuote = 0
  for (const key of keys) {
    const a = A.has(key) ? side(A.get(key)!) : null
    const b = B.has(key) ? side(B.get(key)!) : null
    const ref = (b ?? a)!.items[0]
    const changes: string[] = []
    if (a && b) {
      const mm = (v: number | null) => (v == null ? '—' : `${v} mm`)
      if (a.width_mm !== b.width_mm) changes.push(`En ${mm(a.width_mm)} → ${mm(b.width_mm)}`)
      if (a.height_mm !== b.height_mm) changes.push(`Boy ${mm(a.height_mm)} → ${mm(b.height_mm)}`)
      if (a.pieces !== b.pieces) changes.push(`Adet ${a.pieces} → ${b.pieces}`)
      if (a.category !== b.category) changes.push(`İş grubu ${CATEGORY_INFO[a.category as keyof typeof CATEGORY_INFO]?.label ?? a.category} → ${CATEGORY_INFO[b.category as keyof typeof CATEGORY_INFO]?.label ?? b.category}`)
      if (a.shape !== b.shape) changes.push(`Şekil ${a.shape} → ${b.shape}`)
      if (!changes.length && a.primaryCenti !== b.primaryCenti) changes.push('Metraj miktarı değişti')
    }
    const status: DiffStatus = !a ? 'eklenen' : !b ? 'silinen' : changes.length ? 'degisen' : 'ayni'
    const unit = a && b ? (a.primaryUnit === b.primaryUnit ? a.primaryUnit : null) : (b ?? a)!.primaryUnit
    const pa = a ? a.primaryCenti : 0
    const pb = b ? b.primaryCenti : 0
    const deltaCenti = unit != null && pa != null && pb != null ? pb - pa : null

    // Katalog maliyeti
    const costDelta: MoneyDelta[] = []
    let costMissing = false
    if (status !== 'ayni') {
      const ca = costOf(a, catalog)
      const cb = costOf(b, catalog)
      if (ca == null || cb == null) {
        costMissing = true
        unpricedCost++
      } else {
        for (const cur of new Set([...ca.keys(), ...cb.keys()])) {
          const d = (cb.get(cur) ?? 0) - (ca.get(cur) ?? 0)
          if (d !== 0) {
            costDelta.push({ currency: cur, cents: d })
            addMoney(costTotals, cur, d)
          }
        }
      }
    }

    // Teklif farkı (teklif kaleminin birim fiyatı × miktar farkı)
    let quoteDelta: MoneyDelta | null = null
    let quoteMissing = false
    if (status !== 'ayni' && opts.quote) {
      const qi = quoteByCode.get(canonCode(ref.poz_code))
      const calc = qi ? computeQuoteItem(qi, opts.quote.params) : null
      const qa = qi ? quoteQtyMilli(a, qi.unit) : null
      const qb = qi ? quoteQtyMilli(b, qi.unit) : null
      if (!qi || !calc?.ok || qa == null || qb == null || calc.unitPrice === 0) {
        quoteMissing = true
        unpricedQuote++
      } else {
        const cents = Math.round(((qb - qa) * calc.unitPrice) / 1000)
        quoteDelta = { currency: opts.quote.currency, cents }
        addMoney(quoteSum, opts.quote.currency, cents)
      }
    }

    rows.push({
      key,
      poz: ref.poz_code,
      where: [ref.floor, ref.space].filter(Boolean).join(' / '),
      status,
      changes,
      old: a,
      new: b,
      deltaCenti,
      deltaUnit: unit,
      costDelta,
      costMissing,
      quoteDelta,
      quoteMissing,
    })
  }
  const order: Record<DiffStatus, number> = { degisen: 0, eklenen: 1, silinen: 2, ayni: 3 }
  rows.sort((x, y) => order[x.status] - order[y.status] || x.poz.localeCompare(y.poz, 'tr', { numeric: true }))
  const counts = { eklenen: 0, silinen: 0, degisen: 0, ayni: 0 }
  for (const r of rows) counts[r.status]++
  return { rows, counts, costTotals, quoteTotal: quoteSum[0] ?? null, unpricedCost, unpricedQuote }
}
