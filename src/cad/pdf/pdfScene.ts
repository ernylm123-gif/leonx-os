/**
 * PDF çizim analizi (pdf.js). PDF'ler iki türdür:
 *  - Vektörel PDF: CAD programından çıktı. Çizgiler gerçek geometri olarak okunur;
 *    ölçü alınabilir ancak PDF kâğıt birimindedir (1/72 inç). Gerçek ölçü için ÖLÇEK
 *    gerekir (ör. 1:50) ve kullanıcı tarafından doğrulanmalıdır.
 *  - Taranmış (raster) PDF: yalnızca görüntü. Geometri yoktur; ölçü ancak bilinen bir
 *    mesafeyle yapılan iki noktalı kalibrasyondan sonra alınabilir ve yine de görüntü
 *    çözünürlüğü kadar hassastır.
 *
 * Kalibrasyon yapılmadan hiçbir PDF ölçüsü kesin kabul edilmez.
 */
import { type BBox, bboxOf, bboxUnion, bboxValid, EMPTY_BBOX, type Mat, mul, polylineLength, rectOf, signedArea } from '../geometry'
import type { Scene, SceneEntity, TextInfo } from '../types'

export type PdfKind = 'vektorel' | 'taranmis' | 'karma' | 'bos'

export interface PdfPageInfo {
  pageNumber: number
  pageCount: number
  widthPt: number
  heightPt: number
  kind: PdfKind
  stats: { segments: number; paths: number; images: number; imageCoverage: number; textItems: number }
  scene: Scene
  /** Sayfadaki metinden bulunan olası ölçekler (ör. "1/50") — kullanıcı onayı gerekir */
  scaleHints: { text: string; denominator: number }[]
  truncated: boolean
}

/** pdf.js OPS kodları (pdfjs-dist 6.x ile doğrulandı) */
const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  setStrokeRGBColor: 58,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  paintImageMaskXObject: 83,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageXObjectRepeat: 88,
  constructPath: 91,
} as const

const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const

const MAX_PDF_ENTITIES = 300_000
const MAX_PDF_POINTS = 4_000_000

/** Metindeki ölçek ifadeleri: "1/50", "1:100", "ÖLÇEK 1/20", "M 1:50" */
export function findScaleHints(texts: string[]): { text: string; denominator: number }[] {
  const out = new Map<number, string>()
  const re = /(?:^|[^\d])1\s*[:/]\s*(\d{1,4})(?![\d.,])/g
  for (const t of texts) {
    const s = t.replace(/\s+/g, ' ')
    if (s.length > 80) continue
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) {
      const d = Number(m[1])
      if ([1, 2, 5, 10, 20, 25, 50, 75, 100, 200, 250, 500, 1000, 2000, 5000].includes(d)) out.set(d, s.trim())
    }
  }
  return [...out.entries()].map(([denominator, text]) => ({ denominator, text })).sort((a, b) => a.denominator - b.denominator)
}

/** PDF noktası (1/72 inç) — kâğıt üzerinde mm */
export const PT_TO_MM = 25.4 / 72

interface OperatorList {
  fnArray: number[]
  argsArray: unknown[]
}

interface TextItemLike {
  str?: string
  transform?: number[]
  /** Yazının yön boyunca uzunluğu (sayfa birimi) — pdf.js verir */
  width?: number
}

/**
 * pdf.js işlem listesinden vektörel sahne üretir. `viewportTransform` sayfa kullanıcı
 * uzayını ekran pikseline (y aşağı) çevirir; dünya = y ekseni yukarı çevrilmiş hâli.
 */
