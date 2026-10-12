import type { BBox } from '../geometry'

/**
 * Düzgün ızgara tabanlı uzamsal dizin: nesne sınır kutularını hücrelere yerleştirir.
 * Seçim (hit-test), yakalama (snap) ve görünür metin taraması için kullanılır.
 * Çok büyük nesneler (birçok hücreyi kaplayan) ayrı listede tutulur.
 */
export class SpatialGrid {
  private readonly cells: Map<number, number[]> = new Map()
  private readonly big: number[] = []
  private readonly cell: number
  private readonly x0: number
  private readonly y0: number
  private readonly cols: number
  private readonly rows: number

  constructor(bounds: BBox, private readonly boxes: (BBox | null)[], targetPerCell = 8) {
    const w = Math.max(bounds[2] - bounds[0], 1e-9)
    const h = Math.max(bounds[3] - bounds[1], 1e-9)
    const n = Math.max(1, boxes.length)
    const cellCount = Math.min(1 << 20, Math.max(1, Math.ceil(n / targetPerCell)))
    this.cell = Math.max(Math.sqrt((w * h) / cellCount), Math.max(w, h) / 2048)
    this.x0 = bounds[0]
    this.y0 = bounds[1]
    this.cols = Math.max(1, Math.ceil(w / this.cell) + 1)
    this.rows = Math.max(1, Math.ceil(h / this.cell) + 1)
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]
      if (!b || !Number.isFinite(b[0])) continue
      const [c0, r0, c1, r1] = this.range(b)
      if ((c1 - c0 + 1) * (r1 - r0 + 1) > 64) {
        this.big.push(i)
        continue
      }
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const key = r * this.cols + c
          let list = this.cells.get(key)
          if (!list) {
            list = []
            this.cells.set(key, list)
          }
          list.push(i)
        }
      }
    }
  }

  private range(b: BBox): [number, number, number, number] {
    const clampC = (v: number) => Math.max(0, Math.min(this.cols - 1, v))
    const clampR = (v: number) => Math.max(0, Math.min(this.rows - 1, v))
    return [
      clampC(Math.floor((b[0] - this.x0) / this.cell)),
      clampR(Math.floor((b[1] - this.y0) / this.cell)),
      clampC(Math.floor((b[2] - this.x0) / this.cell)),
      clampR(Math.floor((b[3] - this.y0) / this.cell)),
    ]
  }

  /** Sorgu kutusuyla kesişebilecek nesne indeksleri (tekrarsız) */
  query(b: BBox, limit = Infinity): number[] {
    const out: number[] = []
    const seen = new Set<number>()
    const add = (i: number) => {
      if (seen.has(i)) return
      const bb = this.boxes[i]
      if (!bb || bb[0] > b[2] || bb[2] < b[0] || bb[1] > b[3] || bb[3] < b[1]) return
      seen.add(i)
      out.push(i)
    }
    for (const i of this.big) add(i)
    const [c0, r0, c1, r1] = this.range(b)
    // Çok geniş sorgularda hücre sayısı sınırlanır (görünür metin taraması)
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > 200_000) {
      for (let i = 0; i < this.boxes.length && out.length < limit; i++) add(i)
      return out
    }
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const list = this.cells.get(r * this.cols + c)
        if (!list) continue
        for (const i of list) {
          add(i)
          if (out.length >= limit) return out
        }
      }
    }
    return out
  }
}
