/**
 * LEONX Radar — tarama düzenleyicisi (Edge Function "radar-scan" bunu çalıştırır; testler sahte
 * veritabanı ve sahte fetch ile aynı kodu sınar).
 *
 * Akış (her çağrı):
 *  1. Elle eklenmiş, sınıflandırılmayı bekleyen öğeler (indirilmez; yalnız sahibin yapıştırdığı metin).
 *  2. Zamanı gelmiş, ETKİN ve izni 'izinli' kaynaklar (veritabanı kiralar; aynı kaynak iki kez alınmaz).
 *     rss/atom → koşullu GET (ETag/Last-Modified) → ayrıştır; site → önce robots.txt, sonra yalnız
 *     kayıtlı sayfa; search_api → yalnız ayar açık + anahtar varsa, her çağrıdan önce bütçe ayrılır.
 *  3. Öğeler sınıflandırılır, puanlanır, kümelenir ve radar_ingest ile toplu yazılır.
 *  Toplam süre bütçesi (varsayılan 50 sn) ve kaynak sınırı vardır. Hata/geri çekilme süresi
 *  veritabanında hesaplanır (radar_ingest: next_run_at = şimdi + min(24 sa, aralık × 2^hata)).
 */
import { ruleAnalyzer } from './analyzer.ts'
import type { SourceKind } from './classify.ts'
import type { ClusterRef } from './dedupe.ts'
import { parseFeed } from './feed.ts'
import { buildIngestItem, type IngestItem, type PipelineSettings, type RawInput, type SourceContext } from './pipeline.ts'
import { isAllowed, policyForStatus } from './robots.ts'
import { htmlToText } from './sanitize.ts'
import { normalizeWeights } from './score.ts'
import { buildQueries, tavilySearch } from './tavily.ts'
import { FEED_TYPES, GuardError, HTML_TYPES, policyFor, safeFetch, type SafeFetchDeps, TEXT_TYPES } from './urlGuard.ts'

export interface SourceRow {
  id: string
  name: string
  kind: SourceKind
  url: string | null
  allowed_hosts: string[] | null
  sector_hint: 'kamu' | 'ozel' | null
  permission_status: 'izinli' | 'inceleniyor' | 'izinsiz'
  max_items: number
  etag: string | null
  last_modified: string | null
  active: boolean
}

export interface SettingsRow {
  weights: Record<string, number> | null
  search_api_enabled: boolean
  search_queries_per_run: number
}

export interface CategoryRow {
  key: string
  active: boolean
  extra_keywords: string[] | null
}

export interface PendingManual {
  id: string
  source_id: string
  url: string
  title: string
  raw_text: string | null
  published_at: string | null
}

export type RunStatus = 'ok' | 'degismedi' | 'hata' | 'atlandi'

export interface RunRecord {
  id: string
  started_at: string
  finished_at: string
  status: RunStatus
  http_status: number | null
  items_seen: number
  error: string | null
  duration_ms: number
  etag?: string | null
  last_modified?: string | null
}

export interface IngestResult {
  items_new: number
  items_updated: number
  items_seen: number
}

export interface RadarDb {
  claimDueSources(limit: number): Promise<SourceRow[]>
  getSource(id: string): Promise<SourceRow | null>
  settings(): Promise<SettingsRow>
  categories(): Promise<CategoryRow[]>
  clusters(): Promise<ClusterRef[]>
  pendingManual(limit: number): Promise<PendingManual[]>
  ingest(sourceId: string, run: RunRecord, items: IngestItem[]): Promise<IngestResult>
  /** Bir arama çağrısı için bütçe ayırır (atomik). İmleç sorgu döngüsündeki sıradır. */
  reserveSearch(): Promise<{ granted: boolean; reason: string | null; cursor: number }>
  /** Kaynak testi hız sınırı (kaynak başına 5 dk'da bir). true: izin verildi ve kaydedildi */
  claimSourceTest(sourceId: string): Promise<boolean>
}

export interface RunnerDeps extends SafeFetchDeps {
  db: RadarDb
  now: () => Date
  uuid: () => string
  tavilyKey: string | null
  log?: (msg: string) => void
  budgetMs?: number
  maxSources?: number
  batchSize?: number
}

export interface ScanSummary {
  sources: number
  manual: number
  runs: { source: string; status: RunStatus; items: number; error: string | null }[]
  stoppedForBudget: boolean
}

interface FetchOutcome {
  status: RunStatus
  httpStatus: number | null
  contentType: string | null
  items: RawInput[]
  warnings: string[]
  error: string | null
  robots: 'izinli' | 'yasak' | 'gerekmiyor'
  etag: string | null
  lastModified: string | null
}

