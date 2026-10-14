import { aggregatePdf, analyzePage, type PdfPageAnalysis } from '@/cad/pdf/archAnalyze'
import type { PdfPageEntry } from '@/cad/pdf/pdfLoader'
import { PT_TO_MM } from '@/cad/pdf/pdfScene'
import type { DetectionResult } from '@/quantity/detect'
import type { UnitState } from '../format'
import type { LoadedCad } from '../useCadDocument'

export class DetectionCancelled extends Error {}

/**
 * Seçilen PDF sayfalarında doğrama tespiti. Vektörel sayfaların analizi yüklemede yapılmıştır;
 * burada eksik sayfalar özetlenir, taranmış sayfalar (istenirse) OCR ile okunur, görüntülenen
 * sayfa kullanıcının onayladığı ölçekle yeniden doğrulanır ve sonuçlar birleştirilir.
 */
export async function runPdfDetection(
  doc: LoadedCad,
  opts: {
    pages: number[]
    ocr: boolean
    units: UnitState
    signal: AbortSignal
    onProgress: (stage: string, fraction: number) => void
    onPage: (page: number, patch: Partial<PdfPageEntry>) => void
  },
): Promise<DetectionResult> {
  const pdfDoc = doc.pdfDoc
  if (!pdfDoc) throw new Error('PDF belgesi açık değil')
  const loader = await import('@/cad/pdf/pdfLoader')
  const analyses: PdfPageAnalysis[] = []
  const skippedPages: { page: number; reason: string }[] = []
  let ocrUsed = false
  const pages = [...opts.pages].sort((a, b) => a - b)
  const check = () => {
    if (opts.signal.aborted) throw new DetectionCancelled('İptal edildi')
  }
  for (let i = 0; i < pages.length; i++) {
    check()
    const p = pages[i]
    const base = i / pages.length
    const span = 1 / pages.length
    let entry = pdfDoc.pages[p - 1]
    if (!entry) continue
    if (entry.error) {
      skippedPages.push({ page: p, reason: entry.error })
      continue
    }
    if (!entry.analysis) {
      opts.onProgress(`Sayfa ${p} okunuyor`, base)
      entry = await loader.summarizePage(pdfDoc.handle, p)
      opts.onPage(p, entry)
      if (entry.error || !entry.analysis) {
        skippedPages.push({ page: p, reason: entry.error ?? 'Sayfa okunamadı' })
        continue
      }
    }
    let analysis = entry.analysis!
    const needsOcr = entry.kind === 'taranmis' || (entry.kind === 'karma' && analysis.textCount < 5)
    if (needsOcr && opts.ocr && analysis.textSource !== 'ocr') {
      opts.onProgress(`Sayfa ${p}: görüntü hazırlanıyor (OCR)`, base)
      const canvas = await loader.renderPdfPage(pdfDoc.handle, p, 12_000_000)
      check()
      const { ocrCanvas } = await import('@/cad/pdf/ocr')
      try {
        const res = await ocrCanvas(canvas, { widthPt: entry.widthPt, heightPt: entry.heightPt }, {
          signal: opts.signal,
          onProgress: (f, status) => opts.onProgress(`Sayfa ${p}: ${status === 'recognizing text' ? 'yazılar tanınıyor' : 'OCR hazırlanıyor'} (%${Math.round(f * 100)})`, base + span * Math.min(0.95, f)),
        })
        check()
        analysis = analyzePage({ page: p, kind: entry.kind ?? 'taranmis', scene: null, ocrRuns: res.runs })
        analysis.notes.push(`OCR: ${res.words} kelime okundu, ortalama tanıma güveni %${Math.round(res.meanConfidence * 100)}`)
        opts.onPage(p, { analysis })
      } finally {
        canvas.width = 0
        canvas.height = 0
      }
    }
    if (analysis.textSource === 'ocr') ocrUsed = true
    // Görüntülenen sayfada kullanıcının onayladığı ölçek (kalibrasyon / ölçek onayı) geometri doğrulamasında kullanılır
    if (p === pdfDoc.current && opts.units.verified && opts.units.mmPerUnit && analysis.textSource !== 'ocr') {
      const den = Math.round((opts.units.mmPerUnit / PT_TO_MM) * 1000) / 1000
      if (analysis.scale.usedFrom !== 'kullanici' || analysis.scale.used !== den) {
        analysis = analyzePage({ page: p, kind: entry.kind ?? 'vektorel', scene: doc.scene, userDenominator: den })
        opts.onPage(p, { analysis })
      }
    }
    analyses.push(analysis)
    opts.onProgress(`Sayfa ${p} analiz edildi`, base + span)
  }
  const { candidates, diagnostics } = aggregatePdf(analyses, { pageCount: pdfDoc.pages.length, skippedPages, ocrUsed })
  if (!opts.ocr) {
    const scanned = analyses.filter((a) => a.kind === 'taranmis' && a.textSource !== 'ocr').length
    if (scanned) diagnostics.warnings.push(`${scanned} taranmış sayfa OCR olmadan analiz edildi; bu sayfalardaki yazılar okunmadı.`)
  }
  return { candidates, skipped: [], labelsFound: diagnostics.totals.labels, unitsVerified: opts.units.verified, pdf: diagnostics }
}
