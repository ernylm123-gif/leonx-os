/// <reference types="node" />
/**
 * Testler için: PDF sayfa bölgelerini Node'da pdf.js + @napi-rs/canvas ile görüntüye çevirip
 * tesseract.js (yerel Türkçe dil verisi) ile karo OCR yapar — tarayıcıdaki ocrPdfPage ile aynı
 * planOcrTiles / ocrTiles kodunu kullanır.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCanvas, type Canvas } from '@napi-rs/canvas'
import type { BBox } from '../geometry'
import { type OcrEngine, type OcrRegion, ocrTiles, planOcrTiles, type TesseractBlocks, thickenStrokes } from '../pdf/ocr'
import { PDF_FIXTURES } from './pdfNode'

export async function nodeOcrEngine(): Promise<{ engine: OcrEngine; terminate: () => Promise<void> }> {
  const { createWorker, PSM, OEM } = await import('tesseract.js')
  const langPath = path.resolve(__dirname, '../../../node_modules/@tesseract.js-data/tur/4.0.0_best_int')
  const worker = await createWorker('tur', OEM.LSTM_ONLY, { langPath, cachePath: mkdtempSync(path.join(tmpdir(), 'leonx-ocr-')), gzip: true })
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' })
  return {
    engine: {
      async recognize(image, dpi, mode) {
        await worker.setParameters({ user_defined_dpi: String(Math.round(dpi)), tessedit_pageseg_mode: (mode === 'blok' ? '6' : '11') as never })
        const png = (image as Canvas).toBuffer('image/png')
        const { data } = await worker.recognize(png, {}, { blocks: true, text: false })
        return data as unknown as TesseractBlocks
      },
    },
    terminate: async () => {
      await worker.terminate()
    },
  }
}

export async function ocrFixturePage(file: string, pageNumber: number, regions: OcrRegion[] | 'sayfa', dpi: number, engine: OcrEngine) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(readFileSync(path.resolve(PDF_FIXTURES, file)))
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false, disableFontFace: true, stopAtErrors: false }).promise
  const page = await doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const pageInfo = { widthPt: base.width, heightPt: base.height }
  const tiles = planOcrTiles(regions, pageInfo, dpi)
  const res = await ocrTiles<Canvas>({
    tiles,
    dpi,
    page: pageInfo,
    render: async (t, pxPerPt) => {
      const box: BBox = t.box
      const canvas = createCanvas(Math.max(1, Math.ceil((box[2] - box[0]) * pxPerPt)), Math.max(1, Math.ceil((box[3] - box[1]) * pxPerPt)))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      const viewport = page.getViewport({ scale: pxPerPt })
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
        transform: [1, 0, 0, 1, -box[0] * pxPerPt, -(base.height - box[3]) * pxPerPt],
      }).promise
      return canvas
    },
    thicken: (c) => {
      const ctx = c.getContext('2d')
      const img = ctx.getImageData(0, 0, c.width, c.height)
      thickenStrokes(img.data, c.width, c.height)
      ctx.putImageData(img, 0, 0)
    },
    rotate: (c) => {
      const rot = createCanvas(c.height, c.width)
      const ctx = rot.getContext('2d')
      ctx.translate(rot.width, 0)
      ctx.rotate(Math.PI / 2)
      ctx.drawImage(c, 0, 0)
      return rot
    },
    engine,
  })
  await doc.cleanup?.()
  return res
}
