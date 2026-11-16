// LEONX OS â€” radar-outreach (Supabase Edge Function, Deno). verify_jwt = false; yalnÄ±z zamanlayÄ±cÄ± gizli baÅŸlÄ±ÄŸÄ±.
//
//  { "gmail_check": true } â€” Gmail OAuth baÄŸlantÄ±sÄ±nÄ± doÄŸrular (hesap erlindoorkapi@gmail.com mi?) ve sonucu
//      radar_settings.gmail_verified_at / gmail_last_check alanÄ±na yazar. BaÅŸarÄ±sÄ±zsa otomatik gÃ¶nderim kapanÄ±r.
//  { "send": true }        â€” sahibin ONAYLADIÄI sistem taslaklarÄ±nÄ±, tÃ¼m uygunluk denetimleri geÃ§erse gÃ¶nderir
//      (outreachRunner.ts). RADAR_OUTREACH_SEND_ENABLED=true deÄŸilse hiÃ§bir ÅŸey gÃ¶nderilmez (acil durdurma).
//
// Gizli deÄŸerler: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN (erlindoorkapi@gmail.com Google Workspace
// hesabÄ± iÃ§in OAuth 2.0), SUPABASE_SERVICE_ROLE_KEY. HiÃ§biri yanÄ±ta veya loglara yazÄ±lmaz.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { credentialsFromEnv, sendGmail, verifyGmail } from '../_shared/radar/gmail.ts'
import { processSendQueue, type SendQueue } from '../_shared/radar/outreachRunner.ts'

const URL_ = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

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
      // kayÄ±t yok
    }
  }
  if (!out.length) throw new Error('Ã§Ã¶zÃ¼mlenemedi')
  return out
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'YalnÄ±z POST' })
  if (!SERVICE) return json(500, { error: 'yapÄ±landÄ±rma eksik' })
  const db = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
  const cfg = await db.rpc('radar_service_config')
  const secret = (cfg.data as { cron_secret?: string } | null)?.cron_secret ?? ''
  if (cfg.error || !secret || !safeEqual(req.headers.get('x-leonx-cron') ?? '', secret)) return json(401, { error: 'Yetkisiz' })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const creds = credentialsFromEnv((k) => Deno.env.get(k))
  const deps = { fetch: (u: string, i: RequestInit) => fetch(u, i), resolve }

  if (body.gmail_check === true) {
    const v = creds ? await verifyGmail(creds, deps) : { ok: false, email: null, error: 'GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN tanÄ±mlÄ± deÄŸil' }
    await db.rpc('radar_service_gmail_status', { p_ok: v.ok, p_detail: { email: v.email, error: v.error } })
    return json(200, { ok: v.ok, email: v.email, error: v.error })
  }
  if (body.send === true) {
    if (!creds) return json(200, { sent: 0, reason: 'Gmail kimlik bilgileri tanÄ±mlÄ± deÄŸil; taslaklar inceleme kuyruÄŸunda kalÄ±r' })
    const q = await db.rpc('radar_service_send_queue', { p_limit: 5 })
    if (q.error) return json(500, { error: 'Kuyruk okunamadÄ±' })
    const r = await processSendQueue({
      queue: q.data as SendQueue,
      killSwitchOpen: Deno.env.get('RADAR_OUTREACH_SEND_ENABLED') === 'true',
      send: (to, subject, text) => sendGmail(creds, deps, { to, subject, body: text }),
      record: async (row) => {
        const w = await db.rpc('radar_service_record_send', { p: row })
        if (w.error) throw new Error(w.error.message)
      },
      now: () => new Date(),
    })
    return json(200, r)
  }
  return json(400, { error: 'Bilinmeyen istek' })
})
