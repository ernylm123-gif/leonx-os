import type { ProjectCategory, ProjectPriority, ProjectStage, ProjectStatus } from '@/lib/domain'

/** Veritabanı satır tipleri — supabase/migrations/20261012000100_leonx_core.sql ile uyumlu. */

interface Versioned {
  id: string
  created_by: string | null
  created_at: string
  updated_at: string
  version: number
}

export interface Company extends Versioned {
  name: string
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  tax_office: string | null
  tax_number: string | null
  notes: string | null
}

export interface Contact extends Versioned {
  company_id: string
  full_name: string
  title: string | null
  phone: string | null
  email: string | null
  is_primary: boolean
  notes: string | null
}

export interface Project extends Versioned {
  code: string
  name: string
  company_id: string | null
  category: ProjectCategory
  /** Eski durum (sunucuda aşamadan türetilir; istemci yazmaz) */
  status: ProjectStatus
  stage: ProjectStage
  progress: number
  on_hold: boolean
  completed_on: string | null
  priority: ProjectPriority
  description: string | null
  start_date: string | null
  due_date: string | null
  location: string | null
  address: string | null
  map_url: string | null
  notes: string | null
}

export interface ProjectNote extends Versioned {
  project_id: string
  body: string
}

export interface ProjectFile extends Versioned {
  project_id: string
  storage_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number
}

export interface StatusHistoryEntry {
  id: number
  project_id: string
  from_status: ProjectStatus | null
  to_status: ProjectStatus
  changed_by: string | null
  changed_at: string
}

/** İstemcinin yazabileceği alanlar (id, zaman damgaları, sürüm sunucuda belirlenir). */
export type CompanyInput = Pick<Company, 'name' | 'phone' | 'email' | 'address' | 'city' | 'tax_office' | 'tax_number' | 'notes'>
export type ContactInput = Pick<Contact, 'company_id' | 'full_name' | 'title' | 'phone' | 'email' | 'is_primary' | 'notes'>
export type ProjectInput = Pick<
  Project,
  | 'code'
  | 'name'
  | 'company_id'
  | 'category'
  | 'stage'
  | 'progress'
  | 'on_hold'
  | 'priority'
  | 'description'
  | 'start_date'
  | 'due_date'
  | 'completed_on'
  | 'location'
  | 'address'
  | 'map_url'
  | 'notes'
>

// ------------------------------------------------------------------ Faz 7: görevler, zaman çizelgesi, bildirimler
// supabase/migrations/20261014000700_leonx_workflow.sql ile uyumlu

export interface ProjectTask extends Versioned {
  project_id: string
  title: string
  description: string | null
  priority: ProjectPriority
  start_date: string | null
  due_date: string | null
  remind_at: string | null
  done: boolean
  done_at: string | null
  notes: string | null
  sort_order: number
}
export type ProjectTaskInput = Pick<ProjectTask, 'project_id' | 'title' | 'description' | 'priority' | 'start_date' | 'due_date' | 'remind_at' | 'done' | 'notes' | 'sort_order'>

export interface ProjectEvent {
  id: number
  project_id: string
  kind: string
  title: string
  detail: string | null
  ref_type: string | null
  ref_id: string | null
  actor: string | null
  created_at: string
}

export type NotificationCategory = 'proje' | 'teklif' | 'cad' | 'gorev' | 'termin' | 'sistem'

export interface AppNotification {
  id: string
  user_id: string
  category: NotificationCategory
  kind: string
  title: string
  body: string | null
  link: string | null
  entity_type: string | null
  entity_id: string | null
  actor: string | null
  read_at: string | null
  push_state: 'yok' | 'bekliyor' | 'gonderildi' | 'basarisiz'
  created_at: string
}

export interface NotificationPrefs {
  user_id: string
  in_app: boolean
  push: boolean
  cat_proje: boolean
  cat_teklif: boolean
  cat_cad: boolean
  cat_gorev: boolean
  cat_termin: boolean
  cat_sistem: boolean
  own_actions: boolean
  version: number
}
export type NotificationPrefsInput = Omit<NotificationPrefs, 'user_id' | 'version'>

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefsInput = {
  in_app: true,
  push: false,
  cat_proje: true,
  cat_teklif: true,
  cat_cad: true,
  cat_gorev: true,
  cat_termin: true,
  cat_sistem: true,
  own_actions: true,
}

export interface PushSubscriptionRow {
  id: string
  endpoint: string
  user_agent: string | null
  device_label: string | null
  created_at: string
  last_seen_at: string
  last_success_at: string | null
  failure_count: number
  disabled_at: string | null
}

// ------------------------------------------------------------------ CAD analizi ve metraj
// supabase/migrations/20261012000500_leonx_quantity.sql ile uyumlu

export interface CadAnalysis extends Versioned {
  project_id: string
  file_id: string | null
  file_name: string
  file_kind: 'dxf' | 'pdf'
  status: 'tamamlandi' | 'eksik' | 'hatali'
  units_mm_per_unit: number | null
  units_source: 'dosya' | 'kullanici' | 'kalibrasyon' | 'olcek' | 'yok'
  units_verified: boolean
  entity_count: number
  warning_count: number
  candidate_count: number
  engine_version: string
  summary: Record<string, unknown>
  notes: string | null
  /** Analiz edilen dosyanın SHA-256 özeti (aynı dosyanın yeniden analizi tanınır) */
  file_hash?: string | null
}

export type CadAnalysisInput = Pick<
  CadAnalysis,
  | 'project_id'
  | 'file_id'
  | 'file_name'
  | 'file_kind'
  | 'status'
  | 'units_mm_per_unit'
  | 'units_source'
  | 'units_verified'
  | 'entity_count'
  | 'warning_count'
  | 'candidate_count'
  | 'engine_version'
  | 'summary'
  | 'notes'
  | 'file_hash'
>

export type TakeoffStatus = 'taslak' | 'onaylandi' | 'arsiv'

export interface QuantityTakeoff extends Versioned {
  project_id: string
  name: string
  revision: number
  status: TakeoffStatus
  based_on: string | null
  analysis_id: string | null
  notes: string | null
  approved_at: string | null
  approved_by: string | null
}

export interface QuantityItemHistory {
  id: number
  item_id: string
  takeoff_id: string
  project_id: string
  poz_code: string | null
  action: 'ekle' | 'guncelle' | 'sil'
  changes: Record<string, { eski: unknown; yeni: unknown }>
  changed_by: string | null
  changed_at: string
}
