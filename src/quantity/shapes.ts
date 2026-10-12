/**
 * Şekil geometrisi: alan (mm²) ve çevre (mm). Dikdörtgen formülü YALNIZCA dikdörtgende
 * kullanılır; diğer şekiller kendi geometrik yöntemiyle hesaplanır.
 *
 *  Dikdörtgen   A = G × Y,                 Ç = 2(G + Y)
 *  Üçgen        A = G × Y / 2,             Ç = G + √(a² + Y²) + √((G − a)² + Y²)    (a: tepe konumu)
 *  Yamuk        A = G × (Y₁ + Y₂) / 2,     Ç = G + Y₁ + Y₂ + √(G² + (Y₂ − Y₁)²)     (eğik üst kenar)
 *  Kemerli      A = G × (Y − s) + R²(θ − sin θ)/2,  Ç = G + 2(Y − s) + Rθ
 *               (s: kemer sehimi, R = (G²/4 + s²)/(2s), θ = 2·asin(G/(2R)); s = G/2 → yarım daire)
 *  Daire        A = π G² / 4,              Ç = π G   (G: çap)
 *  Çokgen       A = |Σ(xᵢyᵢ₊₁ − xᵢ₊₁yᵢ)| / 2 (shoelace), Ç = Σ kenar uzunlukları
 */
import { PRECISION } from './precision'
import type { QuantityItemInput, ShapeKind } from './types'

export interface ShapeResult {
  /** mm² */
  area: number
  /** mm */
  perimeter: number
  /** Dikdörtgen sınır kutusu genişliği/yüksekliği (mm) — gösterim için */
  boxW: number
  boxH: number
  /** Hesap tamsayı ölçülerle kesin mi (dikdörtgen, üçgen alanı, yamuk alanı) */
  exactInteger: boolean
}

export interface ShapeError {
  field: keyof QuantityItemInput | 'shape'
  message: string
}

type Dims = Pick<QuantityItemInput, 'shape' | 'width_mm' | 'height_mm' | 'height2_mm' | 'apex_mm' | 'rise_mm' | 'vertices' | 'manual_area_m2' | 'manual_perimeter_m'>

function checkDim(v: number | null, field: ShapeError['field'], label: string, errors: ShapeError[]): number {
  if (v == null || !Number.isFinite(v)) {
    errors.push({ field, message: `${label} girilmelidir.` })
    return 0
  }
  if (v <= 0) {
    errors.push({ field, message: `${label} sıfırdan büyük olmalıdır.` })
    return 0
  }
  if (v < PRECISION.minDimensionMm) errors.push({ field, message: `${label} en az ${PRECISION.minDimensionMm} mm olmalıdır.` })
  if (v > PRECISION.maxDimensionMm) errors.push({ field, message: `${label} ${PRECISION.maxDimensionMm / 1000} m sınırını aşıyor.` })
  return v
}

/** Çokgenin kendini kesip kesmediği (basit O(n²) kontrol) */
export function isSelfIntersecting(v: [number, number][]): boolean {
  const n = v.length
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  for (let i = 0; i < n; i++) {
    const a1 = v[i]
    const a2 = v[(i + 1) % n]
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue
      const b1 = v[j]
      const b2 = v[(j + 1) % n]
      const d1 = cross(a1, a2, b1)
      const d2 = cross(a1, a2, b2)
      const d3 = cross(b1, b2, a1)
      const d4 = cross(b1, b2, a2)
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
    }
  }
  return false
}

