/**
 * Supabase bağlantı yapılandırmasının doğrulanması (saf fonksiyon, test edilebilir).
 *
 * Yalnızca herkese açık (publishable / anon) anahtar kabul edilir. Gizli anahtarlar
 * (sb_secret_…, service_role JWT) tarayıcıya gönderilirse tüm RLS korumasını
 * aşacağından, böyle bir anahtar algılanırsa bağlantı kurulmaz.
 */
export type SupabaseConfigResult =
  | { ok: true; url: string; key: string }
  | { ok: false; reason: 'missing' | 'invalid_url' | 'secret_key' | 'invalid_key'; message: string; missing?: string[] }

function decodeJwtRole(key: string): string | null {
  const parts = key.split('.')
  if (parts.length !== 3) return null
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(json) as { role?: unknown }
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

export function parseSupabaseConfig(env: { VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string }): SupabaseConfigResult {
  const url = env.VITE_SUPABASE_URL?.trim() ?? ''
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''

  const missing = [!url && 'VITE_SUPABASE_URL', !key && 'VITE_SUPABASE_PUBLISHABLE_KEY'].filter(Boolean) as string[]
  if (missing.length) {
    return { ok: false, reason: 'missing', missing, message: 'Supabase bağlantı bilgileri tanımlı değil.' }
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: 'invalid_url', message: 'VITE_SUPABASE_URL geçerli bir adres değil.' }
  }
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
    return { ok: false, reason: 'invalid_url', message: 'VITE_SUPABASE_URL "https://" ile başlamalıdır.' }
  }

  if (key.startsWith('sb_secret_') || decodeJwtRole(key) === 'service_role') {
    return {
      ok: false,
      reason: 'secret_key',
      message:
        'Gizli (secret / service_role) anahtar algılandı. Bu anahtar tarayıcıda kullanılamaz; yalnızca publishable veya anon anahtarı girin ve gizli anahtarı Supabase panelinden yenileyin.',
    }
  }

  if (!key.startsWith('sb_publishable_') && decodeJwtRole(key) !== 'anon') {
    return {
      ok: false,
      reason: 'invalid_key',
      message: 'VITE_SUPABASE_PUBLISHABLE_KEY tanınmadı. "sb_publishable_" ile başlayan anahtarı (veya eski anon anahtarını) kullanın.',
    }
  }

  return { ok: true, url: parsed.origin, key }
}
