/**
 * LEONX Radar — SSRF koruması ve güvenli indirme.
 *
 * Kurallar:
 *  • Yalnız https. Adreste kullanıcı adı/şifre olamaz. Varsayılan dışı port reddedilir.
 *  • Ana makine IP adresi (v4/v6, ondalık/onaltılık biçimler dahil) olamaz; localhost, *.local,
 *    *.internal, *.localhost ve tek etiketli adlar reddedilir.
 *  • DNS çözümleyici verilirse çözülen tüm adresler özel/ayrılmış aralıkta olmamalıdır
 *    (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 100.64/10 CGNAT, 0/8, 224/4, 240/4,
 *    ::1, fc00::/7, fe80::/10, ::ffff:özel…).
 *  • İndirilen adresin ana makinesi kaynağın kayıtlı ana makinesine (veya kaynağın açık izin
 *    listesine) eşit olmalıdır. Yönlendirmeler elle izlenir (en çok 3) ve her adımda yeniden denetlenir.
 *  • Yanıt en çok 2 MB, süre 15 sn, içerik türü izin listesinde olmalıdır.
 */
import { hostOf } from './sanitize.ts'

export const MAX_BYTES = 2 * 1024 * 1024
export const TIMEOUT_MS = 15_000
export const MAX_REDIRECTS = 3
export const USER_AGENT = 'LEONX-Radar/1.0 (+https://www.leonxmetal.com)'

export const FEED_TYPES = ['application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml', 'application/rdf+xml']
export const HTML_TYPES = ['text/html', 'application/xhtml+xml']
export const TEXT_TYPES = ['text/plain']
export const JSON_TYPES = ['application/json']

export class GuardError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'GuardError'
  }
}

/** IPv4 dizgesi mi (yalnız dört ondalık blok) */
function parseIPv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s)
  if (!m) return null
  const p = m.slice(1).map(Number)
  return p.every((x) => x >= 0 && x <= 255) ? p : null
}

export function isPrivateIPv4(p: number[]): boolean {
  const [a, b] = p
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) || (a === 203 && b === 0)
  )
}

/** Çözülmüş bir adres (v4 veya v6) özel/ayrılmış aralıkta mı */
export function isPrivateAddress(addr: string): boolean {
  const a = addr.trim().toLowerCase().replace(/^\[|\]$/g, '')
  const v4 = parseIPv4(a)
  if (v4) return isPrivateIPv4(v4)
  if (!a.includes(':')) return true // tanınmayan biçim: güvenli tarafta kal
  if (a === '::' || a === '::1') return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a)
  if (mapped) return isPrivateIPv4(parseIPv4(mapped[1]) ?? [0])
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(a)) return true
  const first = parseInt(a.split(':')[0] || '0', 16)
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10
  if ((first & 0xff00) === 0xff00) return true // çok noktaya yayın
  if (first === 0x2001 && parseInt(a.split(':')[1] || '0', 16) === 0xdb8) return true // belgeleme
  if (first === 0x64 && a.startsWith('64:ff9b:')) return true // NAT64
  return false
}

/** Ana makine adı IP biçiminde mi (ondalık, onaltılık, sekizlik, kısaltılmış IPv4 ve IPv6 dahil) */
export function looksLikeIpHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h.includes(':')) return true
  if (/^[0-9.]+$/.test(h)) return true
  if (/^0x[0-9a-f]+$/.test(h)) return true
  if (h.split('.').every((p) => /^(0x[0-9a-f]+|[0-9]+)$/.test(p))) return true
  return false
}

export interface GuardPolicy {
  /** Kaynağın kayıtlı ana makinesi + açık izin listesi (küçük harf) */
  allowedHosts: string[]
}

/** Statik adres denetimi (ağ isteği yapmaz). Geçerse URL nesnesini döner. */
export function checkUrl(raw: string, policy?: GuardPolicy): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new GuardError('gecersiz', 'Geçersiz adres')
  }
  if (u.protocol !== 'https:') throw new GuardError('protokol', 'Yalnız https adresleri indirilebilir')
  if (u.username || u.password) throw new GuardError('kimlik', 'Adreste kullanıcı adı/şifre olamaz')
  if (u.port && u.port !== '443') throw new GuardError('port', 'Varsayılan dışı port reddedildi')
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  if (!host || looksLikeIpHost(host)) throw new GuardError('ip', 'IP adresiyle indirme yapılmaz')
  if (host === 'localhost' || /\.(localhost|local|internal|intranet|lan|home|corp|arpa)$/.test(host) || !host.includes('.')) {
    throw new GuardError('yerel', 'Yerel/iç ağ adresi reddedildi')
  }
  if (policy) {
    const allowed = policy.allowedHosts.map((h) => h.toLowerCase().replace(/\.$/, ''))
    if (!allowed.includes(host)) throw new GuardError('host', `Ana makine izinli değil: ${host}`)
  }
  return u
}

