/**
 * Rapor modeli: Excel ve PDF çıktıları AYNI modelden üretilir. Tüm sayılar metraj motorunun
 * tamsayı sonuçlarından gelir; böylece ekran, Excel ve PDF toplamları birebir aynıdır.
 */
import { computeItem, type ItemResult, summarize, type Totals } from '@/quantity/engine'
import { formatCenti, formatMilli, PRECISION } from '@/quantity/precision'
import { CATEGORY_INFO, correctedFields, type QuantityItem, SHAPE_LABEL, UNIT_LABEL, VERIFICATION_LABEL } from '@/quantity/types'

const SPEC_KEYS: [string, string][] = [
  ['malzeme', 'Malzeme'],
  ['sistem', 'Sistem'],
  ['acilim', 'Açılım'],
  ['cam', 'Cam'],
  ['renk', 'Renk'],
]
export const SPEC_STATUS = { dogrulandi: 'çizimden doğrulandı', aday: 'aday — onay gerekli', belirsiz: 'çizimde yok' } as const
const FIELD_TR: Record<string, string> = { poz_code: 'poz', category: 'iş grubu', width_mm: 'en', height_mm: 'boy', quantity: 'adet' }

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
  /** Kaynak çizim analizi (izlenebilirlik): dosya, özet, paftalar */
  analysis?: {
    fileName: string
    fileHash: string | null
    analyzedAt: string
    pages: { page: number; title: string | null; sheet: string | null; scale: string | null }[]
  } | null
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
  /** Teknik özellikler: "Malzeme: PVC (doğrulandı)" */
  specs: { label: string; value: string; status: 'dogrulandi' | 'aday' | 'belirsiz' }[]
  /** Kaynak paftalar / dosya */
  source: string
  /** İlk tespitten farklı (kullanıcı düzeltmesi) alanlar */
  corrected: string[]
  approvedAt: string | null
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
      verification: item.uncertain && item.verification === 'bekliyor' ? 'Belirsiz' : VERIFICATION_LABEL[item.verification],
      notes: item.review_note ? [`İnceleme notu: ${item.review_note}`, ...notes] : notes,
      specs: SPEC_KEYS.map(([k, label]) => {
        const a = item.detection?.attrs?.[k]
        return { label, value: a?.value ?? '', status: (a?.status ?? 'belirsiz') as 'dogrulandi' | 'aday' | 'belirsiz' }
      }).filter((x) => x.value || item.detection?.attrs),
      source: [
        ...(item.detection?.provenance?.sheets ?? []),
        item.drawing_ref?.file_name ? `Dosya: ${item.drawing_ref.file_name}` : '',
        !item.detection?.provenance?.sheets?.length && item.drawing_ref?.box_pages?.length ? `Sayfa ${[...new Set(item.drawing_ref.box_pages)].join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      corrected: correctedFields(item).map((f) => `${FIELD_TR[f]} ${String((item.original as unknown as Record<string, unknown>)?.[f] ?? '—')} → ${String((item as unknown as Record<string, unknown>)[f] ?? '—')}`),
      approvedAt: item.approved_at ?? null,
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
      'Çevre (mtül) satın alınacak profil boyu değildir; profil metrajı sistem kesitleriyle ayrıca hesaplanır.',
      'Teknik özellikler: "çizimden doğrulandı" pozun kendi yazısından okunmuştur; "aday" genel not, OCR veya çizim yorumundan gelir ve onay gerektirir; "çizimde yok" bilgisi çizimde bulunamamıştır.',
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
