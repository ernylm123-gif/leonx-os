/**
 * Kart tipi doğrama listesi (Faz 5.2). Türk mimari projelerinde doğrama çizelgesi çoğunlukla
 * tablo değil, her poz için bir KART olarak çizilir: üstte poz kodu, ortada doğramanın görünüşü
 * (kasa, kayıtlar, açılım sembolleri) ve ölçü çizgileri, altta "ADET: 8", "PVC - RAL 9016",
 * "CAM: 4+16+4", "AÇILIM: ÇİFT AÇILIM" gibi yazılar.
 *
 * Kart hücresi, kodun solundaki/sağındaki düşey çizgiler ve bu aralığı boydan boya kesen yatay
 * çizgilerle bulunur (hem tek tek çizilmiş dikdörtgenler hem çizgi ızgaraları için çalışır).
 * Hücre çizgisi yoksa yazılar en yakın koda göre kümelenir.
 *
 * Ölçüler: kartta "120/150" yazısı varsa okunur; ayrıca görünüş çiziminin ölçü çizgilerindeki
 * sayılar kasa boyutuyla karşılaştırılır ve çizimin ölçeği bulunur. İkisi çelişirse bildirilir.
 */
import { type BBox, bboxUnion, EMPTY_BBOX } from '../geometry'
import { inferType, normalizeKey, parsePozLabel } from '@/quantity/detect'
import { analyzeElevation, type ElevationInfo } from './elevation'
import { type DimLabel, isNumeric, KNOWN_PREFIX, normAngle, num, parseDims, parseQty, runCenter, type TextRun } from './labels'
import { PT_TO_MM } from './pdfScene'
import { isHorizontal, isVertical, type Segs, segsInBox, segsNear } from './segments'

export interface CardRow {
  code: string
  anchor: TextRun
  cell: BBox
  runs: TextRun[]
  quantity: number | null
  qtyText: string | null
  dims: DimLabel | null
  /** Ölçünün kaynağı: kart yazısı ("120/150") veya ölçü çizgisi */
  dimsFrom: 'yazi' | 'olcu_cizgisi' | null
  /** Görünüş çiziminin ölçeği (ölçü çizgisi sayıları ile kasa boyutundan) */
  drawingScale: number | null
  dimsConflict: string | null
  frame: BBox | null
  elevation: ElevationInfo | null
  /** Kart yazıları (anchor hariç) */
  texts: string[]
  typeText: string | null
  materialText: string | null
  ocr: boolean
}

const STD_SCALES = [5, 10, 20, 25, 50, 75, 100, 200]
const snap = (d: number) => STD_SCALES.find((s) => Math.abs(d - s) / s <= 0.03) ?? null
const inside = (b: BBox, x: number, y: number) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]
const area = (b: BBox) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
const isFlat = (r: TextRun) => Math.abs(normAngle(r.angle)) < 0.02
const isUpright = (r: TextRun) => Math.abs(normAngle(r.angle) - Math.PI / 2) < 0.02

/** Kodu çevreleyen hücre: sol/sağ düşey çizgiler + bu aralığı kesen üst/alt yatay çizgiler */
export function findCell(a: TextRun, segs: Segs, maxSize: number): BBox | null {
  const [cx, cy] = runCenter(a)
  const h = a.height
  let L = -Infinity
  let R = Infinity
  for (const i of segsNear(segs, cx, cy, maxSize)) {
    if (!isVertical(segs, i) || segs.len[i] < 6 * h) continue
    const y0 = Math.min(segs.y1[i], segs.y2[i])
    const y1 = Math.max(segs.y1[i], segs.y2[i])
    if (cy < y0 || cy > y1) continue
    const x = (segs.x1[i] + segs.x2[i]) / 2
    if (x < a.bbox[0] - 0.3 && x > L) L = x
    if (x > a.bbox[2] + 0.3 && x < R) R = x
  }
  if (!Number.isFinite(L) || !Number.isFinite(R)) return null
  const W = R - L
  if (W > maxSize || W < 3 * a.width) return null
  const tol = Math.max(2, 0.02 * W)
  let T = Infinity
  let B = -Infinity
  for (const i of segsNear(segs, (L + R) / 2, cy, maxSize)) {
    if (!isHorizontal(segs, i)) continue
    const x0 = Math.min(segs.x1[i], segs.x2[i])
    const x1 = Math.max(segs.x1[i], segs.x2[i])
    // Hücre kenarı aralığı boydan boya geçer (içerideki doğrama kasası geçmez)
    if (x0 > L + tol || x1 < R - tol) continue
    const y = (segs.y1[i] + segs.y2[i]) / 2
    if (y > a.bbox[3] + 0.3 && y < T) T = y
    if (y < a.bbox[1] - 0.3 && y > B) B = y
  }
  if (!Number.isFinite(T) || !Number.isFinite(B)) return null
  if (T - B > maxSize || T - B < 3 * h) return null
  return [L, B, R, T]
}

