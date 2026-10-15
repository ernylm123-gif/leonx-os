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
  stats: PdfPageStats
  scene: Scene
  /** Çizgi/dolgu olarak gömülmüş yazı bölgeleri (AutoCAD SHX vb.) — OCR ile okunmalıdır */
  textGeometry: TextGeometry | null
  /** Sayfadaki gömülü görüntülerin kapladığı alanlar (sayfa noktası, y yukarı) */
  imageBoxes: BBox[]
  /** Sayfadaki metinden bulunan olası ölçekler (ör. "1/50") — kullanıcı onayı gerekir */
  scaleHints: { text: string; denominator: number }[]
  truncated: boolean
}

export interface PdfPageStats {
  segments: number
  paths: number
  images: number
  imageCoverage: number
  textItems: number
  /** Harf çizgisine benzeyen küçük yol sayısı (yazı çizgi olarak gömülmüşse yüksektir) */
  glyphPaths?: number
  /** Okunamayan (yazı tipi eşlemesi bozuk) metin oranı 0–1 */
  garbledText?: number
}

export interface TextGeometry {
  /** Harf kümelerinin bölgeleri (sayfa noktası, y yukarı) */
  regions: BBox[]
  /** Harf yolu sayısı */
  paths: number
  /** Tahmini yazı yüksekliği (pt, medyan) */
  height: number
  /** Düşey yazı bölgesi var mı (döndürülmüş OCR gerekir) */
  vertical: boolean
}

/** Çizgi olarak gömülmüş harflerin katmanı (görüntüleyicide ayrıca gizlenebilir) */
export const GLYPH_LAYER = 'PDF yazı (çizgi)'

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
): { scene: Scene; stats: PdfPageStats; truncated: boolean; kind: PdfKind; textGeometry: TextGeometry | null; imageBoxes: BBox[] } {
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
  const imageBoxes: BBox[] = []
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
        if (imageBoxes.length < 200) {
          const M = mul(W, ctm)
          const b = bboxOf([...tx(M, 0, 0), ...tx(M, 1, 0), ...tx(M, 0, 1), ...tx(M, 1, 1)])
          if (bboxValid(b)) imageBoxes.push(b)
        }
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

  // Çizgi olarak gömülmüş yazılar (harf kümeleri) ayrı katmana alınır
  const textGeometry = detectTextGeometry(entities, coords)
  if (textGeometry) for (const id of textGeometry.ids) entities[id].layer = GLYPH_LAYER
  const garbled = garbledRatio(text.map((t) => t.str ?? ''))

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
    stats: {
      segments,
      paths: entities.filter((e) => e.kind === 'path').length,
      images,
      imageCoverage: coverage,
      textItems,
      glyphPaths: textGeometry?.paths ?? 0,
      garbledText: garbled,
    },
    truncated,
    kind,
    textGeometry: textGeometry ? { regions: textGeometry.regions, paths: textGeometry.paths, height: textGeometry.height, vertical: textGeometry.vertical } : null,
    imageBoxes,
  }
}

// ------------------------------------------------------------------ yazı-çizgi tespiti

/** Harf yolu: küçük (≤ 14 pt), nokta olmayan yol */
const GLYPH_MAX = 14
const GLYPH_MIN = 0.6
const CELL = 16

/**
 * AutoCAD SHX yazı tipleri (ve bazı PDF sürücülerinin "yazıyı eğriye çevir" seçeneği) yazıyı
 * metin olarak değil, her harfi ayrı çizgi/eğri olarak yazar. Böyle paftalarda metin katmanı
 * boştur; yazılar ancak OCR ile okunabilir. Harf yolları küçük, yoğun kümeler hâlinde ve
 * çok yönlü (yatay, düşey, eğik, eğri) parçalardan oluşur; tarama desenleri ise tek/iki yönlüdür.
 */
