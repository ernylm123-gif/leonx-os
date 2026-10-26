/**
 * LEONX AI Radar — arayüz mantığı (saf işlevler): süzgeçler, Ankara öncelikli sıralama, göstergeler,
 * eksik bilgiler, riskler ve kural tabanlı ticari strateji ÖNERİSİ. Yalnız kayıtlı verilerden üretir;
 * hiçbir alan uydurulmaz (bilinmeyen değer "bilinmiyor" olarak gösterilir).
 */
import { type Advice, advise } from '@radar/advice.ts'
import type { AssistantOpportunity } from '@radar/assistant.ts'
import { RISK_LABEL, type RiskCode } from '@radar/classify.ts'
import { CONTACT_KIND_LABEL } from '@radar/contacts.ts'
import { categoryName, CATEGORY_BY_KEY, PROJECT_TYPE_BY_KEY } from '@radar/taxonomy.ts'
import type {
  ContactKind,
  RadarCompany,
  RadarContact,
  RadarData,
  RadarOpportunity,
  RadarOppCategory,
  RadarOppCompany,
  OppStatus,
  SourceKind,
} from '@/data/radarTypes'
import { ROLE_LABEL } from '@/data/radarTypes'

export const UNKNOWN = 'bilinmiyor'

export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const fmtDay = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : UNKNOWN)
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return UNKNOWN
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}
export const locationText = (o: Pick<RadarOpportunity, 'city' | 'district'>) => (o.city ? `${o.city}${o.district ? ` / ${o.district}` : ''}` : UNKNOWN)
export function daysLeft(deadline: string | null, today: string): number | null {
  if (!deadline) return null
  return Math.round((Date.parse(deadline) - Date.parse(today)) / 86400000)
}

// ------------------------------------------------------------------ İlişkiler
export interface OppView {
  opp: RadarOpportunity
  categories: RadarOppCategory[]
  companies: { link: RadarOppCompany; company: RadarCompany; contacts: RadarContact[] }[]
  sourceKinds: SourceKind[]
  sourceIds: string[]
}

export function buildViews(data: RadarData): OppView[] {
  const cats = new Map<string, RadarOppCategory[]>()
  for (const c of data.oppCategories) cats.set(c.opportunity_id, [...(cats.get(c.opportunity_id) ?? []), c])
  const companies = new Map(data.companies.map((c) => [c.id, c]))
  const contacts = new Map<string, RadarContact[]>()
  for (const c of data.contacts) contacts.set(c.company_id, [...(contacts.get(c.company_id) ?? []), c])
  const links = new Map<string, RadarOppCompany[]>()
  for (const l of data.oppCompanies) links.set(l.opportunity_id, [...(links.get(l.opportunity_id) ?? []), l])
  const srcKind = new Map(data.sources.map((s) => [s.id, s.kind]))
  const itemSources = new Map<string, Set<string>>()
  for (const i of data.items) if (i.opportunity_id && i.source_id) itemSources.set(i.opportunity_id, (itemSources.get(i.opportunity_id) ?? new Set()).add(i.source_id))
  const catOrder = new Map(data.categories.map((c) => [c.key, c.sort_order]))
  return data.opportunities.map((opp) => {
    const sids = [...(itemSources.get(opp.id) ?? [])]
    return {
      opp,
      categories: (cats.get(opp.id) ?? []).sort((a, b) => Number(b.need_status === 'dogrulanmis') - Number(a.need_status === 'dogrulanmis') || (catOrder.get(a.category_key) ?? 0) - (catOrder.get(b.category_key) ?? 0)),
      companies: (links.get(opp.id) ?? []).filter((l) => companies.has(l.company_id)).map((l) => ({ link: l, company: companies.get(l.company_id)!, contacts: contacts.get(l.company_id) ?? [] })),
      sourceKinds: [...new Set(sids.map((s) => srcKind.get(s)).filter((x): x is SourceKind => !!x))],
      sourceIds: sids,
    }
  })
}

