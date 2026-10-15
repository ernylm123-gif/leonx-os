import { ClipboardCheck, FileSpreadsheet, FolderKanban, History, Layers3, ListChecks, Save, ScanLine, Send, Table2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Measurement } from '@/cad/viewer/engine'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { downloadProjectFile, listProjectFiles } from '@/data/api'
import { CadWorkspace, type WorkspaceContext } from '@/features/cad/workspace/CadWorkspace'
import { PdfAnalysisControls, type PdfRunProgress } from '@/features/cad/quantity/PdfAnalysisControls'
import { type CandidateEdit, PdfResultsTable } from '@/features/cad/quantity/PdfResultsTable'
import { PozPanel } from '@/features/cad/quantity/PozPanel'
import { DetectionCancelled, runPdfDetection } from '@/features/cad/quantity/runPdfDetection'
import { SendToQuoteDialog } from '@/features/cad/quantity/SendToQuoteDialog'
import { ProjectBindingDialog } from '@/features/cad/quantity/ProjectBindingDialog'
import { ProjectHistoryPanel } from '@/features/cad/quantity/ProjectHistoryPanel'
import { useCadProject } from '@/features/cad/quantity/useCadProject'
import { ReviewPanel } from '@/features/cad/review/ReviewPanel'
import { SheetsPanel } from '@/features/cad/review/SheetsPanel'
import { ItemDetail } from '@/features/quantity/ItemDetail'
import { QuantityItemForm } from '@/features/quantity/QuantityItemForm'
import { QuantityTable } from '@/features/quantity/QuantityTable'
import { type ItemsStore, useLocalItems, useRemoteItems } from '@/features/quantity/useItemsStore'
import { cn } from '@/lib/cn'
import { useUnsavedChanges } from '@/lib/unsaved'
import { requireSupabase } from '@/lib/supabase'
import { detectDxf } from '@/cad/dxfSemantic'
import type { DetectionResult, PozCandidate } from '@/quantity/detect'
import { areaMeasurementToInput, candidateToInput, distanceMeasurementToInput } from '@/quantity/fromDetection'
import type { QuantityCategory, QuantityItem, QuantityItemInput } from '@/quantity/types'

type Box = [number, number, number, number]
const unionBox = (boxes: Box[]): Box => [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]

export function CadAnalysisPage() {
  const [params] = useSearchParams()
  const projectParam = params.get('proje')
  const fileParam = params.get('dosya')
  // Parametre değişince çalışma alanı baştan kurulur
  return <CadAnalysisView key={`${projectParam ?? ''}|${fileParam ?? ''}`} projectParam={projectParam} fileParam={fileParam} />
}

