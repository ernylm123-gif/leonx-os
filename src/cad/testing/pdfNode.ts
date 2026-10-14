/// <reference types="node" />
/**
 * Testler için: PDF'i Node'da pdf.js (legacy) ile açar ve her sayfanın sahnesini üretir
 * (tarayıcıdaki pdfLoader ile aynı buildPdfScene çağrısı).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildPdfScene, type PdfKind } from '../pdf/pdfScene'
import type { Scene } from '../types'

export const PDF_FIXTURES = path.resolve(__dirname, '..', '__fixtures__', 'pdf')

export async function loadPdfPages(file: string, pages?: number[]): Promise<{ pageCount: number; pages: { page: number; kind: PdfKind; scene: Scene; widthPt: number; heightPt: number }[] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(readFileSync(path.join(PDF_FIXTURES, file)))
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false, disableFontFace: true, stopAtErrors: false }).promise
  const out = []
  for (let p = 1; p <= doc.numPages; p++) {
    if (pages && !pages.includes(p)) continue
    const page = await doc.getPage(p)
    const vp = page.getViewport({ scale: 1 })
    const [ops, text] = await Promise.all([page.getOperatorList(), page.getTextContent()])
    const built = buildPdfScene({ fnArray: ops.fnArray, argsArray: ops.argsArray }, text.items as { str?: string; transform?: number[]; width?: number }[], vp.transform, vp.width, vp.height)
    out.push({ page: p, kind: built.kind, scene: built.scene, widthPt: vp.width, heightPt: vp.height })
  }
  const pageCount = doc.numPages
  await doc.cleanup?.()
  return { pageCount, pages: out }
}