// ------------------------------------------------------------------ CRM hattı ve öneri
/** Hat sütunları (mevcut durum değerleri; "Teklif hazırlandı" bağlı teklif taslağından türetilir) */
export type PipelineStage = 'kesfedildi' | 'arastiriliyor' | 'nitelikli' | 'iletisime_hazir' | 'iletisime_gecildi' | 'teklif_istendi' | 'teklif_hazirlandi' | 'teklif_verildi' | 'gorusme' | 'kazanildi' | 'kaybedildi'

export const PIPELINE: { key: PipelineStage; label: string }[] = [
  { key: 'kesfedildi', label: 'Keşfedildi' },
  { key: 'arastiriliyor', label: 'Araştırılıyor' },
  { key: 'nitelikli', label: 'Nitelikli' },
  { key: 'iletisime_hazir', label: 'İletişime hazır' },
  { key: 'iletisime_gecildi', label: 'İletişime geçildi' },
  { key: 'teklif_istendi', label: 'Teklif istendi' },
  { key: 'teklif_hazirlandi', label: 'Teklif hazırlandı' },
  { key: 'teklif_verildi', label: 'Teklif verildi' },
  { key: 'gorusme', label: 'Görüşme' },
  { key: 'kazanildi', label: 'Kazanıldı' },
  { key: 'kaybedildi', label: 'Kaybedildi' },
]

const STATUS_TO_STAGE: Record<OppStatus, PipelineStage | null> = {
  yeni: 'kesfedildi', inceleniyor: 'arastiriliyor', firma_dogrulandi: 'nitelikli', iletisim_planlandi: 'iletisime_hazir', iletisime_gecildi: 'iletisime_gecildi',
  teklif_istendi: 'teklif_istendi', teklif_verildi: 'teklif_verildi', gorusme: 'gorusme', kazanildi: 'kazanildi', kaybedildi: 'kaybedildi', ilgisiz: null,
}

/** Fırsatın hat sütunu; ilgisiz → null (hatta gösterilmez) */
export function pipelineStage(o: Pick<RadarOpportunity, 'status'>, quoted: boolean): PipelineStage | null {
  const s = STATUS_TO_STAGE[o.status]
  if (!s) return null
  // Teklif taslağı bağlı ama henüz verilmemişse: teklif hazırlandı
  if (quoted && ['kesfedildi', 'arastiriliyor', 'nitelikli', 'iletisime_hazir', 'iletisime_gecildi', 'teklif_istendi'].includes(s)) return 'teklif_hazirlandi'
  return s
}

export function groupPipeline(views: OppView[], quoted: ReadonlySet<string>): Map<PipelineStage, OppView[]> {
  const m = new Map<PipelineStage, OppView[]>(PIPELINE.map((p) => [p.key, []]))
  for (const v of views) {
    const st = pipelineStage(v.opp, quoted.has(v.opp.id))
    if (st) m.get(st)!.push(v)
  }
  for (const list of m.values()) list.sort((a, b) => b.opp.score - a.opp.score)
  return m
}

/** Tavsiye niteliğinde sonraki adım (doğrulanmış bilgi değildir) */
export function adviceFor(v: OppView, quoted: boolean, now: Date = new Date()): Advice {
  const o = v.opp
  return advise({ score: o.score, verified_need: o.verified_need, stage: o.stage, status: o.status, deadline: o.deadline, hasContact: v.companies.some((c) => c.contacts.length > 0), hasQuote: quoted, now })
}

// ------------------------------------------------------------------ Süzgeçler ve sıralama
export interface RadarFilters {
  q: string
  city: string
  district: string
  category: string
  sector: '' | 'kamu' | 'ozel' | 'bilinmiyor'
  stage: string
  minScore: number
  verification: '' | 'dogrulanmis' | 'potansiyel'
  deadlineFrom: string
  deadlineTo: string
  sourceKind: '' | SourceKind
  status: '' | 'aktif' | OppStatus
}

