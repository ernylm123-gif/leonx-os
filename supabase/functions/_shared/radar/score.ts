/**
 * LEONX Radar — açıklanabilir fırsat puanı (0–100) ve AYRI güvenilirlik puanı (0–100).
 *
 * Fırsat puanı = Σ ağırlık_i × etken_i (etken 0–1, ağırlıklar toplamı 100'e normalleştirilir).
 * Varsayılan ağırlıklar:
 *   kategori uygunluğu 25 · ihtiyacın kaynakla doğrulanması 25 · proje aşaması ve zaman 15 ·
 *   Ankara yakınlığı 15 · iletişim / teklif yolu açıklığı 10 · ticari potansiyel 10
 *
 * KURAL: 'dogrulanmis' ihtiyacı olmayan bir fırsat, puanı ne olursa olsun "Doğrulanmış iş fırsatı"
 * olarak etiketlenemez.
 */
import type { Classification, SourceKind } from './classify.ts'
import { ankaraProximity } from './geo.ts'
import { PROJECT_TYPE_BY_KEY } from './taxonomy.ts'

export type WeightKey = 'kategori' | 'dogrulama' | 'asama' | 'yakinlik' | 'iletisim' | 'ticari'
export type Weights = Record<WeightKey, number>

export const DEFAULT_WEIGHTS: Weights = { kategori: 25, dogrulama: 25, asama: 15, yakinlik: 15, iletisim: 10, ticari: 10 }

export const WEIGHT_LABEL: Record<WeightKey, string> = {
  kategori: 'Kategori uygunluğu',
  dogrulama: 'İhtiyacın kaynakla doğrulanması',
  asama: 'Proje aşaması ve zaman',
  yakinlik: 'Ankara yakınlığı',
  iletisim: 'İletişim / teklif yolu açıklığı',
  ticari: 'Ticari potansiyel',
}

/** Ağırlıkları toplamı 100 olacak şekilde normalleştirir (negatif/geçersiz → 0; hepsi 0 → varsayılan) */
export function normalizeWeights(w: Partial<Record<string, unknown>> | null | undefined): Weights {
  const keys = Object.keys(DEFAULT_WEIGHTS) as WeightKey[]
  const raw = keys.map((k) => {
    const v = Number(w?.[k])
    return Number.isFinite(v) && v > 0 ? v : 0
  })
  const sum = raw.reduce((a, b) => a + b, 0)
  if (sum <= 0) return { ...DEFAULT_WEIGHTS }
  const out = {} as Weights
  keys.forEach((k, i) => (out[k] = (raw[i] * 100) / sum))
  return out
}

export interface ScoreContext {
  publishedAt: string | null
  now: Date
  /** Doğrulanmış (kaynağı ve tarihi olan) iletişim kanalı sayısı — tedarikçi portalı / satın alma e-postası öncelikli */
  verifiedContacts?: { strong: number; any: number }
}

export interface ScorePart {
  key: WeightKey
  label: string
  weight: number
  factor: number
  points: number
  reason: string
}

export type OpportunityLabel = 'dogrulanmis_firsat' | 'potansiyel_ihtiyac' | 'belirsiz'
export const LABEL_TEXT: Record<OpportunityLabel, string> = {
  dogrulanmis_firsat: 'Doğrulanmış iş fırsatı',
  potansiyel_ihtiyac: 'Potansiyel ihtiyaç — doğrulanmadı',
  belirsiz: 'Belirsiz / düşük uygunluk',
}

export interface ScoreResult {
  score: number
  parts: ScorePart[]
  verifiedNeed: boolean
  label: OpportunityLabel
}

function recencyFactor(publishedAt: string | null, now: Date): { f: number; text: string } {
  if (!publishedAt) return { f: 0.7, text: 'yayın tarihi bilinmiyor' }
  const days = (now.getTime() - Date.parse(publishedAt)) / 86400000
  if (!Number.isFinite(days)) return { f: 0.7, text: 'yayın tarihi okunamadı' }
  if (days <= 30) return { f: 1, text: 'son 30 gün' }
  if (days <= 90) return { f: 0.8, text: '30–90 gün önce' }
  if (days <= 180) return { f: 0.5, text: '90–180 gün önce' }
  return { f: 0.2, text: '180 günden eski' }
}

