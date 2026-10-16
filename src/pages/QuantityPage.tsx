import { Archive, ArrowLeftRight, CheckCircle2, GitBranch, ListTree, Plus, Ruler, ScanLine, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { createRevision, createTakeoff, deleteTakeoff, listAnalyses, listTakeoffs, updateTakeoff } from '@/data/quantityApi'
import type { CadAnalysis, QuantityTakeoff } from '@/data/types'
import { ItemDetail } from '@/features/quantity/ItemDetail'
import { QuantityTable } from '@/features/quantity/QuantityTable'
import { RevisionCompare } from '@/features/quantity/RevisionCompare'
import { TakeoffSummary } from '@/features/quantity/TakeoffSummary'
import { useRemoteItems } from '@/features/quantity/useItemsStore'
import { ExportButtons } from '@/features/quantity/ExportButtons'
import { dataErrorMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { useLiveList } from '@/lib/useLiveList'
import { computeItem, summarize } from '@/quantity/engine'

const STATUS = { taslak: 'Taslak', onaylandi: 'Onaylı', arsiv: 'Arşiv' } as const
const dtf = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function QuantityPage() {
  const { projects, companies } = useData()
  const { notify } = useToast()
  const [params, setParams] = useSearchParams()
  const projectId = params.get('proje') ?? ''
  const takeoffId = params.get('surum') ?? ''
  const takeoffs = useLiveList<QuantityTakeoff>('quantity_takeoffs', 'project_id', projectId || undefined, (id) => listTakeoffs(requireSupabase(), id))
  const takeoff = takeoffs.items.find((t) => t.id === takeoffId) ?? null
  // Raporda kaynak çizim / pafta listesi için metraj sürümünün bağlı olduğu analiz
  const analyses = useLiveList<CadAnalysis>('cad_analyses', 'project_id', projectId || undefined, (id) => listAnalyses(requireSupabase(), id))
  const analysis = analyses.items.find((a) => a.id === takeoff?.analysis_id) ?? null
  const store = useRemoteItems(takeoff)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<null | 'new' | 'revision' | 'approve' | 'archive' | 'delete'>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [compare, setCompare] = useState(false)

  const project = projects.find((p) => p.id === projectId) ?? null
  const company = companies.find((c) => c.id === project?.company_id) ?? null
  const sortedProjects = useMemo(() => [...projects].sort((a, b) => a.code.localeCompare(b.code, 'tr', { numeric: true })), [projects])
  const results = useMemo(() => store.items.map(computeItem), [store.items])
  const totals = useMemo(() => summarize(store.items, results), [store.items, results])
  const selectedItem = store.items.find((i) => i.id === selectedId) ?? null

  const set = (next: { proje?: string; surum?: string }) => {
    const p = new URLSearchParams(params)
    if (next.proje !== undefined) {
      if (next.proje) p.set('proje', next.proje)
      else p.delete('proje')
      p.delete('surum')
    }
    if (next.surum !== undefined) {
      if (next.surum) p.set('surum', next.surum)
      else p.delete('surum')
    }
    setParams(p, { replace: true })
  }

  // Sürüm seçili değilse en son sürümü aç
  useEffect(() => {
    if (projectId && !takeoffId && takeoffs.items.length) set({ surum: takeoffs.items[0].id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, takeoffId, takeoffs.items])

  const run = async (fn: () => Promise<void>, ctx: string) => {
    setBusy(true)
    try {
      await fn()
      setDialog(null)
    } catch (e) {
      notify(dataErrorMessage(e, ctx), 'error')
      await takeoffs.reload()
    } finally {
      setBusy(false)
    }
  }

  const pendingCount = totals.pending.items
  const invalidCount = totals.invalid

  return (
    <>
      <PageHeader
        icon={Ruler}
        code="M03"
        eyebrow="Mühendislik"
        title="Metraj"
        description="Poz bazlı metraj sürümleri: doğrulama, revizyon, onay ve dışa aktarma."
        status="ready"
        actions={
          <>
            <Link to={projectId ? `/cad-analiz?proje=${projectId}` : '/cad-analiz'} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-card hover:bg-surface-2">
              <ScanLine className="h-4 w-4" aria-hidden="true" />
              CAD analizinde aç
            </Link>
            {projectId && (
              <Link
                to={`/receteler?proje=${projectId}${takeoff ? `&metraj=${takeoff.id}` : ''}`}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-card hover:bg-surface-2"
                data-testid="qp-bom"
              >
                <ListTree className="h-4 w-4" aria-hidden="true" />
                Malzeme reçetesi
              </Link>
            )}
          </>
        }
      />

      <section className="card mb-5 grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="block min-w-0">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Proje</span>
          <select value={projectId} onChange={(e) => set({ proje: e.target.value })} className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink sm:text-sm" data-testid="qp-project">
            <option value="">Proje seçin…</option>
            {sortedProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Metraj sürümü</span>
          <select value={takeoffId} onChange={(e) => set({ surum: e.target.value })} disabled={!projectId || takeoffs.items.length === 0} className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink disabled:opacity-60 sm:text-sm" data-testid="qp-takeoff">
            {takeoffs.items.length === 0 && <option value="">Sürüm yok</option>}
            {takeoffs.items.map((t) => (
              <option key={t.id} value={t.id}>
                Rev {t.revision} · {t.name} · {STATUS[t.status]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon={Plus}
            disabled={!projectId}
            onClick={() => {
              setName('Metraj')
              setDialog('new')
            }}
            data-testid="qp-new"
          >
            Yeni sürüm
          </Button>
        </div>
      </section>

      {!projectId ? (
        <EmptyState icon={Ruler} title="Proje seçin" description="Metraj sürümleri projelere bağlıdır. Bir proje seçin veya CAD Analiz ekranında çizimden metraj oluşturun." />
      ) : !takeoff ? (
        <EmptyState
          icon={Ruler}
          title={takeoffs.loading ? 'Yükleniyor…' : 'Bu projede metraj sürümü yok'}
          description="Yeni bir sürüm oluşturup pozları elle girebilir veya CAD Analiz ekranında çizimden tespit edilen pozları ekleyebilirsiniz."
        />
      ) : (
        <>
          <section className="card mb-5 p-4" data-testid="qp-takeoff-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-ink">
                    Rev {takeoff.revision} · {takeoff.name}
                  </h2>
                  <span
                    className={
                      takeoff.status === 'onaylandi'
                        ? 'rounded-md border border-ok/30 bg-ok-soft px-1.5 py-px text-[11px] font-semibold text-ok'
                        : takeoff.status === 'arsiv'
                          ? 'rounded-md border border-line bg-surface-2 px-1.5 py-px text-[11px] font-semibold text-muted'
                          : 'rounded-md border border-warn-line bg-warn-soft px-1.5 py-px text-[11px] font-semibold text-warn'
                    }
                    data-testid="qp-status"
                  >
                    {STATUS[takeoff.status]}
                  </span>
                </div>
                <p className="mt-1 text-[12.5px] text-muted">
                  {project?.code} · {project?.name}
                  {company && ` · ${company.name}`} · oluşturma {dtf.format(new Date(takeoff.created_at))}
                  {takeoff.approved_at && ` · onay ${dtf.format(new Date(takeoff.approved_at))}`}
                  {takeoff.based_on && ` · Rev ${takeoffs.items.find((t) => t.id === takeoff.based_on)?.revision ?? '?'} tabanlı`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ExportButtons takeoff={takeoff} items={store.items} project={project} company={company} analysis={analysis} />
                {takeoffs.items.length > 1 && (
                  <Button variant="secondary" icon={ArrowLeftRight} onClick={() => setCompare((v) => !v)} aria-pressed={compare} data-testid="qp-compare">
                    Karşılaştır
                  </Button>
                )}
                <Button
                  variant="secondary"
                  icon={GitBranch}
                  onClick={() => {
                    setName(`${takeoff.name}`)
                    setDialog('revision')
                  }}
                  data-testid="qp-revision"
                >
                  Yeni revizyon
                </Button>
                {takeoff.status === 'taslak' && (
                  <Button variant="primary" icon={CheckCircle2} onClick={() => setDialog('approve')} disabled={store.items.length === 0} data-testid="qp-approve">
                    Onayla
                  </Button>
                )}
                {takeoff.status === 'onaylandi' && (
                  <Button variant="secondary" icon={Archive} onClick={() => setDialog('archive')}>
                    Arşivle
                  </Button>
                )}
                {takeoff.status === 'taslak' && (
                  <Button variant="ghost" icon={Trash2} onClick={() => setDialog('delete')} aria-label="Taslak sürümü sil">
                    Sil
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-4">
              <TakeoffSummary totals={totals} items={store.items} results={results} />
            </div>
          </section>

          {compare && takeoffs.items.length > 1 && <RevisionCompare key={takeoff.id} takeoff={takeoff} takeoffs={takeoffs.items} newItems={store.items} onClose={() => setCompare(false)} />}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <section className="card min-w-0 overflow-hidden">
              <QuantityTable store={store} onSelectItem={(i) => setSelectedId(i?.id ?? null)} selectedId={selectedId} />
            </section>
            {selectedItem && (
              <aside className="card h-fit overflow-hidden">
                <ItemDetail item={selectedItem} store={store} onClose={() => setSelectedId(null)} />
              </aside>
            )}
          </div>
        </>
      )}

      <Modal
        open={dialog === 'new' || dialog === 'revision'}
        onClose={() => setDialog(null)}
        busy={busy}
        title={dialog === 'revision' ? 'Yeni revizyon' : 'Yeni metraj sürümü'}
        description={dialog === 'revision' ? `Rev ${takeoff?.revision} pozları yeni taslak sürüme kopyalanır; mevcut sürüm değişmez.` : 'Boş bir taslak sürüm oluşturulur.'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>
              Vazgeç
            </Button>
            <Button
              variant="primary"
              disabled={busy || !name.trim()}
              data-testid="qp-create"
              onClick={() =>
                run(async () => {
                  const db = requireSupabase()
                  if (dialog === 'revision' && takeoff) {
                    const id = await createRevision(db, takeoff.id, name.trim())
                    await takeoffs.reload()
                    set({ surum: id })
                    notify('Yeni revizyon oluşturuldu.')
                  } else {
                    const t = await createTakeoff(db, projectId, name.trim())
                    await takeoffs.reload()
                    set({ surum: t.id })
                    notify('Metraj sürümü oluşturuldu.')
                  }
                }, 'Sürüm oluşturma')
              }
            >
              Oluştur
            </Button>
          </div>
        }
      >
        <TextField label="Sürüm adı" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
      </Modal>

      <ConfirmDialog
        open={dialog === 'approve'}
        title={`Rev ${takeoff?.revision} onaylansın mı?`}
        message={`Onaylanan sürüm kilitlenir; değişiklik için yeni revizyon gerekir.${pendingCount ? ` ${pendingCount} kalem doğrulama bekliyor ve onaylı toplama DAHİL DEĞİLDİR.` : ''}${invalidCount ? ` ${invalidCount} hatalı kalem toplama dahil değildir.` : ''}`}
        confirmLabel="Onayla ve kilitle"
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          takeoff &&
          run(async () => {
            await updateTakeoff(requireSupabase(), takeoff, { status: 'onaylandi' })
            await takeoffs.reload()
            notify('Metraj sürümü onaylandı.')
          }, 'Onay')
        }
      />
      <ConfirmDialog
        open={dialog === 'archive'}
        title="Sürüm arşivlensin mi?"
        message="Arşivlenen sürüm yalnızca görüntülenebilir ve yeniden açılamaz."
        confirmLabel="Arşivle"
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          takeoff &&
          run(async () => {
            await updateTakeoff(requireSupabase(), takeoff, { status: 'arsiv' })
            await takeoffs.reload()
          }, 'Arşivleme')
        }
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        title="Taslak sürüm silinsin mi?"
        message="Sürümdeki tüm pozlar silinir. Bu işlem geri alınamaz."
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          takeoff &&
          run(async () => {
            await deleteTakeoff(requireSupabase(), takeoff.id)
            set({ surum: '' })
            await takeoffs.reload()
          }, 'Silme')
        }
      />
    </>
  )
}
