/**
 * LEONX Radar — Gmail API (erlindoorkapi@gmail.com Gmail hesabı) bağlayıcısı. OAuth 2.0 yenileme belirteci ile.
 *
 * GÜVENLİK
 *  • Gönderen hesap YALNIZ erlindoorkapi@gmail.com; Claude hesabı veya başka bir hesap asla kullanılmaz.
 *    Profil denetimi (users/me/profile) adres eşleşmezse bağlantı "doğrulanmadı" kalır ve gönderim yapılmaz.
 *  • Gizli değerler yalnız Edge Function gizli değişkenlerinde: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
 *    GMAIL_REFRESH_TOKEN. Depoda, veritabanında veya istemcide yoktur; yanıtlara/loglara yazılmaz.
 *  • İzin kapsamı en az: https://www.googleapis.com/auth/gmail.send + openid + email. Hesap kimliği yenileme
 *    yanıtındaki id_token'ın e-posta iddiasından (Google'ın belirteç ucundan TLS ile doğrudan alınır) okunur;
 *    böylece kısıtlı Gmail okuma kapsamları (gmail.readonly / gmail.metadata) gerekmez. id_token yoksa ve
 *    belirteç izin veriyorsa users/me/profile denenir.
 *  • İstekler urlGuard ile yalnız oauth2.googleapis.com ve gmail.googleapis.com ana makinelerine gider.
 */
import { JSON_TYPES, safeFetch, type SafeFetchDeps } from './urlGuard.ts'
import { SENDER_EMAIL } from './sender.ts'

export const GMAIL_HOSTS = ['oauth2.googleapis.com', 'gmail.googleapis.com']

export interface GmailCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
}

export function credentialsFromEnv(get: (k: string) => string | undefined): GmailCredentials | null {
  const clientId = get('GMAIL_CLIENT_ID') ?? ''
  const clientSecret = get('GMAIL_CLIENT_SECRET') ?? ''
  const refreshToken = get('GMAIL_REFRESH_TOKEN') ?? ''
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null
}

