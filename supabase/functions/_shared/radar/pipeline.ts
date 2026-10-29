/**
 * LEONX Radar — tek bir kaynak öğesini (akış öğesi, arama sonucu veya elle eklenen bağlantı)
 * radar_ingest RPC'sine gidecek yapıya dönüştürür: temizle → kimlik/özet → sınıflandır →
 * puanla → kümele → kanıt satırları.
 *
 * Her iddia bir kanıt satırına bağlanır (alan, iddia, ≤500 karakter alıntı, kaynak adresi,
 * yayın tarihi). Tahmin/çıkarımlar ("potansiyel", "rol tahmini") kanıtta açıkça belirtilir.
 */
import { type Analyzer, ruleAnalyzer } from './analyzer.ts'
import type { Classification, SourceKind } from './classify.ts'
import { analyzeConstruction, PRODUCT_LABEL, SALES_CLASS_LABEL, STAGE_LABEL } from './construction.ts'
import { assignCluster, type ClusterRef, identify } from './dedupe.ts'
import { htmlToText } from './sanitize.ts'
import { reliability, type ReliabilityPart, type ScorePart, scoreOpportunity, type Weights } from './score.ts'
import { categoryName } from './taxonomy.ts'
import { clip, fold, squash } from './text.ts'

export interface SourceContext {
  id: string
  kind: SourceKind
  sectorHint: 'kamu' | 'ozel' | null
  permission: 'izinli' | 'inceleniyor' | 'izinsiz'
}

export interface PipelineSettings {
  weights: Weights
  activeCategories: string[] | null
  extraKeywords: Record<string, string[]>
  /** Önerilmeyecek firmalar (ör. "Özçelik İnşaat") — eşleşen kayıt sınıf D olur */
  excludedCompanies?: string[]
}

export interface RawInput {
  url: string
  title: string
  /** HTML veya düz metin (her durumda yeniden temizlenir) */
  body: string
  publishedAt: string | null
}

export interface IngestEvidence {
  field: string
  claim: string
  excerpt: string
}

export interface IngestItem {
  url: string
  canonical_url: string
  url_hash: string
  content_hash: string
  title: string
  summary: string
  published_at: string | null
  classification: Classification
  analyzer: string
  cluster_key: string
  cluster_tokens: string[]
  city: string | null
  district: string | null
  is_ankara: boolean
  sector: string
  project_type: string | null
  stage: string
  tender: Classification['tender']
  deadline: string | null
  score: number
  score_breakdown: ScorePart[]
  reliability_base: number
  reliability_breakdown: ReliabilityPart[]
  verified_need: boolean
  label: string
  risks: string[]
  categories: { key: string; need_status: 'dogrulanmis' | 'potansiyel'; matched_terms: string[] }[]
  companies: { name: string; normalized_name: string; role: string }[]
  evidence: IngestEvidence[]
  /** Elle eklenmiş, sınıflandırılmayı bekleyen öğe (radar_add_manual_item) */
  pending_item_id?: string
}

/** Metinde bir ifadenin geçtiği yerin çevresinden ≤500 karakter alıntı */
export function excerptAround(text: string, term: string, max = 500): string {
  const f = fold(text)
  const t = fold(term).split(' ')[0]
  const i = t ? f.indexOf(t) : -1
  if (i === -1) return clip(text, max)
  // fold uzunluğu değiştirmez (yalnız kesme işaretleri silinir); küçük kayma alıntı için önemsiz
  const start = Math.max(0, i - 160)
  const s = (start > 0 ? '…' : '') + text.slice(start, start + max - 2)
  return clip(s, max)
}

export function normalizeName(name: string): string {
  return fold(name).replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 200)
}

