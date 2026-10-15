/**
 * Mimari PDF yazı ayrıştırma (Faz 5.1 + 5.2): metin satırı türü, doğrama ölçü etiketi, poz kodu
 * ve kod normalizasyonu. Hem vektör yazılar hem OCR yazıları için ortaktır.
 */
import type { BBox } from '../geometry'
import { normalizeKey, parsePozLabel, type TypeHint } from '@/quantity/detect'

export interface TextRun {
  text: string
  /** Yazı yönü (radyan, dünya) */
  angle: number
  height: number
  /** Taban çizgisi başlangıcı (dünya, PDF noktası) */
  ox: number
  oy: number
  /** Yazı yönündeki uzunluk */
  width: number
  bbox: BBox
  /** Kaynak metin nesneleri (vurgulama için) */
  ids: number[]
  /** OCR ile okunduysa tanıma güveni (0–1) */
  ocr?: number
}

export interface DimLabel {
  w_mm: number
  h_mm: number
  text: string
  /** Üçüncü değer (ör. parapet / denizlik yüksekliği), cm */
  extra: number | null
  /** Yazının birimi: cm ("120/150"), mm ("1200x1500"), m ("1.20/1.50") */
  unit: 'cm' | 'mm' | 'm'
  /** Kesirli (üst üste) yazımdan birleştirildiyse true */
  stacked?: boolean
}

export const deg = (r: number) => (r * 180) / Math.PI
export const normAngle = (a: number) => {
  // [0, π) aralığına (ters yönlü yazı aynı doğrultudur)
  let x = a % Math.PI
  if (x < 0) x += Math.PI
  if (Math.PI - x < 1e-3) x = 0
  return x
}

export const runCenter = (r: TextRun): [number, number] => [(r.bbox[0] + r.bbox[2]) / 2, (r.bbox[1] + r.bbox[3]) / 2]

// ------------------------------------------------------------------ ölçü etiketi

const NUM = '(\\d{2,5}(?:[.,]\\d{1,2})?)'
const DIM_RE = new RegExp(`^\\(?${NUM}\\s*([/xX×*])\\s*${NUM}(?:\\s*[/xX×*]\\s*(\\d{1,4}))?\\)?$`)
const METER_RE = /^\(?(\d)[.,](\d{1,2})\s*([/xX×*])\s*(\d)[.,](\d{1,2})(?:\s*[/xX×*]\s*(\d{1,4}))?\)?$/
export const num = (s: string) => Number(s.replace(',', '.'))

const PREFIX_RE = /^(?:EN\s*[/xX×]\s*BOY|B\s*[/xX×]\s*H|G\s*[/xX×]\s*Y|W\s*[/xX×]\s*H|ÖLÇÜ|OLCU|EBAT|BOYUT)\s*[:=]?\s*/i
const NAMED_RE = /^(?:EN|B|G|W|GENİŞLİK|GENISLIK)\s*[:=]?\s*(\d{2,5}(?:[.,]\d{1,2})?)\s*(?:CM|MM)?\s*[,;]?\s*(?:BOY|H|Y|YÜKSEKLİK|YUKSEKLIK)\s*[:=]?\s*(\d{2,5}(?:[.,]\d{1,2})?)$/i

/** Doğrama için makul aralık: 25 cm – 20 m genişlik, 25 cm – 10 m yükseklik */
const plausible = (w: number, h: number) => w >= 250 && h >= 250 && w <= 20_000 && h <= 10_000

/**
 * Doğrama ölçü etiketi. Desteklenen yazımlar:
 *   "120/150", "90 / 210", "120x150", "(100/220)", "120/150/90" (üçüncü: parapet)  → cm
 *   "1200x1500", "1200/1500"                                                      → mm
 *   "1.20/1.50", "1,20 x 2,10"                                                    → m
 *   "EN:120 BOY:150", "B=120 H=150", "EN/BOY: 120/150", "120/150 cm", "1200x1500 mm"
 */
