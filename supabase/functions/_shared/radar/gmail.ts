/**
 * LEONX Radar â€” Gmail API (Google Workspace, erlindoorkapi@gmail.com) baÄŸlayÄ±cÄ±sÄ±. OAuth 2.0 yenileme belirteci ile.
 *
 * GÃœVENLÄ°K
 *  â€¢ GÃ¶nderen hesap YALNIZ erlindoorkapi@gmail.com; Claude hesabÄ± veya baÅŸka bir hesap asla kullanÄ±lmaz.
 *    Profil denetimi (users/me/profile) adres eÅŸleÅŸmezse baÄŸlantÄ± "doÄŸrulanmadÄ±" kalÄ±r ve gÃ¶nderim yapÄ±lmaz.
 *  â€¢ Gizli deÄŸerler yalnÄ±z Edge Function gizli deÄŸiÅŸkenlerinde: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
 *    GMAIL_REFRESH_TOKEN. Depoda, veritabanÄ±nda veya istemcide yoktur; yanÄ±tlara/loglara yazÄ±lmaz.
 *  â€¢ Ä°zin kapsamÄ± en az: https://www.googleapis.com/auth/gmail.send (+ profil denetimi iÃ§in gmail.metadata
 *    veya gmail.readonly; yanÄ±t takibi ileride ayrÄ± onayla).
 *  â€¢ Ä°stekler urlGuard ile yalnÄ±z oauth2.googleapis.com ve gmail.googleapis.com ana makinelerine gider.
 */
import { JSON_TYPES, safeFetch, type SafeFetchDeps } from './urlGuard.ts'
import { SENDER_EMAIL } from './outreach.ts'

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

/** RFC 2047 baÅŸlÄ±k kodlamasÄ± (TÃ¼rkÃ§e karakterli konu) */
export function encodeHeader(v: string): string {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${b64(new TextEncoder().encode(v))}?=`
}

const HEADER_SAFE = /^[^\r\n]*$/

/** RFC 5322 ileti (UTF-8, base64 gÃ¶vde). BaÅŸlÄ±k enjeksiyonu (CR/LF) reddedilir. */
export function buildMime(m: { from: string; to: string; subject: string; body: string; replyTo?: string; listUnsubscribe?: string }): string {
  for (const v of [m.from, m.to, m.subject, m.replyTo ?? '', m.listUnsubscribe ?? '']) if (!HEADER_SAFE.test(v)) throw new Error('BaÅŸlÄ±kta satÄ±r sonu olamaz')
  if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(m.to)) throw new Error('GeÃ§ersiz alÄ±cÄ±')
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

async function accessToken(c: GmailCredentials, deps: SafeFetchDeps): Promise<string> {
  const body = new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' }).toString()
  const r = await safeFetch('https://oauth2.googleapis.com/token', { policy: { allowedHosts: GMAIL_HOSTS }, accept: JSON_TYPES, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, maxBytes: 64 * 1024 }, deps)
  if (r.status !== 200) throw new Error(`OAuth belirteci alÄ±namadÄ± (HTTP ${r.status})`)
  const t = (JSON.parse(r.body) as { access_token?: unknown }).access_token
  if (typeof t !== 'string' || !t) throw new Error('OAuth yanÄ±tÄ±nda eriÅŸim belirteci yok')
  return t
}

/** BaÄŸlantÄ± doÄŸrulamasÄ±: belirteÃ§ alÄ±nabiliyor ve hesap erlindoorkapi@gmail.com mi? */
export async function verifyGmail(c: GmailCredentials, deps: SafeFetchDeps): Promise<{ ok: boolean; email: string | null; error: string | null }> {
  try {
    const token = await accessToken(c, deps)
    const r = await safeFetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { policy: { allowedHosts: GMAIL_HOSTS }, accept: JSON_TYPES, headers: { Authorization: `Bearer ${token}` }, maxBytes: 64 * 1024 }, deps)
    if (r.status !== 200) return { ok: false, email: null, error: `Profil okunamadÄ± (HTTP ${r.status})` }
    const email = String((JSON.parse(r.body) as { emailAddress?: unknown }).emailAddress ?? '').toLowerCase()
    return email === SENDER_EMAIL ? { ok: true, email, error: null } : { ok: false, email, error: `BaÄŸlÄ± hesap ${SENDER_EMAIL} deÄŸil` }
  } catch (e) {
    return { ok: false, email: null, error: e instanceof Error ? e.message.slice(0, 200) : 'hata' }
  }
}

/** Tek ileti gÃ¶nderir. Ã‡aÄŸÄ±ran taraf uygunluk denetimini (checkEligibility) Ã–NCE yapmalÄ±dÄ±r. */
export async function sendGmail(c: GmailCredentials, deps: SafeFetchDeps, m: { to: string; subject: string; body: string }): Promise<{ id: string }> {
  const token = await accessToken(c, deps)
  const raw = base64Url(buildMime({ from: `${encodeHeader('LEONX METAL & ERLÄ°N KAPI')} <${SENDER_EMAIL}>`, to: m.to, subject: m.subject, body: m.body, replyTo: SENDER_EMAIL, listUnsubscribe: `<mailto:${SENDER_EMAIL}?subject=LISTEDEN%20CIKAR>` }))
  const r = await safeFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { policy: { allowedHosts: GMAIL_HOSTS }, accept: JSON_TYPES, method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }), maxBytes: 64 * 1024 }, deps)
  if (r.status !== 200) throw new Error(`Gmail gÃ¶nderimi baÅŸarÄ±sÄ±z (HTTP ${r.status})`)
  const id = (JSON.parse(r.body) as { id?: unknown }).id
  if (typeof id !== 'string') throw new Error('Gmail yanÄ±tÄ±nda ileti kimliÄŸi yok')
  return { id }
}