export function computeShape(d: Dims): { result: ShapeResult | null; errors: ShapeError[] } {
  const errors: ShapeError[] = []
  const shape: ShapeKind = d.shape
  let r: ShapeResult | null = null
  switch (shape) {
    case 'dikdortgen': {
      const w = checkDim(d.width_mm, 'width_mm', 'Genişlik', errors)
      const h = checkDim(d.height_mm, 'height_mm', 'Yükseklik', errors)
      if (!errors.length) r = { area: w * h, perimeter: 2 * (w + h), boxW: w, boxH: h, exactInteger: true }
      break
    }
    case 'ucgen': {
      const w = checkDim(d.width_mm, 'width_mm', 'Taban genişliği', errors)
      const h = checkDim(d.height_mm, 'height_mm', 'Yükseklik', errors)
      const a = d.apex_mm ?? w / 2
      if (a < 0 || a > w) errors.push({ field: 'apex_mm', message: 'Tepe noktası taban genişliği içinde olmalıdır (0 – genişlik).' })
      if (!errors.length) r = { area: (w * h) / 2, perimeter: w + Math.hypot(a, h) + Math.hypot(w - a, h), boxW: w, boxH: h, exactInteger: true }
      break
    }
    case 'yamuk': {
      const w = checkDim(d.width_mm, 'width_mm', 'Taban genişliği', errors)
      const h1 = checkDim(d.height_mm, 'height_mm', 'Sol yükseklik', errors)
      const h2 = checkDim(d.height2_mm, 'height2_mm', 'Sağ yükseklik', errors)
      if (!errors.length) {
        r = { area: (w * (h1 + h2)) / 2, perimeter: w + h1 + h2 + Math.hypot(w, h2 - h1), boxW: w, boxH: Math.max(h1, h2), exactInteger: true }
      }
      break
    }
    case 'kemerli': {
      const w = checkDim(d.width_mm, 'width_mm', 'Genişlik', errors)
      const h = checkDim(d.height_mm, 'height_mm', 'Toplam yükseklik', errors)
      const s = checkDim(d.rise_mm, 'rise_mm', 'Kemer yüksekliği', errors)
      if (!errors.length && s > w / 2 + 1e-9) errors.push({ field: 'rise_mm', message: 'Kemer yüksekliği genişliğin yarısını aşamaz (yarım daire en fazla).' })
      if (!errors.length && s > h) errors.push({ field: 'rise_mm', message: 'Kemer yüksekliği toplam yükseklikten büyük olamaz.' })
      if (!errors.length) {
        const R = (w * w) / 4 / (2 * s) + s / 2
        const theta = 2 * Math.asin(Math.min(1, w / (2 * R)))
        const seg = ((R * R) / 2) * (theta - Math.sin(theta))
        const straight = h - s
        r = { area: w * straight + seg, perimeter: w + 2 * straight + R * theta, boxW: w, boxH: h, exactInteger: false }
      }
      break
    }
    case 'daire': {
      const dia = checkDim(d.width_mm, 'width_mm', 'Çap', errors)
      if (!errors.length) r = { area: (Math.PI * dia * dia) / 4, perimeter: Math.PI * dia, boxW: dia, boxH: dia, exactInteger: false }
      break
    }
    case 'cokgen': {
      const v = d.vertices ?? []
      if (v.length < 3) {
        errors.push({ field: 'vertices', message: 'Çokgen için en az 3 köşe gerekir.' })
        break
      }
      if (v.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) {
        errors.push({ field: 'vertices', message: 'Köşe koordinatları geçersiz.' })
        break
      }
      if (isSelfIntersecting(v)) {
        errors.push({ field: 'vertices', message: 'Çokgen kendini kesiyor; alan güvenilir hesaplanamaz.' })
        break
      }
      let a = 0
      let p = 0
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (let i = 0; i < v.length; i++) {
        const [x1, y1] = v[i]
        const [x2, y2] = v[(i + 1) % v.length]
        a += x1 * y2 - x2 * y1
        p += Math.hypot(x2 - x1, y2 - y1)
        minX = Math.min(minX, x1)
        minY = Math.min(minY, y1)
        maxX = Math.max(maxX, x1)
        maxY = Math.max(maxY, y1)
      }
      const area = Math.abs(a) / 2
      if (!(area > 0)) {
        errors.push({ field: 'vertices', message: 'Çokgen alanı sıfır.' })
        break
      }
      if (maxX - minX > PRECISION.maxDimensionMm || maxY - minY > PRECISION.maxDimensionMm) {
        errors.push({ field: 'vertices', message: `Çokgen ${PRECISION.maxDimensionMm / 1000} m sınırını aşıyor.` })
        break
      }
      r = { area, perimeter: p, boxW: maxX - minX, boxH: maxY - minY, exactInteger: false }
      break
    }
    case 'manuel': {
      const a = d.manual_area_m2
      if (a == null || !Number.isFinite(a) || a <= 0) {
        errors.push({ field: 'manual_area_m2', message: 'Alan (m²) sıfırdan büyük girilmelidir.' })
        break
      }
      if (a > 10_000) {
        errors.push({ field: 'manual_area_m2', message: 'Tek kalem alanı 10.000 m² sınırını aşıyor.' })
        break
      }
      const pm = d.manual_perimeter_m
      if (pm != null && (!Number.isFinite(pm) || pm < 0)) errors.push({ field: 'manual_perimeter_m', message: 'Çevre negatif olamaz.' })
      r = { area: a * 1e6, perimeter: (pm ?? 0) * 1000, boxW: d.width_mm ?? 0, boxH: d.height_mm ?? 0, exactInteger: false }
      break
    }
  }
  return { result: errors.length ? null : r, errors }
}
