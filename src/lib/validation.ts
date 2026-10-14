import type { CompanyInput, ContactInput, ProjectInput } from '@/data/types'
import { isCategory, isPriority, isStage } from './domain'

/**
 * Form doğrulamaları. Kurallar veritabanı CHECK kısıtlarıyla aynıdır; istemci
 * tarafı yalnızca hızlı geri bildirim içindir, asıl güvence veritabanındadır.
 */
export type FieldErrors<T> = Partial<Record<keyof T, string>>

export interface ValidationResult<T> {
  ok: boolean
  value: T
  errors: FieldErrors<T>
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PHONE_RE = /^[+0-9 ()\-./]{7,40}$/
const TAX_RE = /^[0-9]{10,11}$/
export const PROJECT_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,39}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Boşlukları kırpar; boş metni null yapar. */
export function clean(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}

function checkLength(errors: Record<string, string>, key: string, v: string | null, max: number, label: string) {
  if (v && v.length > max) errors[key] = `${label} en fazla ${max} karakter olabilir.`
}

function isValidDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

export function validateCompany(input: Partial<Record<keyof CompanyInput, string | null>>): ValidationResult<CompanyInput> {
  const value: CompanyInput = {
    name: clean(input.name) ?? '',
    phone: clean(input.phone),
    email: clean(input.email)?.toLowerCase() ?? null,
    address: clean(input.address),
    city: clean(input.city),
    tax_office: clean(input.tax_office),
    tax_number: clean(input.tax_number)?.replace(/\s/g, '') ?? null,
    notes: clean(input.notes),
  }
  const errors: Record<string, string> = {}
  if (!value.name) errors.name = 'Firma adı zorunludur.'
  checkLength(errors, 'name', value.name, 200, 'Firma adı')
  if (value.phone && !PHONE_RE.test(value.phone)) errors.phone = 'Geçerli bir telefon numarası girin.'
  if (value.email && (!EMAIL_RE.test(value.email) || value.email.length > 254)) errors.email = 'Geçerli bir e-posta adresi girin.'
  checkLength(errors, 'address', value.address, 500, 'Adres')
  checkLength(errors, 'city', value.city, 100, 'Şehir')
  checkLength(errors, 'tax_office', value.tax_office, 120, 'Vergi dairesi')
  if (value.tax_number && !TAX_RE.test(value.tax_number)) errors.tax_number = 'Vergi / T.C. kimlik numarası 10 veya 11 rakam olmalıdır.'
  checkLength(errors, 'notes', value.notes, 5000, 'Notlar')
  return { ok: Object.keys(errors).length === 0, value, errors: errors as FieldErrors<CompanyInput> }
}

export function validateContact(
  input: Partial<Record<keyof ContactInput, string | boolean | null>>,
): ValidationResult<ContactInput> {
  const str = (k: keyof ContactInput) => clean(typeof input[k] === 'string' ? (input[k] as string) : null)
  const value: ContactInput = {
    company_id: str('company_id') ?? '',
    full_name: str('full_name') ?? '',
    title: str('title'),
    phone: str('phone'),
    email: str('email')?.toLowerCase() ?? null,
    is_primary: input.is_primary === true,
    notes: str('notes'),
  }
  const errors: Record<string, string> = {}
  if (!value.company_id) errors.company_id = 'Firma seçilmelidir.'
  if (!value.full_name) errors.full_name = 'Ad soyad zorunludur.'
  checkLength(errors, 'full_name', value.full_name, 160, 'Ad soyad')
  checkLength(errors, 'title', value.title, 120, 'Görev')
  if (value.phone && !PHONE_RE.test(value.phone)) errors.phone = 'Geçerli bir telefon numarası girin.'
  if (value.email && !EMAIL_RE.test(value.email)) errors.email = 'Geçerli bir e-posta adresi girin.'
  checkLength(errors, 'notes', value.notes, 2000, 'Notlar')
  return { ok: Object.keys(errors).length === 0, value, errors: errors as FieldErrors<ContactInput> }
}

export function validateProject(input: Partial<Record<keyof ProjectInput, string | null>>): ValidationResult<ProjectInput> {
  const code = clean(input.code)?.toUpperCase() ?? ''
  const category = clean(input.category) ?? ''
  const stage = clean(input.stage) ?? 'yeni_firsat'
  const priority = clean(input.priority) ?? 'normal'
  const progressRaw = clean(input.progress)
  const progress = progressRaw == null ? 0 : Number(progressRaw)
  const value = {
    code,
    name: clean(input.name) ?? '',
    company_id: clean(input.company_id),
    category,
    stage,
    progress: Number.isFinite(progress) ? Math.round(progress) : 0,
    on_hold: input.on_hold === 'true',
    priority,
    description: clean(input.description),
    start_date: clean(input.start_date),
    due_date: clean(input.due_date),
    completed_on: clean(input.completed_on),
    location: clean(input.location),
    address: clean(input.address),
    map_url: clean(input.map_url),
    notes: clean(input.notes),
  } as ProjectInput
  const errors: Record<string, string> = {}
  if (!code) errors.code = 'Proje kodu zorunludur.'
  else if (!PROJECT_CODE_RE.test(code)) errors.code = 'Kod 2–40 karakter olmalı; harf, rakam ve . _ / - içerebilir.'
  if (!value.name) errors.name = 'Proje adı zorunludur.'
  checkLength(errors, 'name', value.name, 200, 'Proje adı')
  if (!category) errors.category = 'İş kategorisi seçin.'
  else if (!isCategory(category)) errors.category = 'Geçersiz kategori.'
  if (!isStage(stage)) errors.stage = 'Geçersiz aşama.'
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) errors.progress = 'İlerleme 0–100 arasında olmalı.'
  if (value.completed_on && !isValidDate(value.completed_on)) errors.completed_on = 'Geçerli bir tarih girin.'
  else if (value.completed_on && value.start_date && value.completed_on < value.start_date) errors.completed_on = 'Bitiş tarihi başlangıçtan önce olamaz.'
  if (value.map_url && !/^https:\/\/\S+$/i.test(value.map_url)) errors.map_url = 'Harita bağlantısı https:// ile başlamalı.'
  checkLength(errors, 'map_url', value.map_url, 500, 'Harita bağlantısı')
  checkLength(errors, 'address', value.address, 500, 'Adres')
  if (!isPriority(priority)) errors.priority = 'Geçersiz öncelik.'
  if (value.start_date && !isValidDate(value.start_date)) errors.start_date = 'Geçerli bir tarih girin.'
  if (value.due_date && !isValidDate(value.due_date)) errors.due_date = 'Geçerli bir tarih girin.'
  if (value.start_date && value.due_date && !errors.start_date && !errors.due_date && value.due_date < value.start_date) {
    errors.due_date = 'Teslim tarihi başlangıç tarihinden önce olamaz.'
  }
  checkLength(errors, 'description', value.description, 5000, 'Açıklama')
  checkLength(errors, 'location', value.location, 300, 'Konum')
  checkLength(errors, 'notes', value.notes, 5000, 'Notlar')
  return { ok: Object.keys(errors).length === 0, value, errors: errors as FieldErrors<ProjectInput> }
}

export function validateNote(body: string): { ok: boolean; value: string; error?: string } {
  const value = body.trim()
  if (!value) return { ok: false, value, error: 'Not boş olamaz.' }
  if (value.length > 5000) return { ok: false, value, error: 'Not en fazla 5000 karakter olabilir.' }
  return { ok: true, value }
}
