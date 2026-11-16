/**
 * LEONX Radar — özel sektör keşif çalıştırıcısı (radar-scan { discover: true }, saatlik pg_cron).
 *
 * Her çalıştırma:
 *  1. Yapılandırma: etkin + İzinli özel sektör keşif kaynağı, ayarlarda keşif ve arama API'si açık,
 *     TAVILY_API_KEY tanımlı mı? Eksikse arama yapılmaz ve nedeni AYNEN kaydedilir (sahte başarı yok).
 *  2. Sorgu rotasyonu (discovery.ts): en az aranmış ilçeler önce; her sorgudan ÖNCE bütçe ayrılır.
 *  3. Sonuçlar: tekilleştirme (30 gün içinde görülen adres atlanır = artımlı keşif), sayfa türü, kamu/özel,
 *     firma adı (yalnız metinden), daire sayısı/ölçek, kanıtlı aşama, şeffaf puan, satış bölümleri.
 *     Kamu sonuçları atılmaz; "Kamu İhaleleri" ikincil kanalına gider.
 *  4. Firma sitesi izleme (ayar açıksa): zamanı gelen firmaların KENDİ sitelerinde robots.txt'ye uyarak
 *     proje sayfaları ve kurumsal iletişim kanalları (en çok birkaç sayfa, aynı alan adı).
 *  5. radar_ingest (mevcut fırsat/kanıt hattı) + radar_service_discovery_save (özel sektör alanları).
 *  6. E-posta adayları için Türkçe taslak → İNCELEME kuyruğu (bu adım asla göndermez).
 *  7. Çalıştırma kaydı: sorgular, ilçeler, firmalar, yeni/güncellenen projeler, iletişim, adaylar, hatalar,
 *     API kullanımı ve kalan LEONX arama bütçesi; durum = discoveryStatus().
 */
import { ruleAnalyzer } from './analyzer.ts'
import { assessPage, companyKindFor, contractorKind, extractCompanyName, extractUnitCount, type PageKind, sizeBand } from './company.ts'
import type { ClusterRef } from './dedupe.ts'
import { identify } from './dedupe.ts'
import { buildDiscoveryPlan, diversityMetrics, discoveryStatus, type DiscoveryStatus, type PlannedQuery, type QueryState, selectQueries } from './discovery.ts'
import { buildEmail, checkEligibility, matchServices } from './outreach.ts'
import { buildIngestItem, type IngestItem, normalizeName, type PipelineSettings, type RawInput, type SourceContext } from './pipeline.ts'
import { assessStage, privateScore, procurementStatus, relevanceExplanation, segmentsFor } from './privateIntel.ts'
import { relevance } from './relevance.ts'
import { researchCompanyContacts } from './research.ts'
import { isAllowed, policyForStatus } from './robots.ts'
import { headlineLinks, type RunRecord, type SourceRow } from './runner.ts'
import { hostOf, htmlToText } from './sanitize.ts'
import { normalizeWeights } from './score.ts'
import { PROJECT_TYPE_BY_KEY } from './taxonomy.ts'
import { tavilySearch } from './tavily.ts'
import { fold } from './text.ts'
import { GuardError, HTML_TYPES, safeFetch, type SafeFetchDeps, TEXT_TYPES } from './urlGuard.ts'

export interface DiscoveryConfig {
  source: SourceRow | null
  settings: {
    discovery_enabled: boolean
    search_api_enabled: boolean
    queries_per_run: number
    company_monitoring_enabled: boolean
    company_pages_per_run: number
    outreach_min_score: number
    excluded_companies: string[] | null
    outreach_auto_send?: boolean
    gmail_verified_at?: string | null
    outreach_legal_confirmed_at?: string | null
    outreach_daily_limit?: number
  }
  run_index: number
  quota: Quota | null
}

export interface Quota { month_used: number; month_limit: number; month_remaining: number; day_used: number; day_limit: number }

export interface CompanyRow { id: string; name: string; normalized_name: string; website: string | null; projects_page_url?: string | null; name_basis?: string | null }