/** Kaynak adresinden izinli ana makine listesi */
export function policyFor(sourceUrl: string, extraHosts: string[] | null | undefined): GuardPolicy {
  const h = hostOf(sourceUrl)
  return { allowedHosts: [...(h ? [h] : []), ...(extraHosts ?? []).map((x) => x.toLowerCase())] }
}

export interface SafeFetchDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  /** Ana makineyi IP adreslerine çözer (yoksa yalnız statik denetim yapılır) */
  resolve?: (host: string) => Promise<string[]>
}

export interface SafeFetchOptions {
  policy: GuardPolicy
  accept: string[]
  etag?: string | null
  lastModified?: string | null
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  maxBytes?: number
  timeoutMs?: number
}

export interface SafeFetchResult {
  status: number
  finalUrl: string
  contentType: string | null
  body: string
  etag: string | null
  lastModified: string | null
  notModified: boolean
  redirects: number
}

async function checkResolved(host: string, deps: SafeFetchDeps) {
  if (!deps.resolve) return
  let addrs: string[]
  try {
    addrs = await deps.resolve(host)
  } catch {
    throw new GuardError('dns', `Ad çözümlenemedi: ${host}`)
  }
  if (!addrs.length) throw new GuardError('dns', `Ad çözümlenemedi: ${host}`)
  if (addrs.some(isPrivateAddress)) throw new GuardError('ozel_ag', `Özel ağ adresine çözülüyor: ${host}`)
}

async function readCapped(res: Response, max: number): Promise<string> {
  const len = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(len) && len > max) throw new GuardError('boyut', `Yanıt çok büyük (${len} bayt)`)
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      throw new GuardError('boyut', `Yanıt ${Math.round(max / 1024)} KB sınırını aştı`)
    }
    chunks.push(value)
  }
  const all = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    all.set(c, off)
    off += c.byteLength
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(all)
}

/** Güvenli indirme: tüm SSRF kuralları, elle yönlendirme, boyut/süre/içerik türü sınırları */
export async function safeFetch(url: string, opts: SafeFetchOptions, deps: SafeFetchDeps): Promise<SafeFetchResult> {
  const max = opts.maxBytes ?? MAX_BYTES
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = checkUrl(current, opts.policy)
    await checkResolved(u.hostname, deps)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS)
    try {
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: opts.accept.join(', ') + ', */*;q=0.1', ...(opts.headers ?? {}) }
      if (hop === 0 && opts.etag) headers['If-None-Match'] = opts.etag
      if (hop === 0 && opts.lastModified) headers['If-Modified-Since'] = opts.lastModified
      let res: Response
      try {
        res = await deps.fetch(u.toString(), { method: opts.method ?? 'GET', headers, body: opts.body, redirect: 'manual', signal: ctrl.signal })
      } catch (e) {
        if (ctrl.signal.aborted) throw new GuardError('zaman_asimi', 'Zaman aşımı (15 sn)')
        throw new GuardError('ag', `Bağlantı hatası: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        const loc = res.headers.get('location')
        await res.body?.cancel().catch(() => {})
        if (!loc) throw new GuardError('yonlendirme', 'Yönlendirme adresi yok')
        if (hop === MAX_REDIRECTS) throw new GuardError('yonlendirme', `En çok ${MAX_REDIRECTS} yönlendirme izlenir`)
        current = new URL(loc, u).toString()
        continue
      }
      if (res.status === 304) {
        return { status: 304, finalUrl: u.toString(), contentType: null, body: '', etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), notModified: true, redirects: hop }
      }
      const ct = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() || null
      if (res.status >= 200 && res.status < 300) {
        if (!ct || !opts.accept.includes(ct)) {
          await res.body?.cancel().catch(() => {})
          throw new GuardError('icerik_turu', `İzin verilmeyen içerik türü: ${ct ?? 'yok'}`)
        }
      }
      const body = res.status >= 200 && res.status < 300 ? await readCapped(res, max) : (await res.body?.cancel().catch(() => {}), '')
      return { status: res.status, finalUrl: u.toString(), contentType: ct, body, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), notModified: false, redirects: hop }
    } finally {
      clearTimeout(timer)
    }
  }
  throw new GuardError('yonlendirme', 'Yönlendirme sınırı')
}