const blank = (o: Partial<FetchOutcome>): FetchOutcome => ({ status: 'ok', httpStatus: null, contentType: null, items: [], warnings: [], error: null, robots: 'gerekmiyor', etag: null, lastModified: null, ...o })

/** Liste sayfasındaki başlık benzeri bağlantılar (yalnız aynı ana makine; bağlantılar İNDİRİLMEZ) */
export function headlineLinks(html: string, pageUrl: string, allowedHosts: string[], max: number): RawInput[] {
  const out: RawInput[] = []
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const hm = /\shref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(` ${m[1]}`)
    if (!hm) continue
    let u: URL
    try {
      u = new URL((hm[2] ?? hm[3] ?? '').trim(), pageUrl)
    } catch {
      continue
    }
    if (u.protocol !== 'https:' || !allowedHosts.includes(u.hostname.toLowerCase())) continue
    const text = htmlToText(m[2], 400)
    if (text.length < 20) continue
    u.hash = ''
    if (out.some((x) => x.url === u.toString())) continue
    out.push({ url: u.toString(), title: text, body: '', publishedAt: null })
    if (out.length >= max) break
  }
  return out
}

/** Bir kaynağı indirip ayrıştırır (yazmadan). Tarama ve "Kaynağı test et" ortak kullanır. */
export async function fetchSource(src: SourceRow, deps: SafeFetchDeps, opts: { conditional: boolean }): Promise<FetchOutcome> {
  if (!src.url) return blank({ status: 'atlandi', error: 'Kaynak adresi yok' })
  const policy = policyFor(src.url, src.allowed_hosts)
  try {
    if (src.kind === 'rss' || src.kind === 'atom') {
      const r = await safeFetch(src.url, { policy, accept: [...FEED_TYPES, ...TEXT_TYPES], etag: opts.conditional ? src.etag : null, lastModified: opts.conditional ? src.last_modified : null }, deps)
      if (r.notModified) return blank({ status: 'degismedi', httpStatus: 304, etag: r.etag, lastModified: r.lastModified })
      if (r.status < 200 || r.status >= 300) return blank({ status: 'hata', httpStatus: r.status, contentType: r.contentType, error: `HTTP ${r.status}` })
      const feed = parseFeed(r.body, Math.max(1, Math.min(200, src.max_items)))
      if (feed.kind === 'bilinmiyor') return blank({ status: 'hata', httpStatus: r.status, contentType: r.contentType, warnings: feed.warnings, error: 'RSS/Atom akışı tanınmadı' })
      return blank({
        status: 'ok', httpStatus: r.status, contentType: r.contentType, warnings: feed.warnings, etag: r.etag, lastModified: r.lastModified,
        items: feed.items.map((i) => ({ url: i.link!, title: i.title, body: i.summary, publishedAt: i.publishedAt })),
      })
    }
    if (src.kind === 'site') {
      const page = new URL(src.url)
      const rb = await safeFetch(`https://${page.hostname}/robots.txt`, { policy, accept: [...TEXT_TYPES, ...HTML_TYPES, 'application/octet-stream'] }, deps).catch((e) => {
        if (e instanceof GuardError && e.code === 'icerik_turu') return { status: 200, body: '' } as { status: number; body: string }
        throw e
      })
      const robots = policyForStatus(rb.status, rb.body)
      if (!isAllowed(robots, page.pathname + page.search)) return blank({ status: 'atlandi', robots: 'yasak', error: 'robots.txt bu sayfaya izin vermiyor' })
      const r = await safeFetch(src.url, { policy, accept: HTML_TYPES, etag: opts.conditional ? src.etag : null, lastModified: opts.conditional ? src.last_modified : null }, deps)
      if (r.notModified) return blank({ status: 'degismedi', httpStatus: 304, robots: 'izinli', etag: r.etag, lastModified: r.lastModified })
      if (r.status < 200 || r.status >= 300) return blank({ status: 'hata', httpStatus: r.status, robots: 'izinli', error: `HTTP ${r.status}` })
      const items = headlineLinks(r.body, r.finalUrl, policy.allowedHosts, Math.max(1, Math.min(100, src.max_items)))
      return blank({ status: 'ok', httpStatus: r.status, contentType: r.contentType, robots: 'izinli', items, etag: r.etag, lastModified: r.lastModified, warnings: items.length ? [] : ['Sayfada başlık bağlantısı bulunamadı'] })
    }
    return blank({ status: 'atlandi', error: src.kind === 'manual' ? 'Elle eklenen kaynak indirilmez' : 'Bu kaynak türü test edilmez' })
  } catch (e) {
    const msg = e instanceof GuardError ? e.message : `Beklenmeyen hata: ${e instanceof Error ? e.message : String(e)}`
    return blank({ status: 'hata', error: msg.slice(0, 500) })
  }
}

