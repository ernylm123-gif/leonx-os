/**
 * CAD geometri yardımcıları: 2B afin dönüşümler, DXF nesne koordinat sistemi (OCS),
 * yay/bulge parçalama, alan ve uzunluk hesapları.
 *
 * Tüm fonksiyonlar saftır (yan etkisiz); Web Worker içinde ve testlerde aynı şekilde çalışır.
 */

/** Afin dönüşüm: x' = a·x + c·y + e, y' = b·x + d·y + f */
export type Mat = readonly [number, number, number, number, number, number]

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

/** m1 ∘ m2: önce m2, sonra m1 uygulanır. */
export function mul(m1: Mat, m2: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y]
export const scale = (sx: number, sy: number): Mat => [sx, 0, 0, sy, 0, 0]
export function rotate(rad: number): Mat {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [c, s, -s, c, 0, 0]
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

export const det = (m: Mat): number => m[0] * m[3] - m[1] * m[2]

export function invert(m: Mat): Mat | null {
  const d = det(m)
  if (!Number.isFinite(d) || Math.abs(d) < 1e-300) return null
  const [a, b, c, dd, e, f] = m
  return [dd / d, -b / d, -c / d, a / d, (c * f - dd * e) / d, (b * e - a * f) / d]
}

/** Dönüşüm eksenlerinin uzunlukları (x ve y yönündeki ölçek) */
export function axisScales(m: Mat): [number, number] {
  return [Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3])]
}

/** Eksenler eşit uzunlukta ve dik mi? (Daire daire olarak kalır, uzunluklar tek katsayıyla ölçeklenir.) */
export function isSimilarity(m: Mat, tol = 1e-9): boolean {
  const [sx, sy] = axisScales(m)
  if (sx === 0 || sy === 0) return false
  const dot = m[0] * m[2] + m[1] * m[3]
  return Math.abs(sx - sy) <= tol * Math.max(sx, sy) && Math.abs(dot) <= tol * sx * sy
}

// ------------------------------------------------------------------ OCS (Arbitrary Axis Algorithm)

type V3 = [number, number, number]

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2])
  return l === 0 ? [0, 0, 0] : [v[0] / l, v[1] / l, v[2] / l]
}

/**
 * DXF "Arbitrary Axis Algorithm": nesne koordinat sisteminden (OCS) dünya koordinatlarına
 * geçiş. Sonuç XY düzlemine izdüşürülmüş 2B afin dönüşümdür (üstten görünüş).
 * extrusion (0,0,1) ise birim dönüşüm; (0,0,-1) ise X ekseni aynalanır.
 */
export function ocsToWcs(extrusion: V3 | null | undefined, elevation = 0): Mat {
  // Varsayılan extrusion (0,0,1): yükseklik (Z) üstten görünüşte konumu değiştirmez
  if (!extrusion) return IDENTITY
  const n = norm(extrusion)
  if (n[0] === 0 && n[1] === 0 && n[2] === 0) return IDENTITY
  if (Math.abs(n[0]) < 1e-12 && Math.abs(n[1]) < 1e-12 && n[2] > 0) return IDENTITY
  const ax = norm(Math.abs(n[0]) < 1 / 64 && Math.abs(n[1]) < 1 / 64 ? cross([0, 1, 0], n) : cross([0, 0, 1], n))
  const ay = norm(cross(n, ax))
  return [ax[0], ax[1], ay[0], ay[1], n[0] * elevation, n[1] * elevation]
}

/** Extrusion Z eksenine paralel değilse (eğik düzlem) izdüşüm uyarısı gerekir. */
export function isTilted(extrusion: V3 | null | undefined): boolean {
  if (!extrusion) return false
  const n = norm(extrusion)
  return Math.abs(Math.abs(n[2]) - 1) > 1e-9
}

/** Normal vektörü n olan düzlemde, ana eksene dik ikinci eksen (ELLIPSE için): n × major */
export function minorAxis(extrusion: V3 | null | undefined, major: V3, ratio: number): [number, number] {
  const n = norm(extrusion ?? [0, 0, 1])
  const m = cross(n, major)
  return [m[0] * ratio, m[1] * ratio]
}

