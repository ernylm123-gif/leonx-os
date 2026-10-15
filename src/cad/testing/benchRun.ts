/// <reference types="node" />
/**
 * Testler ve doğruluk ölçümü için: PDF'i Node'da tarayıcıdaki akışla aynı şekilde analiz eder
 * (sayfa sahnesi → sayfa analizi → gerekirse karo OCR → birleştirme).
 */
import { aggregatePdf, analyzePage, type PdfPageAnalysis } from '../pdf/archAnalyze'
import type { OcrEngine } from '../pdf/ocr'
import { ocrPlan } from '../pdf/ocrPlan'
import { ocrFixturePage } from './ocrNode'
import { loadPdfPages } from './pdfNode'

export async function analyzePdfFile(file: string, opts: { engine?: OcrEngine | null; pages?: number[] } = {}) {
  const { pageCount, pages } = await loadPdfPages(file, opts.pages)
  const analyses: PdfPageAnalysis[] = []
  let ocrUsed = false
  for (const p of pages) {
    const base = {
      page: p.page,
      kind: p.kind,
      scene: p.kind === 'taranmis' ? null : p.scene,
      textGeometry: p.textGeometry,
      garbledText: p.stats.garbledText ?? 0,
      imageBoxes: p.imageBoxes,
      pageSize: { w: p.widthPt, h: p.heightPt },
    }
    let a = analyzePage(base)
    if (a.ocrNeeded && opts.engine) {
      const plan = ocrPlan({ kind: p.kind, textGeometry: p.textGeometry, imageBoxes: p.imageBoxes, garbledText: p.stats.garbledText, imageDpi: p.stats.imageDpi })
      const res = await ocrFixturePage(file, p.page, plan.regions, plan.dpi, opts.engine)
      a = analyzePage({ ...base, ocrRuns: res.runs })
      ocrUsed = true
    }
    analyses.push(a)
  }
  return { pageCount, analyses, ocrUsed, ...aggregatePdf(analyses, { pageCount, ocrUsed }) }
}
