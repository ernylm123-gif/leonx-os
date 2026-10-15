import { aggregatePdf, analyzePage, type PdfPageAnalysis } from '@/cad/pdf/archAnalyze'
import type { PdfPageEntry } from '@/cad/pdf/pdfLoader'
import { ocrPlan } from '@/cad/pdf/ocrPlan'
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
    // OCR: taranmış sayfa, çizgi olarak gömülü yazı (AutoCAD SHX), bozuk yazı tipi eşlemesi veya
    // görüntü olarak gömülü çizelge. Vektör sayfalarda yalnız yazı/görüntü bölgeleri yüksek
    // çözünürlükte karolar hâlinde okunur; sonuç vektör yazı ve geometriyle birleştirilir.
    if (analysis.ocrNeeded && opts.ocr && !entry.ocr) {
      const { regions, dpi } = ocrPlan({ kind: entry.kind, textGeometry: entry.textGeometry, imageBoxes: entry.imageBoxes, garbledText: entry.stats?.garbledText })
      opts.onProgress(`Sayfa ${p}: OCR hazırlanıyor`, base)
      const { ocrPdfPage } = await import('@/cad/pdf/ocr')
      check()
      const res = await ocrPdfPage((box, pxPerPt) => loader.renderPdfTile(pdfDoc.handle, p, box, pxPerPt), { widthPt: entry.widthPt, heightPt: entry.heightPt }, regions, {
        dpi,
        signal: opts.signal,
        onProgress: (f, status) => opts.onProgress(`Sayfa ${p}: OCR — ${status} (%${Math.round(f * 100)})`, base + span * Math.min(0.95, f)),
      })
      check()
      const ocr = { runs: res.runs, words: res.words, meanConfidence: res.meanConfidence, tiles: res.tiles, dpi }
      // Vektör sayfada geometri de gerekir (açıklık doğrulaması, kartlar, ölçek)
      const info = entry.kind === 'taranmis' ? null : await loader.analyzePdfPage(pdfDoc.handle, p)
      check()
      analysis = analyzePage({
        page: p,
        kind: entry.kind ?? 'taranmis',
        scene: info?.scene ?? null,
        ocrRuns: ocr.runs,
        textGeometry: entry.textGeometry ?? null,
        garbledText: entry.stats?.garbledText ?? 0,
        imageBoxes: entry.imageBoxes,
        pageSize: { w: entry.widthPt, h: entry.heightPt },
      })
      analysis.notes.push(`OCR: ${res.words} kelime, ${res.tiles} karo, ${dpi} dpi; ortalama tanıma güveni %${Math.round(res.meanConfidence * 100)}`)
      entry = { ...entry, analysis, ocr }
      opts.onPage(p, { analysis, ocr })
    }
    if (analysis.textSource === 'ocr' || analysis.textSource === 'vektor+ocr') ocrUsed = true
    // Görüntülenen sayfada kullanıcının onayladığı ölçek (kalibrasyon / ölçek onayı) geometri doğrulamasında kullanılır
    if (p === pdfDoc.current && opts.units.verified && opts.units.mmPerUnit && entry.kind !== 'taranmis') {
      const den = Math.round((opts.units.mmPerUnit / PT_TO_MM) * 1000) / 1000
      if (analysis.scale.usedFrom !== 'kullanici' || analysis.scale.used !== den) {
        analysis = analyzePage({
          page: p,
          kind: entry.kind ?? 'vektorel',
          scene: doc.scene,
          userDenominator: den,
          ocrRuns: entry.ocr?.runs,
          textGeometry: entry.textGeometry ?? null,
          garbledText: entry.stats?.garbledText ?? 0,
          imageBoxes: entry.imageBoxes,
          pageSize: { w: entry.widthPt, h: entry.heightPt },
        })
        opts.onPage(p, { analysis })
      }
    }
    analyses.push(analysis)
    opts.onProgress(`Sayfa ${p} analiz edildi`, base + span)
  }
  const { candidates, diagnostics } = aggregatePdf(analyses, { pageCount: pdfDoc.pages.length, skippedPages, ocrUsed })

  return { candidates, skipped: [], labelsFound: diagnostics.totals.labels, unitsVerified: opts.units.verified, pdf: diagnostics }
}
