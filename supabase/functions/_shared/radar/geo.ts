/**
 * LEONX Radar — Türkiye il/ilçe sözlüğü ve çekim ekine dayanıklı konum eşleştirme.
 *
 * • 81 il (plaka sırası) + Ankara'nın 25 ilçesi. Yaygın eski/kısa adlar ("Afyon", "Antep",
 *   "Maraş", "Urfa", "İzmit", "İçel") kabul edilir.
 * • "Ankara'da", "Etimesgut'ta", "Ankarada", "İzmir'in" gibi çekimli biçimler eşleşir.
 * • Başka anlamı da olan adlar (Ordu = askeri birlik, Ağrı = acı, Van, Muş, Batman, Bala,
 *   Evren, Çubuk, Mamak…) yalnız büyük harfle yazılmışsa sayılır ve güveni düşüktür.
 * • Cadde/sokak/bulvar/yol adları konum sayılmaz: "Ankara Caddesi, Bornova/İzmir" → İzmir
 *   (Ankara değil). Bu davranış testlerde belgelenmiştir.
 * • Bir Ankara ilçesi bulunur ama metinde Ankara yerine BAŞKA bir il geçerse (ör. "Adıyaman
 *   Gölbaşı") o il seçilir, ilçe boş bırakılır.
 */
import { fold, stemMatches } from './text.ts'

export const PROVINCES: string[] = [
  'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Amasya', 'Ankara', 'Antalya', 'Artvin', 'Aydın', 'Balıkesir',
  'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli',
  'Diyarbakır', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkari',
  'Hatay', 'Isparta', 'Mersin', 'İstanbul', 'İzmir', 'Kars', 'Kastamonu', 'Kayseri', 'Kırklareli', 'Kırşehir',
  'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Kahramanmaraş', 'Mardin', 'Muğla', 'Muş', 'Nevşehir',
  'Niğde', 'Ordu', 'Rize', 'Sakarya', 'Samsun', 'Siirt', 'Sinop', 'Sivas', 'Tekirdağ', 'Tokat',
  'Trabzon', 'Tunceli', 'Şanlıurfa', 'Uşak', 'Van', 'Yozgat', 'Zonguldak', 'Aksaray', 'Bayburt', 'Karaman',
  'Kırıkkale', 'Batman', 'Şırnak', 'Bartın', 'Ardahan', 'Iğdır', 'Yalova', 'Karabük', 'Kilis', 'Osmaniye',
  'Düzce',
]

export const ANKARA_DISTRICTS: string[] = [
  'Çankaya', 'Yenimahalle', 'Etimesgut', 'Sincan', 'Gölbaşı', 'Pursaklar', 'Keçiören', 'Mamak', 'Altındağ', 'Kahramankazan',
  'Akyurt', 'Polatlı', 'Beypazarı', 'Elmadağ', 'Kalecik', 'Çubuk', 'Haymana', 'Kızılcahamam', 'Ayaş', 'Bala',
  'Çamlıdere', 'Evren', 'Güdül', 'Nallıhan', 'Şereflikoçhisar',
]

/** Ankara'ya komşu iller (yakınlık puanında kısmi puan) */
export const ANKARA_NEIGHBOURS = ['Bolu', 'Çankırı', 'Kırıkkale', 'Kırşehir', 'Aksaray', 'Konya', 'Eskişehir']

/** Büyük iller (arama sorgularında Ankara'dan sonra) */
export const MAJOR_CITIES = ['İstanbul', 'İzmir', 'Bursa', 'Antalya', 'Konya', 'Kocaeli', 'Eskişehir', 'Kayseri', 'Gaziantep', 'Adana']

const ALIASES: Record<string, string> = {
  afyon: 'Afyonkarahisar', antep: 'Gaziantep', maras: 'Kahramanmaraş', urfa: 'Şanlıurfa', izmit: 'Kocaeli', icel: 'Mersin',
  kazan: 'Kahramankazan',
}

/** Başka anlamı olan adlar: yalnız Büyük harfle yazılmışsa ve düşük güvenle */
const AMBIGUOUS = new Set(['ordu', 'agri', 'van', 'mus', 'batman', 'bala', 'evren', 'cubuk', 'kazan', 'kars', 'mamak'])

/** Ardından gelirse yer adını sokak/cadde adına çeviren sözcükler */
const STREET_WORDS = ['cad', 'caddesi', 'cd', 'cadde', 'sok', 'sokak', 'sokagi', 'sk', 'bulvari', 'bulvar', 'blv', 'yolu', 'asfalti', 'mahallesi', 'mah', 'kapisi', 'garaji', 'otogari', 'lokantasi', 'firini', 'pasaji', 'apartmani', 'sitesi', 'kebap', 'kebapcisi', 'ekspres', 'treni']

const fp = new Map(PROVINCES.map((p) => [fold(p), p]))
const fd = new Map(ANKARA_DISTRICTS.map((d) => [fold(d), d]))

