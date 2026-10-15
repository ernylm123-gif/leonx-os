/**
 * Çizgi parçası dizini (PDF sayfa noktası): ölçek çıkarımı, açıklık doğrulaması, görünüş çizimi
 * analizi ve çizelge hücresi bulma için ortak ızgara dizini.
 */
import type { Scene } from '../types'
import { GLYPH_LAYER } from './pdfScene'

export interface Segs {
  x1: Float64Array
  y1: Float64Array
  x2: Float64Array
  y2: Float64Array
  len: Float64Array
  id: Int32Array
  n: number
  grid: Map<string, number[]>
  cell: number
}

const MAX_SEGS = 400_000

export function segmentIndex(scene: Scene | null): Segs {
  const xs1: number[] = []
  const ys1: number[] = []
  const xs2: number[] = []
  const ys2: number[] = []
  const ls: number[] = []
  const ids: number[] = []
  if (scene) {
    const c = scene.coords
    for (const e of scene.entities) {
      if (e.kind !== 'path' || e.type === 'PDF_FILL' || e.layer === GLYPH_LAYER) continue
      const n = e.count + (e.closed ? 0 : -1)
      for (let i = 0; i < n && xs1.length < MAX_SEGS; i++) {
        const j = (i + 1) % e.count
        const x1 = c[e.start + 2 * i]
        const y1 = c[e.start + 2 * i + 1]
        const x2 = c[e.start + 2 * j]
        const y2 = c[e.start + 2 * j + 1]
        const l = Math.hypot(x2 - x1, y2 - y1)
        if (l < 1.5) continue
        xs1.push(x1)
        ys1.push(y1)
        xs2.push(x2)
        ys2.push(y2)
        ls.push(l)
        ids.push(e.id)
      }
    }
  }
  const cell = 40
  const grid = new Map<string, number[]>()
  for (let i = 0; i < xs1.length; i++) {
    const cx0 = Math.floor(Math.min(xs1[i], xs2[i]) / cell)
    const cx1 = Math.floor(Math.max(xs1[i], xs2[i]) / cell)
    const cy0 = Math.floor(Math.min(ys1[i], ys2[i]) / cell)
    const cy1 = Math.floor(Math.max(ys1[i], ys2[i]) / cell)
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 400) continue // çok uzun çizgiler (pafta çerçevesi) dizine girmez
    for (let gx = cx0; gx <= cx1; gx++)
      for (let gy = cy0; gy <= cy1; gy++) {
        const k = `${gx},${gy}`
        const arr = grid.get(k)
        if (arr) arr.push(i)
        else grid.set(k, [i])
      }
  }
  return {
    x1: Float64Array.from(xs1),
    y1: Float64Array.from(ys1),
    x2: Float64Array.from(xs2),
    y2: Float64Array.from(ys2),
    len: Float64Array.from(ls),
    id: Int32Array.from(ids),
    n: xs1.length,
    grid,
    cell,
  }
}

export function segsNear(s: Segs, x: number, y: number, r: number): number[] {
  const out = new Set<number>()
  const c = s.cell
  for (let gx = Math.floor((x - r) / c); gx <= Math.floor((x + r) / c); gx++)
    for (let gy = Math.floor((y - r) / c); gy <= Math.floor((y + r) / c); gy++) {
      const arr = s.grid.get(`${gx},${gy}`)
      if (arr) for (const i of arr) out.add(i)
    }
  return [...out]
}


/** Kutu içinde (iki ucu da kutuda, tol kadar pay) kalan parçalar */
export function segsInBox(s: Segs, b: readonly [number, number, number, number], tol = 0.5): number[] {
  const out = new Set<number>()
  const c = s.cell
  for (let gx = Math.floor((b[0] - tol) / c); gx <= Math.floor((b[2] + tol) / c); gx++)
    for (let gy = Math.floor((b[1] - tol) / c); gy <= Math.floor((b[3] + tol) / c); gy++) {
      const arr = s.grid.get(`${gx},${gy}`)
      if (!arr) continue
      for (const i of arr) {
        if (out.has(i)) continue
        const inside = (x: number, y: number) => x >= b[0] - tol && x <= b[2] + tol && y >= b[1] - tol && y <= b[3] + tol
        if (inside(s.x1[i], s.y1[i]) && inside(s.x2[i], s.y2[i])) out.add(i)
      }
    }
  return [...out]
}

/** Yatay parça mı (eğim toleransı oranı) */
export const isHorizontal = (s: Segs, i: number, tol = 0.02) => Math.abs(s.y2[i] - s.y1[i]) <= tol * s.len[i]
export const isVertical = (s: Segs, i: number, tol = 0.02) => Math.abs(s.x2[i] - s.x1[i]) <= tol * s.len[i]
