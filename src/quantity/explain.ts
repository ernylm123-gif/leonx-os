/**
 * Metraj hesabının açıklaması (Faz 5.2 — mühendislik incelemesi): kullanıcı her sayının nasıl
 * bulunduğunu görür. Değerler metraj motorunun tamsayı sonuçlarından gelir; burada yalnız metne
 * dökülür (ekran, Excel ve PDF ile aynı sayılar).
 */
import type { ItemResult } from './engine'
import { formatDecimal } from './precision'
import { CATEGORY_INFO, type QuantityItemInput, SHAPE_LABEL } from './types'

const m = (mm: number | null | undefined) => (mm == null ? '—' : formatDecimal(Number(mm) / 1000, 3))
const milli = (v: number) => formatDecimal(v / 1000, 3)
const centi = (v: number) => formatDecimal(v / 100, 2)

export interface CalcLine {
  label: string
  formula: string
  value: string
}

export function explainCalc(item: QuantityItemInput, r: ItemResult): { lines: CalcLine[]; notes: string[] } {
  const lines: CalcLine[] = []
  const notes: string[] = []
  if (!r.ok) {
    return { lines, notes: r.errors.map((e) => `Hesaplanamadı: ${e.message}`) }
  }
  const info = CATEGORY_INFO[item.category]
  const n = item.quantity
  if (info.family === 'dogrusal') {
    if (r.unit.length != null) {
      lines.push({ label: 'Birim uzunluk', formula: `${m(item.width_mm)} m`, value: `${milli(r.unit.length)} m` })
      lines.push({ label: 'Toplam uzunluk', formula: `${milli(r.unit.length)} m × ${n}`, value: `${centi(r.total.length)} mtül` })
    }
    return { lines, notes }
  }
  if (r.unit.frameArea != null) {
    const shape = item.shape === 'dikdortgen' ? `${m(item.width_mm)} m × ${m(item.height_mm)} m` : `${SHAPE_LABEL[item.shape]} (geometrik alan formülü)`
    lines.push({ label: 'Tekil doğrama alanı', formula: shape, value: `${milli(r.unit.frameArea)} m²` })
    lines.push({ label: 'Toplam doğrama alanı', formula: `${milli(r.unit.frameArea)} m² × ${n} adet`, value: `${centi(r.total.frameArea)} m²` })
  }
  if (r.unit.openingArea != null && r.unit.openingArea !== r.unit.frameArea) {
    lines.push({ label: 'Duvar boşluğu alanı', formula: 'montaj payı dahil', value: `${centi(r.total.openingArea)} m²` })
  }
  if (r.unit.perimeter != null) {
    const per = item.shape === 'dikdortgen' ? `2 × (${m(item.width_mm)} + ${m(item.height_mm)}) m` : 'şekil çevresi'
    lines.push({ label: 'Tekil çevre', formula: per, value: `${milli(r.unit.perimeter)} m` })
    lines.push({ label: 'Toplam çevre', formula: `${milli(r.unit.perimeter)} m × ${n} adet`, value: `${centi(r.total.perimeter)} mtül` })
    notes.push('Çevre, satın alınacak profil boyu DEĞİLDİR: kasa, kanat ve kayıt boyları sistem kesit ölçüleriyle ayrıca hesaplanır.')
  }
  if (r.unit.glassArea != null) {
    lines.push({ label: 'Cam alanı', formula: item.glass_mode === 'manuel' ? 'elle girilen' : `profil düşümü ${item.glass_deduction_mm ?? 0} mm`, value: `${centi(r.total.glassArea)} m²` })
    notes.push('Cam alanı doğrama alanından ayrı hesaplanır; kaba doğrama alanıyla karıştırılmaz.')
  }
  if (r.primary) {
    const u = r.primary.unit === 'm2' ? 'm²' : r.primary.unit === 'mtul' ? 'mtül' : r.primary.unit
    lines.push({ label: 'Metraj miktarı', formula: `iş grubu birimi (${info.label})`, value: `${centi(r.primary.centi)} ${u}` })
  }
  notes.push('Birim değerler 3, toplamlar 2 ondalığa yuvarlanır; toplam = yuvarlanmış birim × adet.')
  return { lines, notes }
}
