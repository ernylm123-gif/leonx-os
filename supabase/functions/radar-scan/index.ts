// LEONX OS — radar-scan (Supabase Edge Function, Deno)
//
// İki çağrı biçimi:
//  1) Zamanlayıcı (pg_cron → leonx_private.dispatch_radar): "x-leonx-cron" gizli başlığı, push-dispatch ile
//     AYNI gizli değer (leonx_private.push_config.cron_secret) ile doğrulanır. JWT gerekmez (verify_jwt = false).
//     Zamanı gelen, etkin ve İZİNLİ kaynakları tarar; sonuçları radar_ingest (yalnız service_role) ile yazar.
//  2) "Kaynağı test et": sahibin oturum belirteci (Authorization: Bearer <JWT>) + is_owner() doğrulaması ile
//     { "test_source_id": "<uuid>" } — tek kaynağı aynı güvenlik hattından indirir, HİÇBİR ŞEY YAZMAZ
//     (yalnız last_test_at hız sınırı; kaynak başına 5 dk).
//  3) "Doğrula": { "verify_source_id": "<uuid>" } — sahip JWT'si VEYA zamanlayıcı gizli başlığı. Erişim koşullarını
//     (robots.txt, HTTP, giriş/CAPTCHA/ücret duvarı, ilan çıkarımı) sınar ve sonucu yalnız radar_sources.verification
//     alanına yazar (radar_service_save_verification). Doğrulanmamış kaynak veritabanında İzinli yapılamaz (018).
//  5) "Özel sektör keşfi": { "discover": true } — yalnız zamanlayıcı gizli başlığı (pg_cron :47). Yetkili arama API'si
//     (Tavily) ile ilçe rotasyonlu sorgular + (ayar açıksa) firma sitesi izleme; sonuç radar_ingest +
//     radar_service_discovery_save; her çalıştırma radar_discovery_runs'a dürüst durumla yazılır (020).
//  4) "Yeniden değerlendir": { "reclassify": true } — yalnız zamanlayıcı gizli başlığı. Son 120 günün öğelerini
//     güncel inşaat istihbaratı kurallarıyla yeniden sınıflandırır (ağ isteği yok; 019 radar_service_set_intel).
//
// Gizli değerler: SUPABASE_SERVICE_ROLE_KEY (yalnız zamanlayıcı yolu), TAVILY_API_KEY (isteğe bağlı; ayarlarda
// search_api_enabled açık değilse kullanılmaz). Hiçbiri yanıta veya loglara yazılmaz.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3'
import type { IngestItem } from '../_shared/radar/pipeline.ts'
import { type DiscoveryDb, pipelineSettingsFrom, runDiscovery } from '../_shared/radar/discoveryRunner.ts'
import { type RadarDb, reclassifyIntel, type RunRecord, runScan, type SourceRow, type StoredItem, testSource, verifySource } from '../_shared/radar/runner.ts'

const URL_ = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ORIGINS = (Deno.env.get('RADAR_ALLOWED_ORIGINS') ?? 'https://leonx-os.vercel.app').split(',').map((s) => s.trim()).filter(Boolean)

function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? ''
  return ORIGINS.includes(o)
    ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' }
    : {}
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } })

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

async function resolve(host: string): Promise<string[]> {
  const out: string[] = []
  for (const t of ['A', 'AAAA'] as const) {
    try {
      out.push(...(await Deno.resolveDns(host, t)))
    } catch {
      // kayıt yok
    }
  }
  if (!out.length) throw new Error('çözümlenemedi')
  return out
}

