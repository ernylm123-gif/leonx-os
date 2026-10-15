import { useCallback, useMemo, useState } from 'react'
import { useToast } from '@/context/toast'
import { uploadProjectFile } from '@/data/api'
import { createAnalysis, createItems, createTakeoff, listAnalyses, listTakeoffs } from '@/data/quantityApi'
import type { CadAnalysis, CadAnalysisInput, QuantityTakeoff } from '@/data/types'
import { dataErrorMessage } from '@/lib/errors'
import { contentTypeFor, validateFile } from '@/lib/files'
import { requireSupabase } from '@/lib/supabase'
import { useLiveList } from '@/lib/useLiveList'
import type { DetectionResult } from '@/quantity/detect'
import type { QuantityItem, QuantityItemInput } from '@/quantity/types'
import type { UnitState } from '../format'
import type { LoadedCad } from '../useCadDocument'

export const ENGINE_VERSION = 'leonx-cad-1.1'

export interface BindRequest {
  projectId: string
  takeoff: { id: string } | { newName: string }
  uploadFile: boolean
  saveAnalysis: boolean
}

/** Analiz özetinin veritabanı kaydı (geometri saklanmaz; dosya projede durur) */
/** Dosyanın SHA-256 özeti (onaltılık) — tarayıcı Web Crypto */
export async function fileHash(bytes: ArrayBuffer): Promise<string | null> {
  try {
    const d = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

export function analysisRecord(doc: LoadedCad, units: UnitState, projectId: string, fileId: string | null, detection: DetectionResult | null, hash: string | null = null): CadAnalysisInput {
  const r = doc.report
  const summary: Record<string, unknown> = {
    format: doc.kind,
    surum: r?.release ?? r?.acadver ?? null,
    kodlama: r?.encoding ?? null,
    birim: { kaynak: units.source, mm: units.mmPerUnit, dogrulandi: units.verified, not: units.note },
    nesneler: r?.counts.map((c) => ({ tur: c.type, adet: c.total, cizilen: c.drawn, destek: c.level })) ?? [],
    uyarilar: (r?.warnings ?? []).slice(0, 60).map((w) => ({ kod: w.code, duzey: w.severity, ileti: w.message, adet: w.count ?? 1 })),
    sinir: doc.scene.bbox,
    katman_sayisi: doc.scene.layers.length,
    blok_sayisi: r?.blocks.length ?? 0,
    eksik: r?.truncated ?? false,
    pdf: doc.pdf
      ? {
          tur: doc.pdf.kind,
          sayfa: doc.pdf.pageNumber,
          sayfa_sayisi: doc.pdf.pageCount,
          istatistik: doc.pdf.stats,
          olcek_ipuclari: doc.pdf.scaleHints,
          // Tüm sayfaların özeti (pafta türü, yazı/etiket sayısı, ölçek)
          sayfalar: (doc.pdfDoc?.pages ?? []).slice(0, 200).map((p) => ({
            sayfa: p.page,
            tur: p.kind,
            hata: p.error,
            pafta: p.analysis?.sheet ?? null,
            baslik: p.analysis?.title ?? null,
            yazi: p.analysis?.textCount ?? 0,
            kaynak: p.analysis?.textSource ?? null,
            etiket: p.analysis?.labelCount ?? 0,
            cizelge: p.analysis?.scheduleRows ?? 0,
            olcek: p.analysis?.scale.used ?? null,
            olcek_kaynagi: p.analysis?.scale.usedFrom ?? null,
            olcek_dogrulandi: p.analysis?.scale.verified ?? false,
            kart: p.analysis?.cardCount ?? 0,
            kat_carpani: p.analysis?.floor.multiplier ?? null,
            ocr_gerekli: p.analysis?.ocrNeeded ?? null,
          })),
        }
      : null,
    tespit: detection
      ? {
          aday: detection.candidates.length,
          etiket: detection.labelsFound,
          elenen: detection.skipped,
          ...(detection.pdf
            ? {
                analiz_edilen_sayfalar: detection.pdf.analyzedPages,
                neden_yok: detection.pdf.whyNone,
                uyarilar: detection.pdf.warnings,
                ocr: detection.pdf.ocrUsed,
                // Faz 5.2: çelişki ve tanı raporu (bildirim ve izlenebilirlik)
                celiski: detection.candidates.filter((c) => 'conflicts' in c && (c as { conflicts: unknown[] }).conflicts.length > 0).length,
                rapor: {
                  okunabildi: detection.pdf.report.readable,
                  pafta: detection.pdf.report.pagesFound,
                  analiz_edilen: detection.pdf.report.pagesAnalyzed,
                  yazi: detection.pdf.report.texts,
                  olcek_dogrulanan: detection.pdf.report.scaleVerifiedPages,
                  olcek_dogrulanamayan: detection.pdf.report.scaleUnverifiedPages,
                  ocr_gereken: detection.pdf.report.ocrNeededPages,
                  basarisiz: detection.pdf.report.failedPages,
                  eksik: detection.pdf.report.missing.slice(0, 20),
                  sorular: detection.pdf.report.asks.map((a) => a.message).slice(0, 10),
                },
              }
            : {}),
        }
      : null,
  }
  return {
    project_id: projectId,
    file_id: fileId,
    file_name: doc.fileName.slice(0, 255),
    file_kind: doc.kind,
    status: r?.truncated ? 'eksik' : 'tamamlandi',
    units_mm_per_unit: units.mmPerUnit,
    units_source: units.source,
    units_verified: units.verified,
    entity_count: doc.scene.entities.length,
    warning_count: r?.warnings.length ?? 0,
    candidate_count: detection?.candidates.length ?? 0,
    engine_version: ENGINE_VERSION,
    summary,
    notes: null,
    file_hash: hash,
  }
}

/**
 * CAD çalışma alanının proje bağlantısı: projeye dosya yükleme, analiz kaydı ve metraj sürümü seçimi.
 * Proje bağlanınca metraj Supabase'de tutulur ve Realtime ile diğer cihazlara yansır.
 */
export function useCadProject(initial: { projectId: string | null; fileId: string | null }) {
  const { notify } = useToast()
  const [projectId, setProjectId] = useState<string | null>(initial.projectId)
  const [takeoffId, setTakeoffId] = useState<string | null>(null)
  const [fileId, setFileId] = useState<string | null>(initial.fileId)
  const [analysis, setAnalysis] = useState<CadAnalysis | null>(null)
  const [busy, setBusy] = useState(false)
  const takeoffs = useLiveList<QuantityTakeoff>('quantity_takeoffs', 'project_id', projectId ?? undefined, (id) => listTakeoffs(requireSupabase(), id))
  const analyses = useLiveList<CadAnalysis>('cad_analyses', 'project_id', projectId ?? undefined, (id) => listAnalyses(requireSupabase(), id))
  const takeoff = useMemo(() => takeoffs.items.find((t) => t.id === takeoffId) ?? null, [takeoffs.items, takeoffId])

  const bind = useCallback(
    async (req: BindRequest, doc: LoadedCad | null, units: UnitState, detection: DetectionResult | null, pending: QuantityItem[]): Promise<boolean> => {
      const db = requireSupabase()
      setBusy(true)
      let step = 'Proje bağlantısı'
      try {
        let fid = req.projectId === projectId ? fileId : null
        if (doc && req.uploadFile && !fid && doc.source.type === 'local') {
          step = 'Dosya yükleme'
          const file = new File([doc.bytes], doc.fileName, { type: contentTypeFor(doc.fileName) })
          const invalid = validateFile(file)
          if (invalid) throw new Error(invalid)
          const row = await uploadProjectFile(db, req.projectId, file)
          fid = row.id
        }
        let an: CadAnalysis | null = req.projectId === projectId ? analysis : null
        if (doc && req.saveAnalysis && !an) {
          step = 'Analiz kaydı'
          an = await createAnalysis(db, analysisRecord(doc, units, req.projectId, fid, detection, await fileHash(doc.bytes)))
        }
        step = 'Metraj sürümü'
        let tid: string
        if ('id' in req.takeoff) tid = req.takeoff.id
        else tid = (await createTakeoff(db, req.projectId, req.takeoff.newName.trim() || 'Metraj', an?.id ?? null)).id
        if (pending.length) {
          step = 'Kaydedilmemiş pozların aktarımı'
          const inputs: QuantityItemInput[] = pending.map(({ id: _i, takeoff_id: _t, project_id: _p, created_by: _c, created_at: _a, updated_at: _u, version: _v, ...rest }) => ({
            ...rest,
            drawing_ref: rest.drawing_ref ? { ...rest.drawing_ref, analysis_id: an?.id ?? rest.drawing_ref.analysis_id ?? null } : null,
          }))
          await createItems(db, tid, req.projectId, inputs)
        }
        setProjectId(req.projectId)
        setFileId(fid)
        setAnalysis(an)
        setTakeoffId(tid)
        notify('Çizim projeye bağlandı.')
        return true
      } catch (e) {
        notify(e instanceof Error && !('code' in e) ? `${step}: ${e.message}` : `${step}: ${dataErrorMessage(e, step)}`, 'error')
        return false
      } finally {
        setBusy(false)
      }
    },
    [projectId, fileId, analysis, notify],
  )

  const saveAnalysis = useCallback(
    async (doc: LoadedCad, units: UnitState, detection: DetectionResult | null) => {
      if (!projectId) return null
      setBusy(true)
      try {
        const an = await createAnalysis(requireSupabase(), analysisRecord(doc, units, projectId, fileId, detection))
        setAnalysis(an)
        notify('Analiz projeye kaydedildi.')
        return an
      } catch (e) {
        notify(dataErrorMessage(e, 'Analiz kaydı'), 'error')
        return null
      } finally {
        setBusy(false)
      }
    },
    [projectId, fileId, notify],
  )

  const unbind = useCallback(() => {
    setProjectId(null)
    setTakeoffId(null)
    setAnalysis(null)
    setFileId(null)
  }, [])

  return {
    projectId,
    takeoffId,
    setTakeoffId,
    takeoff,
    takeoffs: takeoffs.items,
    analyses: analyses.items,
    analysis,
    fileId,
    busy,
    bind,
    saveAnalysis,
    unbind,
    /** Yeni dosya açıldığında analiz ve dosya bağlantısı sıfırlanır (proje ve sürüm korunur) */
    resetDocument: (nextFileId: string | null) => {
      setAnalysis(null)
      setFileId(nextFileId)
    },
  }
}
