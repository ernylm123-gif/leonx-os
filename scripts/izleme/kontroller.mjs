// LEONX OS — production sağlık kontrolleri (saf mantık; ağ erişimi dışarıdan verilen fetch ile).
// Hem zamanlanmış izleme (uretim-izleme.yml) hem dağıtım kontrolü (dagitim-kontrol.yml) kullanır.
// Yalnız okur; production'a, Supabase'e veya kullanıcı verisine hiçbir şey yazmaz.

const MAX_HOPS = 5

/** Tek isteği yönlendirmeleri ELLE izleyerek yapar: döngü, http'ye düşme ve başka alana kaçış yakalanır */
export async function followChain(fetchImpl, url, headers = {}) {
  const chain = []
  let current = url
  for (let i = 0; i <= MAX_HOPS; i++) {
    const res = await fetchImpl(current, { redirect: 'manual', headers })
    const location = res.headers.get('location')
    chain.push({ url: current, status: res.status, location })
    if (res.status < 300 || res.status >= 400 || !location) return { chain, res }
    const next = new URL(location, current).href
    if (chain.some((h) => h.url === next)) return { chain, res, loop: true }
    current = next
  }
  return { chain, res: null, tooLong: true }
}

const HSTS_MIN = 31536000

/**
 * Tüm kontrolleri çalıştırır. Dönen `sorunlar` boşsa sağlıklıdır.
 * @param {{ origin: string, fetchImpl: typeof fetch, headers?: Record<string,string>, expectCommit?: string, checkHttpRedirect?: boolean }} o
 */