export const DEFAULT_FILTERS: RadarFilters = { q: '', city: '', district: '', category: '', sector: '', stage: '', minScore: 0, verification: '', deadlineFrom: '', deadlineTo: '', sourceKind: '', status: 'aktif' }

const CLOSED: OppStatus[] = ['ilgisiz', 'kaybedildi']

export function applyFilters(views: OppView[], f: RadarFilters): OppView[] {
  const q = f.q.trim().toLocaleLowerCase('tr-TR')
  return views.filter(({ opp, categories, sourceKinds, companies }) => {
    if (q && !`${opp.title} ${opp.city ?? ''} ${opp.district ?? ''} ${companies.map((c) => c.company.name).join(' ')}`.toLocaleLowerCase('tr-TR').includes(q)) return false
    if (f.city && opp.city !== f.city) return false
    if (f.district && opp.district !== f.district) return false
    if (f.category && !categories.some((c) => c.category_key === f.category)) return false
    if (f.sector && opp.sector !== f.sector) return false
    if (f.stage && opp.stage !== f.stage) return false
    if (f.minScore && opp.score < f.minScore) return false
    if (f.verification === 'dogrulanmis' && !opp.verified_need) return false
    if (f.verification === 'potansiyel' && opp.verified_need) return false
    if (f.deadlineFrom && (!opp.deadline || opp.deadline < f.deadlineFrom)) return false
    if (f.deadlineTo && (!opp.deadline || opp.deadline > f.deadlineTo)) return false
    if (f.sourceKind && !sourceKinds.includes(f.sourceKind)) return false
    if (f.status === 'aktif' && CLOSED.includes(opp.status)) return false
    if (f.status && f.status !== 'aktif' && opp.status !== f.status) return false
    return true
  })
}

/** Ankara önce; sonra doğrulanmış ihtiyaç, puan, güncellik */
export function sortAnkaraFirst(views: OppView[]): OppView[] {
  return [...views].sort(
    (a, b) =>
      Number(b.opp.is_ankara) - Number(a.opp.is_ankara) ||
      Number(b.opp.verified_need) - Number(a.opp.verified_need) ||
      b.opp.score - a.opp.score ||
      b.opp.last_updated_at.localeCompare(a.opp.last_updated_at),
  )
}

// ------------------------------------------------------------------ Göstergeler
export interface RadarKpis {
  todayNew: number
  ankara: number
  turkey: number
  highPriority: number
  deadlineSoon: number
  awaitingContact: number
  updated24h: number
  unverified: number
}

export function kpis(views: OppView[], now: Date, highPriorityScore: number): RadarKpis {
  const today = localDate(now)
  const active = views.filter((v) => !CLOSED.includes(v.opp.status))
  const dayAgo = new Date(now.getTime() - 86400000).toISOString()
  return {
    todayNew: active.filter((v) => localDate(new Date(v.opp.first_seen_at)) === today).length,
    ankara: active.filter((v) => v.opp.is_ankara).length,
    turkey: active.length,
    highPriority: active.filter((v) => v.opp.verified_need && v.opp.score >= highPriorityScore).length,
    deadlineSoon: active.filter((v) => v.opp.deadline && v.opp.deadline >= today && v.opp.deadline <= addDays(today, 14)).length,
    awaitingContact: active.filter((v) => v.opp.status === 'firma_dogrulandi' || v.opp.status === 'iletisim_planlandi').length,
    updated24h: active.filter((v) => v.opp.last_updated_at >= dayAgo).length,
    unverified: active.filter((v) => !v.opp.verified_need).length,
  }
}

// ------------------------------------------------------------------ Rapor bölümleri
const CHANNEL_PRIORITY: ContactKind[] = ['tedarikci_portali', 'satinalma_eposta', 'ihale_adresi', 'teknik_ofis_eposta', 'genel_eposta', 'telefon', 'iletisim_formu']

