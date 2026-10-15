/**
 * Doğrama görünüş çizimi analizi (Faz 5.2): kasa içindeki kayıtlar (düşey/yatay bölme), her
 * bölmenin açılım sembolü ve kanat sayısı.
 *
 * Mimari çizim kuralı (TS EN 12519 / DIN 1356): görünüşte açılır kanadın köşelerinden çıkan iki
 * çizgi MENTEŞE tarafında birleşir. Tepe yanda → yandan açılır; altta → vasistas (alttan
 * menteşeli); üstte → üstten askılı; yan + alt → çift açılım. Sürme kanat ok ile gösterilir.
 * Sembol yoksa bölme sabit kabul edilir — ancak bu yalnız ADAYDIR (çizimde sembol unutulmuş
 * olabilir; içten/dıştan bakış sağ-sol menteşeyi değiştirir).
 *
 * Kesik çizgiler (CAD çıktısında parçalara bölünmüş olabilir) çizgi boyunca örnekleme ile
 * tanınır: teorik çizginin en az yarısı çizimde varsa çizgi var sayılır.
 */
import type { BBox } from '../geometry'
import { isHorizontal, isVertical, type Segs, segsInBox } from './segments'

export type PanelOpening = 'sabit' | 'acilir' | 'vasistas' | 'cift_acilim' | 'ust_askili' | 'surme'

export const PANEL_LABEL: Record<PanelOpening, string> = {
  sabit: 'Sabit',
  acilir: 'Açılır',
  vasistas: 'Vasistas',
  cift_acilim: 'Çift açılım',
  ust_askili: 'Üstten askılı',
  surme: 'Sürme',
}

export interface ElevationPanel {
  box: BBox
  opening: PanelOpening
  /** Menteşe tarafı (görünüşe göre; iç/dış bakış sağ-solu değiştirebilir) */
  hinge: 'sol' | 'sag' | 'alt' | 'ust' | null
}

export interface ElevationInfo {
  frame: BBox
  cols: number
  rows: number
  panels: ElevationPanel[]
  /** "Sabit + Açılır" gibi soldan sağa özet */
  summary: string
  /** Açılır/sürme kanat sayısı */
  sashCount: number
  /** Çizimdeki en/boy oranı */
  ratio: number
  /** Analizde kullanılan çizim nesneleri (vurgulama) */
  segmentIds: number[]
}

function splitPositions(vals: number[], lo: number, hi: number, minGap: number): number[] {
  const inner = vals.filter((v) => v > lo + minGap && v < hi - minGap).sort((a, b) => a - b)
  const out: number[] = []
  for (const v of inner) {
    const last = out[out.length - 1]
    // Kayıt çoğunlukla iki paralel çizgiyle çizilir: yakın konumlar tek kayıttır
    if (last != null && v - last < minGap) out[out.length - 1] = (last + v) / 2
    else out.push(v)
  }
  return out
}

/** Teorik çizginin (a→b) çizimdeki eğik parçalarla ne kadarının örtüldüğü (0–1) */
function coverage(segs: Segs, idx: number[], ax: number, ay: number, bx: number, by: number, tol: number): number {
  const L = Math.hypot(bx - ax, by - ay)
  if (L < 1) return 0
  const ux = (bx - ax) / L
  const uy = (by - ay) / L
  // Yön olarak uyumlu parçalar
  const cand = idx.filter((i) => {
    const dx = (segs.x2[i] - segs.x1[i]) / segs.len[i]
    const dy = (segs.y2[i] - segs.y1[i]) / segs.len[i]
    return Math.abs(dx * ux + dy * uy) > 0.97
  })
  if (!cand.length) return 0
  const N = 16
  let hit = 0
  for (let k = 1; k < N; k++) {
    const t = k / N
    const px = ax + (bx - ax) * t
    const py = ay + (by - ay) * t
    for (const i of cand) {
      const x1 = segs.x1[i]
      const y1 = segs.y1[i]
      const vx = segs.x2[i] - x1
      const vy = segs.y2[i] - y1
      const l2 = vx * vx + vy * vy
      const s = Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / l2))
      if (Math.hypot(px - (x1 + s * vx), py - (y1 + s * vy)) <= tol) {
        hit++
        break
      }
    }
  }
  return hit / (N - 1)
}

/** Ok: bölme ortasında yatay çizgi + ucunda kısa eğik çizgi */
function hasArrow(segs: Segs, idx: number[], b: BBox): boolean {
  const w = b[2] - b[0]
  const h = b[3] - b[1]
  for (const i of idx) {
    if (!isHorizontal(segs, i)) continue
    const L = segs.len[i]
    if (L < 0.2 * w || L > 0.8 * w) continue
    const y = (segs.y1[i] + segs.y2[i]) / 2
    if (Math.abs(y - (b[1] + b[3]) / 2) > 0.3 * h) continue
    for (const end of [[segs.x1[i], segs.y1[i]], [segs.x2[i], segs.y2[i]]]) {
      for (const j of idx) {
        if (j === i || isHorizontal(segs, j) || isVertical(segs, j)) continue
        if (segs.len[j] > 0.35 * w) continue
        const d1 = Math.hypot(segs.x1[j] - end[0], segs.y1[j] - end[1])
        const d2 = Math.hypot(segs.x2[j] - end[0], segs.y2[j] - end[1])
        if (Math.min(d1, d2) < 1.2) return true
      }
    }
  }
  return false
}

