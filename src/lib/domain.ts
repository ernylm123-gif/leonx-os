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

/**
 * Proje aşamaları (Faz 7) — iş akışının ana ekseni. Veritabanındaki eski "status" alanı
 * aşamadan sunucuda türetilir (geriye uyumluluk); istemci yalnız aşamayı yazar.
 */
export const PROJECT_STAGES = [
  { value: 'yeni_firsat', label: 'Yeni fırsat', short: 'Fırsat', group: 'satis' },
  { value: 'teklif_hazirlaniyor', label: 'Teklif hazırlanıyor', short: 'Teklif hazırlık', group: 'satis' },
  { value: 'teklif_gonderildi', label: 'Teklif gönderildi', short: 'Teklif gitti', group: 'satis' },
  { value: 'gorusme', label: 'Görüşme aşamasında', short: 'Görüşme', group: 'satis' },
  { value: 'onaylandi', label: 'Onaylandı', short: 'Onaylandı', group: 'uygulama' },
  { value: 'olcu_kesif', label: 'Ölçü / keşif', short: 'Ölçü/keşif', group: 'uygulama' },
  { value: 'uretime_hazirlik', label: 'Üretime hazırlık', short: 'Üretim hazırlık', group: 'uygulama' },
  { value: 'uretimde', label: 'Üretimde', short: 'Üretimde', group: 'uygulama' },
  { value: 'montajda', label: 'Montajda', short: 'Montajda', group: 'uygulama' },
  { value: 'tamamlandi', label: 'Tamamlandı', short: 'Tamamlandı', group: 'kapanis' },
  { value: 'teslim_edildi', label: 'Teslim edildi', short: 'Teslim', group: 'kapanis' },
  { value: 'iptal', label: 'İptal edildi', short: 'İptal', group: 'kapanis' },
] as const
export type ProjectStage = (typeof PROJECT_STAGES)[number]['value']
export const STAGE_LABEL = Object.fromEntries(PROJECT_STAGES.map((s) => [s.value, s.label])) as Record<ProjectStage, string>
export const isStage = (v: string): v is ProjectStage => v in STAGE_LABEL
/** Kapanmış aşamalar (aktif iş sayılmaz) */
export const CLOSED_STAGES: readonly ProjectStage[] = ['tamamlandi', 'teslim_edildi', 'iptal']
export const isActiveStage = (s: ProjectStage): boolean => !CLOSED_STAGES.includes(s)
/** Teklif bekleyen (satış) aşamaları */
export const QUOTE_STAGES: readonly ProjectStage[] = ['yeni_firsat', 'teklif_hazirlaniyor', 'teklif_gonderildi', 'gorusme']
/** Aşamanın asgari ilerleme yüzdesi — veritabanındaki leonx_stage_progress ile aynı */
export const STAGE_PROGRESS: Record<ProjectStage, number> = {
  yeni_firsat: 0,
  teklif_hazirlaniyor: 5,
  teklif_gonderildi: 10,
  gorusme: 15,
  onaylandi: 25,
  olcu_kesif: 30,
  uretime_hazirlik: 40,
  uretimde: 55,
  montajda: 80,
  tamamlandi: 100,
  teslim_edildi: 100,
  iptal: 0,
}

/** Eski durum değerleri (durum geçmişi kayıtlarını göstermek için) */
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
