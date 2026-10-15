/**
 * pdf.js yükleyicisi — yalnızca PDF açıldığında yüklenir (ayrı paket parçası).
 * Güvenlik: pdf.js 6 eval kullanmaz; XFA formları kapalı, betik çalıştırılmaz, harici kaynak
 * istenmez. pdf.js çalışanı aynı kaynaktan yüklenir (CSP 'self' ile uyumlu).
 */
import { analyzePage, type PdfPageAnalysis, type TextRun } from './archAnalyze'
import type { BBox } from '../geometry'
import { buildPdfScene, findScaleHints, type PdfPageInfo } from './pdfScene'

// Eski tarayıcılar (iPadOS Safari dahil) için polyfill içeren "legacy" derleme kullanılır;
// standart derleme çok yeni JS özelliklerine (ör. Map.getOrInsertComputed) ihtiyaç duyar.
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PDFDocumentProxy = Awaited<ReturnType<PdfJs['getDocument']>['promise']>

let pdfjsPromise: Promise<PdfJs> | null = null

async function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const [lib, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')])
    lib.GlobalWorkerOptions.workerSrc = worker.default
    return lib
  })()
  return pdfjsPromise
}

export interface OpenedPdf {
  doc: PDFDocumentProxy
  pageCount: number
}

export async function openPdf(bytes: ArrayBuffer): Promise<OpenedPdf> {
  const pdfjs = await loadPdfJs()
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    enableXfa: false,
    disableFontFace: false,
    useSystemFonts: true,
    stopAtErrors: false,
  })
  const doc = await task.promise
  return { doc, pageCount: doc.numPages }
}

export async function analyzePdfPage(pdf: OpenedPdf, pageNumber: number): Promise<PdfPageInfo> {
  const page = await pdf.doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const [ops, text] = await Promise.all([page.getOperatorList(), page.getTextContent()])
  const items = (text.items as { str?: string; transform?: number[]; width?: number }[]).filter((i) => typeof i.str === 'string')
  const built = buildPdfScene(
    { fnArray: ops.fnArray, argsArray: ops.argsArray },
    items,
    viewport.transform,
    viewport.width,
    viewport.height,
  )
  return {
    pageNumber,
    pageCount: pdf.pageCount,
    widthPt: viewport.width,
    heightPt: viewport.height,
    kind: built.kind,
    stats: built.stats,
    scene: built.scene,
    scaleHints: findScaleHints(items.map((i) => i.str ?? '')),
    truncated: built.truncated,
    textGeometry: built.textGeometry,
    imageBoxes: built.imageBoxes,
  }
}

/** Sayfa özeti: tür, pafta, ölçek ve mimari analiz (etiketler, çizelge) — sahne saklanmaz */
export interface PdfPageEntry {
  page: number
  widthPt: number
  heightPt: number
  kind: PdfPageInfo['kind'] | null
  stats: PdfPageInfo['stats'] | null
  analysis: PdfPageAnalysis | null
  /** Sayfa okunamadıysa nedeni */
  error: string | null
  truncated: boolean
  /** Çizgi olarak gömülmüş yazı bölgeleri (OCR gerekir) */
  textGeometry?: PdfPageInfo['textGeometry']
  /** Gömülü görüntü bölgeleri (karma pafta: çizelge görüntü olabilir) */
  imageBoxes?: PdfPageInfo['imageBoxes']
  /** Bu sayfada yapılmış OCR sonucu (ölçekle yeniden analizde korunur) */
  ocr?: { runs: TextRun[]; words: number; meanConfidence: number; tiles: number; dpi: number } | null
}

/** Yüklemede özetlenen en fazla sayfa (daha fazlası seçilince ayrıca analiz edilir) */
export const MAX_SUMMARY_PAGES = 80

export async function summarizePage(pdf: OpenedPdf, pageNumber: number, info?: PdfPageInfo): Promise<PdfPageEntry> {
  try {
    const i = info ?? (await analyzePdfPage(pdf, pageNumber))
    return {
      page: pageNumber,
      widthPt: i.widthPt,
      heightPt: i.heightPt,
      kind: i.kind,
      stats: i.stats,
      analysis: analyzePage({
        page: pageNumber,
        kind: i.kind,
        scene: i.scene,
        textGeometry: i.textGeometry,
        garbledText: i.stats.garbledText ?? 0,
        imageBoxes: i.imageBoxes,
        pageSize: { w: i.widthPt, h: i.heightPt },
      }),
      error: null,
      truncated: i.truncated,
      textGeometry: i.textGeometry,
      imageBoxes: i.imageBoxes,
    }
  } catch (e) {
    return { page: pageNumber, widthPt: 0, heightPt: 0, kind: null, stats: null, analysis: null, error: e instanceof Error ? e.message : 'Sayfa okunamadı', truncated: false }
  }
}

/**
 * Sayfayı görüntüye çevirir (görüntüleyici arka planı). Bellek için piksel sayısı sınırlanır
 * (iPad Safari'de büyük tuvaller sessizce boş kalabilir).
 */
export async function renderPdfPage(pdf: OpenedPdf, pageNumber: number, maxPixels = 12_000_000): Promise<HTMLCanvasElement> {
  const page = await pdf.doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.max(0.5, Math.min(4, Math.sqrt(maxPixels / (base.width * base.height))))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Tuval oluşturulamadı')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  return canvas
}

/**
 * Sayfanın bir bölgesini (sayfa noktası, y yukarı) verilen çözünürlükte görüntüye çevirir —
 * karo OCR için. Tuval boyutu bölgeyle sınırlıdır; tüm sayfa büyük ölçekte işlenmez.
 */
export async function renderPdfTile(pdf: OpenedPdf, pageNumber: number, box: BBox, pxPerPt: number): Promise<HTMLCanvasElement> {
  const page = await pdf.doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: pxPerPt })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil((box[2] - box[0]) * pxPerPt))
  canvas.height = Math.max(1, Math.ceil((box[3] - box[1]) * pxPerPt))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Tuval oluşturulamadı')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // Sahne koordinatı y yukarı; görüntü alanı y aşağı: karo sol üstü = (x0, H − y1)
  const tx = -box[0] * pxPerPt
  const ty = -(base.height - box[3]) * pxPerPt
  await page.render({ canvas, canvasContext: ctx, viewport, transform: [1, 0, 0, 1, tx, ty] }).promise
  return canvas
}
