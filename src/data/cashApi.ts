import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DOCUMENT_BUCKET,
  type DocumentTable,
  documentMime,
  type FinanceAccount,
  type FinanceAccountInput,
  type FinanceAuditRow,
  type FinanceCategory,
  type FinanceCategoryInput,
  type FinanceDocument,
  type FinanceEntry,
  type FinanceEntryInput,
  type FinanceRecurring,
  type FinanceRecurringInput,
  type FinanceTransfer,
  type FinanceTransferInput,
} from '@/finance/cash'
import type { ProjectFinanceData } from '@/finance/types'
import { safeObjectName } from '@/lib/files'
import { runBusy } from '@/lib/unsaved'
import { fetchAllPages, insertOnce, versionedUpdate } from './api'
import { listAllFinance } from './financeApi'

/**
 * Kasa, banka ve manuel gelir-gider veri erişimi. Kurallar (hesap/kayıt para birimi, kategori türü,
 * silme yerine iptal, virman tutarları, değişiklik geçmişi) veritabanında uygulanır
 * (supabase/migrations/20261016001300_leonx_cash.sql); istemciye güvenilmez.
 * Projeye bağlı gelir/gider mevcut project_collections / project_expenses tablolarına yazılır
 * (src/data/financeApi.ts); burada yalnız genel kayıtlar tutulur.
 */

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error
  return res.data as T
}

// ------------------------------------------------------------------ Hesaplar
export function listAccounts(db: SupabaseClient): Promise<FinanceAccount[]> {
  return fetchAllPages<FinanceAccount>((from, to) => db.from('finance_accounts').select('*').order('sort_order').order('name').order('id').range(from, to))
}
export function createAccount(db: SupabaseClient, input: FinanceAccountInput & { id?: string }): Promise<FinanceAccount> {
  return insertOnce<FinanceAccount>(db, 'finance_accounts', input)
}
export function updateAccount(db: SupabaseClient, a: Pick<FinanceAccount, 'id' | 'version'>, patch: Partial<FinanceAccountInput>): Promise<FinanceAccount> {
  return versionedUpdate<FinanceAccount>(db, 'finance_accounts', a.id, a.version, patch)
}
/** Yalnız hareketi olmayan hesap silinebilir (veritabanı engeller: hareketli hesap pasifleştirilir) */
export async function deleteAccount(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('finance_accounts').delete().eq('id', id).select('id'))
}

/** finance_account_balances görünümü: sunucuda hesaplanan bakiye (TEK tanım: finance_ledger) */
export interface AccountBalanceRow {
  account_id: string
  name: string
  kind: FinanceAccount['kind']
  currency: FinanceAccount['currency']
  active: boolean
  opening_balance: number
  total_in: number
  total_out: number
  balance: number
  movement_count: number
  last_movement_date: string | null
}
export function listAccountBalances(db: SupabaseClient): Promise<AccountBalanceRow[]> {
  return fetchAllPages<AccountBalanceRow>((from, to) => db.from('finance_account_balances').select('*').order('name').order('account_id').range(from, to))
}

// ------------------------------------------------------------------ Kategoriler
export function listCategories(db: SupabaseClient): Promise<FinanceCategory[]> {
  return fetchAllPages<FinanceCategory>((from, to) => db.from('finance_categories').select('*').order('kind').order('sort_order').order('name').order('id').range(from, to))
}
export function createCategory(db: SupabaseClient, input: FinanceCategoryInput & { id?: string }): Promise<FinanceCategory> {
  return insertOnce<FinanceCategory>(db, 'finance_categories', input)
}
export function updateCategory(db: SupabaseClient, c: Pick<FinanceCategory, 'id' | 'version'>, patch: Partial<FinanceCategoryInput>): Promise<FinanceCategory> {
  return versionedUpdate<FinanceCategory>(db, 'finance_categories', c.id, c.version, patch)
}
export async function deleteCategory(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('finance_categories').delete().eq('id', id).select('id'))
}

