import { useCallback, useRef, useState } from 'react'
import { analyzeDxfBytes, CadAnalysisError, MAX_CAD_BYTES } from '@/cad/analyze'
import { detectCadFile } from '@/cad/fileType'
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
  kind: 'dxf' | 'pdf'
  fileName: string
  size: number
  source: CadSource
  /** Ham dosya (projeye kaydetmek için saklanır) */
  bytes: ArrayBuffer
  scene: Scene
  report: CadReport | null
  pdf: (PdfPageInfo & { background: HTMLCanvasElement | null }) | null
  loadedAt: Date
}

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
          setState({ status: 'loading', fileName, stage: 'PDF açılıyor', fraction: 0.1 })
          const { openPdf, analyzePdfPage, renderPdfPage } = await import('@/cad/pdf/pdfLoader')
          const pdf = await openPdf(bytes.slice(0))
          if (ac.signal.aborted) throw new AnalysisCancelled()
          setState({ status: 'loading', fileName, stage: 'Sayfa çözümleniyor', fraction: 0.4 })
          const info = await analyzePdfPage(pdf, 1)
          if (ac.signal.aborted) throw new AnalysisCancelled()
          setState({ status: 'loading', fileName, stage: 'Sayfa görüntüsü hazırlanıyor', fraction: 0.75 })
          let background: HTMLCanvasElement | null = null
          try {
            background = await renderPdfPage(pdf, 1)
          } catch {
            background = null
          }
          if (ac.signal.aborted) throw new AnalysisCancelled()
          const doc: LoadedCad = {
            kind: 'pdf',
            fileName,
            size: keep.byteLength,
            source,
            bytes: keep,
            scene: info.scene,
            report: null,
            pdf: { ...info, background },
            loadedAt: new Date(),
          }
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
          kind: 'dxf',
          fileName,
          size: keep.byteLength,
          source,
          bytes: keep,
          scene: result.scene,
          report: result.report,
          pdf: null,
          loadedAt: new Date(),
        }
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

  const reset = useCallback(() => {
    cancel()
    setState({ status: 'empty' })
  }, [cancel])

  return { state, load, cancel, reset }
}