// ------------------------------------------------------------------ Yay parçalama

/** Ekran ve seçim için yay adımı (derece). Ölçüm hesapları analitik yapılır, bu değere bağlı değildir. */
export const ARC_STEP_DEG = 2.5

export function arcSegments(sweepRad: number): number {
  const n = Math.ceil(Math.abs(sweepRad) / ((ARC_STEP_DEG * Math.PI) / 180))
  return Math.min(512, Math.max(2, n))
}

/** Saat yönü tersine (CCW) normalize edilmiş tarama açısı: 0 < sweep ≤ 2π */
export function ccwSweep(startRad: number, endRad: number): number {
  let s = endRad - startRad
  while (s <= 0) s += 2 * Math.PI
  while (s > 2 * Math.PI + 1e-12) s -= 2 * Math.PI
  return s
}

/** Merkez, yarıçap ve açılarla yay noktaları (başlangıç ve bitiş dahil) */
export function arcPoints(cx: number, cy: number, r: number, startRad: number, sweepRad: number): number[] {
  const n = arcSegments(sweepRad)
  const out: number[] = []
  for (let i = 0; i <= n; i++) {
    const t = startRad + (sweepRad * i) / n
    out.push(cx + r * Math.cos(t), cy + r * Math.sin(t))
  }
  return out
}

/** Bulge'lı polyline parçası için yay bilgisi. bulge = tan(θ/4), θ: merkez açısı (işaretli). */
export function bulgeArc(x1: number, y1: number, x2: number, y2: number, bulge: number) {
  const theta = 4 * Math.atan(bulge)
  const dx = x2 - x1
  const dy = y2 - y1
  const chord = Math.hypot(dx, dy)
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2))
  // Merkez, kiriş ortasından sol dik yönde (chord/2)·cot(θ/2) uzaklıktadır (işaretli).
  // bulge > 0: p1→p2 saat yönü tersine yay; bulge < 0: saat yönünde yay.
  const d = chord / 2 / Math.tan(theta / 2)
  const cx = (x1 + x2) / 2 + (-dy / chord) * d
  const cy = (y1 + y2) / 2 + (dx / chord) * d
  return { cx, cy, r, theta, chord }
}

/** Bulge'lı parçanın ara noktaları (başlangıç hariç, bitiş dahil) */
export function bulgePoints(x1: number, y1: number, x2: number, y2: number, bulge: number): number[] {
  if (!bulge || Math.abs(bulge) < 1e-12 || (x1 === x2 && y1 === y2)) return [x2, y2]
  const { cx, cy, r, theta } = bulgeArc(x1, y1, x2, y2, bulge)
  const a0 = Math.atan2(y1 - cy, x1 - cx)
  const n = arcSegments(theta)
  const out: number[] = []
  for (let i = 1; i < n; i++) {
    const t = a0 + (theta * i) / n
    out.push(cx + r * Math.cos(t), cy + r * Math.sin(t))
  }
  out.push(x2, y2)
  return out
}

/** Bulge'lı parçanın gerçek yay uzunluğu */
export function bulgeLength(x1: number, y1: number, x2: number, y2: number, bulge: number): number {
  const chord = Math.hypot(x2 - x1, y2 - y1)
  if (!bulge || Math.abs(bulge) < 1e-12) return chord
  const theta = 4 * Math.atan(bulge)
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2))
  return Math.abs(r * theta)
}

/**
 * Bulge yayının kiriş ile arasında kalan dairesel parça alanı (işaretli).
 * Kapalı polyline alanı = çokgen (kirişler) alanı + Σ parça alanları.
 */
export function bulgeSegmentArea(x1: number, y1: number, x2: number, y2: number, bulge: number): number {
  if (!bulge || Math.abs(bulge) < 1e-12) return 0
  const chord = Math.hypot(x2 - x1, y2 - y1)
  const theta = 4 * Math.atan(bulge)
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2))
  const seg = ((r * r) / 2) * (Math.abs(theta) - Math.sin(Math.abs(theta)))
  return bulge > 0 ? seg : -seg
}

// ------------------------------------------------------------------ Ölçüler

