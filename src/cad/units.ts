/**
 * Çizim birimleri. DXF başlığındaki $INSUNITS kodu çizim biriminin milimetre karşılığını verir.
 * Kod 0 (birimsiz) veya tanınmayan kod: birim BİLİNMİYOR — kullanıcı doğrulaması gerekir;
 * bu durumda hiçbir ölçü kesin olarak raporlanmaz.
 */

export interface UnitDef {
  code: number
  name: string
  short: string
  /** 1 çizim biriminin milimetre karşılığı */
  mm: number
}

const DEFS: UnitDef[] = [
  { code: 1, name: 'İnç', short: 'in', mm: 25.4 },
  { code: 2, name: 'Fit', short: 'ft', mm: 304.8 },
  { code: 4, name: 'Milimetre', short: 'mm', mm: 1 },
  { code: 5, name: 'Santimetre', short: 'cm', mm: 10 },
  { code: 6, name: 'Metre', short: 'm', mm: 1000 },
  { code: 7, name: 'Kilometre', short: 'km', mm: 1_000_000 },
  { code: 9, name: 'Mil (1/1000 inç)', short: 'mil', mm: 0.0254 },
  { code: 10, name: 'Yarda', short: 'yd', mm: 914.4 },
  { code: 13, name: 'Mikron', short: 'µm', mm: 0.001 },
  { code: 14, name: 'Desimetre', short: 'dm', mm: 100 },
  { code: 21, name: 'ABD ölçüm fiti', short: 'ft(US)', mm: 1200 / 3937 * 1000 },
]

const BY_CODE = new Map(DEFS.map((d) => [d.code, d]))

/** Kullanıcının bilinmeyen birim için seçebileceği birimler */
export const CONFIRMABLE_UNITS: readonly UnitDef[] = DEFS.filter((d) => [4, 5, 6, 1, 2].includes(d.code))

export function unitByCode(code: number | null | undefined): UnitDef | null {
  if (code == null) return null
  return BY_CODE.get(code) ?? null
}

/** Başlıkta kod var ama desteklenmiyorsa (ör. astronomik birim) açıklama */
export function describeUnitCode(code: number | null): string {
  if (code == null) return 'Başlıkta birim bilgisi yok'
  if (code === 0) return 'Birimsiz (INSUNITS = 0)'
  const u = BY_CODE.get(code)
  return u ? `${u.name} (INSUNITS = ${code})` : `Desteklenmeyen birim kodu (INSUNITS = ${code})`
}

/** Ekranda gösterim için uzunluk birimi seçenekleri */
export const DISPLAY_UNITS = [
  { id: 'mm', label: 'mm', mm: 1 },
  { id: 'cm', label: 'cm', mm: 10 },
  { id: 'm', label: 'm', mm: 1000 },
] as const

export type DisplayUnitId = (typeof DISPLAY_UNITS)[number]['id']

export function displayUnit(id: DisplayUnitId) {
  return DISPLAY_UNITS.find((u) => u.id === id) ?? DISPLAY_UNITS[0]
}
