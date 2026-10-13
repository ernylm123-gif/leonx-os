import { type DisplayUnitId, displayUnit } from '@/cad/units'

const nfCache = new Map<number, Intl.NumberFormat>()
export function nf(decimals: number): Intl.NumberFormat {
  let f = nfCache.get(decimals)
  if (!f) {
    f = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    nfCache.set(decimals, f)
  }
  return f
}

const DECIMALS: Record<DisplayUnitId, number> = { mm: 1, cm: 2, m: 3 }

/** Ölçek/birim durumu: ölçüler yalnızca birim biliniyorsa gerçek birime çevrilir */
export interface UnitState {
  /** 1 çizim biriminin mm karşılığı; bilinmiyorsa null */
  mmPerUnit: number | null
  source: 'dosya' | 'kullanici' | 'kalibrasyon' | 'olcek' | 'yok'
  /** Kullanıcı tarafından doğrulandı mı (dosya başlığı da doğrulanmış kabul edilir) */
  verified: boolean
  /** Açıklama (ör. "Kalibrasyon: 1200 mm ölçüye göre") */
  note: string
}

export function formatLengthWorld(world: number, units: UnitState, unit: DisplayUnitId): string {
  if (units.mmPerUnit == null) return `${nf(2).format(world)} birim · birim doğrulanmadı`
  const u = displayUnit(unit)
  const v = (world * units.mmPerUnit) / u.mm
  return `${nf(DECIMALS[unit]).format(v)} ${u.label}${units.verified ? '' : ' · doğrulanmadı'}`
}

export function formatAreaWorld(world2: number, units: UnitState): string {
  if (units.mmPerUnit == null) return `${nf(2).format(world2)} birim² · birim doğrulanmadı`
  const m2 = (world2 * units.mmPerUnit * units.mmPerUnit) / 1e6
  return `${nf(3).format(m2)} m²${units.verified ? '' : ' · doğrulanmadı'}`
}

export function formatCoord(v: number, units: UnitState, unit: DisplayUnitId): string {
  if (units.mmPerUnit == null) return nf(2).format(v)
  return nf(DECIMALS[unit]).format((v * units.mmPerUnit) / displayUnit(unit).mm)
}
