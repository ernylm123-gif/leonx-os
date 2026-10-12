/**
 * pdf.js yükleyicisi — yalnızca PDF açıldığında yüklenir (ayrı paket parçası).
 * Güvenlik: pdf.js 6 eval kullanmaz; XFA formları kapalı, betik çalıştırılmaz, harici kaynak
 * istenmez. pdf.js çalışanı aynı kaynaktan yüklenir (CSP 'self' ile uyumlu).
 */
import { buildPdfScene, findScaleHints, type PdfPageInfo } from './pdfScene'

type PdfJs = typeof import('pdfjs-dist')
type PDFDocumentProxy = Awaited<ReturnType<PdfJs['getDocument']>['promise']>

let pdfjsPromise: Promise<PdfJs> | null = null

async function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
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
  const items = (text.items as { str?: string; transform?: number[] }[]).filter((i) => typeof i.str === 'string')
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
