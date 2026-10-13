/**
 * Ortak metraj hesap motoru + iş grubuna özgü kurallar.
 *
 * Kavramlar birbirine KARIŞTIRILMAZ:
 *  - Boşluk alanı: duvardaki kaba açıklık (ölçü esası "boşluk" ise girilen ölçü)
 *  - Doğrama alanı: kasa dış ölçüsüyle alan (boşluktan montaj payı düşülerek bulunur)
 *  - Cam alanı: kasa/kanat profilleri düşüldükten sonra kalan cam (tahmini veya elle)
 *  - Çevre: doğrama dış çevresi (profil/kesim boyu DEĞİLDİR; profil sistemine göre ayrıca hesaplanır)
 *
 * Doğrulanmamış (bekliyor) ve reddedilmiş kalemler onaylı toplamlara GİRMEZ.
 */
import { milliTimesQtyToCenti, PRECISION, toMilli } from './precision'
import { computeShape, type ShapeError, type ShapeResult } from './shapes'
import { CATEGORY_INFO, type QuantityCategory, type QuantityItemInput, type QuantityUnit } from './types'

export interface ItemResult {
  ok: boolean
  errors: ShapeError[]
  warnings: string[]
  shape: ShapeResult | null
  /** Birim değerler, ×1000 tamsayı (m² için 0,001 m²; m için 1 mm) */
  unit: {
    frameArea: number | null
    openingArea: number | null
    perimeter: number | null
    glassArea: number | null
    length: number | null
  }
  /** Satır toplamları, ×100 tamsayı */
  total: {
    frameArea: number
    openingArea: number
    perimeter: number
    glassArea: number
    length: number
  }
  /** Kalemin metraj miktarı (kategori kuralına göre birim) */
  primary: { unit: QuantityUnit; centi: number } | null
  /** Onaylı toplamlara dahil mi */
  counted: boolean
  pending: boolean
}

/** Kategori için geçerli birim; metal imalatta kullanıcının seçtiği birim geçerlidir. */
export function unitForCategory(category: QuantityCategory, chosen: QuantityUnit): QuantityUnit {
  const u = CATEGORY_INFO[category].unit
  return u === 'serbest' ? chosen : u
}

export function computeItem(item: QuantityItemInput): ItemResult {
  const errors: ShapeError[] = []
  const warnings: string[] = []
  const info = CATEGORY_INFO[item.category] ?? CATEGORY_INFO.belirsiz
  const unit = unitForCategory(item.category, item.unit)
  const empty = { frameArea: 0, openingArea: 0, perimeter: 0, glassArea: 0, length: 0 }
  const res: ItemResult = {
    ok: false,
    errors,
    warnings,
    shape: null,
    unit: { frameArea: null, openingArea: null, perimeter: null, glassArea: null, length: null },
    total: { ...empty },
    primary: null,
    counted: false,
    pending: item.verification === 'bekliyor',
  }

  // Adet
  const q = item.quantity
  if (!Number.isInteger(q) || q < 1) errors.push({ field: 'quantity', message: 'Adet 1 veya daha büyük tam sayı olmalıdır.' })
  else if (q > PRECISION.maxQuantity) errors.push({ field: 'quantity', message: `Adet ${PRECISION.maxQuantity.toLocaleString('tr-TR')} sınırını aşıyor.` })
  if (!item.poz_code.trim()) errors.push({ field: 'poz_code', message: 'Poz kodu girilmelidir.' })
  if (item.unit !== unit && info.unit !== 'serbest') warnings.push(`Birim "${info.label}" için ${unit} olarak düzeltildi.`)

  // Doğrusal iş (korkuluk): metraj = uzunluk (genişlik alanı) × adet
  if (info.family === 'dogrusal' || (info.unit === 'serbest' && unit === 'mtul')) {
    const len = item.width_mm
    if (len == null || !(len > 0)) errors.push({ field: 'width_mm', message: 'Uzunluk (genişlik) girilmelidir.' })
    else if (len > PRECISION.maxDimensionMm) errors.push({ field: 'width_mm', message: 'Uzunluk 100 m sınırını aşıyor.' })
    if (errors.length) return res
    res.unit.length = toMilli(len! / 1000)
    res.total.length = milliTimesQtyToCenti(res.unit.length, q)
    res.primary = { unit: 'mtul', centi: res.total.length }
    res.ok = true
    finalize(res, item)
    return res
  }

  // Serbest birim: adet / kg
  if (info.unit === 'serbest' && (unit === 'adet' || unit === 'kg')) {
    if (unit === 'kg') {
      const kg = item.manual_quantity
      if (kg == null || !(kg > 0)) errors.push({ field: 'manual_quantity', message: 'Birim ağırlık (kg) girilmelidir.' })
      if (errors.length) return res
      const unitMilli = toMilli(kg!)
      res.primary = { unit: 'kg', centi: milliTimesQtyToCenti(unitMilli, q) }
    } else {
      if (errors.length) return res
      res.primary = { unit: 'adet', centi: q * 100 }
    }
    // Ölçü girildiyse alan bilgi olarak hesaplanır
    if (item.width_mm && item.height_mm) addArea(res, item, errors, warnings, q, false)
    res.ok = errors.length === 0
    finalize(res, item)
    return res
  }

  // Adet ile ölçülen işlerde (fotoselli kapı) ölçü bilgi amaçlıdır, zorunlu değildir
  addArea(res, item, errors, warnings, q, unit !== 'adet')
  if (errors.length) {
    res.ok = false
    return res
  }
  if (unit === 'adet') res.primary = { unit: 'adet', centi: q * 100 }
  else res.primary = { unit: 'm2', centi: res.total.frameArea }
  res.ok = true
  finalize(res, item)
  return res
}

