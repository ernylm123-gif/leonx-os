/**
 * Finans veri tipleri — supabase/migrations/20261015001100_leonx_finance.sql ile birebir.
 * Tutarlar veritabanında numeric(14,2), yüzdeler numeric(7,3), kurlar numeric(18,6);
 * hesaplar src/quote/money.ts ile tamsayı kuruş üzerinden yapılır.
 */
import type { Currency } from '@/quote/types'

export const COST_GROUPS = [
  { value: 'profil', label: 'Profil', material: true },
  { value: 'pvc_sistem', label: 'PVC sistem', material: true },
  { value: 'cam', label: 'Cam', material: true },
  { value: 'aksesuar', label: 'Aksesuar', material: true },
  { value: 'iscilik', label: 'İşçilik', material: false },
  { value: 'uretim', label: 'Üretim', material: false },
  { value: 'montaj', label: 'Montaj', material: false },
  { value: 'nakliye', label: 'Nakliye', material: false },
  { value: 'taseron', label: 'Taşeron', material: false },
  { value: 'fire', label: 'Fire', material: false },
  { value: 'genel_gider', label: 'Genel gider', material: false },
  { value: 'diger', label: 'Diğer', material: false },
] as const
export type CostGroup = (typeof COST_GROUPS)[number]['value']
export const COST_GROUP_LABEL = Object.fromEntries(COST_GROUPS.map((g) => [g.value, g.label])) as Record<CostGroup, string>
/** Fire oranının uygulandığı malzeme grupları (veritabanındaki bütçe kontrolüyle aynı) */
export const MATERIAL_GROUPS: readonly CostGroup[] = COST_GROUPS.filter((g) => g.material).map((g) => g.value)

export const FIN_UNITS = [
  { value: 'm2', label: 'm²' },
  { value: 'mtul', label: 'mtül' },
  { value: 'm', label: 'm' },
  { value: 'adet', label: 'adet' },
  { value: 'kg', label: 'kg' },
  { value: 'saat', label: 'saat' },
  { value: 'goturu', label: 'götürü' },
] as const
export type FinUnit = (typeof FIN_UNITS)[number]['value']
export const FIN_UNIT_LABEL = Object.fromEntries(FIN_UNITS.map((u) => [u.value, u.label])) as Record<FinUnit, string>

export const PAYMENT_METHODS = [
  { value: 'havale', label: 'Havale / EFT' },
  { value: 'nakit', label: 'Nakit' },
  { value: 'cek', label: 'Çek' },
  { value: 'senet', label: 'Senet' },
  { value: 'kredi_karti', label: 'Kredi kartı' },
  { value: 'diger', label: 'Diğer' },
] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]['value']
export const PAYMENT_METHOD_LABEL = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, m.label])) as Record<PaymentMethod, string>

export const SCHEDULE_KINDS = [
  { value: 'pesinat', label: 'Peşinat' },
  { value: 'ara_odeme', label: 'Ara ödeme' },
  { value: 'son_odeme', label: 'Son ödeme' },
  { value: 'taksit', label: 'Taksit' },
] as const
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number]['value']
export const SCHEDULE_KIND_LABEL = Object.fromEntries(SCHEDULE_KINDS.map((k) => [k.value, k.label])) as Record<ScheduleKind, string>

export type MeasureBasis = 'alan' | 'cam_alani' | 'cevre' | 'uzunluk' | 'adet' | 'kg'
export const MEASURE_BASIS_LABEL: Record<MeasureBasis, string> = {
  alan: 'doğrama alanı',
  cam_alani: 'cam alanı',
  cevre: 'çevre bazlı tahmini',
  uzunluk: 'uzunluk',
  adet: 'adet',
  kg: 'ağırlık',
}

export type CostSource = 'elle' | 'metraj' | 'oran'

interface Versioned {
  id: string
  created_by: string | null
  created_at: string
  updated_at: string
  version: number
}

export interface CostRate extends Versioned {
  code: string
  name: string
  cost_group: CostGroup
  unit: FinUnit
  currency: Currency
  unit_cost: number
  quantity_category: string | null
  valid_from: string
  active: boolean
  notes: string | null
}
export type CostRateInput = Pick<CostRate, 'code' | 'name' | 'cost_group' | 'unit' | 'currency' | 'unit_cost' | 'quantity_category' | 'valid_from' | 'active' | 'notes'>

export interface FxRate extends Versioned {
  rate_date: string
  from_currency: Currency
  to_currency: Currency
  rate: number
  project_id: string | null
  source: string
}
export type FxRateInput = Pick<FxRate, 'rate_date' | 'from_currency' | 'to_currency' | 'rate' | 'project_id' | 'source'>

export interface ProjectBudget extends Versioned {
  project_id: string
  currency: Currency
  sale_net_amount: number | null
  vat_pct: number
  source_quote_id: string | null
  quote_snapshot_net: number | null
  quote_snapshot_currency: Currency | null
  quote_snapshot_vat_pct: number | null
  quote_snapshot_label: string | null
  quote_snapshot_at: string | null
  waste_pct: number
  overhead_pct: number
  notes: string | null
}
export type ProjectBudgetInput = Omit<ProjectBudget, keyof Versioned>

export interface CostLine extends Versioned {
  project_id: string
  sort_order: number
  cost_group: CostGroup
  description: string
  quantity: number
  unit: FinUnit
  /** null: "fiyat tanımlanmamış" — toplamlara katılmaz */
  unit_cost: number | null
  currency: Currency
  source: CostSource
  source_takeoff_id: string | null
  source_item_id: string | null
  cost_rate_id: string | null
  measure_basis: MeasureBasis | null
  notes: string | null
}
export type CostLineInput = Omit<CostLine, keyof Versioned>

export interface Expense extends Versioned {
  project_id: string
  expense_date: string
  cost_group: CostGroup
  description: string
  supplier: string | null
  /** KDV hariç */
  amount: number
  vat_amount: number
  currency: Currency
  fx_rate_to_base: number | null
  fx_to_currency: Currency | null
  document_no: string | null
  paid: boolean
  notes: string | null
}
export type ExpenseInput = Omit<Expense, keyof Versioned>

export interface PaymentScheduleRow extends Versioned {
  project_id: string
  kind: ScheduleKind
  label: string | null
  due_date: string
  amount: number
  currency: Currency
  sort_order: number
  notes: string | null
}
export type PaymentScheduleInput = Omit<PaymentScheduleRow, keyof Versioned>

export interface Collection extends Versioned {
  project_id: string
  received_date: string
  amount: number
  currency: Currency
  method: PaymentMethod
  schedule_id: string | null
  reference: string | null
  note: string | null
}
export type CollectionInput = Omit<Collection, keyof Versioned>

/** Bir projenin finans verisi (ekran ve panel hesapları için) */
export interface ProjectFinanceData {
  budget: ProjectBudget | null
  lines: CostLine[]
  expenses: Expense[]
  schedule: PaymentScheduleRow[]
  collections: Collection[]
}

/** Bütçe yoksa varsayılan ana para birimi (veritabanındaki bütçe kontrolüyle aynı) */
export const DEFAULT_BASE_CURRENCY: Currency = 'TRY'
