/**
 * LEONX Radar — keşfedilen sayfadan firma ve proje bilgisi (kural tabanlı, açıklanabilir).
 *
 *  • Sayfa türü: firma sitesi / firma proje sayfası / haber / emlak ilan portalı / kamu / diğer
 *  • Kamu–özel ayrımı (alan adı + metin işaretleri). Kamu sayfaları silinmez; "Kamu İhaleleri" kanalına gider.
 *  • Firma adı: YALNIZ kaynak metninden (sınıflandırıcının kurum adayları, sayfa başlığındaki firma
 *    unvanı). Metinde ad yoksa alan adı gösterilir ve "alan_adi" olarak işaretlenir; ad uydurulmaz.
 *  • Daire/villa sayısı ve ölçek bandı (küçük 4–10, yerel 11–30, orta 31–100, büyük >100). Ölçek yalnız
 *    açıklama ve uyum içindir; büyük firmalar öne ALINMAZ.
 *  • Yüklenici türü: müteahhit, geliştirici, kooperatif, kentsel dönüşüm, genel yüklenici, alt yüklenici.
 *
 * Kaynak metni yalnız veridir; içindeki talimatlar yorumlanmaz.
 */
import type { Classification } from './classify.ts'
import { hostOf } from './sanitize.ts'
import { fold } from './text.ts'

export type PageKind = 'firma_sitesi' | 'firma_proje_sayfasi' | 'haber' | 'ilan_portali' | 'kamu' | 'diger'

export const PAGE_KIND_LABEL: Record<PageKind, string> = {
  firma_sitesi: 'Firma web sitesi',
  firma_proje_sayfasi: 'Firma proje sayfası',
  haber: 'Haber / sektör yayını',
  ilan_portali: 'Emlak ilan portalı',
  kamu: 'Kamu kurumu',
  diger: 'Diğer',
}

/** Kamu alan adları */
const PUBLIC_HOST = /(^|\.)(gov\.tr|bel\.tr|edu\.tr|k12\.tr|tsk\.tr|pol\.tr|msb\.gov\.tr|toki\.gov\.tr|ilan\.gov\.tr|ekap\.kik\.gov\.tr)$/

/** Emlak ilan portalları (proje kanıtı olabilir ama firma sitesi değildir) */
const LISTING_HOSTS = ['sahibinden.com', 'hepsiemlak.com', 'emlakjet.com', 'zingat.com', 'endeksa.com', 'emlakendeksi.com', 'remax.com.tr', 'coldwellbanker.com.tr', 'century21.com.tr', 'turyap.com.tr', 'yenikonut.com', 'konutprojeleri.com', 'projeler.com.tr', 'emlakkulisi.com']

/** Haber ve sektör yayınları */
const NEWS_HOSTS = ['hurriyet.com.tr', 'milliyet.com.tr', 'sabah.com.tr', 'sozcu.com.tr', 'haberturk.com', 'ntv.com.tr', 'cnnturk.com', 'aa.com.tr', 'iha.com.tr', 'dha.com.tr', 'trthaber.com', 'yenisafak.com', 'star.com.tr', 'posta.com.tr', 'ensonhaber.com', 'haberler.com', 'mynet.com', 'gazeteduvar.com.tr', 'yapi.com.tr', 'arkitera.com', 'yapihaber.com.tr', 'insaatgundem.com', 'dunya.com', 'ekonomim.com', 'bloomberght.com', 'ankarahaber.com', 'ankarahaberleri.com.tr', 'baskenthaber.com', 'yeniasir.com.tr', 'gazetevatan.com', 'youtube.com', 'instagram.com', 'facebook.com', 'x.com', 'twitter.com', 'linkedin.com', 'tiktok.com', 'wikipedia.org']