export function scoreOpportunity(c: Classification, ctx: ScoreContext, weights: Weights = DEFAULT_WEIGHTS): ScoreResult {
  const w = normalizeWeights(weights)
  const verified = c.categories.filter((x) => x.need === 'dogrulanmis')
  const textual = c.categories.filter((x) => x.need === 'potansiyel' && x.reason === 'haber_urun')
  const inferred = c.categories.filter((x) => x.reason === 'proje_turu')
  const parts: ScorePart[] = []
  const add = (key: WeightKey, factor: number, reason: string) => {
    const f = Math.max(0, Math.min(1, factor))
    parts.push({ key, label: WEIGHT_LABEL[key], weight: Math.round(w[key] * 10) / 10, factor: Math.round(f * 100) / 100, points: Math.round(w[key] * f * 10) / 10, reason })
  }

  // 1) Kategori uygunluğu
  if (verified.length) add('kategori', 1, `İlan LEONX ürününü açıkça adlandırıyor (${verified.map((x) => x.key).join(', ')})`)
  else if (textual.length) add('kategori', 0.6, `Ürün haber metninde geçiyor (${textual.map((x) => x.key).join(', ')})`)
  else if (inferred.length) add('kategori', 0.35, 'Yalnız proje türünden çıkarım (ürün metinde geçmiyor)')
  else add('kategori', 0, 'LEONX kategorisiyle eşleşme yok')

  // 2) Doğrulama
  add('dogrulama', verified.length ? 1 : 0, verified.length ? 'İhtiyaç satın alma/ihale ilanıyla doğrulandı' : 'İhtiyaç kaynakla doğrulanmadı')

  // 3) Aşama ve zaman
  const today = ctx.now.toISOString().slice(0, 10)
  const rec = recencyFactor(ctx.publishedAt, ctx.now)
  let stageF = 0.3
  let stageText = 'aşama bilinmiyor'
  if (c.stage === 'ihale') {
    if (c.tender.deadline) {
      const left = (Date.parse(c.tender.deadline) - Date.parse(today)) / 86400000
      if (left < 0) {
        stageF = 0
        stageText = 'son teklif tarihi geçmiş'
      } else if (left < 3) {
        stageF = 0.7
        stageText = `son teklife ${left} gün`
      } else {
        stageF = 1
        stageText = `ihale açık, son teklife ${left} gün`
      }
    } else {
      stageF = 0.8
      stageText = 'ihale/satın alma, son tarih bilinmiyor'
    }
  } else if (c.stage === 'planlama') {
    stageF = 0.8
    stageText = 'planlama aşaması (erken temas fırsatı)'
  } else if (c.stage === 'yapim') {
    stageF = 0.6
    stageText = 'yapım sürüyor'
  } else if (c.stage === 'tamamlandi') {
    stageF = 0.05
    stageText = 'proje tamamlanmış'
  }
  add('asama', stageF * rec.f, `${stageText}; ${rec.text}`)

  // 4) Ankara yakınlığı
  const prox = ankaraProximity(c.geo.city)
  add('yakinlik', prox, c.geo.city ? (c.geo.isAnkara ? `Ankara${c.geo.district ? ` / ${c.geo.district}` : ''}` : prox >= 0.6 ? `${c.geo.city} (Ankara'ya komşu)` : c.geo.city) : 'konum bilinmiyor')

  // 5) İletişim / teklif yolu
  const vc = ctx.verifiedContacts ?? { strong: 0, any: 0 }
  if (vc.strong > 0) add('iletisim', 1, 'Doğrulanmış tedarikçi portalı / satın alma kanalı var')
  else if (vc.any > 0) add('iletisim', 0.7, 'Doğrulanmış genel iletişim kanalı var')
  else if (c.isProcurement && (c.tender.ikn || c.tender.deadline)) add('iletisim', 0.6, 'İlan teklif yolunu tanımlıyor (İKN / son tarih)')
  else if (c.organizations.length) add('iletisim', 0.3, 'Kurum/firma adı biliniyor, iletişim doğrulanmadı')
  else add('iletisim', 0, 'Teklif yolu belirsiz')

  // 6) Ticari potansiyel
  const pt = c.projectType ? PROJECT_TYPE_BY_KEY[c.projectType.key] : null
  const nCat = new Set(c.categories.filter((x) => x.reason !== 'proje_turu').map((x) => x.key)).size
  const size = Math.min(1, (pt?.size ?? 0.3) + (nCat >= 3 ? 0.2 : nCat === 2 ? 0.1 : 0))
  add('ticari', size, `${pt ? pt.label : 'proje türü bilinmiyor'}${nCat ? `; ${nCat} iş kalemi metinde geçiyor` : ''}`)

  const score = Math.max(0, Math.min(100, Math.round(parts.reduce((a, p) => a + p.points, 0))))
  const verifiedNeed = verified.length > 0
  const label: OpportunityLabel = verifiedNeed ? 'dogrulanmis_firsat' : c.categories.length ? 'potansiyel_ihtiyac' : 'belirsiz'
  return { score, parts, verifiedNeed, label }
}

