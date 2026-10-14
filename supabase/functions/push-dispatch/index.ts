// LEONX OS — push-dispatch (Supabase Edge Function, Deno)
// pg_cron her dakika çağırır (yalnız bekleyen bildirim varsa). İstek, veritabanında üretilen ve
// istemciye kapalı tutulan gizli başlıkla doğrulanır; JWT gerekmez (verify_jwt = false).
// VAPID gizli anahtarı yalnız veritabanının kapalı şemasında durur.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { runDispatch } from './dispatch.ts'

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Yalnız POST', { status: 405 })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    const result = await runDispatch(req.headers.get('x-leonx-cron'), {
      rpc: async (fn, args) => {
        const { data, error } = await db.rpc(fn, args ?? {})
        if (error) throw new Error(`${fn}: ${error.message}`)
        return data
      },
      generateKeys: () => webpush.generateVAPIDKeys(),
      send: async (sub, payload, vapid) => {
        const r = await webpush.sendNotification(sub, payload, {
          TTL: 60 * 60 * 24,
          urgency: 'normal',
          vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        })
        return r.statusCode
      },
      log: (m) => console.log(m),
    })
    // Gizli değer veya abonelik adresi yanıta/loga yazılmaz
    return new Response(JSON.stringify(result), { status: result.status, headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('push-dispatch hata:', e instanceof Error ? e.message : String(e))
    return new Response(JSON.stringify({ status: 500 }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