export interface OutreachCandidate {
  opportunity: { id: string; title: string; city: string | null; district: string | null; project_type: string | null; construction_stage: string | null; stage_active: boolean | null; stage_confidence: string | null; verified_need: boolean; procurement_status: string | null; private_score: number | null; product_groups: string[]; sector: 'kamu' | 'ozel' | 'bilinmiyor'; stage_evidence_url: string | null; evidence_url: string | null; unit_text: string | null }
  company: { id: string; name: string; name_basis: string | null; website: string | null; excluded: boolean; opted_out: boolean }
  contact: { id: string; email: string; kind: string; verified_at: string; source_url: string }
  last_email_days: number | null
  suppressed: boolean
}

export interface DiscoveryDb {
  config(): Promise<DiscoveryConfig>
  settingsForPipeline(): Promise<PipelineSettings>
  clusters(): Promise<ClusterRef[]>
  queryStates(): Promise<QueryState[]>
  /** Son 30 günde görülmüş url_hash'ler */
  recentlySeen(hashes: string[]): Promise<Set<string>>
  reserveSearch(): Promise<{ granted: boolean; reason: string | null; cursor: number }>
  ingest(sourceId: string, run: RunRecord, items: IngestItem[]): Promise<{ items_new: number; items_updated: number; items_seen: number }>
  saveDiscovery(payload: DiscoveryPayload): Promise<{ companies_new: number; companies_found: number; projects_new: number; projects_updated: number; contacts_verified: number }>
  dueCompanies(limit: number): Promise<CompanyRow[]>
  outreachCandidates(limit: number): Promise<OutreachCandidate[]>
  saveDrafts(drafts: unknown[]): Promise<number>
  saveRun(run: DiscoveryRunRow): Promise<void>
  quota(): Promise<Quota | null>
}

export interface DiscoveryItem {
  url_hash: string
  page_kind: PageKind
  sector: 'kamu' | 'ozel' | 'bilinmiyor'
  discovered_via: 'arama' | 'firma_sitesi'
  unit_count: number | null
  unit_text: string | null
  size_band: string
  stage_display: string
  stage_confidence: string | null
  stage_active: boolean | null
  stage_new_start: boolean
  stage_evidence_url: string | null
  stage_evidence_at: string | null
  stage_explanation: string
  procurement_status: string
  relevance_explanation: string
  segments: string[]
  private_score: number
  private_score_breakdown: unknown[]
  company: null | { name: string; normalized_name: string; name_basis: 'metin' | 'alan_adi'; website: string | null; sector: string; size_band: string; contractor_kind: string; company_kind: string; city: string | null; district: string | null; discovery_source: 'arama' | 'firma_sitesi'; discovery_url: string; discovery_query: string | null }
}

export interface DiscoveryPayload {
  run_started_at: string
  items: DiscoveryItem[]
  queries: { key: string; pattern: string; family: string; city: string; district: string | null; query: string; results: number; new_results: number; status: 'ok' | 'hata' | 'kota' }[]
  seen: { url_hash: string; url: string; domain: string | null; query_key: string | null; page_kind: PageKind | null; outcome: 'firsat' | 'ret' | 'tekrar'; reject_reason: string | null }[]
  companies_checked: { id: string; status: string; note: string | null; projects_page_url: string | null }[]
  contacts: { company_id: string; kind: string; value: string; source_url: string; verified_at: string }[]
}

export interface DiscoveryRunRow {
  id: string
  started_at: string
  finished_at: string
  status: DiscoveryStatus
  sources: { name: string; kind: string; status: string }[]
  query_log: { key: string; query: string; city: string; district: string | null; status: string; results: number; new: number; error?: string }[]
  districts: string[]
  results_seen: number
  results_new: number
  results_rejected: number
  companies_found: number
  companies_new: number
  company_pages: number
  projects_new: number
  projects_updated: number
  contacts_verified: number
  outreach_candidates: number
  errors: string[]
  api_calls: number
  quota_used: number | null
  quota_limit: number | null
  quota_remaining: number | null
  diversity: unknown
  note: string | null
}