export function missingInfo(v: OppView): string[] {
  const out: string[] = ['Miktar / metraj kaynakta yok (bilinmiyor)', 'Bütçe / yaklaşık maliyet kaynakta yok (bilinmiyor)']
  if (!v.opp.deadline) out.push('Son teklif tarihi bilinmiyor')
  if (!v.opp.city) out.push('Konum bilinmiyor')
  if (v.opp.stage === 'bilinmiyor') out.push('Proje aşaması bilinmiyor')
  if (!v.companies.length) out.push('Proje sahibi / yüklenici bilinmiyor')
  else if (!v.companies.some((c) => c.link.verified)) out.push('Firma rolleri doğrulanmadı (yalnız metin tahmini)')
  if (!v.opp.verified_need) out.push('İş kapsamı kaynakla doğrulanmadı (yalnız potansiyel ihtiyaç)')
  return out
}

export interface RiskRow {
  code: string
  text: string
}

export function risks(v: OppView, today: string): RiskRow[] {
  const codes = new Set<string>(v.opp.risks)
  if (!v.companies.some((c) => c.contacts.length)) codes.add('iletisim_dogrulanmamis')
  if (v.opp.deadline && v.opp.deadline < today) codes.add('son_tarih_gecti')
  if (!v.opp.verified_need) codes.add('kapsam_belirsiz')
  return [...codes].map((c) => ({ code: c, text: RISK_LABEL[c as RiskCode] ?? c }))
}

export interface Strategy {
  whom: string[]
  channels: string[]
  questions: string[]
  documents: string[]
  products: string[]
  nextAction: string
}

const NEXT_BY_STATUS: Record<OppStatus, string> = {
  yeni: 'Kaynakları inceleyin; proje sahibi ve yükleniciyi doğrulayın',
  inceleniyor: 'Firma rolünü ve iletişim kanalını doğrulayın ("İletişim araştır")',
  firma_dogrulandi: 'İletişimi planlayın; tanıtım e-postası taslağını hazırlayın',
  iletisim_planlandi: 'Taslağı gözden geçirip kendi e-postanızdan gönderin (sistem göndermez)',
  iletisime_gecildi: 'Teknik şartname, çizim ve metraj listesini isteyin',
  teklif_istendi: 'Metraj ve teklif hazırlayın (Metraj / Teklifler modülü)',
  teklif_verildi: 'Teklif takibi: görüşme tarihi planlayın',
  gorusme: 'Görüşme sonucunu kaydedin',
  kazanildi: 'Proje kaydını oluşturun / güncelleyin',
  kaybedildi: 'Kaybetme nedenini not edin',
  ilgisiz: 'İşlem gerekmiyor',
}

