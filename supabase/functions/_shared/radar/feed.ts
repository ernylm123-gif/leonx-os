/**
 * LEONX Radar — elle yazılmış RSS 2.0 / Atom ayrıştırıcı (DOM bağımlılığı yok).
 *
 * • CDATA, adlı/sayısal varlıklar, ad alanları (content:encoded, dc:date, atom:link) desteklenir.
 * • DOCTYPE/ENTITY bildirimleri yok sayılır (özel varlık genişletme YOK — XXE/"billion laughs" yok).
 * • Bozuk öğe tüm akışı düşürmez: atlanır ve uyarı olarak sayılır.
 * • Öğe sayısı üst sınırlıdır (maxItems).
 */
import { decodeEntities, htmlToText } from './sanitize.ts'
import { squash } from './text.ts'

export interface FeedItem {
  title: string
  link: string | null
  /** Düz metin özet (HTML temizlenmiş) */
  summary: string
  /** ISO 8601 veya null (tarih yoksa / okunamadıysa) */
  publishedAt: string | null
  guid: string | null
}

export interface ParsedFeed {
  kind: 'rss' | 'atom' | 'bilinmiyor'
  title: string | null
  items: FeedItem[]
  warnings: string[]
}

/** Etiket içeriği: CDATA blokları korunarak varlıklar çözülür, iç HTML düz metne çevrilir */
function textOf(raw: string | null, maxLen = 4000): string {
  if (raw == null) return ''
  // CDATA içi ham metindir (varlık çözülmez); dışı XML metnidir
  let out = ''
  let rest = raw
  for (;;) {
    const i = rest.indexOf('<![CDATA[')
    if (i === -1) {
      out += decodeEntities(rest)
      break
    }
    out += decodeEntities(rest.slice(0, i))
    const j = rest.indexOf(']]>', i + 9)
    if (j === -1) {
      out += rest.slice(i + 9)
      break
    }
    out += rest.slice(i + 9, j)
    rest = rest.slice(j + 3)
  }
  // İçerik çoğu zaman kaçışlı HTML'dir: düz metne indir
  return htmlToText(out, maxLen)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** İlk eşleşen alt öğenin ham içeriği (ad alanı öneki isteğe bağlı: "content:encoded" gibi tam ad da verilebilir) */
function child(block: string, names: string[]): string | null {
  for (const name of names) {
    const n = escapeRe(name)
    const prefix = name.includes(':') ? '' : '(?:[A-Za-z_][\\w.-]*:)?'
    const re = new RegExp(`<${prefix}${n}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${prefix}${n}\\s*>)`, 'i')
    const m = re.exec(block)
    if (m) return m[1] ?? ''
  }
  return null
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${escapeRe(name)}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : null
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

/** RFC 822 / RFC 3339 tarih → ISO; okunamazsa null (tarih uydurulmaz) */
export function parseFeedDate(raw: string | null): string | null {
  if (!raw) return null
  const s = squash(raw)
  if (!s) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s)
  if (iso) {
    const [, y, mo, d, h = '00', mi = '00', se = '00', tz] = iso
    let zone = tz ?? 'Z'
    if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`
    const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${se}${zone}`)
    return Number.isFinite(t) ? new Date(t).toISOString() : null
  }
  const rfc = /^(?:[A-Za-z]{3},?\s+)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*([A-Za-z]{1,5}|[+-]\d{4})?$/.exec(s)
  if (rfc) {
    const [, d, mon, yRaw, h = '0', mi = '0', se = '0', zone] = rfc
    const m = MONTHS[mon.toLowerCase()]
    if (m == null) return null
    let y = Number(yRaw)
    if (y < 100) y += y < 70 ? 2000 : 1900
    let offsetMin = 0
    if (zone && /^[+-]\d{4}$/.test(zone)) {
      offsetMin = (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3)))
    } else if (zone && !/^(GMT|UT|UTC|Z)$/i.test(zone)) {
      const named: Record<string, number> = { EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420, TRT: 180, CET: 60, CEST: 120 }
      offsetMin = named[zone.toUpperCase()] ?? 0
    }
    const base = Date.UTC(y, m, Number(d), Number(h), Number(mi), Number(se))
    if (!Number.isFinite(base) || new Date(base).getUTCDate() !== Number(d) || Number(h) > 23 || Number(mi) > 59) return null
    return new Date(base - offsetMin * 60000).toISOString()
  }
  return null
}