export interface DiscoveryDeps extends SafeFetchDeps {
  db: DiscoveryDb
  now: () => Date
  uuid: () => string
  tavilyKey: string | null
  budgetMs?: number
  log?: (m: string) => void
}

/** Özel sektör sorgularında kamu ilan siteleri sonuçtan çıkarılır (kamu ayrı kanaldan izlenir) */
export const PRIVATE_EXCLUDE_DOMAINS = ['ekap.kik.gov.tr', 'ilan.gov.tr', 'gov.tr', 'bel.tr', 'edu.tr']

interface Analyzed {
  ingest: IngestItem | null
  enrich: DiscoveryItem | null
  seen: DiscoveryPayload['seen'][number]
}

/** Tek sonucu çözümler (arama sonucu veya firma sitesindeki proje bağlantısı) */
export async function analyzeResult(
  raw: RawInput,
  ctx: { source: SourceContext; settings: PipelineSettings; clusters: ClusterRef[]; now: Date; queryKey: string | null; query: string | null; via: 'arama' | 'firma_sitesi'; knownCompany?: CompanyRow | null },
): Promise<Analyzed | null> {
  const item = await buildIngestItem(raw, ctx.source, ctx.settings, ctx.clusters, ctx.now, ruleAnalyzer)
  if (!item) return null
  const c = item.classification
  const intel = c.intel!
  const page = assessPage(item.canonical_url, item.title, item.summary, c)
  if (ctx.knownCompany) {
    page.kind = 'firma_proje_sayfasi'
    page.sector = 'ozel'
    page.sectorReason = 'Firmanın kendi sitesindeki proje'
    page.companyWebsite = ctx.knownCompany.website
  }
  const seenBase = { url_hash: item.url_hash, url: item.canonical_url, domain: page.host, query_key: ctx.queryKey, page_kind: page.kind }
  const rel = relevance(c, item.title, item.summary)
  const firmPage = page.kind === 'firma_sitesi' || page.kind === 'firma_proje_sayfasi' || page.kind === 'ilan_portali'
  const keep = rel.keep || (firmPage && rel.reason !== 'haric_firma' && rel.reason !== 'tamamlanmis' && (!!c.projectType || !!intel.stage))
  if (!keep) return { ingest: null, enrich: null, seen: { ...seenBase, outcome: 'ret', reject_reason: rel.reason } }

  if (page.kind !== 'haber' && page.kind !== 'diger') item.sector = page.sector
  else if (item.sector === 'bilinmiyor' && page.sector !== 'bilinmiyor') item.sector = page.sector
  const text = `${item.title}. ${item.summary}`
  let company: DiscoveryItem['company'] = null
  const name = ctx.knownCompany ? { name: ctx.knownCompany.name, basis: (ctx.knownCompany.name_basis === 'alan_adi' ? 'alan_adi' : 'metin') as 'metin' | 'alan_adi' } : extractCompanyName(item.title, item.summary, page.host, c)
  // Alan adından ad yalnız firmanın kendi sitesinde kullanılır (portal/haber alan adı firma değildir)
  if (name && (name.basis === 'metin' || page.kind === 'firma_sitesi' || page.kind === 'firma_proje_sayfasi') && item.sector !== 'kamu') {
    const kind = contractorKind(name.name, text)
    company = {
      name: name.name, normalized_name: ctx.knownCompany?.normalized_name ?? normalizeName(name.name), name_basis: name.basis,
      website: page.companyWebsite, sector: item.sector === 'bilinmiyor' ? 'ozel' : item.sector, size_band: 'bilinmiyor', contractor_kind: kind, company_kind: companyKindFor(kind),
      city: item.city, district: item.district, discovery_source: ctx.via, discovery_url: item.canonical_url, discovery_query: ctx.query,
    }
  }
  const units = extractUnitCount(text)
  const band = sizeBand(units)
  if (company) company.size_band = band
  const stage = assessStage(intel, raw.publishedAt, ctx.now, page.kind)
  const supplierInvite = intel.supplierInvite.length > 0
  const sc = privateScore({ products: intel.products, stage, city: item.city, district: item.district, isAnkara: item.is_ankara, verifiedNeed: item.verified_need, supplierInvite, size: band, contact: page.companyWebsite ? 'site' : 'yok' })
  const segments = segmentsFor({ sector: item.sector as 'kamu' | 'ozel' | 'bilinmiyor', stage, verifiedNeed: item.verified_need, supplierInvite, isProcurement: c.isProcurement, hasCompany: !!company })
  const enrich: DiscoveryItem = {
    url_hash: item.url_hash,
    page_kind: page.kind,
    sector: item.sector as DiscoveryItem['sector'],
    discovered_via: ctx.via,
    unit_count: units?.count ?? null,
    unit_text: units?.text ?? null,
    size_band: band,
    stage_display: stage.display,
    stage_confidence: stage.confidence,
    stage_active: stage.active,
    stage_new_start: stage.newStart,
    stage_evidence_url: stage.stage ? item.canonical_url : null,
    stage_evidence_at: stage.stage ? stage.evidenceDate : null,
    stage_explanation: stage.explanation,
    procurement_status: procurementStatus(c, item.verified_need, supplierInvite),
    relevance_explanation: relevanceExplanation({ companyName: company?.name_basis === 'metin' ? company.name : null, projectTypeLabel: c.projectType ? PROJECT_TYPE_BY_KEY[c.projectType.key]?.label ?? null : null, district: item.district, city: item.city, stage, products: intel.products.map((x) => x.group), verifiedNeed: item.verified_need, unitText: units?.text ?? null }),
    segments,
    private_score: sc.score,
    private_score_breakdown: sc.parts,
    company,
  }
  item.evidence.push({ field: 'sayfa_turu', claim: `Sayfa türü: ${page.kind} — ${page.sectorReason}`, excerpt: item.title.slice(0, 500) })
  if (units) item.evidence.push({ field: 'olcek', claim: `Kaynakta geçen büyüklük: ${units.text}`, excerpt: units.text })
  return { ingest: item, enrich, seen: { ...seenBase, outcome: 'firsat', reject_reason: null } }
}