/** Hücre içindeki en büyük eksen hizalı dikdörtgen (doğrama dış kasası) */
export function findFrame(cell: BBox, rects: BBox[], segs: Segs, exclude: BBox[]): BBox | null {
  const shrink: BBox = [cell[0] + 1, cell[1] + 1, cell[2] - 1, cell[3] - 1]
  const minArea = 0.003 * area(cell)
  const ok = (r: BBox) =>
    r[0] >= shrink[0] && r[1] >= shrink[1] && r[2] <= shrink[2] && r[3] <= shrink[3] && area(r) >= minArea && r[2] - r[0] >= 8 && r[3] - r[1] >= 8 && !exclude.some((e) => inside(r, (e[0] + e[2]) / 2, (e[1] + e[3]) / 2))
  let best: BBox | null = null
  for (const r of rects) if (ok(r) && (!best || area(r) > area(best))) best = r
  if (best) return best
  // Çizgilerden dikdörtgen: aynı x aralığında üst+alt yatay, iki uçta düşey
  const idx = segsInBox(segs, shrink, 0)
  const hs = idx.filter((i) => isHorizontal(segs, i) && segs.len[i] >= 8)
  const vs = idx.filter((i) => isVertical(segs, i) && segs.len[i] >= 8)
  const span = (i: number, axis: 'x' | 'y'): [number, number] =>
    axis === 'x' ? [Math.min(segs.x1[i], segs.x2[i]), Math.max(segs.x1[i], segs.x2[i])] : [Math.min(segs.y1[i], segs.y2[i]), Math.max(segs.y1[i], segs.y2[i])]
  for (let a = 0; a < hs.length; a++)
    for (let b = a + 1; b < hs.length; b++) {
      const [ax0, ax1] = span(hs[a], 'x')
      const [bx0, bx1] = span(hs[b], 'x')
      if (Math.abs(ax0 - bx0) > 1.5 || Math.abs(ax1 - bx1) > 1.5) continue
      const ya = segs.y1[hs[a]]
      const yb = segs.y1[hs[b]]
      const y0 = Math.min(ya, yb)
      const y1 = Math.max(ya, yb)
      if (y1 - y0 < 8) continue
      const hasSide = (x: number) => vs.some((v) => Math.abs(segs.x1[v] - x) < 1.5 && span(v, 'y')[0] <= y0 + 1.5 && span(v, 'y')[1] >= y1 - 1.5)
      if (!hasSide(ax0) || !hasSide(ax1)) continue
      const r: BBox = [ax0, y0, ax1, y1]
      if (ok(r) && (!best || area(r) > area(best))) best = r
    }
  return best
}

/** Görünüşün ölçü çizgisi sayıları: genişlik kasanın altında/üstünde, yükseklik solunda/sağında */
function frameDims(frame: BBox, runs: TextRun[]): { w: TextRun | null; h: TextRun | null } {
  const W = frame[2] - frame[0]
  const H = frame[3] - frame[1]
  let w: { r: TextRun; d: number } | null = null
  let h: { r: TextRun; d: number } | null = null
  for (const r of runs) {
    if (!isNumeric(r.text)) continue
    const [cx, cy] = runCenter(r)
    if (isFlat(r) && cx > frame[0] + 0.15 * W && cx < frame[2] - 0.15 * W) {
      const d = cy < frame[1] ? frame[1] - cy : cy > frame[3] ? cy - frame[3] : -1
      if (d >= 0 && d <= Math.max(45, 5 * r.height) && (!w || d < w.d)) w = { r, d }
    }
    if (isUpright(r) && cy > frame[1] + 0.15 * H && cy < frame[3] - 0.15 * H) {
      const d = cx < frame[0] ? frame[0] - cx : cx > frame[2] ? cx - frame[2] : -1
      if (d >= 0 && d <= Math.max(45, 5 * r.height) && (!h || d < h.d)) h = { r, d }
    }
  }
  return { w: w?.r ?? null, h: h?.r ?? null }
}

/** Ölçü çizgisi sayılarını kasa boyutuyla karşılaştırıp birim (cm/mm) ve çizim ölçeğini bulur */
export function dimsFromDrawing(frame: BBox, wText: string, hText: string): { dims: DimLabel; scale: number | null } | null {
  const wv = num(wText)
  const hv = num(hText)
  if (!(wv > 0 && hv > 0)) return null
  const wPaper = (frame[2] - frame[0]) * PT_TO_MM
  const hPaper = (frame[3] - frame[1]) * PT_TO_MM
  for (const [unit, f] of [['cm', 10], ['mm', 1], ['m', 1000]] as const) {
    const sw = snap((wv * f) / wPaper)
    const sh = snap((hv * f) / hPaper)
    if (sw && sw === sh) {
      return { dims: { w_mm: Math.round(wv * f), h_mm: Math.round(hv * f), text: `${wText}/${hText}`, extra: null, unit }, scale: sw }
    }
  }
  // Ölçek bulunamadı: yaygın yazım (cm) varsayılır, ölçek belirsiz kalır
  const mm = wv >= 1000 || hv >= 1000
  const w = mm ? wv : wv * 10
  const h = mm ? hv : hv * 10
  if (w < 250 || h < 250 || w > 20_000 || h > 10_000) return null
  return { dims: { w_mm: Math.round(w), h_mm: Math.round(h), text: `${wText}/${hText}`, extra: null, unit: mm ? 'mm' : 'cm' }, scale: null }
}

