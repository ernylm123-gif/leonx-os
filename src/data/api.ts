import type { SupabaseClient } from '@supabase/supabase-js'
import { contentTypeFor, STORAGE_BUCKET, storagePathFor } from '@/lib/files'
import type { ProjectStatus } from '@/lib/domain'
import { withNetworkRetry } from '@/lib/retry'
import { runBusy } from '@/lib/unsaved'
import type {
  Company,
  CompanyInput,
  Contact,
  ContactInput,
  Project,
  ProjectFile,
  ProjectInput,
  ProjectNote,
  StatusHistoryEntry,
} from './types'

/**
 * Veri erişim katmanı. Tüm sorgular supabase-js sorgu oluşturucusuyla yapılır
 * (parametreli; SQL metni birleştirilmez). Yetki kontrolü veritabanındaki RLS
 * politikalarındadır; buradaki kod istemci tarafı güvenlik varsaymaz.
 */

/** Liste sorgularında üst sınır (Supabase API varsayılanı 1000 satırdır). */
export const LIST_LIMIT = 1000

export class ConflictError extends Error {
  constructor(public readonly reason: 'changed' | 'deleted') {
    super(reason === 'deleted' ? 'Kayıt başka bir cihazda silinmiş.' : 'Kayıt başka bir cihazda değiştirilmiş.')
    this.name = 'ConflictError'
  }
}

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error
  return res.data as T
}

/**
 * Tekrarlanabilir (idempotent) ekleme. Kimlik istemcide üretilir; bağlantı koptuğunda istek
 * yeniden gönderilir. İlk deneme sunucuda başarılı olup yanıt kaybolduysa ikinci deneme
 * benzersizlik hatası (23505) alır: bu durumda aynı kimlikli kayıt okunur ve çift kayıt oluşmaz.
 */
export async function insertOnce<T>(db: SupabaseClient, table: string, row: object): Promise<T> {
  const id = ((row as { id?: string }).id ?? crypto.randomUUID()) as string
  return withNetworkRetry(async () => {
    const res = await db.from(table).insert({ ...row, id }).select('*').single()
    if (!res.error) return res.data as T
    if ((res.error as { code?: string }).code === '23505') {
      const got = await db.from(table).select('*').eq('id', id).maybeSingle()
      if (got.error) throw got.error
      if (got.data) return got.data as T
    }
    throw res.error
  })
}

/** Toplu tekrarlanabilir ekleme (tek istek, tek işlem). Önceki deneme yazıldıysa kayıtlar okunur. */
export async function insertManyOnce<T>(db: SupabaseClient, table: string, rows: object[]): Promise<T[]> {
  const withIds = rows.map((r) => ({ ...r, id: (r as { id?: string }).id ?? crypto.randomUUID() }))
  const ids = withIds.map((r) => r.id)
  return withNetworkRetry(async () => {
    const res = await db.from(table).insert(withIds).select('*')
    if (!res.error) return res.data as T[]
    if ((res.error as { code?: string }).code === '23505') {
      const got = await db.from(table).select('*').in('id', ids)
      if (got.error) throw got.error
      if (got.data && got.data.length === ids.length) return got.data as T[]
    }
    throw res.error
  })
}

/**
 * İyimser eşzamanlılık: güncelleme yalnızca beklenen sürüm hâlâ geçerliyse uygulanır.
 * Satır dönmezse kaydın başka cihazda değiştiği veya silindiği anlaşılır.
 */
export async function versionedUpdate<T extends { id: string; version: number }>(
  db: SupabaseClient,
  table: string,
  id: string,
  expectedVersion: number,
  patch: Record<string, unknown>,
): Promise<T> {
  const res = await db.from(table).update(patch).eq('id', id).eq('version', expectedVersion).select('*').maybeSingle()
  if (res.error) throw res.error
  if (res.data) return res.data as T
  const exists = await db.from(table).select('id').eq('id', id).maybeSingle()
  if (exists.error) throw exists.error
  throw new ConflictError(exists.data ? 'changed' : 'deleted')
}

// ------------------------------------------------------------------ Sahip
export async function checkIsOwner(db: SupabaseClient): Promise<boolean> {
  const res = await db.rpc('is_owner')
  if (res.error) throw res.error
  return res.data === true
}

// ------------------------------------------------------------------ Firmalar
export async function listCompanies(db: SupabaseClient): Promise<Company[]> {
  return unwrap(await db.from('companies').select('*').order('name', { ascending: true }).range(0, LIST_LIMIT - 1))
}

export async function createCompany(db: SupabaseClient, input: CompanyInput): Promise<Company> {
  return insertOnce(db, 'companies', input)
}

export function updateCompany(db: SupabaseClient, id: string, version: number, input: CompanyInput): Promise<Company> {
  return versionedUpdate<Company>(db, 'companies', id, version, { ...input })
}

export async function deleteCompany(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('companies').delete().eq('id', id).select('id'))
}