// ------------------------------------------------------------------ Firma sitesi izleme

const PROJECT_LINK_TEXT = /^(projelerimiz|projeler|devam eden projeler|devam eden|guncel projeler|yeni projeler|tamamlanan projeler|projects)$/
const PROJECT_LINK_PATH = /\/(projeler|projelerimiz|projects?|devam-eden[-a-z]*|guncel-projeler|yeni-projeler)\/?$/i

/** Ana sayfadaki proje listesi bağlantıları (aynı ana makine); "devam eden" önce */
export function projectListLinks(html: string, pageUrl: string, allowedHosts: string[]): string[] {
  const out: { url: string; rank: number }[] = []
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
    const t = fold(htmlToText(m[2], 80)).trim()
    if (!PROJECT_LINK_TEXT.test(t) && !PROJECT_LINK_PATH.test(u.pathname)) continue
    u.hash = ''
    const rank = /devam|guncel|yeni/.test(t + u.pathname) ? 0 : /tamamlan/.test(t + u.pathname) ? 2 : 1
    if (!out.some((x) => x.url === u.toString())) out.push({ url: u.toString(), rank })
  }
  return out.sort((a, b) => a.rank - b.rank).map((x) => x.url)
}

export interface CompanyCheck {
  status: 'ok' | 'hata' | 'robots_yasak' | 'proje_sayfasi_yok' | 'atlandi'
  note: string | null
  projectsPageUrl: string | null
  items: RawInput[]
  pages: number
  contacts: DiscoveryPayload['contacts']
}