function CadAnalysisView({ projectParam, fileParam }: { projectParam: string | null; fileParam: string | null }) {
  const { projects } = useData()
  const { notify } = useToast()
  const project = useCadProject({ projectId: projectParam, fileId: fileParam })
  const local = useLocalItems()
  const remote = useRemoteItems(project.takeoff)
  const store: ItemsStore = project.takeoff ? remote : local
  const [detection, setDetection] = useState<DetectionResult | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [ignored, setIgnored] = useState<Set<string>>(new Set())
  const [selectedCand, setSelectedCand] = useState<PozCandidate | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [bindOpen, setBindOpen] = useState(false)
  const [measureForm, setMeasureForm] = useState<QuantityItemInput | null>(null)
  const [edits, setEdits] = useState<Record<string, CandidateEdit>>({})
  const [pdfPages, setPdfPages] = useState<Set<number>>(new Set())
  const [ocr, setOcr] = useState(false)
  const [progress, setProgress] = useState<PdfRunProgress | null>(null)
  const [analyzedAt, setAnalyzedAt] = useState<Date | null>(null)
  const [viewPage, setViewPage] = useState<number | null>(null)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [loadedDocId, setLoadedDocId] = useState<string | null>(null)
  // Mühendislik incelemesi: sol pafta listesi + orta çizim + sağ poz incelemesi + alt metraj tablosu
  const [review, setReview] = useState(false)
  const runAbort = useRef<AbortController | null>(null)
  const pendingZoom = useRef<{ page: number; box: Box } | null>(null)
  const autoRunFor = useRef<string | null>(null)
  const ctxRef = useRef<WorkspaceContext | null>(null)
  useUnsavedChanges(store.kind === 'local' && local.items.length > 0, 'Projeye kaydedilmemiş metraj')
  const docRef = useRef<string | null>(null)

  const initialFile = useMemo(() => {
    if (!projectParam || !fileParam) return null
    return {
      source: { type: 'project' as const, projectId: projectParam, fileId: fileParam },
      load: async () => {
        const db = requireSupabase()
        const files = await listProjectFiles(db, projectParam)
        const f = files.find((x) => x.id === fileParam)
        if (!f) throw new Error('Dosya projede bulunamadı (silinmiş olabilir).')
        const blob = await downloadProjectFile(db, f)
        return { name: f.file_name, bytes: await blob.arrayBuffer() }
      },
    }
  }, [projectParam, fileParam])

  const onContext = useCallback(
    (c: WorkspaceContext) => {
      ctxRef.current = c
      const id = c.doc?.docId ?? null
      if (id !== docRef.current) {
        const prev = docRef.current
        docRef.current = id
        if (prev !== null || c.doc) {
          runAbort.current?.abort()
          setDetection(null)
          setIgnored(new Set())
          setSelectedCand(null)
          setEdits({})
          setAnalyzedAt(null)
          setOcr(false)
          setPdfPages(new Set(c.doc?.pdfDoc?.pages.filter((p) => !p.error && p.kind !== 'bos').map((p) => p.page) ?? []))
        }
        // Yerel dosya açıldıysa analiz bağı sıfırlanır (proje ve sürüm korunur)
        if (prev !== null && c.doc) project.resetDocument(c.doc.source.type === 'project' ? (c.doc.source.fileId ?? null) : null)
      }
      setViewPage(c.doc?.pdfDoc?.current ?? null)
      setLoadedDocId(id)
      // Sayfa değişiminden sonra bekleyen yakınlaştırma (görüntüleyici yeni sahneyi yükledi)
      const pz = pendingZoom.current
      if (pz && c.doc?.pdfDoc?.current === pz.page) {
        pendingZoom.current = null
        c.zoomTo(pz.box)
      }
    },
    [project],
  )

  const addedKeys = useMemo(() => new Set(store.items.map((i) => i.drawing_ref?.key).filter((k): k is string => !!k)), [store.items])
  const selectedItem = store.items.find((i) => i.id === selectedItemId) ?? null
  const boundProject = projects.find((p) => p.id === project.projectId) ?? null

  const runPdf = useCallback(
    async (pages: number[], withOcr: boolean) => {
      const c = ctxRef.current
      if (!c?.doc?.pdfDoc) return
      runAbort.current?.abort()
      const ac = new AbortController()
      runAbort.current = ac
      setDetecting(true)
      setProgress({ stage: 'Analiz başlatıldı', fraction: 0 })
      c.log(`PDF analizi başlatıldı: ${pages.length} sayfa${withOcr ? ' (OCR açık)' : ''}`)
      // Diğer cihazlarda görünür (kullanıcının kendi işlemi; bildirim tercihine tabi)
      const fileName = c.doc.fileName
      void import('@/data/workflowApi')
        .then(({ notifyClientEvent }) =>
          notifyClientEvent(requireSupabase(), 'cad_basladi', `CAD analizi başladı: ${fileName}`.slice(0, 200), `${pages.length} sayfa${withOcr ? ' · OCR açık' : ''}`, '/cad-analiz', `${fileName}:${c.doc?.docId}:${withOcr ? 'ocr' : 'v'}`.slice(0, 150)),
        )
        .catch(() => undefined)
      try {
        const result = await runPdfDetection(c.doc, {
          pages,
          ocr: withOcr,
          units: c.units,
          signal: ac.signal,
          onProgress: (stage, fraction) => !ac.signal.aborted && setProgress({ stage, fraction }),
          onPage: (p, patch) => ctxRef.current?.setPageAnalysis(p, patch),
        })
        if (ac.signal.aborted) return
        setDetection(result)
        setAnalyzedAt(new Date())
        setSelectedCand(null)
        c.log(`PDF analizi bitti: ${result.candidates.length} aday${result.candidates.length ? '' : ` — ${result.pdf?.whyNone[0] ?? ''}`}`)
      } catch (e) {
        if (e instanceof DetectionCancelled || (e instanceof DOMException && e.name === 'AbortError') || ac.signal.aborted) c.log('PDF analizi iptal edildi')
        else {
          c.log(`PDF analizi başarısız: ${e instanceof Error ? e.message : 'bilinmeyen hata'}`)
          notify(`PDF analizi tamamlanamadı: ${e instanceof Error ? e.message : 'bilinmeyen hata'}`, 'error')
        }
      } finally {
        if (runAbort.current === ac) runAbort.current = null
        setDetecting(false)
        setProgress(null)
      }
    },
    [notify],
  )

  // PDF yüklenince vektörel sayfalar otomatik analiz edilir (OCR kullanıcı isteğiyle)
  useEffect(() => {
    const c = ctxRef.current
    if (!c?.doc?.pdfDoc || !loadedDocId || autoRunFor.current === loadedDocId) return
    autoRunFor.current = loadedDocId
    const pages = c.doc.pdfDoc.pages.filter((p) => !p.error && p.kind !== 'bos').map((p) => p.page)
    void runPdf(pages.length ? pages : c.doc.pdfDoc.pages.filter((p) => !p.error).map((p) => p.page), false)
  }, [loadedDocId, runPdf])

  const runDetection = () => {
    const c = ctxRef.current
    if (!c?.doc) return
    if (c.doc.kind === 'pdf') {
      void runPdf([...pdfPages], ocr)
      return
    }
    setDetecting(true)
    // Arayüzün güncellenmesi için bir sonraki karede çalıştırılır
    window.setTimeout(() => {
      try {
        // DXF: mimari motor (etiket, çizelge, kat tekrarı, çelişki) + blok geometrisi birlikte
        const { semantic: _semantic, ...result } = detectDxf(c.doc!.scene, { mmPerUnit: c.units.mmPerUnit, unitsVerified: c.units.verified })
        setDetection(result)
        c.log(`Poz tespiti: ${result.candidates.length} aday`)
      } finally {
        setDetecting(false)
      }
    }, 30)
  }

  const candidates = useMemo(
    () => (detection?.candidates ?? []).map((c) => (edits[c.key] ? { ...c, ...edits[c.key], ...(edits[c.key].category ? { category: edits[c.key].category! } : {}) } : c)),
    [detection, edits],
  )
  const effDetection = useMemo(() => (detection ? { ...detection, candidates } : null), [detection, candidates])
  // Seçili adayın güncel (düzenlenmiş) hâli
  const selectedCandLive = useMemo(() => (selectedCand ? (candidates.find((c) => c.key === selectedCand.key) ?? selectedCand) : null), [selectedCand, candidates])
  const candidatesByPage = useMemo(() => {
    const m = new Map<number, number>()
    for (const c of candidates) {
      if (ignored.has(c.key)) continue
      for (const p of new Set(c.instances.map((i) => i.page).filter((x): x is number => x != null))) m.set(p, (m.get(p) ?? 0) + 1)
    }
    return m
  }, [candidates, ignored])

  const addCandidates = async (cands: PozCandidate[], opts: { approve: boolean; category?: QuantityCategory; uncertain?: boolean; note?: string | null }) => {
    const c = ctxRef.current
    const fresh = cands.filter((x) => !addedKeys.has(x.key))
    if (!fresh.length) return
    const maxOrder = store.items.reduce((m, i) => Math.max(m, i.sort_order), 0)
    const inputs = fresh.map((x, i) => ({
      ...candidateToInput(x, {
        approve: opts.approve,
        fileName: c?.doc?.fileName ?? null,
        analysisId: project.analysis?.id ?? null,
        category: cands.length === 1 ? opts.category : undefined,
        detected: detection?.candidates.find((d) => d.key === x.key) ?? null,
      }),
      sort_order: maxOrder + 10 * (i + 1),
      ...(opts.uncertain ? { uncertain: true, verification: 'bekliyor' as const } : {}),
      ...(opts.note ? { review_note: opts.note.slice(0, 1000) } : {}),
    }))
    const rows = await store.create(inputs)
    if (rows) {
      const approved = rows.filter((r) => r.verification === 'onaylandi').length
      c?.log(`${rows.length} poz metraja eklendi (${approved} onaylı, ${rows.length - approved} doğrulama bekliyor)`)
      if (opts.approve && approved < rows.length) notify('Bazı pozlar onaylanamadı: iş grubu seçilmeli ve ölçüler tamamlanmalı. Doğrulama bekleyen olarak eklendi.', 'info')
    }
  }

  /** Çizimde göster: PDF'te ilgili sayfaya geçilir (önce görüntülenen sayfadaki örnekler) */
  const goToBoxes = (instances: { bbox: Box; page?: number }[]) => {
    const c = ctxRef.current
    if (!c?.doc || !instances.length) return
    const cur = c.doc.pdfDoc?.current
    const page = cur != null && instances.some((i) => i.page === cur) ? cur : (instances[0].page ?? cur)
    const box = unionBox(instances.filter((i) => i.page == null || i.page === page).map((i) => i.bbox))
    if (c.doc.pdfDoc && page != null && page !== cur) {
      pendingZoom.current = { page, box }
      void c.selectPage(page)
    } else c.zoomTo(box)
  }

  const showCandidate = (cand: PozCandidate) => {
    setSelectedCand(cand)
    if (review) ctxRef.current?.focusPanels({ right: true })
    const plan = cand.instances.filter((i) => i.role === 'plan' || i.role == null)
    goToBoxes(plan.length ? plan : cand.instances)
  }

  const locateItem = (item: QuantityItem) => {
    const c = ctxRef.current
    const boxes = item.drawing_ref?.boxes
    if (!c?.doc || !boxes?.length) return
    if (item.drawing_ref?.file_name && item.drawing_ref.file_name !== c.doc.fileName) {
      notify(`Bu poz "${item.drawing_ref.file_name}" çiziminden; açık çizim farklı.`, 'info')
      return
    }
    const pages = item.drawing_ref?.box_pages
    goToBoxes(boxes.map((b, i) => ({ bbox: b, page: pages?.[i] })))
  }

  const measurementToItem = (m: Measurement) => {
    const c = ctxRef.current
    if (!c?.doc) return
    if (c.units.mmPerUnit == null) {
      notify('Ölçümü metraja eklemek için önce çizim birimini veya ölçeği belirleyin.', 'error')
      return
    }
    const input =
      m.kind === 'area'
        ? areaMeasurementToInput(m.points, c.units.mmPerUnit, c.units.verified, c.doc.fileName)
        : distanceMeasurementToInput(m.points[0], m.points[1], c.units.mmPerUnit, c.units.verified, c.doc.fileName)
    setMeasureForm({ ...input, sort_order: store.items.reduce((s, i) => Math.max(s, i.sort_order), 0) + 10 })
  }

  const highlights = useMemo(() => {
    const onPage = (i: { page?: number }) => viewPage == null || i.page == null || i.page === viewPage
    const out: { ids: number[]; color: string }[] = []
    // PDF: görüntülenen sayfadaki tüm adaylar işaretlenir, seçili aday ayrı renkte
    if (viewPage != null) {
      const ids = candidates.filter((c) => !ignored.has(c.key) && c.key !== selectedCand?.key).flatMap((c) => c.instances.filter(onPage).flatMap((i) => i.entityIds))
      if (ids.length) out.push({ ids, color: '#f5a524' })
    }
    if (selectedCand) out.push({ ids: selectedCand.instances.filter(onPage).flatMap((i) => i.entityIds), color: '#3ddc97' })
    return out
  }, [selectedCand, candidates, ignored, viewPage])

  const bindingChip = (
    <button
      type="button"
      onClick={() => setBindOpen(true)}
      className={cn(
        'inline-flex h-9 max-w-[240px] shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-semibold',
        project.projectId ? 'border-line bg-surface-2 text-ink hover:bg-surface-3' : 'border-dashed border-line-strong text-muted hover:bg-surface-2 hover:text-ink',
      )}
      title="Proje ve metraj sürümü"
      data-testid="bind-open"
    >
      <FolderKanban className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">
        {boundProject ? `${boundProject.code}${project.takeoff ? ` · Rev ${project.takeoff.revision}` : ''}` : 'Projeye kaydet'}
      </span>
    </button>
  )

  return (
    <>
      <header className="mb-4 flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-surface shadow-card">
          <ScanLine className="h-[18px] w-[18px] text-titanium" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="font-mono text-[10.5px] tracking-[0.12em] text-subtle uppercase">M02 · Mühendislik</div>
          <h1 className="truncate text-lg font-semibold text-ink">CAD Analiz ve Metraj</h1>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            const next = !review
            setReview(next)
            const c = ctxRef.current
            if (next) c?.focusPanels({ left: c.doc?.pdfDoc ? 'paftalar' : 'pozlar', bottom: c.doc?.kind === 'pdf' ? 'sonuclar' : 'metraj', right: true })
          }}
          aria-pressed={review}
          className={cn(
            'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold',
            review ? 'border-primary bg-primary text-primary-ink' : 'border-line bg-surface text-ink hover:bg-surface-2',
          )}
          data-testid="review-mode"
        >
          <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Mühendislik incelemesi</span>
          <span className="sm:hidden">İnceleme</span>
        </button>
      </header>
      <CadWorkspace
        initialFile={initialFile}
        onContext={onContext}
        headerExtra={bindingChip}
        extensions={(ctx) => {
          const resultsTab = {
              id: 'sonuclar',
              label: 'Tespit sonuçları',
              icon: FileSpreadsheet,
              badge: detection ? candidates.filter((c) => !ignored.has(c.key)).length : null,
              render: () => (
                <PdfResultsTable
                  candidates={candidates}
                  items={store.items}
                  ignored={ignored}
                  selectedKey={selectedCand?.key ?? null}
                  readOnly={store.readOnly}
                  onSelect={showCandidate}
                  onEdit={(key, patch) => setEdits((m) => ({ ...m, [key]: { ...m[key], ...patch } }))}
                  onAdd={(c, o) => void addCandidates(c, o)}
                  onIgnore={(k) => setIgnored((s) => new Set(s).add(k))}
                />
              ),
            }
          return {
          leftTabs: [
            ...(ctx.doc?.pdfDoc
              ? [
                  {
                    id: 'paftalar',
                    label: 'Paftalar',
                    icon: Layers3,
                    badge: ctx.doc.pdfDoc.pages.length,
                    render: () => (
                      <SheetsPanel
                        pdf={ctx.doc!.pdfDoc!.handle}
                        docId={ctx.doc!.docId}
                        pages={ctx.doc!.pdfDoc!.pages}
                        current={ctx.doc!.pdfDoc!.current}
                        candidatesByPage={candidatesByPage}
                        onOpen={(p) => void ctx.selectPage(p)}
                      />
                    ),
                  },
                ]
              : []),
            {
              id: 'pozlar',
              label: 'Pozlar',
              icon: ListChecks,
              badge: detection ? detection.candidates.filter((c) => !ignored.has(c.key)).length : null,
              render: () => (
                <PozPanel
                  available={!!ctx.doc}
                  unavailableReason="Dosya açıldığında pozlar burada tespit edilir."
                  detection={effDetection}
                  running={detecting}
                  onDetect={runDetection}
                  addedKeys={addedKeys}
                  ignored={ignored}
                  onIgnore={(k) => setIgnored((s) => new Set(s).add(k))}
                  onAdd={(c, o) => void addCandidates(c, o)}
                  onShow={showCandidate}
                  selectedKey={selectedCand?.key ?? null}
                  controls={
                    ctx.doc?.pdfDoc ? (
                      <PdfAnalysisControls
                        pages={ctx.doc.pdfDoc.pages}
                        currentPage={ctx.doc.pdfDoc.current}
                        selected={pdfPages}
                        onSelectedChange={setPdfPages}
                        ocr={ocr}
                        onOcrChange={setOcr}
                        detection={detection}
                        analyzedAt={analyzedAt}
                        running={detecting}
                        progress={progress}
                        onRun={runDetection}
                        onRunOcr={() => {
                          setOcr(true)
                          void runPdf([...pdfPages], true)
                        }}
                        onCancel={() => runAbort.current?.abort()}
                        onGoPage={(p) => void ctx.selectPage(p)}
                        onCalibrate={ctx.startCalibrate}
                        onConfirmScale={(page, den) => {
                          if (ctx.doc?.pdfDoc?.current !== page) {
                            void ctx.selectPage(page).then((d) => d && ctxRef.current?.applyScale(den, true))
                          } else ctx.applyScale(den, true)
                        }}
                      />
                    ) : undefined
                  }
                />
              ),
            },
            ...(project.projectId
              ? [
                  {
                    id: 'gecmis',
                    label: 'Geçmiş',
                    icon: History,
                    render: () => (
                      <ProjectHistoryPanel analyses={project.analyses} takeoffs={project.takeoffs} currentTakeoffId={project.takeoffId} onSelectTakeoff={project.setTakeoffId} />
                    ),
                  },
                ]
              : []),
          ],
          bottomTabs: [
            ...(ctx.doc?.kind === 'pdf' ? [resultsTab] : []),
            {
              id: 'metraj',
              label: project.takeoff ? `Metraj · Rev ${project.takeoff.revision}` : 'Metraj (kaydedilmedi)',
              icon: Table2,
              badge: store.items.length || null,
              render: () => (
                <div className="flex h-full min-h-0 flex-col">
                  {store.kind === 'local' && store.items.length > 0 && (
                    <div className="flex items-center justify-between gap-2 border-b border-warn-line bg-warn-soft px-3 py-1.5 text-[12px] text-warn">
                      Bu metraj henüz kaydedilmedi; sayfadan çıkarsanız kaybolur.
                      <button type="button" onClick={() => setBindOpen(true)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-warn-line bg-surface px-2 py-0.5 font-semibold text-ink">
                        <Save className="h-3.5 w-3.5" aria-hidden="true" />
                        Projeye kaydet
                      </button>
                    </div>
                  )}
                  {project.takeoff && project.projectId && store.items.length > 0 && (
                    <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-[12px] text-muted">
                      <span>
                        {store.items.filter((i) => i.verification === 'onaylandi').length}/{store.items.length} poz onaylı
                      </span>
                      <button
                        type="button"
                        onClick={() => setQuoteOpen(true)}
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 font-semibold text-primary-ink hover:bg-primary-hover"
                        data-testid="send-to-quote"
                      >
                        <Send className="h-3.5 w-3.5" aria-hidden="true" />
                        Teklife aktar
                      </button>
                    </div>
                  )}
                  <QuantityTable store={store} compact onLocate={locateItem} onSelectItem={(i) => setSelectedItemId(i?.id ?? null)} selectedId={selectedItemId} />
                </div>
              ),
            },
          ].concat(ctx.doc?.kind === 'pdf' ? [] : [resultsTab]),
          rightTop:
            selectedCand || (review && selectedItem) ? (
              <ReviewPanel
                candidate={selectedCandLive}
                item={selectedCand ? (store.items.find((i) => i.drawing_ref?.key === selectedCand.key) ?? null) : selectedItem}
                store={store}
                onEditCandidate={(key, patch) => setEdits((m) => ({ ...m, [key]: { ...m[key], ...patch } }))}
                onAddCandidate={(c, o) => addCandidates([c], o)}
                onIgnore={(k) => {
                  setIgnored((s) => new Set(s).add(k))
                  setSelectedCand(null)
                  ctx.log(`Öneri reddedildi: ${selectedCand?.code ?? ''}`)
                }}
                onShow={(page) => {
                  const inst = (selectedCand?.instances ?? []).filter((i) => page == null || i.page === page)
                  if (inst.length) goToBoxes(inst)
                  else if (selectedItem?.drawing_ref?.boxes?.length) locateItem(selectedItem)
                  else if (page != null) void ctx.selectPage(page)
                }}
                onClose={() => {
                  setSelectedCand(null)
                  setSelectedItemId(null)
                }}
              />
            ) : selectedItem ? (
              <ItemDetail item={selectedItem} store={store} onClose={() => setSelectedItemId(null)} />
            ) : undefined,
          highlights,
          measurementAction: store.readOnly ? undefined : { label: 'Metraja ekle', run: measurementToItem },
          }
        }}
      />
      <ProjectBindingDialog
        open={bindOpen}
        onClose={() => setBindOpen(false)}
        busy={project.busy}
        initialProjectId={project.projectId}
        fileIsLocal={ctxRef.current?.doc?.source.type === 'local'}
        hasDoc={!!ctxRef.current?.doc && !project.analysis}
        pendingCount={store.kind === 'local' ? local.items.length : 0}
        onSubmit={async (req) => {
          const c = ctxRef.current
          const ok = await project.bind(req, c?.doc ?? null, c?.units ?? { mmPerUnit: null, source: 'yok', verified: false, note: '' }, detection, store.kind === 'local' ? local.items : [])
          if (ok) {
            if (store.kind === 'local') local.replaceAll([])
            setBindOpen(false)
            c?.log('Çizim ve metraj projeye kaydedildi')
          }
        }}
      />
      {quoteOpen && project.takeoff && project.projectId && (
        <SendToQuoteDialog open onClose={() => setQuoteOpen(false)} projectId={project.projectId} takeoff={project.takeoff} items={store.items} />
      )}
      {measureForm && (
        <QuantityItemForm
          open
          title="Ölçümden poz"
          initial={measureForm}
          onClose={() => setMeasureForm(null)}
          onSubmit={async (input) => {
            const rows = await store.create([input])
            if (rows) {
              setMeasureForm(null)
              ctxRef.current?.log(`Ölçümden poz eklendi: ${input.poz_code}`)
            }
          }}
          extra={
            !ctxRef.current?.units.verified ? (
              <p className="text-[12px] text-warn">Ölçek doğrulanmadığı için poz "doğrulama bekliyor" olarak eklenir; kalibrasyondan sonra onaylayın.</p>
            ) : undefined
          }
        />
      )}
    </>
  )
}
