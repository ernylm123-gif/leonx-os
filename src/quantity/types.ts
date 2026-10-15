/**
 * Metraj veri modeli — supabase/migrations/20261013000100_leonx_quantity.sql ile birebir uyumlu.
 * Tüm uzunluklar milimetre (en fazla 1 ondalık), alanlar m² olarak saklanır.
 */

export const QUANTITY_CATEGORIES = [
  { value: 'al_pencere', label: 'Alüminyum pencere', unit: 'm2', glass: true, family: 'dograma' },
  { value: 'al_kapi', label: 'Alüminyum kapı', unit: 'm2', glass: true, family: 'dograma' },
  { value: 'pvc_pencere', label: 'PVC pencere', unit: 'm2', glass: true, family: 'dograma' },
  { value: 'pvc_kapi', label: 'PVC kapı', unit: 'm2', glass: true, family: 'dograma' },
  { value: 'surme', label: 'Sürme doğrama', unit: 'm2', glass: true, family: 'dograma' },
  { value: 'sabit_cam', label: 'Sabit cam', unit: 'm2', glass: true, family: 'dograma' },
  { value: 'cephe_dograma', label: 'Cephe doğraması', unit: 'm2', glass: true, family: 'dograma' },
  { value: 'fotoselli_kapi', label: 'Fotoselli kapı', unit: 'adet', glass: true, family: 'dograma' },
  { value: 'korkuluk', label: 'Korkuluk', unit: 'mtul', glass: false, family: 'dogrusal' },
  { value: 'kompozit_cephe', label: 'Kompozit cephe', unit: 'm2', glass: false, family: 'kaplama' },
  { value: 'metal_imalat', label: 'Metal imalat', unit: 'serbest', glass: false, family: 'serbest' },
  { value: 'belirsiz', label: 'Sınıflandırılmamış', unit: 'm2', glass: false, family: 'dograma' },
] as const

export type QuantityCategory = (typeof QUANTITY_CATEGORIES)[number]['value']
export const CATEGORY_INFO = Object.fromEntries(QUANTITY_CATEGORIES.map((c) => [c.value, c])) as Record<
  QuantityCategory,
  (typeof QUANTITY_CATEGORIES)[number]
>
export const isQuantityCategory = (v: string): v is QuantityCategory => v in CATEGORY_INFO

export const SHAPES = [
  { value: 'dikdortgen', label: 'Dikdörtgen' },
  { value: 'ucgen', label: 'Üçgen' },
  { value: 'yamuk', label: 'Yamuk (eğik üst)' },
  { value: 'kemerli', label: 'Kemerli' },
  { value: 'daire', label: 'Daire' },
  { value: 'cokgen', label: 'Düzensiz çokgen' },
  { value: 'manuel', label: 'Elle girilen alan' },
] as const
export type ShapeKind = (typeof SHAPES)[number]['value']
export const SHAPE_LABEL = Object.fromEntries(SHAPES.map((s) => [s.value, s.label])) as Record<ShapeKind, string>

export const UNITS = [
  { value: 'm2', label: 'm²' },
  { value: 'mtul', label: 'mtül' },
  { value: 'adet', label: 'adet' },
  { value: 'kg', label: 'kg' },
] as const
export type QuantityUnit = (typeof UNITS)[number]['value']
export const UNIT_LABEL = Object.fromEntries(UNITS.map((u) => [u.value, u.label])) as Record<QuantityUnit, string>

export const VERIFICATION = [
  { value: 'bekliyor', label: 'Doğrulama bekliyor' },
  { value: 'onaylandi', label: 'Onaylandı' },
  { value: 'reddedildi', label: 'Reddedildi' },
] as const
export type Verification = (typeof VERIFICATION)[number]['value']
export const VERIFICATION_LABEL = Object.fromEntries(VERIFICATION.map((v) => [v.value, v.label])) as Record<Verification, string>

