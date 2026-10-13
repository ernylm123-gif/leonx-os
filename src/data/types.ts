import type { ProjectCategory, ProjectPriority, ProjectStatus } from '@/lib/domain'

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
  status: ProjectStatus
  priority: ProjectPriority
  description: string | null
  start_date: string | null
  due_date: string | null
  location: string | null
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
  'code' | 'name' | 'company_id' | 'category' | 'status' | 'priority' | 'description' | 'start_date' | 'due_date' | 'location' | 'notes'
>

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