export function parseDims(text: string): DimLabel | null {
  let s = text.trim().replace(/\s+/g, ' ')
  if (s.length > 36) return null
  const original = s
  let unitHint: 'cm' | 'mm' | 'm' | null = null
  const um = /\s*\b(CM|MM|M)\.?$/i.exec(s)
  if (um && um.index > 0) {
    unitHint = um[1].toLowerCase() as 'cm' | 'mm' | 'm'
    s = s.slice(0, um.index).trim()
  }
  s = s.replace(PREFIX_RE, '')
  const named = NAMED_RE.exec(s)
  if (named) s = `${named[1]}/${named[2]}`
  if (s.length > 24) return null
  // Metre: "1.20/1.50"
  const mm = METER_RE.exec(s)
  if (mm && unitHint !== 'cm' && unitHint !== 'mm') {
    const w = Number(`${mm[1]}.${mm[2].padEnd(2, '0')}`) * 1000
    const h = Number(`${mm[4]}.${mm[5].padEnd(2, '0')}`) * 1000
    if (!plausible(w, h)) return null
    return { w_mm: Math.round(w), h_mm: Math.round(h), text: original, extra: mm[6] ? Number(mm[6]) : null, unit: 'm' }
  }
  const m = DIM_RE.exec(s)
  if (!m) return null
  const a = num(m[1])
  const b = num(m[3])
  const sep = m[2]
  if (!(a > 0 && b > 0)) return null
  // Türk mimari projelerinde "/" ayraçlı etiket santimetredir; 1000+ değerler ve "x" ile 400+ milimetredir
  const isMm = unitHint === 'mm' || (unitHint !== 'cm' && ((a >= 1000 || b >= 1000) || (sep !== '/' && a >= 400 && b >= 400)))
  const unit: 'cm' | 'mm' = isMm ? 'mm' : 'cm'
  const w = isMm ? a : a * 10
  const h = isMm ? b : b * 10
  if (!plausible(w, h)) return null
  return { w_mm: Math.round(w), h_mm: Math.round(h), text: original, extra: m[4] ? Number(m[4]) : null, unit }
}

/** Ölçü değerinin birimi için kısa ek ("(cm)") */
export const unitSuffix = (u: DimLabel['unit']) => (u === 'cm' ? ' (cm)' : u === 'mm' ? ' (mm)' : ' (m)')

// ------------------------------------------------------------------ poz kodu

/** Ölçü etiketi olmayan, yalnız poz kodu olan yazılar için bilinen doğrama önekleri */
export const KNOWN_PREFIX = /^(P|PN|PE|PC|PK|W|WD|K|KP|KA|KD|D|DK|DP|BK|S|SR|SK|SC|SB|SP|F|FK|FT|OK|KR|KK|KOR|C|CW|CP|CD|V|VT|KM|KC|KB|G|AK|AP)-?\d/

const PREFIX_TYPE: [RegExp, TypeHint][] = [
  [/^(FK|FT|OK|F)\d/, 'fotoselli'],
  [/^(SR|SK|S)\d/, 'surme'],
  [/^(SC|SB|SP)\d/, 'sabit'],
  [/^(KR|KK|KOR|G)\d/, 'korkuluk'],
  [/^(KM|KC|KB)\d/, 'kompozit'],
  [/^(CW|CP|CD|C|V|VT)\d/, 'cephe'],
  [/^(KP|KA|KD|K|D|DK|DP|AK|AP|BK)\d/, 'kapi'],
  [/^(P|PN|PE|PC|PK|W|WD)\d/, 'pencere'],
]

export function typeFromCode(code: string): TypeHint | null {
  const c = code.replace(/[-_.\s]/g, '')
  for (const [re, t] of PREFIX_TYPE) if (re.test(c)) return t
  return null
}

/**
 * Kod eşleştirme anahtarı: "P-01", "P01", "P1", "p.1" → "P1". Aynı poz farklı paftalarda farklı
 * yazılabilir (çizelgede "P-01", planda "P1"); eşleştirme bu anahtarla yapılır.
 */
export function canonCode(code: string): string {
  const u = normalizeKey(code.trim())
  const m = /^([A-Z]{1,4})\s*[-_.]?\s*0*(\d{1,3})([A-Z]?)$/.exec(u)
  return m ? `${m[1]}${Number(m[2])}${m[3]}` : u.replace(/[\s\-_.]/g, '')
}

