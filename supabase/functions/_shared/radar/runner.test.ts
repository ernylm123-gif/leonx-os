import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NOW } from './__fixtures__/synthetic_items.ts'
import type { IngestItem } from './pipeline.ts'
import { type RadarDb, type RunRecord, runScan, type SourceRow, testSource } from './runner.ts'

const fx = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf-8')

function src(o: Partial<SourceRow>): SourceRow {
  return { id: 's1', name: 'Sentetik akış', kind: 'rss', url: 'https://akis.ornek.test/rss', allowed_hosts: [], sector_hint: 'kamu', permission_status: 'izinli', max_items: 50, etag: null, last_modified: null, active: true, ...o }
}

function fakeDb(sources: SourceRow[], opts: { searchEnabled?: boolean; budget?: number; pending?: { id: string; source_id: string; url: string; title: string; raw_text: string; published_at: string | null }[] } = {}) {
  const ingests: { sourceId: string; run: RunRecord; items: IngestItem[] }[] = []
  let budget = opts.budget ?? 0
  let cursor = 0
  const tested = new Set<string>()
  const db: RadarDb = {
    claimDueSources: async () => sources,
    getSource: async (id) => sources.find((s) => s.id === id) ?? null,
    settings: async () => ({ weights: null, search_api_enabled: opts.searchEnabled ?? false, search_queries_per_run: 2 }),
    categories: async () => [],
    clusters: async () => [],
    pendingManual: async () => opts.pending ?? [],
    ingest: async (sourceId, run, items) => {
      ingests.push({ sourceId, run, items })
      return { items_new: items.length, items_updated: 0, items_seen: items.length }
    },
    reserveSearch: async () => {
      if (budget <= 0) return { granted: false, reason: 'aylık arama bütçesi doldu', cursor }
      budget--
      return { granted: true, reason: null, cursor: cursor++ }
    },
    claimSourceTest: async (id) => {
      if (tested.has(id)) return false
      tested.add(id)
      return true
    },
  }
  return { db, ingests }
}

function deps(db: RadarDb, routes: Record<string, (init: RequestInit) => Response>, tavilyKey: string | null = null) {
  const calls: { url: string; init: RequestInit }[] = []
  let n = 0
  return {
    calls,
    d: {
      db,
      now: () => NOW,
      uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
      tavilyKey,
      fetch: async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        const r = routes[url]
        if (!r) throw new Error(`beklenmeyen istek: ${url}`)
        return r(init)
      },
    },
  }
}

const rssOk = () => new Response(fx('synthetic_feed.rss.xml'), { status: 200, headers: { 'content-type': 'application/rss+xml', etag: '"e1"' } })