function classifyPanel(segs: Segs, idx: number[], b: BBox): ElevationPanel {
  const [x0, y0, x1, y1] = b
  const w = x1 - x0
  const h = y1 - y0
  const tol = Math.max(0.8, 0.03 * Math.min(w, h))
  const diag = idx.filter((i) => !isHorizontal(segs, i, 0.08) && !isVertical(segs, i, 0.08))
  const tri = (apx: number, apy: number, c1: [number, number], c2: [number, number]) =>
    coverage(segs, diag, c1[0], c1[1], apx, apy, tol) >= 0.5 && coverage(segs, diag, c2[0], c2[1], apx, apy, tol) >= 0.5
  const my = (y0 + y1) / 2
  const mx = (x0 + x1) / 2
  const left = tri(x0, my, [x1, y0], [x1, y1])
  const right = tri(x1, my, [x0, y0], [x0, y1])
  const bottom = tri(mx, y0, [x0, y1], [x1, y1])
  const top = tri(mx, y1, [x0, y0], [x1, y0])
  const side = left ? 'sol' : right ? 'sag' : null
  if (side && bottom) return { box: b, opening: 'cift_acilim', hinge: side }
  if (side) return { box: b, opening: 'acilir', hinge: side }
  if (bottom) return { box: b, opening: 'vasistas', hinge: 'alt' }
  if (top) return { box: b, opening: 'ust_askili', hinge: 'ust' }
  if (hasArrow(segs, idx, b)) return { box: b, opening: 'surme', hinge: null }
  return { box: b, opening: 'sabit', hinge: null }
}

/**
 * Kasa kutusu içindeki doğrama görünüşünü çözümler. frame: dış kasa (sayfa noktası).
 * Kasa çok küçükse (8 pt altı) veya içinde çizgi yoksa null döner.
 */
export function analyzeElevation(segs: Segs, frame: BBox): ElevationInfo | null {
  const [fx0, fy0, fx1, fy1] = frame
  const W = fx1 - fx0
  const H = fy1 - fy0
  if (W < 8 || H < 8) return null
  const idx = segsInBox(segs, frame, 1)
  if (!idx.length) return null
  const edge = Math.max(3, 0.07 * Math.min(W, H))
  const vx = idx.filter((i) => isVertical(segs, i) && segs.len[i] >= 0.8 * H).map((i) => (segs.x1[i] + segs.x2[i]) / 2)
  const hy = idx.filter((i) => isHorizontal(segs, i) && segs.len[i] >= 0.8 * W).map((i) => (segs.y1[i] + segs.y2[i]) / 2)
  const cols = splitPositions(vx, fx0 + edge, fx1 - edge, Math.max(2.5, 0.04 * W))
  const rows = splitPositions(hy, fy0 + edge, fy1 - edge, Math.max(2.5, 0.04 * H))
  // İç kasa: dış kasaya kenar payı içinde en yakın paralel çizgi (yoksa dış kasa)
  const inL = vx.filter((x) => x > fx0 + 0.5 && x <= fx0 + edge)
  const inR = vx.filter((x) => x < fx1 - 0.5 && x >= fx1 - edge)
  const inB = hy.filter((y) => y > fy0 + 0.5 && y <= fy0 + edge)
  const inT = hy.filter((y) => y < fy1 - 0.5 && y >= fy1 - edge)
  const xs = [inL.length ? Math.max(...inL) : fx0, ...cols, inR.length ? Math.min(...inR) : fx1]
  const ys = [inB.length ? Math.max(...inB) : fy0, ...rows, inT.length ? Math.min(...inT) : fy1]
  const panels: ElevationPanel[] = []
  for (let r = ys.length - 2; r >= 0; r--)
    for (let c = 0; c < xs.length - 1; c++) {
      const b: BBox = [xs[c], ys[r], xs[c + 1], ys[r + 1]]
      const inner = segsInBox(segs, b, 1)
      panels.push(classifyPanel(segs, inner, b))
    }
  const labels: string[] = []
  for (const p of panels) {
    const l = PANEL_LABEL[p.opening]
    if (labels[labels.length - 1] !== l || panels.length <= 3) labels.push(l)
  }
  const sashCount = panels.filter((p) => p.opening !== 'sabit').length
  return {
    frame,
    cols: xs.length - 1,
    rows: ys.length - 1,
    panels,
    summary: [...new Set(labels)].length === 1 && panels.length > 1 ? `${panels.length} × ${labels[0]}` : labels.join(' + '),
    sashCount,
    ratio: W / H,
    segmentIds: [...new Set(idx.map((i) => segs.id[i]))],
  }
}

/** Görünüş çiziminden açılım kodu (özellik karşılaştırması için) */
export function elevationOpeningCodes(e: ElevationInfo): string[] {
  const set = new Set<string>()
  for (const p of e.panels) set.add(p.opening)
  return [...set]
}