function b64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function base64Url(text: string): string {
  return b64(new TextEncoder().encode(text)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** RFC 2047 başlık kodlaması (Türkçe karakterli konu) */
export function encodeHeader(v: string): string {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${b64(new TextEncoder().encode(v))}?=`
}

const HEADER_SAFE = /^[^\r\n]*$/

/** RFC 5322 ileti (UTF-8, base64 gövde). Başlık enjeksiyonu (CR/LF) reddedilir. */
export function buildMime(m: { from: string; to: string; subject: string; body: string; replyTo?: string; listUnsubscribe?: string }): string {
  for (const v of [m.from, m.to, m.subject, m.replyTo ?? '', m.listUnsubscribe ?? '']) if (!HEADER_SAFE.test(v)) throw new Error('Başlıkta satır sonu olamaz')
  if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(m.to)) throw new Error('Geçersiz alıcı')
  const body = b64(new TextEncoder().encode(m.body)).replace(/(.{76})/g, '$1\r\n')
  const headers = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: ${encodeHeader(m.subject)}`,
    ...(m.replyTo ? [`Reply-To: ${m.replyTo}`] : []),
    ...(m.listUnsubscribe ? [`List-Unsubscribe: ${m.listUnsubscribe}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ]
  return `${headers.join('\r\n')}\r\n\r\n${body}`
}

interface TokenResult { accessToken: string; idEmail: string | null; idEmailVerified: boolean }

/** JWT gövdesini çözer (imza denetimi yok: belirteç Google'ın belirteç ucundan TLS ile doğrudan alındı). */
export function idTokenEmail(idToken: unknown): { email: string | null; verified: boolean } {
  if (typeof idToken !== 'string') return { email: null, verified: false }
  const part = idToken.split('.')[1]
  if (!part) return { email: null, verified: false }
  try {
    const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4))
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))) as { email?: unknown; email_verified?: unknown; iss?: unknown }
    if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') return { email: null, verified: false }
    return { email: typeof claims.email === 'string' ? claims.email.toLowerCase() : null, verified: claims.email_verified === true || claims.email_verified === 'true' }
  } catch {
    return { email: null, verified: false }
  }
}

async function token(c: GmailCredentials, deps: SafeFetchDeps): Promise<TokenResult> {
  const body = new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' }).toString()
  const r = await safeFetch('https://oauth2.googleapis.com/token', { policy: { allowedHosts: GMAIL_HOSTS }, accept: JSON_TYPES, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, maxBytes: 64 * 1024 }, deps)
  if (r.status !== 200) throw new Error(`OAuth belirteci alınamadı (HTTP ${r.status})`)
  const j = JSON.parse(r.body) as { access_token?: unknown; id_token?: unknown; scope?: unknown }
  if (typeof j.access_token !== 'string' || !j.access_token) throw new Error('OAuth yanıtında erişim belirteci yok')
  if (typeof j.scope === 'string' && !j.scope.split(' ').includes('https://www.googleapis.com/auth/gmail.send')) throw new Error('Yenileme belirtecinde gmail.send izni yok')
  const id = idTokenEmail(j.id_token)
  return { accessToken: j.access_token, idEmail: id.email, idEmailVerified: id.verified }
}

/** Bağlantı doğrulaması: belirteç alınabiliyor ve yetki veren hesap erlindoorkapi@gmail.com mi? */
export async function verifyGmail(c: GmailCredentials, deps: SafeFetchDeps): Promise<{ ok: boolean; email: string | null; error: string | null }> {
  try {
    const t = await token(c, deps)
    let email = t.idEmailVerified ? t.idEmail : null
    if (!email) {
      const r = await safeFetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { policy: { allowedHosts: GMAIL_HOSTS }, accept: JSON_TYPES, headers: { Authorization: `Bearer ${t.accessToken}` }, maxBytes: 64 * 1024 }, deps)
      if (r.status !== 200) return { ok: false, email: null, error: `Hesap kimliği okunamadı: yenileme belirteci "openid email" kapsamıyla alınmalı (profil HTTP ${r.status})` }
      email = String((JSON.parse(r.body) as { emailAddress?: unknown }).emailAddress ?? '').toLowerCase()
    }
    return email === SENDER_EMAIL ? { ok: true, email, error: null } : { ok: false, email, error: `Bağlı hesap ${SENDER_EMAIL} değil` }
  } catch (e) {
    return { ok: false, email: null, error: e instanceof Error ? e.message.slice(0, 200) : 'hata' }
  }
}

/** Tek ileti gönderir. Çağıran taraf uygunluk denetimini (checkEligibility) ÖNCE yapmalıdır. */
export async function sendGmail(c: GmailCredentials, deps: SafeFetchDeps, m: { to: string; subject: string; body: string }): Promise<{ id: string }> {
  const t = await token(c, deps)
  // Belirteç başka bir hesaba aitse gönderme (kimlik okunabiliyorsa)
  if (t.idEmail && t.idEmail !== SENDER_EMAIL) throw new Error(`Bağlı hesap ${SENDER_EMAIL} değil; gönderim durduruldu`)
  const raw = base64Url(buildMime({ from: `${encodeHeader('LEONX METAL & ERLİN KAPI')} <${SENDER_EMAIL}>`, to: m.to, subject: m.subject, body: m.body, replyTo: SENDER_EMAIL, listUnsubscribe: `<mailto:${SENDER_EMAIL}?subject=LISTEDEN%20CIKAR>` }))
  const r = await safeFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { policy: { allowedHosts: GMAIL_HOSTS }, accept: JSON_TYPES, method: 'POST', headers: { Authorization: `Bearer ${t.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }), maxBytes: 64 * 1024 }, deps)
  if (r.status !== 200) throw new Error(`Gmail gönderimi başarısız (HTTP ${r.status})`)
  const id = (JSON.parse(r.body) as { id?: unknown }).id
  if (typeof id !== 'string') throw new Error('Gmail yanıtında ileti kimliği yok')
  return { id }
}

/** Kontrollü test gönderimi: YALNIZ gönderen hesabın kendisine tek ileti (müşteriye gitmez). Önce kimlik doğrulanır. */
export async function sendSelfTest(c: GmailCredentials, deps: SafeFetchDeps, now: Date): Promise<{ ok: boolean; id: string | null; error: string | null }> {
  const v = await verifyGmail(c, deps)
  if (!v.ok) return { ok: false, id: null, error: v.error }
  try {
    const stamp = now.toISOString().slice(0, 16).replace('T', ' ')
    const r = await sendGmail(c, deps, { to: SENDER_EMAIL, subject: `LEONX Radar test gönderimi (${stamp} UTC)`, body: `Bu ileti LEONX OS Radar Gmail bağlantısının kontrollü testidir.\nYalnız ${SENDER_EMAIL} adresine gönderildi; hiçbir müşteriye e-posta gönderilmedi.\n` })
    return { ok: true, id: r.id, error: null }
  } catch (e) {
    return { ok: false, id: null, error: e instanceof Error ? e.message.slice(0, 200) : 'hata' }
  }
}
