/** Okuma (GET/HEAD) ve oturum isteklerinde üst süre: mobil ağda yanıtsız kalan istek ekranı dondurmaz */
export const REQUEST_TIMEOUT_MS = 20_000

/**
 * Yalnız PostgREST okumaları (/rest/v1, GET/HEAD) ve Auth (/auth/v1) isteklerine zaman aşımı
 * ekler. Yazma istekleri, Storage (büyük dosya) ve Edge Function çağrıları etkilenmez: uzun
 * sürebilirler ve yarıda kesilmeleri çift işlem riskini artırır. Zaman aşımı "AbortError" ile
 * sonuçlanır; arayüz bunu "sunucuya ulaşılamıyor" olarak gösterir (errors.ts → isServerUnreachable).
 */
export function fetchWithTimeout(base: typeof fetch = (...a) => fetch(...a), ms = REQUEST_TIMEOUT_MS): typeof fetch {
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()
    const eligible = !init?.signal && typeof AbortController !== 'undefined' && (/\/auth\/v1\//.test(url) || (/\/rest\/v1\//.test(url) && (method === 'GET' || method === 'HEAD')))
    if (!eligible) return base(input, init)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ms)
    return base(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer))
  }
}
