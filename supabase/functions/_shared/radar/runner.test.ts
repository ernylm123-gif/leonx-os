import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NOW } from './__fixtures__/synthetic_items.ts'
import type { IngestItem } from './pipeline.ts'
import { type RadarDb, type RunRecord, runScan, type SourceRow, testSource, verifySource } from './runner.ts'

const fx = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf-8')

function src(o: Partial<SourceRow>): SourceRow {
  return { id: 's1', name: 'Sentetik akış', kind: 'rss', url: 'https://akis.ornek.test/rss', allowed_hosts: [], sector_hint: 'kamu', permission_status: 'izinli', max_items: 50, etag: null, last_modified: null, active: true, ...o }
}

function fakeDb(sources: SourceRow[], opts: { searchEnabled?: boolean; budget?: number; pending?: { id: string; source_id: string; url: string; title: string; raw_text: string; published_at: string | null }[] } = {}) {
  const ingests: { sourceId: string; run: RunRecord; items: IngestItem[] }[] = []
  let budget = opts.budget ?? 0
  let cursor = 0
  const tested = new Set<string>()
  const rejects: { runId: string; rejected: number; reasons: Record<string, number> }[] = []
  const db: RadarDb = {
    recordRejects: async (runId, rejected, reasons) => {
      rejects.push({ runId, rejected, reasons: reasons as Record<string, number> })
    },
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
  return { db, ingests, rejects }
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
    const { db, ingests, rejects } = fakeDb([src({})])
    const { d } = deps(db, { 'https://akis.ornek.test/rss': rssOk })
    const s = await runScan(d)
    // 4 geçerli öğeden 2'si LEONX ile ilgisiz (ürün/yapım işi yok) → yazılmaz, ret nedeniyle sayılır
    expect(s.runs[0]).toMatchObject({ status: 'ok', items: 2, rejected: 2 })
    expect(rejects).toEqual([{ runId: ingests[0].run.id, rejected: 2, reasons: { urun_yok: 2 } }])
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
  it('site: genel "İhale Detayı" bağlantısında başlık karttan alınır; ilk taramada sonraki sayfa okunur; ilgisiz ilan reddedilir', async () => {
    const card = (id: number, title: string) => `<div class="tender-list-item"><div class="info"><strong>${title}</strong><div class="attribute"><label>İhale Tarihi:</label><span>04.12.2026 15:00</span></div></div><div class="button"><a href="/ihaleler/detay/${id}" class="btn">İhale Detayı <i></i></a></div></div>`
    const p1 = card(1, 'Keçiören Hizmet Binası Alüminyum Doğrama ve Yangın Kapısı Yapım İşi') + card(2, 'Ekonomik Ömrünü Doldurmuş Araçların Satış İhalesi') + '<a href="/ihaleler?page=2">Sonraki</a>'
    const p2 = card(3, 'Mamak 24 Derslikli Okul Binası İnşaatı Yapım İşi')
    const html = (b: string) => () => new Response(b, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    const { db, ingests, rejects } = fakeDb([src({ kind: 'site', url: 'https://ihale.ornek.test/ihaleler', last_run_at: null })])
    const { d, calls } = deps(db, {
      'https://ihale.ornek.test/robots.txt': () => new Response('User-agent: *', { status: 200, headers: { 'content-type': 'text/plain' } }),
      'https://ihale.ornek.test/ihaleler': html(p1),
      'https://ihale.ornek.test/ihaleler?page=2': html(p2),
    })
    const s = await runScan(d)
    expect(calls.map((c) => c.url)).toEqual(['https://ihale.ornek.test/robots.txt', 'https://ihale.ornek.test/ihaleler', 'https://ihale.ornek.test/ihaleler?page=2'])
    expect(ingests[0].items.map((i) => i.title)).toEqual(['Keçiören Hizmet Binası Alüminyum Doğrama ve Yangın Kapısı Yapım İşi', 'Mamak 24 Derslikli Okul Binası İnşaatı Yapım İşi'])
    expect(ingests[0].items[0].verified_need).toBe(true)
    expect(ingests[0].items[1].verified_need).toBe(false)
    expect(ingests[0].items[0].deadline).toBe('2026-12-04')
    expect(rejects[0]).toMatchObject({ rejected: 1, reasons: { insaat_disi: 1 } })
    expect(s.runs[0]).toMatchObject({ seen: 3, rejected: 1 })
  })
  it('site: daha önce taranmış kaynakta yalnız ilk sayfa okunur', async () => {
    const { db } = fakeDb([src({ kind: 'site', url: 'https://ihale.ornek.test/ihaleler', last_run_at: '2026-10-28T10:00:00Z' })])
    const { d, calls } = deps(db, {
      'https://ihale.ornek.test/robots.txt': () => new Response('', { status: 404, headers: { 'content-type': 'text/plain' } }),
      'https://ihale.ornek.test/ihaleler': () => new Response('<a href="/ihaleler?page=2">Sonraki</a>', { status: 200, headers: { 'content-type': 'text/html' } }),
    })
    await runScan(d)
    expect(calls).toHaveLength(2)
  })
})

describe('kaynak doğrulama (etkinleştirmeden önce)', () => {
  const site = src({ kind: 'site', url: 'https://ihale.ornek.test/ihaleler', permission_status: 'inceleniyor', active: false })
  const html = (b: string, status = 200) => () => new Response(b, { status, headers: { 'content-type': 'text/html' } })
  const robots = (b: string) => () => new Response(b, { status: 200, headers: { 'content-type': 'text/plain' } })
  it('robots izinli, 200, ilan başlıkları var → ok; ilgili ilan sayılır', async () => {
    const { db, ingests } = fakeDb([site])
    const { d } = deps(db, { 'https://ihale.ornek.test/robots.txt': robots('User-agent: *\nDisallow:'), 'https://ihale.ornek.test/ihaleler': html('<a href="/i/1">Hizmet Binası PVC Doğrama Yapım İşi İhalesi</a><a href="/i/2">Kantin Kiralama İhalesi Duyurusu</a>') })
    const v = await verifySource(d, site)
    expect(v).toMatchObject({ ok: true, robots: 'izinli', http_status: 200, items: 2, relevant: 1, blockers: [] })
    expect(ingests).toHaveLength(0)
  })
  it('robots yasak, HTTP hata veya girişle gizli içerik → doğrulanmaz', async () => {
    const { db } = fakeDb([site])
    expect((await verifySource(deps(db, { 'https://ihale.ornek.test/robots.txt': robots('User-agent: *\nDisallow: /ihaleler') }).d, site)).blockers).toEqual(['robots_yasak'])
    expect((await verifySource(deps(db, { 'https://ihale.ornek.test/robots.txt': robots(''), 'https://ihale.ornek.test/ihaleler': html('yasak', 403) }).d, site)).blockers).toEqual(['http_403'])
    const login = await verifySource(deps(db, { 'https://ihale.ornek.test/robots.txt': robots(''), 'https://ihale.ornek.test/ihaleler': html('<form><input type="password" name="p"></form>') }).d, site)
    expect(login).toMatchObject({ ok: false, blockers: ['giris_gerekli'] })
  })
})
