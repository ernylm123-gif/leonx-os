/**
 * LEONX AI Radar — veritabanı satır türleri (supabase/migrations/20261022001500_leonx_radar.sql ile aynı).
 */
import type { ReliabilityPart, ScorePart } from '@radar/score.ts'

export type SourceKind = 'rss' | 'atom' | 'site' | 'search_api' | 'manual'
export type Permission = 'izinli' | 'inceleniyor' | 'izinsiz'
export type RunStatus = 'ok' | 'degismedi' | 'hata' | 'atlandi'
export type NeedStatus = 'dogrulanmis' | 'potansiyel'
export type OppStage = 'planlama' | 'ihale' | 'yapim' | 'tamamlandi' | 'bilinmiyor'
export type OppSector = 'kamu' | 'ozel' | 'bilinmiyor'
export type OppStatus =
  | 'yeni' | 'inceleniyor' | 'firma_dogrulandi' | 'iletisim_planlandi' | 'iletisime_gecildi' | 'teklif_istendi'
  | 'teklif_verildi' | 'gorusme' | 'kazanildi' | 'kaybedildi' | 'ilgisiz'
export type CompanyRole = 'yatirimci' | 'proje_sahibi' | 'ana_yuklenici' | 'alt_yuklenici' | 'mimar' | 'proje_yonetimi' | 'bilinmiyor'
export type ContactKind = 'tedarikci_portali' | 'ihale_adresi' | 'satinalma_eposta' | 'teknik_ofis_eposta' | 'genel_eposta' | 'telefon' | 'iletisim_formu'

export interface RadarSettings {
  id: string
  singleton: true
  weights: Record<string, number>
  home_city: string
  min_score: number
  high_priority_score: number
  notify_categories: string[]
  notify_cities: string[]
  digest_hour: number | null
  quiet_start: number | null
  quiet_end: number | null
  critical_enabled: boolean
  capability_text: string | null
  search_api_enabled: boolean
  search_monthly_limit: number
  search_daily_limit: number
  search_queries_per_run: number
  /** 019: önerilmeyecek firmalar */
  excluded_companies?: string[]
  updated_at: string
  version: number
}
export type RadarSettingsInput = Omit<RadarSettings, 'id' | 'singleton' | 'updated_at' | 'version'>

export interface RadarCategory {
  key: string
  id: string
  name: string
  group_key: 'kapi' | 'aluminyum_pvc' | 'metal'
  sort_order: number
  active: boolean
  extra_keywords: string[]
  version: number
}

export interface RadarSource {
  id: string
  name: string
  kind: SourceKind
  url: string | null
  allowed_hosts: string[]
  sector_hint: 'kamu' | 'ozel' | null
  region_hint: string | null
  permission_status: Permission
  permission_note: string | null
  permission_checked_at: string | null
  interval_minutes: number
  max_items: number
  active: boolean
  last_run_at: string | null
  last_status: RunStatus | null
  last_error: string | null
  consecutive_failures: number
  next_run_at: string | null
  last_test_at: string | null
  /** 018: sunucu doğrulaması ("Doğrula"); yalnız sunucu yazar */
  verification?: SourceVerification | null
  verified_at?: string | null
  created_at: string
  version: number
}

export interface SourceVerification {
  ok: boolean
  robots: 'izinli' | 'yasak' | 'gerekmiyor'
  http_status: number | null
  items: number
  listings?: number
  relevant: number
  sample: { title: string; link: string; relevant: boolean }[]
  blockers: string[]
  warnings: string[]
  checked_at?: string
}
export type RadarSourceInput = Pick<RadarSource, 'name' | 'kind' | 'url' | 'allowed_hosts' | 'sector_hint' | 'region_hint' | 'permission_status' | 'permission_note' | 'permission_checked_at' | 'interval_minutes' | 'max_items' | 'active'>

export interface RadarRun {
  id: string
  source_id: string
  started_at: string
  finished_at: string | null
  status: RunStatus
  http_status: number | null
  items_seen: number
  items_new: number
  items_updated: number
  /** 018: ilgisiz bulunup yazılmayan öğe sayısı */
  items_rejected?: number
  error: string | null
  duration_ms: number | null
}

export interface RadarOpportunity {
  id: string
  title: string
  city: string | null
  district: string | null
  is_ankara: boolean
  sector: OppSector
  project_type: string | null
  stage: OppStage
  tender: { ikn?: string | null; deadline?: string | null; deadlineText?: string | null; signals?: string[] }
  deadline: string | null
  score: number
  score_breakdown: ScorePart[]
  reliability: number
  reliability_base: number
  reliability_breakdown: ReliabilityPart[]
  verified_need: boolean
  label: 'dogrulanmis_firsat' | 'potansiyel_ihtiyac' | 'belirsiz'
  risks: string[]
  status: OppStatus
  status_note: string | null
  next_action: string | null
  cluster_key: string
  first_seen_at: string
  last_updated_at: string
  crm_company_id: string | null
  project_id: string | null
  notes: string | null
  version: number
  /** 019: satış istihbaratı (sunucuda türetilir; eski kayıtlarda boş olabilir) */
  sales_class?: SalesClass | null
  construction_stage?: ConstructionStageKey | null
  stage_terms?: string[]
  procurement_outlook?: { tahmin: true; pencere: OutlookWindow; urunler: string[]; gerekce: string } | null
  region_priority?: number | null
  product_groups?: string[]
  recommended_action?: string | null
  excluded_company?: string | null
}

