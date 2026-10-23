/**
 * LEONX Radar — kaynak içeriğini güvenli düz metne çevirme, adres kanonikleştirme ve özet (hash).
 *
 * Kaynak içerik GÜVENİLMEZ VERİDİR: HTML yalnız düz metne indirgenir, hiçbir betik/talimat
 * çalıştırılmaz veya izlenmez; arayüzde ham HTML hiçbir zaman gösterilmez.
 */
import { squash } from './text.ts'

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', deg: '°', euro: '€',
  ccedil: 'ç', Ccedil: 'Ç', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü', scaron: 'š', iuml: 'ï', acirc: 'â', icirc: 'î', ucirc: 'û',
  times: '×', shy: '',
}

/** HTML/XML varlıklarını çözer (adlı, onluk ve onaltılık). Geçersiz kod noktaları atlanır. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ''
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) return ' '
      return String.fromCodePoint(code)
    }
    return NAMED[body] ?? m
  })
}

/**
 * HTML → düz metin. script/style/noscript/template/iframe/svg blokları ve yorumlar içerikleriyle silinir,
 * blok etiketleri boşluğa dönüşür, varlıklar çözülür, boşluklar sıkıştırılır, uzunluk sınırlanır.
 */
export function htmlToText(html: string, maxLen = 20000): string {
  let s = html.length > 4_000_000 ? html.slice(0, 4_000_000) : html
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  s = s.replace(/<!--[\s\S]*?(-->|$)/g, ' ')
  s = s.replace(/<(script|style|noscript|template|iframe|svg|object|embed|head)\b[\s\S]*?(<\/\1\s*>|$)/gi, ' ')
  s = s.replace(/<\/?(p|div|br|li|ul|ol|tr|td|th|h[1-6]|section|article|header|footer|table|blockquote)\b[^>]*>/gi, ' ')
  s = s.replace(/<[^>]*>/g, ' ')
  s = s.replace(/<[a-zA-Z!/][^<]*$/, ' ')
  s = decodeEntities(s)
  // İkinci tur: varlık olarak kodlanmış etiketler ("&lt;script&gt;") metin olarak kalır ama etiket olarak işlenmez
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, ' ')
  s = squash(s)
  if (s.length > maxLen) s = s.slice(0, maxLen)
  return s
}

const TRACKING_PARAMS = /^(utm_[a-z0-9_]+|fbclid|gclid|dclid|msclkid|yclid|mc_cid|mc_eid|_ga|_gl|igshid|ref_src|ref|spm|cmpid|wt_mc|oly_[a-z_]+|vero_[a-z_]+)$/i

/**
 * Adres kanonikleştirme: yalnız http/https; ana makine küçük harf; varsayılan port ve parça (#…) silinir;
 * izleme parametreleri (utm_*, fbclid, gclid…) atılır, kalan parametreler sıralanır; sondaki "/" yol
 * kökü dışında silinir. Geçersizse null.
 */
export function canonicalizeUrl(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  u.hash = ''
  u.username = ''
  u.password = ''
  u.hostname = u.hostname.toLowerCase().replace(/\.$/, '')
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = ''
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k))
  params.sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1))
  u.search = ''
  for (const [k, v] of params) u.searchParams.append(k, v)
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '') || '/'
  return u.toString()
}

/** SHA-256 (onaltılık) — WebCrypto (Node 20+ ve Deno'da yerleşik) */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** İçerik özeti: başlık + özet (boşluklar ve büyük/küçük harf normalleştirilmiş) */
export function contentHash(title: string, summary: string): Promise<string> {
  return sha256Hex(`${squash(title).toLocaleLowerCase('tr-TR')}\n${squash(summary).toLocaleLowerCase('tr-TR')}`)
}

/** Adresin ana makinesi (küçük harf) veya null */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return null
  }
}
