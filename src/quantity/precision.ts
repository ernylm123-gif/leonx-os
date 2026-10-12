/**
 * Metraj hassasiyet ve yuvarlama kuralları — TEK MERKEZ.
 *
 * Ekran, Excel ve PDF aynı fonksiyonları kullanır; böylece toplamlar her yerde aynıdır.
 *
 * Kurallar:
 *  1. Ölçü girişi milimetre, en fazla 1 ondalık (0,1 mm). İçeride tamsayı "dmm" (0,1 mm) tutulur.
 *  2. Birim değerler (birim alan m², birim çevre m) 3 ondalığa yuvarlanır (yarım yukarı).
 *  3. Satır toplamı = yuvarlanmış birim değer × adet → 2 ondalığa yuvarlanır (yarım yukarı).
 *     Böylece satır toplamı ekrandaki birim değerden elle de aynı bulunur.
 *  4. Genel ve kategori toplamları = yuvarlanmış satır toplamlarının TAM toplamıdır
 *     (sütun toplamı ile alt toplam her zaman birebir eşittir).
 *  5. Tüm ara hesaplar tamsayı (milli/santi birim) ile yapılır; kayan nokta birikimi yoktur.
 */

export const PRECISION = {
  inputMmDecimals: 1,
  unitDecimals: 3,
  totalDecimals: 2,
  rounding: 'yarım yukarı',
  /** Kabul edilen en büyük tek ölçü (mm) — 100 m */
  maxDimensionMm: 100_000,
  /** En küçük anlamlı ölçü (mm) */
  minDimensionMm: 1,
  maxQuantity: 100_000,
} as const

/** Sayıyı yarım-yukarı yuvarlar; kayan nokta gösterim hatasını (1.0049999…) önce 15 haneye sabitler. */
export function roundHalfUp(x: number, decimals: number): number {
  const f = 10 ** decimals
  const v = Number((Math.abs(x) * f).toPrecision(15))
  return (Math.sign(x) * Math.floor(v + 0.5)) / f
}

/** Değeri tamsayı "milli" birime çevirir (×1000, yarım yukarı) */
export function toMilli(x: number): number {
  const v = Number((Math.abs(x) * 1000).toPrecision(15))
  return Math.sign(x) * Math.floor(v + 0.5)
}

/** milli × adet → santi (×100), yarım yukarı. Girdiler negatif değildir. */
export function milliTimesQtyToCenti(milli: number, qty: number): number {
  const total = milli * qty // tamsayı, 2^53 sınırının çok altında
  return Math.floor((total + 5) / 10)
}

export const centiToNumber = (c: number): number => c / 100
export const milliToNumber = (m: number): number => m / 1000

/** mm → tamsayı dmm (0,1 mm) */
export function mmToDmm(mm: number): number {
  return Math.round(Number((mm * 10).toPrecision(15)))
}

/** Türkçe sayı biçimi (ondalık virgül, binlik nokta) */
const fmtCache = new Map<number, Intl.NumberFormat>()
export function formatDecimal(v: number, decimals: number): string {
  let f = fmtCache.get(decimals)
  if (!f) {
    f = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    fmtCache.set(decimals, f)
  }
  return f.format(v)
}

export const formatCenti = (c: number): string => formatDecimal(c / 100, 2)
export const formatMilli = (m: number): string => formatDecimal(m / 1000, 3)

/**
 * Kullanıcı girişini sayıya çevirir: "1.250,5" → 1250.5, "1250,5" → 1250.5, "1250.5" → 1250.5.
 * Belirsiz "1.250" (binlik mi ondalık mı) mm girişinde binlik kabul edilir; ancak bu durumda
 * çağırana uyarı döner.
 */
export function parseDecimalInput(raw: string): { value: number | null; ambiguous: boolean } {
  const s = raw.trim().replace(/\s/g, '')
  if (!s) return { value: null, ambiguous: false }
  if (!/^[-+]?[\d.,]+$/.test(s)) return { value: null, ambiguous: false }
  const hasDot = s.includes('.')
  const hasComma = s.includes(',')
  let normalized = s
  let ambiguous = false
  if (hasDot && hasComma) {
    normalized = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (hasComma) {
    const parts = s.split(',')
    if (parts.length !== 2) return { value: null, ambiguous: false }
    normalized = `${parts[0]}.${parts[1]}`
  } else if (hasDot) {
    const parts = s.split('.')
    if (parts.length === 2 && parts[1].length === 3) {
      // "1.250": Türkçe binlik ayırıcı kabul edilir
      normalized = parts.join('')
      ambiguous = true
    } else if (parts.length > 2 && parts.slice(1).every((p) => p.length === 3)) {
      normalized = parts.join('')
    } else if (parts.length !== 2) {
      return { value: null, ambiguous: false }
    }
  }
  const v = Number(normalized)
  return { value: Number.isFinite(v) ? v : null, ambiguous }
}