export function splitCodeDims(text: string): { code: string | null; dims: DimLabel | null } {
  const t = text.replace(/[;]/g, ' ').replace(/\s+/g, ' ').trim()
  const whole = parseDims(t)
  if (whole) return { code: null, dims: whole }
  const code = parsePozLabel(t.replace(/:$/, ''))
  if (code) return { code, dims: null }
  // "P1: 120/150", "P1=120x150", "P1 (120/150)"
  const t2 = t.replace(/^([A-Za-zÇĞİÖŞÜçğıöşü]{1,4}\s*[-_.]?\s*\d{1,3}[A-Z]?)\s*[:=]\s*/, '$1 ')
  const parts = t2.split(' ')
  if (parts.length >= 2) {
    const c = parsePozLabel(parts[0]) ?? (parts.length >= 3 ? parsePozLabel(`${parts[0]} ${parts[1]}`) : null)
    if (c) {
      const rest = parts.slice(parsePozLabel(parts[0]) ? 1 : 2).join(' ')
      const d = parseDims(rest)
      if (d) return { code: c, dims: d }
    }
    // "120/150 P1"
    const c2 = parsePozLabel(parts[parts.length - 1])
    const d2 = parseDims(parts.slice(0, -1).join(' '))
    if (c2 && d2) return { code: c2, dims: d2 }
  }
  return { code: null, dims: null }
}

/**
 * OCR düzeltmesi: poz kodlarında 1 ↔ I/İ/l/|, 0 ↔ O karışıklığı ("KI" → "K1", "Pİ" → "P1",
 * "P-OI" → "P-01"), ölçü etiketlerinde rakam içindeki harfler ("12O/15O" → "120/150").
 * Yalnız OCR yazılarına uygulanır.
 */
export function fixOcrText(raw: string): string {
  let s = raw.trim().toLocaleUpperCase('tr-TR').replace(/[‘’'`"“”]/g, '')
  // İnce/çizgi yazıda "1" sık sık "I", "İ", "L", "|", "T" okunur; "0" ise "O"
  const m = /^([A-ZÇĞŞÖÜ]{1,3}?)-?([0-9OIİLT|!ÎÍ]{1,3}[0-9OIİLT|!]{0,1})$/.exec(s)
  if (m && m[1] && /[0-9IİLT|!ÎÍ]/.test(m[2])) {
    const digits = m[2].replace(/[IİLT|!ÎÍ]/g, '1').replace(/O/g, '0')
    if (/^\d{1,3}$/.test(digits) && Number(digits) > 0 && KNOWN_PREFIX.test(`${m[1]}${digits}`)) return `${m[1]}${s.includes('-') ? '-' : ''}${digits}`
  }
  if (/^[0-9OIİL|]{2,4}\s*[/xX×]\s*[0-9OIİL|]{2,4}$/.test(s) && /\d/.test(s)) s = s.replace(/O/g, '0').replace(/[IİL|]/g, '1')
  if (/^[0-9OIİL|][.,][0-9OIİL|]{2}\s*[/xX×]\s*[0-9OIİL|][.,][0-9OIİL|]{2}$/.test(s) && /\d/.test(s)) s = s.replace(/O/g, '0').replace(/[IİL|]/g, '1')
  return s
}

export const isNumeric = (s: string) => /^\d{1,5}(?:[.,]\d{1,2})?$/.test(s.trim())

/** Adet yazısı: "ADET: 8", "8 ADET", "MİKTAR: 4 AD.", "AD. 4", "4 AD" */
export function parseQty(text: string): number | null {
  const n = normalizeKey(text).replace(/\s+/g, ' ').trim()
  const m =
    /^(?:ADET|ADEDI|MIKTAR|MIKTARI|SAYI|AD\.?)\s*[:=]?\s*(\d{1,4})\s*(?:AD\.?|ADET)?$/.exec(n) ??
    /^(\d{1,4})\s*(?:ADET|AD\.?)$/.exec(n) ??
    /^(?:TOPLAM)\s*[:=]?\s*(\d{1,4})\s*(?:AD\.?|ADET)$/.exec(n)
  if (!m) return null
  const q = Number(m[1])
  return q > 0 && q <= 9999 ? q : null
}
