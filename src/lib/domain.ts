/** İş alanı sabitleri — veritabanındaki CHECK kısıtlarıyla birebir aynıdır. */

export const PROJECT_CATEGORIES = [
  { value: 'aluminyum_dograma', label: 'Alüminyum doğrama' },
  { value: 'pvc_dograma', label: 'PVC doğrama' },
  { value: 'celik_kapi', label: 'Çelik kapı' },
  { value: 'oda_kapisi', label: 'Oda kapısı' },
  { value: 'yangin_kapisi', label: 'Yangın kapısı' },
  { value: 'korkuluk', label: 'Korkuluk' },
  { value: 'cephe', label: 'Cephe sistemleri' },
  { value: 'metal_imalat', label: 'Metal imalat' },
  { value: 'diger', label: 'Diğer' },
] as const

export const PROJECT_STATUSES = [
  { value: 'kesif', label: 'Keşif' },
  { value: 'olcu', label: 'Ölçü' },
  { value: 'tasarim', label: 'Çizim / tasarım' },
  { value: 'teklif', label: 'Teklif' },
  { value: 'uretim', label: 'Üretim' },
  { value: 'montaj', label: 'Montaj' },
  { value: 'tamamlandi', label: 'Tamamlandı' },
  { value: 'beklemede', label: 'Beklemede' },
  { value: 'iptal', label: 'İptal' },
] as const

export const PROJECT_PRIORITIES = [
  { value: 'dusuk', label: 'Düşük' },
  { value: 'normal', label: 'Normal' },
  { value: 'yuksek', label: 'Yüksek' },
  { value: 'acil', label: 'Acil' },
] as const

export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number]['value']
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]['value']
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number]['value']

/** Aktif sayılmayan (kapanmış) durumlar */
export const CLOSED_STATUSES: readonly ProjectStatus[] = ['tamamlandi', 'iptal']

const lookup = <T extends readonly { value: string; label: string }[]>(list: T) =>
  Object.fromEntries(list.map((i) => [i.value, i.label])) as Record<T[number]['value'], string>

export const CATEGORY_LABEL = lookup(PROJECT_CATEGORIES)
export const STATUS_LABEL = lookup(PROJECT_STATUSES)
export const PRIORITY_LABEL = lookup(PROJECT_PRIORITIES)

export const isCategory = (v: string): v is ProjectCategory => v in CATEGORY_LABEL
export const isStatus = (v: string): v is ProjectStatus => v in STATUS_LABEL
export const isPriority = (v: string): v is ProjectPriority => v in PRIORITY_LABEL

export function isActiveStatus(s: ProjectStatus): boolean {
  return !CLOSED_STATUSES.includes(s)
}
