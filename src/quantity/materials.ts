/**
 * Malzeme bazlı metraj (Faz 13): onaylı pozlar malzeme ve sistem/seriye göre gruplanır.
 *
 * Malzeme kaynağı sırasıyla: çizimden okunan "malzeme" özelliği (doğrulandı/aday), iş grubunun
 * malzemesi (PVC pencere → PVC). İkisi de yoksa "Belirtilmemiş" — tahmin yapılmaz. Kaynağı "aday"
 * olan satırlar ayrıca işaretlenir.
 */
import type { ItemResult } from './engine'
import type { QuantityCategory, QuantityItem } from './types'

const CATEGORY_MATERIAL: Partial<Record<QuantityCategory, string>> = {
  pvc_pencere: 'PVC',
  pvc_kapi: 'PVC',
  al_pencere: 'Alüminyum',
  al_kapi: 'Alüminyum',
  kompozit_cephe: 'Kompozit',
}

export interface MaterialRow {
  material: string
  system: string | null
  items: number
  pieces: number
  /** ×100 tamsayılar */
  frameArea: number
  openingArea: number
  perimeter: number
  glassArea: number
  length: number
  /** Malzemesi çizimde yalnız "aday" olarak okunan kalem sayısı */
  candidates: number
}

export function materialOf(item: Pick<QuantityItem, 'category' | 'detection'>): { material: string; system: string | null; candidate: boolean } {
  const a = item.detection?.attrs
  const m = a?.malzeme
  const sys = a?.sistem?.value?.trim() || null
  if (m?.value && m.status !== 'belirsiz') return { material: normalize(m.value), system: sys, candidate: m.status === 'aday' }
  return { material: CATEGORY_MATERIAL[item.category] ?? 'Belirtilmemiş', system: sys, candidate: false }
}

function normalize(v: string): string {
  const u = v.toLocaleUpperCase('tr-TR')
  if (/PVC/.test(u)) return 'PVC'
  if (/AL[UÜ]M|ALU/.test(u)) return 'Alüminyum'
  if (/KOMPOZ/.test(u)) return 'Kompozit'
  if (/AH[SŞ]AP/.test(u)) return 'Ahşap'
  if (/[CÇ]EL[İI]K|PASLANMAZ/.test(u)) return 'Çelik'
  return v.trim()
}

/** Yalnız onaylı ve hatasız kalemler (kesin metraj) */
export function summarizeByMaterial(items: readonly QuantityItem[], results: readonly ItemResult[]): MaterialRow[] {
  const map = new Map<string, MaterialRow>()
  items.forEach((it, i) => {
    const r = results[i]
    if (!r?.counted) return
    const { material, system, candidate } = materialOf(it)
    const k = `${material}|${system ?? ''}`
    let row = map.get(k)
    if (!row) {
      row = { material, system, items: 0, pieces: 0, frameArea: 0, openingArea: 0, perimeter: 0, glassArea: 0, length: 0, candidates: 0 }
      map.set(k, row)
    }
    row.items++
    row.pieces += it.quantity
    row.frameArea += r.total.frameArea
    row.openingArea += r.total.openingArea
    row.perimeter += r.total.perimeter
    row.glassArea += r.total.glassArea
    row.length += r.total.length
    if (candidate) row.candidates++
  })
  return [...map.values()].sort((a, b) => b.frameArea - a.frameArea || a.material.localeCompare(b.material, 'tr'))
}
