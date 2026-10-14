/**
 * Sürüm bilgisi ve yeni sürüm algılama.
 *
 * Her derleme benzersiz bir buildId taşır (vite.config.ts). Sunucudaki /version.json önbelleğe
 * alınmaz; açık uygulama periyodik ve olay tabanlı (ön plana dönme, ağ geri gelme) olarak bu
 * dosyayı okur. Kimlik farklıysa "Yeni sürüm hazır" bildirimi gösterilir.
 *
 * Sonsuz yenileme koruması: aynı hedef sürüm için en fazla 2 otomatik/elle yeniden yükleme
 * denemesi yapılır (10 dakika içinde). CDN veya tarayıcı eski dosyayı vermeye devam ederse
 * yeniden yükleme döngüsü yerine kullanıcıya açıklama gösterilir.
 */

export interface BuildInfo {
  version: string
  commit: string
  branch: string
  env: string
  builtAt: string
  buildId: string
}

export const CURRENT_BUILD: BuildInfo = __LEONX_BUILD__

export function envLabel(env: string): string {
  switch (env) {
    case 'production':
      return 'Üretim (production)'
    case 'preview':
      return 'Önizleme (preview)'
    case 'development':
      return 'Geliştirme'
    default:
      return 'Yerel derleme'
  }
}

export function parseBuildInfo(v: unknown): BuildInfo | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.buildId !== 'string' || !o.buildId) return null
  return {
    version: String(o.version ?? ''),
    commit: String(o.commit ?? ''),
    branch: String(o.branch ?? ''),
    env: String(o.env ?? ''),
    builtAt: String(o.builtAt ?? ''),
    buildId: o.buildId,
  }
}

/** Sunucudaki güncel sürüm; çevrimdışı veya dosya yoksa null (hata sayılmaz) */
export async function fetchServerBuild(fetcher: typeof fetch = fetch): Promise<BuildInfo | null> {
  try {
    const res = await fetcher(`/version.json?t=${Date.now()}`, { cache: 'no-store', headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    // SPA yönlendirmesi index.html döndürürse (eski dağıtım) sürüm bilinmiyor kabul edilir
    if (!type.includes('json')) return null
    return parseBuildInfo(await res.json())
  } catch {
    return null
  }
}

export function isNewer(server: BuildInfo | null, current: BuildInfo): boolean {
  return !!server && server.buildId !== current.buildId
}

// ------------------------------------------------------------------ yeniden yükleme koruması

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const ATTEMPT_KEY = 'leonx-update-attempt'
const WINDOW_MS = 10 * 60 * 1000
export const MAX_RELOAD_ATTEMPTS = 2

interface Attempt {
  target: string
  count: number
  at: number
}

function readAttempt(store: KeyValueStore | null): Attempt | null {
  try {
    const raw = store?.getItem(ATTEMPT_KEY)
    return raw ? (JSON.parse(raw) as Attempt) : null
  } catch {
    return null
  }
}

/** Bu hedef sürüm için yeniden yükleme denemesi yapılabilir mi? (sonsuz döngü koruması) */
export function canAttemptReload(target: string, store: KeyValueStore | null, now = Date.now()): boolean {
  const a = readAttempt(store)
  if (!a || a.target !== target || now - a.at > WINDOW_MS) return true
  return a.count < MAX_RELOAD_ATTEMPTS
}

export function recordReloadAttempt(target: string, store: KeyValueStore | null, now = Date.now()): void {
  const a = readAttempt(store)
  const next: Attempt = a && a.target === target && now - a.at <= WINDOW_MS ? { target, count: a.count + 1, at: now } : { target, count: 1, at: now }
  try {
    store?.setItem(ATTEMPT_KEY, JSON.stringify(next))
  } catch {
    /* depolama kapalı: koruma bu oturumda bellekte kalmaz, en fazla bir deneme yapılır */
  }
}

/** Uygulama yeni sürümle başarıyla açıldıysa deneme kaydı temizlenir */
export function clearReloadAttempts(current: BuildInfo, store: KeyValueStore | null): void {
  const a = readAttempt(store)
  if (a && a.target === current.buildId) {
    try {
      store?.removeItem(ATTEMPT_KEY)
    } catch {
      /* yok say */
    }
  }
}

/** Dinamik içe aktarma (lazy sayfa parçası) yüklenemedi mi? Dağıtım sonrası eski sekmelerde görülür. */
export function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e ?? '')
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError|Loading chunk \d+ failed|'text\/html' is not a valid JavaScript MIME type/i.test(msg)
}