export type SalesClass = 'A' | 'B' | 'C' | 'D'
export type ConstructionStageKey = 'ruhsat' | 'temel_atma' | 'hafriyat' | 'temel' | 'kaba_insaat' | 'kaba_tamam' | 'duvar' | 'cephe' | 'dograma' | 'ince_isler' | 'tamamlandi'
export type OutlookWindow = 'gecmis_olabilir' | 'simdi' | '0-3_ay' | '3-6_ay' | '6-18_ay'
export const OUTLOOK_LABEL: Record<OutlookWindow, string> = {
  gecmis_olabilir: 'Geçmiş olabilir',
  simdi: 'Şimdi',
  '0-3_ay': '0–3 ay içinde',
  '3-6_ay': '3–6 ay içinde',
  '6-18_ay': '6–18 ay içinde',
}

/** 019: radar_sales_overview() — sayılar doğrudan veritabanından */
export interface RadarSalesOverview {
  checked_at: string
  by_class: Partial<Record<SalesClass | '-', number>>
  new_today: number
  updated_today: number
  approaching: number
  by_province: { city: string; priority: number | null; n: number; a: number; b: number; c: number; districts: { district: string; n: number }[] }[]
  contractors_to_contact: { id: string; name: string; company_kind: string | null; website: string | null; supplier_portal_url: string | null; next_action: string | null; next_action_at: string | null; last_outreach_at: string | null; best: SalesClass; priority: number | null; projects: number }[]
  excluded_companies: string[]
}

export interface RadarOppCategory {
  id: string
  opportunity_id: string
  category_key: string
  need_status: NeedStatus
  matched_terms: string[]
  evidence_item_id: string | null
}

export interface RadarEvidence {
  id: string
  opportunity_id: string
  item_id: string | null
  field: string
  claim: string
  excerpt: string | null
  url: string
  published_at: string | null
  accessed_at: string
}

export interface RadarCompany {
  id: string
  name: string
  normalized_name: string
  website: string | null
  website_verified: boolean
  website_source: 'kanit' | 'sahip' | null
  crm_company_id: string | null
  notes: string | null
  version: number
  /** 019: yüklenici dizini */
  company_kind?: 'yuklenici' | 'gelistirici' | 'yatirimci' | 'kamu' | 'mimar' | 'diger' | null
  supplier_portal_url?: string | null
  supplier_portal_source?: string | null
  procurement_url?: string | null
  excluded?: boolean
  exclusion_reason?: string | null
  last_outreach_at?: string | null
  next_action?: string | null
  next_action_at?: string | null
}

export interface RadarOppCompany {
  id: string
  opportunity_id: string
  company_id: string
  role: CompanyRole
  verified: boolean
  evidence_item_id: string | null
}

export interface RadarContact {
  id: string
  company_id: string
  kind: ContactKind
  value: string
  source_url: string
  verified_at: string
}

export interface RadarAction {
  id: number
  opportunity_id: string
  from_status: string | null
  to_status: string
  note: string | null
  created_by: string | null
  created_at: string
}

export interface RadarDraft {
  id: string
  opportunity_id: string
  company_id: string | null
  contact_id: string | null
  subject: string
  body: string
  status: 'taslak' | 'onaylandi' | 'gonderildi_elle'
  created_at: string
  updated_at: string
  version: number
}

export interface RadarSearchUsage {
  month: string
  calls: number
  day: string | null
  day_calls: number
}

/** Öğe → fırsat/kaynak bağlantısı (kaynak türü süzgeci ve kaynak listesi için hafif okuma) */
export interface RadarItemLink {
  id: string
  opportunity_id: string | null
  source_id: string | null
  canonical_url: string
  published_at: string | null
  first_seen_at: string
  last_seen_at: string
  pending: boolean
}

/** Panelin tüm verisi (tek sahip; kayıt sayısı küçük) */
export interface RadarData {
  items: RadarItemLink[]
  settings: RadarSettings | null
  categories: RadarCategory[]
  sources: RadarSource[]
  runs: RadarRun[]
  opportunities: RadarOpportunity[]
  oppCategories: RadarOppCategory[]
  companies: RadarCompany[]
  oppCompanies: RadarOppCompany[]
  contacts: RadarContact[]
  usage: RadarSearchUsage[]
  /** 017: teklif taslağı bağlı fırsatlar (Teklif hazırlandı aşaması bundan türetilir) */
  quotedOpportunityIds: string[]
}

