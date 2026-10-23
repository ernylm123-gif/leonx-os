/**
 * public/boot-guard.js testleri. Dosyanın KENDİSİ (yayımlanan betik, kopya değil) Node "vm"
 * içinde CommonJS gibi yüklenir; betik bu durumda kendini kurmaz, yalnızca işlevlerini dışa verir.
 * Panelin DOM davranışı gerçek tarayıcıda e2e/app.e2e.mjs → "Açılış koruması" testleriyle sınanır.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

interface CheckView {
  online: boolean | null
  ok: boolean
  status: number
  ms: number
  error: string | null
  serverBuild: string | null
  loadedBuild: string | null
}
interface View {
  reason: 'zaman' | 'dosya' | null
  busy: boolean
  check: CheckView | null
}
interface Controller {
  start(): void
  booted(): void
  assetError(url: string): void
  retry(): void
  update(): Promise<void>
  check(): Promise<CheckView>
  state(): { booted: boolean; shown: string | null; shownCount: number; pending: boolean }
}
interface GuardApi {
  DEFAULT_TIMEOUT_MS: number
  ATTEMPT_KEY: string
  RELOAD_PARAM: string
  isOwnScriptAsset(url: unknown, origin: string): boolean
  cacheBustUrl(href: string, tag: string | null): string
  canAutoReload(store: Storage | null, now: number): boolean
  recordAutoReload(store: Storage, now: number): boolean
  parseBuildId(body: unknown): string | null
  describeCheck(r: CheckView): string[]
  createController(env: Record<string, unknown>): Controller
}

const SRC = readFileSync(fileURLToPath(new URL('../../public/boot-guard.js', import.meta.url)), 'utf8')
function loadGuard(): GuardApi {
  const sandbox = { module: { exports: {} as GuardApi }, URL }
  vm.runInNewContext(SRC, sandbox, { filename: 'boot-guard.js' })
  return sandbox.module.exports
}
const G = loadGuard()
const ORIGIN = 'https://leonx-os.vercel.app'

class MemStore {
  m = new Map<string, string>()
  getItem(k: string) {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.m.set(k, v)
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
}

function setup(opts: { store?: MemStore | null; version?: () => Promise<unknown>; href?: string } = {}) {
  let now = 1_000_000
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = []
  const views: (View | null)[] = []
  const navigations: string[] = []
  let reloads = 0
  let cachesCleared = 0
  const store = opts.store === undefined ? new MemStore() : opts.store
  const ctl = G.createController({
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const t = { fn, ms, cancelled: false }
      timers.push(t)
      return t
    },
    clearTimer: (h: { cancelled: boolean }) => {
      h.cancelled = true
    },
    store,
    href: () => opts.href ?? `${ORIGIN}/projeler?x=1`,
    origin: ORIGIN,
    navigate: (u: string) => navigations.push(u),
    reload: () => reloads++,
    render: (v: View | null) => views.push(v ? JSON.parse(JSON.stringify(v)) : null),
    fetchVersion: opts.version ?? (() => Promise.resolve({ ok: true, status: 200, ms: 42, body: { buildId: '0.9.2+yeni' } })),
    clearCaches: () => {
      cachesCleared++
      return Promise.resolve()
    },
    loadedBuild: () => '0.9.2+eski',
    online: () => true,
  })
  return {
    ctl,
    store,
    views,
    navigations,
    timers,
    get reloads() {
      return reloads
    },
    get cachesCleared() {
      return cachesCleared
    },
    advance: (ms: number) => {
      now += ms
    },
    fire: () => timers.splice(0).forEach((t) => !t.cancelled && t.fn()),
  }
}

describe('boot-guard saf işlevler', () => {
  it('yalnız aynı kökenden /assets/*.js dosyalarını uygulama paketi sayar', () => {
    expect(G.isOwnScriptAsset(`${ORIGIN}/assets/index-AbC123.js`, ORIGIN)).toBe(true)
    expect(G.isOwnScriptAsset('/assets/react-x.mjs', ORIGIN)).toBe(true)
    expect(G.isOwnScriptAsset(`${ORIGIN}/assets/index-AbC123.css`, ORIGIN)).toBe(false)
    expect(G.isOwnScriptAsset(`${ORIGIN}/theme-init.js`, ORIGIN)).toBe(false)
    expect(G.isOwnScriptAsset('https://evil.example/assets/index.js', ORIGIN)).toBe(false)
    expect(G.isOwnScriptAsset('', ORIGIN)).toBe(false)
    expect(G.isOwnScriptAsset(null, ORIGIN)).toBe(false)
  })

  it('önbellek atlayan adres sayfayı ve sorguyu korur, etiketi temizler', () => {
    const u = new URL(G.cacheBustUrl(`${ORIGIN}/projeler/1?x=1#a`, '0.9.2+abc.<script>'))
    expect(u.pathname).toBe('/projeler/1')
    expect(u.searchParams.get('x')).toBe('1')
    expect(u.searchParams.get(G.RELOAD_PARAM)).toBe('0.9.2+abc.script')
    expect(u.hash).toBe('#a')
    expect(G.RELOAD_PARAM).toBe('_surum') // src/lib/appVersion.ts → RELOAD_PARAM ile aynı olmalı
    expect(new URL(G.cacheBustUrl(`${ORIGIN}/`, null)).searchParams.get('_surum')).toBe('1')
  })

  it('otomatik yeniden açma 10 dakikada en fazla bir kez; depolama yoksa hiç', () => {
    const s = new MemStore() as unknown as Storage
    expect(G.canAutoReload(s, 0)).toBe(true)
    G.recordAutoReload(s, 0)
    expect(G.canAutoReload(s, 60_000)).toBe(false)
    expect(G.canAutoReload(s, 11 * 60_000)).toBe(true)
    expect(G.canAutoReload(null, 0)).toBe(false)
    const broken = { getItem: () => '{bozuk', setItem() {}, removeItem() {} } as unknown as Storage
    expect(G.canAutoReload(broken, 0)).toBe(true)
  })

  it('version.json gövdesi doğrulanır', () => {
    expect(G.parseBuildId({ buildId: 'a' })).toBe('a')
    expect(G.parseBuildId({ buildId: '' })).toBeNull()
    expect(G.parseBuildId('<html>')).toBeNull()
    expect(G.parseBuildId(null)).toBeNull()
  })

  it('bağlantı denetimi sonucu Türkçe ve sürüm farkını söyler', () => {
    const lines = G.describeCheck({ online: true, ok: true, status: 200, ms: 87, error: null, serverBuild: 'B', loadedBuild: 'A' })
    expect(lines.join('\n')).toMatch(/Çevrimiçi/)
    expect(lines.join('\n')).toMatch(/HTTP 200 · 87 ms/)
    expect(lines.join('\n')).toMatch(/daha yeni bir sürüm/)
    const down = G.describeCheck({ online: false, ok: false, status: 0, ms: 8000, error: 'zaman aşımı', serverBuild: null, loadedBuild: 'A' })
    expect(down.join('\n')).toMatch(/Çevrimdışı/)
    expect(down.join('\n')).toMatch(/ulaşılamadı \(zaman aşımı\)/)
    expect(G.describeCheck({ online: true, ok: true, status: 200, ms: 5, error: null, serverBuild: 'A', loadedBuild: 'A' }).join('\n')).toMatch(/Sürümler aynı/)
  })
})

describe('boot-guard denetleyici', () => {
  it('uygulama zamanında açılırsa panel hiç gösterilmez', () => {
    const t = setup()
    t.ctl.start()
    expect(t.timers[0].ms).toBe(G.DEFAULT_TIMEOUT_MS)
    t.ctl.booted()
    t.fire()
    expect(t.views).toEqual([])
    expect(t.ctl.state()).toMatchObject({ booted: true, shown: null, shownCount: 0, pending: false })
  })

  it('zaman aşımında panel açılır; uygulama sonradan açılırsa panel kalkar', () => {
    const t = setup()
    t.ctl.start()
    t.fire()
    expect(t.views.at(-1)?.reason).toBe('zaman')
    t.ctl.booted()
    expect(t.views.at(-1)).toBeNull()
  })

  it('paket dosyası yüklenemezse önce BİR kez önbellek atlayarak yeniden açar, ikinci hatada panel gösterir (döngü yok)', () => {
    const store = new MemStore()
    const first = setup({ store })
    first.ctl.start()
    first.ctl.assetError(`${ORIGIN}/assets/index-x.js`)
    expect(first.navigations).toHaveLength(1)
    expect(new URL(first.navigations[0]).searchParams.get('_surum')).toMatch(/^yeniden-/)
    expect(first.views).toEqual([])
    // yeniden açılan sayfa (aynı oturum deposu) yine dosyayı yükleyemez
    const second = setup({ store })
    second.ctl.start()
    second.ctl.assetError(`${ORIGIN}/assets/index-x.js`)
    second.ctl.assetError(`${ORIGIN}/assets/react-x.js`)
    expect(second.navigations).toHaveLength(0)
    expect(second.views.at(-1)?.reason).toBe('dosya')
    expect(second.ctl.state().shownCount).toBe(1)
  })

  it('depolama kapalıysa otomatik yeniden açma yapılmaz, doğrudan panel', () => {
    const t = setup({ store: null })
    t.ctl.assetError(`${ORIGIN}/assets/index-x.js`)
    expect(t.navigations).toHaveLength(0)
    expect(t.views.at(-1)?.reason).toBe('dosya')
  })

  it('açılıştan sonraki dosya hataları ve yabancı dosyalar yok sayılır (sayfa parçalarını update.tsx yönetir)', () => {
    const t = setup()
    t.ctl.assetError(`${ORIGIN}/assets/index.css`)
    t.ctl.assetError('https://cdn.example/assets/x.js')
    expect(t.views).toEqual([])
    t.ctl.booted()
    t.ctl.assetError(`${ORIGIN}/assets/ReportsPage-x.js`)
    expect(t.views).toEqual([])
    expect(t.navigations).toEqual([])
  })

  it('başarılı açılış deneme kaydını siler (sonraki arızada yine bir otomatik deneme hakkı)', () => {
    const store = new MemStore()
    const a = setup({ store })
    a.ctl.assetError(`${ORIGIN}/assets/index-x.js`)
    expect(store.getItem(G.ATTEMPT_KEY)).not.toBeNull()
    a.ctl.booted()
    expect(store.getItem(G.ATTEMPT_KEY)).toBeNull()
  })

  it('"Yeniden dene" sayfayı yeniler', () => {
    const t = setup()
    t.ctl.start()
    t.fire()
    t.ctl.retry()
    expect(t.reloads).toBe(1)
  })

  it('"Uygulamayı güncelle": sunucu sürümüyle önbellek atlayan adrese gider, yalnız Cache Storage temizlenir', async () => {
    const t = setup()
    await t.ctl.update()
    expect(t.cachesCleared).toBe(1)
    expect(t.navigations).toHaveLength(1)
    const u = new URL(t.navigations[0])
    expect(u.pathname).toBe('/projeler')
    expect(u.searchParams.get('_surum')).toBe('0.9.2+yeni')
    // oturum deposuna yalnız kendi deneme anahtarı dışında hiçbir şey yazılmamış olmalı
    expect([...t.store!.m.keys()].filter((k) => k !== G.ATTEMPT_KEY)).toEqual([])
  })

  it('"Uygulamayı güncelle": sunucuya ulaşılamasa da zaman damgalı adresle yeniden açar', async () => {
    const t = setup({ version: () => Promise.reject(new TypeError('Failed to fetch')) })
    await t.ctl.update()
    expect(new URL(t.navigations[0]).searchParams.get('_surum')).toMatch(/^g/)
  })

  it('"Bağlantıyı kontrol et": çevrimiçi durumu, gecikme ve sürüm farkı gösterilir', async () => {
    const t = setup()
    t.ctl.start()
    t.fire()
    const r = await t.ctl.check()
    expect(r).toMatchObject({ online: true, ok: true, status: 200, ms: 42, serverBuild: '0.9.2+yeni', loadedBuild: '0.9.2+eski' })
    expect(t.views.at(-1)).toMatchObject({ busy: false, reason: 'zaman' })
  })

  it('"Bağlantıyı kontrol et": fetch reddedilirse hata sonucu üretir, istisna fırlatmaz', async () => {
    const t = setup({ version: () => Promise.reject(Object.assign(new Error('x'), { name: 'TypeError' })) })
    const r = await t.ctl.check()
    expect(r).toMatchObject({ ok: false, status: 0, error: 'TypeError', serverBuild: null })
  })
})

describe('boot-guard yayın biçimi', () => {
  it('ES2017 sınırında kalır (eski iOS Safari): ?. ve ?? yok, modül sözdizimi yok', () => {
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/\?\.|\?\?/)
    expect(code).not.toMatch(/^\s*(import|export)\s/m)
    expect(() => new vm.Script(SRC)).not.toThrow()
  })

  it('index.html koruma betiğini modül paketinden önce, satır içi olmadan yükler', () => {
    const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8')
    const guard = html.indexOf('<script src="/boot-guard.js"></script>')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(html.indexOf('type="module"'))
    expect(html).not.toMatch(/<script>(?!<\/script>)/)
  })
})
