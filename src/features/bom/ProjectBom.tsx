import { ArrowLeftRight, Ban, Calculator, CheckCircle2, FileDown, FileSpreadsheet, History, Layers, Loader2, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { type BomCalcLine, calculateBom, type EngineAssignment, fromStoredLine, summarizeStored, toPayload } from '@/bom/engine'
import { diffLines } from '@/bom/diff'
import { BOM_STATUS_LABEL, type BomAssignment, type BomLine, type BomVersion, CATEGORY_SYSTEM_TYPE, SYSTEM_TYPE_LABEL } from '@/bom/types'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { TextField } from '@/components/ui/Field'
import { Panel } from '@/components/ui/Panel'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { approveBomVersion, createBomVersion, deleteBomVersion, listBomVersions, loadBomVersion, updateBomVersion } from '@/data/bomApi'
import { listItems, listTakeoffs } from '@/data/quantityApi'
import type { QuantityTakeoff } from '@/data/types'
import { bomFileName, buildBomReport, categoryLabel, fmtQty, qtyUnit } from '@/export/bomReport'
import { cn } from '@/lib/cn'
import { downloadBytes, loadPdfAssets } from '@/lib/download'
import { localISODate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useLiveList } from '@/lib/useLiveList'
import { useUnsavedChanges } from '@/lib/unsaved'
import { CATEGORY_INFO, type QuantityCategory, type QuantityItem } from '@/quantity/types'
import { BomResultView } from './BomResultView'
import { bomErrorMessage, Notice, Pill, useBomLibrary } from './shared'

const TK_STATUS = { taslak: 'Taslak', onaylandi: 'Onaylı', arsiv: 'Arşiv' } as const
const dtf = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const EXCLUDED = '__haric__'

type Lib = ReturnType<typeof useBomLibrary>
interface Choice {
  system: string
  kanat: string
  opening: string
}

/** Pozun açılım metni ve kanat sayısı (teknik öznitelik; yoksa boş) */
function itemOpening(it: QuantityItem): string {
  return it.detection?.attrs?.acilim?.value ?? ''
}
function itemKanat(it: QuantityItem): number | null {
  const v = Number(it.detection?.attrs?.kanat?.value)
  return Number.isInteger(v) && v > 0 && v <= 50 ? v : null
}

export function ProjectBom() {
  const { projects } = useData()
  const [params, setParams] = useSearchParams()
  const projectId = params.get('proje') ?? ''
  const versionId = params.get('surum') ?? ''
  const lib = useBomLibrary()
  const db = requireSupabase
  const takeoffs = useLiveList<QuantityTakeoff>('quantity_takeoffs', 'project_id', projectId || undefined, (id) => listTakeoffs(db(), id))
  const versions = useLiveList<BomVersion>('bom_versions', 'project_id', projectId || undefined, (id) => listBomVersions(db(), id))
  const sortedProjects = useMemo(() => [...projects].sort((a, b) => a.code.localeCompare(b.code, 'tr', { numeric: true })), [projects])
  const version = versions.items.find((v) => v.id === versionId) ?? null

  const set = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    setParams(p, { replace: true })
  }

  return (
    <div className="space-y-5">
      <section className="card grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="block min-w-0">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Proje</span>
          <select value={projectId} onChange={(e) => set({ proje: e.target.value, metraj: null, surum: null, kaynak: null })} className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink sm:text-sm" data-testid="bom-project">
            <option value="">Proje seçin…</option>
            {sortedProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </label>
        {projectId && (
          <Link to={`/metraj?proje=${projectId}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-card hover:bg-surface-2">
            Metrajı aç
          </Link>
        )}
      </section>

      {!projectId ? (
        <section className="card">
          <EmptyState icon={Layers} title="Proje seçin" description="Malzeme reçetesi, projenin onaylı metrajındaki pozlara ürün sistemi atanarak hesaplanır. Önce sistem kütüphanesinde kullandığınız sistemleri tanımlayın." />
        </section>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            {versionId ? (
              version ? (
                <VersionView
                  key={version.id}
                  version={version}
                  versions={versions.items}
                  takeoffs={takeoffs.items}
                  onRecalc={() => set({ surum: null, metraj: takeoffs.items[0]?.id ?? null, kaynak: version.id })}
                  onDeleted={() => {
                    set({ surum: null })
                    void versions.reload()
                  }}
                  reload={versions.reload}
                />
              ) : versions.loading ? (
                <LoadingState />
              ) : (
                <section className="card p-5">
                  <Notice tone="warn">Reçete sürümü bulunamadı (başka bir cihazda silinmiş olabilir).</Notice>
                </section>
              )
            ) : (
              <BomCalculator
                key={`${projectId}:${params.get('kaynak') ?? ''}`}
                projectId={projectId}
                lib={lib}
                takeoffs={takeoffs.items}
                takeoffsLoading={takeoffs.loading}
                versions={versions.items}
                sourceVersionId={params.get('kaynak') ?? versions.items[0]?.id ?? null}
                takeoffId={params.get('metraj') ?? ''}
                onTakeoff={(id) => set({ metraj: id })}
                onSaved={(id) => {
                  void versions.reload()
                  set({ surum: id, kaynak: null })
                }}
              />
            )}
          </div>
          <VersionList versions={versions.items} loading={versions.loading} selected={versionId} onSelect={(id) => set({ surum: id })} onNew={() => set({ surum: null, kaynak: null })} />
        </div>
      )}
    </div>
  )
}

// ================================================================== Sürüm listesi
function VersionList({ versions, loading, selected, onSelect, onNew }: { versions: BomVersion[]; loading: boolean; selected: string; onSelect: (id: string) => void; onNew: () => void }) {
  return (
    <Panel title="Reçete sürümleri" subtitle={`${versions.length} sürüm`} icon={History} bodyClassName="p-3" className="h-fit" actions={<Button variant="secondary" icon={Calculator} onClick={onNew} aria-pressed={!selected} data-testid="bom-new-calc">Yeni hesap</Button>}>
      {loading ? (
        <LoadingState />
      ) : versions.length === 0 ? (
        <p className="px-2 py-3 text-[12.5px] text-muted">Henüz kayıtlı sürüm yok. Hesaplayıp “Sürüm olarak kaydet” deyin.</p>
      ) : (
        <ul className="space-y-1" data-testid="bom-versions">
          {versions.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => onSelect(v.id)}
                aria-current={selected === v.id}
                className={cn('w-full rounded-xl border px-3 py-2 text-left transition-colors', selected === v.id ? 'border-line-strong bg-surface-2 shadow-card' : 'border-transparent hover:bg-surface-2/70', v.status === 'iptal' && 'opacity-60')}
                data-testid="bom-version-item"
                data-revision={v.revision}
                data-status={v.status}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-ink">Rev {v.revision}</span>
                  <StatusPill version={v} />
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted">
                  Metraj Rev {v.takeoff_revision} · {dtf.format(new Date(v.created_at))}
                </div>
                {!v.source_approved && <div className="mt-0.5 text-[11px] font-medium text-warn">onaysız metrajdan — taslak</div>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function StatusPill({ version }: { version: BomVersion }) {
  return (
    <Pill tone={version.status === 'onayli' ? 'ok' : version.status === 'iptal' ? 'muted' : 'warn'} testId="bom-status">
      {BOM_STATUS_LABEL[version.status]}
    </Pill>
  )
}

// ================================================================== Hesap (taslak)
function BomCalculator({
  projectId,
  lib,
  takeoffs,
  takeoffsLoading,
  versions,
  sourceVersionId,
  takeoffId,
  onTakeoff,
  onSaved,
}: {
  projectId: string
  lib: Lib
  takeoffs: QuantityTakeoff[]
  takeoffsLoading: boolean
  versions: BomVersion[]
  sourceVersionId: string | null
  takeoffId: string
  onTakeoff: (id: string) => void
  onSaved: (id: string) => void
}) {
  const { notify } = useToast()
  // Varsayılan: en son onaylı metraj; yoksa en son sürüm
  const takeoff = takeoffs.find((t) => t.id === takeoffId) ?? takeoffs.find((t) => t.status === 'onaylandi') ?? takeoffs[0] ?? null
  const items = useLiveList<QuantityItem>('quantity_items', 'takeoff_id', takeoff?.id, (id) => listItems(requireSupabase(), id))
  const [includePending, setIncludePending] = useState(false)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [dirty, setDirty] = useState(false)
  const [bulk, setBulk] = useState({ category: '', system: '' })
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  useUnsavedChanges(dirty, 'Reçete hesabı')

  // Önceki sürümün atamaları poz koduna göre aktarılır (metraj revizyonunda "yeniden hesapla")
  const [carried, setCarried] = useState<{ from: number; map: Map<string, BomAssignment> } | null>(null)
  const sourceVersion = versions.find((v) => v.id === sourceVersionId) ?? null
  useEffect(() => {
    if (!sourceVersion) return
    let alive = true
    loadBomVersion(requireSupabase(), sourceVersion.id)
      .then(({ assignments }) => alive && setCarried({ from: sourceVersion.revision, map: new Map(assignments.map((a) => [a.poz_code, a])) }))
      .catch(() => alive && setCarried(null))
    return () => {
      alive = false
    }
  }, [sourceVersion?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const rejected = items.items.filter((i) => i.verification === 'reddedildi')
  const eligible = items.items.filter((i) => i.verification !== 'reddedildi' && (includePending || (i.verification === 'onaylandi' && !i.uncertain)))
  const skippedPending = items.items.filter((i) => i.verification !== 'reddedildi' && !eligible.includes(i))

  const choiceFor = (it: QuantityItem): Choice => {
    const c = choices[it.id]
    if (c) return c
    const prev = carried?.map.get(it.poz_code)
    const sysOk = prev?.system_id && lib.systems.some((s) => s.id === prev.system_id)
    return { system: sysOk ? prev!.system_id! : '', kanat: prev?.kanat != null ? String(prev.kanat) : String(itemKanat(it) ?? ''), opening: prev?.opening ?? itemOpening(it) }
  }
  const update = (it: QuantityItem, patch: Partial<Choice>) => {
    setDirty(true)
    setChoices((m) => ({ ...m, [it.id]: { ...choiceFor(it), ...patch } }))
  }

  const engineAssignments: EngineAssignment[] = useMemo(
    () =>
      eligible
        .map((it) => ({ it, c: choiceFor(it) }))
        .filter(({ c }) => c.system !== EXCLUDED)
        .map(({ it, c }) => {
          const k = Number(c.kanat)
          return {
            item: { id: it.id, poz_code: it.poz_code, category: it.category, width_mm: it.width_mm == null ? null : Number(it.width_mm), height_mm: it.height_mm == null ? null : Number(it.height_mm), quantity: it.quantity, verification: it.verification, uncertain: !!it.uncertain, opening: itemOpening(it) || null, kanat: itemKanat(it) },
            system_id: c.system || null,
            kanat: Number.isInteger(k) && k > 0 ? k : null,
            opening: c.opening.trim() || null,
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eligible.map((i) => i.id + i.version).join(), choices, carried, lib.systems],
  )
  const calc = useMemo(
    () => calculateBom({ assignments: engineAssignments, systems: lib.engineSystems, rates: lib.rates, today: localISODate(), takeoffApproved: takeoff?.status === 'onaylandi' }),
    [engineAssignments, lib.engineSystems, lib.rates, takeoff?.status],
  )
  const excludedCount = eligible.length - engineAssignments.length
  const categories = [...new Set(eligible.map((i) => i.category))]
  const activeSystems = lib.systems.filter((s) => s.active)
  const systemOptions = (cat: string) => {
    const t = CATEGORY_SYSTEM_TYPE[cat as QuantityCategory]
    return [...lib.systems].sort((a, b) => Number(b.active) - Number(a.active) || Number(b.system_type === t) - Number(a.system_type === t) || a.name.localeCompare(b.name, 'tr'))
  }

  const save = async () => {
    if (!takeoff) return
    setBusy(true)
    try {
      const id = await createBomVersion(requireSupabase(), projectId, takeoff.id, toPayload(calc, engineAssignments, { notes: notes.trim() || null, basedOn: sourceVersion?.id ?? null }))
      setDirty(false)
      notify(calc.sourceApproved ? 'Reçete sürümü kaydedildi (taslak, onaya hazır).' : 'Reçete sürümü onaysız metrajdan TASLAK olarak kaydedildi.')
      onSaved(id)
    } catch (e) {
      notify(bomErrorMessage(e, 'Reçete kaydı'), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (lib.error) return <ErrorState message={lib.error} onRetry={() => void lib.reload()} />
  if (takeoffsLoading) return <LoadingState />
  if (!takeoff)
    return (
      <section className="card">
        <EmptyState icon={Layers} title="Bu projede metraj yok" description="Reçete metraj pozlarından hesaplanır. Önce Metraj veya CAD Analiz ekranında metraj oluşturup onaylayın." />
      </section>
    )

  return (
    <div className="space-y-4" data-testid="bom-calculator">
      <section className="card space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block min-w-0">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Metraj sürümü</span>
            <select value={takeoff.id} onChange={(e) => onTakeoff(e.target.value)} className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink sm:text-sm" data-testid="bom-takeoff">
              {takeoffs.map((t) => (
                <option key={t.id} value={t.id}>
                  Rev {t.revision} · {t.name} · {TK_STATUS[t.status]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex h-11 items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={includePending} onChange={(e) => setIncludePending(e.target.checked)} className="h-4 w-4" data-testid="bom-include-pending" />
            Doğrulama bekleyen pozları da dahil et (taslak)
          </label>
        </div>
        {takeoff.status !== 'onaylandi' && (
          <Notice tone="warn" testId="bom-source-unapproved">
            Metraj Rev {takeoff.revision} onaylı değil. Bu hesap <strong>onaysız metrajdan — taslak</strong> olarak kaydedilir ve onaylanamaz. Kesin reçete için metrajı onaylayın.
          </Notice>
        )}
        {includePending && eligible.some((i) => i.verification !== 'onaylandi' || i.uncertain) && (
          <Notice tone="warn" testId="bom-source-pending">
            Doğrulama bekleyen pozlar dahil: reçete <strong>onaysız metrajdan — taslak</strong> olur ve onaylanamaz.
          </Notice>
        )}
        {!includePending && skippedPending.length > 0 && (
          <Notice tone="info" testId="bom-skipped">
            {skippedPending.length} poz doğrulama beklediği için hesaba alınmadı ({skippedPending.map((i) => i.poz_code).join(', ')}).
          </Notice>
        )}
        {rejected.length > 0 && <p className="text-[12px] text-muted">Reddedilen {rejected.length} poz reçeteye hiç alınmaz.</p>}
        {carried && <p className="text-[12px] text-muted" data-testid="bom-carried">Sistem atamaları Rev {carried.from} reçetesinden poz koduna göre aktarıldı; değiştirebilirsiniz.</p>}
      </section>

      <Panel
        title="Poz → ürün sistemi ataması"
        subtitle={`${eligible.length} poz · ${engineAssignments.filter((a) => a.system_id).length} atanmış${excludedCount ? ` · ${excludedCount} hariç` : ''}`}
        icon={Layers}
        bodyClassName="p-0"
      >
        {lib.systems.length === 0 ? (
          <div className="p-4">
            <Notice tone="warn" testId="bom-no-systems">
              Sistem kütüphanesi boş. Önce <Link to="/receteler?bolum=sistemler" className="font-semibold underline">Sistem kütüphanesi</Link> bölümünde kullandığınız sistemi bileşen ve kurallarıyla tanımlayın.
            </Notice>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2 border-b border-line bg-surface-2/40 px-4 py-3" data-testid="bom-bulk">
              <label className="min-w-0 flex-1 basis-40">
                <span className="mb-1 block text-[12px] font-medium text-ink-2">İş grubu</span>
                <select value={bulk.category} onChange={(e) => setBulk((b) => ({ ...b, category: e.target.value }))} className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink sm:text-sm" data-testid="bom-bulk-category">
                  <option value="">Tüm pozlar</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_INFO[c as QuantityCategory]?.label ?? c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 flex-1 basis-48">
                <span className="mb-1 block text-[12px] font-medium text-ink-2">Sistem</span>
                <select value={bulk.system} onChange={(e) => setBulk((b) => ({ ...b, system: e.target.value }))} className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink sm:text-sm" data-testid="bom-bulk-system">
                  <option value="">Sistem seçin…</option>
                  {(bulk.category ? systemOptions(bulk.category) : activeSystems).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {SYSTEM_TYPE_LABEL[s.system_type]}
                      {s.active ? '' : ' (pasif)'}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant="secondary"
                disabled={!bulk.system}
                onClick={() => {
                  const targets = eligible.filter((i) => !bulk.category || i.category === bulk.category)
                  setDirty(true)
                  setChoices((m) => {
                    const next = { ...m }
                    for (const it of targets) next[it.id] = { ...choiceFor(it), system: bulk.system }
                    return next
                  })
                  notify(`${targets.length} poza sistem atandı.`)
                }}
                data-testid="bom-bulk-apply"
              >
                Toplu ata
              </Button>
            </div>
            {items.loading ? (
              <LoadingState />
            ) : eligible.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">Hesaba alınacak poz yok. Metrajda pozları onaylayın veya “doğrulama bekleyenleri dahil et” seçeneğini açın.</p>
            ) : (
              <ul className="divide-y divide-line" data-testid="bom-assignments">
                {eligible.map((it) => {
                  const c = choiceFor(it)
                  return (
                    <li key={it.id} className="flex flex-wrap items-end gap-x-3 gap-y-2 px-4 py-3" data-testid="bom-assign-row" data-poz={it.poz_code}>
                      <div className="min-w-0 flex-1 basis-52">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[13px] font-semibold text-ink">{it.poz_code}</span>
                          {it.verification === 'onaylandi' && !it.uncertain ? <Pill tone="ok">Onaylı</Pill> : <Pill tone="warn">{it.uncertain ? 'Belirsiz' : 'Doğrulama bekliyor'}</Pill>}
                        </div>
                        <div className="mt-0.5 text-[12px] text-muted">
                          {categoryLabel(it.category)} · {it.width_mm ?? '—'} × {it.height_mm ?? '—'} mm · {it.quantity} adet
                        </div>
                      </div>
                      <label className="w-20 shrink-0">
                        <span className="mb-1 block text-[11px] font-medium text-muted">Kanat (K)</span>
                        <input value={c.kanat} onChange={(e) => update(it, { kanat: e.target.value.replace(/\D/g, '').slice(0, 2) })} inputMode="numeric" placeholder="1" className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink sm:text-sm" data-testid="bom-assign-k" />
                      </label>
                      <label className="min-w-0 flex-1 basis-32">
                        <span className="mb-1 block text-[11px] font-medium text-muted">Açılım (kural filtresi)</span>
                        <input value={c.opening} onChange={(e) => update(it, { opening: e.target.value })} maxLength={200} className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink sm:text-sm" data-testid="bom-assign-opening" />
                      </label>
                      <label className="min-w-0 flex-1 basis-52">
                        <span className="mb-1 block text-[11px] font-medium text-muted">Ürün sistemi</span>
                        <select value={c.system} onChange={(e) => update(it, { system: e.target.value })} className={cn('h-10 w-full rounded-xl border bg-surface px-3 text-base text-ink sm:text-sm', c.system ? 'border-line' : 'border-warn-line')} data-testid="bom-assign-system">
                          <option value="">— seçilmedi —</option>
                          {systemOptions(it.category).map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                              {s.active ? '' : ' (pasif)'}
                            </option>
                          ))}
                          <option value={EXCLUDED}>— reçeteye dahil etme —</option>
                        </select>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </Panel>

      {engineAssignments.length > 0 && (
        <Panel
          title="Hesap sonucu (kaydedilmedi)"
          subtitle={calc.sourceApproved ? 'Onaylı metrajın onaylı pozlarından — kaydedince onaylanabilir' : 'Onaysız metrajdan — taslak; onaylanamaz'}
          icon={Calculator}
          actions={
            <Button variant="primary" icon={Save} onClick={() => void save()} disabled={busy || calc.pozCount === 0} data-testid="bom-save">
              {busy ? 'Kaydediliyor…' : 'Sürüm olarak kaydet'}
            </Button>
          }
        >
          <div className="space-y-4">
            {!calc.sourceApproved && <Notice tone="warn" testId="bom-draft-banner">onaysız metrajdan — taslak: bu sürüm kaydedilebilir ama onaylanamaz.</Notice>}
            <BomResultView lines={calc.lines} totals={calc.totals} cutList={calc.cutList} warnings={calc.warnings} cost={calc.cost} unpriced={calc.unpricedLines} />
            <TextField label="Sürüm notu (isteğe bağlı)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} data-testid="bom-notes" />
          </div>
        </Panel>
      )}
    </div>
  )
}

// ================================================================== Kayıtlı sürüm
function VersionView({
  version,
  versions,
  takeoffs,
  onRecalc,
  onDeleted,
  reload,
}: {
  version: BomVersion
  versions: BomVersion[]
  takeoffs: QuantityTakeoff[]
  onRecalc: () => void
  onDeleted: () => void
  reload: () => Promise<void>
}) {
  const { notify } = useToast()
  const { projects, companies } = useData()
  const [data, setData] = useState<{ assignments: BomAssignment[]; lines: BomLine[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<null | 'approve' | 'cancel' | 'delete'>(null)
  const [busy, setBusy] = useState(false)
  const [compareId, setCompareId] = useState('')
  const [exporting, setExporting] = useState<null | 'xlsx' | 'pdf'>(null)

  useEffect(() => {
    let alive = true
    loadBomVersion(requireSupabase(), version.id)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(bomErrorMessage(e, 'Reçete yükleme')))
    return () => {
      alive = false
    }
  }, [version.id])

  const lines = useMemo(() => (data ? data.lines.map(fromStoredLine) : []), [data])
  const summary = useMemo(() => summarizeStored(lines), [lines])
  const latestTakeoff = takeoffs[0] ?? null
  const stale = latestTakeoff && latestTakeoff.revision > version.takeoff_revision
  const project = projects.find((p) => p.id === version.project_id) ?? null
  const company = companies.find((c) => c.id === project?.company_id) ?? null
  const canApprove = version.status === 'taslak' && version.source_approved && version.error_count === 0

  const run = async (fn: () => Promise<void>, ctx: string) => {
    setBusy(true)
    try {
      await fn()
      setDialog(null)
    } catch (e) {
      notify(bomErrorMessage(e, ctx), 'error')
    } finally {
      setBusy(false)
      await reload()
    }
  }

  const exportFile = async (kind: 'xlsx' | 'pdf') => {
    if (!data) return
    setExporting(kind)
    try {
      const report = buildBomReport(
        {
          projectCode: project?.code ?? '—',
          projectName: project?.name ?? '—',
          companyName: company?.name ?? null,
          revision: version.revision,
          status: version.status,
          sourceApproved: version.source_approved,
          takeoffRevision: version.takeoff_revision,
          takeoffName: version.takeoff_name,
          takeoffStatus: version.takeoff_status,
          createdAt: version.created_at,
          approvedAt: version.approved_at,
          notes: version.notes,
          generatedAt: new Date(),
        },
        data.assignments,
        lines,
        version.warnings ?? [],
      )
      if (kind === 'xlsx') {
        const { bomToXlsx } = await import('@/export/bomXlsx')
        downloadBytes(bomToXlsx(report), bomFileName(report.meta, 'xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      } else {
        const [{ bomToPdf }, assets] = await Promise.all([import('@/export/bomPdf'), loadPdfAssets()])
        downloadBytes(await bomToPdf(report, assets), bomFileName(report.meta, 'pdf'), 'application/pdf')
      }
    } catch (e) {
      notify(`Dışa aktarma başarısız: ${e instanceof Error ? e.message : 'bilinmeyen hata'}`, 'error')
    } finally {
      setExporting(null)
    }
  }
  const exportCls = 'inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink shadow-card hover:bg-surface-2 disabled:opacity-50'

  return (
    <div className="space-y-4" data-testid="bom-version">
      <section className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-ink" data-testid="bom-version-title">
                Reçete Rev {version.revision}
              </h2>
              <StatusPill version={version} />
              {version.source_approved ? <Pill tone="ok">Onaylı metrajdan</Pill> : <Pill tone="warn" testId="bom-unapproved-source">onaysız metrajdan — taslak</Pill>}
            </div>
            <p className="mt-1 text-[12.5px] text-muted">
              Metraj Rev {version.takeoff_revision} · {version.takeoff_name} ({TK_STATUS[version.takeoff_status]}) · oluşturma {dtf.format(new Date(version.created_at))}
              {version.approved_at && ` · onay ${dtf.format(new Date(version.approved_at))}`}
            </p>
            {version.notes && <p className="mt-1 text-[12.5px] text-ink-2">{version.notes}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={exportCls} disabled={!!exporting || !data} onClick={() => void exportFile('xlsx')} data-testid="bom-export-xlsx">
              {exporting === 'xlsx' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />}
              Excel
            </button>
            <button type="button" className={exportCls} disabled={!!exporting || !data} onClick={() => void exportFile('pdf')} data-testid="bom-export-pdf">
              {exporting === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileDown className="h-4 w-4" aria-hidden="true" />}
              PDF
            </button>
            <Button variant="secondary" icon={RefreshCw} onClick={onRecalc} data-testid="bom-recalc">
              Yeniden hesapla
            </Button>
            {version.status === 'taslak' && (
              <>
                <Button variant="primary" icon={CheckCircle2} onClick={() => setDialog('approve')} disabled={!canApprove} title={canApprove ? undefined : !version.source_approved ? 'Onaysız metrajdan oluşturulan reçete onaylanamaz' : 'Hatalı satır var'} data-testid="bom-approve">
                  Onayla
                </Button>
                <Button variant="ghost" icon={Ban} onClick={() => setDialog('cancel')} data-testid="bom-cancel">
                  İptal et
                </Button>
              </>
            )}
            {version.status !== 'onayli' && (
              <Button variant="ghost" icon={Trash2} onClick={() => setDialog('delete')} aria-label="Reçete sürümünü sil" data-testid="bom-delete">
                Sil
              </Button>
            )}
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {stale && (
            <Notice tone="warn" testId="bom-stale">
              Metraj revize edildi: projede Rev {latestTakeoff!.revision} metraj var, bu reçete Rev {version.takeoff_revision}’den. “Yeniden hesapla” yeni bir taslak sürüm oluşturur; bu sürüm aynen korunur.
            </Notice>
          )}
          {version.status === 'taslak' && !version.source_approved && <Notice tone="warn">Bu sürüm onaysız metrajdan oluşturuldu; onaylanamaz. Metrajı ve pozları onaylayıp yeniden hesaplayın.</Notice>}
          {version.status === 'taslak' && version.source_approved && version.error_count > 0 && <Notice tone="danger">{version.error_count} hata var; hatalı reçete onaylanamaz. Kuralları düzeltip yeniden hesaplayın.</Notice>}
          {version.status === 'onayli' && <Notice tone="ok">Onaylı sürüm değiştirilemez ve silinemez. Değişiklik için yeniden hesaplayıp yeni sürüm oluşturun.</Notice>}
        </div>
      </section>

      {error ? (
        <ErrorState message={error} />
      ) : !data ? (
        <LoadingState />
      ) : (
        <>
          <section className="card p-4 sm:p-5">
            <BomResultView testId="bom-version-result" lines={lines} totals={summary.totals} cutList={summary.cutList} warnings={version.warnings ?? []} cost={summary.cost} unpriced={summary.unpricedLines} />
          </section>
          <details className="card p-4 text-[12.5px]" data-testid="bom-version-assignments">
            <summary className="cursor-pointer font-semibold text-ink">Pozlar ve sistem atamaları ({data.assignments.length})</summary>
            <ul className="mt-3 divide-y divide-line">
              {data.assignments.map((a) => (
                <li key={a.id} className="flex flex-wrap gap-x-3 gap-y-0.5 py-1.5">
                  <span className="font-mono font-semibold text-ink">{a.poz_code}</span>
                  <span className="text-muted">
                    {categoryLabel(a.category)} · {a.width_mm ?? '—'} × {a.height_mm ?? '—'} mm · {a.quantity} adet{a.kanat ? ` · K=${a.kanat}` : ''}
                    {a.opening ? ` · ${a.opening}` : ''}
                  </span>
                  <span className={cn('ml-auto', a.system_name ? 'text-ink-2' : 'text-warn')}>{a.system_name ?? 'sistem atanmamış'}</span>
                </li>
              ))}
            </ul>
          </details>
          {versions.length > 1 && <CompareVersions version={version} lines={lines} versions={versions} compareId={compareId} setCompareId={setCompareId} />}
        </>
      )}

      <ConfirmDialog
        open={dialog === 'approve'}
        tone="primary"
        title={`Reçete Rev ${version.revision} onaylansın mı?`}
        message={`Onaylanan reçete ve satırları kilitlenir; değiştirilemez ve silinemez.${summary.unpricedLines ? ` ${summary.unpricedLines} satırın fiyatı tanımlı değil (maliyet toplamına dahil değil).` : ''}${version.warning_count ? ` ${version.warning_count} uyarı var.` : ''}`}
        confirmLabel="Onayla ve kilitle"
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          void run(async () => {
            await approveBomVersion(requireSupabase(), version.id)
            notify('Reçete sürümü onaylandı.')
          }, 'Onay')
        }
      />
      <ConfirmDialog
        open={dialog === 'cancel'}
        title="Sürüm iptal edilsin mi?"
        message="İptal edilen sürüm geçmişte kalır, yeniden açılamaz."
        confirmLabel="İptal et"
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => void run(async () => void (await updateBomVersion(requireSupabase(), version, { status: 'iptal' })), 'İptal')}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        title="Reçete sürümü silinsin mi?"
        message="Taslak/iptal sürüm ve satırları silinir. Bu işlem geri alınamaz."
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          void run(async () => {
            await deleteBomVersion(requireSupabase(), version.id)
            onDeleted()
          }, 'Silme')
        }
      />
    </div>
  )
}

// ================================================================== Sürüm karşılaştırma
function CompareVersions({ version, lines, versions, compareId, setCompareId }: { version: BomVersion; lines: BomCalcLine[]; versions: BomVersion[]; compareId: string; setCompareId: (id: string) => void }) {
  const others = versions.filter((v) => v.id !== version.id)
  const baseId = compareId || (versions.find((v) => v.revision < version.revision)?.id ?? others[0]?.id ?? '')
  const [base, setBase] = useState<{ id: string; lines: BomCalcLine[] } | null>(null)
  const loading = useRef('')
  useEffect(() => {
    if (!baseId || base?.id === baseId || loading.current === baseId) return
    loading.current = baseId
    loadBomVersion(requireSupabase(), baseId)
      .then((d) => setBase({ id: baseId, lines: d.lines.map(fromStoredLine) }))
      .catch(() => setBase(null))
  }, [baseId, base?.id])
  const diff = useMemo(() => (base && base.id === baseId ? diffLines(base.lines, lines) : null), [base, baseId, lines])
  const baseRev = versions.find((v) => v.id === baseId)?.revision
  return (
    <Panel title="Sürüm karşılaştırması" subtitle={baseRev ? `Rev ${baseRev} → Rev ${version.revision}` : undefined} icon={ArrowLeftRight}>
      <div className="space-y-3" data-testid="bom-compare">
        <label className="block max-w-xs">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Karşılaştırılan sürüm</span>
          <select value={baseId} onChange={(e) => setCompareId(e.target.value)} className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink sm:text-sm" data-testid="bom-compare-base">
            {others.map((v) => (
              <option key={v.id} value={v.id}>
                Rev {v.revision} · {BOM_STATUS_LABEL[v.status]} · metraj Rev {v.takeoff_revision}
              </option>
            ))}
          </select>
        </label>
        {!diff ? (
          <LoadingState />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Pill tone="warn" testId="bom-diff-degisen">{diff.counts.degisen} değişen</Pill>
              <Pill tone="ok" testId="bom-diff-eklenen">{diff.counts.eklenen} eklenen</Pill>
              <Pill tone="danger" testId="bom-diff-silinen">{diff.counts.silinen} silinen</Pill>
            </div>
            {diff.lines.length === 0 ? (
              <p className="text-sm text-muted">Satırlar aynı.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[640px] text-[12.5px]">
                  <thead className="bg-surface-2 text-left text-[10.5px] font-semibold tracking-wide text-subtle uppercase">
                    <tr>
                      <th className="px-3 py-2">Durum</th>
                      <th className="px-3 py-2">Poz</th>
                      <th className="px-3 py-2">Malzeme</th>
                      <th className="px-3 py-2">Fark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.lines.slice(0, 300).map((d) => (
                      <tr key={`${d.kind}:${d.key}`} className="border-t border-line" data-testid="bom-diff-row" data-kind={d.kind} data-poz={d.poz}>
                        <td className="px-3 py-1.5">
                          <Pill tone={d.kind === 'degisen' ? 'warn' : d.kind === 'eklenen' ? 'ok' : 'danger'}>{d.kind === 'degisen' ? 'Değişen' : d.kind === 'eklenen' ? 'Eklenen' : 'Silinen'}</Pill>
                        </td>
                        <td className="px-3 py-1.5 font-mono">{d.poz}</td>
                        <td className="px-3 py-1.5">{d.label}</td>
                        <td className="px-3 py-1.5 text-muted">
                          {d.kind === 'degisen' ? d.changes.join(' · ') : `${fmtQty((d.after ?? d.before)!.totalMilli)} ${qtyUnit((d.after ?? d.before)!.unit)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {diff.totals.length > 0 && (
              <ul className="space-y-1 text-[12.5px]" data-testid="bom-diff-totals">
                {diff.totals.map((t) => (
                  <li key={t.key} className="flex flex-wrap gap-x-2">
                    <span className="text-ink">{t.label}</span>
                    <span className="font-mono text-muted">
                      {fmtQty(t.beforeMilli)} → {fmtQty(t.afterMilli)} {qtyUnit(t.unit)}
                    </span>
                    <span className={cn('font-mono font-semibold', t.deltaMilli > 0 ? 'text-warn' : 'text-ok')}>
                      ({t.deltaMilli > 0 ? '+' : '−'}
                      {fmtQty(Math.abs(t.deltaMilli))})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Panel>
  )
}
