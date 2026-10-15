/**
 * Taranmış PDF sayfaları için OCR (tesseract.js 7, Apache-2.0).
 *
 * Tüm dosyalar (çalışan, WebAssembly çekirdeği, Türkçe dil verisi) uygulamanın kendi
 * sunucusundan yüklenir — üçüncü taraf CDN'e istek gitmez (CSP 'self'). Yükleme yalnız OCR
 * istendiğinde yapılır (~4 MB çekirdek + 2 MB dil verisi; dil verisi tarayıcıda önbelleğe alınır).
 *
 * Çizimlerde yazılar seyrek ve dağınıktır: "seyrek metin" bölütleme kipi kullanılır, ayrıca
 * düşey (90° döndürülmüş) etiketler için sayfa döndürülerek ikinci tarama yapılır.
 */
import type { BBox } from '../geometry'
import { mergeRuns, runsFromOcr, type TextRun } from './archAnalyze'

/** vite.config.ts → leonxOcrAssets ile aynı yol */
export const OCR_BASE = '/assets/ocr/7.0.0/'

export interface OcrWord {
  text: string
  bbox: BBox
  confidence: number
}

interface TesseractWord {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}
export interface TesseractBlocks {
  blocks?: { paragraphs: { lines: { words: TesseractWord[] }[] }[] }[] | null
}

/**
 * Tesseract piksel kutuları (y aşağı) → sayfa noktası (y yukarı). rotated: görüntü saat yönünde
 * 90° döndürülmüştü. origin: görüntünün sol üst köşesinin sayfadaki yeri (karo OCR); verilmezse
 * görüntü tüm sayfadır.
 */
export function wordsToPage(
  data: TesseractBlocks,
  pxPerPt: number,
  pageHeightPt: number,
  rotated?: { originalHeightPx: number } | null,
  origin?: { x: number; top: number },
): OcrWord[] {
  const ox = origin?.x ?? 0
  const top = origin?.top ?? pageHeightPt
  const out: OcrWord[] = []
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines)
        for (const w of l.words) {
          if (!w.text?.trim()) continue
          let { x0, y0, x1, y1 } = w.bbox
          if (rotated) {
            // Döndürülmüş (x', y') → özgün (x = y', y = H − x')
            const H = rotated.originalHeightPx
            ;[x0, y0, x1, y1] = [w.bbox.y0, H - w.bbox.x1, w.bbox.y1, H - w.bbox.x0]
          }
          out.push({
            text: w.text.trim(),
            confidence: w.confidence,
            bbox: [ox + x0 / pxPerPt, top - y1 / pxPerPt, ox + x1 / pxPerPt, top - y0 / pxPerPt],
          })
        }
  return out
}

/** Düşey kelimeler (90°): taban çizgisi sağ kenarda, yön yukarı */
export function verticalRuns(words: OcrWord[]): TextRun[] {
  return mergeRuns(
    words.map((w) => ({
      text: w.text,
      angle: Math.PI / 2,
      height: Math.max(1, w.bbox[2] - w.bbox[0]) * 0.8,
      ox: w.bbox[2] - (w.bbox[2] - w.bbox[0]) * 0.15,
      oy: w.bbox[1],
      width: w.bbox[3] - w.bbox[1],
      bbox: w.bbox,
      ids: [],
      ocr: Math.max(0, Math.min(1, w.confidence / 100)),
    })),
  )
}

const overlap = (a: BBox, b: BBox) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const area = Math.max(1e-6, Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])))
  return (ix * iy) / area
}

type TesseractModule = typeof import('tesseract.js')
type Worker = Awaited<ReturnType<TesseractModule['createWorker']>>
let workerPromise: Promise<Worker> | null = null

async function getWorker(onProgress?: (fraction: number, status: string) => void): Promise<Worker> {
  workerPromise ??= (async () => {
    const T = await import('tesseract.js')
    const w = await T.createWorker('tur', T.OEM.LSTM_ONLY, {
      workerPath: `${OCR_BASE}worker.min.js`,
      corePath: OCR_BASE,
      langPath: `${OCR_BASE}lang`,
      workerBlobURL: false,
      gzip: true,
      logger: (m: { status: string; progress: number }) => onProgress?.(m.progress, m.status),
    })
    await w.setParameters({ tessedit_pageseg_mode: T.PSM.SPARSE_TEXT, preserve_interword_spaces: '1' })
    return w
  })()
  try {
    return await workerPromise
  } catch (e) {
    workerPromise = null
    throw e
  }
}