export async function monitorCompany(co: CompanyRow, deps: SafeFetchDeps & { now: () => Date }): Promise<CompanyCheck> {
  const res: CompanyCheck = { status: 'ok', note: null, projectsPageUrl: null, items: [], pages: 0, contacts: [] }
  let home: URL
  try {
    home = new URL(co.website ?? '')
    if (home.protocol !== 'https:') throw new Error('https değil')
  } catch {
    return { ...res, status: 'atlandi', note: 'Geçerli https web sitesi yok' }
  }
  const host = home.hostname.toLowerCase()
  const bare = host.replace(/^www\./, '')
  const policy = { allowedHosts: [...new Set([host, bare, `www.${bare}`])] }
  try {
    const rb = await safeFetch(`https://${host}/robots.txt`, { policy, accept: [...TEXT_TYPES, ...HTML_TYPES, 'application/octet-stream'] }, deps).catch((e) => {
      if (e instanceof GuardError && e.code === 'icerik_turu') return { status: 200, body: '' } as { status: number; body: string }
      throw e
    })
    const robots = policyForStatus(rb.status, rb.body)
    let lists: string[] = co.projects_page_url ? [co.projects_page_url] : []
    if (!lists.length) {
      if (!isAllowed(robots, home.pathname || '/')) return { ...res, status: 'robots_yasak', note: 'robots.txt ana sayfaya izin vermiyor' }
      const h = await safeFetch(home.toString(), { policy, accept: HTML_TYPES }, deps)
      res.pages++
      if (h.status < 200 || h.status >= 300) return { ...res, status: 'hata', note: `Ana sayfa HTTP ${h.status}` }
      lists = projectListLinks(h.body, h.finalUrl, policy.allowedHosts).slice(0, 2)
    }
    if (!lists.length) res.status = 'proje_sayfasi_yok'
    for (const url of lists.slice(0, 2)) {
      const u = new URL(url)
      if (!isAllowed(robots, u.pathname + u.search)) {
        res.note = 'robots.txt proje sayfasına izin vermiyor'
        res.status = 'robots_yasak'
        continue
      }
      const r = await safeFetch(url, { policy, accept: HTML_TYPES }, deps)
      res.pages++
      if (r.status < 200 || r.status >= 300) {
        res.note = `Proje sayfası HTTP ${r.status}`
        continue
      }
      res.projectsPageUrl ??= r.finalUrl
      for (const it of headlineLinks(r.body, r.finalUrl, policy.allowedHosts, 15)) if (!res.items.some((x) => x.url === it.url)) res.items.push(it)
    }
    if (res.projectsPageUrl && res.status !== 'robots_yasak') res.status = 'ok'
    if (res.projectsPageUrl && !res.items.length) res.note = 'Proje sayfasında proje bağlantısı çıkarılamadı'
  } catch (e) {
    return { ...res, status: 'hata', note: (e instanceof Error ? e.message : String(e)).slice(0, 300) }
  }
  // Kurumsal iletişim kanalları (yalnız firmanın kendi alan adı; kişisel adresler saklanmaz)
  try {
    const cr = await researchCompanyContacts(home.toString(), deps, 4)
    res.pages += cr.pages.length
    res.contacts = cr.contacts.map((c) => ({ company_id: co.id, kind: c.kind, value: c.value, source_url: c.source_url, verified_at: c.verified_at }))
  } catch {
    // iletişim araştırması başarısızsa proje sonuçları yine yazılır
  }
  return res
}

// ------------------------------------------------------------------ Ana keşif