export function safeSessionStorage(): KeyValueStore | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** Uygulama türü: ana ekrana eklenmiş PWA mı, tarayıcı mı */
export function displayMode(): 'ios-pwa' | 'pwa' | 'tarayici' {
  try {
    if ((navigator as Navigator & { standalone?: boolean }).standalone) return 'ios-pwa'
    if (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches) return 'pwa'
  } catch {
    /* yok say */
  }
  return 'tarayici'
}

/** Kanonik üretim adresinde mi çalışıyoruz? Sabit dağıtım adresleri (leonx-xxxx.vercel.app) eski sürümde kalır. */
export function originStatus(origin: string, canonical: string, env: string): 'kanonik' | 'onizleme' | 'sabit-dagitim' | 'yerel' {
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return 'yerel'
  if (env === 'preview') return 'onizleme'
  if (origin === canonical) return 'kanonik'
  return 'sabit-dagitim'
}

// ------------------------------------------------------------------ önbellek ve yeniden yükleme

/** Push bildirimleri için tek service worker (önbellek tutmaz, istekleri yakalamaz) */
export const PUSH_SW_URL = '/sw.js'

/** Kayıt LEONX push çalışanı mı? (yalnız bildirim; sürüm güncellemesini etkilemez) */
export function isPushWorker(scriptUrl: string | undefined | null): boolean {
  if (!scriptUrl) return false
  try {
    return new URL(scriptUrl).pathname === PUSH_SW_URL
  } catch {
    return false
  }
}

/**
 * LEONX OS uygulama dosyaları için service worker/önbellek KULLANMAZ. Tarayıcıda önceki bir
 * kurulumdan kalmış service worker veya Cache Storage varsa (eski sürüm dosyalarını vermeye
 * devam edebilir) güvenle kaldırılır. İstisna: yalnız push bildirimlerini gösteren /sw.js
 * (fetch olayını dinlemez, hiçbir dosyayı önbelleğe almaz) korunur.
 * İş verisi bu depolarda tutulmaz; oturum ve tercihler (localStorage) etkilenmez.
 */
export async function purgeLegacyCaches(): Promise<{ workers: number; caches: number }> {
  let workers = 0
  let removed = 0
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      for (const r of regs) {
        const url = r.active?.scriptURL ?? r.waiting?.scriptURL ?? r.installing?.scriptURL
        if (isPushWorker(url)) continue
        if (await r.unregister()) workers++
      }
    }
  } catch {
    /* desteklenmiyor veya engelli */
  }
  try {
    if (typeof caches !== 'undefined') {
      for (const k of await caches.keys()) if (await caches.delete(k)) removed++
    }
  } catch {
    /* desteklenmiyor veya engelli */
  }
  return { workers, caches: removed }
}

export const RELOAD_PARAM = '_surum'

/**
 * Yeni sürümü açan adres: aynı sayfa + sürüm parametresi. Parametre HTML'in hiçbir ara
 * önbellekten (iOS ana ekran uygulaması dahil) gelmemesini garanti eder; açılışta silinir.
 */
export function reloadUrl(href: string, target: string): string {
  const u = new URL(href)
  u.searchParams.set(RELOAD_PARAM, target.replace(/[^\w.+-]/g, '').slice(0, 64) || '1')
  return u.toString()
}

/** Açılışta sürüm parametresini adres çubuğundan kaldırır (geçmişe kayıt eklemeden) */
export function cleanReloadParam(href: string): string | null {
  const u = new URL(href)
  if (!u.searchParams.has(RELOAD_PARAM)) return null
  u.searchParams.delete(RELOAD_PARAM)
  return u.pathname + (u.search === '?' ? '' : u.search) + u.hash
}
