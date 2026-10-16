/**
 * Kasa, banka ve manuel gelir-gider veri tipleri — supabase/migrations/20261016001300_leonx_cash.sql ile birebir.
 * Tutarlar veritabanında numeric(14,2); hesaplar src/quote/money.ts toCents ile tamsayı kuruş üzerinden yapılır.
 *
 * Çift sayım engeli: projeye bağlı gelir project_collections, projeye bağlı gider project_expenses satırıdır;
 * finance_entries yalnız projeye bağlı OLMAYAN genel işletme gelir/giderlerini tutar.
 */
import type { Currency } from '@/quote/types'
import type { PaymentMethod } from './types'

interface Versioned {
  id: string
  created_by: string | null
  created_at: string
  updated_at: string
  version: number
}

export type AccountKind = 'kasa' | 'banka' | 'kredi_karti'
export const ACCOUNT_KINDS: { value: AccountKind; label: string }[] = [
  { value: 'kasa', label: 'Kasa' },
  { value: 'banka', label: 'Banka' },
  { value: 'kredi_karti', label: 'Kredi kartı' },
]
export const ACCOUNT_KIND_LABEL = Object.fromEntries(ACCOUNT_KINDS.map((k) => [k.value, k.label])) as Record<AccountKind, string>

export interface FinanceAccount extends Versioned {
  name: string
  kind: AccountKind
  currency: Currency
  opening_balance: number
  opening_date: string
  bank_name: string | null
  iban: string | null
  notes: string | null
  active: boolean
  sort_order: number
}
export type FinanceAccountInput = Omit<FinanceAccount, keyof Versioned>

export type EntryKind = 'gelir' | 'gider'
export const ENTRY_KIND_LABEL: Record<EntryKind, string> = { gelir: 'Gelir', gider: 'Gider' }

export interface FinanceCategory extends Versioned {
  kind: EntryKind
  key: string | null
  name: string
  is_system: boolean
  active: boolean
  sort_order: number
}
export type FinanceCategoryInput = Pick<FinanceCategory, 'kind' | 'name' | 'active' | 'sort_order'>

export type EntryStatus = 'gerceklesti' | 'bekliyor'
export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = { gerceklesti: 'Gerçekleşti', bekliyor: 'Bekliyor' }

export interface FinanceEntry extends Versioned {
  kind: EntryKind
  entry_date: string
  /** KDV hariç */
  amount: number
  vat_amount: number
  currency: Currency
  category_id: string
  account_id: string | null
  status: EntryStatus
  due_date: string | null
  payment_method: PaymentMethod | null
  company_id: string | null
  description: string
  document_no: string | null
  notes: string | null
  recurring_id: string | null
  occurrence_date: string | null
  voided_at: string | null
  voided_reason: string | null
  voided_by: string | null
}
export type FinanceEntryInput = Omit<FinanceEntry, keyof Versioned | 'recurring_id' | 'occurrence_date' | 'voided_at' | 'voided_reason' | 'voided_by'>

export interface FinanceTransfer extends Versioned {
  transfer_date: string
  from_account_id: string
  to_account_id: string
  from_amount: number
  to_amount: number
  description: string | null
  voided_at: string | null
  voided_reason: string | null
  voided_by: string | null
}
export type FinanceTransferInput = Pick<FinanceTransfer, 'transfer_date' | 'from_account_id' | 'to_account_id' | 'from_amount' | 'to_amount' | 'description'>

export type Frequency = 'haftalik' | 'aylik' | 'uc_aylik' | 'yillik'
export const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'haftalik', label: 'Haftalık' },
  { value: 'aylik', label: 'Aylık' },
  { value: 'uc_aylik', label: 'Üç aylık' },
  { value: 'yillik', label: 'Yıllık' },
]
export const FREQUENCY_LABEL = Object.fromEntries(FREQUENCIES.map((f) => [f.value, f.label])) as Record<Frequency, string>

export interface FinanceRecurring extends Versioned {
  kind: EntryKind
  description: string
  amount: number
  vat_amount: number
  currency: Currency
  category_id: string
  account_id: string | null
  payment_method: PaymentMethod | null
  company_id: string | null
  frequency: Frequency
  start_date: string
  end_date: string | null
  next_date: string
  active: boolean
  notes: string | null
}
export type FinanceRecurringInput = Omit<FinanceRecurring, keyof Versioned | 'next_date'> & { next_date?: string }

export type DocumentTable = 'finance_entries' | 'project_expenses' | 'project_collections'
export interface FinanceDocument {
  id: string
  entry_table: DocumentTable
  entry_id: string
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  created_by: string | null
  created_at: string
}

export type AuditAction = 'insert' | 'update' | 'void' | 'delete'
export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = { insert: 'Oluşturuldu', update: 'Düzenlendi', void: 'İptal edildi', delete: 'Silindi' }
export interface FinanceAuditRow {
  id: number
  table_name: string
  row_id: string | null
  action: AuditAction
  changed_by: string | null
  changed_at: string
  old_row: Record<string, unknown> | null
  new_row: Record<string, unknown> | null
}

/** Belge eki sınırları (veritabanı ve depo ile aynı) */
export const DOCUMENT_BUCKET = 'finance-documents'
export const DOCUMENT_MAX_BYTES = 15 * 1024 * 1024
export const DOCUMENT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
}
/** Dosya adından izinli MIME türü (izinli değilse null) */
export function documentMime(fileName: string, browserType?: string): string | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  const byExt = DOCUMENT_MIME[ext]
  if (byExt) return byExt
  return browserType && Object.values(DOCUMENT_MIME).includes(browserType) ? browserType : null
}
