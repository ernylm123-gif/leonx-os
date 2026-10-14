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
interface TesseractBlocks {
  blocks?: { paragraphs: { lines: { words: TesseractWord[] }[] }[] }[] | null
}

/** Tesseract piksel kutuları (y aşağı) → sayfa noktası (y yukarı). rotated: görüntü saat yönünde 90° döndürülmüştü */
export function wordsToPage(data: TesseractBlocks, pxPerPt: number, pageHeightPt: number, rotated?: { originalHeightPx: number }): OcrWord[] {
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
            bbox: [x0 / pxPerPt, pageHeightPt - y1 / pxPerPt, x1 / pxPerPt, pageHeightPt - y0 / pxPerPt],
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