async function loadSettings(db: RadarDb): Promise<{ s: SettingsRow; p: PipelineSettings }> {
  const [s, cats] = await Promise.all([db.settings(), db.categories()])
  const extra: Record<string, string[]> = {}
  for (const c of cats) if (c.extra_keywords?.length) extra[c.key] = c.extra_keywords
  return { s, p: { weights: normalizeWeights(s.weights), activeCategories: cats.length ? cats.filter((c) => c.active).map((c) => c.key) : null, extraKeywords: extra } }
}

/** Ana tarama */
export async function runScan(deps: RunnerDeps): Promise<ScanSummary> {
  const t0 = deps.now().getTime()
  const budget = deps.budgetMs ?? 50_000
  const batch = deps.batchSize ?? 25
  const summary: ScanSummary = { sources: 0, manual: 0, runs: [], stoppedForBudget: false }
  const { s, p } = await loadSettings(deps.db)
  const clusters = await deps.db.clusters()
  const overBudget = () => deps.now().getTime() - t0 > budget

  const ingestAll = async (src: SourceRow, ctx: SourceContext, raws: (RawInput & { pendingId?: string })[], base: Omit<RunRecord, 'items_seen' | 'finished_at' | 'duration_ms'>) => {
    const items: IngestItem[] = []
    for (const raw of raws) {
      const it = await buildIngestItem(raw, ctx, p, clusters, deps.now(), ruleAnalyzer)
      if (!it) continue
      if (raw.pendingId) it.pending_item_id = raw.pendingId
      if (!clusters.some((c) => c.clusterKey === it.cluster_key)) clusters.push({ clusterKey: it.cluster_key, tokens: it.cluster_tokens, city: it.city })
      items.push(it)
    }
    let total = 0
    const finish = () => ({ ...base, finished_at: deps.now().toISOString(), duration_ms: deps.now().getTime() - Date.parse(base.started_at), items_seen: raws.length })
    if (!items.length) {
      await deps.db.ingest(src.id, finish(), [])
      return 0
    }
    for (let i = 0; i < items.length; i += batch) {
      const r = await deps.db.ingest(src.id, finish(), items.slice(i, i + batch))
      total += r.items_new
    }
    return total
  }

  // 1) Elle eklenen bekleyen öğeler (indirme yok)
  const pending = await deps.db.pendingManual(50)
  const bySource = new Map<string, PendingManual[]>()
  for (const m of pending) bySource.set(m.source_id, [...(bySource.get(m.source_id) ?? []), m])
  for (const [sid, list] of bySource) {
    const src = await deps.db.getSource(sid)
    if (!src) continue
    const started = deps.now().toISOString()
    const ctx: SourceContext = { id: src.id, kind: 'manual', sectorHint: src.sector_hint, permission: src.permission_status }
    const n = await ingestAll(src, ctx, list.map((m) => ({ url: m.url, title: m.title, body: m.raw_text ?? '', publishedAt: m.published_at, pendingId: m.id })), { id: deps.uuid(), started_at: started, status: 'ok', http_status: null, error: null })
    summary.manual += list.length
    summary.runs.push({ source: src.name, status: 'ok', items: n, error: null })
  }

  // 2) Zamanı gelen kaynaklar
  const due = await deps.db.claimDueSources(deps.maxSources ?? 10)
  for (const src of due) {
    if (overBudget()) {
      summary.stoppedForBudget = true
      break
    }
    // Savunma: veritabanı yalnız izinli+etkin kaynak kiralar; yine de burada tekrar denetlenir
    if (!src.active || src.permission_status !== 'izinli' || src.kind === 'manual') continue
    summary.sources++
    const started = deps.now().toISOString()
    const ctx: SourceContext = { id: src.id, kind: src.kind, sectorHint: src.sector_hint, permission: src.permission_status }
    const runId = deps.uuid()

    if (src.kind === 'search_api') {
      const skip = !s.search_api_enabled ? 'Arama API ayarlarda kapalı (search_api_enabled)' : !deps.tavilyKey ? 'TAVILY_API_KEY gizli değişkeni tanımlı değil' : null
      if (skip) {
        await deps.db.ingest(src.id, { id: runId, started_at: started, finished_at: deps.now().toISOString(), status: 'atlandi', http_status: null, items_seen: 0, error: skip, duration_ms: 0 }, [])
        summary.runs.push({ source: src.name, status: 'atlandi', items: 0, error: skip })
        continue
      }
      const all = buildQueries(p.activeCategories)
      const raws: RawInput[] = []
      let status: RunStatus = 'ok'
      let error: string | null = null
      let http: number | null = null
      for (let q = 0; q < Math.max(0, Math.min(10, s.search_queries_per_run)); q++) {
        if (overBudget()) break
        const res = await deps.db.reserveSearch()
        if (!res.granted) {
          if (q === 0) {
            status = 'atlandi'
            error = res.reason ?? 'aylık arama bütçesi doldu'
          }
          break
        }
        const query = all[res.cursor % all.length]
        try {
          const r = await tavilySearch(query, deps.tavilyKey!, deps, Math.min(10, src.max_items))
          http = r.status
          if (r.status < 200 || r.status >= 300) {
            status = 'hata'
            error = `Arama API HTTP ${r.status}`
            break
          }
          for (const x of r.results) raws.push({ url: x.url, title: x.title, body: x.content, publishedAt: x.publishedAt })
        } catch (e) {
          status = 'hata'
          error = e instanceof Error ? e.message.slice(0, 300) : 'Arama hatası'
          break
        }
      }
      const n = status === 'ok' ? await ingestAll(src, ctx, raws, { id: runId, started_at: started, status, http_status: http, error }) : (await deps.db.ingest(src.id, { id: runId, started_at: started, finished_at: deps.now().toISOString(), status, http_status: http, items_seen: 0, error, duration_ms: deps.now().getTime() - Date.parse(started) }, []), 0)
      summary.runs.push({ source: src.name, status, items: n, error })
      continue
    }

    const out = await fetchSource(src, deps, { conditional: true })
    if (out.status !== 'ok') {
      await deps.db.ingest(src.id, { id: runId, started_at: started, finished_at: deps.now().toISOString(), status: out.status, http_status: out.httpStatus, items_seen: 0, error: out.error, duration_ms: deps.now().getTime() - Date.parse(started), etag: out.etag, last_modified: out.lastModified }, [])
      summary.runs.push({ source: src.name, status: out.status, items: 0, error: out.error })
      continue
    }
    const n = await ingestAll(src, ctx, out.items, { id: runId, started_at: started, status: 'ok', http_status: out.httpStatus, error: out.warnings.length ? out.warnings.slice(0, 5).join(' · ').slice(0, 500) : null, etag: out.etag, last_modified: out.lastModified })
    summary.runs.push({ source: src.name, status: 'ok', items: n, error: null })
  }
  deps.log?.(`radar: ${summary.sources} kaynak, ${summary.manual} elle öğe`)
  return summary
}

