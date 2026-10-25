/**
 * LEONX Radar — Tavily arama bağlayıcısı (search_api kaynak türü).
 *
 * • Anahtar YALNIZ Edge Function gizli ortam değişkeninden (TAVILY_API_KEY) okunur; depoda veya
 *   istemcide yoktur. Anahtar yoksa ya da ayarlarda search_api_enabled kapalıysa bağlayıcı atlanır.
 * • Her çağrıdan ÖNCE veritabanında aylık (ve günlük) bütçe sayacı atomik olarak artırılır
 *   (radar_service_reserve_search). Bütçe dolduysa çağrı yapılmaz.
 * • İstek gövdesi asgaridir: query, max_results (≤10), search_depth 'basic', topic 'general',
 *   country 'turkey'. Uç nokta: POST https://api.tavily.com/search, Authorization: Bearer <anahtar>.
 * • Sonuçlar yalnız ARAMA ÖZETİDİR: kanıt işaretçisi olarak (adres + özet + varsa tarih) saklanır;
 *   sonuç adresleri indirilmez. Özet kendi başına ürün adlandıran bir ilan değilse ihtiyaç
 *   "doğrulanmış" sayılmaz (sınıflandırıcı kuralı).
 */
import { parseFeedDate } from './feed.ts'
import { ANKARA_DISTRICTS, MAJOR_CITIES } from './geo.ts'
import { CATEGORIES, PROJECT_TYPES } from './taxonomy.ts'
import { JSON_TYPES, safeFetch, type SafeFetchDeps } from './urlGuard.ts'

export const TAVILY_ENDPOINT = 'https://api.tavily.com/search'
export const TAVILY_HOST = 'api.tavily.com'

/** Sorgularda öncelik sırası: Ankara, büyük Ankara ilçeleri, sonra büyük iller */
export const PRIORITY_PLACES = ['Ankara', 'Etimesgut', 'Çankaya', 'Yenimahalle', 'Sincan', 'Gölbaşı', 'Keçiören', 'Pursaklar', 'Mamak', 'Altındağ', 'Polatlı', 'Kahramankazan',
  ...ANKARA_DISTRICTS.filter((d) => !['Etimesgut', 'Çankaya', 'Yenimahalle', 'Sincan', 'Gölbaşı', 'Keçiören', 'Pursaklar', 'Mamak', 'Altındağ', 'Polatlı', 'Kahramankazan'].includes(d)),
  ...MAJOR_CITIES]

/**
 * Deterministik sorgu listesi (Türkçe şablonlar). Ankara ağırlıklıdır: her etkin kategori için önce
 * Ankara ve ilçeleri, sonra büyük iller. Örnek: "Ankara yangın kapısı ihalesi",
 * "Etimesgut konut projesi alüminyum doğrama".
 */
export function buildQueries(activeCategories: string[] | null, places: string[] = PRIORITY_PLACES): string[] {
  const cats = CATEGORIES.filter((c) => !activeCategories || activeCategories.includes(c.key))
  const out: string[] = []
  for (const place of places) {
    for (const c of cats) {
      const name = c.name.split(' / ')[0].toLocaleLowerCase('tr-TR')
      out.push(`${place} ${name} ihalesi`)
      const pt = PROJECT_TYPES.find((p) => p.needs.includes(c.key))
      if (pt) out.push(`${place} ${pt.label.split(' / ')[0].toLocaleLowerCase('tr-TR')} projesi ${name}`)
    }
  }
  return [...new Set(out)]
}

/** Döngüsel dilim: imleçten başlayarak n sorgu (liste sonunda başa döner) */
export function querySlice(all: string[], cursor: number, n: number): string[] {
  if (!all.length || n <= 0) return []
  const out: string[] = []
  for (let i = 0; i < Math.min(n, all.length); i++) out.push(all[(((cursor + i) % all.length) + all.length) % all.length])
  return out
}

export interface TavilyResult {
  title: string
  url: string
  content: string
  publishedAt: string | null
}

/** Tavily yanıtını doğrular; yalnız https adresli, başlık/özet içeren sonuçlar döner */
export function parseTavilyResponse(json: unknown, max = 10): TavilyResult[] {
  const results = (json as { results?: unknown })?.results
  if (!Array.isArray(results)) return []
  const out: TavilyResult[] = []
  for (const r of results.slice(0, max)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const url = typeof o.url === 'string' ? o.url.trim() : ''
    if (!/^https:\/\//i.test(url) || url.length > 2000) continue
    const title = typeof o.title === 'string' ? o.title.slice(0, 500) : ''
    const content = typeof o.content === 'string' ? o.content.slice(0, 4000) : ''
    if (!title && !content) continue
    const pd = typeof o.published_date === 'string' ? o.published_date : null
    out.push({ title, url, content, publishedAt: pd ? parseFeedDate(pd) ?? (Number.isFinite(Date.parse(pd)) ? new Date(Date.parse(pd)).toISOString() : null) : null })
  }
  return out
}

/** Tek Tavily araması (bütçe ayırma çağıran tarafından ÖNCE yapılmış olmalıdır) */
export async function tavilySearch(query: string, apiKey: string, deps: SafeFetchDeps, maxResults = 5): Promise<{ status: number; results: TavilyResult[] }> {
  const body = JSON.stringify({ query: query.slice(0, 400), max_results: Math.max(1, Math.min(10, maxResults)), search_depth: 'basic', topic: 'general', country: 'turkey' })
  const res = await safeFetch(
    TAVILY_ENDPOINT,
    { policy: { allowedHosts: [TAVILY_HOST] }, accept: JSON_TYPES, method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body, maxBytes: 512 * 1024 },
    deps,
  )
  if (res.status < 200 || res.status >= 300) return { status: res.status, results: [] }
  let json: unknown
  try {
    json = JSON.parse(res.body)
  } catch {
    return { status: res.status, results: [] }
  }
  return { status: res.status, results: parseTavilyResponse(json, maxResults) }
}