function unwrap<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`)
  return r.data as T
}

function dbFor(db: SupabaseClient): RadarDb {
  return {
    claimDueSources: async (limit) => unwrap(await db.rpc('radar_service_claim_sources', { p_limit: limit }), 'kiralama') as SourceRow[],
    getSource: async (id) => unwrap(await db.from('radar_sources').select('*').eq('id', id).maybeSingle(), 'kaynak') as SourceRow | null,
    settings: async () => unwrap(await db.from('radar_settings').select('weights, search_api_enabled, search_queries_per_run, excluded_companies').single(), 'ayarlar'),
    categories: async () => unwrap(await db.from('radar_categories').select('key, active, extra_keywords'), 'kategoriler'),
    clusters: async () => {
      const since = new Date(Date.now() - 180 * 86400000).toISOString()
      const rows = unwrap(await db.from('radar_opportunities').select('cluster_key, cluster_tokens, city').gte('last_updated_at', since).limit(3000), 'kümeler') as { cluster_key: string; cluster_tokens: string[]; city: string | null }[]
      return rows.map((r) => ({ clusterKey: r.cluster_key, tokens: r.cluster_tokens ?? [], city: r.city }))
    },
    pendingManual: async (limit) => {
      const rows = unwrap(await db.from('radar_items').select('id, source_id, canonical_url, title, raw_text, published_at').eq('pending', true).order('first_seen_at').limit(limit), 'bekleyen') as { id: string; source_id: string; canonical_url: string; title: string; raw_text: string | null; published_at: string | null }[]
      return rows.map((r) => ({ ...r, url: r.canonical_url }))
    },
    ingest: async (sourceId: string, run: RunRecord, items: IngestItem[]) => unwrap(await db.rpc('radar_ingest', { p_source: sourceId, p_run: run, p_items: items }), 'radar_ingest'),
    reserveSearch: async () => unwrap(await db.rpc('radar_service_reserve_search'), 'arama bütçesi'),
    claimSourceTest: async () => false,
    recordRejects: async (runId, rejected, reasons) => {
      unwrap(await db.rpc('radar_service_record_rejects', { p_run: runId, p_rejected: rejected, p_reasons: reasons }), 'ret kaydı')
    },
    recentItems: async (limit) => {
      const since = new Date(Date.now() - 120 * 86400000).toISOString()
      const rows = unwrap(await db.from('radar_items').select('id, title, summary, published_at, source:radar_sources(kind, sector_hint)')
        .eq('pending', false).gte('last_seen_at', since).order('last_seen_at', { ascending: false }).limit(limit), 'öğeler') as
        { id: string; title: string; summary: string | null; published_at: string | null; source: { kind: StoredItem['source_kind']; sector_hint: StoredItem['sector_hint'] } | null }[]
      return rows.map((r) => ({ id: r.id, title: r.title, summary: r.summary, published_at: r.published_at, source_kind: r.source?.kind ?? 'manual', sector_hint: r.source?.sector_hint ?? null }))
    },
    setIntel: async (rows) => unwrap(await db.rpc('radar_service_set_intel', { p_items: rows }), 'istihbarat') as number,
  }
}

function discoveryDbFor(db: SupabaseClient): DiscoveryDb {
  const base = dbFor(db)
  return {
    config: async () => unwrap(await db.rpc('radar_service_discovery_config'), 'keşif yapılandırması'),
    settingsForPipeline: async () => {
      const [s, cats] = await Promise.all([base.settings(), base.categories()])
      return pipelineSettingsFrom(s.weights, cats, s.excluded_companies ?? [])
    },
    clusters: base.clusters,
    queryStates: async () => {
      const rows = unwrap(await db.from('radar_discovery_queries').select('key, runs, new_results, last_run_at').limit(5000), 'sorgu geçmişi') as { key: string; runs: number; new_results: number; last_run_at: string | null }[]
      return rows.map((r) => ({ key: r.key, runs: r.runs, newResults: r.new_results, lastRunAt: r.last_run_at }))
    },
    recentlySeen: async (hashes) => {
      if (!hashes.length) return new Set<string>()
      const since = new Date(Date.now() - 30 * 86400000).toISOString()
      const rows = unwrap(await db.from('radar_discovery_seen').select('url_hash').in('url_hash', hashes).gte('last_seen_at', since), 'görülenler') as { url_hash: string }[]
      return new Set(rows.map((r) => r.url_hash))
    },
    reserveSearch: base.reserveSearch,
    ingest: base.ingest,
    saveDiscovery: async (p) => unwrap(await db.rpc('radar_service_discovery_save', { p }), 'keşif kaydı'),
    dueCompanies: async (limit) => unwrap(await db.rpc('radar_service_due_companies', { p_limit: limit }), 'firma izleme'),
    outreachCandidates: async (limit) => unwrap(await db.rpc('radar_service_outreach_candidates', { p_limit: limit }), 'e-posta adayları'),
    saveDrafts: async (drafts) => unwrap(await db.rpc('radar_service_save_drafts', { p_drafts: drafts }), 'taslaklar') as number,
    saveRun: async (run) => {
      unwrap(await db.from('radar_discovery_runs').insert(run).select('id'), 'keşif çalıştırma kaydı')
    },
    quota: async () => unwrap(await db.rpc('radar_search_quota'), 'kota'),
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'Yalnız POST' })
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  } catch {
    body = {}
  }

  // ---------------------------------------------------------------- Kaynağı test et (sahip)
  if (typeof body.test_source_id === 'string') {
    const auth = req.headers.get('authorization') ?? ''
    if (!/^Bearer\s+\S+$/.test(auth) || !ANON) return json(req, 401, { error: 'Oturum gerekli' })
    if (!/^[0-9a-f-]{36}$/i.test(body.test_source_id)) return json(req, 400, { error: 'Geçersiz kaynak' })
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } })
    const own = await user.rpc('is_owner')
    if (own.error || own.data !== true) return json(req, 403, { error: 'Yetkisiz' })
    const db: RadarDb = {
      ...dbFor(user),
      claimSourceTest: async (id) => unwrap(await user.rpc('radar_claim_source_test', { p_source: id }), 'test sınırı') === true,
    }
    try {
      const r = await testSource({ db, now: () => new Date(), uuid: () => crypto.randomUUID(), tavilyKey: null, fetch: (u, i) => fetch(u, i), resolve }, body.test_source_id)
      return json(req, 200, r)
    } catch (e) {
      console.error('radar-scan test hata:', e instanceof Error ? e.message : String(e))
      return json(req, 500, { error: 'Test yapılamadı' })
    }
  }

  // ---------------------------------------------------------------- Doğrula (sahip veya zamanlayıcı)
  if (!SERVICE) return json(req, 500, { error: 'yapılandırma eksik' })
  const db = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
  const cfg = await db.rpc('radar_service_config')
  const secret = (cfg.data as { cron_secret?: string } | null)?.cron_secret ?? ''
  const given = req.headers.get('x-leonx-cron') ?? ''
  const cronOk = !cfg.error && !!secret && safeEqual(given, secret)

  if (typeof body.verify_source_id === 'string') {
    if (!/^[0-9a-f-]{36}$/i.test(body.verify_source_id)) return json(req, 400, { error: 'Geçersiz kaynak' })
    if (!cronOk) {
      const auth = req.headers.get('authorization') ?? ''
      if (!/^Bearer\s+\S+$/.test(auth) || !ANON) return json(req, 401, { error: 'Oturum gerekli' })
      const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } })
      const own = await user.rpc('is_owner')
      if (own.error || own.data !== true) return json(req, 403, { error: 'Yetkisiz' })
      // Sahip için aynı 5 dk hız sınırı ("Kaynağı test et" ile ortak)
      const lim = await user.rpc('radar_claim_source_test', { p_source: body.verify_source_id })
      if (lim.error || lim.data !== true) return json(req, 429, { error: 'Bu kaynak son 5 dakika içinde denendi; biraz sonra tekrar deneyin' })
    }
    try {
      const sdb = dbFor(db)
      const src = await sdb.getSource(body.verify_source_id)
      if (!src) return json(req, 404, { error: 'Kaynak bulunamadı' })
      const v = await verifySource({ db: sdb, now: () => new Date(), uuid: () => crypto.randomUUID(), tavilyKey: null, fetch: (u, i) => fetch(u, i), resolve }, src)
      const saved = unwrap(await db.rpc('radar_service_save_verification', { p_source: src.id, p_result: v }), 'doğrulama kaydı')
      return json(req, 200, { ...v, saved })
    } catch (e) {
      console.error('radar-scan doğrulama hata:', e instanceof Error ? e.message : String(e))
      return json(req, 500, { error: 'Doğrulama yapılamadı' })
    }
  }

  // ---------------------------------------------------------------- Zamanlayıcı
  if (!cronOk) return json(req, 401, { error: 'Yetkisiz' })
  // 020: özel sektör keşfi (saatlik)
  if (body.discover === true) {
    try {
      const r = await runDiscovery({ db: discoveryDbFor(db), now: () => new Date(), uuid: () => crypto.randomUUID(), tavilyKey: Deno.env.get('TAVILY_API_KEY') ?? null, fetch: (u, i) => fetch(u, i), resolve, budgetMs: 45_000, log: (m) => console.log(m) })
      return json(req, 200, { status: r.status, note: r.note, queries: r.query_log.length, results_new: r.results_new, companies_new: r.companies_new, projects_new: r.projects_new, errors: r.errors.length })
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300)
      console.error('radar-scan keşif hata:', msg)
      // Çöken çalıştırma da kayda geçer: sıfır sonuç asla "başarılı" görünmez
      const now = new Date().toISOString()
      await db.from('radar_discovery_runs').insert({ started_at: now, finished_at: now, status: 'basarisiz', errors: [msg], note: 'Keşif çalıştırması beklenmeyen hatayla durdu' })
      return json(req, 500, { error: 'Keşif hatası' })
    }
  }
  // 019: günlük yeniden değerlendirme (ağ isteği yok; saklanan öğeler güncel kurallarla)
  if (body.reclassify === true) {
    try {
      const r = await reclassifyIntel({ db: dbFor(db), now: () => new Date(), uuid: () => crypto.randomUUID(), tavilyKey: null, fetch: (u, i) => fetch(u, i), resolve })
      return json(req, 200, r)
    } catch (e) {
      console.error('radar-scan yeniden değerlendirme hata:', e instanceof Error ? e.message : String(e))
      return json(req, 500, { error: 'Yeniden değerlendirme hatası' })
    }
  }
  try {
    const summary = await runScan({
      db: dbFor(db),
      now: () => new Date(),
      uuid: () => crypto.randomUUID(),
      tavilyKey: Deno.env.get('TAVILY_API_KEY') ?? null,
      fetch: (u, i) => fetch(u, i),
      resolve,
      log: (m) => console.log(m),
      budgetMs: 50_000,
      maxSources: 10,
      batchSize: 25,
    })
    return json(req, 200, summary)
  } catch (e) {
    console.error('radar-scan hata:', e instanceof Error ? e.message : String(e))
    return json(req, 500, { error: 'Tarama hatası' })
  }
})