describe('runner (sahte veritabanı, sentetik akış)', () => {
  it('izinli RSS: indirilir, sınıflandırılır, toplu yazılır; ETag kaydedilir', async () => {
    const { db, ingests } = fakeDb([src({})])
    const { d } = deps(db, { 'https://akis.ornek.test/rss': rssOk })
    const s = await runScan(d)
    expect(s.runs[0]).toMatchObject({ status: 'ok', items: 4 })
    expect(ingests).toHaveLength(1)
    expect(ingests[0].run.etag).toBe('"e1"')
    expect(ingests[0].items[0].verified_need).toBe(true)
    expect(ingests[0].items[0].classification.geo.district).toBe('Etimesgut')
  })
  it('savunma: izinsiz / pasif / elle kaynak indirilmez', async () => {
    const { db, ingests } = fakeDb([src({ permission_status: 'inceleniyor' }), src({ id: 's2', active: false }), src({ id: 's3', kind: 'manual' })])
    const { d, calls } = deps(db, {})
    await runScan(d)
    expect(calls).toHaveLength(0)
    expect(ingests).toHaveLength(0)
  })
  it('304 → değişmedi; HTTP hata → hata kaydı', async () => {
    const { db, ingests } = fakeDb([src({ etag: '"e1"' }), src({ id: 's2', url: 'https://akis.ornek.test/bozuk' })])
    const { d, calls } = deps(db, { 'https://akis.ornek.test/rss': () => new Response(null, { status: 304 }), 'https://akis.ornek.test/bozuk': () => new Response('x', { status: 500, headers: { 'content-type': 'text/html' } }) })
    await runScan(d)
    expect((calls[0].init.headers as Record<string, string>)['If-None-Match']).toBe('"e1"')
    expect(ingests.map((x) => x.run.status)).toEqual(['degismedi', 'hata'])
    expect(ingests[1].run.error).toContain('500')
  })
  it('site: robots.txt yasaklıyorsa sayfa indirilmez', async () => {
    const { db, ingests } = fakeDb([src({ kind: 'site', url: 'https://site.ornek.test/haberler' })])
    const { d, calls } = deps(db, { 'https://site.ornek.test/robots.txt': () => new Response('User-agent: *\nDisallow: /haberler', { status: 200, headers: { 'content-type': 'text/plain' } }) })
    await runScan(d)
    expect(calls.map((c) => c.url)).toEqual(['https://site.ornek.test/robots.txt'])
    expect(ingests[0].run).toMatchObject({ status: 'atlandi', error: 'robots.txt bu sayfaya izin vermiyor' })
  })
  it('site: izinliyse yalnız kayıtlı sayfa, aynı makinedeki başlık bağlantıları (bağlantılar indirilmez)', async () => {
    const page = '<a href="/haber/1">Etimesgut\'ta okul binası yangın kapısı alımı ihalesi</a><a href="https://dis.test/x">Dış sitedeki uzun bir haber başlığı burada</a><a href="/k">Kısa</a>'
    const { db, ingests } = fakeDb([src({ kind: 'site', url: 'https://site.ornek.test/haberler' })])
    const { d, calls } = deps(db, {
      'https://site.ornek.test/robots.txt': () => new Response('', { status: 404 }),
      'https://site.ornek.test/haberler': () => new Response(page, { status: 200, headers: { 'content-type': 'text/html' } }),
    })
    await runScan(d)
    expect(calls).toHaveLength(2)
    expect(ingests[0].items.map((i) => i.canonical_url)).toEqual(['https://site.ornek.test/haber/1'])
  })
  it('arama API: ayar kapalı / anahtar yok → atlandı; bütçe doluysa çağrı yapılmaz', async () => {
    const off = fakeDb([src({ kind: 'search_api', url: null })])
    const r1 = deps(off.db, {}, 'anahtar')
    await runScan(r1.d)
    expect(off.ingests[0].run).toMatchObject({ status: 'atlandi' })
    expect(off.ingests[0].run.error).toContain('kapalı')
    const nokey = fakeDb([src({ kind: 'search_api', url: null })], { searchEnabled: true, budget: 5 })
    const r2 = deps(nokey.db, {}, null)
    await runScan(r2.d)
    expect(nokey.ingests[0].run.error).toContain('TAVILY_API_KEY')
    const empty = fakeDb([src({ kind: 'search_api', url: null })], { searchEnabled: true, budget: 0 })
    const r3 = deps(empty.db, {}, 'anahtar')
    await runScan(r3.d)
    expect(r3.calls).toHaveLength(0)
    expect(empty.ingests[0].run).toMatchObject({ status: 'atlandi', error: 'aylık arama bütçesi doldu' })
  })
  it('arama API: bütçe her çağrıdan önce ayrılır; Bearer başlığı ve asgari gövde', async () => {
    const { db, ingests } = fakeDb([src({ kind: 'search_api', url: null, max_items: 5 })], { searchEnabled: true, budget: 1 })
    const { d, calls } = deps(db, { 'https://api.tavily.com/search': () => new Response(fx('synthetic_tavily_response.json'), { status: 200, headers: { 'content-type': 'application/json' } }) }, 'test-anahtari')
    await runScan(d)
    expect(calls).toHaveLength(1) // 2 sorgu istendi, bütçe 1
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer test-anahtari')
    const body = JSON.parse(String(calls[0].init.body))
    expect(Object.keys(body).sort()).toEqual(['country', 'max_results', 'query', 'search_depth', 'topic'])
    expect(body.search_depth).toBe('basic')
    expect(body.query).toBe('Ankara çelik kapı ihalesi')
    expect(ingests[0].items).toHaveLength(2)
    expect(ingests[0].items.every((i) => i.reliability_base < 60)).toBe(true) // resmî RSS (kamu, izinli, güncel) tabanı 75
  })
  it('elle eklenen bekleyen öğe: indirilmeden sınıflandırılır', async () => {
    const manual = src({ id: 'm1', kind: 'manual', url: null, permission_status: 'inceleniyor' })
    const { db, ingests } = fakeDb([], { pending: [{ id: 'p1', source_id: 'm1', url: 'https://ilan.ornek.test/elle', title: 'Pursaklar okul yangın kapısı alımı ihalesi', raw_text: 'Son teklif 01.12.2026', published_at: null }] })
    db.getSource = async () => manual
    const { d, calls } = deps(db, {})
    await runScan(d)
    expect(calls).toHaveLength(0)
    expect(ingests[0].items[0].pending_item_id).toBe('p1')
    expect(ingests[0].items[0].district).toBe('Pursaklar')
  })
  it('Kaynağı test et: yazmaz, ilk 5 başlık, 5 dakika sınırı', async () => {
    const { db, ingests } = fakeDb([src({ permission_status: 'inceleniyor' })])
    const { d } = deps(db, { 'https://akis.ornek.test/rss': rssOk })
    const r = await testSource(d, 's1')
    expect(r).toMatchObject({ ok: true, http_status: 200, content_type: 'application/rss+xml', item_count: 4 })
    expect(r.items[0].link).toBe('https://akis.ornek.test/ilan/1?utm_source=rss&id=1')
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(ingests).toHaveLength(0)
    expect((await testSource(d, 's1')).error).toContain('5 dakika')
  })
})
