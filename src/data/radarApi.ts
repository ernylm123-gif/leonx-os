import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllPages, insertOnce, versionedUpdate } from './api'
import type {
  RadarAction,
  RadarCategory,
  RadarCompany,
  RadarContact,
  RadarData,
  RadarDraft,
  RadarEvidence,
  RadarItemLink,
  RadarOpportunity,
  RadarOppCategory,
  RadarOppCompany,
  RadarRun,
  RadarSearchUsage,
  RadarSettings,
  RadarSettingsInput,
  RadarSource,
  RadarSourceInput,
  OppStatus,
} from './radarTypes'

/**
 * LEONX AI Radar veri erişimi. Fırsat, öğe, kanıt ve puanlar YALNIZ sunucuda (radar_ingest,
 * service_role) yazılır; istemci yalnız iş akışı alanlarını, kaynakları, ayarları ve taslakları
 * değiştirebilir (sütun düzeyinde yetki + RLS: supabase/migrations/20261022001500_leonx_radar.sql).
 */

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error
  return res.data as T
}

export const RADAR_TABLES = [
  'radar_settings', 'radar_categories', 'radar_sources', 'radar_source_runs', 'radar_opportunities', 'radar_opportunity_categories',
  'radar_companies', 'radar_opportunity_companies', 'radar_contacts', 'radar_search_usage',
] as const

export async function loadRadar(db: SupabaseClient): Promise<RadarData> {
  const [settings, categories, sources, runs, opportunities, oppCategories, companies, oppCompanies, contacts, usage, items] = await Promise.all([
    db.from('radar_settings').select('*').maybeSingle().then((r) => unwrap(r) as RadarSettings | null),
    fetchAllPages<RadarCategory>((f, t) => db.from('radar_categories').select('*').order('sort_order').order('key').range(f, t)),
    fetchAllPages<RadarSource>((f, t) => db.from('radar_sources').select('*').order('created_at').order('id').range(f, t)),
    db.from('radar_source_runs').select('*').order('started_at', { ascending: false }).range(0, 199).then((r) => unwrap(r) as RadarRun[]),
    fetchAllPages<RadarOpportunity>((f, t) => db.from('radar_opportunities').select('*').order('last_updated_at', { ascending: false }).order('id').range(f, t)),
    fetchAllPages<RadarOppCategory>((f, t) => db.from('radar_opportunity_categories').select('*').order('id').range(f, t)),
    fetchAllPages<RadarCompany>((f, t) => db.from('radar_companies').select('*').order('name').order('id').range(f, t)),
    fetchAllPages<RadarOppCompany>((f, t) => db.from('radar_opportunity_companies').select('*').order('id').range(f, t)),
    fetchAllPages<RadarContact>((f, t) => db.from('radar_contacts').select('*').order('id').range(f, t)),
    db.from('radar_search_usage').select('*').order('month', { ascending: false }).range(0, 11).then((r) => unwrap(r) as RadarSearchUsage[]),
    fetchAllPages<RadarItemLink>((f, t) => db.from('radar_items').select('id, opportunity_id, source_id, canonical_url, published_at, first_seen_at, last_seen_at, pending').order('first_seen_at', { ascending: false }).order('id').range(f, t)),
  ])
  return { items, settings, categories, sources, runs, opportunities, oppCategories, companies, oppCompanies, contacts, usage }
}

export interface OpportunityDetail {
  evidence: RadarEvidence[]
  actions: RadarAction[]
  drafts: RadarDraft[]
}

export async function loadOpportunityDetail(db: SupabaseClient, id: string): Promise<OpportunityDetail> {
  const [evidence, actions, drafts] = await Promise.all([
    fetchAllPages<RadarEvidence>((f, t) => db.from('radar_evidence').select('*').eq('opportunity_id', id).order('accessed_at').order('id').range(f, t)),
    fetchAllPages<RadarAction>((f, t) => db.from('radar_actions').select('*').eq('opportunity_id', id).order('created_at', { ascending: false }).order('id').range(f, t)),
    fetchAllPages<RadarDraft>((f, t) => db.from('radar_outreach_drafts').select('*').eq('opportunity_id', id).order('created_at', { ascending: false }).order('id').range(f, t)),
  ])
  return { evidence, actions, drafts }
}

// ------------------------------------------------------------------ Fırsat iş akışı
export function setOpportunityStatus(db: SupabaseClient, o: Pick<RadarOpportunity, 'id' | 'version'>, status: OppStatus, note: string | null) {
  return versionedUpdate<RadarOpportunity>(db, 'radar_opportunities', o.id, o.version, { status, status_note: note })
}
export function updateOpportunity(db: SupabaseClient, o: Pick<RadarOpportunity, 'id' | 'version'>, patch: { next_action?: string | null; notes?: string | null }) {
  return versionedUpdate<RadarOpportunity>(db, 'radar_opportunities', o.id, o.version, patch)
}
export async function importToCrm(db: SupabaseClient, opportunityId: string, companyId: string | null, createProject: boolean): Promise<{ company_id: string | null; project_id: string | null }> {
  return unwrap(await db.rpc('radar_import_to_crm', { p_opportunity: opportunityId, p_company: companyId, p_create_project: createProject }))
}