/** Fırsat etiketi: doğrulanmış ihtiyaç yoksa asla "Doğrulanmış iş fırsatı" değildir */
export function labelFor(verifiedNeed: boolean, hasAnyCategory: boolean): OpportunityLabel {
  return verifiedNeed ? 'dogrulanmis_firsat' : hasAnyCategory ? 'potansiyel_ihtiyac' : 'belirsiz'
}

// ------------------------------------------------------------------ Güvenilirlik

export interface ReliabilityInput {
  sourceKind: SourceKind
  sectorHint: 'kamu' | 'ozel' | null
  permission: 'izinli' | 'inceleniyor' | 'izinsiz'
  publishedAt: string | null
  now: Date
  /** Aynı fırsatı bildiren farklı kaynak sayısı */
  distinctSources: number
}

export interface ReliabilityPart {
  key: 'kaynak_turu' | 'izin' | 'guncellik' | 'dogrulama_sayisi' | 'tarih'
  label: string
  points: number
  max: number
  reason: string
}

/** Çoklu kaynak teyidi puanı (SQL radar_ingest ile aynı tablo): 1 → 0, 2 → 15, ≥3 → 25 */
export function corroborationPoints(distinctSources: number): number {
  return distinctSources >= 3 ? 25 : distinctSources === 2 ? 15 : 0
}

/** Güvenilirlik (0–100): kaynak türü ≤30, izin ≤20, güncellik ≤20, çoklu kaynak ≤25, tarih varlığı 5 */
export function reliability(r: ReliabilityInput): { score: number; base: number; parts: ReliabilityPart[] } {
  const parts: ReliabilityPart[] = []
  const kindPts =
    r.sourceKind === 'search_api' ? 10
      : r.sourceKind === 'manual' ? 15
        : (r.sourceKind === 'rss' || r.sourceKind === 'atom') && r.sectorHint === 'kamu' ? 30
          : r.sourceKind === 'rss' || r.sourceKind === 'atom' ? 22
            : 25
  parts.push({ key: 'kaynak_turu', label: 'Kaynak türü', points: kindPts, max: 30, reason: r.sourceKind === 'search_api' ? 'Arama sonucu özeti (yalnız işaretçi)' : r.sourceKind === 'manual' ? 'Elle eklenen bağlantı' : r.sectorHint === 'kamu' ? 'Resmî / kamu akışı' : 'Kayıtlı yayın akışı / site' })
  const permPts = r.permission === 'izinli' ? 20 : r.permission === 'inceleniyor' ? 5 : 0
  parts.push({ key: 'izin', label: 'Kaynak izni', points: permPts, max: 20, reason: r.permission === 'izinli' ? 'Otomatik erişim izni doğrulandı' : r.permission === 'inceleniyor' ? 'İzin inceleniyor (elle)' : 'İzinsiz kaynak' })
  let rec = 0
  let recText = 'yayın tarihi yok'
  if (r.publishedAt) {
    const d = (r.now.getTime() - Date.parse(r.publishedAt)) / 86400000
    rec = d <= 30 ? 20 : d <= 90 ? 12 : d <= 365 ? 5 : 0
    recText = d <= 30 ? 'son 30 gün' : d <= 90 ? 'son 90 gün' : d <= 365 ? 'son 1 yıl' : '1 yıldan eski'
  }
  parts.push({ key: 'guncellik', label: 'Güncellik', points: rec, max: 20, reason: recText })
  parts.push({ key: 'tarih', label: 'Tarih bilgisi', points: r.publishedAt ? 5 : 0, max: 5, reason: r.publishedAt ? 'Kaynakta tarih var' : 'Kaynakta tarih yok' })
  const base = parts.reduce((a, p) => a + p.points, 0)
  const corr = corroborationPoints(r.distinctSources)
  parts.push({ key: 'dogrulama_sayisi', label: 'Farklı kaynak teyidi', points: corr, max: 25, reason: `${r.distinctSources} farklı kaynak` })
  return { score: Math.min(100, base + corr), base, parts }
}
