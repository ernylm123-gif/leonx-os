/**
 * Tahsilat durumu — veritabanındaki public.project_receivables görünümüyle AYNI algoritma.
 *
 *  1. Taksite bağlı tahsilatlar önce o taksite uygulanır (taksit tutarına kadar).
 *  2. Bağlanmamış tahsilatlar + taksiti aşan kısımlar, aynı para birimindeki açık taksitlere
 *     vade sırasıyla (vade, sıra, kimlik) dağıtılır (FIFO).
 *  3. Kalan hiçbir zaman negatif olmaz; dağıtılamayan fazla "fazla tahsilat / avans" olarak raporlanır.
 *  Durum: kalan 0 → tahsil edildi · vadesi geçmiş → gecikti · kısmen ödenmiş → kısmi · aksi hâlde bekliyor.
 *  Para birimleri asla birbirine karıştırılmaz.
 */
import { toCents } from '@/quote/money'
import type { Currency } from '@/quote/types'

export type ReceivableStatus = 'bekliyor' | 'kismi' | 'tahsil_edildi' | 'gecikti'
export const RECEIVABLE_STATUS_LABEL: Record<ReceivableStatus, string> = {
  bekliyor: 'Bekliyor',
  kismi: 'Kısmi',
  tahsil_edildi: 'Tahsil edildi',
  gecikti: 'Gecikti',
}

export interface ScheduleLike {
  id: string
  due_date: string
  amount: number
  currency: Currency
  sort_order: number
}

export interface CollectionLike {
  id: string
  amount: number
  currency: Currency
  schedule_id: string | null
}

export interface ReceivableRow {
  id: string
  amount: number
  collected: number
  outstanding: number
  status: ReceivableStatus
}

export interface ReceivableTotals {
  planned: number
  /** Kayıtlı tüm tahsilatlar */
  collected: number
  outstanding: number
  overdue: number
  /** Taksitlere dağıtılamayan fazla tahsilat (avans) */
  unallocated: number
  openCount: number
  overdueCount: number
}

export interface ReceivablesResult {
  /** Girdi sırasıyla */
  rows: ReceivableRow[]
  byId: Map<string, ReceivableRow>
  perCurrency: Partial<Record<Currency, ReceivableTotals>>
}

const emptyTotals = (): ReceivableTotals => ({ planned: 0, collected: 0, outstanding: 0, overdue: 0, unallocated: 0, openCount: 0, overdueCount: 0 })

export function receivables(schedule: readonly ScheduleLike[], collections: readonly CollectionLike[], today: string): ReceivablesResult {
  const ids = new Set(schedule.map((s) => s.id))
  const linked = new Map<string, number>()
  const pool = new Map<Currency, number>()
  const perCurrency: Partial<Record<Currency, ReceivableTotals>> = {}
  for (const c of collections) {
    const amt = toCents(c.amount)
    ;(perCurrency[c.currency] ??= emptyTotals()).collected += amt
    if (c.schedule_id && ids.has(c.schedule_id)) linked.set(c.schedule_id, (linked.get(c.schedule_id) ?? 0) + amt)
    else pool.set(c.currency, (pool.get(c.currency) ?? 0) + amt)
  }
  const base = schedule.map((s) => {
    const amount = toCents(s.amount)
    const l = linked.get(s.id) ?? 0
    const applied = Math.min(l, amount)
    if (l > amount) pool.set(s.currency, (pool.get(s.currency) ?? 0) + (l - amount))
    return { s, amount, applied, open: amount - applied }
  })
  const order = [...base].sort((a, b) =>
    a.s.currency !== b.s.currency
      ? a.s.currency < b.s.currency ? -1 : 1
      : a.s.due_date !== b.s.due_date
        ? a.s.due_date < b.s.due_date ? -1 : 1
        : a.s.sort_order !== b.s.sort_order
          ? a.s.sort_order - b.s.sort_order
          : a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0,
  )
  const remainingPool = new Map(pool)
  const byId = new Map<string, ReceivableRow>()
  for (const b of order) {
    const avail = remainingPool.get(b.s.currency) ?? 0
    const fromPool = Math.min(b.open, avail)
    remainingPool.set(b.s.currency, avail - fromPool)
    const collected = b.applied + fromPool
    const outstanding = b.amount - collected
    const status: ReceivableStatus = outstanding === 0 ? 'tahsil_edildi' : b.s.due_date < today ? 'gecikti' : collected > 0 ? 'kismi' : 'bekliyor'
    byId.set(b.s.id, { id: b.s.id, amount: b.amount, collected, outstanding, status })
    const t = (perCurrency[b.s.currency] ??= emptyTotals())
    t.planned += b.amount
    t.outstanding += outstanding
    if (outstanding > 0) t.openCount++
    if (status === 'gecikti') {
      t.overdue += outstanding
      t.overdueCount++
    }
  }
  for (const [cur, left] of remainingPool) (perCurrency[cur] ??= emptyTotals()).unallocated += left
  return { rows: schedule.map((s) => byId.get(s.id)!), byId, perCurrency }
}