function cleanLink(raw: string | null): string | null {
  if (!raw) return null
  const s = squash(decodeEntities(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')))
  return /^https?:\/\//i.test(s) ? s : null
}

/**
 * RSS 2.0 veya Atom metnini ayrıştırır.
 * @param maxItems en fazla bu kadar öğe döner (varsayılan 50)
 */
export function parseFeed(xml: string, maxItems = 50): ParsedFeed {
  const warnings: string[] = []
  const src = xml
    .slice(0, 3_000_000)
    .replace(/^﻿/, '')
    .replace(/<!DOCTYPE[\s\S]*?(\[[\s\S]*?\])?\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  const isAtom = /<(?:[A-Za-z_][\w.-]*:)?feed[\s>]/i.test(src) && !/<(?:[A-Za-z_][\w.-]*:)?rss[\s>]/i.test(src) && !/<(?:[A-Za-z_][\w.-]*:)?channel[\s>]/i.test(src)
  const isRss = /<(?:[A-Za-z_][\w.-]*:)?(rss|channel|rdf:RDF)[\s>]/i.test(src)
  const kind: ParsedFeed['kind'] = isAtom ? 'atom' : isRss ? 'rss' : 'bilinmiyor'
  if (kind === 'bilinmiyor') return { kind, title: null, items: [], warnings: ['RSS/Atom akışı tanınmadı'] }

  const tag = kind === 'atom' ? 'entry' : 'item'
  const blockRe = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${tag}\\s*>`, 'gi')
  const head = src.split(new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tag}[\\s>]`, 'i'))[0]
  const feedTitle = textOf(child(head, ['title']), 300) || null

  const items: FeedItem[] = []
  let m: RegExpExecArray | null
  let seen = 0
  while ((m = blockRe.exec(src))) {
    seen++
    if (items.length >= maxItems) {
      warnings.push(`Öğe sınırı (${maxItems}) aşıldı; fazlası alınmadı`)
      break
    }
    const block = m[1]
    try {
      const title = textOf(child(block, ['title']), 500)
      let link: string | null = null
      if (kind === 'atom') {
        const links = [...block.matchAll(/<(?:[A-Za-z_][\w.-]*:)?link\b([^>]*)\/?>/gi)].map((x) => x[1])
        const alt = links.find((l) => !attr(l, 'rel') || attr(l, 'rel') === 'alternate') ?? links[0]
        link = cleanLink(alt ? attr(alt, 'href') : null)
      } else {
        link = cleanLink(child(block, ['link']))
        const guidRaw = child(block, ['guid'])
        if (!link && guidRaw && /^https?:\/\//i.test(squash(guidRaw))) link = cleanLink(guidRaw)
      }
      const summaryRaw = kind === 'atom'
        ? child(block, ['summary']) ?? child(block, ['content'])
        : child(block, ['description']) ?? child(block, ['content:encoded']) ?? child(block, ['summary'])
      const summary = textOf(summaryRaw, 4000)
      const dateRaw = kind === 'atom'
        ? child(block, ['published']) ?? child(block, ['updated'])
        : child(block, ['pubDate']) ?? child(block, ['dc:date']) ?? child(block, ['date'])
      const publishedAt = parseFeedDate(dateRaw ? textOf(dateRaw, 100) : null)
      if (dateRaw && !publishedAt) warnings.push(`Tarih okunamadı: "${squash(textOf(dateRaw, 60))}"`)
      const guid = squash(textOf(child(block, kind === 'atom' ? ['id'] : ['guid']), 500)) || null
      if (!title && !link) {
        warnings.push('Başlığı ve bağlantısı olmayan öğe atlandı')
        continue
      }
      if (!link) {
        warnings.push(`Bağlantısı olmayan öğe atlandı: "${title.slice(0, 60)}"`)
        continue
      }
      items.push({ title: title || '(başlıksız)', link, summary, publishedAt, guid })
    } catch {
      warnings.push('Bozuk öğe atlandı')
    }
  }
  if (seen === 0) warnings.push('Akışta öğe bulunamadı')
  return { kind, title: feedTitle, items, warnings }
}
