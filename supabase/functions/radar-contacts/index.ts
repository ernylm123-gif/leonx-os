// LEONX OS — radar-contacts (Supabase Edge Function, Deno)
//
// Sahip çağırır (Authorization: Bearer <oturum JWT>; is_owner() doğrulanır). { "company_id": "<uuid>" }
// Firmanın KAYITLI web sitesinde (kanıttan gelen veya sahibin girdiği; firma adından TAHMİN EDİLMEZ)
// ana sayfa + yaygın iletişim/tedarikçi yolları incelenir (robots.txt, SSRF koruması, en çok 8 sayfa).
// Yalnız firmanın alan adındaki kurumsal kanallar, kaynak adresi ve doğrulama zamanıyla radar_contacts'a
// SAHİBİN OTURUMUYLA yazılır (service_role kullanılmaz). Kişi adı içeren e-postalar saklanmaz.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { researchCompanyContacts } from '../_shared/radar/research.ts'

const URL_ = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ORIGINS = (Deno.env.get('RADAR_ALLOWED_ORIGINS') ?? 'https://leonx-os.vercel.app').split(',').map((s) => s.trim()).filter(Boolean)

function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? ''
  return ORIGINS.includes(o)
    ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' }
    : {}
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } })

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
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'Yalnız POST' })
  const auth = req.headers.get('authorization') ?? ''
  if (!/^Bearer\s+\S+$/.test(auth) || !ANON) return json(req, 401, { error: 'Oturum gerekli' })
  const db = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } })
  const own = await db.rpc('is_owner')
  if (own.error || own.data !== true) return json(req, 403, { error: 'Yetkisiz' })

  const body = (await req.json().catch(() => ({}))) as { company_id?: unknown }
  if (typeof body.company_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.company_id)) return json(req, 400, { error: 'Geçersiz firma' })
  const co = await db.from('radar_companies').select('id, website').eq('id', body.company_id).maybeSingle()
  if (co.error || !co.data) return json(req, 404, { error: 'Firma bulunamadı' })
  if (!co.data.website) return json(req, 400, { error: 'Firmanın web sitesi kayıtlı değil. Kaynaktan doğrulanmış adresi girin; adres tahmin edilmez.' })

  try {
    const r = await researchCompanyContacts(co.data.website, { now: () => new Date(), fetch: (u, i) => fetch(u, i), resolve })
    if (r.contacts.length) {
      const rows = r.contacts.map((c) => ({ company_id: co.data!.id, kind: c.kind, value: c.value, source_url: c.source_url, verified_at: c.verified_at }))
      const up = await db.from('radar_contacts').upsert(rows, { onConflict: 'company_id,kind,value' })
      if (up.error) throw new Error(up.error.message)
    }
    return json(req, 200, {
      pages: r.pages,
      saved: r.contacts.length,
      skipped_personal: r.skippedPersonal,
      skipped_foreign_domain: r.skippedForeignDomain,
      skipped_irrelevant: r.skippedIrrelevant,
    })
  } catch (e) {
    console.error('radar-contacts hata:', e instanceof Error ? e.message : String(e))
    return json(req, 500, { error: 'İletişim araştırması yapılamadı' })
  }
})
