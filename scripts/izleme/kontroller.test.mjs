import { describe, expect, it } from 'vitest'
import { daysLeft, followChain, runChecks } from './kontroller.mjs'

const ORIGIN = 'https://leonx-os.vercel.app'
const SEC = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'content-security-policy': "default-src 'self'",
  'x-content-type-options': 'nosniff',
}
const INDEX = '<!doctype html><script src="/boot-guard.js"></script><script type="module" src="/assets/index-abc.js"></script><link rel="stylesheet" href="/assets/index-abc.css">'

/** Sağlıklı production'ın sahte yanıtları; `over` ile tek tek bozulur */
function site(over = {}) {
  const routes = {
    'http://leonx-os.vercel.app/': { status: 308, headers: { location: 'https://leonx-os.vercel.app/' } },
    [`${ORIGIN}/`]: { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache, must-revalidate', ...SEC }, body: INDEX },
    [`${ORIGIN}/assets/index-abc.js`]: { status: 200, headers: { 'content-type': 'application/javascript' }, body: '' },
    [`${ORIGIN}/assets/index-abc.css`]: { status: 200, headers: { 'content-type': 'text/css' }, body: '' },
    [`${ORIGIN}/version.json`]: { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store, max-age=0' }, body: JSON.stringify({ version: '0.14.0', commit: 'b6ad1a5' }) },
    [`${ORIGIN}/sw.js`]: { status: 200, headers: { 'content-type': 'application/javascript', 'cache-control': 'no-cache, must-revalidate' }, body: "self.addEventListener('push', () => {})" },
    [`${ORIGIN}/manifest.webmanifest`]: { status: 200, headers: { 'content-type': 'application/manifest+json' }, body: JSON.stringify({ start_url: '/', scope: '/', display: 'standalone' }) },
    [`${ORIGIN}/projeler`]: { status: 200, headers: { 'content-type': 'text/html' }, body: INDEX },
    ...over,
  }
  return async (url) => {
    const r = routes[url]
    if (!r) return new Response('yok', { status: 404 })
    return new Response(r.status >= 300 && r.status < 400 ? null : (r.body ?? ''), { status: r.status, headers: r.headers })
  }
}
const codes = async (over, extra = {}) => (await runChecks({ origin: ORIGIN, fetchImpl: site(over), ...extra })).sorunlar.map((s) => s.kod)

describe('production sağlık kontrolleri', () => {
  it('sağlıklı production: sorun yok, sürüm okunur', async () => {
    const r = await runChecks({ origin: ORIGIN, fetchImpl: site(), expectCommit: 'b6ad1a5290a5' })
    expect(r.sorunlar).toEqual([])
    expect(r.bilgi).toMatchObject({ surum: '0.14.0', commit: 'b6ad1a5', paketler: 2 })
  })

  it('yönlendirme döngüsü yakalanır', async () => {
    const c = await codes({ [`${ORIGIN}/`]: { status: 307, headers: { location: `${ORIGIN}/giris` } }, [`${ORIGIN}/giris`]: { status: 307, headers: { location: `${ORIGIN}/` } } })
    expect(c).toContain('yonlendirme_dongusu')
  })

  it("HTTPS'ten HTTP'ye ve başka alana (ör. Vercel giriş koruması) yönlendirme yakalanır", async () => {
    expect(await codes({ [`${ORIGIN}/projeler`]: { status: 302, headers: { location: 'http://leonx-os.vercel.app/projeler2' } } })).toContain('guvensiz_yonlendirme')
    expect(await codes({ [`${ORIGIN}/`]: { status: 302, headers: { location: 'https://vercel.com/sso-api?url=x' } } })).toContain('alan_disi_yonlendirme')
  })

  it('HTTP → HTTPS kalıcı değilse veya yoksa alarm', async () => {
    expect(await codes({ 'http://leonx-os.vercel.app/': { status: 200, headers: {} } })).toContain('http_yonlendirme')
    expect(await codes({ 'http://leonx-os.vercel.app/': { status: 302, headers: { location: 'https://leonx-os.vercel.app/' } } })).toContain('http_yonlendirme')
  })

  it('karışık içerik (http:// kaynak) yakalanır', async () => {
    const body = INDEX + '<img src="http://cdn.example.com/a.png">'
    expect(await codes({ [`${ORIGIN}/`]: { status: 200, headers: { 'content-type': 'text/html', 'cache-control': 'no-cache', ...SEC }, body } })).toContain('karisik_icerik')
  })

  it('eksik paket (yarım dağıtım) ve yanlış içerik türü yakalanır', async () => {
    expect(await codes({ [`${ORIGIN}/assets/index-abc.js`]: undefined })).toContain('paket_yok')
    // SPA yeniden yazımı paketi HTML olarak döndürürse beyaz ekran olur
    expect(await codes({ [`${ORIGIN}/assets/index-abc.js`]: { status: 200, headers: { 'content-type': 'text/html' }, body: INDEX } })).toContain('paket_tur')
  })

  it('ana sayfa veya sw.js önbelleğe alınabiliyorsa (eski sürüme kilitlenme riski) alarm', async () => {
    expect(await codes({ [`${ORIGIN}/`]: { status: 200, headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=3600', ...SEC }, body: INDEX } })).toContain('ana_sayfa_onbellek')
    expect(await codes({ [`${ORIGIN}/sw.js`]: { status: 200, headers: { 'content-type': 'application/javascript', 'cache-control': 'max-age=86400' }, body: '' } })).toContain('sw_onbellek')
  })

  it("service worker 'fetch' dinlerse alarm (PWA'yı eski sayfaya kilitleyebilir)", async () => {
    expect(await codes({ [`${ORIGIN}/sw.js`]: { status: 200, headers: { 'content-type': 'application/javascript', 'cache-control': 'no-cache' }, body: "self.addEventListener('fetch', e => e.respondWith(caches.match(e.request)))" } })).toContain('sw_fetch')
  })

  it('güvenlik başlıkları eksikse alarm', async () => {
    const c = await codes({ [`${ORIGIN}/`]: { status: 200, headers: { 'content-type': 'text/html', 'cache-control': 'no-cache' }, body: INDEX } })
    expect(c).toEqual(expect.arrayContaining(['hsts', 'csp', 'nosniff']))
  })

  it('yayındaki commit beklenenden farklıysa alarm', async () => {
    expect(await codes({}, { expectCommit: '1234567890' })).toContain('surum_esit_degil')
  })

  it('manifest kapsamı değişirse alarm', async () => {
    expect(await codes({ [`${ORIGIN}/manifest.webmanifest`]: { status: 200, headers: {}, body: JSON.stringify({ start_url: '/giris', scope: '/', display: 'standalone' }) } })).toContain('manifest_kapsam')
  })

  it('yönlendirme zinciri adımları kaydedilir', async () => {
    const { chain } = await followChain(site(), 'http://leonx-os.vercel.app/')
    expect(chain.map((h) => h.status)).toEqual([308, 200])
  })

  it('sertifika kalan gün', () => {
    expect(daysLeft('Nov 27 19:48:08 2026 GMT', Date.parse('2026-11-20T00:00:00Z'))).toBe(7)
  })
})
