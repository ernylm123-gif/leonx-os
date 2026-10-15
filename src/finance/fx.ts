/**
 * Kur seçimi ve para birimi çevrimi.
 *
 * Kurallar (veritabanındaki public.leonx_fx_rate ile aynı)
 *  - Aynı para birimi → 1.
 *  - Yalnız kullanıcının girdiği kurlar kullanılır: kur tarihi ≤ işlem tarihi; projeye özel kur genel
 *    kurdan önce; en yeni tarih önce. Ters yön (TRY→EUR'dan EUR→TRY) HESAPLANMAZ.
 *  - Kur yoksa null döner: arayüz birleşik toplam üretmez, para birimi bazında gösterir.
 *  - Kur 6 ondalık "mikro" tamsayı olarak tutulur; çevrim BigInt ile tam yapılır, sonda bir kez yarım yukarı yuvarlanır.
 */
import { mulDiv } from '@/quote/money'
import type { Currency } from '@/quote/types'

export interface FxRateLike {
  id: string
  rate_date: string
  from_currency: Currency
  to_currency: Currency
  rate: number
  project_id: string | null
  created_at: string
  source?: string
}

export const MICRO = 1_000_000

/** Kur → mikro tamsayı (34,123457 → 34123457) */
export function rateToMicro(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError('Kur pozitif olmalıdır')
  return Math.round(Number((rate * MICRO).toPrecision(15)))
}

/** Kuruş × kur (mikro) → kuruş, yarım yukarı (sıfırdan uzağa; PostgreSQL round ile aynı) */
export function convertCents(cents: number, rateMicro: number): number {
  return Math.sign(cents) * mulDiv(Math.abs(cents), rateMicro, MICRO)
}

/** İşlem tarihi için geçerli kur kaydı (yoksa null). Aynı birimde çağrılmamalıdır. */
export function pickRate<T extends FxRateLike>(rates: readonly T[], from: Currency, to: Currency, date: string, projectId: string | null): T | null {
  let best: T | null = null
  for (const r of rates) {
    if (r.from_currency !== from || r.to_currency !== to || r.rate_date > date) continue
    if (r.project_id !== null && r.project_id !== projectId) continue
    if (!best || compare(r, best) < 0) best = r
  }
  return best
}

/** Sıralama: projeye özel önce, sonra yeni tarih, sonra yeni kayıt, sonra kimlik (azalan) */
function compare(a: FxRateLike, b: FxRateLike): number {
  const ap = a.project_id !== null ? 1 : 0
  const bp = b.project_id !== null ? 1 : 0
  if (ap !== bp) return bp - ap
  if (a.rate_date !== b.rate_date) return a.rate_date > b.rate_date ? -1 : 1
  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? -1 : 1
  return a.id > b.id ? -1 : a.id < b.id ? 1 : 0
}

export interface ResolvedRate {
  micro: number
  /** Kullanılan kur kaydı (aynı birimde null) */
  rate: FxRateLike | null
}

/** Çevrim bağlamı: ana para birimi, kur listesi ve proje */
export interface FxContext {
  base: Currency
  rates: readonly FxRateLike[]
  projectId: string | null
}

export function resolveRate(ctx: FxContext, from: Currency, date: string): ResolvedRate | null {
  if (from === ctx.base) return { micro: MICRO, rate: null }
  const r = pickRate(ctx.rates, from, ctx.base, date, ctx.projectId)
  return r ? { micro: rateToMicro(r.rate), rate: r } : null
}

/** Kur girişi doğrulama ve okuma: "34,1234567" → 34.123457 (6 ondalık). Geçersizse null. */
export function parseRateInput(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, '')
  if (!s) return null
  const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  if (!/^\d+(\.\d+)?$/.test(norm)) return null
  const v = Number(norm)
  if (!(v > 0) || v >= 1e9) return null
  return rateToMicro(v) / MICRO
}

export function formatRate(rate: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(rate)
}
