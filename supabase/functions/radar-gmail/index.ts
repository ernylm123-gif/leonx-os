// LEONX OS — radar-gmail (Supabase Edge Function, Deno). verify_jwt = false; yalnız zamanlayıcı gizli başlığı (x-leonx-cron).
//
//  { "gmail_check": true } — Gmail OAuth bağlantısını doğrular: yetki veren hesap erlindoorkapi@gmail.com mi?
//      Sonuç (020 uygulanmışsa) radar_settings.gmail_verified_at / gmail_last_check alanına yazılır.
//  { "test_send": true }   — kontrollü test: yalnız erlindoorkapi@gmail.com'un KENDİSİNE tek ileti. Müşteriye
//      hiçbir şey gönderilmez, kuyruğa dokunulmaz. Müşteri gönderimi yalnız radar-outreach'ta ve ayrıca kapalıdır.
//
// Gizli değerler: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, SUPABASE_SERVICE_ROLE_KEY.
// Hiçbiri yanıta veya loglara yazılmaz.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { credentialsFromEnv, sendSelfTest, verifyGmail } from '../_shared/radar/gmail.ts'

const URL_ = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const MISSING = 'GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN tanımlı değil'

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

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Yalnız POST' })
  if (!SERVICE) return json(500, { error: 'yapılandırma eksik' })
  const db = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
  const cfg = await db.rpc('radar_service_config')
  const secret = (cfg.data as { cron_secret?: string } | null)?.cron_secret ?? ''
  if (cfg.error || !secret || !safeEqual(req.headers.get('x-leonx-cron') ?? '', secret)) return json(401, { error: 'Yetkisiz' })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const creds = credentialsFromEnv((k) => Deno.env.get(k))
  const deps = { fetch: (u: string, i: RequestInit) => fetch(u, i), resolve }

  if (body.gmail_check === true) {
    const v = creds ? await verifyGmail(creds, deps) : { ok: false, email: null, error: MISSING }
    const w = await db.rpc('radar_service_gmail_status', { p_ok: v.ok, p_detail: { email: v.email, error: v.error } })
    return json(200, { ok: v.ok, email: v.email, error: v.error, status_saved: !w.error })
  }
  if (body.test_send === true) {
    if (!creds) return json(200, { ok: false, id: null, error: MISSING })
    return json(200, await sendSelfTest(creds, deps, new Date()))
  }
  return json(400, { error: 'Bilinmeyen istek' })
})