export async function terminateOcr(): Promise<void> {
  const p = workerPromise
  workerPromise = null
  if (p) await (await p).terminate().catch(() => undefined)
}

export interface OcrResult {
  runs: TextRun[]
  words: number
  meanConfidence: number
}

/**
 * Sayfa görüntüsünde OCR. canvas: sayfanın işlenmiş görüntüsü (genişlik = widthPt × pxPerPt).
 * İptal: signal tetiklenirse çalışan sonlandırılır.
 */
export async function ocrCanvas(
  canvas: HTMLCanvasElement,
  page: { widthPt: number; heightPt: number },
  opts: { signal?: AbortSignal; onProgress?: (fraction: number, status: string) => void; vertical?: boolean } = {},
): Promise<OcrResult> {
  const pxPerPt = canvas.width / page.widthPt
  const onAbort = () => void terminateOcr()
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const worker = await getWorker(opts.onProgress)
    if (opts.signal?.aborted) throw new DOMException('İptal edildi', 'AbortError')
    // Görüntü çözünürlüğü bilinir (dpi = piksel/pt × 72); tahmin edilmesine gerek yok
    await worker.setParameters({ user_defined_dpi: String(Math.max(70, Math.min(600, Math.round(pxPerPt * 72)))) })
    const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false })
    const words = wordsToPage(data as TesseractBlocks, pxPerPt, page.heightPt)
    let runs = runsFromOcr(words)
    if (opts.vertical !== false && !opts.signal?.aborted) {
      // Saat yönünde 90° döndürülmüş kopya: yukarı doğru yazılmış etiketler yataylaşır
      const rot = document.createElement('canvas')
      rot.width = canvas.height
      rot.height = canvas.width
      const ctx = rot.getContext('2d')
      if (ctx) {
        ctx.translate(rot.width, 0)
        ctx.rotate(Math.PI / 2)
        ctx.drawImage(canvas, 0, 0)
        const r2 = await worker.recognize(rot, {}, { blocks: true, text: false })
        const vwords = wordsToPage(r2.data as TesseractBlocks, pxPerPt, page.heightPt, { originalHeightPx: canvas.height }).filter(
          (w) => !words.some((h) => overlap(h.bbox, w.bbox) > 0.3),
        )
        runs = [...runs, ...verticalRuns(vwords)]
        words.push(...vwords)
      }
      rot.width = 0
      rot.height = 0
    }
    if (opts.signal?.aborted) throw new DOMException('İptal edildi', 'AbortError')
    const conf = words.length ? words.reduce((s, w) => s + w.confidence, 0) / words.length : 0
    return { runs, words: words.length, meanConfidence: conf / 100 }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

// ------------------------------------------------------------------ karo (bölge) OCR

/**
 * Büyük paftalarda (A1/A0) tüm sayfayı tek görüntüde OCR'lamak yazıları okunamayacak kadar
 * küçültür (A1 12 MP'de ≈125 dpi: 2,5 mm yazı ≈12 piksel). Bunun yerine yalnız yazı bölgeleri
 * (çizgi-harf kümeleri, gömülü görüntüler) ya da taranmış sayfanın tamamı, yüksek çözünürlükte
 * ve sınırlı boyutlu KAROLAR hâlinde işlenir: bellek sabit kalır (iPad), küçük yazı okunur.
 */
/** 'seyrek': dağınık etiketler (plan, çizgi-yazı); 'blok': tablo/çizelge görüntüsü (satır yapısı korunur, tek haneli sayılar kaçmaz) */
export type OcrMode = 'seyrek' | 'blok'

export interface OcrTile {
  /** Sayfa noktası, y yukarı */
  box: BBox
  /** Düşey yazı olabilir: 90° döndürülmüş ikinci tarama yapılır */
  vertical: boolean
  mode: OcrMode
  /** İnce çizgili yazı (SHX, içi boş harf): görüntüde çizgiler kalınlaştırılır */
  thicken: boolean
}

export interface OcrRegion {
  bbox: BBox
  vertical?: boolean
  mode?: OcrMode
  thicken?: boolean
}

