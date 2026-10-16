import { Boxes, Calculator, LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { calculateBom } from '@/bom/engine'
import { checkFormula } from '@/bom/formula'
import {
  BASIS_LABEL,
  COMPONENT_ROLES,
  COMPONENT_UNITS,
  type ComponentRole,
  type ComponentUnit,
  type ProductSystem,
  ROLE_LABEL,
  ROLE_ORDER,
  type RuleBasis,
  STRUCTURE_TEMPLATE,
  type SystemComponent,
  type SystemRule,
  SYSTEM_TYPE_LABEL,
  SYSTEM_TYPES,
  type SystemType,
  UNIT_INFO,
} from '@/bom/types'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FormAlert, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Panel } from '@/components/ui/Panel'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { useToast } from '@/context/toast'
import { ConflictError } from '@/data/api'
import { createComponent, createRule, createSystem, deleteComponent, deleteRule, deleteSystem, updateComponent, updateRule, updateSystem } from '@/data/bomApi'
import { currentRates } from '@/finance/fromTakeoff'
import { FIN_UNIT_LABEL } from '@/finance/types'
import { cn } from '@/lib/cn'
import { localISODate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useFormDirty } from '@/lib/unsaved'
import { useResetOnOpen } from '@/lib/useResetOnOpen'
import { QUANTITY_CATEGORIES } from '@/quantity/types'
import { formatMoney, toCents } from '@/quote/money'
import { BomResultView } from './BomResultView'
import { bomErrorMessage, FormulaField, FormulaReference, Notice, numInput, parseNum, Pill, useBomLibrary } from './shared'

type Lib = ReturnType<typeof useBomLibrary>

const conflictText = 'Kayıt başka bir cihazda değişti; kapatıp yeniden açın.'
const errText = (e: unknown, ctx: string) => (e instanceof ConflictError ? conflictText : bomErrorMessage(e, ctx))