export async function runDiscovery(deps: DiscoveryDeps): Promise<DiscoveryRunRow> {
  const t0 = deps.now()
  const budget = deps.budgetMs ?? 45_000
  const over = () => deps.now().getTime() - t0.getTime() > budget
  const cfg = await deps.db.config()
  const s = cfg.settings
  const src = cfg.source
  const run: DiscoveryRunRow = {
    id: deps.uuid(), started_at: t0.toISOString(), finished_at: t0.toISOString(), status: 'kaynak_yok', sources: [], query_log: [], districts: [],
    results_seen: 0, results_new: 0, results_rejected: 0, companies_found: 0, companies_new: 0, company_pages: 0, projects_new: 0, projects_updated: 0,
    contacts_verified: 0, outreach_candidates: 0, errors: [], api_calls: 0, quota_used: null, quota_limit: null, quota_remaining: null, diversity: null, note: null,
  }
  const sourceReady = !!src && src.active && src.permission_status === 'izinli' && s.discovery_enabled
  const configured: 'ok' | 'kaynak_yok' | 'yapilandirma_eksik' = !sourceReady ? 'kaynak_yok' : !s.search_api_enabled || !deps.tavilyKey ? 'yapilandirma_eksik' : 'ok'
  if (configured !== 'ok') {
    run.note = !src ? 'Özel sektör keşif kaynağı kayıtlı değil'
      : !src.active || src.permission_status !== 'izinli' ? `Keşif kaynağı ${src.permission_status}${src.active ? '' : ' / pasif'}: Kaynaklar bölümünden İzinli + Etkin yapılmalı`
        : !s.discovery_enabled ? 'Ayarlarda özel sektör keşfi kapalı'
          : !s.search_api_enabled ? 'Ayarlarda arama API kapalı (search_api_enabled)' : 'TAVILY_API_KEY gizli değişkeni tanımlı değil'
  }
  run.sources.push({ name: src?.name ?? 'Özel sektör keşfi — Arama API', kind: 'search_api', status: configured })

  const pipelineSettings = await deps.db.settingsForPipeline()
  const clusters = await deps.db.clusters()
  const payload: DiscoveryPayload = { run_started_at: t0.toISOString(), items: [], queries: [], seen: [], companies_checked: [], contacts: [] }
  const ingestItems: IngestItem[] = []
  const domains: string[] = []
  let failed = 0
  let executed = 0
  let quotaStopped = false
  let budgetStopped = false
  let planned = 0
  const ctxSource: SourceContext = { id: src?.id ?? 'kesif', kind: 'search_api', sectorHint: null, permission: src?.permission_status ?? 'inceleniyor' }

  const absorb = async (raws: RawInput[], q: PlannedQuery | null, via: 'arama' | 'firma_sitesi', known?: CompanyRow) => {
    let fresh = 0
    const ids = await Promise.all(raws.map((r) => identify(r.url, r.title, r.body)))
    const seen = await deps.db.recentlySeen(ids.filter((x): x is NonNullable<typeof x> => !!x).map((x) => x.urlHash))
    for (let i = 0; i < raws.length; i++) {
      const id = ids[i]
      if (!id) continue
      run.results_seen++
      domains.push(hostOf(id.canonicalUrl)?.replace(/^www\./, '') ?? '?')
      if (seen.has(id.urlHash) || payload.seen.some((x) => x.url_hash === id.urlHash)) {
        payload.seen.push({ url_hash: id.urlHash, url: id.canonicalUrl, domain: hostOf(id.canonicalUrl), query_key: q?.key ?? null, page_kind: null, outcome: 'tekrar', reject_reason: null })
        continue
      }
      const a = await analyzeResult(raws[i], { source: via === 'firma_sitesi' ? { ...ctxSource, kind: 'site' } : ctxSource, settings: pipelineSettings, clusters, now: deps.now(), queryKey: q?.key ?? null, query: q?.query ?? null, via, knownCompany: known ?? null })
      if (!a) continue
      payload.seen.push(a.seen)
      if (!a.ingest || !a.enrich) {
        run.results_rejected++
        continue
      }
      fresh++
      run.results_new++
      if (!clusters.some((c) => c.clusterKey === a.ingest!.cluster_key)) clusters.push({ clusterKey: a.ingest.cluster_key, tokens: a.ingest.cluster_tokens, city: a.ingest.city })
      ingestItems.push(a.ingest)
      payload.items.push(a.enrich)
    }
    return fresh
  }

  // 1) Arama API ile keşif
  if (configured === 'ok' && src) {
    const plan = buildDiscoveryPlan()
    const picked = selectQueries(plan, await deps.db.queryStates(), { count: Math.max(0, Math.min(10, s.queries_per_run)), now: t0, runIndex: cfg.run_index })
    planned = picked.length
    for (const q of picked) {
      if (over()) {
        budgetStopped = true
        break
      }
      const rs = await deps.db.reserveSearch()
      if (!rs.granted) {
        quotaStopped = true
        run.errors.push(rs.reason ?? 'arama bütçesi doldu')
        payload.queries.push({ key: q.key, pattern: q.pattern, family: q.family, city: q.city, district: q.district, query: q.query, results: 0, new_results: 0, status: 'kota' })
        break
      }
      run.api_calls++
      try {
        const r = await tavilySearch(q.query, deps.tavilyKey!, deps, Math.min(10, src.max_items), { excludeDomains: q.family === 'tedarik' ? [] : PRIVATE_EXCLUDE_DOMAINS, timeRange: 'year' })
        if (r.status < 200 || r.status >= 300) throw new Error(`Arama API HTTP ${r.status}`)
        executed++
        const fresh = await absorb(r.results.map((x) => ({ url: x.url, title: x.title, body: x.content, publishedAt: x.publishedAt })), q, 'arama')
        run.query_log.push({ key: q.key, query: q.query, city: q.city, district: q.district, status: 'ok', results: r.results.length, new: fresh })
        payload.queries.push({ key: q.key, pattern: q.pattern, family: q.family, city: q.city, district: q.district, query: q.query, results: r.results.length, new_results: fresh, status: 'ok' })
        if (!run.districts.includes(q.district ?? q.city)) run.districts.push(q.district ?? q.city)
      } catch (e) {
        failed++
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200)
        run.errors.push(`${q.query}: ${msg}`)
        run.query_log.push({ key: q.key, query: q.query, city: q.city, district: q.district, status: 'hata', results: 0, new: 0, error: msg })
        payload.queries.push({ key: q.key, pattern: q.pattern, family: q.family, city: q.city, district: q.district, query: q.query, results: 0, new_results: 0, status: 'hata' })
      }
    }
  }

  // 2) Firma sitesi izleme (arama yapılandırılmasa da, ayar açıksa ve keşif kaynağı kayıtlıysa çalışır)
  let companyPages = 0
  if (src && s.company_monitoring_enabled && s.company_pages_per_run > 0 && !over()) {
    const due = await deps.db.dueCompanies(s.company_pages_per_run)
    for (const co of due) {
      if (over()) {
        budgetStopped = true
        break
      }
      const chk = await monitorCompany(co, { ...deps, now: deps.now })
      companyPages += chk.pages
      run.company_pages += chk.pages
      payload.companies_checked.push({ id: co.id, status: chk.status, note: chk.note, projects_page_url: chk.projectsPageUrl })
      payload.contacts.push(...chk.contacts)
      if (chk.status === 'hata') run.errors.push(`${co.name}: ${chk.note ?? 'hata'}`)
      run.sources.push({ name: `Firma sitesi: ${co.name}`, kind: 'site', status: chk.status })
      if (chk.items.length) await absorb(chk.items, null, 'firma_sitesi', co)
    }
  }

  // 3) Yaz: mevcut fırsat hattı + özel sektör alanları
  if (src && (ingestItems.length || payload.queries.length || payload.seen.length || payload.companies_checked.length || payload.contacts.length)) {
    const base: RunRecord = { id: run.id, started_at: run.started_at, finished_at: deps.now().toISOString(), status: 'ok', http_status: null, items_seen: 0, error: null, duration_ms: deps.now().getTime() - t0.getTime() }
    for (let i = 0; i < ingestItems.length; i += 25) await deps.db.ingest(src.id, base, ingestItems.slice(i, i + 25))
    for (let i = 0; i < Math.max(1, payload.items.length); i += 100) {
      const r = await deps.db.saveDiscovery({ ...payload, items: payload.items.slice(i, i + 100), ...(i === 0 ? {} : { queries: [], seen: [], companies_checked: [], contacts: [] }) })
      run.companies_new += r.companies_new
      run.companies_found += r.companies_found
      run.projects_new += r.projects_new
      run.projects_updated += r.projects_updated
      run.contacts_verified += r.contacts_verified
    }
  }

  // 4) E-posta taslakları → inceleme kuyruğu (gönderim YOK)
  if (src && !over()) {
    try {
      run.outreach_candidates = await prepareOutreach(deps, cfg)
    } catch (e) {
      run.errors.push(`E-posta kuyruğu: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`)
    }
  }

  const q = await deps.db.quota()
  if (q) {
    run.quota_used = q.month_used
    run.quota_limit = q.month_limit
    run.quota_remaining = q.month_remaining
  }
  run.diversity = domains.length ? diversityMetrics(domains) : null
  run.status = discoveryStatus({ configured, planned, executed, failed, quotaStopped, budgetStopped, newRecords: run.projects_new + run.companies_new, companyPagesChecked: companyPages })
  if (configured === 'ok' && planned === 0) run.note = 'Bekleme süresi dolmuş sorgu yok (tüm sorgular son 7 günde çalıştı)'
  run.finished_at = deps.now().toISOString()
  await deps.db.saveRun(run)
  deps.log?.(`radar keşif: ${run.status} · ${executed}/${planned} sorgu · ${run.results_new} yeni sonuç · ${run.companies_new} yeni firma`)
  return run
}