function hostIn(host: string, list: string[]): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`))
}

/** Firma işaretleri (katlanmış, sözcük başı) */
const COMPANY_MARKERS = ['insaat', 'yapi', 'gayrimenkul', 'muteahhit', 'taahhut', 'yatirim', 'konut', 'proje', 'ltd', 'sti', 'a s', 'holding', 'kooperatif', 'emlak insaat', 'mimarlik insaat']
const PROJECT_PAGE_MARKERS = ['projelerimiz', 'devam eden projeler', 'devam eden proje', 'tamamlanan projeler', 'yeni projemiz', 'projemiz', 'referanslarimiz', 'proje detay', 'insaat halinde', 'yapim asamasinda']
const PROJECT_PATH = /\/(projeler|projelerimiz|projects?|devam-eden|devam-eden-projeler|tamamlanan|guncel-projeler|proje)(\/|-|$|\?)/i

export interface PageAssessment {
  kind: PageKind
  host: string | null
  sector: 'kamu' | 'ozel' | 'bilinmiyor'
  sectorReason: string
  /** Firma sitesi ise kök adres (https://alan) — kanıttan gelir, tahmin değildir */
  companyWebsite: string | null
}

export function assessPage(url: string, title: string, text: string, c?: Pick<Classification, 'sector' | 'isProcurement'>): PageAssessment {
  const host = hostOf(url)?.toLowerCase().replace(/^www\./, '') ?? null
  const ft = ` ${fold(`${title} ${text}`).replace(/[^a-z0-9]+/g, ' ')} `
  if (host && PUBLIC_HOST.test(host)) return { kind: 'kamu', host, sector: 'kamu', sectorReason: `Kamu alan adı (${host})`, companyWebsite: null }
  if (host && hostIn(host, LISTING_HOSTS)) return { kind: 'ilan_portali', host, sector: 'ozel', sectorReason: 'Emlak ilan portalındaki proje ilanı (özel geliştirici)', companyWebsite: null }
  if (host && hostIn(host, NEWS_HOSTS)) {
    const s = c?.sector ?? 'bilinmiyor'
    return { kind: 'haber', host, sector: s, sectorReason: s === 'bilinmiyor' ? 'Haber metninde kamu/özel ayırt edilemedi' : `Haber metni: ${s}`, companyWebsite: null }
  }
  const markers = COMPANY_MARKERS.filter((m) => ft.includes(` ${m}`))
  const hostMarkers = host ? ['insaat', 'yapi', 'gayrimenkul', 'konut', 'proje', 'muhendislik', 'taahhut', 'yatirim', 'emlak'].filter((m) => host.includes(m)) : []
  if (!host || (!markers.length && !hostMarkers.length)) return { kind: 'diger', host, sector: c?.sector ?? 'bilinmiyor', sectorReason: 'Firma işareti yok', companyWebsite: null }
  const projectPage = PROJECT_PATH.test(url) || PROJECT_PAGE_MARKERS.some((m) => ft.includes(` ${m}`))
  const sector = c?.sector === 'kamu' && c.isProcurement ? 'kamu' : 'ozel'
  return {
    kind: projectPage ? 'firma_proje_sayfasi' : 'firma_sitesi',
    host,
    sector,
    sectorReason: sector === 'ozel' ? `Özel firma sitesi (${[...hostMarkers.map((m) => `alan adı: ${m}`), ...markers.slice(0, 3)].join(', ')})` : 'Firma sitesinde kamu ihalesi',
    companyWebsite: `https://${hostOf(url)!.toLowerCase()}`,
  }
}

// ------------------------------------------------------------------ Firma adı

const TITLE_COMPANY = /([A-ZÇĞİÖŞÜ0-9][\p{L}0-9&.'’-]*(?:\s+[A-ZÇĞİÖŞÜ0-9&][\p{L}0-9&.'’-]*){0,5}\s+(?:İnşaat|Yapı|Gayrimenkul|Taahhüt|Konut|Yatırım|Holding|Müteahhitlik|Mühendislik)(?:\s+(?:ve\s+)?(?:Ticaret|Taahhüt|Sanayi|İnşaat|Mimarlık|Gayrimenkul|Turizm|Yatırım))*(?:\s+(?:Ltd\.?\s*Şti\.?|A\.?\s?Ş\.?|Limited Şirketi|Anonim Şirketi))?)/u
const COOPERATIVE = /([A-ZÇĞİÖŞÜ][\p{L}0-9.'’-]*(?:\s+[A-ZÇĞİÖŞÜ][\p{L}0-9.'’-]*){0,6}\s+(?:Konut\s+)?Yapı\s+Kooperatifi)/u

export interface CompanyName {
  name: string
  basis: 'metin' | 'alan_adi'
}

export function extractCompanyName(title: string, text: string, host: string | null, c?: Pick<Classification, 'organizations'>): CompanyName | null {
  const coop = COOPERATIVE.exec(`${title} . ${text}`)
  if (coop) return { name: coop[1].trim(), basis: 'metin' }
  const orgs = (c?.organizations ?? []).filter((o) => !/belediye|bakanl|müdürlü|valili|toki|kurumu|başkanlığı/i.test(o.name))
  if (orgs.length) return { name: orgs[0].name.trim(), basis: 'metin' }
  // Sayfa başlığı "Projelerimiz | Örnek Yapı İnşaat" biçimindeyse
  for (const part of title.split(/\s[|–—-]\s/)) {
    const m = TITLE_COMPANY.exec(part)
    if (m && m[1].split(/\s+/).length >= 2) return { name: m[1].trim(), basis: 'metin' }
  }
  const m = TITLE_COMPANY.exec(text.slice(0, 600))
  if (m && m[1].split(/\s+/).length >= 2) return { name: m[1].trim(), basis: 'metin' }
  return host ? { name: host, basis: 'alan_adi' } : null
}