export async function runChecks({ origin, fetchImpl, headers = {}, expectCommit, checkHttpRedirect = true }) {
  const sorunlar = []
  const bilgi = {}
  const fail = (kod, mesaj) => sorunlar.push({ kod, mesaj })
  const base = new URL(origin)
  const get = async (path) => {
    const { chain, res, loop, tooLong } = await followChain(fetchImpl, new URL(path, base).href, headers)
    if (loop) fail('yonlendirme_dongusu', `${path}: yönlendirme döngüsü (${chain.map((h) => h.status).join(' → ')})`)
    if (tooLong) fail('yonlendirme_zinciri', `${path}: ${MAX_HOPS}'ten fazla yönlendirme`)
    for (const h of chain.slice(1)) {
      const u = new URL(h.url)
      if (u.protocol !== 'https:') fail('guvensiz_yonlendirme', `${path}: HTTPS'ten HTTP'ye yönlendirme (${h.url})`)
      if (u.host !== base.host) fail('alan_disi_yonlendirme', `${path}: başka alana yönlendirme (${u.host}) — erişim koruması veya yanlış alan adı olabilir`)
    }
    return res
  }

  // 1) HTTP → HTTPS: tek adım, kalıcı (301/308), aynı alan
  if (checkHttpRedirect) {
    const http = `http://${base.host}/`
    try {
      const res = await fetchImpl(http, { redirect: 'manual', headers })
      const loc = res.headers.get('location') ?? ''
      if (![301, 308].includes(res.status) || !loc.startsWith(`https://${base.host}/`)) {
        fail('http_yonlendirme', `HTTP isteği HTTPS'e kalıcı yönlenmiyor (durum ${res.status}, location "${loc}")`)
      }
    } catch (e) {
      fail('http_erisim', `HTTP isteği yapılamadı: ${e.message}`)
    }
  }

  // 2) Ana sayfa
  const index = await get('/')
  if (!index) return { sorunlar, bilgi }
  if (index.status !== 200) fail('ana_sayfa', `Ana sayfa HTTP ${index.status}`)
  const ct = index.headers.get('content-type') ?? ''
  if (!ct.includes('text/html')) fail('ana_sayfa_tur', `Ana sayfa içerik türü "${ct}"`)
  const cc = index.headers.get('cache-control') ?? ''
  if (!/no-cache|no-store|max-age=0/.test(cc)) fail('ana_sayfa_onbellek', `Ana sayfa önbelleğe alınabilir ("${cc}"): eski sürüm takılı kalabilir`)
  const hsts = index.headers.get('strict-transport-security') ?? ''
  const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0)
  if (maxAge < HSTS_MIN) fail('hsts', `HSTS eksik veya kısa ("${hsts}")`)
  if (!index.headers.get('content-security-policy')) fail('csp', 'Content-Security-Policy başlığı yok')
  if ((index.headers.get('x-content-type-options') ?? '').toLowerCase() !== 'nosniff') fail('nosniff', 'X-Content-Type-Options: nosniff yok')
  const html = await index.text()
  const insecure = [...html.matchAll(/(?:src|href)\s*=\s*["'](http:\/\/[^"']+)/gi)].map((m) => m[1])
  if (insecure.length) fail('karisik_icerik', `Sayfada HTTP (güvensiz) kaynak: ${insecure.slice(0, 3).join(', ')}`)
  const assets = [...new Set([...html.matchAll(/(?:src|href)\s*=\s*["'](\/assets\/[^"']+\.(?:js|css))["']/g)].map((m) => m[1]))]
  if (!assets.some((a) => a.endsWith('.js'))) fail('ana_paket', 'Sayfada /assets/ altında uygulama paketi bağlantısı yok')
  bilgi.paketler = assets.length

  // 3) Sayfanın istediği paketler gerçekten var mı (yarım/bozuk dağıtım)
  for (const a of assets) {
    const r = await get(a)
    if (!r || r.status !== 200) {
      fail('paket_yok', `${a}: HTTP ${r?.status ?? '—'} (dağıtım eksik)`)
      continue
    }
    const t = r.headers.get('content-type') ?? ''
    const want = a.endsWith('.js') ? 'javascript' : 'text/css'
    if (!t.includes(want)) fail('paket_tur', `${a}: içerik türü "${t}" (beklenen ${want})`)
    await r.arrayBuffer().catch(() => {})
  }

  // 4) Sürüm kanıtı
  const ver = await get('/version.json')
  if (!ver || ver.status !== 200) fail('surum', `/version.json HTTP ${ver?.status ?? '—'}`)
  else {
    if (!/no-store/.test(ver.headers.get('cache-control') ?? '')) fail('surum_onbellek', '/version.json no-store değil: güncelleme algılanmayabilir')
    try {
      const v = await ver.json()
      bilgi.surum = v.version
      bilgi.commit = v.commit
      if (!v.version || !v.commit) fail('surum_icerik', '/version.json sürüm/commit içermiyor')
      if (expectCommit && v.commit && !expectCommit.startsWith(v.commit)) fail('surum_esit_degil', `Yayındaki commit ${v.commit}, beklenen ${expectCommit.slice(0, 7)}`)
    } catch {
      fail('surum_json', '/version.json geçerli JSON değil')
    }
  }

  // 5) Service worker: önbelleğe alınmaz ve fetch'e karışmaz (PWA eski sürüme kilitlenemez)
  const sw = await get('/sw.js')
  if (!sw || sw.status !== 200) fail('sw', `/sw.js HTTP ${sw?.status ?? '—'}`)
  else {
    if (!(sw.headers.get('content-type') ?? '').includes('javascript')) fail('sw_tur', `/sw.js içerik türü "${sw.headers.get('content-type')}"`)
    if (!/no-cache|no-store|max-age=0/.test(sw.headers.get('cache-control') ?? '')) fail('sw_onbellek', '/sw.js önbelleğe alınabilir: güncelleme gecikir')
    const body = await sw.text()
    if (/addEventListener\(\s*['"]fetch['"]/.test(body)) fail('sw_fetch', "/sw.js 'fetch' olayını dinliyor: eski sayfa sunma riski (bilinçli değişiklik değilse geri alın)")
  }

  // 6) Manifest
  const mf = await get('/manifest.webmanifest')
  if (!mf || mf.status !== 200) fail('manifest', `/manifest.webmanifest HTTP ${mf?.status ?? '—'}`)
  else {
    try {
      const m = await mf.json()
      if (m.start_url !== '/' || m.scope !== '/') fail('manifest_kapsam', `manifest start_url=${m.start_url} scope=${m.scope} (beklenen "/")`)
      if (m.display !== 'standalone') fail('manifest_display', `manifest display=${m.display}`)
    } catch {
      fail('manifest_json', 'manifest geçerli JSON değil')
    }
  }

  // 7) Derin bağlantı (iPhone'da ana ekrandan veya bildirimden açılan rota) yönlendirmesiz açılır
  const deep = await get('/projeler')
  if (!deep || deep.status !== 200 || !(deep.headers.get('content-type') ?? '').includes('text/html')) fail('derin_baglanti', `/projeler HTTP ${deep?.status ?? '—'}`)
  else await deep.text().catch(() => {})

  return { sorunlar, bilgi }
}

/** Sertifikanın bitişine kalan gün */
export function daysLeft(validTo, now = Date.now()) {
  return Math.floor((new Date(validTo).getTime() - now) / 86400000)
}
