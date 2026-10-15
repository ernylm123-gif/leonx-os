/**
 * Kat ve mahal bilgisi (Faz 5.2): pafta başlığından kat adı ve "tek plan birden fazla kat için
 * geçerli" çarpanı (ör. "NORMAL KAT PLANI (1.-4. KATLAR)" → 4), plan yazılarından mahal adları.
 *
 * Kat çarpanı yalnız başlıkta AÇIKÇA yazıyorsa çıkarılır ve adayın gerekçesinde gösterilir;
 * çizelge adediyle karşılaştırılır, uyuşmazlık sessizce düzeltilmez.
 */
import { normalizeKey } from '@/quantity/detect'

export interface FloorInfo {
  /** Kat adı (ör. "Zemin kat", "1. kat", "Normal kat") */
  label: string | null
  /** Plan kaç kat için geçerli (yazıyorsa) */
  multiplier: number | null
  /** Çarpanın okunduğu yazı */
  why: string | null
}

const N = (s: string) => normalizeKey(s).replace(/\s+/g, ' ').trim()

export function floorInfo(title: string | null): FloorInfo {
  if (!title) return { label: null, multiplier: null, why: null }
  const n = N(title)
  let label: string | null = null
  if (/ZEMIN KAT/.test(n)) label = 'Zemin kat'
  else if (/BODRUM/.test(n)) label = 'Bodrum kat'
  else if (/CATI KAT|CATI ARASI/.test(n)) label = 'Çatı katı'
  else if (/ASMA KAT/.test(n)) label = 'Asma kat'
  else if (/NORMAL KAT|TIP KAT/.test(n)) label = 'Normal kat'
  else {
    const m = /(\d{1,2})\s*\.\s*KAT/.exec(n)
    if (m) label = `${m[1]}. kat`
  }
  let multiplier: number | null = null
  // "1.-4. KATLAR", "1-4. KAT", "2.-5.KATLAR"
  const range = /(\d{1,2})\s*\.?\s*[-–]\s*(\d{1,2})\s*\.?\s*(?:NORMAL\s+)?KAT/.exec(n)
  if (range && Number(range[2]) > Number(range[1])) multiplier = Number(range[2]) - Number(range[1]) + 1
  // "(4 KAT)", "4 ADET NORMAL KAT", "4 KAT ICIN"
  if (multiplier == null) {
    const cnt = /(?:^|[^\d.])(\d{1,2})(?!\s*\.)\s+(?:ADET\s+)?(?:NORMAL\s+|TIP\s+)?KAT(?:LAR)?\b/.exec(n)
    if (cnt && Number(cnt[1]) > 1) multiplier = Number(cnt[1])
  }
  // "TİP KAT ×4", "(x4)"
  if (multiplier == null && /KAT/.test(n)) {
    const x = /[X×*]\s*(\d{1,2})\b/.exec(n)
    if (x && Number(x[1]) > 1) multiplier = Number(x[1])
  }
  // "1., 2. VE 3. KAT PLANI"
  if (multiplier == null) {
    const list = /((?:\d{1,2}\s*\.\s*(?:,|VE)\s*)+\d{1,2}\s*\.)\s*KAT/.exec(n)
    if (list) multiplier = (list[1].match(/\d{1,2}/g) ?? []).length || null
  }
  if (multiplier != null && (multiplier < 2 || multiplier > 60)) multiplier = null
  return { label, multiplier, why: multiplier ? title : null }
}

const ROOM_RE =
  /^(SALON|OTURMA( ODASI)?|MUTFAK|(EBEVEYN )?YATAK ODASI( \d)?|COCUK ODASI( \d)?|CALISMA ODASI|ODA( \d)?|BANYO|EBEVEYN BANYO|WC|W\.C\.|DUS|ANTRE|HOL|KORIDOR|BALKON|TERAS|KILER|CAMASIRHANE|YEMEK( ODASI)?|GIYINME( ODASI)?|MERDIVEN( EVI)?|OFIS|TOPLANTI ODASI|DEPO|LOBI|DUKKAN|MAGAZA|KAZAN DAIRESI|OTOPARK|GIRIS( HOLU)?|RUZGARLIK|SALON \/ MUTFAK|SALON\+MUTFAK|ACIK MUTFAK)$/

/** Yazı bir mahal adı mı ("SALON", "YATAK ODASI 2"); alan yazısı ("32,50 m²") değil */
export function isRoomName(text: string): boolean {
  const n = N(text)
  return n.length <= 30 && ROOM_RE.test(n)
}

/** Ekranda gösterim: "YATAK ODASI" → "Yatak odası" */
export function roomLabel(text: string): string {
  const t = text.trim().toLocaleLowerCase('tr-TR')
  return t.charAt(0).toLocaleUpperCase('tr-TR') + t.slice(1)
}