const isAnchor = (r: TextRun) => {
  const c = parsePozLabel(r.text)
  return !!c && KNOWN_PREFIX.test(c)
}

/**
 * Sayfadaki kart tipi doğrama listesi. used: tablo çizelgesinde kullanılmış yazılar (atlanır).
 * Kart sayılması için hücrede ADET yazısı ya da kasa + ölçü bulunmalıdır.
 */
export function parseCards(runs: TextRun[], segs: Segs, rects: BBox[], used: Set<TextRun>, pageSize: number): CardRow[] {
  const anchors = runs.filter((r) => !used.has(r) && isFlat(r) && isAnchor(r))
  if (!anchors.length) return []
  const out: CardRow[] = []
  const claimed = new Set<TextRun>()
  const cells = new Map<TextRun, BBox | null>()
  for (const a of anchors) cells.set(a, segs.n ? findCell(a, segs, Math.min(pageSize * 0.6, 900)) : null)
  // Hücre çizgisi olmayan kartlar: en yakın koda göre kümeleme (yalnız ≥2 kart ADET içeriyorsa kabul)
  const fallback: CardRow[] = []
  for (const a of anchors) {
    let cell = cells.get(a) ?? null
    let content: TextRun[]
    if (cell && !anchors.some((o) => o !== a && inside(cell!, ...runCenter(o)))) {
      content = runs.filter((r) => r !== a && !used.has(r) && inside(cell!, ...runCenter(r)))
    } else {
      cell = null
      const [ax, ay] = runCenter(a)
      const R = 22 * a.height
      content = runs.filter((r) => {
        if (r === a || used.has(r) || anchors.includes(r)) return false
        const [x, y] = runCenter(r)
        const d = Math.hypot(x - ax, y - ay)
        if (d > R || y > a.bbox[3] + a.height) return false
        return anchors.every((o) => o === a || Math.hypot(x - runCenter(o)[0], y - runCenter(o)[1]) >= d)
      })
    }
    let quantity: number | null = null
    let qtyText: string | null = null
    let explicit: DimLabel | null = null
    for (const r of content) {
      const q = parseQty(r.text)
      if (q != null && quantity == null) {
        quantity = q
        qtyText = r.text
      }
      const d = isNumeric(r.text) ? null : parseDims(r.text)
      if (d && !explicit) explicit = d
    }
    const box: BBox = cell ?? content.reduce((b, r) => bboxUnion(b, r.bbox), [...a.bbox] as BBox)
    const frame = cell ? findFrame(cell, rects, segs, [a.bbox]) : findFrame(box, rects, segs, [a.bbox])
    let drawn: { dims: DimLabel; scale: number | null } | null = null
    if (frame) {
      const fd = frameDims(frame, content)
      if (fd.w && fd.h) drawn = dimsFromDrawing(frame, fd.w.text, fd.h.text)
    }
    let dims: DimLabel | null = explicit ?? drawn?.dims ?? null
    const dimsFrom: CardRow['dimsFrom'] = explicit ? 'yazi' : drawn ? 'olcu_cizgisi' : null
    let dimsConflict: string | null = null
    if (explicit && drawn && (explicit.w_mm !== drawn.dims.w_mm || explicit.h_mm !== drawn.dims.h_mm))
      dimsConflict = `Kartta "${explicit.text}" yazıyor, görünüşün ölçü çizgilerinde ${drawn.dims.text} var`
    if (!dims && frame && drawn) dims = drawn.dims
    if (quantity == null && !(frame && dims)) continue
    const elevation = frame && segs.n ? analyzeElevation(segs, frame) : null
    const texts = content.filter((r) => !isNumeric(r.text)).map((r) => r.text)
    const typeText = texts.find((t) => inferType([t]).type && !/^(ACILIM|AÇILIM)\b/i.test(t)) ?? null
    const materialText = texts.find((t) => inferType([t]).material || /AHSAP|CELIK/.test(normalizeKey(t))) ?? null
    const row: CardRow = {
      code: parsePozLabel(a.text)!,
      anchor: a,
      cell: box,
      runs: content,
      quantity,
      qtyText,
      dims,
      dimsFrom,
      drawingScale: drawn?.scale ?? null,
      dimsConflict,
      frame,
      elevation,
      texts,
      typeText,
      materialText,
      ocr: a.ocr != null || content.some((r) => r.ocr != null),
    }
    if (cell) out.push(row)
    else fallback.push(row)
  }
  const withQty = fallback.filter((c) => c.quantity != null)
  const result = [...out, ...(withQty.length >= 2 ? fallback : [])]
  for (const c of result) {
    claimed.add(c.anchor)
    for (const r of c.runs) claimed.add(r)
  }
  for (const r of claimed) used.add(r)
  return result
}

/** Kartın görünüş çizimi yazılarının sınır kutusu (vurgulama) */
export const cardBox = (c: CardRow): BBox => c.runs.reduce((b, r) => bboxUnion(b, r.bbox), bboxUnion(EMPTY_BBOX(), c.anchor.bbox))
