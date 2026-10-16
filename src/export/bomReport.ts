/**
 * Malzeme reçetesi rapor modeli: Excel ve PDF AYNI modelden üretilir. Sayılar kayıtlı sürümün
 * satırlarından (motorun tamsayı birimleri) gelir; ekran, Excel ve PDF toplamları birebir aynıdır.
 */
import { type BomCalcLine, type CutListEntry, groupByRole, type MaterialTotal, summarizeStored } from '@/bom/engine'
import { BOM_STATUS_LABEL, type BomAssignment, type BomStatus, type BomWarningRow, type ComponentUnit, UNIT_INFO } from '@/bom/types'
import { formatDecimal } from '@/quantity/precision'
import { CATEGORY_INFO, isQuantityCategory } from '@/quantity/types'
import { formatMoney } from '@/quote/money'
import type { Currency } from '@/quote/types'

export interface BomReportMeta {
  projectCode: string
  projectName: string
  companyName: string | null
  revision: number
  status: BomStatus
  sourceApproved: boolean
  takeoffRevision: number
  takeoffName: string
  takeoffStatus: 'taslak' | 'onaylandi' | 'arsiv'
  createdAt: string
  approvedAt: string | null
  notes: string | null
  generatedAt: Date
}

export interface BomReport {
  meta: BomReportMeta
  assignments: BomAssignment[]
  lines: BomCalcLine[]
  groups: { label: string; lines: BomCalcLine[] }[]
  totals: MaterialTotal[]
  cutList: CutListEntry[]
  warnings: BomWarningRow[]
  cost: Partial<Record<Currency, number>>
  unpricedLines: number
  /** Raporun durum başlığı ("Onaylı reçete" / "TASLAK — onaysız metrajdan" …) */
  banner: string
  final: boolean
  rules: string[]
}

export function bomBanner(status: BomStatus, sourceApproved: boolean): string {
  if (status === 'onayli') return 'Onaylı reçete (onaylı metrajdan)'
  if (status === 'iptal') return 'İPTAL EDİLMİŞ reçete sürümü — geçerli değildir'
  return sourceApproved ? 'TASLAK — onay bekliyor' : 'TASLAK — onaysız metrajdan; onaylanamaz'
}

export function buildBomReport(meta: BomReportMeta, assignments: BomAssignment[], lines: BomCalcLine[], warnings: BomWarningRow[]): BomReport {
  const s = summarizeStored(lines)
  return {
    meta,
    assignments: [...assignments].sort((a, b) => a.sort_order - b.sort_order),
    lines,
    groups: groupByRole(lines),
    totals: s.totals,
    cutList: s.cutList,
    warnings,
    cost: s.cost,
    unpricedLines: s.unpricedLines,
    banner: bomBanner(meta.status, meta.sourceApproved),
    final: meta.status === 'onayli',
    rules: [
      'Reçete yalnız kullanıcının tanımladığı ürün sistemlerinden hesaplanır; üretici verisi (profil kodu, ağırlık, fiyat, kesim düşümü) sistem tarafından uydurulmaz.',
      'Profil kesim boyları sistemin kendi üretim kurallarından (formüller) gelir; pencere çevresinden türetilmez.',
      'Kesim boyu 0,1 mm; miktarlar 3 ondalık (birim değer yuvarlanır, sonra adetle çarpılır), yarım yukarı.',
      'Fire bileşenin fire oranıyla eklenir; adet/takım biriminde fire dahil toplam yukarı tam sayıya yuvarlanır.',
      'Standart boy adedi = yukarı yuvarla(fire dahil toplam boy / standart boy); YALNIZ TAHMİNDİR, kesim optimizasyonu değildir.',
      'Maliyet yalnız birim maliyet kataloğundaki geçerli fiyattan ve birim uyumluysa hesaplanır; aksi hâlde "fiyat tanımlı değil". Para birimleri ayrı toplanır, çevrim yapılmaz.',
      'Yalnız ONAYLI metraj sürümünün ONAYLI pozlarından hesaplanan reçete onaylanabilir; onaylı reçete değiştirilemez.',
    ],
  }
}

// ------------------------------------------------------------------ biçim yardımcıları
export const fmtMm = (dmm: number | null) => (dmm == null ? '—' : formatDecimal(dmm / 10, dmm % 10 ? 1 : 0))
export const fmtQty = (milli: number) => formatDecimal(milli / 1000, 3)
export const fmtInt = (n: number | null) => (n == null ? '—' : n.toLocaleString('tr-TR'))
/** Satır miktarının birimi: profil satırında metre */
export const qtyUnit = (u: ComponentUnit) => UNIT_INFO[u].short
export const categoryLabel = (c: string) => (isQuantityCategory(c) ? CATEGORY_INFO[c].label : c)
export function fmtCost(cost: Partial<Record<Currency, number>>): string {
  const parts = (Object.entries(cost) as [Currency, number][]).filter(([, v]) => v).map(([c, v]) => formatMoney(v, c))
  return parts.length ? parts.join(' + ') : '—'
}
export const statusLabel = (s: BomStatus) => BOM_STATUS_LABEL[s]

export function bomFileName(meta: BomReportMeta, ext: 'xlsx' | 'pdf'): string {
  const safe = `${meta.projectCode}-recete-rev${meta.revision}`.replace(/[^A-Za-z0-9._-]+/g, '-')
  const d = meta.generatedAt
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `${safe}-${stamp}.${ext}`
}