function addArea(res: ItemResult, item: QuantityItemInput, errors: ShapeError[], warnings: string[], q: number, required: boolean) {
  const glassAllowed = CATEGORY_INFO[item.category]?.glass ?? false
  // Ölçü esası: boşluk ise montaj payı düşülerek doğrama ölçüsü bulunur (yalnızca dikdörtgen)
  let frameDims = item
  let openingShape: ShapeResult | null = null
  if (item.measure_basis === 'bosluk') {
    const opening = computeShape(item)
    if (!opening.result) {
      if (required) errors.push(...opening.errors)
      return
    }
    openingShape = opening.result
    const g = item.install_gap_mm
    if (g == null || g === 0) {
      warnings.push('Ölçü boşluk ölçüsü; montaj payı girilmediği için doğrama ölçüsü boşluk ölçüsüne eşit kabul edildi.')
    } else if (item.shape !== 'dikdortgen') {
      warnings.push('Montaj payı yalnızca dikdörtgen pozlarda uygulanır; doğrama alanı boşluk alanına eşit kabul edildi.')
    } else if (g < 0 || 2 * g >= Math.min(item.width_mm ?? 0, item.height_mm ?? 0)) {
      errors.push({ field: 'install_gap_mm', message: 'Montaj payı geçersiz (negatif veya ölçüden büyük).' })
      return
    } else {
      frameDims = { ...item, width_mm: item.width_mm! - 2 * g, height_mm: item.height_mm! - 2 * g }
    }
  }
  const frame = computeShape(frameDims)
  if (!frame.result) {
    if (required) errors.push(...frame.errors)
    return
  }
  const shape = frame.result
  res.shape = shape
  // Dikdörtgende alan tamsayı dmm² ile kesin hesaplanır
  const areaMilli = (s: ShapeResult, d: typeof item) =>
    d.shape === 'dikdortgen' && s.exactInteger ? rectMilli(d.width_mm!, d.height_mm!) : toMilli(s.area / 1e6)
  res.unit.frameArea = areaMilli(shape, frameDims)
  res.unit.perimeter = toMilli(shape.perimeter / 1000)
  res.total.frameArea = milliTimesQtyToCenti(res.unit.frameArea, q)
  res.total.perimeter = milliTimesQtyToCenti(res.unit.perimeter, q)
  if (openingShape) {
    res.unit.openingArea = areaMilli(openingShape, item)
    res.total.openingArea = milliTimesQtyToCenti(res.unit.openingArea, q)
  }
  if (item.shape === 'manuel') warnings.push('Alan elle girildi; çizimden doğrulanmadı.')
  if (item.shape === 'cokgen') warnings.push('Düzensiz geometri: alan köşe koordinatlarından hesaplandı.')

  // Cam alanı
  if (item.glass_mode !== 'yok') {
    if (!glassAllowed) {
      warnings.push('Bu iş grubunda cam alanı hesaplanmaz.')
    } else if (item.glass_mode === 'manuel') {
      const g = item.glass_manual_m2
      if (g == null || !(g > 0)) errors.push({ field: 'glass_manual_m2', message: 'Birim cam alanı (m²) girilmelidir.' })
      else if (g * 1e6 > shape.area + 1e-6) errors.push({ field: 'glass_manual_m2', message: 'Cam alanı doğrama alanından büyük olamaz.' })
      else {
        res.unit.glassArea = toMilli(g)
        res.total.glassArea = milliTimesQtyToCenti(res.unit.glassArea, q)
      }
    } else {
      const d = item.glass_deduction_mm
      if (frameDims.shape !== 'dikdortgen') {
        errors.push({ field: 'glass_deduction_mm', message: 'Profil düşümü yalnızca dikdörtgende uygulanır; cam alanını elle girin.' })
      } else if (d == null || d < 0 || 2 * d >= Math.min(frameDims.width_mm!, frameDims.height_mm!)) {
        errors.push({ field: 'glass_deduction_mm', message: 'Profil düşümü geçersiz.' })
      } else {
        res.unit.glassArea = rectMilli(frameDims.width_mm! - 2 * d, frameDims.height_mm! - 2 * d)
        res.total.glassArea = milliTimesQtyToCenti(res.unit.glassArea, q)
        warnings.push('Cam alanı tek düşüm değeriyle tahmin edildi; kanat ve kayıt profilleri ayrıca düşülmedi.')
      }
    }
  }
}