// ------------------------------------------------------------------ Genel gelir / gider
export function listEntries(db: SupabaseClient): Promise<FinanceEntry[]> {
  return fetchAllPages<FinanceEntry>((from, to) => db.from('finance_entries').select('*').order('entry_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(from, to))
}
export function createEntry(db: SupabaseClient, input: FinanceEntryInput & { id?: string }): Promise<FinanceEntry> {
  return insertOnce<FinanceEntry>(db, 'finance_entries', input)
}
export function updateEntry(db: SupabaseClient, e: Pick<FinanceEntry, 'id' | 'version'>, patch: Partial<FinanceEntryInput>): Promise<FinanceEntry> {
  return versionedUpdate<FinanceEntry>(db, 'finance_entries', e.id, e.version, patch)
}
/** "Silme" = iptal: sebep zorunlu; zaman ve kullanıcı sunucuda yazılır. Kayıt saklanır, toplamlara girmez. */
export function voidEntry(db: SupabaseClient, e: Pick<FinanceEntry, 'id' | 'version'>, reason: string): Promise<FinanceEntry> {
  return versionedUpdate<FinanceEntry>(db, 'finance_entries', e.id, e.version, { voided_at: new Date().toISOString(), voided_reason: reason.trim().slice(0, 500) })
}

// ------------------------------------------------------------------ Virman
export function listTransfers(db: SupabaseClient): Promise<FinanceTransfer[]> {
  return fetchAllPages<FinanceTransfer>((from, to) => db.from('finance_transfers').select('*').order('transfer_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(from, to))
}
export function createTransfer(db: SupabaseClient, input: FinanceTransferInput & { id?: string }): Promise<FinanceTransfer> {
  return insertOnce<FinanceTransfer>(db, 'finance_transfers', input)
}
export function voidTransfer(db: SupabaseClient, t: Pick<FinanceTransfer, 'id' | 'version'>, reason: string): Promise<FinanceTransfer> {
  return versionedUpdate<FinanceTransfer>(db, 'finance_transfers', t.id, t.version, { voided_at: new Date().toISOString(), voided_reason: reason.trim().slice(0, 500) })
}

// ------------------------------------------------------------------ Düzenli şablonlar
export function listRecurring(db: SupabaseClient): Promise<FinanceRecurring[]> {
  return fetchAllPages<FinanceRecurring>((from, to) => db.from('finance_recurring').select('*').order('next_date').order('id').range(from, to))
}
export function createRecurring(db: SupabaseClient, input: FinanceRecurringInput & { id?: string }): Promise<FinanceRecurring> {
  return insertOnce<FinanceRecurring>(db, 'finance_recurring', input)
}
export function updateRecurring(db: SupabaseClient, r: Pick<FinanceRecurring, 'id' | 'version'>, patch: Partial<FinanceRecurringInput>): Promise<FinanceRecurring> {
  return versionedUpdate<FinanceRecurring>(db, 'finance_recurring', r.id, r.version, patch)
}
export async function deleteRecurring(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('finance_recurring').delete().eq('id', id).select('id'))
}
/** Vadesi gelen düzenli kayıtları "bekliyor" olarak üretir (tekrar çağrı çift kayıt üretmez). Oluşan kayıt sayısı. */
export async function generateRecurring(db: SupabaseClient): Promise<number> {
  const res = await db.rpc('leonx_finance_generate_recurring', { p_until: null })
  if (res.error) throw res.error
  return Number(res.data ?? 0)
}

// ------------------------------------------------------------------ Değişiklik geçmişi
export function listAudit(db: SupabaseClient, table: string, rowId: string): Promise<FinanceAuditRow[]> {
  return fetchAllPages<FinanceAuditRow>((from, to) => db.from('finance_audit_log').select('*').eq('table_name', table).eq('row_id', rowId).order('id').range(from, to))
}

// ------------------------------------------------------------------ Belge ekleri
export function listDocuments(db: SupabaseClient, table: DocumentTable, entryId: string): Promise<FinanceDocument[]> {
  return fetchAllPages<FinanceDocument>((from, to) => db.from('finance_documents').select('*').eq('entry_table', table).eq('entry_id', entryId).order('created_at').order('id').range(from, to))
}
/** Belgeyi özel depoya yükler ve kaydeder; kayıt başarısız olursa yüklenen dosya geri silinir */
export function uploadDocument(db: SupabaseClient, table: DocumentTable, entryId: string, file: File): Promise<FinanceDocument> {
  return runBusy(`${file.name} yükleniyor`, async () => {
    const mime = documentMime(file.name, file.type)
    if (!mime) throw new Error('Yalnız PDF, JPEG, PNG, WEBP veya HEIC belge eklenebilir.')
    const path = `${table}/${entryId}/${crypto.randomUUID()}-${safeObjectName(file.name)}`
    const up = await db.storage.from(DOCUMENT_BUCKET).upload(path, file, { contentType: mime, upsert: false, cacheControl: '3600' })
    if (up.error) throw up.error
    try {
      return await insertOnce<FinanceDocument>(db, 'finance_documents', { entry_table: table, entry_id: entryId, storage_path: path, file_name: file.name.slice(0, 255), mime_type: mime, size_bytes: file.size })
    } catch (e) {
      await db.storage.from(DOCUMENT_BUCKET).remove([path])
      throw e
    }
  })
}
export async function downloadDocument(db: SupabaseClient, doc: FinanceDocument): Promise<Blob> {
  const res = await db.storage.from(DOCUMENT_BUCKET).download(doc.storage_path)
  if (res.error) throw res.error
  return res.data
}
export async function deleteDocument(db: SupabaseClient, doc: FinanceDocument): Promise<void> {
  const rm = await db.storage.from(DOCUMENT_BUCKET).remove([doc.storage_path])
  if (rm.error) throw rm.error
  unwrap(await db.from('finance_documents').delete().eq('id', doc.id).select('id'))
}

// ------------------------------------------------------------------ Toplu okuma (kasa/banka ekranları)
export interface CashData {
  accounts: FinanceAccount[]
  categories: FinanceCategory[]
  entries: FinanceEntry[]
  transfers: FinanceTransfer[]
  recurring: FinanceRecurring[]
  /** Proje finansı (gider, tahsilat, ödeme planı) — proje kimliğine göre */
  projects: Map<string, ProjectFinanceData>
}
export const EMPTY_CASH: CashData = { accounts: [], categories: [], entries: [], transfers: [], recurring: [], projects: new Map() }

export async function loadCashData(db: SupabaseClient): Promise<CashData> {
  const [accounts, categories, entries, transfers, recurring, projects] = await Promise.all([
    listAccounts(db),
    listCategories(db),
    listEntries(db),
    listTransfers(db),
    listRecurring(db),
    listAllFinance(db),
  ])
  return { accounts, categories, entries, transfers, recurring, projects }
}

/** Canlı güncellenen tablolar (Realtime) */
export const CASH_TABLES = [
  'finance_accounts',
  'finance_categories',
  'finance_entries',
  'finance_transfers',
  'finance_recurring',
  'project_budgets',
  'project_cost_lines',
  'project_expenses',
  'project_payment_schedule',
  'project_collections',
] as const
