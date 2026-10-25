// LEONX OS — owner-login (Supabase Edge Function, Deno)
//
// Yalnız şifre / tek kullanımlık kayıt kodu ile giriş. İstek: POST { "password": "...", "device": "iPhone · Safari" }
// (JWT gerekmez: --no-verify-jwt). Kayıt kodu owner_enrollment_open ile açılır (017); kod eşleşirse oturum,
// sahip e-postası için service_role ile üretilen tek kullanımlık bağlantı belirteciyle açılır (e-posta gönderilmez).
// Sahip e-postası OWNER_EMAIL gizli değerinden okunur; Supabase Auth girişi sunucuda yapılır ve oturum
// belirteçleri döner (istemci supabase.auth.setSession ile kurar). Kaba kuvvet sayaçları service_role ile
// owner_login_check / owner_login_record (017) üzerinden tutulur. Şifre ve e-posta loglanmaz.
//
// Gizli değerler: OWNER_EMAIL (isteğe bağlı; yoksa sahip e-postası app_owner kaydından service_role ile okunur), OWNER_LOGIN_SALT (isteğe bağlı), SUPABASE_SERVICE_ROLE_KEY
// (Supabase sağlar). CORS: RADAR_ALLOWED_ORIGINS (varsayılan https://leonx-os.vercel.app).
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { clientIp, handleOwnerLogin, type OwnerSession, sessionIdOf, type SignInResult } from '../_shared/auth/ownerLogin.ts'

const URL_ = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const OWNER_EMAIL = (Deno.env.get('OWNER_EMAIL') ?? '').trim()
const SALT = Deno.env.get('OWNER_LOGIN_SALT') ?? ''
const ORIGINS = (Deno.env.get('RADAR_ALLOWED_ORIGINS') ?? 'https://leonx-os.vercel.app').split(',').map((s) => s.trim()).filter(Boolean)

function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? ''
  return ORIGINS.includes(o)
    ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' }
    : {}
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req) } })

const service = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })

// OWNER_EMAIL yoksa tek doğruluk kaynağı app_owner: sahip kimliği → Auth kullanıcısının e-postası (5 dk önbellek)
let ownerCache: { email: string; at: number } | null = null
async function resolveOwnerEmail(): Promise<string> {
  if (OWNER_EMAIL) return OWNER_EMAIL
  if (ownerCache && Date.now() - ownerCache.at < 300_000) return ownerCache.email
  const o = await service.from('app_owner').select('user_id').eq('singleton', true).maybeSingle()
  if (o.error || !o.data?.user_id) return ''
  const u = await service.auth.admin.getUserById(o.data.user_id as string)
  const email = u.data?.user?.email?.trim() ?? ''
  if (email) ownerCache = { email, at: Date.now() }
  return email
}

async function rpcInt(fn: string, args: Record<string, unknown>): Promise<number> {
  const r = await service.rpc(fn, args)
  if (r.error) throw new Error(`${fn}: ${r.error.message}`)
  return Number(r.data) || 0
}

async function signIn(email: string, password: string): Promise<SignInResult> {
  const auth = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const { data, error } = await auth.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.status === 429 || /rate/i.test(error.code ?? '')) return { session: null, error: 'rate_limited' }
      if (error.code === 'invalid_credentials' || error.status === 400) return { session: null, error: 'invalid' }
      return { session: null, error: 'unavailable' }
    }
    if (!data.session) return { session: null, error: 'unavailable' }
    const s = data.session
    return { session: { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: s.expires_at }, error: null }
  } catch {
    return { session: null, error: 'unavailable' }
  }
}

async function issueSession(email: string): Promise<SignInResult> {
  try {
    const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
    const hashed = link.data?.properties?.hashed_token
    if (link.error || !hashed) return { session: null, error: 'unavailable' }
    const auth = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await auth.auth.verifyOtp({ token_hash: hashed, type: 'email' })
    if (error || !data.session) return { session: null, error: 'unavailable' }
    const s = data.session
    return { session: { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: s.expires_at }, error: null }
  } catch {
    return { session: null, error: 'unavailable' }
  }
}

async function registerDevice(s: OwnerSession, label: string, method: 'kod' | 'sifre'): Promise<void> {
  const r = await service.rpc('owner_device_register', { p_session: sessionIdOf(s.access_token), p_label: label, p_method: method })
  // Cihaz kaydı başarısız olsa da giriş geçerlidir (oturum yine RLS + is_owner() ile korunur)
  if (r.error) console.error('owner-login cihaz kaydı:', r.error.message.slice(0, 200))
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  if (origin && !ORIGINS.includes(origin)) return new Response(null, { status: 403 })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'Yalnız POST' })
  if (!SERVICE || !ANON) return json(req, 503, { error: 'Giriş hizmeti henüz yapılandırılmamış.', code: 'not_configured' })
  const body = await req.json().catch(() => null)
  try {
    const r = await handleOwnerLogin(body, clientIp(req.headers), {
      ownerEmail: await resolveOwnerEmail(),
      salt: SALT,
      check: (h) => rpcInt('owner_login_check', { p_ip_hash: h }),
      record: (h, ok) => rpcInt('owner_login_record', { p_ip_hash: h, p_success: ok }),
      signIn,
      consumeCode: async (h) => {
        const r = await service.rpc('owner_enrollment_consume', { p_code_hash: h })
        if (r.error) throw new Error(`owner_enrollment_consume: ${r.error.message}`)
        return r.data === true
      },
      issueSession,
      registerDevice,
      sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
    })
    return json(req, r.status, r.body)
  } catch (e) {
    console.error('owner-login hata:', e instanceof Error ? e.message.slice(0, 200) : 'bilinmiyor')
    return json(req, 502, { error: 'Giriş şu anda yapılamıyor. Lütfen biraz sonra tekrar deneyin.', code: 'unavailable' })
  }
})