// ------------------------------------------------------------------ Firma
export function updateRadarCompany(db: SupabaseClient, c: Pick<RadarCompany, 'id' | 'version'>, patch: Partial<Pick<RadarCompany, 'website' | 'website_verified' | 'website_source' | 'notes'>>) {
  return versionedUpdate<RadarCompany>(db, 'radar_companies', c.id, c.version, patch)
}

// ------------------------------------------------------------------ Taslaklar (GÖNDERİM YOK)
export function createDraft(db: SupabaseClient, input: Pick<RadarDraft, 'opportunity_id' | 'company_id' | 'contact_id' | 'subject' | 'body'>) {
  return insertOnce<RadarDraft>(db, 'radar_outreach_drafts', { ...input, status: 'taslak' })
}
export function updateDraft(db: SupabaseClient, d: Pick<RadarDraft, 'id' | 'version'>, patch: Partial<Pick<RadarDraft, 'subject' | 'body' | 'status' | 'contact_id'>>) {
  return versionedUpdate<RadarDraft>(db, 'radar_outreach_drafts', d.id, d.version, patch)
}
export async function deleteDraft(db: SupabaseClient, id: string) {
  unwrap(await db.from('radar_outreach_drafts').delete().eq('id', id).select('id'))
}

// ------------------------------------------------------------------ Kaynaklar
export function createSource(db: SupabaseClient, input: RadarSourceInput & { id?: string }) {
  return insertOnce<RadarSource>(db, 'radar_sources', input)
}
export function updateSource(db: SupabaseClient, s: Pick<RadarSource, 'id' | 'version'>, patch: Partial<RadarSourceInput>) {
  return versionedUpdate<RadarSource>(db, 'radar_sources', s.id, s.version, patch)
}
export async function deleteSource(db: SupabaseClient, id: string) {
  unwrap(await db.from('radar_sources').delete().eq('id', id).select('id'))
}
export async function addManualItem(db: SupabaseClient, url: string, title: string, text: string): Promise<string> {
  return unwrap(await db.rpc('radar_add_manual_item', { p_url: url, p_title: title, p_text: text }))
}

// ------------------------------------------------------------------ Ayarlar ve kategoriler
export function saveRadarSettings(db: SupabaseClient, s: Pick<RadarSettings, 'id' | 'version'>, patch: Partial<RadarSettingsInput>) {
  return versionedUpdate<RadarSettings>(db, 'radar_settings', s.id, s.version, patch)
}
export function updateCategory(db: SupabaseClient, c: Pick<RadarCategory, 'id' | 'version'>, patch: Partial<Pick<RadarCategory, 'active' | 'extra_keywords'>>) {
  return versionedUpdate<RadarCategory>(db, 'radar_categories', c.id, c.version, patch)
}

// ------------------------------------------------------------------ Sunucu işlevleri (Edge Function)
export class FunctionUnavailableError extends Error {
  constructor(public readonly fn: string) {
    super(`Sunucu işlevi "${fn}" henüz dağıtılmadı veya erişilemiyor. Dağıtım sahip onayıyla yapılır (docs/LEONX_AI_RADAR.md).`)
    this.name = 'FunctionUnavailableError'
  }
}

async function invoke<T>(db: SupabaseClient, fn: string, body: Record<string, unknown>): Promise<T> {
  const r = await db.functions.invoke(fn, { body })
  if (r.error) {
    const ctx = (r.error as { context?: Response }).context
    const status = ctx && typeof ctx.status === 'number' ? ctx.status : null
    if (status === null || status === 404 || (r.error as Error).name === 'FunctionsFetchError' || (r.error as Error).name === 'FunctionsRelayError') throw new FunctionUnavailableError(fn)
    let msg: string | null = null
    try {
      msg = ((await ctx!.json()) as { error?: string }).error ?? null
    } catch {
      msg = null
    }
    throw new Error(msg ?? `${fn}: HTTP ${status}`)
  }
  return r.data as T
}

export interface SourceTestResult {
  ok: boolean
  error: string | null
  http_status: number | null
  content_type: string | null
  item_count: number
  items: { title: string; link: string }[]
  warnings: string[]
  robots: 'izinli' | 'yasak' | 'gerekmiyor'
}
export function testSourceRemote(db: SupabaseClient, sourceId: string) {
  return invoke<SourceTestResult>(db, 'radar-scan', { test_source_id: sourceId })
}

export interface ContactResearchResponse {
  pages: { url: string; status: number | null; note: string | null }[]
  saved: number
  skipped_personal: number
  skipped_foreign_domain: number
  skipped_irrelevant: number
}
export function researchContactsRemote(db: SupabaseClient, companyId: string) {
  return invoke<ContactResearchResponse>(db, 'radar-contacts', { company_id: companyId })
}
