/**
 * Doğrama teknik özellikleri (Faz 5.2): malzeme, profil sistemi, açılım, kanat sayısı, cam,
 * renk, mahal/kat ve montaj notları — YALNIZ çizimdeki yazılardan okunur, hiçbir değer uydurulmaz.
 *
 * Her özellik üç durumdan biriyle sunulur:
 *   dogrulandi  Çizimden doğrulandı: pozun kendi satırında/kartında/etiketinde (vektör yazı) okundu
 *   aday        Güçlü aday — kullanıcı onayı gerekli: genel nottan, OCR'dan, kod önekinden veya
 *               görünüş çiziminden (açılım üçgeni, kayıtlar) çıkarıldı
 *   belirsiz    Belirsiz / eksik: çizimde bulunamadı
 */
import { normalizeKey } from '@/quantity/detect'

export type AttrStatus = 'dogrulandi' | 'aday' | 'belirsiz'

export const ATTR_STATUS_LABEL: Record<AttrStatus, string> = {
  dogrulandi: 'Çizimden doğrulandı',
  aday: 'Güçlü aday — onay gerekli',
  belirsiz: 'Belirsiz / eksik bilgi',
}

export type AttrKey = 'malzeme' | 'sistem' | 'acilim' | 'kanat' | 'bolme' | 'cam' | 'renk' | 'kat' | 'mahal' | 'not'

export const ATTR_LABEL: Record<AttrKey, string> = {
  malzeme: 'Malzeme',
  sistem: 'Profil sistemi / seri',
  acilim: 'Açılım türü',
  kanat: 'Kanat sayısı',
  bolme: 'Bölme (sabit/açılır)',
  cam: 'Cam',
  renk: 'Renk',
  kat: 'Kat',
  mahal: 'Mahal',
  not: 'Montaj / teknik notlar',
}

/** Raporda ve incelemede gösterilen sıra; "belirsiz" olarak listelenecek temel özellikler */
export const CORE_ATTRS: AttrKey[] = ['malzeme', 'sistem', 'acilim', 'kanat', 'cam', 'renk']

export interface AttrValue {
  value: string
  status: AttrStatus
  /** Kanıt: hangi sayfadaki hangi yazıdan/çizimden okundu */
  source: string
}

export type PozAttributes = Partial<Record<AttrKey, AttrValue>>

export interface AttrText {
  text: string
  /** Kaynak açıklaması (ör. "S1 · kart P-01") */
  origin: string
  /** Yazı doğrudan bu poza mı ait (satır, kart, etiket)? Genel not ise false */
  direct: boolean
  /** OCR ile okunduysa true (doğrulandı sayılmaz) */
  ocr?: boolean
}

const N = (s: string) => normalizeKey(s).replace(/\s+/g, ' ').trim()

// ------------------------------------------------------------------ eşleştiriciler

const MATERIALS: [RegExp, string][] = [
  [/\bPVC\b|\bU-?PVC\b/, 'PVC'],
  [/ALUMINYUM|ALUMINIUM|ALUMINUM|\bALU\b|\bAL\.? (DOGRAMA|PENCERE|KAPI)/, 'Alüminyum'],
  [/AHSAP|MASIF|\bMDF\b|LAMINAT/, 'Ahşap'],
  [/CELIK|DEMIR|PASLANMAZ/, 'Çelik'],
]

/** Türkiye pazarında yaygın profil sistemi markaları (yalnız yazıda geçerse okunur) */
const BRANDS = /\b(REHAU|VEKA|WINSA|EGEPEN|PIMAPEN|FIRAT|KALEN|ADOPEN|AKPEN|TURKPEN|ALUPLAST|KOMMERLING|SALAMANDER|ALUMIL|ASAS|SCHUCO|REYNAERS|CORTIZO|WICONA|TECHNAL|AKCALI|SISTEM ALUMINYUM|ISIK ALUMINYUM)\b/

const OPENINGS: [RegExp, string, string][] = [
  [/CIFT ACILIM|CIFT ACILIR|DREH ?KIPP|TILT ?(AND|&) ?TURN/, 'cift_acilim', 'Çift açılım'],
  [/HEBE ?SCHIEBE|KALDIR ?SUR/, 'surme', 'Kaldır-sür'],
  [/SURME|KAYAR|SLIDING/, 'surme', 'Sürme'],
  [/KATLANIR|FOLDING/, 'katlanir', 'Katlanır'],
  [/PIVOT/, 'pivot', 'Pivot'],
  [/VASISTAS|ALTTAN ACILIR|TILT\b/, 'vasistas', 'Vasistas'],
  [/USTTEN ASKILI|USTTEN ACILIR|TOP ?HUNG/, 'ust_askili', 'Üstten askılı'],
  [/FOTOSEL/, 'fotoselli', 'Fotoselli'],
  [/ACILIR|ACILIM|KANATLI/, 'acilir', 'Açılır'],
  [/\bSABIT\b|\bFIX(ED)?\b/, 'sabit', 'Sabit'],
]