/** Eşiği geçen özel sektör projeleri için Türkçe taslak; uygunluk sonucu taslağa yazılır, gönderilmez */
export async function prepareOutreach(deps: DiscoveryDeps, cfg: DiscoveryConfig, limit = 10): Promise<number> {
  const cands = await deps.db.outreachCandidates(limit)
  if (!cands.length) return 0
  const drafts = cands.map((c) => {
    const o = c.opportunity
    const stage = (o.construction_stage ?? null) as Parameters<typeof matchServices>[1]
    const match = matchServices(o.project_type, stage, o.product_groups)
    const evidence = o.stage_evidence_url ?? o.evidence_url
    const mail = buildEmail({
      companyName: c.company.name, companyNameVerified: c.company.name_basis === 'metin',
      projectLabel: evidence ? o.title : null, district: o.district, city: o.city, stage,
      stageVerified: o.stage_active === true && (o.stage_confidence === 'yuksek' || o.stage_confidence === 'orta'),
      evidenceUrl: evidence, verifiedRequest: o.procurement_status === 'dogrulanmis_talep' || o.procurement_status === 'tedarikci_daveti', match,
    })
    const el = checkEligibility({
      autoSendEnabled: !!cfg.settings.outreach_auto_send, gmailVerifiedAt: cfg.settings.gmail_verified_at ?? null, legalConfirmedAt: cfg.settings.outreach_legal_confirmed_at ?? null,
      recipient: { email: c.contact.email, kind: c.contact.kind, verifiedAt: c.contact.verified_at, sourceUrl: c.contact.source_url }, companyWebsite: c.company.website,
      suppressed: c.suppressed, sentToday: 0, dailyLimit: cfg.settings.outreach_daily_limit ?? 10, lastEmailDays: c.last_email_days, hasEvidence: !!evidence,
      sector: o.sector, companyExcluded: c.company.excluded || c.company.opted_out, approved: false, now: deps.now(),
    })
    return { opportunity_id: o.id, company_id: c.company.id, contact_id: c.contact.id, subject: mail.subject, body: mail.body, brands: mail.brands, services: mail.services, eligibility: { checked_at: deps.now().toISOString(), eligible: el.eligible, reasons: el.reasons, match_reasons: match.reasons }, blocked_reasons: el.reasons }
  })
  return deps.db.saveDrafts(drafts)
}

/** Ayarlardan boru hattı ayarları (runner.loadSettings ile aynı kural) */
export function pipelineSettingsFrom(weights: Record<string, number> | null, cats: { key: string; active: boolean; extra_keywords: string[] | null }[], excluded: string[] | null): PipelineSettings {
  const extra: Record<string, string[]> = {}
  for (const c of cats) if (c.extra_keywords?.length) extra[c.key] = c.extra_keywords
  return { weights: normalizeWeights(weights), activeCategories: cats.length ? cats.filter((c) => c.active).map((c) => c.key) : null, extraKeywords: extra, excludedCompanies: excluded ?? [] }
}
