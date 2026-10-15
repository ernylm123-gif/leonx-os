/**
 * Onaylı metrajdan tahmini maliyet satırı önerisi.
 *
 *  - Yalnız ONAYLI metraj sürümünün ONAYLI pozları kullanılır; diğerleri nedenleriyle "hariç" listelenir.
 *  - Ölçüler metraj motorundan (computeItem) gelir: doğrama alanı, cam alanı, çevre, uzunluk, adet, kg.
 *  - Birim maliyet yalnız kullanıcının katalogda tanımladığı (iş grubu + birim eşleşen, aktif, geçerli)
 *    kayıttan alınır. Eşleşen kayıt yoksa satır "fiyat tanımlanmamış" (birim maliyet BOŞ) olarak önerilir;
 *    sıfır veya uydurma fiyat yazılmaz.
 *  - Çevre ≠ profil satın alma boyu: mtül/m birimli kalemlerde doğrusal iş yoksa çevre kullanılır ve
 *    satır "çevre bazlı tahmini" olarak etiketlenir.
 *  - Fire burada eklenmez; bütçedeki kullanıcı fire oranıyla uygulanır.
 *  - Aynı poz + maliyet grubu daha önce aktarıldıysa tekrar önerilmez (veritabanında da benzersiz).
 */
import { computeItem } from '@/quantity/engine'
import { CATEGORY_INFO, type QuantityItem } from '@/quantity/types'
import type { Currency } from '@/quote/types'
import type { CostGroup, CostLineInput, CostRate, FinUnit, MeasureBasis } from './types'

export interface SuggestedLine extends CostLineInput {
  /** `${poz kimliği}:${grup}` — tekrar aktarım denetimi için */
  key: string
  poz: string
  /** Birim maliyet katalogda yok: kullanıcı girmeli */
  needsPrice: boolean
}

export interface TakeoffImport {
  lines: SuggestedLine[]
  excluded: { poz: string; reason: string }[]
  alreadyImported: number
  /** Projeye daha önce başka bir metraj revizyonu aktarılmışsa onun kimliği (aktarım engellenir) */
  blockedByTakeoff: string | null
}

export interface TakeoffLike {
  id: string
  project_id: string
  status: 'taslak' | 'onaylandi' | 'arsiv'
  revision: number
  name: string
}

/** Bugün geçerli, aktif katalog kayıtları; aynı koddan en yeni geçerlilik tarihli olan */
export function currentRates(rates: readonly CostRate[], today: string): CostRate[] {
  const byCode = new Map<string, CostRate>()
  for (const r of rates) {
    if (!r.active || r.valid_from > today) continue
    const prev = byCode.get(r.code)
    if (!prev || r.valid_from > prev.valid_from) byCode.set(r.code, r)
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code, 'tr'))
}

const centiToQty = (c: number) => c / 100

