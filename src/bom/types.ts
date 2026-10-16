/**
 * Malzeme reçetesi (BOM) veri modeli — supabase/migrations/20261016001400_leonx_bom.sql ile birebir uyumlu.
 * Uzunluklar mm, alanlar m², kesimli profil miktarı toplam METRE olarak tutulur.
 */
import type { QuantityCategory } from '@/quantity/types'
import type { Currency } from '@/quote/types'

export const SYSTEM_TYPES = [
  { value: 'al_pencere', label: 'Alüminyum pencere' },
  { value: 'al_kapi', label: 'Alüminyum kapı' },
  { value: 'pvc_pencere', label: 'PVC pencere' },
  { value: 'pvc_kapi', label: 'PVC kapı' },
  { value: 'surme', label: 'Sürme sistem' },
  { value: 'cephe', label: 'Cephe' },
  { value: 'korkuluk', label: 'Korkuluk' },
  { value: 'metal_imalat', label: 'Metal imalat' },
  { value: 'diger', label: 'Diğer' },
] as const
export type SystemType = (typeof SYSTEM_TYPES)[number]['value']
export const SYSTEM_TYPE_LABEL = Object.fromEntries(SYSTEM_TYPES.map((t) => [t.value, t.label])) as Record<SystemType, string>

/** Metraj iş grubu → önerilen sistem tipi (toplu atamada sistemleri sıralamak için; atama kullanıcınındır) */
export const CATEGORY_SYSTEM_TYPE: Record<QuantityCategory, SystemType> = {
  al_pencere: 'al_pencere',
  al_kapi: 'al_kapi',
  pvc_pencere: 'pvc_pencere',
  pvc_kapi: 'pvc_kapi',
  surme: 'surme',
  sabit_cam: 'diger',
  cephe_dograma: 'cephe',
  fotoselli_kapi: 'al_kapi',
  korkuluk: 'korkuluk',
  kompozit_cephe: 'cephe',
  metal_imalat: 'metal_imalat',
  belirsiz: 'diger',
}

export const COMPONENT_ROLES = [
  { value: 'kasa', label: 'Kasa' },
  { value: 'kanat', label: 'Kanat' },
  { value: 'kayit', label: 'Kayıt' },
  { value: 'orta_kayit', label: 'Orta kayıt' },
  { value: 'pervaz', label: 'Pervaz' },
  { value: 'cam', label: 'Cam' },
  { value: 'fitil', label: 'Fitil / conta' },
  { value: 'mentese', label: 'Menteşe' },
  { value: 'kol', label: 'Kol' },
  { value: 'kilit', label: 'Kilit' },
  { value: 'baglanti', label: 'Bağlantı elemanı' },
  { value: 'montaj', label: 'Montaj malzemesi' },
  { value: 'aksesuar', label: 'Aksesuar' },
  { value: 'diger', label: 'Diğer' },
] as const
export type ComponentRole = (typeof COMPONENT_ROLES)[number]['value']
export const ROLE_LABEL = Object.fromEntries(COMPONENT_ROLES.map((r) => [r.value, r.label])) as Record<ComponentRole, string>
export const ROLE_ORDER = Object.fromEntries(COMPONENT_ROLES.map((r, i) => [r.value, i])) as Record<ComponentRole, number>

export const COMPONENT_UNITS = [
  { value: 'mm_profil', label: 'Profil kesimi (mm)', short: 'm' },
  { value: 'm', label: 'Metre', short: 'm' },
  { value: 'm2', label: 'Metrekare', short: 'm²' },
  { value: 'adet', label: 'Adet', short: 'adet' },
  { value: 'kg', label: 'Kilogram', short: 'kg' },
  { value: 'takim', label: 'Takım', short: 'takım' },
] as const
export type ComponentUnit = (typeof COMPONENT_UNITS)[number]['value']
export const UNIT_INFO = Object.fromEntries(COMPONENT_UNITS.map((u) => [u.value, u])) as Record<ComponentUnit, (typeof COMPONENT_UNITS)[number]>

export type RuleBasis = 'birim' | 'poz'
export const BASIS_LABEL: Record<RuleBasis, string> = {
  birim: 'Tek ürün için (sonuç N ile çarpılır)',
  poz: 'Pozun toplamı (N formülde kullanılır)',
}