/** Karo planı: bölgeleri genişletir, birleştirir, en fazla maxPx kenarlı ve örtüşen karolara böler */
export function planOcrTiles(regions: OcrRegion[] | 'sayfa', page: { widthPt: number; heightPt: number }, dpi: number, maxPx = 2048, margin = 8): OcrTile[] {
  const W = page.widthPt
  const H = page.heightPt
  const src: OcrRegion[] = regions === 'sayfa' ? [{ bbox: [0, 0, W, H], vertical: true, mode: 'seyrek' }] : regions
  // Genişlet + sayfaya kırp
  let boxes = src.map((r) => ({
    b: [Math.max(0, r.bbox[0] - margin), Math.max(0, r.bbox[1] - margin), Math.min(W, r.bbox[2] + margin), Math.min(H, r.bbox[3] + margin)] as BBox,
    v: !!r.vertical,
    mode: r.mode ?? ('seyrek' as OcrMode),
    thicken: !!r.thicken,
  }))
  // Yakın/örtüşen kutuları birleştir (aynı kipteki; tekrarlı geçiş)
  let changed = true
  while (changed && boxes.length > 1) {
    changed = false
    const out: typeof boxes = []
    for (const x of boxes) {
      const m = out.find(
        (o) => o.mode === x.mode && x.b[0] <= o.b[2] + margin && x.b[2] >= o.b[0] - margin && x.b[1] <= o.b[3] + margin && x.b[3] >= o.b[1] - margin,
      )
      if (m) {
        m.b = [Math.min(m.b[0], x.b[0]), Math.min(m.b[1], x.b[1]), Math.max(m.b[2], x.b[2]), Math.max(m.b[3], x.b[3])]
        m.v = m.v || x.v
        m.thicken = m.thicken || x.thicken
        changed = true
      } else out.push({ ...x, b: [...x.b] as BBox })
    }
    boxes = out
  }
  const tilePt = maxPx / (dpi / 72)
  const overlapPt = Math.min(tilePt / 4, 30)
  const tiles: OcrTile[] = []
  for (const { b, v, mode, thicken } of boxes) {
    const w = b[2] - b[0]
    const h = b[3] - b[1]
    if (w < 2 || h < 2) continue
    const nx = Math.max(1, Math.ceil((w - overlapPt) / (tilePt - overlapPt)))
    const ny = Math.max(1, Math.ceil((h - overlapPt) / (tilePt - overlapPt)))
    const sx = nx === 1 ? 0 : (w - tilePt) / (nx - 1)
    const sy = ny === 1 ? 0 : (h - tilePt) / (ny - 1)
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const x0 = b[0] + i * sx
        const y0 = b[1] + j * sy
        tiles.push({ box: [x0, y0, Math.min(b[2], x0 + Math.min(tilePt, w)), Math.min(b[3], y0 + Math.min(tilePt, h))], vertical: v, mode, thicken })
      }
  }
  return tiles
}

/** Örtüşen karolardan gelen aynı kelimeler bir kez tutulur (yüksek güvenli olan) */
export function dedupeWords(words: OcrWord[]): OcrWord[] {
  const sorted = [...words].sort((a, b) => b.confidence - a.confidence)
  const kept: OcrWord[] = []
  for (const w of sorted) if (!kept.some((k) => overlap(k.bbox, w.bbox) > 0.5)) kept.push(w)
  return kept
}

export interface CanvasLike {
  width: number
  height: number
}

export interface OcrEngine {
  recognize(image: CanvasLike, dpi: number, mode: OcrMode): Promise<TesseractBlocks>
}

export interface TiledOcrOptions<C extends CanvasLike> {
  tiles: OcrTile[]
  dpi: number
  page: { widthPt: number; heightPt: number }
  /** Karo görüntüsü (genişlik = kutu genişliği × dpi/72) */
  render: (tile: OcrTile, pxPerPt: number) => Promise<C>
  /** Saat yönünde 90° döndürülmüş kopya */
  rotate: (c: C) => C | null
  /** İnce çizgileri kalınlaştır (yerinde) */
  thicken?: (c: C) => void
  release?: (c: C) => void
  engine: OcrEngine
  signal?: AbortSignal
  onProgress?: (fraction: number, status: string) => void
}