export function detectTextGeometry(entities: SceneEntity[], coords: number[]): (TextGeometry & { ids: number[] }) | null {
  type Cell = { ids: number[]; mask: number }
  const cells = new Map<string, Cell>()
  const heights: number[] = []
  for (const e of entities) {
    if (e.kind !== 'path') continue
    const w = e.bbox[2] - e.bbox[0]
    const h = e.bbox[3] - e.bbox[1]
    const big = Math.max(w, h)
    if (big > GLYPH_MAX || big < GLYPH_MIN) continue
    // Parça yönleri: 0°, 45°, 90°, 135° kovaları (bit maskesi)
    let mask = 0
    for (let i = 0; i + 1 < e.count; i++) {
      const dx = coords[e.start + 2 * i + 2] - coords[e.start + 2 * i]
      const dy = coords[e.start + 2 * i + 3] - coords[e.start + 2 * i + 1]
      if (Math.abs(dx) + Math.abs(dy) < 1e-6) continue
      let a = (Math.atan2(dy, dx) * 180) / Math.PI
      if (a < 0) a += 180
      mask |= 1 << (Math.round(a / 45) % 4)
      if (mask === 15) break
    }
    const cx = Math.floor((e.bbox[0] + e.bbox[2]) / 2 / CELL)
    const cy = Math.floor((e.bbox[1] + e.bbox[3]) / 2 / CELL)
    const k = `${cx},${cy}`
    const c = cells.get(k) ?? { ids: [], mask: 0 }
    c.ids.push(e.id)
    c.mask |= mask
    cells.set(k, c)
    heights.push(h)
  }
  const bits = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1)
  const glyphCells = new Set<string>()
  for (const [k, c] of cells) if (c.ids.length >= 3 && bits(c.mask) >= 3) glyphCells.add(k)
  if (glyphCells.size < 6) return null
  // Bitişik hücreler → bölge
  const seen = new Set<string>()
  const regions: BBox[] = []
  const ids: number[] = []
  let vertical = false
  for (const start of glyphCells) {
    if (seen.has(start)) continue
    const stack = [start]
    seen.add(start)
    let b = EMPTY_BBOX()
    let n = 0
    while (stack.length) {
      const k = stack.pop()!
      const c = cells.get(k)!
      for (const id of c.ids) {
        b = bboxUnion(b, entities[id].bbox)
        ids.push(id)
        n++
      }
      const [x, y] = k.split(',').map(Number)
      // Kesin harf hücrelerinden başlayıp küçük yol içeren komşu hücrelere büyür (kısa kodlar: "K1")
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const nk = `${x + dx},${y + dy}`
          if (!seen.has(nk) && (glyphCells.has(nk) || (glyphCells.has(k) && cells.has(nk)))) {
            seen.add(nk)
            stack.push(nk)
          }
        }
    }
    if (n < 3) continue
    if (b[3] - b[1] > 2 * (b[2] - b[0]) && b[3] - b[1] > 20) vertical = true
    regions.push(b)
  }
  if (!regions.length) return null
  heights.sort((a, b) => a - b)
  return { regions: regions.slice(0, 2000), paths: ids.length, height: heights[Math.floor(heights.length / 2)] ?? 0, vertical, ids }
}

/**
 * Yazı tipi eşlemesi bozuk metin oranı: ToUnicode tablosu olmayan gömülü yazı tiplerinde pdf.js
 * anlamsız karakterler (özel kullanım alanı, denetim karakterleri, yalnız simge) döndürür.
 */
export function garbledRatio(strs: string[]): number {
  let total = 0
  let bad = 0
  for (const raw of strs) {
    const s = raw.trim()
    if (!s) continue
    total++
    if (/[\u0000-\u0008\u000e-\u001f\ue000-\uf8ff\ufffd]/.test(s)) {
      bad++
      continue
    }
    const good = (s.match(/[\p{L}\p{N}]/gu) ?? []).length
    if (s.length >= 3 && good / s.length < 0.3) bad++
  }
  return total ? bad / total : 0
}