/** Kural tabanlı ÖNERİ (veriye dayanır; tahminler açıkça belirtilir) */
export function strategy(v: OppView): Strategy {
  const order: (keyof typeof ROLE_LABEL)[] = ['ana_yuklenici', 'proje_sahibi', 'yatirimci', 'proje_yonetimi', 'mimar', 'alt_yuklenici', 'bilinmiyor']
  const comps = [...v.companies].sort((a, b) => order.indexOf(a.link.role) - order.indexOf(b.link.role))
  const whom = comps.length
    ? comps.slice(0, 3).map((c) => `${c.company.name} — ${ROLE_LABEL[c.link.role]}${c.link.verified ? '' : ' (rol doğrulanmadı)'}`)
    : ['Firma bilinmiyor — önce kaynaktan proje sahibini / yükleniciyi doğrulayın']
  const channels: string[] = []
  if (v.opp.tender?.ikn) channels.push(`Resmî ihale dokümanı (İKN ${v.opp.tender.ikn}) — ilgili resmî ihale sistemi üzerinden`)
  const allContacts = comps.flatMap((c) => c.contacts.map((k) => ({ c, k })))
  allContacts.sort((a, b) => CHANNEL_PRIORITY.indexOf(a.k.kind) - CHANNEL_PRIORITY.indexOf(b.k.kind))
  for (const { c, k } of allContacts.slice(0, 4)) channels.push(`${CONTACT_KIND_LABEL[k.kind]}: ${k.value} (${c.company.name}; kaynak doğrulama ${fmtDay(k.verified_at)})`)
  if (!channels.length) channels.push('Doğrulanmış kanal yok — firmanın kendi sitesinden "İletişim araştır" ile kaynaklı kanal bulun')
  const questions: string[] = []
  if (!v.opp.verified_need) questions.push('Projede bu iş kalemleri var mı ve hangi aşamada satın alınacak?')
  if (!v.opp.deadline) questions.push('Teklif son tarihi ve teklif verme yöntemi nedir?')
  questions.push('Miktar / metraj ve teknik şartname paylaşılabilir mi?')
  if (!v.companies.some((c) => c.link.role === 'ana_yuklenici' && c.link.verified)) questions.push('Ana yüklenici kim; satın alma kimin üzerinden yürüyor?')
  if (v.opp.stage === 'planlama') questions.push('Proje takvimi ve ihale planı nedir?')
  const groups = new Set(v.categories.map((c) => CATEGORY_BY_KEY[c.category_key]?.group))
  const documents = ['Teknik şartname', 'Mimari çizimler / pafta listesi (DWG, DXF veya PDF)', 'Metraj veya adet listesi']
  if (groups.has('kapi')) documents.push('Kapı çizelgesi (tip, ölçü, yangın dayanım sınıfı)')
  if (groups.has('aluminyum_pvc')) documents.push('Doğrama / cephe çizelgesi ve sistem detayları')
  if (groups.has('metal')) documents.push('İmalat detayları ve malzeme listesi')
  const products = v.categories.map((c) => `${categoryName(c.category_key)} — ${c.need_status === 'dogrulanmis' ? 'kaynakla doğrulanmış' : 'potansiyel (doğrulanmadı)'}`)
  return { whom, channels, questions, documents, products: products.length ? products : ['Eşleşen LEONX kategorisi yok'], nextAction: v.opp.next_action || NEXT_BY_STATUS[v.opp.status] }
}

export const projectTypeLabel = (key: string | null) => (key ? PROJECT_TYPE_BY_KEY[key]?.label ?? key : UNKNOWN)

// ------------------------------------------------------------------ Asistan bağdaştırıcısı
export function toAssistant(views: OppView[], data: RadarData): AssistantOpportunity[] {
  const itemsByOpp = new Map<string, RadarData['items']>()
  for (const i of data.items) if (i.opportunity_id) itemsByOpp.set(i.opportunity_id, [...(itemsByOpp.get(i.opportunity_id) ?? []), i])
  return views.map(({ opp, categories, companies }) => ({
    id: opp.id,
    title: opp.title,
    city: opp.city,
    district: opp.district,
    is_ankara: opp.is_ankara,
    sector: opp.sector,
    stage: opp.stage,
    score: opp.score,
    reliability: opp.reliability,
    verified_need: opp.verified_need,
    deadline: opp.deadline,
    first_seen_at: opp.first_seen_at,
    last_updated_at: opp.last_updated_at,
    status: opp.status,
    tender: opp.tender,
    categories: categories.map((c) => ({ key: c.category_key, need_status: c.need_status })),
    companies: companies.map((c) => ({ name: c.company.name, role: c.link.role, verified: c.link.verified, website: c.company.website, contacts: c.contacts.map((k) => ({ kind: k.kind, value: k.value, source_url: k.source_url, verified_at: k.verified_at })) })),
    sources: (itemsByOpp.get(opp.id) ?? []).map((i) => ({ url: i.canonical_url, published_at: i.published_at, accessed_at: i.first_seen_at })),
  }))
}

export function capabilitiesFrom(text: string | null | undefined, fallback: readonly string[]): string[] {
  const lines = (text ?? '').split('\n').map((s) => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
  return lines.length ? lines.slice(0, 12) : [...fallback]
}
