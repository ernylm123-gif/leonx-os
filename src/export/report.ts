/**
 * Rapor modeli: Excel ve PDF çıktıları AYNI modelden üretilir. Tüm sayılar metraj motorunun
 * tamsayı sonuçlarından gelir; böylece ekran, Excel ve PDF toplamları birebir aynıdır.
 */
import { computeItem, type ItemResult, summarize, type Totals } from '@/quantity/engine'
import { formatCenti, formatMilli, PRECISION } from '@/quantity/precision'
import { CATEGORY_INFO, type QuantityItem, SHAPE_LABEL, UNIT_LABEL, VERIFICATION_LABEL } from '@/quantity/types'

export interface ReportMeta {
  projectCode: string
  projectName: string
  projectLocation: string | null
  companyName: string | null
  companyPhone: string | null
  companyEmail: string | null
  companyAddress: string | null
  takeoffName: string
  revision: number
  status: 'taslak' | 'onaylandi' | 'arsiv'
  approvedAt: string | null
  generatedAt: Date
}

export interface ReportRow {
  item: QuantityItem
  result: ItemResult
  category: string
  shape: string
  dims: string
  /** Sayısal sütunlar (yuvarlanmış; Excel'e sayı olarak yazılır) */
  unitArea: number | null
  totalArea: number | null
  totalOpening: number | null
  totalPerimeter: number | null
  totalGlass: number | null
  primary: number | null
  primaryUnit: string
  verification: string
  notes: string[]
}

export interface Report {
  meta: ReportMeta
  rows: ReportRow[]
  totals: Totals
  pending: ReportRow[]
  invalid: ReportRow[]
  rejected: ReportRow[]
  rules: string[]
}

export const STATUS_LABEL = { taslak: 'Taslak', onaylandi: 'Onaylı', arsiv: 'Arşiv' } as const

function dims(i: QuantityItem): string {
  const f = (v: number | null) => (v == null ? '—' : String(v).replace('.', ','))
  const info = CATEGORY_INFO[i.category]
  if (info?.family === 'dogrusal' || (info?.unit === 'serbest' && i.unit === 'mtul')) return `Uzunluk ${f(i.width_mm)}${i.height_mm ? ` (h ${f(i.height_mm)})` : ''}`
  if (info?.unit === 'serbest' && (i.unit === 'adet' || i.unit === 'kg')) return i.width_mm && i.height_mm ? `${f(i.width_mm)} × ${f(i.height_mm)}` : '—'
  switch (i.shape) {
    case 'manuel':
      return i.manual_area_m2 != null ? `${f(i.manual_area_m2)} m² (elle)` : '—'
    case 'cokgen':
      return `${i.vertices?.length ?? 0} köşe`
    case 'daire':
      return `Ø ${f(i.width_mm)}`
    case 'yamuk':
      return `${f(i.width_mm)} × ${f(i.height_mm)} / ${f(i.height2_mm)}`
    case 'kemerli':
      return `${f(i.width_mm)} × ${f(i.height_mm)} (kemer ${f(i.rise_mm)})`
    default:
      return `${f(i.width_mm)} × ${f(i.height_mm)}`
  }
}

export function buildReport(items: QuantityItem[], meta: ReportMeta): Report {
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order || a.poz_code.localeCompare(b.poz_code, 'tr', { numeric: true }))
  const results = sorted.map(computeItem)
  const rows: ReportRow[] = sorted.map((item, i) => {
    const r = results[i]
    const notes = [...r.errors.map((e) => `HATA: ${e.message}`), ...r.warnings]
    if (item.detection) notes.push(...item.detection.reasons.slice(0, 3).map((x) => `Tespit: ${x}`))
    return {
      item,
      result: r,
      category: CATEGORY_INFO[item.category]?.label ?? item.category,
      shape: CATEGORY_INFO[item.category]?.family === 'dogrusal' ? 'Doğrusal' : SHAPE_LABEL[item.shape],
      dims: dims(item),
      unitArea: r.ok && r.unit.frameArea != null ? r.unit.frameArea / 1000 : null,
      totalArea: r.ok && r.unit.frameArea != null ? r.total.frameArea / 100 : null,
      totalOpening: r.ok && r.unit.openingArea != null ? r.total.openingArea / 100 : null,
      totalPerimeter: r.ok && r.unit.perimeter != null ? r.total.perimeter / 100 : null,
      totalGlass: r.ok && r.unit.glassArea != null ? r.total.glassArea / 100 : null,
      primary: r.ok && r.primary ? r.primary.centi / 100 : null,
      primaryUnit: r.primary ? UNIT_LABEL[r.primary.unit] : '',
      verification: VERIFICATION_LABEL[item.verification],
      notes,
    }
  })
  const totals = summarize(sorted, results)
  return {
    meta,
    rows,
    totals,
    pending: rows.filter((r) => r.item.verification === 'bekliyor'),
    invalid: rows.filter((r) => !r.result.ok && r.item.verification !== 'reddedildi'),
    rejected: rows.filter((r) => r.item.verification === 'reddedildi'),
    rules: [
      `Ölçüler milimetre, en fazla ${PRECISION.inputMmDecimals} ondalık girilir.`,
      `Birim alan ve birim çevre ${PRECISION.unitDecimals} ondalığa, satır toplamları ${PRECISION.totalDecimals} ondalığa ${PRECISION.rounding} yuvarlanır.`,
      'Satır toplamı = yuvarlanmış birim değer × adet. Genel toplam = satır toplamlarının toplamıdır.',
      'Yalnızca ONAYLI ve hatasız pozlar kesin toplamlara dahildir. Doğrulama bekleyen pozlar ayrıca listelenir.',
      'Doğrama alanı kasa dış ölçüsüyle hesaplanır; cam alanı ve profil/kesim boyları ayrı kavramlardır.',
    ],
  }
}

/** Ekranla aynı biçimde metin (PDF için) */
export const fmtArea = (centi: number) => formatCenti(centi)
export const fmtUnit = (milli: number) => formatMilli(milli)

export function reportFileName(meta: ReportMeta, ext: 'xlsx' | 'pdf'): string {
  const safe = `${meta.projectCode}-metraj-rev${meta.revision}`.replace(/[^A-Za-z0-9._-]+/g, '-')
  const d = meta.generatedAt
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `${safe}-${stamp}.${ext}`
}
