import { describe, expect, it } from 'vitest'
import { checkUrl, FEED_TYPES, GuardError, isPrivateAddress, policyFor, safeFetch, type SafeFetchDeps } from './urlGuard.ts'

const policy = policyFor('https://akis.ornek.test/rss', ['cdn.ornek.test'])
const code = (fn: () => unknown) => {
  try {
    fn()
    return null
  } catch (e) {
    return e instanceof GuardError ? e.code : 'baska'
  }
}

function fakeFetch(map: Record<string, () => Response>): SafeFetchDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    fetch: async (url) => {
      calls.push(url)
      const f = map[url]
      if (!f) throw new Error(`beklenmeyen istek ${url}`)
      return f()
    },
  }
}

describe('urlGuard — statik denetim', () => {
  it('yalnız https, kimliksiz, varsayılan port', () => {
    expect(code(() => checkUrl('http://akis.ornek.test/rss', policy))).toBe('protokol')
    expect(code(() => checkUrl('https://kul:sifre@akis.ornek.test/rss', policy))).toBe('kimlik')
    expect(code(() => checkUrl('https://akis.ornek.test:8443/rss', policy))).toBe('port')
    expect(code(() => checkUrl('https://akis.ornek.test:443/rss', policy))).toBeNull()
  })
  it('IP adresleri (v4, ondalık, onaltılık, IPv6 geri döngü) ve yerel adlar', () => {
    for (const u of ['https://127.0.0.1/', 'https://10.0.0.5/', 'https://2130706433/', 'https://0x7f000001/', 'https://[::1]/', 'https://[fd00::1]/', 'https://169.254.169.254/latest/meta-data']) {
      expect(code(() => checkUrl(u))).toBe('ip')
    }
    expect(code(() => checkUrl('https://localhost/'))).toBe('yerel')
    expect(code(() => checkUrl('https://db.internal/'))).toBe('yerel')
    expect(code(() => checkUrl('https://intranet/'))).toBe('yerel')
  })
  it('kayıtlı ana makine dışı reddedilir; izin listesi kabul edilir', () => {
    expect(code(() => checkUrl('https://baska.test/rss', policy))).toBe('host')
    expect(code(() => checkUrl('https://cdn.ornek.test/rss', policy))).toBeNull()
  })
  it('özel/ayrılmış aralıklar', () => {
    for (const a of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '100.127.255.255', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fc00::1', 'fd12::3', '::ffff:10.0.0.1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(a), a).toBe(true)
    }
    for (const a of ['93.184.216.34', '172.32.0.1', '100.128.0.1', '2a00:1450:4001::1']) expect(isPrivateAddress(a), a).toBe(false)
  })
})

describe('urlGuard — güvenli indirme', () => {
  const rss = () => new Response('<rss><channel></channel></rss>', { status: 200, headers: { 'content-type': 'application/rss+xml; charset=utf-8', etag: '"v2"' } })

  it('özel adrese çözülen ad reddedilir (DNS yeniden bağlama)', async () => {
    const deps = { ...fakeFetch({}), resolve: async () => ['10.0.0.7'] }
    await expect(safeFetch('https://akis.ornek.test/rss', { policy, accept: FEED_TYPES }, deps)).rejects.toMatchObject({ code: 'ozel_ag' })
    expect(deps.calls).toHaveLength(0)
  })
  it('başka ana makineye yönlendirme reddedilir; aynı makinede izlenir', async () => {
    const deps = fakeFetch({
      'https://akis.ornek.test/rss': () => new Response(null, { status: 302, headers: { location: 'https://kotu.test/rss' } }),
    })
    await expect(safeFetch('https://akis.ornek.test/rss', { policy, accept: FEED_TYPES }, deps)).rejects.toMatchObject({ code: 'host' })
    const ok = fakeFetch({
      'https://akis.ornek.test/eski': () => new Response(null, { status: 301, headers: { location: '/rss' } }),
      'https://akis.ornek.test/rss': rss,
    })
    const r = await safeFetch('https://akis.ornek.test/eski', { policy, accept: FEED_TYPES }, ok)
    expect(r.status).toBe(200)
    expect(r.redirects).toBe(1)
    expect(r.etag).toBe('"v2"')
  })
  it('özel IP adresine yönlendirme ve en çok 3 yönlendirme', async () => {
    const toIp = fakeFetch({ 'https://akis.ornek.test/rss': () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } }) })
    await expect(safeFetch('https://akis.ornek.test/rss', { policy, accept: FEED_TYPES }, toIp)).rejects.toMatchObject({ code: 'ip' })
    const loop = fakeFetch({ 'https://akis.ornek.test/rss': () => new Response(null, { status: 302, headers: { location: '/rss' } }) })
    await expect(safeFetch('https://akis.ornek.test/rss', { policy, accept: FEED_TYPES }, loop)).rejects.toMatchObject({ code: 'yonlendirme' })
    expect(loop.calls).toHaveLength(4)
  })
  it('koşullu GET: 304 değişmedi; içerik türü ve boyut sınırı', async () => {
    let sent: Record<string, string> = {}
    const deps: SafeFetchDeps = {
      fetch: async (_u, init) => {
        sent = init.headers as Record<string, string>
        return new Response(null, { status: 304 })
      },
    }
    const r = await safeFetch('https://akis.ornek.test/rss', { policy, accept: FEED_TYPES, etag: '"v1"', lastModified: 'Mon, 05 Oct 2026 10:00:00 GMT' }, deps)
    expect(r.notModified).toBe(true)
    expect(sent['If-None-Match']).toBe('"v1"')
    expect(sent['User-Agent']).toContain('LEONX-Radar')
    const html = fakeFetch({ 'https://akis.ornek.test/rss': () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }) })
    await expect(safeFetch('https://akis.ornek.test/rss', { policy, accept: FEED_TYPES }, html)).rejects.toMatchObject({ code: 'icerik_turu' })
    const big = fakeFetch({ 'https://akis.ornek.test/rss': () => new Response('x'.repeat(5000), { status: 200, headers: { 'content-type': 'application/xml' } }) })
    await expect(safeFetch('https://akis.ornek.test/rss', { policy, accept: FEED_TYPES, maxBytes: 1000 }, big)).rejects.toMatchObject({ code: 'boyut' })
  })
  it('zaman aşımı', async () => {
    const slow: SafeFetchDeps = {
      fetch: (_u, init) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted')))),
    }
    await expect(safeFetch('https://akis.ornek.test/rss', { policy, accept: FEED_TYPES, timeoutMs: 30 }, slow)).rejects.toMatchObject({ code: 'zaman_asimi' })
  })
})
