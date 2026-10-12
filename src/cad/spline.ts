/**
 * NURBS / B-spline eğri değerlendirme (de Boor algoritması). SPLINE nesneleri ekranda
 * gösterim ve yaklaşık uzunluk için noktalara çevrilir; sonuç YAKLAŞIKTIR.
 */

export interface SplineInput {
  degree: number
  knots: number[]
  control: number[] // x0,y0,x1,y1,...
  weights?: number[] | null
}

export function evaluateSpline(s: SplineInput, segments: number): number[] | null {
  const p = s.degree
  const n = s.control.length / 2
  const U = s.knots
  if (p < 1 || n < p + 1 || U.length !== n + p + 1) return null
  const w = s.weights && s.weights.length === n ? s.weights : null
  const u0 = U[p]
  const u1 = U[n]
  if (!(u1 > u0)) return null
  const out: number[] = []
  // Homojen kontrol noktaları
  const P: number[][] = []
  for (let i = 0; i < n; i++) {
    const wi = w ? w[i] : 1
    P.push([s.control[2 * i] * wi, s.control[2 * i + 1] * wi, wi])
  }
  for (let k = 0; k <= segments; k++) {
    let u = u0 + ((u1 - u0) * k) / segments
    if (k === segments) u = u1 - 1e-12 * (u1 - u0)
    // Düğüm aralığı
    let span = p
    while (span < n - 1 && u >= U[span + 1]) span++
    const d: number[][] = []
    for (let j = 0; j <= p; j++) d.push(P[span - p + j].slice())
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = span - p + j
        const den = U[i + p - r + 1] - U[i]
        const a = den === 0 ? 0 : (u - U[i]) / den
        d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1], (1 - a) * d[j - 1][2] + a * d[j][2]]
      }
    }
    const hw = d[p][2] || 1
    out.push(d[p][0] / hw, d[p][1] / hw)
  }
  return out
}

/**
 * Yalnızca uydurma (fit) noktası olan SPLINE'lar için noktalardan geçen düzgün eğri
 * (centripetal Catmull-Rom). AutoCAD'in kendi eğrisiyle birebir aynı DEĞİLDİR; yaklaşık gösterimdir.
 */
export function catmullRom(points: number[], perSegment = 16): number[] {
  const n = points.length / 2
  if (n < 3) return points.slice()
  const P = (i: number): [number, number] => {
    const k = Math.max(0, Math.min(n - 1, i))
    return [points[2 * k], points[2 * k + 1]]
  }
  const out: number[] = [points[0], points[1]]
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1)
    const p1 = P(i)
    const p2 = P(i + 1)
    const p3 = P(i + 2)
    const td = (a: [number, number], b: [number, number]) => Math.max(1e-12, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])))
    const t0 = 0
    const t1 = t0 + td(p0, p1)
    const t2 = t1 + td(p1, p2)
    const t3 = t2 + td(p2, p3)
    for (let s = 1; s <= perSegment; s++) {
      const t = t1 + ((t2 - t1) * s) / perSegment
      const lerp = (a: [number, number], b: [number, number], ta: number, tb: number): [number, number] => {
        const f = tb === ta ? 0 : (t - ta) / (tb - ta)
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
      }
      const a1 = lerp(p0, p1, t0, t1)
      const a2 = lerp(p1, p2, t1, t2)
      const a3 = lerp(p2, p3, t2, t3)
      const b1 = lerp(a1, a2, t0, t2)
      const b2 = lerp(a2, a3, t1, t3)
      const c = lerp(b1, b2, t1, t2)
      out.push(c[0], c[1])
    }
  }
  return out
}