export function fromApprovedTakeoff(
  takeoff: TakeoffLike,
  items: readonly QuantityItem[],
  rates: readonly CostRate[],
  existing: readonly { source: string; source_item_id: string | null; source_takeoff_id: string | null; cost_group: CostGroup }[],
  today: string,
  /** Fiyatı tanımlanmamış satırların para birimi (proje ana birimi) */
  currency: Currency = 'TRY',
): TakeoffImport {
  const res: TakeoffImport = { lines: [], excluded: [], alreadyImported: 0, blockedByTakeoff: null }
  const other = existing.find((l) => l.source === 'metraj' && l.source_takeoff_id && l.source_takeoff_id !== takeoff.id)
  if (other) res.blockedByTakeoff = other.source_takeoff_id
  if (takeoff.status !== 'onaylandi') {
    for (const it of items) res.excluded.push({ poz: it.poz_code, reason: 'Metraj sürümü onaylı değil' })
    return res
  }
  const done = new Set(existing.filter((l) => l.source_item_id).map((l) => `${l.source_item_id}:${l.cost_group}`))
  const catalog = currentRates(rates, today)
  let sort = 0

  for (const it of items) {
    if (it.verification !== 'onaylandi') {
      res.excluded.push({ poz: it.poz_code, reason: it.verification === 'reddedildi' ? 'Metrajda reddedilmiş' : 'Ölçü doğrulaması bekliyor' })
      continue
    }
    const r = computeItem(it)
    if (!r.ok || !r.primary) {
      res.excluded.push({ poz: it.poz_code, reason: r.errors.map((e) => e.message).join('; ') || 'Ölçü hesaplanamadı' })
      continue
    }
    const cat = CATEGORY_INFO[it.category]
    const where = [it.floor, it.space].filter(Boolean).join(' / ')
    const base = {
      project_id: takeoff.project_id,
      source: 'metraj' as const,
      source_takeoff_id: takeoff.id,
      source_item_id: it.id,
      poz: it.poz_code,
    }
    const add = (line: Omit<SuggestedLine, 'key' | 'project_id' | 'source' | 'source_takeoff_id' | 'source_item_id' | 'poz' | 'sort_order'>) => {
      const key = `${it.id}:${line.cost_group}`
      if (done.has(key)) {
        res.alreadyImported++
        return
      }
      done.add(key)
      res.lines.push({ ...base, ...line, key, sort_order: sort++ })
    }

    let matched = 0
    for (const rate of catalog.filter((x) => x.quantity_category === it.category)) {
      const m = measureFor(rate.unit, rate.cost_group, r, it.quantity)
      if (!m) continue
      matched++
      add({
        cost_group: rate.cost_group,
        description: `${it.poz_code} · ${rate.name}${m.basis === 'cevre' ? ' — çevre bazlı tahmini' : ''}`,
        quantity: m.qty,
        unit: rate.unit,
        unit_cost: rate.unit_cost,
        currency: rate.currency,
        cost_rate_id: rate.id,
        measure_basis: m.basis,
        notes: m.basis === 'cevre' ? 'Çevre uzunluğu profil satın alma/kesim boyu değildir; kesim listesiyle doğrulayın.' : null,
        needsPrice: false,
      })
    }
    if (matched === 0) {
      const unit: FinUnit = r.primary.unit
      add({
        cost_group: 'diger',
        description: `${it.poz_code} · ${cat?.label ?? it.category}${where ? ` — ${where}` : ''} (fiyat tanımlanmamış)`,
        quantity: centiToQty(r.primary.centi),
        unit,
        unit_cost: null,
        currency,
        cost_rate_id: null,
        measure_basis: unit === 'm2' ? 'alan' : unit === 'mtul' ? 'uzunluk' : unit === 'kg' ? 'kg' : 'adet',
        notes: null,
        needsPrice: true,
      })
    }
  }
  return res
}

type ItemCalc = ReturnType<typeof computeItem>

/** Katalog biriminin metraj karşılığı (toplam, 2 ondalık); uygulanamıyorsa null */
function measureFor(unit: FinUnit, group: CostGroup, r: ItemCalc, pieces: number): { qty: number; basis: MeasureBasis } | null {
  const t = r.total
  switch (unit) {
    case 'm2':
      if (group === 'cam' && t.glassArea > 0) return { qty: centiToQty(t.glassArea), basis: 'cam_alani' }
      return t.frameArea > 0 ? { qty: centiToQty(t.frameArea), basis: 'alan' } : null
    case 'mtul':
    case 'm':
      if (t.length > 0) return { qty: centiToQty(t.length), basis: 'uzunluk' }
      return t.perimeter > 0 ? { qty: centiToQty(t.perimeter), basis: 'cevre' } : null
    case 'adet':
      return pieces > 0 ? { qty: pieces, basis: 'adet' } : null
    case 'kg':
      return r.primary?.unit === 'kg' && r.primary.centi > 0 ? { qty: centiToQty(r.primary.centi), basis: 'kg' } : null
    default:
      // saat / götürü metrajdan türetilemez; elle girilir
      return null
  }
}
