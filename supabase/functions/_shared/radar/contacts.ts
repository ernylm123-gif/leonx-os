/**
 * LEONX Radar — firmanın KENDİ web sitesinden kurumsal iletişim kanalı çıkarma.
 *
 * KVKK ve ticari ileti ilkeleri:
 *  • Yalnız sitenin alan adına (veya alt alan adına) ait e-postalar alınır; başka alan adları atlanır.
 *  • Kişi adına benzeyen yerel kısımlar ("ahmet.yilmaz@", "a.yilmaz@") SAKLANMAZ; yalnız sayılır.
 *  • İK, muhasebe, KVKK, kariyer gibi konu dışı adresler alınmaz.
 *  • Hiçbir adres TAHMİN EDİLMEZ veya üretilmez (ör. "satinalma@firma.com" varsayılmaz);
 *    yalnız sayfada açıkça yazan değerler kaynak adresi ve doğrulama zamanıyla döner.
 */
import { decodeEntities, hostOf, htmlToText } from './sanitize.ts'
import { fold } from './text.ts'

export type ContactKind = 'tedarikci_portali' | 'ihale_adresi' | 'satinalma_eposta' | 'teknik_ofis_eposta' | 'genel_eposta' | 'telefon' | 'iletisim_formu'

export const CONTACT_KIND_LABEL: Record<ContactKind, string> = {
  tedarikci_portali: 'Tedarikçi portalı',
  ihale_adresi: 'İhale / satın alma sayfası',
  satinalma_eposta: 'Satın alma e-postası',
  teknik_ofis_eposta: 'Teknik ofis e-postası',
  genel_eposta: 'Genel e-posta',
  telefon: 'Telefon',
  iletisim_formu: 'İletişim formu',
}

export interface ExtractedContact {
  kind: ContactKind
  value: string
  source_url: string
  verified_at: string
}

export interface ContactExtraction {
  contacts: ExtractedContact[]
  skippedPersonal: number
  skippedForeignDomain: number
  skippedIrrelevant: number
  /** Aynı sitede izlenebilecek iletişim / tedarikçi sayfaları */
  followLinks: string[]
}

/** Alan adının kaydedilebilir kökü (basit: www. atılır; .com.tr gibi iki düzeyli uzantılar korunur) */
export function siteDomain(url: string): string | null {
  const h = hostOf(url)
  if (!h) return null
  const parts = h.replace(/^www\./, '').split('.')
  const twoLevel = /^(com|net|org|gov|edu|bel|k12|gen|av|dr|biz|info|tsk|pol|web|name|tv|bbs)\.tr$/.test(parts.slice(-2).join('.'))
  const keep = twoLevel ? 3 : 2
  return parts.slice(-keep).join('.')
}

export function domainMatches(host: string, base: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  return h === base || h.endsWith('.' + base)
}

const IRRELEVANT = /^(ik|insankaynaklari|insan\.kaynaklari|hr|kariyer|career|careers|jobs|is|muhasebe|accounting|finans|kvkk|privacy|gizlilik|noreply|no-reply|donotreply|webmaster|postmaster|abuse|basin|press|pazarlama|marketing|reklam|bulten|newsletter)$/
const ROLE_WORDS = /(satinalma|satin|purchas|procure|tedarik|supply|supplier|teknik|technical|proje|project|engineering|muhendis|ihale|tender|info|bilgi|iletisim|contact|hello|merhaba|genel|office|ofis|destek|support|sales|satis|musteri|customer|mail|admin|yonetim|merkez|fabrika|sube)/

/**
 * Kişi adına benzeyen yerel kısım mı. Ad.soyad / a.soyad / ad_soyad biçimleri ve kurumsal rol
 * sözcüğü (info, satinalma, teknik…) İÇERMEYEN tüm yerel kısımlar kişisel sayılır (veri en aza
 * indirme: "ahmetyilmaz@" gibi ayırıcısız adlar da saklanmaz).
 */
export function looksPersonal(local: string): boolean {
  const l = fold(local)
  if (/^[a-z][._-][a-z]{2,}$/.test(l)) return true
  if (/^[a-z]{2,}[._-][a-z]{2,}([._-][a-z]{2,})?$/.test(l) && !ROLE_WORDS.test(l)) return true
  return !ROLE_WORDS.test(l)
}

export function classifyEmail(local: string, pageContext: string): ContactKind | null {
  const l = fold(local)
  if (IRRELEVANT.test(l)) return null
  if (/satinalma|satin[._-]?alma|purchas|procure|tedarik|supply|supplier/.test(l)) return 'satinalma_eposta'
  if (/ihale|tender/.test(l)) return 'ihale_adresi'
  if (/teknik|technical|proje|project|engineering|muhendis/.test(l)) return 'teknik_ofis_eposta'
  void pageContext
  return 'genel_eposta'
}

const EMAIL_RE = /[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/g
const PHONE_RE = /(?:\+90|0090|\b0)?[\s(.-]*(?:[2-5]\d{2})[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}\b|\b444[\s.-]?\d{2}[\s.-]?\d{2}\b/g

/** Türk telefon numarasını "+90 312 123 45 67" / "444 12 34" biçimine getirir; geçersizse null */
export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, '')
  if (/^444\d{4}$/.test(d)) return `444 ${d.slice(3, 5)} ${d.slice(5)}`
  let n = d
  if (n.startsWith('0090')) n = n.slice(4)
  else if (n.startsWith('90') && n.length === 12) n = n.slice(2)
  else if (n.startsWith('0') && n.length === 11) n = n.slice(1)
  if (n.length !== 10 || !/^[2-5]/.test(n)) return null
  return `+90 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 8)} ${n.slice(8)}`
}

