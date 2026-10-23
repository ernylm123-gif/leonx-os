/**
 * LEONX Radar — tekilleştirme ve fırsat kümeleme.
 *
 *  • Öğe kimliği: kanonik adresin SHA-256 özeti (url_hash). Aynı öğe yeniden görülürse yalnız
 *    last_seen güncellenir; içerik özeti (content_hash) değiştiyse öğe güncellenir.
 *  • Fırsat kümesi: başlığın anlamlı sözcükleri (katlanmış, genel sözcükler atılmış) + şehir.
 *    Yeni öğe, aynı şehirdeki (veya şehri bilinmeyen) bir kümeyle Jaccard benzerliği eşiği
 *    (varsayılan 0,5) geçerse o kümeye katılır; böylece aynı proje farklı kaynaklardan gelse de
 *    tek fırsat + çok kanıt olur.
 */
import { canonicalizeUrl, contentHash, sha256Hex } from './sanitize.ts'
import { fold, foldTokens } from './text.ts'

const STOP = new Set([
  've', 'ile', 'icin', 'bir', 'bu', 'su', 'da', 'de', 'mi', 'ki', 'olan', 'olarak', 'gibi', 'en', 'cok', 'daha', 'yeni', 'son', 'ilk',
  'ihale', 'ihalesi', 'ilan', 'ilani', 'ilanı', 'haber', 'duyuru', 'is', 'isi', 'isleri', 'yapim', 'yapimi', 'alim', 'alimi', 'temin', 'temini',
  'proje', 'projesi', 'projenin', 'kapsaminda', 'hakkinda', 'icin', 'tarafindan', 'basladi', 'devam', 'ediyor', 'edildi', 'yapilacak', 'tamamlandi',
  'montaj', 'montaji', 'imalat', 'imalati', 'teklif', 'teklifi', 'son', 'tarih', 'tarihi', 'il', 'ilce', 'ilcesi', 'mahallesi', 'adet',
  '2024', '2025', '2026', '2027', '2028',
])

/** Başlıktan küme sözcükleri: katlanmış, 3+ harf, genel sözcükler ve şehir adı hariç, en çok 12 */
export function clusterTokens(title: string, city: string | null): string[] {
  const c = city ? fold(city) : null
  const toks = foldTokens(title).filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t))
  const out: string[] = []
  for (const t of toks) {
    // Basit gövdeleme: yaygın çekim eklerini at (karşılaştırma tutarlılığı için)
    const s = t.replace(/(lerinin|larinin|lerine|larina|lerin|larin|leri|lari|nin|nun|nda|nde|dan|den|ndan|nden|daki|deki|ler|lar|si|su|in|un|da|de|ta|te)$/, '')
    const stem = s.length >= 3 ? s : t
    if (c && (stem === c || t.startsWith(c))) continue
    if (!out.includes(stem)) out.push(stem)
    if (out.length >= 12) break
  }
  return out
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 0
  const A = new Set(a)
  const B = new Set(b)
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter)
}

export interface ClusterRef {
  clusterKey: string
  tokens: string[]
  city: string | null
}

/** Yeni küme anahtarı: şehir + sıralı sözcüklerin kısa özeti */
export async function newClusterKey(tokens: string[], city: string | null): Promise<string> {
  const h = await sha256Hex([...tokens].sort().join(' '))
  return `${city ? fold(city).replace(/[^a-z0-9]/g, '') : 'bilinmiyor'}:${h.slice(0, 20)}`
}

/** Mevcut kümelerden en benzerini seçer (eşik ve şehir uyumu); yoksa yeni anahtar üretir */
export async function assignCluster(title: string, city: string | null, existing: ClusterRef[], threshold = 0.5): Promise<{ clusterKey: string; tokens: string[]; matched: boolean; similarity: number }> {
  const tokens = clusterTokens(title, city)
  let best: ClusterRef | null = null
  let bestSim = 0
  for (const e of existing) {
    if (city && e.city && fold(e.city) !== fold(city)) continue
    const sim = jaccard(tokens, e.tokens)
    if (sim > bestSim) {
      bestSim = sim
      best = e
    }
  }
  if (best && bestSim >= threshold && tokens.length >= 2) return { clusterKey: best.clusterKey, tokens, matched: true, similarity: bestSim }
  return { clusterKey: await newClusterKey(tokens.length ? tokens : foldTokens(title).slice(0, 12), city), tokens, matched: false, similarity: bestSim }
}

export interface ItemIdentity {
  canonicalUrl: string
  urlHash: string
  contentHash: string
}

export async function identify(url: string, title: string, summary: string): Promise<ItemIdentity | null> {
  const canonicalUrl = canonicalizeUrl(url)
  if (!canonicalUrl) return null
  return { canonicalUrl, urlHash: await sha256Hex(canonicalUrl), contentHash: await contentHash(title, summary) }
}

export type SeenState = 'yeni' | 'degisti' | 'ayni'

/** Daha önce görülen öğeyle karşılaştırma */
export function seenState(prev: { contentHash: string } | null | undefined, cur: { contentHash: string }): SeenState {
  if (!prev) return 'yeni'
  return prev.contentHash === cur.contentHash ? 'ayni' : 'degisti'
}
