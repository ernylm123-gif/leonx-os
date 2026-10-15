/**
 * Aylık nakit akışı — para birimi bazında, çevrim YAPILMAZ.
 *  Giriş: tahsilatlar (alındığı ay, tahsil edilen tutar)
 *  Çıkış: ödenmiş giderler (gider tarihi ayı, KDV hariç tutar + KDV = ödenen tutar)
 *  Ödenmemiş giderler nakit çıkışı sayılmaz.
 */
import { toCents } from '@/quote/money'
import type { Currency } from '@/quote/types'

export interface CashflowMonth {
  month: string
  perCurrency: Partial<Record<Currency, { in: number; out: number }>>
}

/** "2026-10" biçiminde son n ay (bu ay dahil), eskiden yeniye */
export function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split('-').map(Number)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export function monthlyCashflow(
  collections: readonly { received_date: string; amount: number; currency: Currency }[],
  expenses: readonly { expense_date: string; amount: number; vat_amount: number; currency: Currency; paid: boolean }[],
  today: string,
  months = 6,
): CashflowMonth[] {
  const keys = lastMonths(today, months)
  const map = new Map(keys.map((k) => [k, { month: k, perCurrency: {} } as CashflowMonth]))
  for (const c of collections) {
    const row = map.get(c.received_date.slice(0, 7))
    if (!row) continue
    const t = (row.perCurrency[c.currency] ??= { in: 0, out: 0 })
    t.in += toCents(c.amount)
  }
  for (const e of expenses) {
    if (!e.paid) continue
    const row = map.get(e.expense_date.slice(0, 7))
    if (!row) continue
    const t = (row.perCurrency[e.currency] ??= { in: 0, out: 0 })
    t.out += toCents(e.amount) + toCents(e.vat_amount)
  }
  return keys.map((k) => map.get(k)!)
}

const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${MONTHS_TR[m - 1]} ${String(y).slice(2)}`
}