/** Dikdörtgen alanı: mm (0,1 hassasiyet) → tamsayı dmm² → 0,001 m² (yarım yukarı) */
export function rectMilli(wMm: number, hMm: number): number {
  const w = Math.round(Number((wMm * 10).toPrecision(15)))
  const h = Math.round(Number((hMm * 10).toPrecision(15)))
  const dmm2 = w * h // 1 m² = 1e8 dmm²; 0,001 m² = 1e5 dmm²
  return Math.floor((dmm2 + 50_000) / 100_000)
}

function finalize(res: ItemResult, item: QuantityItemInput) {
  res.counted = res.ok && item.verification === 'onaylandi'
  res.pending = item.verification === 'bekliyor'
}

// ------------------------------------------------------------------ Toplamlar

export interface TotalsBucket {
  items: number
  pieces: number
  /** ×100 tamsayılar */
  frameArea: number
  openingArea: number
  perimeter: number
  glassArea: number
  length: number
  kg: number
}

const bucket = (): TotalsBucket => ({ items: 0, pieces: 0, frameArea: 0, openingArea: 0, perimeter: 0, glassArea: 0, length: 0, kg: 0 })

export interface Totals {
  /** Yalnızca onaylı ve hatasız kalemler */
  verified: TotalsBucket
  /** Doğrulama bekleyen (hatasız) kalemler — kesin metraja dahil değildir */
  pending: TotalsBucket
  byCategory: { category: QuantityCategory; verified: TotalsBucket; pending: TotalsBucket }[]
  rejected: number
  invalid: number
}

function add(b: TotalsBucket, r: ItemResult, item: QuantityItemInput) {
  b.items++
  b.pieces += item.quantity
  b.frameArea += r.total.frameArea
  b.openingArea += r.total.openingArea
  b.perimeter += r.total.perimeter
  b.glassArea += r.total.glassArea
  b.length += r.total.length
  if (r.primary?.unit === 'kg') b.kg += r.primary.centi
}

export function summarize(items: QuantityItemInput[], results?: ItemResult[]): Totals {
  const res = results ?? items.map(computeItem)
  const t: Totals = { verified: bucket(), pending: bucket(), byCategory: [], rejected: 0, invalid: 0 }
  const cats = new Map<QuantityCategory, { verified: TotalsBucket; pending: TotalsBucket }>()
  items.forEach((item, i) => {
    const r = res[i]
    if (item.verification === 'reddedildi') {
      t.rejected++
      return
    }
    if (!r.ok) {
      t.invalid++
      return
    }
    let c = cats.get(item.category)
    if (!c) {
      c = { verified: bucket(), pending: bucket() }
      cats.set(item.category, c)
    }
    if (r.counted) {
      add(t.verified, r, item)
      add(c.verified, r, item)
    } else if (r.pending) {
      add(t.pending, r, item)
      add(c.pending, r, item)
    }
  })
  const order = Object.keys(CATEGORY_INFO) as QuantityCategory[]
  t.byCategory = [...cats.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([category, v]) => ({ category, ...v }))
  return t
}