/** 016: önemli değişiklik (yalnız sunucu yazar) */
export interface RadarChange {
  id: string
  opportunity_id: string
  field: 'stage' | 'deadline' | 'verified_need' | 'label' | 'insaat_asamasi' | 'satis_sinifi'
  old_value: string | null
  new_value: string | null
  created_at: string
  notified_at: string | null
}

/** 016: rapor satırındaki kısa fırsat özeti */
export interface DigestOpp {
  id: string
  title: string
  city: string | null
  district?: string | null
  score: number
  reliability?: number
  label?: RadarOpportunity['label']
  stage?: OppStage
  status: OppStatus
  deadline: string | null
  is_new?: boolean
  next_action?: string | null
  last_touch?: string
}

/** 016: zamanlanmış rapor (günlük öncelikli rapor / haftalık hat ve takip özeti) */
export interface RadarDigest {
  id: string
  kind: 'gunluk' | 'haftalik'
  period_start: string
  period_end: string
  created_at: string
  payload: {
    generated_at?: string
    new_count?: number
    updated_count?: number
    verified_count?: number
    top?: DigestOpp[]
    deadlines?: DigestOpp[]
    follow_ups?: DigestOpp[]
    pipeline?: Partial<Record<OppStatus, number>>
    won?: number
    lost?: number
    sources?: { active: number; failing: number; runs_24h: number; errors_24h: number }
  }
}

/** 016: radar_health() */
export interface RadarHealth {
  checked_at: string
  scan_configured: boolean
  active_sources: number
  failing_sources: { id: string; name: string; failures: number; last_status: RunStatus | null }[]
  last_run_at: string | null
  runs_24h: number
  errors_24h: number
  pending_notifications: number
}

/** 018: işletim özeti (radar_ops) — sayılar doğrudan veritabanından */
export interface RadarOps {
  checked_at: string
  scan_configured: boolean
  cron_active: boolean
  next_scan_at: string | null
  last_dispatch_at: string | null
  last_dispatch_http: { status_code: number | null; error: string | null; at: string; body: string | null } | null
  active_sources: number
  verified_sources: number
  candidate_sources: number
  last_success_at: string | null
  last_run_at: string | null
  sources_checked_24h: number
  runs_24h: number
  errors_24h: number
  items_collected_24h: number
  items_rejected_24h: number
  reject_reasons_24h: Record<string, number>
  opportunities_new_24h: number
  opportunities_verified_24h: number
  opportunities_total: number
  push: {
    subscriptions: number
    last_success_at: string | null
    last: { title: string; kind: string; push_state: string; push_attempts: number; created_at: string } | null
    pending: number
    failed: number
  }
  errors: { source_id: string; name: string; status: RunStatus; http_status: number | null; error: string | null; at: string; failures: number }[]
}

export const EMPTY_RADAR: RadarData ={ items: [], settings: null, categories: [], sources: [], runs: [], opportunities: [], oppCategories: [], companies: [], oppCompanies: [], contacts: [], usage: [], quotedOpportunityIds: [] }

// ------------------------------------------------------------------ Etiketler
export const STATUS_LABEL: Record<OppStatus, string> = {
  yeni: 'Yeni',
  inceleniyor: 'İnceleniyor',
  firma_dogrulandi: 'Firma doğrulandı',
  iletisim_planlandi: 'İletişim planlandı',
  iletisime_gecildi: 'İletişime geçildi',
  teklif_istendi: 'Teklif istendi',
  teklif_verildi: 'Teklif verildi',
  gorusme: 'Görüşme',
  kazanildi: 'Kazanıldı',
  kaybedildi: 'Kaybedildi',
  ilgisiz: 'İlgisiz',
}
export const STATUS_ORDER = Object.keys(STATUS_LABEL) as OppStatus[]
export const STAGE_LABEL: Record<OppStage, string> = { planlama: 'Planlama', ihale: 'İhale / satın alma', yapim: 'Yapım', tamamlandi: 'Tamamlandı', bilinmiyor: 'Bilinmiyor' }
export const SECTOR_LABEL: Record<OppSector, string> = { kamu: 'Kamu', ozel: 'Özel', bilinmiyor: 'Bilinmiyor' }
export const ROLE_LABEL: Record<CompanyRole, string> = {
  yatirimci: 'Yatırımcı', proje_sahibi: 'Proje sahibi', ana_yuklenici: 'Ana yüklenici', alt_yuklenici: 'Alt yüklenici', mimar: 'Mimar',
  proje_yonetimi: 'Proje yönetimi', bilinmiyor: 'Rol bilinmiyor',
}
export const KIND_LABEL: Record<SourceKind, string> = { rss: 'RSS', atom: 'Atom', site: 'Site sayfası', search_api: 'Arama API (Tavily)', manual: 'Elle' }
export const PERMISSION_LABEL: Record<Permission, string> = { izinli: 'İzinli', inceleniyor: 'İnceleniyor', izinsiz: 'İzinsiz' }
export const RUN_LABEL: Record<RunStatus, string> = { ok: 'Başarılı', degismedi: 'Değişmedi', hata: 'Hata', atlandi: 'Atlandı' }