export async function ocrTiles<C extends CanvasLike>(o: TiledOcrOptions<C>): Promise<OcrResult & { tiles: number }> {
  const pxPerPt = o.dpi / 72
  const horiz: OcrWord[] = []
  const vert: OcrWord[] = []
  const passes = o.tiles.reduce((n, t) => n + (t.vertical ? 2 : 1), 0)
  let done = 0
  for (const t of o.tiles) {
    if (o.signal?.aborted) throw new DOMException('İptal edildi', 'AbortError')
    o.onProgress?.(done / Math.max(1, passes), `karo ${o.tiles.indexOf(t) + 1}/${o.tiles.length}`)
    const canvas = await o.render(t, pxPerPt)
    if (t.thicken) o.thicken?.(canvas)
    const origin = { x: t.box[0], top: t.box[3] }
    try {
      const data = await o.engine.recognize(canvas, o.dpi, t.mode)
      horiz.push(...wordsToPage(data, pxPerPt, o.page.heightPt, null, origin))
      done++
      if (t.vertical && !o.signal?.aborted) {
        const rot = o.rotate(canvas)
        if (rot) {
          try {
            const d2 = await o.engine.recognize(rot, o.dpi, t.mode)
            vert.push(...wordsToPage(d2, pxPerPt, o.page.heightPt, { originalHeightPx: canvas.height }, origin))
          } finally {
            o.release?.(rot)
          }
        }
        done++
      }
    } finally {
      o.release?.(canvas)
    }
  }
  if (o.signal?.aborted) throw new DOMException('İptal edildi', 'AbortError')
  const h = dedupeWords(horiz)
  // Döndürülmüş taramada yatay kelimelerle çakışanlar atılır (aynı yazının yanlış yönde okunması)
  const v = dedupeWords(vert).filter((w) => !h.some((x) => overlap(x.bbox, w.bbox) > 0.3))
  const runs = [...runsFromOcr(h), ...verticalRuns(v)]
  const all = [...h, ...v]
  const conf = all.length ? all.reduce((s, w) => s + w.confidence, 0) / all.length : 0
  return { runs, words: all.length, meanConfidence: conf / 100, tiles: o.tiles.length }
}

export { dpiForTextHeight } from './ocrPlan'

// ------------------------------------------------------------------ tarayıcı

/** Tarayıcı OCR motoru (tesseract.js çalışanı, yerel dosyalar) */
export function browserEngine(onProgress?: (fraction: number, status: string) => void): OcrEngine {
  return {
    async recognize(image, dpi, mode) {
      const worker = await getWorker(onProgress)
      await worker.setParameters({
        user_defined_dpi: String(Math.max(70, Math.min(600, Math.round(dpi)))),
        tessedit_pageseg_mode: (mode === 'blok' ? '6' : '11') as never,
      })
      const { data } = await worker.recognize(image as HTMLCanvasElement, {}, { blocks: true, text: false })
      return data as TesseractBlocks
    },
  }
}

export function rotateCanvas(c: HTMLCanvasElement): HTMLCanvasElement | null {
  const rot = document.createElement('canvas')
  rot.width = c.height
  rot.height = c.width
  const ctx = rot.getContext('2d')
  if (!ctx) return null
  ctx.translate(rot.width, 0)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(c, 0, 0)
  return rot
}

/**
 * PDF sayfasında karo OCR (tarayıcı). regions: 'sayfa' (taranmış) veya yazı/görüntü bölgeleri.
 * İptal edilirse çalışan sonlandırılır.
 */
export async function ocrPdfPage(
  renderTile: (box: BBox, pxPerPt: number) => Promise<HTMLCanvasElement>,
  page: { widthPt: number; heightPt: number },
  regions: OcrRegion[] | 'sayfa',
  opts: { dpi: number; signal?: AbortSignal; onProgress?: (fraction: number, status: string) => void },
): Promise<OcrResult & { tiles: number }> {
  const onAbort = () => void terminateOcr()
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const tiles = planOcrTiles(regions, page, opts.dpi)
    return await ocrTiles<HTMLCanvasElement>({
      tiles,
      dpi: opts.dpi,
      page,
      render: (t, pxPerPt) => renderTile(t.box, pxPerPt),
      rotate: rotateCanvas,
      thicken: (c) => {
        const ctx = c.getContext('2d')
        if (!ctx) return
        const img = ctx.getImageData(0, 0, c.width, c.height)
        thickenStrokes(img.data, c.width, c.height)
        ctx.putImageData(img, 0, 0)
      },
      release: (c) => {
        c.width = 0
        c.height = 0
      },
      engine: browserEngine((f, st) => opts.onProgress?.(f, st === 'recognizing text' ? 'yazılar tanınıyor' : 'OCR hazırlanıyor')),
      signal: opts.signal,
      onProgress: opts.onProgress,
    })
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * İnce çizgili yazıyı kalınlaştırma (3×3 en koyu komşu): SHX tek çizgi ve içi boş harflerde
 * OCR doğruluğunu belirgin artırır. RGBA verisi yerinde değiştirilir.
 */
export function thickenStrokes(data: Uint8ClampedArray | Uint8Array, w: number, h: number): void {
  const lum = new Uint8Array(w * h)
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 255
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        const row = yy * w
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const v = lum[row + xx]
          if (v < m) m = v
        }
      }
      const j = (y * w + x) * 4
      data[j] = data[j + 1] = data[j + 2] = m
    }
}