export type BomStatus = 'taslak' | 'onayli' | 'iptal'
export const BOM_STATUS_LABEL: Record<BomStatus, string> = { taslak: 'Taslak', onayli: 'Onaylı', iptal: 'İptal' }

interface Versioned {
  id: string
  created_by: string | null
  created_at: string
  updated_at: string
  version: number
}

export interface ProductSystem extends Versioned {
  name: string
  manufacturer: string | null
  series: string | null
  system_type: SystemType
  color: string | null
  notes: string | null
  active: boolean
}
export type ProductSystemInput = Pick<ProductSystem, 'name' | 'manufacturer' | 'series' | 'system_type' | 'color' | 'notes' | 'active'>

export interface SystemComponent extends Versioned {
  system_id: string
  role: ComponentRole
  code: string | null
  name: string
  unit: ComponentUnit
  standard_length_mm: number | null
  waste_pct: number
  weight_kg_per_m: number | null
  cost_rate_id: string | null
  sort_order: number
  notes: string | null
}
export type SystemComponentInput = Pick<
  SystemComponent,
  'role' | 'code' | 'name' | 'unit' | 'standard_length_mm' | 'waste_pct' | 'weight_kg_per_m' | 'cost_rate_id' | 'sort_order' | 'notes'
>

export interface SystemRule extends Versioned {
  component_id: string
  applies_to: string | null
  basis: RuleBasis
  quantity_formula: string | null
  cut_length_formula: string | null
  pieces_formula: string | null
  angle: string | null
  notes: string | null
  sort_order: number
}
export type SystemRuleInput = Pick<SystemRule, 'applies_to' | 'basis' | 'quantity_formula' | 'cut_length_formula' | 'pieces_formula' | 'angle' | 'notes' | 'sort_order'>

export interface BomWarningRow {
  level: 'hata' | 'uyari' | 'bilgi'
  code: string
  message: string
  poz?: string | null
  component?: string | null
}

export interface BomVersion extends Versioned {
  project_id: string
  takeoff_id: string | null
  takeoff_revision: number
  takeoff_name: string
  takeoff_status: 'taslak' | 'onaylandi' | 'arsiv'
  revision: number
  status: BomStatus
  source_approved: boolean
  error_count: number
  warning_count: number
  warnings: BomWarningRow[]
  engine_version: string
  based_on: string | null
  notes: string | null
  approved_by: string | null
  approved_at: string | null
}

export interface BomAssignment {
  id: string
  bom_version_id: string
  quantity_item_id: string | null
  poz_code: string
  category: string
  width_mm: number | null
  height_mm: number | null
  quantity: number
  verification: 'bekliyor' | 'onaylandi' | 'reddedildi'
  kanat: number | null
  opening: string | null
  system_id: string | null
  system_name: string | null
  sort_order: number
}

export interface BomLine {
  id: string
  bom_version_id: string
  assignment_id: string | null
  component_id: string | null
  rule_id: string | null
  line_key: string
  poz_code: string | null
  role: ComponentRole
  code: string | null
  name: string
  unit: ComponentUnit
  cut_length_mm: number | null
  angle: string | null
  pieces: number | null
  total_length_mm: number | null
  net_quantity: number
  waste_pct: number
  waste_qty: number
  quantity: number
  standard_length_mm: number | null
  weight_kg: number | null
  cost_rate_id: string | null
  unit_cost: number | null
  currency: Currency | null
  cost_unit: string | null
  line_cost: number | null
  sort_order: number
}

/** Yapı şablonu: yalnız satır türleri; kod, ölçü, düşüm, ağırlık ve fiyat BOŞ (üretici kataloğundan girilir) */
export const STRUCTURE_TEMPLATE: { role: ComponentRole; name: string; unit: ComponentUnit }[] = [
  { role: 'kasa', name: 'Kasa profili', unit: 'mm_profil' },
  { role: 'kanat', name: 'Kanat profili', unit: 'mm_profil' },
  { role: 'kayit', name: 'Kayıt profili', unit: 'mm_profil' },
  { role: 'cam', name: 'Cam', unit: 'm2' },
  { role: 'fitil', name: 'Fitil / conta', unit: 'm' },
  { role: 'aksesuar', name: 'Aksesuar takımı', unit: 'takim' },
]