export type MeasureBasis = 'dograma' | 'bosluk'
export type GlassMode = 'yok' | 'dusum' | 'manuel'

export interface DrawingRef {
  /** Tespit grubunun anahtarı (aynı adayın iki kez eklenmesini önler) */
  key?: string | null
  analysis_id?: string | null
  file_name?: string | null
  source: 'blok' | 'kapali_cizgi' | 'cizgi_dortgen' | 'cokgen' | 'elle' | 'olcum' | 'etiket' | 'cizelge'
  handles?: string[]
  layer?: string | null
  block?: string | null
  /** Dünya koordinatında sınır kutuları (her örnek için) */
  boxes?: [number, number, number, number][]
  /** PDF: her kutunun sayfa numarası (boxes ile aynı sıra) */
  box_pages?: number[]
}

export interface DetectionInfo {
  confidence: number
  level: 'yuksek' | 'orta' | 'dusuk'
  reasons: string[]
  evidence: string[]
  suggested_category: QuantityCategory
  /** Teknik özellikler ve doğrulama durumları (Faz 5.2: malzeme, sistem, açılım, cam, renk...) */
  attrs?: Record<string, { value: string; status: 'dogrulandi' | 'aday' | 'belirsiz'; source: string }>
  /** Tespit sırasında bulunan çelişkiler (adet/ölçü/açılım) */
  conflicts?: { kind: string; message: string }[]
  /** Kaynak: hangi paftalar, ölçü kaynağı, adet kaynakları */
  provenance?: {
    pages?: number[]
    sheets?: string[]
    dims_from?: string | null
    schedule_qty?: number | null
    plan_qty?: number | null
    floor_multiplier?: number | null
    code_variants?: string[]
    ocr?: boolean
  }
}

/** İstemcinin yazdığı alanlar */
export interface QuantityItemInput {
  poz_code: string
  category: QuantityCategory
  floor: string | null
  space: string | null
  shape: ShapeKind
  width_mm: number | null
  height_mm: number | null
  /** Yamuk: sağ kenar yüksekliği */
  height2_mm: number | null
  /** Üçgen: tepe noktasının soldan uzaklığı */
  apex_mm: number | null
  /** Kemer yüksekliği (sehim) */
  rise_mm: number | null
  /** Düzensiz çokgen köşeleri (mm) */
  vertices: [number, number][] | null
  manual_area_m2: number | null
  manual_perimeter_m: number | null
  /** Metal imalat gibi serbest birimli kalemlerde miktar */
  manual_quantity: number | null
  quantity: number
  unit: QuantityUnit
  measure_basis: MeasureBasis
  install_gap_mm: number | null
  glass_mode: GlassMode
  glass_deduction_mm: number | null
  glass_manual_m2: number | null
  description: string | null
  drawing_ref: DrawingRef | null
  detection: DetectionInfo | null
  verification: Verification
  sort_order: number
}

export interface QuantityItem extends QuantityItemInput {
  id: string
  takeoff_id: string
  project_id: string
  created_by: string | null
  created_at: string
  updated_at: string
  version: number
}

export function emptyItem(partial: Partial<QuantityItemInput> = {}): QuantityItemInput {
  return {
    poz_code: '',
    category: 'belirsiz',
    floor: null,
    space: null,
    shape: 'dikdortgen',
    width_mm: null,
    height_mm: null,
    height2_mm: null,
    apex_mm: null,
    rise_mm: null,
    vertices: null,
    manual_area_m2: null,
    manual_perimeter_m: null,
    manual_quantity: null,
    quantity: 1,
    unit: 'm2',
    measure_basis: 'dograma',
    install_gap_mm: null,
    glass_mode: 'yok',
    glass_deduction_mm: null,
    glass_manual_m2: null,
    description: null,
    drawing_ref: null,
    detection: null,
    verification: 'onaylandi',
    sort_order: 0,
    ...partial,
  }
}