/** İşaretli alan (shoelace). coords: [x0,y0,x1,y1,...]; CCW pozitif. */
export function signedArea(coords: ArrayLike<number>, start = 0, count = coords.length / 2): number {
  let s = 0
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count
    const xi = coords[start + 2 * i]
    const yi = coords[start + 2 * i + 1]
    const xj = coords[start + 2 * j]
    const yj = coords[start + 2 * j + 1]
    s += xi * yj - xj * yi
  }
  return s / 2
}

export function polylineLength(coords: ArrayLike<number>, closed: boolean, start = 0, count = coords.length / 2): number {
  let l = 0
  for (let i = 1; i < count; i++) {
    l += Math.hypot(coords[start + 2 * i] - coords[start + 2 * i - 2], coords[start + 2 * i + 1] - coords[start + 2 * i - 1])
  }
  if (closed && count > 2) {
    l += Math.hypot(coords[start] - coords[start + 2 * count - 2], coords[start + 1] - coords[start + 2 * count - 1])
  }
  return l
}

export type BBox = [number, number, number, number]

export const EMPTY_BBOX = (): BBox => [Infinity, Infinity, -Infinity, -Infinity]

export function bboxOf(coords: ArrayLike<number>, start = 0, count = coords.length / 2): BBox {
  const b = EMPTY_BBOX()
  for (let i = 0; i < count; i++) {
    const x = coords[start + 2 * i]
    const y = coords[start + 2 * i + 1]
    if (x < b[0]) b[0] = x
    if (y < b[1]) b[1] = y
    if (x > b[2]) b[2] = x
    if (y > b[3]) b[3] = y
  }
  return b
}

export function bboxUnion(a: BBox, b: BBox): BBox {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}

export const bboxValid = (b: BBox): boolean => Number.isFinite(b[0]) && Number.isFinite(b[1]) && b[2] >= b[0] && b[3] >= b[1]

export function transformBBox(m: Mat, b: BBox): BBox {
  const pts = [apply(m, b[0], b[1]), apply(m, b[2], b[1]), apply(m, b[2], b[3]), apply(m, b[0], b[3])]
  return bboxOf(pts.flat())
}

/** Nokta-çokgen içerme (çift-tek kuralı) */
export function pointInPolygon(x: number, y: number, coords: ArrayLike<number>, start = 0, count = coords.length / 2): boolean {
  let inside = false
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = coords[start + 2 * i]
    const yi = coords[start + 2 * i + 1]
    const xj = coords[start + 2 * j]
    const yj = coords[start + 2 * j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Noktanın doğru parçasına uzaklığı */
export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const l2 = dx * dx + dy * dy
  let t = l2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Kapalı dört köşeli şekil dik açılı mı? Dikdörtgense genişlik/yükseklik/açı döner. */
export function rectOf(w: ArrayLike<number>): { w: number; h: number; angle: number } | null {
  if (w.length !== 8) return null
  const vx: number[] = []
  const vy: number[] = []
  for (let i = 0; i < 4; i++) {
    vx.push(w[((i + 1) % 4) * 2] - w[i * 2])
    vy.push(w[((i + 1) % 4) * 2 + 1] - w[i * 2 + 1])
  }
  const lens = vx.map((x, i) => Math.hypot(x, vy[i]))
  if (lens.some((l) => l === 0)) return null
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    const cos = (vx[i] * vx[j] + vy[i] * vy[j]) / (lens[i] * lens[j])
    if (Math.abs(cos) > 1e-6) return null
  }
  if (Math.abs(lens[0] - lens[2]) > 1e-6 * lens[0] || Math.abs(lens[1] - lens[3]) > 1e-6 * lens[1]) return null
  let angle = Math.atan2(vy[0], vx[0])
  let wd = lens[0]
  let ht = lens[1]
  // Yatay yakın kenar genişlik kabul edilir
  const norm = ((angle % Math.PI) + Math.PI) % Math.PI
  if (norm > Math.PI / 4 && norm < (3 * Math.PI) / 4) {
    ;[wd, ht] = [ht, wd]
    angle = Math.atan2(vy[1], vx[1])
  }
  return { w: wd, h: ht, angle }
}