// ================================================================== Kütüphane
export function SystemLibrary() {
  const lib = useBomLibrary()
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('sistem')
  const [form, setForm] = useState<{ open: boolean; system: ProductSystem | null }>({ open: false, system: null })
  const systems = useMemo(() => [...lib.systems].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'tr')), [lib.systems])
  const selected = systems.find((s) => s.id === selectedId) ?? systems[0] ?? null
  const select = (id: string) => {
    const p = new URLSearchParams(params)
    p.set('sistem', id)
    setParams(p, { replace: true })
  }

  if (lib.error) return <ErrorState message={lib.error} onRetry={() => void lib.reload()} />
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Panel
        title="Ürün sistemleri"
        subtitle={`${systems.length} sistem`}
        icon={Boxes}
        bodyClassName="p-3"
        actions={
          <Button variant="secondary" icon={Plus} onClick={() => setForm({ open: true, system: null })} data-testid="sys-add">
            Yeni sistem
          </Button>
        }
      >
        {lib.loading ? (
          <LoadingState />
        ) : systems.length === 0 ? (
          <div className="space-y-3 p-2" data-testid="sys-empty">
            <p className="text-sm leading-relaxed text-ink-2">Kütüphane boş başlar. LEONX OS üretici verisi (profil kodu, ağırlık, fiyat, kesim düşümü) içermez ve uydurmaz.</p>
            <p className="text-[12.5px] leading-relaxed text-muted">Kullandığınız sistemi üretici kataloğundaki değerlerle tanımlayın: bileşenler (kasa, kanat, cam, fitil, aksesuar…) ve her birinin üretim kuralı (kesim boyu, parça, miktar formülü).</p>
          </div>
        ) : (
          <ul className="space-y-1" data-testid="sys-list">
            {systems.map((s) => {
              const n = lib.components.filter((c) => c.system_id === s.id).length
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => select(s.id)}
                    aria-current={selected?.id === s.id}
                    className={cn('w-full rounded-xl border px-3 py-2.5 text-left transition-colors', selected?.id === s.id ? 'border-line-strong bg-surface-2 shadow-card' : 'border-transparent hover:bg-surface-2/70', !s.active && 'opacity-60')}
                    data-testid="sys-item"
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{s.name}</span>
                      {!s.active && <Pill tone="muted">Pasif</Pill>}
                    </div>
                    <div className="mt-0.5 truncate text-[11.5px] text-muted">
                      {[s.manufacturer, s.series].filter(Boolean).join(' · ') || 'üretici girilmemiş'} · {SYSTEM_TYPE_LABEL[s.system_type]} · {n} bileşen
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
      {selected ? (
        <SystemDetail key={selected.id} system={selected} lib={lib} onEdit={() => setForm({ open: true, system: selected })} />
      ) : (
        !lib.loading && (
          <section className="card p-6">
            <Notice tone="info">Bir sistem oluşturarak başlayın. İsterseniz yalnız satır yapısını içeren boş şablonu ekleyebilirsiniz; tüm değerleri siz girersiniz.</Notice>
          </section>
        )
      )}
      <SystemForm
        open={form.open}
        system={form.system}
        onClose={() => setForm({ open: false, system: null })}
        onCreated={(id) => {
          void lib.reload()
          select(id)
        }}
      />
    </div>
  )
}

// ================================================================== Sistem formu
function SystemForm({ open, system, onClose, onCreated }: { open: boolean; system: ProductSystem | null; onClose: () => void; onCreated: (id: string) => void }) {
  const { notify } = useToast()
  const empty = { name: '', manufacturer: '', series: '', type: 'al_pencere' as SystemType, color: '', notes: '', active: true }
  const [d, setD] = useState(empty)
  const [nameErr, setNameErr] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draftId, setDraftId] = useState('')
  const { markDirty } = useFormDirty(open, 'Ürün sistemi formu')
  useResetOnOpen(
    open,
    () => {
      setNameErr(null)
      setError(null)
      setDraftId(crypto.randomUUID())
      setD(system ? { name: system.name, manufacturer: system.manufacturer ?? '', series: system.series ?? '', type: system.system_type, color: system.color ?? '', notes: system.notes ?? '', active: system.active } : empty)
    },
    [system],
  )
  const submit = async () => {
    if (!d.name.trim()) return setNameErr('Sistem adı zorunludur.')
    setNameErr(null)
    const input = { name: d.name.trim(), manufacturer: d.manufacturer.trim() || null, series: d.series.trim() || null, system_type: d.type, color: d.color.trim() || null, notes: d.notes.trim() || null, active: d.active }
    setBusy(true)
    setError(null)
    try {
      const db = requireSupabase()
      if (system) await updateSystem(db, system, input)
      else onCreated((await createSystem(db, { ...input, id: draftId })).id)
      notify(system ? 'Sistem güncellendi.' : 'Sistem oluşturuldu.')
      onClose()
    } catch (e) {
      setError(errText(e, 'Sistem kaydı'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title={system ? 'Sistemi düzenle' : 'Yeni ürün sistemi'}
      description="Üretici, seri ve tip bilgisi sizin girişinizdir; sistem hazır üretici verisi içermez."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="sys-form" disabled={busy} data-testid="sys-submit">
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      {error && <FormAlert>{error}</FormAlert>}
      <form id="sys-form" onChangeCapture={markDirty} onSubmit={(e) => (e.preventDefault(), void submit())} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Sistem adı" required value={d.name} onChange={(e) => setD((x) => ({ ...x, name: e.target.value }))} error={nameErr ?? undefined} maxLength={120} className="sm:col-span-2" data-testid="sys-name" />
        <TextField label="Üretici" value={d.manufacturer} onChange={(e) => setD((x) => ({ ...x, manufacturer: e.target.value }))} maxLength={120} data-testid="sys-manufacturer" />
        <TextField label="Seri" value={d.series} onChange={(e) => setD((x) => ({ ...x, series: e.target.value }))} maxLength={120} data-testid="sys-series" />
        <SelectField label="Sistem tipi" value={d.type} onChange={(e) => setD((x) => ({ ...x, type: e.target.value as SystemType }))} data-testid="sys-type">
          {SYSTEM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </SelectField>
        <TextField label="Renk (isteğe bağlı)" value={d.color} onChange={(e) => setD((x) => ({ ...x, color: e.target.value }))} maxLength={80} />
        <label className="flex items-center gap-2 text-sm text-ink-2 sm:col-span-2">
          <input type="checkbox" checked={d.active} onChange={(e) => setD((x) => ({ ...x, active: e.target.checked }))} className="h-4 w-4" />
          Aktif (atamada önerilir)
        </label>
        <TextAreaField label="Not" value={d.notes} onChange={(e) => setD((x) => ({ ...x, notes: e.target.value }))} maxLength={2000} className="sm:col-span-2" />
      </form>
    </Modal>
  )
}

// ================================================================== Sistem ayrıntısı
function SystemDetail({ system, lib, onEdit }: { system: ProductSystem; lib: Lib; onEdit: () => void }) {
  const { notify } = useToast()
  const [, setParams] = useSearchParams()
  const comps = useMemo(
    () => lib.components.filter((c) => c.system_id === system.id).sort((a, b) => a.sort_order - b.sort_order || ROLE_ORDER[a.role] - ROLE_ORDER[b.role]),
    [lib.components, system.id],
  )
  const [compForm, setCompForm] = useState<{ open: boolean; comp: SystemComponent | null }>({ open: false, comp: null })
  const [ruleForm, setRuleForm] = useState<{ open: boolean; comp: SystemComponent | null; rule: SystemRule | null }>({ open: false, comp: null, rule: null })
  const [pending, setPending] = useState<null | { kind: 'system' } | { kind: 'comp'; comp: SystemComponent } | { kind: 'rule'; rule: SystemRule }>(null)
  const [busy, setBusy] = useState(false)
  const today = localISODate()
  const rateById = new Map(lib.rates.map((r) => [r.id, r]))
  const current = new Map(currentRates(lib.rates, today).map((r) => [r.code, r]))

  const addTemplate = async () => {
    setBusy(true)
    try {
      const db = requireSupabase()
      let i = comps.length
      for (const t of STRUCTURE_TEMPLATE) {
        await createComponent(db, { id: crypto.randomUUID(), system_id: system.id, role: t.role, code: null, name: t.name, unit: t.unit, standard_length_mm: null, waste_pct: 0, weight_kg_per_m: null, cost_rate_id: null, sort_order: ++i * 10, notes: null })
      }
      notify('Boş şablon eklendi: kod, ölçü kuralı, standart boy ve fiyatı üretici kataloğundan girin.')
      await lib.reload()
    } catch (e) {
      notify(bomErrorMessage(e, 'Şablon ekleme'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!pending) return
    setBusy(true)
    try {
      const db = requireSupabase()
      if (pending.kind === 'system') {
        await deleteSystem(db, system.id)
        setParams((p) => (p.delete('sistem'), p), { replace: true })
      } else if (pending.kind === 'comp') await deleteComponent(db, pending.comp.id)
      else await deleteRule(db, pending.rule.id)
      await lib.reload()
      setPending(null)
    } catch (e) {
      notify(bomErrorMessage(e, 'Silme'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <section className="card p-4 sm:p-5" data-testid="sys-detail">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-ink" data-testid="sys-title">
                {system.name}
              </h2>
              <Pill tone="info">{SYSTEM_TYPE_LABEL[system.system_type]}</Pill>
              {!system.active && <Pill tone="muted">Pasif</Pill>}
            </div>
            <p className="mt-1 text-[12.5px] text-muted">
              {[system.manufacturer && `Üretici: ${system.manufacturer}`, system.series && `Seri: ${system.series}`, system.color && `Renk: ${system.color}`].filter(Boolean).join(' · ') || 'Üretici/seri girilmemiş'}
            </p>
            {system.notes && <p className="mt-1 text-[12.5px] text-ink-2">{system.notes}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={Pencil} onClick={onEdit} data-testid="sys-edit">
              Düzenle
            </Button>
            <Button variant="ghost" icon={Trash2} onClick={() => setPending({ kind: 'system' })} aria-label="Sistemi sil">
              Sil
            </Button>
          </div>
        </div>
      </section>

      <Panel
        title="Bileşenler ve üretim kuralları"
        subtitle="Her bileşenin miktarı yalnız kendi kuralından hesaplanır. Profil kesim boyu çevreden türetilmez."
        icon={Boxes}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={LayoutTemplate} onClick={() => void addTemplate()} disabled={busy} data-testid="sys-template" title="Yalnız satır yapısı; değerler boş">
              Boş şablon ekle
            </Button>
            <Button variant="secondary" icon={Plus} onClick={() => setCompForm({ open: true, comp: null })} data-testid="comp-add">
              Bileşen ekle
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Notice tone="info">Boş şablon: kasa / kanat / kayıt / cam / fitil / aksesuar satırları — kod, kesim kuralı, standart boy, fire ve fiyatı üretici kataloğundan girin. Şablon hiçbir sayısal değer içermez.</Notice>
          {comps.length === 0 ? (
            <p className="text-sm text-muted">Bu sistemde bileşen yok.</p>
          ) : (
            <ul className="space-y-2.5" data-testid="comp-list">
              {comps.map((c) => {
                const rules = lib.rules.filter((r) => r.component_id === c.id).sort((a, b) => a.sort_order - b.sort_order)
                const linked = c.cost_rate_id ? rateById.get(c.cost_rate_id) : null
                const price = linked ? current.get(linked.code) : null
                return (
                  <li key={c.id} className="rounded-xl border border-line bg-surface" data-testid="comp-row" data-code={c.code ?? ''}>
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5">
                      <div className="min-w-0 flex-1 basis-56">
                        <div className="flex flex-wrap items-center gap-2">
                          <Pill tone="info">{ROLE_LABEL[c.role]}</Pill>
                          <span className={cn('font-mono text-[12px]', c.code ? 'text-ink-2' : 'text-warn')}>{c.code ?? 'kod girilmemiş'}</span>
                          <span className="text-[13.5px] font-semibold text-ink">{c.name}</span>
                        </div>
                        <div className="mt-1 text-[11.5px] text-muted">
                          {UNIT_INFO[c.unit].label}
                          {c.unit === 'mm_profil' && ` · standart boy ${c.standard_length_mm ? `${c.standard_length_mm.toLocaleString('tr-TR')} mm` : 'girilmemiş'}`}
                          {` · fire %${String(Number(c.waste_pct)).replace('.', ',')}`}
                          {c.weight_kg_per_m != null && ` · ${String(Number(c.weight_kg_per_m)).replace('.', ',')} kg/m`}
                          {' · '}
                          {linked ? (
                            price ? (
                              <span className="text-ink-2">
                                fiyat {linked.code}: {formatMoney(toCents(price.unit_cost), price.currency)}/{FIN_UNIT_LABEL[price.unit]}
                              </span>
                            ) : (
                              <span className="text-warn">katalog fiyatı geçerli değil</span>
                            )
                          ) : (
                            <span>fiyat tanımlı değil</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-0.5">
                        <IconBtn label={`${c.name} kural ekle`} onClick={() => setRuleForm({ open: true, comp: c, rule: null })} testId="rule-add">
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        </IconBtn>
                        <IconBtn label={`${c.name} düzenle`} onClick={() => setCompForm({ open: true, comp: c })} testId="comp-edit">
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </IconBtn>
                        <IconBtn label={`${c.name} sil`} danger onClick={() => setPending({ kind: 'comp', comp: c })}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </IconBtn>
                      </div>
                    </div>
                    <div className="border-t border-line bg-surface-2/40 px-3 py-2">
                      {rules.length === 0 ? (
                        <p className="text-[12px] text-warn">Kural yok — bu bileşen hesaba katılmaz. “+” ile üretim kuralı ekleyin.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {rules.map((r) => (
                            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]" data-testid="rule-row">
                              <code className="min-w-0 flex-1 basis-60 font-mono text-[12px] break-all text-ink">
                                {c.unit === 'mm_profil' ? `kesim = ${r.cut_length_formula ?? '—'} · parça = ${r.pieces_formula ?? '—'}` : `miktar = ${r.quantity_formula ?? '—'}`}
                              </code>
                              <span className="text-[11.5px] text-muted">
                                {r.basis === 'poz' ? 'poz toplamı' : '× N'}
                                {r.angle && ` · ${r.angle}°`}
                                {r.applies_to && ` · yalnız: ${r.applies_to}`}
                              </span>
                              <span className="flex gap-0.5">
                                <IconBtn label="Kuralı düzenle" onClick={() => setRuleForm({ open: true, comp: c, rule: r })} testId="rule-edit">
                                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                </IconBtn>
                                <IconBtn label="Kuralı sil" danger onClick={() => setPending({ kind: 'rule', rule: r })}>
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                </IconBtn>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Panel>

      <PreviewCalculator system={system} lib={lib} />

      <ComponentForm open={compForm.open} comp={compForm.comp} systemId={system.id} nextSort={(comps.at(-1)?.sort_order ?? 0) + 10} rates={lib.rates} onClose={() => setCompForm({ open: false, comp: null })} onSaved={() => void lib.reload()} />
      <RuleForm open={ruleForm.open} comp={ruleForm.comp} rule={ruleForm.rule} nextSort={(lib.rules.filter((r) => r.component_id === ruleForm.comp?.id).at(-1)?.sort_order ?? 0) + 10} onClose={() => setRuleForm({ open: false, comp: null, rule: null })} onSaved={() => void lib.reload()} />
      <ConfirmDialog
        open={!!pending}
        title={pending?.kind === 'system' ? 'Sistem silinsin mi?' : pending?.kind === 'comp' ? 'Bileşen silinsin mi?' : 'Kural silinsin mi?'}
        message={
          pending?.kind === 'system'
            ? `${system.name}, bileşenleri ve kuralları silinecek. Bu sistemle kaydedilmiş reçete sürümleri anlık görüntüleriyle aynen korunur. Kullanmayacaksanız “pasif” yapmayı tercih edebilirsiniz.`
            : pending?.kind === 'comp'
              ? `${pending.comp.name} ve kuralları silinecek. Kaydedilmiş reçete sürümleri etkilenmez.`
              : 'Kural silinecek. Kaydedilmiş reçete sürümleri etkilenmez.'
        }
        busy={busy}
        onClose={() => setPending(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  )
}

function IconBtn({ label, onClick, children, danger, testId }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean; testId?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={cn('grid h-8 w-8 place-items-center rounded-md text-muted', danger ? 'hover:bg-danger-soft hover:text-danger' : 'hover:bg-surface-3 hover:text-ink')} data-testid={testId}>
      {children}
    </button>
  )
}

// ================================================================== Bileşen formu
function ComponentForm({
  open,
  comp,
  systemId,
  nextSort,
  rates,
  onClose,
  onSaved,
}: {
  open: boolean
  comp: SystemComponent | null
  systemId: string
  nextSort: number
  rates: Lib['rates']
  onClose: () => void
  onSaved: () => void
}) {
  const { notify } = useToast()
  const empty = { role: 'kasa' as ComponentRole, code: '', name: '', unit: 'mm_profil' as ComponentUnit, std: '', waste: '0', kgm: '', rate: '', notes: '' }
  const [d, setD] = useState(empty)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draftId, setDraftId] = useState('')
  const { markDirty } = useFormDirty(open, 'Bileşen formu')
  useResetOnOpen(
    open,
    () => {
      setErrors({})
      setError(null)
      setDraftId(crypto.randomUUID())
      setD(
        comp
          ? { role: comp.role, code: comp.code ?? '', name: comp.name, unit: comp.unit, std: numInput(comp.standard_length_mm), waste: numInput(Number(comp.waste_pct)), kgm: numInput(comp.weight_kg_per_m == null ? null : Number(comp.weight_kg_per_m)), rate: comp.cost_rate_id ?? '', notes: comp.notes ?? '' }
          : empty,
      )
    },
    [comp],
  )
  const profile = d.unit === 'mm_profil'
  const latest = useMemo(() => currentRates(rates, localISODate()), [rates])
  const submit = async () => {
    const errs: Record<string, string> = {}
    const std = profile ? parseNum(d.std, 0) : null
    const waste = parseNum(d.waste || '0')
    const kgm = profile ? parseNum(d.kgm) : null
    if (!d.name.trim()) errs.name = 'Ad zorunludur.'
    if (d.code.trim().length > 60) errs.code = 'En fazla 60 karakter.'
    if (std != null && (Number.isNaN(std) || std < 1 || std > 20000)) errs.std = '1–20.000 mm arası tam sayı girin (veya boş bırakın).'
    if (waste == null || Number.isNaN(waste) || waste < 0 || waste > 100) errs.waste = '0–100 arası yüzde girin.'
    if (kgm != null && (Number.isNaN(kgm) || kgm <= 0 || kgm > 1000)) errs.kgm = 'Sıfırdan büyük değer girin (veya boş bırakın).'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const input = { role: d.role, code: d.code.trim() || null, name: d.name.trim(), unit: d.unit, standard_length_mm: std, waste_pct: waste!, weight_kg_per_m: kgm, cost_rate_id: d.rate || null, notes: d.notes.trim() || null }
    setBusy(true)
    setError(null)
    try {
      const db = requireSupabase()
      if (comp) await updateComponent(db, comp, input)
      else await createComponent(db, { ...input, id: draftId, system_id: systemId, sort_order: nextSort })
      notify(comp ? 'Bileşen güncellendi.' : 'Bileşen eklendi.')
      onSaved()
      onClose()
    } catch (e) {
      setError(errText(e, 'Bileşen kaydı'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title={comp ? 'Bileşeni düzenle' : 'Yeni bileşen'}
      description="Kod, standart boy, fire ve kg/m değerlerini üretici kataloğundan girin. Fiyat burada saklanmaz; birim maliyet kataloğuna bağlanır."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="comp-form" disabled={busy} data-testid="comp-submit">
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      {error && <FormAlert>{error}</FormAlert>}
      <form id="comp-form" onChangeCapture={markDirty} onSubmit={(e) => (e.preventDefault(), void submit())} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField label="Rol" value={d.role} onChange={(e) => setD((x) => ({ ...x, role: e.target.value as ComponentRole }))} data-testid="comp-role">
          {COMPONENT_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Birim" value={d.unit} onChange={(e) => setD((x) => ({ ...x, unit: e.target.value as ComponentUnit }))} hint={profile ? 'Kesim boyu (mm) × parça; miktar toplam metre olur.' : undefined} data-testid="comp-unit">
          {COMPONENT_UNITS.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </SelectField>
        <TextField label="Ürün / profil kodu" value={d.code} onChange={(e) => setD((x) => ({ ...x, code: e.target.value }))} error={errors.code} maxLength={60} hint="Üretici kataloğundaki kod" data-testid="comp-code" />
        <TextField label="Ad" required value={d.name} onChange={(e) => setD((x) => ({ ...x, name: e.target.value }))} error={errors.name} maxLength={200} data-testid="comp-name" />
        {profile && (
          <>
            <TextField label="Standart boy (mm)" inputMode="numeric" value={d.std} onChange={(e) => setD((x) => ({ ...x, std: e.target.value }))} error={errors.std} hint="Tahmini boy adedi için" data-testid="comp-std" />
            <TextField label="Ağırlık (kg/m)" inputMode="decimal" value={d.kgm} onChange={(e) => setD((x) => ({ ...x, kgm: e.target.value }))} error={errors.kgm} data-testid="comp-kgm" />
          </>
        )}
        <TextField label="Fire (%)" inputMode="decimal" value={d.waste} onChange={(e) => setD((x) => ({ ...x, waste: e.target.value }))} error={errors.waste} data-testid="comp-waste" />
        <SelectField label="Birim maliyet (katalog)" value={d.rate} onChange={(e) => setD((x) => ({ ...x, rate: e.target.value }))} hint="Finans → Birim maliyetler kataloğundan. Boşsa “fiyat tanımlı değil”." data-testid="comp-rate">
          <option value="">Bağlı değil</option>
          {latest.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code} · {r.name} · {formatMoney(toCents(r.unit_cost), r.currency)}/{FIN_UNIT_LABEL[r.unit]}
            </option>
          ))}
          {d.rate && !latest.some((r) => r.id === d.rate) && <option value={d.rate}>Bağlı kayıt (güncel değil)</option>}
        </SelectField>
        <TextAreaField label="Not" value={d.notes} onChange={(e) => setD((x) => ({ ...x, notes: e.target.value }))} maxLength={2000} className="sm:col-span-2" />
      </form>
    </Modal>
  )
}

// ================================================================== Kural formu
function RuleForm({ open, comp, rule, nextSort, onClose, onSaved }: { open: boolean; comp: SystemComponent | null; rule: SystemRule | null; nextSort: number; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast()
  const empty = { cut: '', pieces: '', qty: '', basis: 'birim' as RuleBasis, angle: '', applies: '', notes: '' }
  const [d, setD] = useState(empty)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draftId, setDraftId] = useState('')
  const { markDirty } = useFormDirty(open, 'Kural formu')
  useResetOnOpen(
    open,
    () => {
      setError(null)
      setDraftId(crypto.randomUUID())
      setD(rule ? { cut: rule.cut_length_formula ?? '', pieces: rule.pieces_formula ?? '', qty: rule.quantity_formula ?? '', basis: rule.basis, angle: rule.angle ?? '', applies: rule.applies_to ?? '', notes: rule.notes ?? '' } : empty)
    },
    [rule, comp],
  )
  const profile = comp?.unit === 'mm_profil'
  const submit = async () => {
    if (!comp) return
    const need = profile ? [d.cut, d.pieces] : [d.qty]
    if (need.some((f) => !f.trim())) return setError(profile ? 'Kesimli profilde kesim boyu ve parça formülü zorunludur (sistemin üretim kuralı).' : 'Miktar formülü zorunludur.')
    const bad = (profile ? [d.cut, d.pieces] : [d.qty]).map((f) => checkFormula(f)).find(Boolean)
    if (bad) return setError(`Formül hatalı: ${bad}`)
    const input = {
      cut_length_formula: profile ? d.cut.trim() : null,
      pieces_formula: profile ? d.pieces.trim() : null,
      quantity_formula: profile ? null : d.qty.trim(),
      basis: d.basis,
      angle: d.angle.trim() || null,
      applies_to: d.applies.trim() || null,
      notes: d.notes.trim() || null,
    }
    setBusy(true)
    setError(null)
    try {
      const db = requireSupabase()
      if (rule) await updateRule(db, rule, input)
      else await createRule(db, { ...input, id: draftId, component_id: comp.id, sort_order: nextSort })
      notify(rule ? 'Kural güncellendi.' : 'Kural eklendi.')
      onSaved()
      onClose()
    } catch (e) {
      setError(errText(e, 'Kural kaydı'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title={rule ? 'Üretim kuralını düzenle' : 'Yeni üretim kuralı'}
      description={comp ? `${ROLE_LABEL[comp.role]} · ${comp.code ? `${comp.code} · ` : ''}${comp.name} (${UNIT_INFO[comp.unit].label})` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="rule-form" disabled={busy} data-testid="rule-submit">
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      {error && <FormAlert>{error}</FormAlert>}
      <form id="rule-form" onChangeCapture={markDirty} onSubmit={(e) => (e.preventDefault(), void submit())} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {profile ? (
          <>
            <FormulaField label="Kesim boyu (mm, tek parça)" required value={d.cut} onChange={(v) => setD((x) => ({ ...x, cut: v }))} hint="Sistemin kesim kuralı, ör. W-2*düşüm değeri" testId="rule-cut" />
            <FormulaField label="Parça sayısı" required value={d.pieces} onChange={(v) => setD((x) => ({ ...x, pieces: v }))} hint="Tam sayı olmalı, ör. 2*K" testId="rule-pieces" />
          </>
        ) : (
          <FormulaField label={`Miktar (${comp ? UNIT_INFO[comp.unit].short : ''})`} required value={d.qty} onChange={(v) => setD((x) => ({ ...x, qty: v }))} hint="ör. (W-…)*(H-…)/1000000" testId="rule-qty" />
        )}
        <SelectField label="Formül kapsamı" value={d.basis} onChange={(e) => setD((x) => ({ ...x, basis: e.target.value as RuleBasis }))} data-testid="rule-basis">
          {(Object.keys(BASIS_LABEL) as RuleBasis[]).map((b) => (
            <option key={b} value={b}>
              {BASIS_LABEL[b]}
            </option>
          ))}
        </SelectField>
        {profile && <TextField label="Kesim açısı (bilgi)" value={d.angle} onChange={(e) => setD((x) => ({ ...x, angle: e.target.value }))} maxLength={20} placeholder="45 veya 90" data-testid="rule-angle" />}
        <TextField
          label="Yalnız şu pozlara (isteğe bağlı)"
          value={d.applies}
          onChange={(e) => setD((x) => ({ ...x, applies: e.target.value }))}
          maxLength={80}
          hint="Boş: tüm pozlar. İş grubu kodu (al_pencere) veya açılım metninde geçen ifade; virgülle birden fazla."
          data-testid="rule-applies"
        />
        <TextAreaField label="Not" value={d.notes} onChange={(e) => setD((x) => ({ ...x, notes: e.target.value }))} maxLength={1000} className="sm:col-span-2" />
        <div className="sm:col-span-2">
          <FormulaReference />
        </div>
      </form>
    </Modal>
  )
}

// ================================================================== Önizleme hesaplayıcı
function PreviewCalculator({ system, lib }: { system: ProductSystem; lib: Lib }) {
  const [v, setV] = useState({ w: '1200', h: '1500', n: '1', k: '1', opening: '', category: 'al_pencere' })
  const num = (s: string, d = 1) => {
    const x = parseNum(s, d)
    return x == null || Number.isNaN(x) ? null : x
  }
  const calc = useMemo(() => {
    const engine = lib.engineSystems.find((s) => s.id === system.id)
    if (!engine) return null
    const n = num(v.n, 0)
    const k = num(v.k, 0)
    return calculateBom({
      assignments: [
        {
          item: { id: 'onizleme', poz_code: 'ÖNİZLEME', category: v.category, width_mm: num(v.w), height_mm: num(v.h), quantity: n && n > 0 ? n : 1, verification: 'onaylandi' },
          system_id: system.id,
          kanat: k && k > 0 ? k : 1,
          opening: v.opening.trim() || null,
        },
      ],
      systems: [{ ...engine, active: true }],
      rates: lib.rates,
      today: localISODate(),
      takeoffApproved: true,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib.engineSystems, lib.rates, system.id, v])
  return (
    <Panel title="Önizleme hesaplayıcı" subtitle="Ölçü girin, bu sistemin kurallarıyla oluşacak satırları görün (kaydedilmez)." icon={Calculator}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="preview-inputs">
        <TextField label="W en (mm)" inputMode="decimal" value={v.w} onChange={(e) => setV((x) => ({ ...x, w: e.target.value }))} data-testid="pv-w" />
        <TextField label="H boy (mm)" inputMode="decimal" value={v.h} onChange={(e) => setV((x) => ({ ...x, h: e.target.value }))} data-testid="pv-h" />
        <TextField label="N adet" inputMode="numeric" value={v.n} onChange={(e) => setV((x) => ({ ...x, n: e.target.value }))} data-testid="pv-n" />
        <TextField label="K kanat" inputMode="numeric" value={v.k} onChange={(e) => setV((x) => ({ ...x, k: e.target.value }))} data-testid="pv-k" />
        <TextField label="Açılım" value={v.opening} onChange={(e) => setV((x) => ({ ...x, opening: e.target.value }))} placeholder="ör. çift kanat" />
        <SelectField label="İş grubu" value={v.category} onChange={(e) => setV((x) => ({ ...x, category: e.target.value }))}>
          {QUANTITY_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="mt-4">{calc && <BomResultView testId="preview-result" lines={calc.lines} totals={calc.totals} cutList={calc.cutList} warnings={calc.warnings} cost={calc.cost} unpriced={calc.unpricedLines} />}</div>
    </Panel>
  )
}
