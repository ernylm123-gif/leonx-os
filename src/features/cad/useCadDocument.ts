import { useCallback, useRef, useState } from 'react'
import { analyzeDxfBytes, CadAnalysisError, MAX_CAD_BYTES } from '@/cad/analyze'
import { detectCadFile } from '@/cad/fileType'
import type { OpenedPdf, PdfPageEntry } from '@/cad/pdf/pdfLoader'
import type { PdfPageInfo } from '@/cad/pdf/pdfScene'
import { PT_TO_MM } from '@/cad/pdf/pdfScene'
import type { CadReport, Scene } from '@/cad/types'
import { AnalysisCancelled, analyzeInWorker, STAGE_LABEL } from '@/cad/worker/client'
import type { UnitState } from './format'

export interface CadSource {
  type: 'local' | 'project'
  projectId?: string
  fileId?: string
}

export interface LoadedCad {
  /** Dosya yüklemesinin kimliği: sayfa değişince aynı kalır, yeni dosyada değişir */
  docId: string
  kind: 'dxf' | 'pdf'
  fileName: string
  size: number
  source: CadSource
  /** Ham dosya (projeye kaydetmek için saklanır) */
  bytes: ArrayBuffer
  scene: Scene
  report: CadReport | null
  /** Görüntülenen PDF sayfası */
  pdf: (PdfPageInfo & { background: HTMLCanvasElement | null }) | null
  /** Çok sayfalı PDF: açık belge ve tüm sayfaların özeti/analizi */
  pdfDoc: { handle: OpenedPdf; pages: PdfPageEntry[]; current: number } | null
  loadedAt: Date
}

const newDocId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export type CadLoadState =
  | { status: 'empty' }
  | { status: 'loading'; fileName: string; stage: string; fraction: number }
  | { status: 'error'; fileName: string; message: string; code: string; detail?: string }
  | { status: 'ready'; doc: LoadedCad }

export const UNKNOWN_UNITS: UnitState = { mmPerUnit: null, source: 'yok', verified: false, note: 'Birim bilinmiyor' }

export function initialUnits(doc: LoadedCad): UnitState {
  if (doc.kind === 'dxf' && doc.report?.units.mmPerUnit) {
    return { mmPerUnit: doc.report.units.mmPerUnit, source: 'dosya', verified: true, note: `Dosya başlığı: ${doc.report.units.label}` }
  }
  if (doc.kind === 'pdf') {
    return { mmPerUnit: null, source: 'yok', verified: false, note: 'PDF ölçeği bilinmiyor — kalibrasyon veya ölçek onayı gerekli' }
  }
  return UNKNOWN_UNITS
}

/** PDF ölçek önerisi → birim durumu (kullanıcı onayı bekler) */
export function unitsFromPdfScale(denominator: number, verified: boolean): UnitState {
  return {
    mmPerUnit: PT_TO_MM * denominator,
    source: 'olcek',
    verified,
    note: `Ölçek 1/${denominator} (kâğıt üzerinde 1 mm = ${denominator} mm)`,
  }
}

/**
 * CAD dosyası yükleme durumu: tür tespiti, DXF için Web Worker, PDF için pdf.js.
 * İptal: AbortController ile worker sonlandırılır.
 */