export async function buildIngestItem(
  raw: RawInput,
  source: SourceContext,
  settings: PipelineSettings,
  clusters: ClusterRef[],
  now: Date,
  analyzer: Analyzer = ruleAnalyzer,
): Promise<IngestItem | null> {
  const title = clip(htmlToText(raw.title, 1000), 300)
  const summary = clip(htmlToText(raw.body, 8000), 4000)
  if (!title && !summary) return null
  const id = await identify(raw.url, title, summary)
  if (!id) return null
  const c = await analyzer.analyze({
    title,
    summary,
    url: id.canonicalUrl,
    sourceKind: source.kind,
    sectorHint: source.sectorHint,
    publishedAt: raw.publishedAt,
    now,
    activeCategories: settings.activeCategories,
    extraKeywords: settings.extraKeywords,
  })
  c.intel = analyzeConstruction({ title, summary, classification: c, excludedPatterns: settings.excludedCompanies ?? [] })
  const s = scoreOpportunity(c, { publishedAt: raw.publishedAt, now }, settings.weights)
  const rel = reliability({ sourceKind: source.kind, sectorHint: source.sectorHint, permission: source.permission, publishedAt: raw.publishedAt, now, distinctSources: 1 })
  const cl = await assignCluster(title, c.geo.city, clusters)
  const text = `${title}. ${summary}`

  const evidence: IngestEvidence[] = [{ field: 'kaynak', claim: `Kaynak öğesi: ${clip(title, 250)}`, excerpt: clip(summary || title, 500) }]
  for (const cat of c.categories) {
    if (cat.reason === 'ihale_urun') evidence.push({ field: 'ihtiyac', claim: `Satın alma/ihale ilanında "${categoryName(cat.key)}" geçiyor (${cat.terms.join(', ')})`, excerpt: excerptAround(text, cat.terms[0]) })
    else if (cat.reason === 'haber_urun') evidence.push({ field: 'potansiyel', claim: `Haber metninde "${categoryName(cat.key)}" geçiyor; ilan değil — potansiyel ihtiyaç (${cat.terms.join(', ')})`, excerpt: excerptAround(text, cat.terms[0]) })
  }
  if (c.projectType) evidence.push({ field: 'proje_turu', claim: `Proje türü: ${c.projectType.label} (metinde: ${c.projectType.terms.join(', ')})`, excerpt: excerptAround(text, c.projectType.terms[0]) })
  if (c.geo.city) evidence.push({ field: 'konum', claim: `Konum: ${c.geo.city}${c.geo.district ? ` / ${c.geo.district}` : ''} (metinde: "${c.geo.matchedText}")`, excerpt: excerptAround(text, c.geo.matchedText ?? c.geo.city) })
  if (c.tender.ikn) evidence.push({ field: 'ihale', claim: `İhale kayıt numarası (İKN): ${c.tender.ikn}`, excerpt: excerptAround(text, c.tender.ikn) })
  if (c.tender.deadline) evidence.push({ field: 'son_tarih', claim: `Son teklif / ihale tarihi: ${c.tender.deadline.split('-').reverse().join('.')}`, excerpt: excerptAround(text, c.tender.deadlineText ?? '') })
  if (c.stage !== 'bilinmiyor') evidence.push({ field: 'asama', claim: `Aşama: ${c.stage} (${c.stageTerms.join(', ')})`, excerpt: excerptAround(text, c.stageTerms[0] ?? '') })
  const ci = c.intel
  if (ci.stage) evidence.push({ field: 'insaat_asamasi', claim: `İnşaat aşaması: ${STAGE_LABEL[ci.stage]} (metinde: ${ci.stageTerms.join(', ')})`, excerpt: excerptAround(text, ci.stageTerms[0] ?? '') })
  if (ci.supplierInvite.length) evidence.push({ field: 'tedarikci_daveti', claim: `Tedarikçi daveti / teklif talebi ifadesi: ${ci.supplierInvite.join(', ')}`, excerpt: excerptAround(text, ci.supplierInvite[0]) })
  if (ci.outlook) evidence.push({ field: 'tahmin', claim: `TAHMİN (kaynakta yazmaz): satın alma penceresi ${ci.outlook.pencere.replace('_', ' ')} — ${ci.outlook.gerekce}; ürünler: ${ci.outlook.urunler.map((g) => PRODUCT_LABEL[g]).join(', ') || '—'}`, excerpt: excerptAround(text, ci.stageTerms[0] ?? '') })
  evidence.push({ field: 'satis_sinifi', claim: `Satış sınıfı ${ci.salesClass} — ${SALES_CLASS_LABEL[ci.salesClass]}: ${ci.reasons.join('; ')}`, excerpt: clip(title, 500) })
  for (const o of c.organizations) evidence.push({ field: 'kurum', claim: `Kurum/firma adı geçiyor: ${o.name} (rol tahmini: ${o.roleGuess}, doğrulanmadı)`, excerpt: clip(o.context, 500) })

  return {
    url: raw.url,
    canonical_url: id.canonicalUrl,
    url_hash: id.urlHash,
    content_hash: id.contentHash,
    title: title || clip(summary, 200),
    summary,
    published_at: raw.publishedAt,
    classification: c,
    analyzer: analyzer.id,
    cluster_key: cl.clusterKey,
    cluster_tokens: cl.tokens,
    city: c.geo.city,
    district: c.geo.district,
    is_ankara: c.geo.isAnkara,
    sector: c.sector,
    project_type: c.projectType?.key ?? null,
    stage: c.stage,
    tender: c.tender,
    deadline: c.tender.deadline,
    score: s.score,
    score_breakdown: s.parts,
    reliability_base: rel.base,
    reliability_breakdown: rel.parts,
    verified_need: s.verifiedNeed,
    label: s.label,
    risks: c.risks,
    categories: c.categories.map((x) => ({ key: x.key, need_status: x.need, matched_terms: x.terms.slice(0, 10).map((t) => squash(t).slice(0, 120)) })),
    companies: c.organizations.map((o) => ({ name: o.name, normalized_name: normalizeName(o.name), role: o.roleGuess })),
    evidence: evidence.map((e) => ({ field: e.field, claim: clip(e.claim, 500), excerpt: clip(e.excerpt, 500) })),
  }
}