export function buildPdfScene(
  ops: OperatorList,
  text: TextItemLike[],
  viewportTransform: number[],
  pageWidth: number,
  pageHeight: number,
): { scene: Scene; stats: PdfPageInfo['stats']; truncated: boolean; kind: PdfKind } {
  const flip: Mat = [1, 0, 0, -1, 0, pageHeight]
  const W: Mat = mul(flip, viewportTransform as unknown as Mat)
  let ctm: Mat = [1, 0, 0, 1, 0, 0]
  const stack: Mat[] = []
  let stroke: number | null = null
  const colorStack: (number | null)[] = []
  const coords: number[] = []
  const entities: SceneEntity[] = []
  let segments = 0
  let images = 0
  let imageArea = 0
  let truncated = false
  const pageArea = pageWidth * pageHeight

  const tx = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

  const pushPath = (pts: number[], closed: boolean, kind: 'stroke' | 'fill') => {
    if (pts.length < 4) return
    if (entities.length >= MAX_PDF_ENTITIES || coords.length / 2 + pts.length / 2 > MAX_PDF_POINTS) {
      truncated = true
      return
    }
    const start = coords.length
    for (const v of pts) coords.push(v)
    const count = pts.length / 2
    segments += count - (closed ? 0 : 1)
    entities.push({
      id: entities.length,
      type: kind === 'fill' ? 'PDF_FILL' : 'PDF_PATH',
      handle: null,
      layer: kind === 'fill' ? 'PDF dolgu' : 'PDF çizgi',
      rgb: kind === 'fill' ? null : stroke,
      insert: -1,
      owner: -1,
      kind: 'path',
      start,
      count,
      closed,
      bbox: bboxOf(pts),
      length: polylineLength(pts, closed),
      area: closed && count >= 3 ? Math.abs(signedArea(pts)) : null,
      exact: true,
      // Dikdörtgen tanıma (poz tespiti ve görünüş paftalarındaki doğrama çerçeveleri için)
      ...(closed && count === 4 ? (() => {
        const r = rectOf(pts)
        return r ? { rect: r } : {}
      })() : {}),
    })
  }

  const hexToRgb = (v: unknown): number | null => {
    if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) {
      const n = parseInt(v.slice(1), 16)
      // Siyah çizgiler tema rengiyle gösterilir
      return n === 0 ? null : n
    }
    return null
  }

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i] as unknown[] | null
    switch (fn) {
      case OPS.save:
        stack.push(ctm)
        colorStack.push(stroke)
        break
      case OPS.restore:
        ctm = stack.pop() ?? ctm
        stroke = colorStack.length ? colorStack.pop()! : stroke
        break
      case OPS.transform:
        if (args && args.length >= 6) ctm = mul(ctm, args.slice(0, 6) as unknown as Mat)
        break
      case OPS.paintFormXObjectBegin: {
        stack.push(ctm)
        colorStack.push(stroke)
        const m = args?.[0] as number[] | undefined
        if (Array.isArray(m) && m.length >= 6) ctm = mul(ctm, m.slice(0, 6) as unknown as Mat)
        break
      }
      case OPS.paintFormXObjectEnd:
        ctm = stack.pop() ?? ctm
        stroke = colorStack.length ? colorStack.pop()! : stroke
        break
      case OPS.setStrokeRGBColor:
        stroke = hexToRgb(args?.[0])
        break
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageMaskXObject:
      case OPS.paintImageXObjectRepeat: {
        images++
        // Görüntü birim kareye çizilir; kapladığı alan = |det(CTM)|
        imageArea += Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])
        break
      }
      case OPS.constructPath: {
        const op = args?.[0] as number
        const data = (args?.[1] as unknown[] | undefined)?.[0] as ArrayLike<number> | null | undefined
        if (op === OPS.endPath || !data) break
        const kind: 'stroke' | 'fill' = op === OPS.fill || op === OPS.eoFill ? 'fill' : 'stroke'
        const M = mul(W, ctm)
        let cur: number[] = []
        let closed = false
        let lx = 0
        let ly = 0
        const flush = () => {
          if (cur.length >= 4) pushPath(cur, closed, kind)
          cur = []
          closed = false
        }
        for (let k = 0; k < data.length; ) {
          const c = data[k++]
          if (c === DRAW.moveTo) {
            flush()
            lx = data[k++]
            ly = data[k++]
            cur.push(...tx(M, lx, ly))
          } else if (c === DRAW.lineTo) {
            lx = data[k++]
            ly = data[k++]
            cur.push(...tx(M, lx, ly))
          } else if (c === DRAW.curveTo) {
            const x1 = data[k++]
            const y1 = data[k++]
            const x2 = data[k++]
            const y2 = data[k++]
            const x3 = data[k++]
            const y3 = data[k++]
            for (let s = 1; s <= 8; s++) {
              const t = s / 8
              const u = 1 - t
              const x = u * u * u * lx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3
              const y = u * u * u * ly + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3
              cur.push(...tx(M, x, y))
            }
            lx = x3
            ly = y3
          } else if (c === DRAW.quadraticCurveTo) {
            const x1 = data[k++]
            const y1 = data[k++]
            const x2 = data[k++]
            const y2 = data[k++]
            for (let s = 1; s <= 8; s++) {
              const t = s / 8
              const u = 1 - t
              cur.push(...tx(M, u * u * lx + 2 * u * t * x1 + t * t * x2, u * u * ly + 2 * u * t * y1 + t * t * y2))
            }
            lx = x2
            ly = y2
          } else if (c === DRAW.closePath) {
            closed = true
            // Kapanış noktası ilk noktayla aynıysa tekrarlanmaz
            if (cur.length >= 4 && cur[0] === cur[cur.length - 2] && cur[1] === cur[cur.length - 1]) cur.splice(-2, 2)
            flush()
          } else {
            break // tanınmayan komut: yolun geri kalanı okunmaz
          }
        }
        flush()
        break
      }
    }
  }

  // Metinler
  let textItems = 0
  for (const item of text) {
    const str = item.str?.trim()
    const t = item.transform
    if (!str || !t || t.length < 6) continue
    textItems++
    if (entities.length >= MAX_PDF_ENTITIES) {
      truncated = true
      break
    }
    const h = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]) || 1
    const norm: Mat = [t[0] / h, t[1] / h, t[2] / h, t[3] / h, t[4], t[5]]
    const m = mul(W, norm)
    // pdf.js genişliği sayfa biriminde verir; yoksa yaklaşık genişlik
    const w = typeof item.width === 'number' && item.width > 0 && item.str === item.str?.trimStart() ? item.width : h * 0.55 * str.length
    const info: TextInfo = { value: str, lines: [str], m, height: h, ax: 0, baseline: 0, lineHeight: h, advance: w }
    const corners: number[] = []
    for (const [x, y] of [[0, -0.2 * h], [w, -0.2 * h], [w, h], [0, h]]) corners.push(...tx(m, x, y))
    const start = coords.length
    coords.push(...tx(m, 0, 0))
    entities.push({
      id: entities.length,
      type: 'PDF_TEXT',
      handle: null,
      layer: 'PDF metin',
      rgb: null,
      insert: -1,
      owner: -1,
      kind: 'text',
      start,
      count: 1,
      closed: false,
      bbox: bboxOf(corners),
      length: null,
      area: null,
      exact: true,
      text: info,
    })
  }

  let bbox: BBox = [0, 0, pageWidth, pageHeight]
  let content = EMPTY_BBOX()
  for (const e of entities) content = bboxUnion(content, e.bbox)
  if (bboxValid(content)) bbox = bboxUnion(bbox, content)
  const coverage = pageArea > 0 ? Math.min(1, imageArea / pageArea) : 0
  const kind: PdfKind =
    segments === 0 && images === 0 && textItems === 0
      ? 'bos'
      : coverage >= 0.5 && segments < 200
        ? 'taranmis'
        : coverage >= 0.2 && segments >= 200
          ? 'karma'
          : segments > 0
            ? 'vektorel'
            : coverage > 0
              ? 'taranmis'
              : 'vektorel'

  const layerCounts = new Map<string, number>()
  for (const e of entities) layerCounts.set(e.layer, (layerCounts.get(e.layer) ?? 0) + 1)
  return {
    scene: {
      coords: Float64Array.from(coords),
      entities,
      inserts: [],
      layers: [...layerCounts.entries()].map(([name, count]) => ({ name, rgb: 0xffffff, aci: 7, off: false, frozen: false, locked: false, count })),
      bbox,
    },
    stats: { segments, paths: entities.filter((e) => e.kind === 'path').length, images, imageCoverage: coverage, textItems },
    truncated,
    kind,
  }
}
