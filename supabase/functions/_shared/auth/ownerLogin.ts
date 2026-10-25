/**
 * LEONX OS — yalnız şifre ile giriş (owner-login Edge Function'ının çalışma zamanından bağımsız çekirdeği).
 *
 * • İstemci yalnız şifre gönderir. Sahip e-postası sunucu tarafı gizli değerdir (OWNER_EMAIL); yanıta,
 *   loglara veya istemci paketine girmez.
 * • Giriş Supabase Auth ile sunucuda yapılır; dönen oturum istemcide supabase.auth.setSession ile kurulur.
 *   Yetkinin asıl kaynağı değişmez: RLS + is_owner().
 * • Kaba kuvvet koruması: IP adresinin SHA-256 özeti ile sayaç (owner_login_check / owner_login_record,
 *   yalnız service_role), ilerlemeli kilit ve genel sınır; hatalı denemede sabit gecikme. İletiler geneldir.
 * • Aynı alan tek kullanımlık KAYIT KODU da kabul eder (017 owner_enrollment): kod yalnız sahip açtığında,
 *   en çok 30 dk ve bir kez geçerlidir; kalıcı kimlik bilgisi değildir. Kod eşleşirse oturum, sahip e-postası
 *   için sunucuda üretilen tek kullanımlık bağlantı belirteciyle açılır (e-posta gönderilmez).
 * • Her başarılı giriş cihaz olarak kaydedilir (owner_devices); cihaz oturumu yenileme belirteciyle hatırlanır
 *   ve Ayarlar'dan iptal edilebilir.
 * • Şifre ve kod hiçbir yerde açık metin saklanmaz veya loglanmaz.
 */

export interface OwnerSession {
  access_token: string
  refresh_token: string
  expires_in?: number
  expires_at?: number
}

export type SignInResult = { session: OwnerSession; error: null } | { session: null; error: 'invalid' | 'rate_limited' | 'unavailable' }

export interface OwnerLoginDeps {
  /** Sunucu gizli değeri; boşsa hizmet yapılandırılmamış sayılır */
  ownerEmail: string
  /** IP özetine karıştırılan isteğe bağlı gizli tuz */
  salt?: string
  check: (ipHash: string) => Promise<number>
  record: (ipHash: string, success: boolean) => Promise<number>
  signIn: (email: string, password: string) => Promise<SignInResult>
  /** Tek kullanımlık kayıt kodunu tüketir (SHA-256 özetiyle); eşleşirse true */
  consumeCode: (codeHash: string) => Promise<boolean>
  /** Kayıt kodu kabul edildiğinde sahip için oturum üretir */
  issueSession: (email: string) => Promise<SignInResult>
  registerDevice: (session: OwnerSession, label: string, method: 'kod' | 'sifre') => Promise<void>
  sleep: (ms: number) => Promise<void>
}

export interface LoginResponse {
  status: number
  body: Record<string, unknown>
}

export const MAX_PASSWORD_LENGTH = 200
/** Hatalı denemeden sonra yanıt öncesi sabit gecikme (zamanlama farkını ve hızlı denemeyi azaltır) */
export const FAILURE_DELAY_MS = 800

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** İstemci IP'si: vekil zincirindeki ilk adres; yoksa ortak "bilinmiyor" kovası */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = xff || headers.get('cf-connecting-ip')?.trim() || headers.get('x-real-ip')?.trim() || ''
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip.toLowerCase() : 'bilinmiyor'
}

const waitText = (s: number) => (s >= 120 ? `${Math.ceil(s / 60)} dakika` : `${s} saniye`)

export async function handleOwnerLogin(body: unknown, ip: string, deps: OwnerLoginDeps): Promise<LoginResponse> {
  const password = (body as { password?: unknown } | null)?.password
  if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    return { status: 400, body: { error: 'Şifrenizi girin.', code: 'invalid_request' } }
  }
  if (!deps.ownerEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(deps.ownerEmail)) {
    return { status: 503, body: { error: 'Giriş hizmeti henüz yapılandırılmamış. Kurulum: docs/SUPABASE_KURULUM.md', code: 'not_configured' } }
  }
  const ipHash = await sha256Hex(`${deps.salt ?? ''}|${ip}`)
  const wait = await deps.check(ipHash)
  if (wait > 0) {
    return { status: 429, body: { error: `Çok fazla hatalı deneme. ${waitText(wait)} sonra tekrar deneyin.`, code: 'locked', retry_after: wait } }
  }
  const label = deviceLabel((body as { device?: unknown }).device)
  // Önce tek kullanımlık kayıt kodu (açık kod yoksa veya eşleşmezse şifre olarak denenir)
  if (await deps.consumeCode(await sha256Hex(password))) {
    const k = await deps.issueSession(deps.ownerEmail)
    if (!k.session) {
      return { status: 502, body: { error: 'Kod kabul edildi ancak oturum açılamadı. Yeni bir kod oluşturup tekrar deneyin.', code: 'unavailable' } }
    }
    await deps.record(ipHash, true)
    await deps.registerDevice(k.session, label, 'kod')
    return { status: 200, body: sessionBody(k.session, 'kod') }
  }
  const r = await deps.signIn(deps.ownerEmail, password)
  if (r.error === 'rate_limited') {
    return { status: 429, body: { error: 'Çok fazla deneme yapıldı. Birkaç dakika bekleyip tekrar deneyin.', code: 'rate_limited' } }
  }
  if (r.error === 'unavailable') {
    return { status: 502, body: { error: 'Giriş şu anda yapılamıyor. Lütfen biraz sonra tekrar deneyin.', code: 'unavailable' } }
  }
  if (r.error === 'invalid') {
    const next = await deps.record(ipHash, false)
    await deps.sleep(FAILURE_DELAY_MS)
    return next > 0
      ? { status: 429, body: { error: `Şifre hatalı. Çok fazla hatalı deneme: ${waitText(next)} sonra tekrar deneyin.`, code: 'locked', retry_after: next } }
      : { status: 401, body: { error: 'Şifre hatalı.', code: 'invalid_credentials' } }
  }
  const s = r.session
  if (!s) return { status: 502, body: { error: 'Giriş şu anda yapılamıyor. Lütfen biraz sonra tekrar deneyin.', code: 'unavailable' } }
  await deps.record(ipHash, true)
  await deps.registerDevice(s, label, 'sifre')
  return { status: 200, body: sessionBody(s, 'sifre') }
}

const sessionBody = (s: OwnerSession, method: 'kod' | 'sifre') => ({
  access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in ?? null, expires_at: s.expires_at ?? null, method,
})

/** İstemcinin gönderdiği cihaz adı: yalnız görüntüleme amaçlı, kısaltılır ve temizlenir */
export function deviceLabel(v: unknown): string {
  const t = typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) : ''
  return t || 'Cihaz'
}

/** Erişim belirtecindeki Supabase oturum kimliği (cihaz iptali için) */
export function sessionIdOf(accessToken: string): string | null {
  try {
    const p = accessToken.split('.')[1]
    const json = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(p.length / 4) * 4, '=')))
    return typeof json.session_id === 'string' && /^[0-9a-f-]{36}$/i.test(json.session_id) ? json.session_id : null
  } catch {
    return null
  }
}
