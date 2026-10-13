/** Teklif veri tipleri — veritabanı satırlarıyla birebir (supabase/migrations/20261013000600_leonx_quotes.sql) */

export const QUOTE_STATUSES = [
  { value: 'taslak', label: 'Taslak', tone: 'muted' },
  { value: 'gonderildi', label: 'Gönderildi', tone: 'info' },
  { value: 'gorusmede', label: 'Görüşmede', tone: 'warn' },
  { value: 'kabul', label: 'Kabul edildi', tone: 'ok' },
  { value: 'red', label: 'Reddedildi', tone: 'danger' },
] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]['value']
export const QUOTE_STATUS_LABEL = Object.fromEntries(QUOTE_STATUSES.map((s) => [s.value, s.label])) as Record<QuoteStatus, string>

export const CURRENCIES = [
  { value: 'TRY', label: 'Türk lirası (₺)' },
  { value: 'EUR', label: 'Euro (€)' },
  { value: 'USD', label: 'ABD doları ($)' },
] as const
export type Currency = (typeof CURRENCIES)[number]['value']

export const QUOTE_UNITS = [
  { value: 'm2', label: 'm²', measured: 'alan' },
  { value: 'mtul', label: 'mtül', measured: 'uzunluk' },
  { value: 'm', label: 'm', measured: 'uzunluk' },
  { value: 'adet', label: 'adet', measured: null },
  { value: 'takim', label: 'takım', measured: null },
  { value: 'kg', label: 'kg', measured: null },
  { value: 'goturu', label: 'götürü', measured: null },
] as const
export type QuoteUnit = (typeof QUOTE_UNITS)[number]['value']
export const QUOTE_UNIT_LABEL = Object.fromEntries(QUOTE_UNITS.map((u) => [u.value, u.label])) as Record<QuoteUnit, string>

export const DIM_UNITS = ['mm', 'cm', 'm'] as const
export type DimUnit = (typeof DIM_UNITS)[number]

export type PricingMode = 'detayli' | 'toplam'
export type DiscountKind = 'yok' | 'yuzde' | 'tutar'

export interface Quote {
  id: string
  root_id: string
  quote_no: string
  revision: number
  superseded: boolean
  company_id: string
  contact_id: string | null
  project_id: string | null
  title: string
  scope: string | null
  status: QuoteStatus
  quote_date: string
  valid_until: string | null
  currency: Currency
  pricing_mode: PricingMode
  lump_sum: number | null
  lump_cost: number | null
  waste_pct: number
  overhead_pct: number
  profit_pct: number
  shipping_amount: number
  other_amount: number
  other_label: string | null
  discount_kind: DiscountKind
  discount_value: number
  vat_pct: number
  hide_unit_prices: boolean
  payment_terms: string | null
  delivery_terms: string | null
  notes: string | null
  internal_notes: string | null
  sent_at: string | null
  decided_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  version: number
}

/** İstemcinin yazabildiği teklif alanları */
export type QuoteInput = Pick<
  Quote,
  | 'company_id'
  | 'contact_id'
  | 'project_id'
  | 'title'
  | 'scope'
  | 'quote_date'
  | 'valid_until'
  | 'currency'
  | 'pricing_mode'
  | 'lump_sum'
  | 'lump_cost'
  | 'waste_pct'
  | 'overhead_pct'
  | 'profit_pct'
  | 'shipping_amount'
  | 'other_amount'
  | 'other_label'
  | 'discount_kind'
  | 'discount_value'
  | 'vat_pct'
  | 'hide_unit_prices'
  | 'payment_terms'
  | 'delivery_terms'
  | 'notes'
  | 'internal_notes'
>

export interface QuoteItem {
  id: string
  quote_id: string
  sort_order: number
  poz_code: string | null
  description: string
  system_type: string | null
  width_mm: number | null
  height_mm: number | null
  dim_unit: DimUnit
  quantity: number
  unit: QuoteUnit
  manual_measure: number | null
  material_cost: number
  labor_cost: number
  install_cost: number
  other_cost: number
  unit_price: number | null
  notes: string | null
  source: 'elle' | 'metraj'
  source_item_id: string | null
  source_takeoff_id: string | null
  source_label: string | null
  measure_verified: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  version: number
}

export type QuoteItemInput = Omit<QuoteItem, 'id' | 'quote_id' | 'created_by' | 'created_at' | 'updated_at' | 'version'>

export interface QuoteHistoryEntry {
  id: number
  quote_id: string
  root_id: string
  action: 'olustur' | 'durum' | 'revizyon' | 'kopya'
  from_status: QuoteStatus | null
  to_status: QuoteStatus | null
  note: string | null
  changed_by: string | null
  changed_at: string
}

export interface QuoteSettings {
  id: 1
  legal_name: string | null
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  tax_office: string | null
  tax_number: string | null
  bank_name: string | null
  iban: string | null
  quote_prefix: string
  default_validity_days: number
  default_vat_pct: number
  default_currency: Currency
  default_payment_terms: string | null
  default_delivery_terms: string | null
  closing_text: string | null
  version: number
}

export type QuoteSettingsInput = Omit<QuoteSettings, 'id' | 'version'>

/** Ayarlar henüz kaydedilmemişse kullanılan varsayılanlar (veritabanı varsayılanlarıyla aynı) */
export const DEFAULT_QUOTE_SETTINGS: QuoteSettingsInput = {
  legal_name: null,
  address: null,
  phone: null,
  email: null,
  website: null,
  tax_office: null,
  tax_number: null,
  bank_name: null,
  iban: null,
  quote_prefix: 'TKL',
  default_validity_days: 15,
  default_vat_pct: 20,
  default_currency: 'TRY',
  default_payment_terms: null,
  default_delivery_terms: null,
  closing_text: null,
}

/** Teklif düzenlenebilir mi? Yalnız güncel taslak revizyon (veritabanı kuralıyla aynı) */
export const isEditable = (q: Pick<Quote, 'status' | 'superseded'>): boolean => q.status === 'taslak' && !q.superseded