/** Açılım yazısını normalize kodlara ayırır ("SABİT + AÇILIR" → ['sabit','acilir']) */
export function openingCodes(text: string): { codes: string[]; label: string } | null {
  const n = N(text).replace(/^ACILIM\s*(TURU)?\s*[:=]\s*/, '')
  const parts = n.split(/\s*(?:\+|\/|,| VE )\s*/).filter(Boolean)
  const codes: string[] = []
  const labels: string[] = []
  for (const p of parts) {
    for (const [re, code, label] of OPENINGS) {
      if (re.test(p)) {
        if (!codes.includes(code)) {
          codes.push(code)
          labels.push(label)
        }
        break
      }
    }
  }
  if (!codes.length) return null
  return { codes, label: labels.join(' + ') }
}

const GLASS_COMBO = /(\d{1,2}(?:[.,]\d)?\s*\+\s*\d{1,2}\s*\+\s*\d{1,2}(?:[.,]\d)?(?:\s*\+\s*\d{1,2}\s*\+\s*\d{1,2}(?:[.,]\d)?)?)/
const GLASS_WORDS: [RegExp, string][] = [
  [/ISICAM|ISI CAM|CIFT CAM|IKILI CAM/, 'ısıcam'],
  [/UCLU CAM|3 ?LU CAM/, 'üçlü cam'],
  [/LAMINE|LAMINATED|\b\d{2}\.\d\b/, 'lamine'],
  [/TEMPERLI|TEMPER/, 'temperli'],
  [/LOW-?E|KONFOR|ISI KONTROL/, 'Low-E'],
  [/REFLEKTE|GUNES KONTROL/, 'reflekte'],
  [/BUZLU|DESENLI|KUMLAMA/, 'buzlu'],
  [/FUME/, 'füme'],
]

const COLOR_WORDS: [RegExp, string][] = [
  [/ANTRASIT/, 'antrasit'],
  [/BEYAZ/, 'beyaz'],
  [/SIYAH/, 'siyah'],
  [/\bGRI\b/, 'gri'],
  [/ALTIN MESE|GOLDEN OAK/, 'altın meşe'],
  [/\bMESE\b/, 'meşe'],
  [/CEVIZ/, 'ceviz'],
  [/ELOKSAL/, 'eloksal'],
  [/NATUREL|NATURAL/, 'naturel'],
  [/BRONZ/, 'bronz'],
]

const NOTE_WORDS = /MONTAJ|DENIZLIK|SOVE|PANJUR|SINEKLIK|KEPENK|YANGIN|YERINDE|KABA (INSAAT|OLCU)|IMALAT ONCESI|SIZDIRMAZ|SILIKON|DUBEL/

type Found = { value: string; text: string }

function matchMaterial(t: string): Found | null {
  const n = N(t)
  for (const [re, v] of MATERIALS) if (re.test(n)) return { value: v, text: t }
  return null
}

function afterLabel(t: string, labels: RegExp): string | null {
  if (!new RegExp(`^(?:${labels.source})\\s*[:=]\\s*.{2,80}$`).test(N(t))) return null
  return t.slice(t.search(/[:=]/) + 1).trim() || null
}

function matchSystem(t: string): Found | null {
  const lab = afterLabel(t, /PROFIL SISTEMI|PROFIL SERISI|PROFIL|SISTEM|SERI|SERISI/)
  if (lab) return { value: lab, text: t }
  const n = N(t)
  const b = BRANDS.exec(n)
  if (b) return { value: t.trim().slice(0, 80), text: t }
  const s = /\b\d{2}\s*(MM)?\s*SERI\b|\b\d\s*ODACIKLI\b|\bISI YALITIMLI\b.*SERI/.exec(n)
  if (s) return { value: t.trim().slice(0, 80), text: t }
  return null
}

function matchOpening(t: string): Found | null {
  const n = N(t)
  // Yalnız açılım bildiren yazılar ("AÇILIM: ...", "ÇİFT AÇILIM", "SABİT + AÇILIR"); "KAPI" gibi tür yazıları değil
  if (!/ACILIM|ACILIR|VASISTAS|SURME|KAYAR|SABIT|KATLANIR|PIVOT|DREH|KIPP|ASKILI|HEBE|FIX/.test(n)) return null
  const o = openingCodes(t)
  return o ? { value: o.label, text: t } : null
}

