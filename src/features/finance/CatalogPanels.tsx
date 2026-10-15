import { ArrowRightLeft, Pencil, Plus, Tags, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FormAlert, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Panel } from '@/components/ui/Panel'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { ConflictError } from '@/data/api'
import { createCostRate, createFxRate, deleteCostRate, deleteFxRate, updateCostRate } from '@/data/financeApi'
import { formatRate, parseRateInput } from '@/finance/fx'
import { COST_GROUP_LABEL, COST_GROUPS, type CostGroup, type CostRate, FIN_UNIT_LABEL, FIN_UNITS, type FinUnit } from '@/finance/types'
import { cn } from '@/lib/cn'
import { formatDate, localISODate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useFormDirty } from '@/lib/unsaved'
import { CATEGORY_INFO, QUANTITY_CATEGORIES } from '@/quantity/types'
import { formatMoney, toCents } from '@/quote/money'
import { CURRENCIES, type Currency } from '@/quote/types'
import { centsToInput, finErrorMessage, parseAmount, useFinanceRefs } from './shared'

// ================================================================== Birim maliyet kataloğu
function CostRateForm({ open, onClose, rate }: { open: boolean; onClose: () => void; rate: CostRate | null }) {
  const { notify } = useToast()
  const empty = { code: '', name: '', group: 'profil' as CostGroup, unit: 'm2' as FinUnit, currency: 'TRY' as Currency, cost: '', category: '', validFrom: localISODate(), active: true, notes: '' }
  const [d, setD] = useState(empty)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftId, setDraftId] = useState('')
  const { markDirty } = useFormDirty(open, 'Birim maliyet formu')

  useEffect(() => {
    if (!open) return
    setErrors({})
    setError(null)
    setDraftId(crypto.randomUUID())
    setD(
      rate
        ? { code: rate.code, name: rate.name, group: rate.cost_group, unit: rate.unit, currency: rate.currency, cost: centsToInput(toCents(rate.unit_cost)), category: rate.quantity_category ?? '', validFrom: rate.valid_from, active: rate.active, notes: rate.notes ?? '' }
        : empty,
    )
  }, [open, rate])

  const submit = async () => {
    const errs: Record<string, string> = {}
    const cost = parseAmount(d.cost)
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/.test(d.code.trim())) errs.code = 'Harf/rakam ile başlayan en fazla 40 karakter (. _ / - kullanılabilir).'
    if (!d.name.trim()) errs.name = 'Ad zorunludur.'
    if (cost == null || Number.isNaN(cost) || cost <= 0) errs.cost = 'Sıfırdan büyük birim maliyet girin (sistem fiyat varsaymaz).'
    if (!d.validFrom) errs.validFrom = 'Tarih zorunludur.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const input = { code: d.code.trim(), name: d.name.trim(), cost_group: d.group, unit: d.unit, currency: d.currency, unit_cost: cost!, quantity_category: d.category || null, valid_from: d.validFrom, active: d.active, notes: d.notes.trim() || null }
    setBusy(true)
    setError(null)
    try {
      const db = requireSupabase()
      if (rate) await updateCostRate(db, rate, input)
      else await createCostRate(db, { ...input, id: draftId })
      notify(rate ? 'Birim maliyet güncellendi.' : 'Birim maliyet eklendi.')
      onClose()
    } catch (e) {
      setError(e instanceof ConflictError ? 'Kayıt başka bir cihazda değişti; kapatıp yeniden açın.' : finErrorMessage(e, 'Birim maliyet kaydı'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title={rate ? 'Birim maliyeti düzenle' : 'Yeni birim maliyet'}
      description="Fiyat değiştiğinde aynı kodla yeni geçerlilik tarihli kayıt ekleyin; geçmiş korunur."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="cost-rate-form" disabled={busy} data-testid="cost-rate-form-submit">
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      {error && <FormAlert>{error}</FormAlert>}
      <form id="cost-rate-form" onChangeCapture={markDirty} onSubmit={(e) => (e.preventDefault(), void submit())} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Kod" required value={d.code} onChange={(e) => setD((x) => ({ ...x, code: e.target.value }))} error={errors.code} maxLength={40} data-testid="cr-code" />
        <TextField label="Ad" required value={d.name} onChange={(e) => setD((x) => ({ ...x, name: e.target.value }))} error={errors.name} maxLength={200} data-testid="cr-name" />
        <SelectField label="Maliyet grubu" value={d.group} onChange={(e) => setD((x) => ({ ...x, group: e.target.value as CostGroup }))} data-testid="cr-group">
          {COST_GROUPS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Birim" value={d.unit} onChange={(e) => setD((x) => ({ ...x, unit: e.target.value as FinUnit }))} data-testid="cr-unit">
          {FIN_UNITS.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </SelectField>
        <TextField label="Birim maliyet" required inputMode="decimal" value={d.cost} onChange={(e) => setD((x) => ({ ...x, cost: e.target.value }))} error={errors.cost} data-testid="cr-cost" />
        <SelectField label="Para birimi" value={d.currency} onChange={(e) => setD((x) => ({ ...x, currency: e.target.value as Currency }))}>
          {CURRENCIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Metraj iş grubu (otomatik öneri)" value={d.category} onChange={(e) => setD((x) => ({ ...x, category: e.target.value }))} hint="Seçilirse onaylı metrajdan aktarımda bu iş grubuna önerilir." data-testid="cr-category">
          <option value="">Eşleştirme yok</option>
          {QUANTITY_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </SelectField>
        <TextField label="Geçerlilik başlangıcı" type="date" required value={d.validFrom} onChange={(e) => setD((x) => ({ ...x, validFrom: e.target.value }))} error={errors.validFrom} />
        <label className="flex items-center gap-2 text-sm text-ink-2 sm:col-span-2">
          <input type="checkbox" checked={d.active} onChange={(e) => setD((x) => ({ ...x, active: e.target.checked }))} className="h-4 w-4 accent-[var(--color-titanium,#8a9099)]" />
          Aktif (önerilerde kullanılır)
        </label>
        <TextAreaField label="Not" value={d.notes} onChange={(e) => setD((x) => ({ ...x, notes: e.target.value }))} className="sm:col-span-2" maxLength={2000} />
      </form>
    </Modal>
  )
}

export function CostRatesPanel() {
  const { notify } = useToast()
  const refs = useFinanceRefs()
  const [form, setForm] = useState<{ open: boolean; rate: CostRate | null }>({ open: false, rate: null })
  const [pending, setPending] = useState<CostRate | null>(null)
  const [busy, setBusy] = useState(false)
  const today = localISODate()
  return (
    <Panel
      title="Birim maliyetler"
      subtitle="Kendi alış/işçilik fiyatlarınız. Sistem fiyat uydurmaz; tanımsız işler “fiyat tanımlanmamış” görünür."
      icon={Tags}
      actions={
        <Button variant="secondary" icon={Plus} onClick={() => setForm({ open: true, rate: null })} data-testid="cost-rate-add">
          Birim maliyet ekle
        </Button>
      }
    >
      {refs.loading ? (
        <LoadingState />
      ) : refs.error ? (
        <ErrorState message={refs.error} onRetry={() => void refs.reload()} />
      ) : refs.rates.length === 0 ? (
        <p className="text-sm text-subtle">Katalog boş. Profil (mtül/kg), cam (m²), aksesuar (adet), işçilik/montaj (m², adet, saat) gibi birim maliyetlerinizi ekleyin.</p>
      ) : (
        <ul className="divide-y divide-line" data-testid="cost-rates">
          {refs.rates.map((r) => (
            <li key={r.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13px]', (!r.active || r.valid_from > today) && 'opacity-60')} data-testid="cost-rate-row">
              <span className="font-mono text-[12px] text-subtle">{r.code}</span>
              <div className="min-w-0 flex-1 basis-48">
                <div className="font-medium text-ink">{r.name}</div>
                <div className="text-[11.5px] text-muted">
                  {COST_GROUP_LABEL[r.cost_group]} · {r.quantity_category ? (CATEGORY_INFO[r.quantity_category as keyof typeof CATEGORY_INFO]?.label ?? r.quantity_category) : 'eşleştirme yok'} · {formatDate(r.valid_from)}’den itibaren
                  {!r.active && ' · pasif'}
                </div>
              </div>
              <span className="ml-auto font-mono font-semibold text-ink">
                {formatMoney(toCents(r.unit_cost), r.currency)}/{FIN_UNIT_LABEL[r.unit]}
              </span>
              <div className="flex gap-0.5">
                <button type="button" onClick={() => setForm({ open: true, rate: r })} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-ink" aria-label={`${r.code} düzenle`}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => setPending(r)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger" aria-label={`${r.code} sil`}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <CostRateForm open={form.open} onClose={() => setForm({ open: false, rate: null })} rate={form.rate} />
      <ConfirmDialog
        open={!!pending}
        title="Birim maliyet silinsin mi?"
        message={pending ? `${pending.code} · ${pending.name} silinecek. Bu fiyatla oluşturulmuş maliyet satırları korunur (bağlantısı kalkar).` : ''}
        busy={busy}
        onConfirm={async () => {
          if (!pending) return
          setBusy(true)
          try {
            await deleteCostRate(requireSupabase(), pending.id)
            notify('Birim maliyet silindi.')
            setPending(null)
          } catch (e) {
            notify(finErrorMessage(e, 'Silme'), 'error')
          } finally {
            setBusy(false)
          }
        }}
        onClose={() => setPending(null)}
      />
    </Panel>
  )
}

// ================================================================== Kurlar
export function FxRatesPanel() {
  const { notify } = useToast()
  const { projects } = useData()
  const refs = useFinanceRefs()
  const [d, setD] = useState({ date: localISODate(), from: 'EUR' as Currency, to: 'TRY' as Currency, rate: '', projectId: '', source: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [draftId, setDraftId] = useState(() => crypto.randomUUID())

  const submit = async () => {
    const errs: Record<string, string> = {}
    const rate = parseRateInput(d.rate)
    if (!d.date) errs.date = 'Tarih zorunludur.'
    if (d.from === d.to) errs.to = 'Farklı para birimi seçin.'
    if (rate == null) errs.rate = 'Geçerli bir kur girin (ör. 34,5123).'
    if (!d.source.trim()) errs.source = 'Kaynağı yazın (ör. TCMB döviz satış, elle girildi).'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setError(null)
    try {
      await createFxRate(requireSupabase(), { id: draftId, rate_date: d.date, from_currency: d.from, to_currency: d.to, rate: rate!, project_id: d.projectId || null, source: d.source.trim().slice(0, 200) })
      notify('Kur kaydedildi.')
      setD((x) => ({ ...x, rate: '' }))
      setDraftId(crypto.randomUUID())
    } catch (e) {
      setError(finErrorMessage(e, 'Kur kaydı'))
    } finally {
      setBusy(false)
    }
  }

  const projectName = (id: string | null) => (id ? (projects.find((p) => p.id === id)?.code ?? 'Proje') : 'Genel')
  return (
    <Panel title="Kurlar" subtitle="Yalnız burada girdiğiniz kurlarla çevrim yapılır; kur yoksa tutarlar para birimi bazında kalır." icon={ArrowRightLeft}>
      {error && <FormAlert>{error}</FormAlert>}
      <form onSubmit={(e) => (e.preventDefault(), void submit())} noValidate className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="fx-form">
        <TextField label="Tarih" type="date" value={d.date} onChange={(e) => setD((x) => ({ ...x, date: e.target.value }))} error={errors.date} data-testid="fx-date" />
        <SelectField label="Kaynak birim" value={d.from} onChange={(e) => setD((x) => ({ ...x, from: e.target.value as Currency }))} data-testid="fx-from">
          {CURRENCIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.value}
            </option>
          ))}
        </SelectField>
        <SelectField label="Hedef birim" value={d.to} onChange={(e) => setD((x) => ({ ...x, to: e.target.value as Currency }))} error={errors.to} data-testid="fx-to">
          {CURRENCIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.value}
            </option>
          ))}
        </SelectField>
        <TextField label={`1 ${d.from} = ? ${d.to}`} inputMode="decimal" value={d.rate} onChange={(e) => setD((x) => ({ ...x, rate: e.target.value }))} error={errors.rate} data-testid="fx-rate" />
        <SelectField label="Kapsam" value={d.projectId} onChange={(e) => setD((x) => ({ ...x, projectId: e.target.value }))} data-testid="fx-project">
          <option value="">Genel (tüm projeler)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </SelectField>
        <TextField label="Kaynak" value={d.source} onChange={(e) => setD((x) => ({ ...x, source: e.target.value }))} error={errors.source} placeholder="TCMB döviz satış, elle" maxLength={200} data-testid="fx-source" />
        <div className="col-span-2 sm:col-span-3 lg:col-span-6">
          <Button variant="primary" type="submit" icon={Plus} disabled={busy} data-testid="fx-submit">
            {busy ? 'Kaydediliyor…' : 'Kuru kaydet'}
          </Button>
        </div>
      </form>
      <div className="mt-5 border-t border-line pt-3">
        {refs.loading ? (
          <LoadingState />
        ) : refs.fx.length === 0 ? (
          <p className="text-sm text-subtle">Henüz kur girilmedi.</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="fx-list">
            {refs.fx.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]" data-testid="fx-row">
                <span className="font-mono text-ink">
                  1 {r.from_currency} = {formatRate(r.rate)} {r.to_currency}
                </span>
                <span className="text-muted">{formatDate(r.rate_date)}</span>
                <span className="rounded border border-line px-1.5 text-[11px] text-ink-2">{projectName(r.project_id)}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-subtle">{r.source}</span>
                <button type="button" onClick={() => setPending(r.id)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger" aria-label={`${r.from_currency}/${r.to_currency} ${r.rate_date} kurunu sil`}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={!!pending}
        title="Kur silinsin mi?"
        message="Bu kur silinirse, onu kullanan tutarlar bir önceki geçerli kurla veya (yoksa) para birimi bazında gösterilir."
        busy={busy}
        onConfirm={async () => {
          if (!pending) return
          setBusy(true)
          try {
            await deleteFxRate(requireSupabase(), pending)
            notify('Kur silindi.')
            setPending(null)
          } catch (e) {
            notify(finErrorMessage(e, 'Silme'), 'error')
          } finally {
            setBusy(false)
          }
        }}
        onClose={() => setPending(null)}
      />
    </Panel>
  )
}
