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
//
// Gizli değerler: SUPABASE_SERVICE_ROLE_KEY (yalnız zamanlayıcı yolu), TAVILY_API_KEY (isteğe bağlı; ayarlarda
// search_api_enabled açık değilse kullanılmaz). Hiçbiri yanıta veya loglara yazılmaz.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3'
import type { IngestItem } from '../_shared/radar/pipeline.ts'
import { type RadarDb, type RunRecord, runScan, type SourceRow, testSource, verifySource } from '../_shared/radar/runner.ts'

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
    settings: async () => unwrap(await db.from('radar_settings').select('weights, search_api_enabled, search_queries_per_run').single(), 'ayarlar'),
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