export function useCadDocument() {
  const [state, setState] = useState<CadLoadState>({ status: 'empty' })
  const abortRef = useRef<AbortController | null>(null)
  const docRef = useRef<LoadedCad | null>(null)
  const [pageBusy, setPageBusy] = useState<number | null>(null)

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const load = useCallback(
    async (fileName: string, bytes: ArrayBuffer, source: CadSource = { type: 'local' }) => {
      cancel()
      const ac = new AbortController()
      abortRef.current = ac
      if (bytes.byteLength > MAX_CAD_BYTES) {
        setState({ status: 'error', fileName, code: 'too-large', message: 'Dosya 50 MB analiz sınırını aşıyor.' })
        return null
      }
      const kind = detectCadFile(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4096)))
      // Saklanacak kopya (worker'a aktarılan bellek ana iş parçacığından ayrılır)
      const keep = bytes.slice(0)
      try {
        if (kind.kind === 'pdf') {
          setState({ status: 'loading', fileName, stage: 'PDF açılıyor', fraction: 0.05 })
          const { openPdf, analyzePdfPage, renderPdfPage, summarizePage, MAX_SUMMARY_PAGES } = await import('@/cad/pdf/pdfLoader')
          let pdf: OpenedPdf
          try {
            pdf = await openPdf(bytes.slice(0))
          } catch (e) {
            const msg = e instanceof Error ? e.message : ''
            throw new CadAnalysisError(
              /password/i.test(msg) ? 'PDF parola korumalı; parolasız bir kopyasını yükleyin.' : 'PDF okunamadı: dosya bozuk veya eksik indirilmiş olabilir.',
              'pdf-open',
              msg || undefined,
            )
          }
          if (ac.signal.aborted) throw new AnalysisCancelled()
          // Tüm sayfalar (en fazla MAX_SUMMARY_PAGES) okunur: tür, pafta, ölçek, etiket ve çizelge
          const n = pdf.pageCount
          const pages: PdfPageEntry[] = []
          let shown: PdfPageInfo | null = null
          for (let p = 1; p <= n; p++) {
            if (ac.signal.aborted) throw new AnalysisCancelled()
            if (p > MAX_SUMMARY_PAGES) {
              pages.push({ page: p, widthPt: 0, heightPt: 0, kind: null, stats: null, analysis: null, error: null, truncated: false })
              continue
            }
            setState({ status: 'loading', fileName, stage: `Sayfa ${p}/${n} çözümleniyor`, fraction: 0.08 + (0.8 * (p - 1)) / Math.min(n, MAX_SUMMARY_PAGES) })
            let info: PdfPageInfo | null = null
            try {
              info = await analyzePdfPage(pdf, p)
            } catch {
              info = null
            }
            const entry = await summarizePage(pdf, p, info ?? undefined)
            pages.push(entry)
            // İlk boş olmayan sayfa gösterilir; sahnesi bellekte tutulur, diğerlerininki bırakılır
            if (info && !shown && info.kind !== 'bos') shown = info
            else if (info && !shown && p === 1) shown = info
            else if (shown?.kind === 'bos' && info && info.kind !== 'bos') shown = info
          }
          if (!shown) {
            const firstOk = pages.find((x) => !x.error)
            if (!firstOk) throw new CadAnalysisError('PDF açıldı ancak hiçbir sayfası okunamadı (dosya bozuk veya şifreli olabilir).', 'pdf-pages')
            shown = await analyzePdfPage(pdf, firstOk.page)
          }
          if (ac.signal.aborted) throw new AnalysisCancelled()
          setState({ status: 'loading', fileName, stage: 'Sayfa görüntüsü hazırlanıyor', fraction: 0.92 })
          let background: HTMLCanvasElement | null = null
          try {
            background = await renderPdfPage(pdf, shown.pageNumber)
          } catch {
            background = null
          }
          if (ac.signal.aborted) throw new AnalysisCancelled()
          const doc: LoadedCad = {
            docId: newDocId(),
            kind: 'pdf',
            fileName,
            size: keep.byteLength,
            source,
            bytes: keep,
            scene: shown.scene,
            report: null,
            pdf: { ...shown, background },
            pdfDoc: { handle: pdf, pages, current: shown.pageNumber },
            loadedAt: new Date(),
          }
          docRef.current = doc
          setState({ status: 'ready', doc })
          return doc
        }
        if (kind.kind === 'dwg' || kind.kind === 'dxf-binary' || kind.kind === 'unknown') {
          // Bu türler worker'a gönderilmeden, analiz çekirdeğinin açıklamalı hatasıyla reddedilir
          analyzeDxfBytes(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4096)))
        }
        setState({ status: 'loading', fileName, stage: STAGE_LABEL.okuma, fraction: 0 })
        const result = await analyzeInWorker(bytes, {
          signal: ac.signal,
          onProgress: (stage, fraction) => setState({ status: 'loading', fileName, stage: STAGE_LABEL[stage] ?? stage, fraction }),
        })
        const doc: LoadedCad = {
          docId: newDocId(),
          kind: 'dxf',
          fileName,
          size: keep.byteLength,
          source,
          bytes: keep,
          scene: result.scene,
          report: result.report,
          pdf: null,
          pdfDoc: null,
          loadedAt: new Date(),
        }
        docRef.current = doc
        setState({ status: 'ready', doc })
        return doc
      } catch (e) {
        if (e instanceof AnalysisCancelled || ac.signal.aborted) {
          setState({ status: 'empty' })
          return null
        }
        if (e instanceof CadAnalysisError) {
          setState({ status: 'error', fileName, message: e.message, code: e.code, detail: e.detail })
        } else {
          setState({
            status: 'error',
            fileName,
            code: 'internal',
            message: e instanceof Error ? `Dosya açılamadı: ${e.message}` : 'Dosya açılamadı.',
          })
        }
        return null
      } finally {
        if (abortRef.current === ac) abortRef.current = null
      }
    },
    [cancel],
  )

  /** PDF'te başka sayfayı görüntüle (dosya yeniden yüklenmez; analiz durumu korunur) */
  const selectPage = useCallback(async (page: number): Promise<LoadedCad | null> => {
    const cur = docRef.current
    if (!cur?.pdfDoc || page < 1 || page > cur.pdfDoc.pages.length) return null
    if (cur.pdfDoc.current === page) return cur
    setPageBusy(page)
    try {
      const { analyzePdfPage, renderPdfPage, summarizePage } = await import('@/cad/pdf/pdfLoader')
      const info = await analyzePdfPage(cur.pdfDoc.handle, page)
      let background: HTMLCanvasElement | null = null
      try {
        background = await renderPdfPage(cur.pdfDoc.handle, page)
      } catch {
        background = null
      }
      const latest = docRef.current
      if (!latest || latest.docId !== cur.docId) return null
      const pages = latest.pdfDoc!.pages.slice()
      if (!pages[page - 1].analysis) pages[page - 1] = await summarizePage(latest.pdfDoc!.handle, page, info)
      const next: LoadedCad = { ...latest, scene: info.scene, pdf: { ...info, background }, pdfDoc: { ...latest.pdfDoc!, pages, current: page } }
      docRef.current = next
      setState({ status: 'ready', doc: next })
      return next
    } catch {
      return null
    } finally {
      setPageBusy(null)
    }
  }, [])

  /** Sayfa özetini/analizini güncelle (ör. OCR sonucu, kullanıcı ölçeğiyle yeniden analiz) */
  const setPageAnalysis = useCallback((page: number, patch: Partial<PdfPageEntry>) => {
    const cur = docRef.current
    if (!cur?.pdfDoc) return
    const pages = cur.pdfDoc.pages.slice()
    pages[page - 1] = { ...pages[page - 1], ...patch }
    const next: LoadedCad = { ...cur, pdfDoc: { ...cur.pdfDoc, pages } }
    docRef.current = next
    setState({ status: 'ready', doc: next })
  }, [])

  const reset = useCallback(() => {
    cancel()
    docRef.current = null
    setState({ status: 'empty' })
  }, [cancel])

  /** Dosya indirilemediğinde (ör. projeden açma) açıklamalı hata durumu */
  const fail = useCallback((fileName: string, message: string) => setState({ status: 'error', fileName, code: 'download', message }), [])

  const pending = useCallback((fileName: string, stage: string) => setState({ status: 'loading', fileName, stage, fraction: 0.02 }), [])

  return { state, load, cancel, reset, fail, pending, selectPage, setPageAnalysis, pageBusy }
}