function matchSash(t: string): Found | null {
  const n = N(t)
  if (/\bTEK KANAT/.test(n)) return { value: '1', text: t }
  if (/\b(CIFT|IKI) KANAT/.test(n)) return { value: '2', text: t }
  const m = /\b(\d)\s*KANAT/.exec(n)
  return m ? { value: m[1], text: t } : null
}

function matchGlass(t: string): Found | null {
  const n = N(t)
  const combo = GLASS_COMBO.exec(n)
  const words = GLASS_WORDS.filter(([re]) => re.test(n)).map(([, w]) => w)
  const isGlass = /\bCAM\b|CAMI|GLASS|ISICAM/.test(n) || combo
  if (!isGlass) return null
  const parts = [combo ? combo[1].replace(/\s+/g, '') : null, ...words].filter(Boolean)
  if (!parts.length) return null
  return { value: [...new Set(parts)].join(' '), text: t }
}

function matchColor(t: string): Found | null {
  const n = N(t)
  const ral = /\bRAL\s*-?\s*(\d{4})\b/.exec(n)
  const word = COLOR_WORDS.find(([re]) => re.test(n))?.[1]
  if (ral) return { value: `RAL ${ral[1]}${word ? ` ${word}` : ''}`, text: t }
  const lab = afterLabel(t, /RENK|RENGI|COLOR/)
  if (lab) return { value: lab, text: t }
  if (word && /RENK|PROFIL|DOGRAMA|PVC|ALUMINYUM|KASA/.test(n)) return { value: word, text: t }
  return null
}

function matchNote(t: string): Found | null {
  return NOTE_WORDS.test(N(t)) && t.length <= 160 ? { value: t.trim(), text: t } : null
}

const MATCHERS: [AttrKey, (t: string) => Found | null][] = [
  ['malzeme', matchMaterial],
  ['sistem', matchSystem],
  ['acilim', matchOpening],
  ['kanat', matchSash],
  ['cam', matchGlass],
  ['renk', matchColor],
  ['not', matchNote],
]

/**
 * Yazılardan özellik çıkarımı. Öncelik: pozun kendi vektör yazısı (doğrulandı) > pozun kendi
 * OCR yazısı (aday) > genel not/yakındaki yazı (aday). Bir özellik için ilk bulunan değer alınır;
 * aynı öncelikte çelişen değerler varsa özellik "aday" olur ve kanıtta ikisi de belirtilir.
 */
export function extractAttributes(texts: AttrText[]): PozAttributes {
  const out: PozAttributes = {}
  const tiers: AttrText[][] = [texts.filter((t) => t.direct && !t.ocr), texts.filter((t) => t.direct && t.ocr), texts.filter((t) => !t.direct)]
  for (const [key, fn] of MATCHERS) {
    for (let tier = 0; tier < tiers.length && !out[key]; tier++) {
      const hits = tiers[tier].map((t) => ({ t, f: fn(t.text) })).filter((x): x is { t: AttrText; f: Found } => !!x.f)
      if (!hits.length) continue
      if (key === 'not') {
        const vals = [...new Set(hits.map((h) => h.f.value))].slice(0, 6)
        out.not = { value: vals.join(' · '), status: tier === 0 ? 'dogrulandi' : 'aday', source: hits.map((h) => h.t.origin).filter((v, i, a) => a.indexOf(v) === i).join(', ') }
        break
      }
      const distinct = [...new Set(hits.map((h) => h.f.value))]
      const first = hits[0]
      const conflict = distinct.length > 1 && key !== 'malzeme' ? `; farklı değerler de var: ${distinct.slice(1, 3).join(', ')}` : ''
      out[key] = {
        value: first.f.value,
        status: tier === 0 && !conflict ? 'dogrulandi' : 'aday',
        source: `${first.t.origin}: "${first.f.text.trim().slice(0, 80)}"${tier === 2 ? ' (genel not)' : ''}${first.t.ocr ? ' (OCR)' : ''}${conflict}`,
      }
    }
  }
  return out
}

/** Eksik temel özellikler "belirsiz" olarak eklenir (raporda ve incelemede listelenir) */
export function withMissing(attrs: PozAttributes, keys: AttrKey[] = CORE_ATTRS): PozAttributes {
  const out: PozAttributes = { ...attrs }
  for (const k of keys) if (!out[k]) out[k] = { value: '', status: 'belirsiz', source: 'Çizimde bulunamadı' }
  return out
}

/** Özelliği yalnız daha zayıf durumdaysa geometri/önek çıkarımıyla doldurur (aday) */
export function suggestAttr(attrs: PozAttributes, key: AttrKey, value: string, source: string): void {
  const cur = attrs[key]
  if (!cur || cur.status === 'belirsiz' || !cur.value) attrs[key] = { value, status: 'aday', source }
}
