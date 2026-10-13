import { describe, expect, it } from 'vitest'
import {
  type BuildInfo,
  canAttemptReload,
  clearReloadAttempts,
  CURRENT_BUILD,
  fetchServerBuild,
  isChunkLoadError,
  isNewer,
  type KeyValueStore,
  MAX_RELOAD_ATTEMPTS,
  originStatus,
  parseBuildInfo,
  recordReloadAttempt,
} from './appVersion'

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

const build = (buildId: string): BuildInfo => ({ version: '0.5.0', commit: 'abc1234', branch: 'main', env: 'production', builtAt: '2026-10-13T00:00:00Z', buildId })

describe('sürüm bilgisi', () => {
  it('derleme kimliği gömülüdür', () => {
    expect(CURRENT_BUILD.buildId).toMatch(/^\d+\.\d+\.\d+\+/)
    expect(CURRENT_BUILD.version).toBeTruthy()
  })

  it('parseBuildInfo geçersiz girdiyi reddeder', () => {
    expect(parseBuildInfo(null)).toBeNull()
    expect(parseBuildInfo('x')).toBeNull()
    expect(parseBuildInfo({ version: '1' })).toBeNull()
    expect(parseBuildInfo({ buildId: '' })).toBeNull()
    expect(parseBuildInfo({ buildId: 'a', version: 1 })?.version).toBe('1')
  })

  it('isNewer yalnızca kimlik farklıysa doğrudur', () => {
    expect(isNewer(null, build('a'))).toBe(false)
    expect(isNewer(build('a'), build('a'))).toBe(false)
    expect(isNewer(build('b'), build('a'))).toBe(true)
  })

  it('fetchServerBuild: JSON olmayan yanıt, hata ve ağ kesintisi null döner', async () => {
    const json = (body: unknown, type = 'application/json', ok = true) =>
      (async () => ({ ok, headers: new Headers({ 'content-type': type }), json: async () => body }) as unknown as Response) as typeof fetch
    expect((await fetchServerBuild(json({ buildId: 'x' })))?.buildId).toBe('x')
    expect(await fetchServerBuild(json('<html>', 'text/html'))).toBeNull()
    expect(await fetchServerBuild(json({ buildId: 'x' }, 'application/json', false))).toBeNull()
    expect(await fetchServerBuild((async () => Promise.reject(new TypeError('offline'))) as typeof fetch)).toBeNull()
  })

  it('fetchServerBuild önbelleği atlar', async () => {
    let seen: [string, RequestInit | undefined] | null = null
    const f = (async (url: string, init?: RequestInit) => {
      seen = [url, init]
      return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ buildId: 'y' }) } as unknown as Response
    }) as unknown as typeof fetch
    await fetchServerBuild(f)
    expect(seen![0]).toMatch(/^\/version\.json\?t=\d+$/)
    expect(seen![1]?.cache).toBe('no-store')
  })
})

describe('sonsuz yenileme koruması', () => {
  it(`aynı hedef için en fazla ${MAX_RELOAD_ATTEMPTS} deneme`, () => {
    const s = memoryStore()
    const t0 = 1_000_000
    expect(canAttemptReload('v2', s, t0)).toBe(true)
    recordReloadAttempt('v2', s, t0)
    expect(canAttemptReload('v2', s, t0 + 1000)).toBe(true)
    recordReloadAttempt('v2', s, t0 + 1000)
    expect(canAttemptReload('v2', s, t0 + 2000)).toBe(false)
    // farklı hedef sürüm yeniden denenebilir
    expect(canAttemptReload('v3', s, t0 + 2000)).toBe(true)
    // 10 dakika sonra pencere sıfırlanır
    expect(canAttemptReload('v2', s, t0 + 11 * 60 * 1000)).toBe(true)
  })

  it('yeni sürümle açılınca kayıt temizlenir, başka sürümde korunur', () => {
    const s = memoryStore()
    recordReloadAttempt('v2', s)
    clearReloadAttempts(build('v1'), s)
    expect(s.data.size).toBe(1)
    clearReloadAttempts(build('v2'), s)
    expect(s.data.size).toBe(0)
  })

  it('bozuk veya erişilemeyen depolama döngüye yol açmaz', () => {
    const s = memoryStore()
    s.setItem('leonx-update-attempt', '{bozuk')
    expect(canAttemptReload('v2', s)).toBe(true)
    expect(canAttemptReload('v2', null)).toBe(true)
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {},
    }
    expect(() => recordReloadAttempt('v2', throwing)).not.toThrow()
    expect(canAttemptReload('v2', throwing)).toBe(true)
  })
})

describe('parça yükleme hatası ve adres durumu', () => {
  it('tarayıcıların chunk hata mesajlarını tanır', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true) // Safari / iOS
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true) // Firefox
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/x.css'))).toBe(true)
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })

  it('kanonik, önizleme, sabit dağıtım ve yerel adresleri ayırır', () => {
    const c = 'https://leonx-os.vercel.app'
    expect(originStatus(c, c, 'production')).toBe('kanonik')
    expect(originStatus('https://leonx-os-git-feature-x.vercel.app', c, 'preview')).toBe('onizleme')
    expect(originStatus('https://leonx-abc123.vercel.app', c, 'production')).toBe('sabit-dagitim')
    expect(originStatus('http://localhost:5173', c, 'development')).toBe('yerel')
    expect(originStatus('http://127.0.0.1:4173', c, 'yerel')).toBe('yerel')
  })
})
