/**
 * Metraj pozlarını teklif kalemine aktarma. Ölçüler metraj motorunun hesabından gelir
 * (dikdörtgen olmayan şekiller dahil); teklif ve metraj aynı alanı/uzunluğu gösterir.
 * Doğrulanmamış (onay bekleyen) metraj ölçüsü teklifte "doğrulanmadı" olarak işaretlenir.
 */
import { computeItem } from '@/quantity/engine'
import { CATEGORY_INFO, type QuantityItem } from '@/quantity/types'
import type { QuantityTakeoff } from '@/data/types'
import { emptyQuoteItem } from './engine'
import type { QuoteItemInput } from './types'

export interface ImportResult {
  items: QuoteItemInput[]
  skipped: { poz: string; reason: string }[]
}

export function quantityToQuoteItems(items: QuantityItem[], takeoff: Pick<QuantityTakeoff, 'id' | 'revision' | 'name'>, startSort = 0): ImportResult {
  const out: QuoteItemInput[] = []
  const skipped: ImportResult['skipped'] = []
  items.forEach((q, idx) => {
    if (q.verification === 'reddedildi') {
      skipped.push({ poz: q.poz_code, reason: 'Metrajda reddedilmiş' })
      return
    }
    const r = computeItem(q)
    if (!r.ok || !r.primary) {
      skipped.push({ poz: q.poz_code, reason: r.errors.map((e) => e.message).join('; ') || 'Ölçü hesaplanamadı' })
      return
    }
    const cat = CATEGORY_INFO[q.category]
    const base = {
      ...emptyQuoteItem(startSort + idx),
      poz_code: q.poz_code,
      description: q.description?.trim() || `${cat.label}${[q.floor, q.space].filter(Boolean).length ? ` — ${[q.floor, q.space].filter(Boolean).join(' / ')}` : ''}`,
      system_type: cat.label,
      width_mm: q.width_mm,
      height_mm: q.height_mm,
      source: 'metraj' as const,
      source_item_id: q.id,
      source_takeoff_id: takeoff.id,
      source_label: `Metraj Rev ${takeoff.revision} · ${takeoff.name} · ${q.poz_code}`,
      measure_verified: q.verification === 'onaylandi',
    }
    const unit = r.primary.unit
    if (unit === 'm2') {
      // Birim alan metraj motorundan: dikdörtgende En × Boy ile aynıdır, diğer şekillerde gerçek alan
      const rect = q.shape === 'dikdortgen' && q.width_mm && q.height_mm
      out.push({ ...base, unit: 'm2', quantity: q.quantity, manual_measure: rect ? null : (r.unit.frameArea ?? 0) / 1000 })
    } else if (unit === 'mtul') {
      const len = r.unit.length
      out.push({ ...base, unit: 'mtul', quantity: q.quantity, height_mm: null, manual_measure: q.width_mm ? null : len != null ? len / 1000 : null })
    } else if (unit === 'adet') {
      out.push({ ...base, unit: 'adet', quantity: q.quantity })
    } else {
      // kg vb.: metrajdaki toplam miktar
      out.push({ ...base, unit: 'kg', quantity: r.primary.centi / 100, width_mm: null, height_mm: null })
    }
  })
  return { items: out, skipped }
}