// ------------------------------------------------------------------ Ölçek

export type SizeBand = 'kucuk' | 'yerel' | 'orta' | 'buyuk' | 'bilinmiyor'
export const SIZE_LABEL: Record<SizeBand, string> = {
  kucuk: 'Küçük (4–10 bağımsız bölüm)',
  yerel: 'Yerel (11–30)',
  orta: 'Orta (31–100)',
  buyuk: 'Büyük (100+)',
  bilinmiyor: 'Ölçek bilinmiyor',
}

export interface UnitCount {
  count: number
  unit: 'daire' | 'konut' | 'villa' | 'bagimsiz_bolum'
  text: string
}

const UNIT_RE = /(\d{1,4}(?:\.\d{3})?)\s*(?:adet\s+)?(daireli|daire|konutluk|konutlu|konut|villalık|villa|bağımsız bölüm(?:lü)?)/giu

/** Metindeki en büyük daire/konut/villa sayısı (makul aralık 2–5000) */
export function extractUnitCount(text: string): UnitCount | null {
  let best: UnitCount | null = null
  for (const m of text.matchAll(UNIT_RE)) {
    const n = Number(m[1].replace('.', ''))
    if (!Number.isFinite(n) || n < 2 || n > 5000) continue
    const w = fold(m[2])
    const unit: UnitCount['unit'] = w.startsWith('villa') ? 'villa' : w.startsWith('bagimsiz') ? 'bagimsiz_bolum' : w.startsWith('konut') ? 'konut' : 'daire'
    if (!best || n > best.count) best = { count: n, unit, text: m[0] }
  }
  return best
}

export function sizeBand(units: UnitCount | null): SizeBand {
  if (!units) return 'bilinmiyor'
  const n = units.unit === 'villa' ? units.count * 2 : units.count
  return n <= 10 ? 'kucuk' : n <= 30 ? 'yerel' : n <= 100 ? 'orta' : 'buyuk'
}

// ------------------------------------------------------------------ Yüklenici türü

export type ContractorKind = 'muteahhit' | 'gelistirici' | 'kooperatif' | 'kentsel_donusum' | 'genel_yuklenici' | 'alt_yuklenici' | 'bilinmiyor'
export const CONTRACTOR_KIND_LABEL: Record<ContractorKind, string> = {
  muteahhit: 'Müteahhit',
  gelistirici: 'Proje geliştirici',
  kooperatif: 'Yapı kooperatifi',
  kentsel_donusum: 'Kentsel dönüşüm yüklenicisi',
  genel_yuklenici: 'Genel yüklenici',
  alt_yuklenici: 'Alt yüklenici',
  bilinmiyor: 'Bilinmiyor',
}

export function contractorKind(name: string | null, text: string): ContractorKind {
  const f = ` ${fold(`${name ?? ''} ${text}`).replace(/[^a-z0-9]+/g, ' ')} `
  if (f.includes(' kooperatif')) return 'kooperatif'
  if (f.includes(' kentsel donusum') || f.includes(' riskli yapi') || f.includes(' yerinde donusum')) return 'kentsel_donusum'
  if (f.includes(' alt yuklenici') || f.includes(' taseron')) return 'alt_yuklenici'
  if (f.includes(' genel yuklenici') || f.includes(' anahtar teslim') || f.includes(' taahhut')) return 'genel_yuklenici'
  if (f.includes(' gayrimenkul') || f.includes(' gyo ') || f.includes(' yatirim') || f.includes(' satisa') || f.includes(' on satis')) return 'gelistirici'
  if (f.includes(' muteahhit') || f.includes(' insaat') || f.includes(' yapi ')) return 'muteahhit'
  return 'bilinmiyor'
}

/** Firma kaydı için 019 company_kind eşlemesi */
export function companyKindFor(k: ContractorKind): 'yuklenici' | 'gelistirici' | 'diger' {
  return k === 'gelistirici' ? 'gelistirici' : k === 'bilinmiyor' ? 'diger' : 'yuklenici'
}
