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