const LINK_RE = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi

function hrefOf(attrs: string): string | null {
  const m = /\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(` ${attrs}`)
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '').trim() : null
}

/**
 * Bir sayfanın HTML'inden iletişim kanallarını çıkarır.
 * @param website firmanın kayıtlı web sitesi (kanıttan veya sahip tarafından girilmiş)
 */
export function extractContacts(html: string, pageUrl: string, website: string, verifiedAt: string): ContactExtraction {
  const base = siteDomain(website)
  const out: ExtractedContact[] = []
  const res: ContactExtraction = { contacts: out, skippedPersonal: 0, skippedForeignDomain: 0, skippedIrrelevant: 0, followLinks: [] }
  if (!base) return res
  const pageHost = hostOf(pageUrl)
  if (!pageHost || !domainMatches(pageHost, base)) return res // yalnız firmanın kendi sitesi
  const text = htmlToText(html, 200_000)
  const pageCtx = `${pageUrl} ${text.slice(0, 2000)}`
  const push = (c: ExtractedContact) => {
    if (!out.some((x) => x.kind === c.kind && x.value === c.value)) out.push(c)
  }
  const seenEmails = new Set<string>()

  const handleEmail = (raw: string) => {
    const e = raw.trim().replace(/^mailto:/i, '').split('?')[0].toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) || seenEmails.has(e)) return
    seenEmails.add(e)
    const [local, domain] = e.split('@')
    if (!domainMatches(domain, base)) {
      res.skippedForeignDomain++
      return
    }
    const kind = classifyEmail(local, pageCtx)
    if (!kind) {
      res.skippedIrrelevant++
      return
    }
    if (looksPersonal(local)) {
      res.skippedPersonal++
      return
    }
    push({ kind, value: e, source_url: pageUrl, verified_at: verifiedAt })
  }

  // Bağlantılar: mailto, tel, tedarikçi/ihale sayfaları, izlenecek iletişim sayfaları
  for (const m of html.matchAll(LINK_RE)) {
    const href = hrefOf(m[1])
    if (!href) continue
    const label = fold(htmlToText(m[2], 300))
    if (/^mailto:/i.test(href)) {
      handleEmail(decodeURIComponent(href.replace(/^mailto:/i, '').split('?')[0]))
      continue
    }
    if (/^tel:/i.test(href)) {
      const p = normalizePhone(href.slice(4))
      if (p) push({ kind: 'telefon', value: p, source_url: pageUrl, verified_at: verifiedAt })
      continue
    }
    let abs: URL
    try {
      abs = new URL(href, pageUrl)
    } catch {
      continue
    }
    if (abs.protocol !== 'https:' && abs.protocol !== 'http:') continue
    if (!domainMatches(abs.hostname, base)) continue
    abs.hash = ''
    const pathCtx = fold(`${abs.pathname} ${label}`)
    if (/tedarikci|supplier|vendor|tedarik portal|satin ?alma portal|e-?tedarik/.test(pathCtx)) {
      push({ kind: 'tedarikci_portali', value: abs.toString(), source_url: pageUrl, verified_at: verifiedAt })
    } else if (/ihale|tender|satin-?alma|satinalma|procurement/.test(pathCtx)) {
      push({ kind: 'ihale_adresi', value: abs.toString(), source_url: pageUrl, verified_at: verifiedAt })
    }
    if (/iletisim|contact|bize-ulasin|bize ulasin|tedarik|satinalma|satin-alma|ihale|supplier/.test(pathCtx) && abs.toString() !== pageUrl && !res.followLinks.includes(abs.toString())) {
      res.followLinks.push(abs.toString())
    }
  }

  // Düz metindeki e-postalar ve telefonlar
  for (const m of text.matchAll(EMAIL_RE)) handleEmail(m[0])
  let phones = 0
  for (const m of text.matchAll(PHONE_RE)) {
    const p = normalizePhone(m[0])
    if (p && phones < 5) {
      phones++
      push({ kind: 'telefon', value: p, source_url: pageUrl, verified_at: verifiedAt })
    }
  }

  // İletişim formu: iletişim sayfasındaki <form>
  if (/<form\b/i.test(html) && /iletisim|contact|bize ulasin|teklif iste/.test(fold(`${pageUrl} ${text.slice(0, 500)}`))) {
    push({ kind: 'iletisim_formu', value: pageUrl, source_url: pageUrl, verified_at: verifiedAt })
  }
  res.followLinks = res.followLinks.slice(0, 6)
  return res
}

/** Firma sitesinde denenecek yaygın iletişim / tedarikçi yolları (yalnız aynı ana makine) */
export const COMMON_CONTACT_PATHS = ['/iletisim', '/tr/iletisim', '/contact', '/bize-ulasin', '/tedarikci', '/tedarikci-portali', '/satinalma', '/satin-alma', '/ihaleler']
