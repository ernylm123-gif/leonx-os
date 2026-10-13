/**
 * Parasal hesaplama — TEK MERKEZ. Ekran, PDF ve Excel aynı fonksiyonları kullanır.
 *
 * Kurallar
 *  1. Tutarlar tamsayı kuruş (1/100) olarak tutulur; kayan nokta birikimi olmaz.
 *  2. Yüzdeler tamsayı baz puan (1/100 %) olarak tutulur: %20 = 2000.
 *  3. Miktarlar tamsayı "milli" birim (1/1000): 12,5 mtül = 12500.
 *  4. Her çarpım/bölüm BigInt ile tam yapılır ve SONUNDA bir kez yarım yukarı yuvarlanır.
 *  5. Toplamlar yuvarlanmış satır tutarlarının tam toplamıdır (satırlar toplamı = ara toplam).
 */
import { parseDecimalInput } from '@/quantity/precision'
import type { Currency, DimUnit } from './types'

/** a × b / d, yarım yukarı (negatif olmayan tamsayılar) */
export function mulDiv(a: number, b: number, d: number): number {
  if (a < 0 || b < 0 || d <= 0) throw new RangeError('mulDiv: negatif olmayan değerler beklenir')
  const n = BigInt(a) * BigInt(b)
  const D = BigInt(d)
  return Number((n * 2n + D) / (2n * D))
}

/** Veritabanı / giriş sayısı → kuruş (2 ondalık, yarım yukarı) */
export function toCents(x: number | null | undefined): number {
  if (x == null || !Number.isFinite(x)) return 0
  const v = Number((Math.abs(x) * 100).toPrecision(15))
  return Math.sign(x) * Math.floor(v + 0.5)
}

/** Yüzde → baz puan (%12,5 → 1250) */
export function toBp(pct: number | null | undefined): number {
  if (pct == null || !Number.isFinite(pct)) return 0
  return Math.round(Number((pct * 100).toPrecision(15)))
}

/** Miktar → milli (3 ondalık, yarım yukarı) */
export function toMilliQty(x: number | null | undefined): number {
  if (x == null || !Number.isFinite(x)) return 0
  const v = Number((Math.abs(x) * 1000).toPrecision(15))
  return Math.floor(v + 0.5)
}

export const centsToNumber = (c: number) => c / 100

const moneyFmt = new Map<string, Intl.NumberFormat>()
/** 12345,67 ₺ biçimi (tr-TR). Para birimi sembolü dahil. */
export function formatMoney(cents: number, currency: Currency): string {
  let f = moneyFmt.get(currency)
  if (!f) {
    f = new Intl.NumberFormat('tr-TR', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
    moneyFmt.set(currency, f)
  }
  return f.format(cents / 100)
}

/** Sembolsüz tutar: 12.345,67 */
export function formatAmount(cents: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)
}

export const CURRENCY_SYMBOL: Record<Currency, string> = { TRY: '₺', EUR: '€', USD: '$' }

/** Baz puan → "%12,5" */
export function formatPct(bp: number, decimals = 2): string {
  return `%${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(bp / 100)}`
}

/** Tutar girişini kuruşa çevirir: "12.500,50" → 1250050. Geçersizse null. */
export function parseMoneyInput(raw: string): number | null {
  const { value } = parseDecimalInput(raw)
  if (value == null || value < 0 || !Number.isFinite(value)) return null
  return toCents(value)
}

// ------------------------------------------------------------------ ölçü birimleri

const MM_PER: Record<DimUnit, number> = { mm: 1, cm: 10, m: 1000 }

/**
 * Seçilen birimdeki ölçüyü milimetreye çevirir (0,1 mm hassasiyet, yarım yukarı).
 * 150 cm → 1500 mm · 1,5 m → 1500 mm · 1500 mm → 1500 mm
 */
export function toMm(value: number, unit: DimUnit): number {
  const dmm = Math.floor(Number((Math.abs(value) * MM_PER[unit] * 10).toPrecision(15)) + 0.5)
  return (Math.sign(value) * dmm) / 10
}

/** Milimetreyi seçilen birimde gösterir (gereksiz sıfırlar olmadan) */
export function fromMm(mm: number, unit: DimUnit): number {
  return Number((mm / MM_PER[unit]).toPrecision(12))
}
