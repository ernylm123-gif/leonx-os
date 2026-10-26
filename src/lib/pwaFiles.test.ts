/**
 * Yayımlanan PWA dosyalarının doğrulaması: public/manifest.webmanifest ve public/sw.js.
 * sw.js dosyasının KENDİSİ Node "vm" içinde sahte service worker ortamıyla çalıştırılır.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const pub = (f: string) => fileURLToPath(new URL(`../../public/${f}`, import.meta.url))

/** PNG IHDR'den genişlik × yükseklik */
function pngSize(file: string): string {
  const b = readFileSync(file)
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG')
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`
}

describe('manifest.webmanifest', () => {
  const m = JSON.parse(readFileSync(pub('manifest.webmanifest'), 'utf8'))

  it('kapsam ve başlangıç adresi kök; kimlik sabit; bağımsız pencere', () => {
    expect(m.start_url).toBe('/')
    expect(m.scope).toBe('/')
    expect(m.id).toBe('/')
    expect(m.display).toBe('standalone')
    expect(m.name).toBeTruthy()
    expect(m.short_name).toBeTruthy()
    expect(m.lang).toBe('tr')
  })

  it('simgeler diskte var ve bildirilen boyutta; 192, 512 ve maskable 512 mevcut', () => {
    for (const icon of m.icons as { src: string; sizes: string; type: string; purpose?: string }[]) {
      expect(icon.src.startsWith('/')).toBe(true)
      expect(icon.type).toBe('image/png')
      expect(pngSize(pub(icon.src.slice(1)))).toBe(icon.sizes)
    }
    const sizes = m.icons.map((i: { sizes: string; purpose?: string }) => `${i.sizes}:${i.purpose ?? 'any'}`)
    expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']))
  })

  it('index.html manifest ve iOS ana ekran simgesine bağlanır', () => {
    const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8')
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    const touch = html.match(/rel="apple-touch-icon" href="([^"]+)"/)?.[1]
    expect(touch).toBeTruthy()
    expect(pngSize(pub(touch!.slice(1)))).toBe('180x180')
  })
})

// ------------------------------------------------------------------ sw.js
type Listener = (e: unknown) => void

function loadWorker(windows: { url: string; focused?: boolean; messages?: unknown[] }[] = []) {
  const listeners = new Map<string, Listener>()
  const shown: { title: string; options: { body: string; data: { link: string; id: string | null }; tag?: string } }[] = []
  const opened: string[] = []
  const clients = windows.map((w) => ({
    url: w.url,
    focus: async () => {
      w.focused = true
    },
    postMessage: (m: unknown) => (w.messages ??= []).push(m),
  }))
  const self = {
    location: { origin: 'https://leonx-os.vercel.app' },
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    skipWaiting: () => undefined,
    registration: { showNotification: async (title: string, options: (typeof shown)[number]['options']) => void shown.push({ title, options }) },
    clients: {
      claim: async () => undefined,
      matchAll: async () => clients,
      openWindow: async (u: string) => void opened.push(u),
    },
  }
  vm.runInNewContext(readFileSync(pub('sw.js'), 'utf8'), { self, URL, console })
  const fire = async (type: string, event: Record<string, unknown>) => {
    let wait: Promise<unknown> = Promise.resolve()
    listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => (wait = p) })
    await wait
  }
  const push = (payload: unknown) =>
    fire('push', { data: { json: () => (typeof payload === 'string' ? JSON.parse(payload) : payload), text: () => String(payload) } })
  const click = (data: unknown) => fire('notificationclick', { notification: { data, close: () => undefined } })
  return { listeners, shown, opened, push, click }
}

describe('sw.js (push çalışanı)', () => {
  it('fetch olayını dinlemez: hiçbir isteği yakalamaz, önbellek tutmaz', () => {
    const w = loadWorker()
    expect([...w.listeners.keys()].sort()).toEqual(['activate', 'install', 'notificationclick', 'push', 'pushsubscriptionchange'])
    expect(readFileSync(pub('sw.js'), 'utf8')).not.toMatch(/caches\.|addEventListener\(['"]fetch/)
  })

  it('push bağlantısı yalnız aynı kökene göreli olabilir', async () => {
    const cases: [unknown, string][] = [
      ['/projeler/1?x=1', '/projeler/1?x=1'],
      ['https://evil.example/x', '/bildirimler'],
      ['//evil.example/x', '/bildirimler'],
      ['/\\evil.example/x', '/bildirimler'],
      ['javascript:alert(1)', '/bildirimler'],
      [42, '/bildirimler'],
      [undefined, '/bildirimler'],
    ]
    for (const [link, expected] of cases) {
      const w = loadWorker()
      await w.push({ title: 'T', body: 'B', link, id: 'n1' })
      expect(w.shown[0].options.data.link, String(link)).toBe(expected)
    }
  })

  it('başlık ve gövde kısaltılır; bozuk yükte bile görünür bildirim gösterilir (iOS zorunluluğu)', async () => {
    const w = loadWorker()
    await w.push({ title: 'x'.repeat(500), body: 'y'.repeat(500), id: 'a' })
    expect(w.shown[0].title).toHaveLength(120)
    expect(w.shown[0].options.body).toHaveLength(240)
    expect(w.shown[0].options.tag).toBe('leonx-a')
    const bad = loadWorker()
    await bad.push('{bozuk')
    expect(bad.shown).toHaveLength(1)
    expect(bad.shown[0].title).toBe('LEONX OS')
  })

  it('bildirime dokununca açık uygulama öne gelir ve sayfa yenilenmeden ilgili ekrana gider', async () => {
    const win = { url: 'https://leonx-os.vercel.app/projeler', messages: [] as unknown[] }
    const w = loadWorker([win])
    await w.click({ link: '/teklifler/5?a=1', id: 'n9' })
    expect((win as { focused?: boolean }).focused).toBe(true)
    expect(win.messages).toEqual([{ type: 'leonx-open', link: '/teklifler/5?a=1', id: 'n9' }])
    expect(w.opened).toEqual([])
  })

  it('açık pencere yoksa yeni pencere açar; başka kökene asla gitmez', async () => {
    const w = loadWorker([])
    await w.click({ link: '/bildirimler', id: null })
    expect(w.opened).toEqual(['https://leonx-os.vercel.app/bildirimler'])
    const evil = loadWorker([{ url: 'https://leonx-os.vercel.app/' }])
    await evil.click({ link: 'https://evil.example/x' })
    await evil.click({ link: '//evil.example/x' })
    expect(evil.opened).toEqual([])
  })
})