export interface GeoMatch {
  city: string | null
  district: string | null
  isAnkara: boolean
  /** 0–1 */
  confidence: number
  /** Eşleşen metin parçası (kaynaktaki yazımıyla) */
  matchedText: string | null
  /** Bulunan diğer iller (bilgi amaçlı) */
  others: string[]
}

interface Hit {
  name: string
  kind: 'il' | 'ilce'
  pos: number
  text: string
  ambiguous: boolean
  explicit: boolean
}

function tokensWithOriginal(text: string): { orig: string; folded: string; base: string; pos: number }[] {
  const out: { orig: string; folded: string; base: string; pos: number }[] = []
  const re = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    const orig = m[0]
    const base = orig.split(/['’]/)[0]
    out.push({ orig, folded: fold(orig), base: fold(base), pos: i++ })
  }
  return out
}

function lookup(map: Map<string, string>, tok: { folded: string; base: string }): string | null {
  if (map.has(tok.base)) return map.get(tok.base)!
  for (const [k, v] of map) if (k.length >= 4 && stemMatches(tok.folded, k)) return v
  return null
}

function scan(text: string): Hit[] {
  const toks = tokensWithOriginal(text)
  const hits: Hit[] = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    const next = toks[i + 1]?.folded ?? ''
    if (STREET_WORDS.includes(next) || /^(cad|sok|bulvar|yolu|asfalt)/.test(next)) continue
    let name: string | null = null
    let kind: 'il' | 'ilce' = 'il'
    const aliasKey = Object.keys(ALIASES).find((a) => t.base === a || (a.length >= 4 && stemMatches(t.folded, a)))
    const alias = aliasKey ? ALIASES[aliasKey] : undefined
    const d = lookup(fd, t)
    const p = lookup(fp, t)
    if (d && !p) {
      name = d
      kind = 'ilce'
    } else if (p) {
      name = p
    } else if (alias) {
      name = alias
      kind = fd.has(fold(alias)) ? 'ilce' : 'il'
    }
    if (!name) continue
    const ambiguous = AMBIGUOUS.has(fold(name)) || AMBIGUOUS.has(t.base)
    const upper = /^\p{Lu}/u.test(t.orig)
    if (ambiguous && !upper) continue
    if (!upper && t.base.length <= 4) continue
    const after = toks[i + 1]?.folded ?? ''
    const explicit = /['’]/.test(t.orig) || ['ili', 'ilinde', 'ilcesi', 'ilcesinde', 'merkez', 'merkezde', 'belediyesi', 'valiligi', 'buyuksehir'].includes(after)
    hits.push({ name, kind, pos: t.pos, text: t.orig, ambiguous, explicit })
  }
  return hits
}

/** Metinden il/ilçe çıkarır. Önce başlık, sonra gövde değerlendirilir. */
export function detectLocation(title: string, body = ''): GeoMatch {
  const hits = [...scan(title).map((h) => ({ ...h, inTitle: true })), ...scan(body).map((h) => ({ ...h, inTitle: false }))]
  if (!hits.length) return { city: null, district: null, isAnkara: false, confidence: 0, matchedText: null, others: [] }
  const provinceHits = hits.filter((h) => h.kind === 'il')
  const districtHits = hits.filter((h) => h.kind === 'ilce')
  const provinces = [...new Set(provinceHits.map((h) => h.name))]
  const others = provinces.filter((p) => p !== 'Ankara')

  if (districtHits.length) {
    const d = districtHits[0]
    if (!provinces.includes('Ankara') && others.length) {
      // "Adıyaman Gölbaşı": ilçe adı başka ildeki aynı adlı ilçe olabilir
      const p = provinceHits.find((h) => h.name !== 'Ankara')!
      return { city: p.name, district: null, isAnkara: false, confidence: 0.6, matchedText: p.text, others: provinces.filter((x) => x !== p.name) }
    }
    const conf = d.ambiguous ? 0.5 : provinces.includes('Ankara') ? 0.95 : 0.85
    return { city: 'Ankara', district: d.name, isAnkara: true, confidence: conf, matchedText: d.text, others }
  }
  // İl: başlıktaki ilk açık (ekli) eşleşme > başlıktaki ilk > gövdedeki ilk açık > gövdedeki ilk
  const pick = hits.find((h) => h.inTitle && h.explicit) ?? hits.find((h) => h.inTitle) ?? hits.find((h) => h.explicit) ?? hits[0]
  let conf = pick.ambiguous ? 0.45 : pick.explicit ? 0.85 : 0.7
  if (provinces.length > 1) conf -= 0.15
  return { city: pick.name, district: null, isAnkara: pick.name === 'Ankara', confidence: Math.max(0.2, Math.round(conf * 100) / 100), matchedText: pick.text, others: provinces.filter((x) => x !== pick.name) }
}

/** Ankara yakınlığı (0–1): Ankara/ilçesi 1, komşu il 0.6, bilinen başka il 0.2, bilinmiyor 0.3 */
export function ankaraProximity(city: string | null): number {
  if (!city) return 0.3
  if (city === 'Ankara') return 1
  if (ANKARA_NEIGHBOURS.includes(city)) return 0.6
  return 0.2
}