export interface SourceTestResult {
  ok: boolean
  error: string | null
  http_status: number | null
  content_type: string | null
  item_count: number
  items: { title: string; link: string }[]
  warnings: string[]
  robots: 'izinli' | 'yasak' | 'gerekmiyor'
}

/** "Kaynağı test et": tek kaynağı aynı güvenlik hattından indirir, YAZMAZ. Kaynak başına 5 dk sınırı. */
export async function testSource(deps: RunnerDeps, sourceId: string): Promise<SourceTestResult> {
  const src = await deps.db.getSource(sourceId)
  const empty: SourceTestResult = { ok: false, error: null, http_status: null, content_type: null, item_count: 0, items: [], warnings: [], robots: 'gerekmiyor' }
  if (!src) return { ...empty, error: 'Kaynak bulunamadı' }
  if (src.kind === 'search_api' || src.kind === 'manual') return { ...empty, error: src.kind === 'manual' ? 'Elle eklenen kaynak indirilmez' : 'Arama kaynağı test edilmez (arama bütçesi tüketir)' }
  if (!(await deps.db.claimSourceTest(sourceId))) return { ...empty, error: 'Bu kaynak son 5 dakika içinde test edildi; biraz sonra tekrar deneyin' }
  const out = await fetchSource(src, deps, { conditional: false })
  return {
    ok: out.status === 'ok',
    error: out.error,
    http_status: out.httpStatus,
    content_type: out.contentType,
    item_count: out.items.length,
    items: out.items.slice(0, 5).map((i) => ({ title: i.title.slice(0, 300), link: i.url })),
    warnings: out.warnings.slice(0, 10),
    robots: out.robots,
  }
}
