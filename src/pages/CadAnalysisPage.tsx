import { FolderKanban, History, ListChecks, Save, ScanLine, Table2 } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Measurement } from '@/cad/viewer/engine'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { downloadProjectFile, listProjectFiles } from '@/data/api'
import { CadWorkspace, type WorkspaceContext } from '@/features/cad/workspace/CadWorkspace'
import { PozPanel } from '@/features/cad/quantity/PozPanel'
import { ProjectBindingDialog } from '@/features/cad/quantity/ProjectBindingDialog'
import { ProjectHistoryPanel } from '@/features/cad/quantity/ProjectHistoryPanel'
import { useCadProject } from '@/features/cad/quantity/useCadProject'
import { ItemDetail } from '@/features/quantity/ItemDetail'
import { QuantityItemForm } from '@/features/quantity/QuantityItemForm'
import { QuantityTable } from '@/features/quantity/QuantityTable'
import { type ItemsStore, useLocalItems, useRemoteItems } from '@/features/quantity/useItemsStore'
import { cn } from '@/lib/cn'
import { useUnsavedChanges } from '@/lib/unsaved'
import { requireSupabase } from '@/lib/supabase'
import { type DetectionResult, detectPoz, type PozCandidate } from '@/quantity/detect'
import { areaMeasurementToInput, candidateToInput, distanceMeasurementToInput } from '@/quantity/fromDetection'
import type { QuantityCategory, QuantityItem, QuantityItemInput } from '@/quantity/types'

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
  const ctxRef = useRef<WorkspaceContext | null>(null)
  useUnsavedChanges(store.kind === 'local' && local.items.length > 0, 'Projeye kaydedilmemiş metraj')
  const docRef = useRef<unknown>(null)

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
      if (c.doc !== docRef.current) {
        const prev = docRef.current
        docRef.current = c.doc
        if (prev !== null || c.doc) {
          setDetection(null)
          setIgnored(new Set())
          setSelectedCand(null)
        }
        // Yerel dosya açıldıysa analiz bağı sıfırlanır (proje ve sürüm korunur)
        if (prev !== null && c.doc) project.resetDocument(c.doc.source.type === 'project' ? (c.doc.source.fileId ?? null) : null)
      }
    },
    [project],
  )

  const addedKeys = useMemo(() => new Set(store.items.map((i) => i.drawing_ref?.key).filter((k): k is string => !!k)), [store.items])
  const selectedItem = store.items.find((i) => i.id === selectedItemId) ?? null
  const boundProject = projects.find((p) => p.id === project.projectId) ?? null

  const runDetection = () => {
    const c = ctxRef.current
    if (!c?.doc) return
    setDetecting(true)
    // Arayüzün güncellenmesi için bir sonraki karede çalıştırılır
    window.setTimeout(() => {
      try {
        const result = detectPoz(c.doc!.scene, { mmPerUnit: c.units.mmPerUnit, unitsVerified: c.units.verified })
        setDetection(result)
        c.log(`Poz tespiti: ${result.candidates.length} aday`)
      } finally {
        setDetecting(false)
      }
    }, 30)
  }

  const addCandidates = async (cands: PozCandidate[], opts: { approve: boolean; category?: QuantityCategory }) => {
    const c = ctxRef.current
    const fresh = cands.filter((x) => !addedKeys.has(x.key))
    if (!fresh.length) return
    const maxOrder = store.items.reduce((m, i) => Math.max(m, i.sort_order), 0)
    const inputs = fresh.map((x, i) => ({
      ...candidateToInput(x, { approve: opts.approve, fileName: c?.doc?.fileName ?? null, analysisId: project.analysis?.id ?? null, category: cands.length === 1 ? opts.category : undefined }),
      sort_order: maxOrder + 10 * (i + 1),
    }))
    const rows = await store.create(inputs)
    if (rows) {
      const approved = rows.filter((r) => r.verification === 'onaylandi').length
      c?.log(`${rows.length} poz metraja eklendi (${approved} onaylı, ${rows.length - approved} doğrulama bekliyor)`)
      if (opts.approve && approved < rows.length) notify('Bazı pozlar onaylanamadı: iş grubu seçilmeli ve ölçüler tamamlanmalı. Doğrulama bekleyen olarak eklendi.', 'info')
    }
  }

  const showCandidate = (cand: PozCandidate) => {
    setSelectedCand(cand)
    const boxes = cand.instances.map((i) => i.bbox)
    const bb: [number, number, number, number] = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]
    ctxRef.current?.zoomTo(bb)
  }

  const locateItem = (item: QuantityItem) => {
    const c = ctxRef.current
    const boxes = item.drawing_ref?.boxes
    if (!c?.doc || !boxes?.length) return
    if (item.drawing_ref?.file_name && item.drawing_ref.file_name !== c.doc.fileName) {
      notify(`Bu poz "${item.drawing_ref.file_name}" çiziminden; açık çizim farklı.`, 'info')
      return
    }
    const bb: [number, number, number, number] = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]
    c.zoomTo(bb)
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

  const highlights = useMemo(() => (selectedCand ? [{ ids: selectedCand.instances.flatMap((i) => i.entityIds), color: '#3ddc97' }] : []), [selectedCand])

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
      </header>
      <CadWorkspace
        initialFile={initialFile}
        onContext={onContext}
        headerExtra={bindingChip}
        extensions={(ctx) => ({
          leftTabs: [
            {
              id: 'pozlar',
              label: 'Pozlar',
              icon: ListChecks,
              badge: detection ? detection.candidates.filter((c) => !ignored.has(c.key)).length : null,
              render: () => (
                <PozPanel
                  available={!!ctx.doc && ctx.doc.kind === 'dxf'}
                  unavailableReason={
                    !ctx.doc ? 'Dosya açıldığında pozlar burada tespit edilir.' : 'Otomatik poz tespiti DXF çizimlerinde çalışır. PDF\'de alan veya mesafe ölçüp "Metraja ekle" ile poz oluşturun.'
                  }
                  detection={detection}
                  running={detecting}
                  onDetect={runDetection}
                  addedKeys={addedKeys}
                  ignored={ignored}
                  onIgnore={(k) => setIgnored((s) => new Set(s).add(k))}
                  onAdd={(c, o) => void addCandidates(c, o)}
                  onShow={showCandidate}
                  selectedKey={selectedCand?.key ?? null}
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
                  <QuantityTable store={store} compact onLocate={locateItem} onSelectItem={(i) => setSelectedItemId(i?.id ?? null)} selectedId={selectedItemId} />
                </div>
              ),
            },
          ],
          rightTop: selectedItem ? <ItemDetail item={selectedItem} store={store} onClose={() => setSelectedItemId(null)} /> : undefined,
          highlights,
          measurementAction: store.readOnly ? undefined : { label: 'Metraja ekle', run: measurementToItem },
        })}
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