// ------------------------------------------------------------------ İlgili kişiler
export async function listContacts(db: SupabaseClient, companyId: string): Promise<Contact[]> {
  return unwrap(
    await db
      .from('contacts')
      .select('*')
      .eq('company_id', companyId)
      .order('is_primary', { ascending: false })
      .order('full_name', { ascending: true }),
  )
}

export async function createContact(db: SupabaseClient, input: ContactInput): Promise<Contact> {
  return insertOnce(db, 'contacts', input)
}

export function updateContact(db: SupabaseClient, id: string, version: number, input: ContactInput): Promise<Contact> {
  return versionedUpdate<Contact>(db, 'contacts', id, version, { ...input })
}

export async function deleteContact(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('contacts').delete().eq('id', id).select('id'))
}

// ------------------------------------------------------------------ Projeler
export async function listProjects(db: SupabaseClient): Promise<Project[]> {
  return unwrap(await db.from('projects').select('*').order('updated_at', { ascending: false }).range(0, LIST_LIMIT - 1))
}

export async function suggestProjectCode(db: SupabaseClient): Promise<string | null> {
  const res = await db.rpc('suggest_project_code')
  return res.error ? null : (res.data as string)
}

export async function createProject(db: SupabaseClient, input: ProjectInput): Promise<Project> {
  return insertOnce(db, 'projects', input)
}

export function updateProject(db: SupabaseClient, id: string, version: number, input: ProjectInput): Promise<Project> {
  return versionedUpdate<Project>(db, 'projects', id, version, { ...input })
}

export function updateProjectStatus(db: SupabaseClient, id: string, version: number, status: ProjectStatus): Promise<Project> {
  return versionedUpdate<Project>(db, 'projects', id, version, { status })
}

/** Projeyi siler. Önce depodaki dosyaları kaldırır; meta veri, notlar ve geçmiş veritabanında zincirleme silinir. */
export async function deleteProject(db: SupabaseClient, id: string): Promise<void> {
  const files = await listProjectFiles(db, id)
  if (files.length) {
    const rm = await db.storage.from(STORAGE_BUCKET).remove(files.map((f) => f.storage_path))
    if (rm.error) throw rm.error
  }
  unwrap(await db.from('projects').delete().eq('id', id).select('id'))
}

export async function listStatusHistory(db: SupabaseClient, projectId: string): Promise<StatusHistoryEntry[]> {
  return unwrap(
    await db.from('project_status_history').select('*').eq('project_id', projectId).order('changed_at', { ascending: false }).limit(200),
  )
}

// ------------------------------------------------------------------ Notlar
export async function listNotes(db: SupabaseClient, projectId: string): Promise<ProjectNote[]> {
  return unwrap(await db.from('project_notes').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(500))
}

export async function createNote(db: SupabaseClient, projectId: string, body: string): Promise<ProjectNote> {
  return insertOnce(db, 'project_notes', { project_id: projectId, body })
}

export async function deleteNote(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('project_notes').delete().eq('id', id).select('id'))
}

// ------------------------------------------------------------------ Dosyalar
export async function listProjectFiles(db: SupabaseClient, projectId: string): Promise<ProjectFile[]> {
  return unwrap(await db.from('project_files').select('*').eq('project_id', projectId).order('created_at', { ascending: false }))
}

/** Dosyayı özel bucket'a yükler ve meta veriyi kaydeder; kayıt başarısız olursa yüklenen dosyayı geri siler. */
export function uploadProjectFile(db: SupabaseClient, projectId: string, file: File): Promise<ProjectFile> {
  // Yükleme sürerken sürüm güncellemesi ertelenir
  return runBusy(`${file.name} yükleniyor`, () => uploadNow(db, projectId, file))
}

async function uploadNow(db: SupabaseClient, projectId: string, file: File): Promise<ProjectFile> {
  const path = storagePathFor(projectId, file.name, crypto.randomUUID())
  const contentType = contentTypeFor(file.name)
  const up = await db.storage.from(STORAGE_BUCKET).upload(path, file, { contentType, upsert: false, cacheControl: '3600' })
  if (up.error) throw up.error
  try {
    return await insertOnce<ProjectFile>(db, 'project_files', { project_id: projectId, storage_path: path, file_name: file.name, mime_type: contentType, size_bytes: file.size })
  } catch (e) {
    await db.storage.from(STORAGE_BUCKET).remove([path])
    throw e
  }
}

/** Özel dosyayı yetkili oturumla indirir (herkese açık bağlantı oluşturulmaz). */
export async function downloadProjectFile(db: SupabaseClient, file: ProjectFile): Promise<Blob> {
  const res = await db.storage.from(STORAGE_BUCKET).download(file.storage_path)
  if (res.error) throw res.error
  return res.data
}

export async function deleteProjectFile(db: SupabaseClient, file: ProjectFile): Promise<void> {
  const rm = await db.storage.from(STORAGE_BUCKET).remove([file.storage_path])
  if (rm.error) throw rm.error
  unwrap(await db.from('project_files').delete().eq('id', file.id).select('id'))
}
