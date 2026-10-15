import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormAlert, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/context/toast'
import { ConflictError } from '@/data/api'
import {
  createCollection,
  createCostLines,
  createExpense,
  createScheduleRow,
  saveBudget,
  updateCollection,
  updateCostLine,
  updateExpense,
  updateScheduleRow,
} from '@/data/financeApi'
import { listQuoteItems, listQuotesBy } from '@/data/quoteApi'
import { currentRates } from '@/finance/fromTakeoff'
import { parseRateInput } from '@/finance/fx'
import {
  type Collection,
  COST_GROUPS,
  type CostGroup,
  type CostLine,
  type CostRate,
  type Expense,
  FIN_UNIT_LABEL,
  FIN_UNITS,
  type FinUnit,
  type PaymentMethod,
  PAYMENT_METHODS,
  type PaymentScheduleRow,
  type ProjectBudget,
  SCHEDULE_KIND_LABEL,
  SCHEDULE_KINDS,
  type ScheduleKind,
} from '@/finance/types'
import { formatDate, localISODate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useFormDirty } from '@/lib/unsaved'
import { computeQuote } from '@/quote/engine'
import { formatMoney, toCents } from '@/quote/money'
import { CURRENCIES, type Currency, type Quote } from '@/quote/types'
import { centsToInput, finErrorMessage, numToInput, parseAmount, parseNumber } from './shared'

type Errors = Record<string, string>

/** Ortak form kabuğu: kaydetme, hata, kaydedilmemiş değişiklik uyarısı */
function FormModal({
  open,
  onClose,
  title,
  formId,
  busy,
  error,
  submitLabel,
  onSubmit,
  children,
  size,
  description,
}: {
  open: boolean
  onClose: () => void
  title: string
  formId: string
  busy: boolean
  error: string | null
  submitLabel: string
  onSubmit: () => void
  children: ReactNode
  size?: 'md' | 'lg'
  description?: string
}) {
  const { markDirty } = useFormDirty(open, title)
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={busy} data-testid={`${formId}-submit`}>
            {busy ? 'Kaydediliyor…' : submitLabel}
          </Button>
        </>
      }
    >
      {error && <FormAlert>{error}</FormAlert>}
      <form
        id={formId}
        onChangeCapture={markDirty}
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          onSubmit()
        }}
        noValidate
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        {children}
      </form>
    </Modal>
  )
}

function useSave<T>(onClose: () => void, onSaved: ((x: T) => void) | undefined, context: string) {
  const { notify } = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<T>, message: string) => {
    setBusy(true)
    setError(null)
    try {
      const saved = await fn()
      notify(message)
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setError(err instanceof ConflictError ? 'Kayıt başka bir cihazda değiştirildi veya silindi. Kapatıp yeniden açın.' : finErrorMessage(err, context))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

function CurrencyField({ value, onChange, label = 'Para birimi', testId }: { value: Currency; onChange: (c: Currency) => void; label?: string; testId?: string }) {
  return (
    <SelectField label={label} value={value} onChange={(e) => onChange(e.target.value as Currency)} data-testid={testId}>
      {CURRENCIES.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </SelectField>
  )
}

function GroupField({ value, onChange, testId }: { value: CostGroup; onChange: (g: CostGroup) => void; testId?: string }) {
  return (
    <SelectField label="Maliyet grubu" value={value} onChange={(e) => onChange(e.target.value as CostGroup)} data-testid={testId}>
      {COST_GROUPS.map((g) => (
        <option key={g.value} value={g.value}>
          {g.label}
        </option>
      ))}
    </SelectField>
  )
}

// ================================================================== Bütçe
export function BudgetForm({ open, onClose, projectId, budget, onSaved }: { open: boolean; onClose: () => void; projectId: string; budget: ProjectBudget | null; onSaved?: (b: ProjectBudget) => void }) {
  const [d, setD] = useState({ currency: 'TRY' as Currency, sale: '', vat: '20', waste: '0', overhead: '0', notes: '', quoteId: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [quotes, setQuotes] = useState<{ q: Quote; net: number }[]>([])
  const [quotesLoading, setQuotesLoading] = useState(false)
  const s = useSave<ProjectBudget>(onClose, onSaved, 'Bütçe kaydı')

  useEffect(() => {
    if (!open) return
    setErrors({})
    s.setError(null)
    setD({
      currency: budget?.currency ?? 'TRY',
      sale: centsToInput(budget?.sale_net_amount != null ? toCents(budget.sale_net_amount) : null),
      vat: numToInput(budget?.vat_pct ?? 20),
      waste: numToInput(budget?.waste_pct ?? 0),
      overhead: numToInput(budget?.overhead_pct ?? 0),
      notes: budget?.notes ?? '',
      quoteId: budget?.source_quote_id ?? '',
    })
    // Yalnız kabul edilmiş güncel teklifler bağlanabilir (veritabanı da denetler)
    let alive = true
    setQuotesLoading(true)
    void (async () => {
      try {
        const db = requireSupabase()
        const list = (await listQuotesBy(db, 'project_id', projectId)).filter((q) => q.status === 'kabul' && !q.superseded)
        const withNet = await Promise.all(list.map(async (q) => ({ q, net: computeQuote(q, await listQuoteItems(db, q.id)).net })))
        if (alive) setQuotes(withNet)
      } catch {
        if (alive) setQuotes([])
      } finally {
        if (alive) setQuotesLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [open, budget, projectId])

  const linked = quotes.find((x) => x.q.id === d.quoteId)

  const submit = () => {
    const errs: Errors = {}
    const sale = parseAmount(d.sale)
    const vat = parseNumber(d.vat)
    const waste = parseNumber(d.waste)
    const overhead = parseNumber(d.overhead)
    if (Number.isNaN(sale)) errs.sale = 'Geçerli bir tutar girin.'
    if (vat == null || Number.isNaN(vat) || vat > 100) errs.vat = '0–100 arası.'
    if (waste == null || Number.isNaN(waste) || waste > 100) errs.waste = '0–100 arası.'
    if (overhead == null || Number.isNaN(overhead) || overhead > 500) errs.overhead = '0–500 arası.'
    if (linked && linked.q.currency !== d.currency) errs.quoteId = `Teklif ${linked.q.currency} cinsinden; ana para birimi aynı olmalı.`
    setErrors(errs)
    if (Object.keys(errs).length) return
    const keepSnapshot = budget && budget.source_quote_id === (d.quoteId || null)
    const input = {
      project_id: projectId,
      currency: d.currency,
      sale_net_amount: sale,
      vat_pct: vat!,
      waste_pct: waste!,
      overhead_pct: overhead!,
      notes: d.notes.trim() || null,
      source_quote_id: d.quoteId || null,
      quote_snapshot_net: keepSnapshot ? budget.quote_snapshot_net : linked ? linked.net / 100 : null,
      quote_snapshot_currency: keepSnapshot ? budget.quote_snapshot_currency : linked ? linked.q.currency : null,
      quote_snapshot_vat_pct: keepSnapshot ? budget.quote_snapshot_vat_pct : linked ? linked.q.vat_pct : null,
      quote_snapshot_label: keepSnapshot ? budget.quote_snapshot_label : linked ? `${linked.q.quote_no} Rev ${linked.q.revision} · ${linked.q.title}`.slice(0, 200) : null,
      quote_snapshot_at: keepSnapshot ? budget.quote_snapshot_at : linked ? new Date().toISOString() : null,
    }
    void s.run(() => saveBudget(requireSupabase(), input, budget), 'Bütçe kaydedildi.')
  }

  return (
    <FormModal open={open} onClose={onClose} title="Proje bütçesi" description="Tutarlar KDV hariç girilir; kâr KDV hariç hesaplanır." formId="budget-form" busy={s.busy} error={s.error} submitLabel="Kaydet" onSubmit={submit}>
      <CurrencyField label="Ana para birimi" value={d.currency} onChange={(currency) => setD((x) => ({ ...x, currency }))} testId="budget-currency" />
      <TextField label="KDV oranı (%)" inputMode="decimal" value={d.vat} onChange={(e) => setD((x) => ({ ...x, vat: e.target.value }))} error={errors.vat} />
      <SelectField
        label="Kabul edilmiş teklif"
        value={d.quoteId}
        onChange={(e) => setD((x) => ({ ...x, quoteId: e.target.value }))}
        error={errors.quoteId}
        hint={quotesLoading ? 'Teklifler yükleniyor…' : quotes.length === 0 ? 'Bu projede kabul edilmiş teklif yok.' : 'Teklif tutarı bağlandığı anda saklanır; teklif değişirse uyarı gösterilir.'}
        className="sm:col-span-2"
        data-testid="budget-quote"
      >
        <option value="">Bağlı değil</option>
        {quotes.map(({ q, net }) => (
          <option key={q.id} value={q.id}>
            {q.quote_no} Rev {q.revision} · {q.title} · {formatMoney(net, q.currency)} (KDV hariç)
          </option>
        ))}
      </SelectField>
      {linked && (
        <div className="-mt-2 sm:col-span-2">
          <Button
            variant="secondary"
            className="h-9 text-xs"
            onClick={() => setD((x) => ({ ...x, sale: centsToInput(linked.net), vat: numToInput(linked.q.vat_pct), currency: linked.q.currency }))}
            data-testid="budget-use-quote"
          >
            Teklif tutarını satış bedeli yap ({formatMoney(linked.net, linked.q.currency)})
          </Button>
        </div>
      )}
      <TextField
        label="Satış bedeli (KDV hariç)"
        inputMode="decimal"
        value={d.sale}
        onChange={(e) => setD((x) => ({ ...x, sale: e.target.value }))}
        error={errors.sale}
        hint="Bilinmiyorsa boş bırakın; tahmini kâr hesaplanmaz."
        className="sm:col-span-2"
        data-testid="budget-sale"
      />
      <TextField label="Fire oranı (%)" inputMode="decimal" value={d.waste} onChange={(e) => setD((x) => ({ ...x, waste: e.target.value }))} error={errors.waste} hint="Yalnız profil, PVC sistem, cam ve aksesuara uygulanır." />
      <TextField label="Genel gider oranı (%)" inputMode="decimal" value={d.overhead} onChange={(e) => setD((x) => ({ ...x, overhead: e.target.value }))} error={errors.overhead} hint="Doğrudan maliyet + fire toplamına uygulanır." />
      <TextAreaField label="Not" value={d.notes} onChange={(e) => setD((x) => ({ ...x, notes: e.target.value }))} className="sm:col-span-2" maxLength={5000} />
    </FormModal>
  )
}

// ================================================================== Tahmini maliyet satırı
export function CostLineForm({
  open,
  onClose,
  projectId,
  line,
  rates,
  defaultCurrency,
  nextSort,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  line: CostLine | null
  rates: CostRate[]
  defaultCurrency: Currency
  nextSort: number
  onSaved?: (l: CostLine) => void
}) {
  const [d, setD] = useState({ rateId: '', group: 'profil' as CostGroup, description: '', quantity: '', unit: 'm2' as FinUnit, cost: '', currency: defaultCurrency, notes: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [draftId, setDraftId] = useState('')
  const s = useSave<CostLine>(onClose, onSaved, 'Maliyet satırı')
  const catalog = useMemo(() => currentRates(rates, localISODate()), [rates])

  useEffect(() => {
    if (!open) return
    setErrors({})
    s.setError(null)
    setDraftId(crypto.randomUUID())
    setD(
      line
        ? { rateId: line.cost_rate_id ?? '', group: line.cost_group, description: line.description, quantity: numToInput(line.quantity), unit: line.unit, cost: line.unit_cost == null ? '' : centsToInput(toCents(line.unit_cost)), currency: line.currency, notes: line.notes ?? '' }
        : { rateId: '', group: 'profil', description: '', quantity: '', unit: 'm2', cost: '', currency: defaultCurrency, notes: '' },
    )
  }, [open, line, defaultCurrency])

  const pickRate = (id: string) => {
    const r = catalog.find((x) => x.id === id)
    setD((x) => (r ? { ...x, rateId: id, group: r.cost_group, unit: r.unit, cost: centsToInput(toCents(r.unit_cost)), currency: r.currency, description: x.description || r.name } : { ...x, rateId: '' }))
  }

  const submit = () => {
    const errs: Errors = {}
    const quantity = parseNumber(d.quantity)
    const cost = parseAmount(d.cost)
    if (!d.description.trim()) errs.description = 'Açıklama zorunludur.'
    if (quantity == null || Number.isNaN(quantity) || quantity <= 0) errs.quantity = 'Sıfırdan büyük miktar girin.'
    if (Number.isNaN(cost)) errs.cost = 'Geçerli bir tutar girin veya boş bırakın.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const input = {
      cost_group: d.group,
      description: d.description.trim().slice(0, 500),
      quantity: quantity!,
      unit: d.unit,
      unit_cost: cost,
      currency: d.currency,
      cost_rate_id: d.rateId || null,
      notes: d.notes.trim() || null,
    }
    const db = requireSupabase()
    void s.run(
      async () =>
        line
          ? updateCostLine(db, line, input)
          : (await createCostLines(db, [{ ...input, id: draftId, project_id: projectId, sort_order: nextSort, source: 'elle', source_takeoff_id: null, source_item_id: null, measure_basis: null }]))[0],
      line ? 'Maliyet satırı güncellendi.' : 'Maliyet satırı eklendi.',
    )
  }

  return (
    <FormModal open={open} onClose={onClose} title={line ? 'Maliyet satırını düzenle' : 'Tahmini maliyet satırı'} formId="cost-line-form" busy={s.busy} error={s.error} submitLabel={line ? 'Kaydet' : 'Satırı ekle'} onSubmit={submit}>
      {line?.source === 'metraj' && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted sm:col-span-2">Bu satır onaylı metrajdan aktarıldı; metraj bağlantısı korunur.</p>
      )}
      <SelectField label="Birim maliyet kataloğundan" value={d.rateId} onChange={(e) => pickRate(e.target.value)} className="sm:col-span-2" hint={catalog.length === 0 ? 'Katalog boş: Finans → Birim maliyetler bölümünden ekleyebilirsiniz.' : undefined} data-testid="cl-rate">
        <option value="">Elle gir</option>
        {catalog.map((r) => (
          <option key={r.id} value={r.id}>
            {r.code} · {r.name} · {formatMoney(toCents(r.unit_cost), r.currency)}/{FIN_UNIT_LABEL[r.unit]}
          </option>
        ))}
      </SelectField>
      <GroupField value={d.group} onChange={(group) => setD((x) => ({ ...x, group }))} testId="cl-group" />
      <TextField label="Açıklama" required value={d.description} onChange={(e) => setD((x) => ({ ...x, description: e.target.value }))} error={errors.description} maxLength={500} data-testid="cl-description" />
      <TextField label="Miktar" required inputMode="decimal" value={d.quantity} onChange={(e) => setD((x) => ({ ...x, quantity: e.target.value }))} error={errors.quantity} data-testid="cl-quantity" />
      <SelectField label="Birim" value={d.unit} onChange={(e) => setD((x) => ({ ...x, unit: e.target.value as FinUnit }))}>
        {FIN_UNITS.map((u) => (
          <option key={u.value} value={u.value}>
            {u.label}
          </option>
        ))}
      </SelectField>
      <TextField
        label="Birim maliyet"
        inputMode="decimal"
        value={d.cost}
        onChange={(e) => setD((x) => ({ ...x, cost: e.target.value }))}
        error={errors.cost}
        hint="Boş bırakılırsa “fiyat tanımlanmamış” olarak kaydedilir ve toplamlara katılmaz."
        data-testid="cl-cost"
      />
      <CurrencyField value={d.currency} onChange={(currency) => setD((x) => ({ ...x, currency }))} testId="cl-currency" />
      <TextAreaField label="Not" value={d.notes} onChange={(e) => setD((x) => ({ ...x, notes: e.target.value }))} className="sm:col-span-2" maxLength={2000} />
    </FormModal>
  )
}

// ================================================================== Gerçekleşen gider
export function ExpenseForm({ open, onClose, projectId, expense, base, onSaved }: { open: boolean; onClose: () => void; projectId: string; expense: Expense | null; base: Currency; onSaved?: (e: Expense) => void }) {
  const empty = { date: localISODate(), group: 'profil' as CostGroup, description: '', supplier: '', amount: '', vat: '', currency: base, fx: '', doc: '', paid: true, notes: '' }
  const [d, setD] = useState(empty)
  const [errors, setErrors] = useState<Errors>({})
  const [draftId, setDraftId] = useState('')
  const s = useSave<Expense>(onClose, onSaved, 'Gider kaydı')

  useEffect(() => {
    if (!open) return
    setErrors({})
    s.setError(null)
    setDraftId(crypto.randomUUID())
    setD(
      expense
        ? {
            date: expense.expense_date,
            group: expense.cost_group,
            description: expense.description,
            supplier: expense.supplier ?? '',
            amount: centsToInput(toCents(expense.amount)),
            vat: centsToInput(toCents(expense.vat_amount)),
            currency: expense.currency,
            fx: expense.fx_rate_to_base != null ? String(expense.fx_rate_to_base).replace('.', ',') : '',
            doc: expense.document_no ?? '',
            paid: expense.paid,
            notes: expense.notes ?? '',
          }
        : { ...empty, currency: base },
    )
  }, [open, expense, base])

  const submit = () => {
    const errs: Errors = {}
    const amount = parseAmount(d.amount)
    const vat = parseAmount(d.vat)
    const fx = d.currency !== base && d.fx.trim() ? parseRateInput(d.fx) : null
    if (!d.date) errs.date = 'Tarih zorunludur.'
    if (!d.description.trim()) errs.description = 'Açıklama zorunludur.'
    if (amount == null || Number.isNaN(amount) || amount <= 0) errs.amount = 'Sıfırdan büyük tutar girin.'
    if (Number.isNaN(vat)) errs.vat = 'Geçerli bir tutar girin.'
    if (d.currency !== base && d.fx.trim() && fx == null) errs.fx = 'Geçerli bir kur girin (ör. 34,5).'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const input = {
      expense_date: d.date,
      cost_group: d.group,
      description: d.description.trim().slice(0, 500),
      supplier: d.supplier.trim() || null,
      amount: amount!,
      vat_amount: vat ?? 0,
      currency: d.currency,
      fx_rate_to_base: fx,
      fx_to_currency: fx != null ? base : null,
      document_no: d.doc.trim() || null,
      paid: d.paid,
      notes: d.notes.trim() || null,
    }
    const db = requireSupabase()
    void s.run(() => (expense ? updateExpense(db, expense, input) : createExpense(db, { ...input, id: draftId, project_id: projectId })), expense ? 'Gider güncellendi.' : 'Gider kaydedildi.')
  }

  const amountNum = parseAmount(d.amount)
  return (
    <FormModal open={open} onClose={onClose} title={expense ? 'Gideri düzenle' : 'Gerçekleşen gider'} description="Tutar KDV hariç; KDV ayrı girilir." formId="expense-form" busy={s.busy} error={s.error} submitLabel={expense ? 'Kaydet' : 'Gideri kaydet'} onSubmit={submit}>
      <TextField label="Tarih" type="date" required value={d.date} onChange={(e) => setD((x) => ({ ...x, date: e.target.value }))} error={errors.date} data-testid="ex-date" />
      <GroupField value={d.group} onChange={(group) => setD((x) => ({ ...x, group }))} testId="ex-group" />
      <TextField label="Açıklama" required value={d.description} onChange={(e) => setD((x) => ({ ...x, description: e.target.value }))} error={errors.description} maxLength={500} className="sm:col-span-2" data-testid="ex-description" />
      <TextField label="Tedarikçi" value={d.supplier} onChange={(e) => setD((x) => ({ ...x, supplier: e.target.value }))} maxLength={200} />
      <TextField label="Belge / fatura no" value={d.doc} onChange={(e) => setD((x) => ({ ...x, doc: e.target.value }))} maxLength={80} />
      <TextField label="Tutar (KDV hariç)" required inputMode="decimal" value={d.amount} onChange={(e) => setD((x) => ({ ...x, amount: e.target.value }))} error={errors.amount} data-testid="ex-amount" />
      <div className="min-w-0">
        <TextField label="KDV tutarı" inputMode="decimal" value={d.vat} onChange={(e) => setD((x) => ({ ...x, vat: e.target.value }))} error={errors.vat} data-testid="ex-vat" />
        <div className="mt-1.5 flex gap-1.5">
          {[20, 10, 1].map((p) => (
            <button
              key={p}
              type="button"
              disabled={amountNum == null || Number.isNaN(amountNum)}
              onClick={() => amountNum != null && setD((x) => ({ ...x, vat: centsToInput(Math.round((toCents(amountNum) * p) / 100)) }))}
              className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2 hover:bg-surface-3 disabled:opacity-40"
            >
              %{p}
            </button>
          ))}
        </div>
      </div>
      <CurrencyField value={d.currency} onChange={(currency) => setD((x) => ({ ...x, currency }))} testId="ex-currency" />
      {d.currency !== base ? (
        <TextField
          label={`Faturadaki kur (${d.currency} → ${base})`}
          inputMode="decimal"
          value={d.fx}
          onChange={(e) => setD((x) => ({ ...x, fx: e.target.value }))}
          error={errors.fx}
          hint="İsteğe bağlı. Boşsa gider tarihindeki girilmiş kur kullanılır; o da yoksa toplamlara çevrilmez."
        />
      ) : (
        <div />
      )}
      <label className="flex items-center gap-2 text-sm text-ink-2 sm:col-span-2">
        <input type="checkbox" checked={d.paid} onChange={(e) => setD((x) => ({ ...x, paid: e.target.checked }))} className="h-4 w-4 accent-[var(--color-titanium,#8a9099)]" data-testid="ex-paid" />
        Ödendi (nakit akışına çıkış olarak yansır)
      </label>
      <TextAreaField label="Not" value={d.notes} onChange={(e) => setD((x) => ({ ...x, notes: e.target.value }))} className="sm:col-span-2" maxLength={2000} />
    </FormModal>
  )
}

// ================================================================== Ödeme planı (taksit)
export function ScheduleForm({ open, onClose, projectId, row, base, nextSort, onSaved }: { open: boolean; onClose: () => void; projectId: string; row: PaymentScheduleRow | null; base: Currency; nextSort: number; onSaved?: (r: PaymentScheduleRow) => void }) {
  const [d, setD] = useState({ kind: 'pesinat' as ScheduleKind, label: '', due: localISODate(), amount: '', currency: base, notes: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [draftId, setDraftId] = useState('')
  const s = useSave<PaymentScheduleRow>(onClose, onSaved, 'Ödeme planı')

  useEffect(() => {
    if (!open) return
    setErrors({})
    s.setError(null)
    setDraftId(crypto.randomUUID())
    setD(
      row
        ? { kind: row.kind, label: row.label ?? '', due: row.due_date, amount: centsToInput(toCents(row.amount)), currency: row.currency, notes: row.notes ?? '' }
        : { kind: nextSort === 0 ? 'pesinat' : 'ara_odeme', label: '', due: localISODate(), amount: '', currency: base, notes: '' },
    )
  }, [open, row, base])

  const submit = () => {
    const errs: Errors = {}
    const amount = parseAmount(d.amount)
    if (!d.due) errs.due = 'Vade tarihi zorunludur.'
    if (amount == null || Number.isNaN(amount) || amount <= 0) errs.amount = 'Sıfırdan büyük tutar girin.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const input = { kind: d.kind, label: d.label.trim() || null, due_date: d.due, amount: amount!, currency: d.currency, notes: d.notes.trim() || null }
    const db = requireSupabase()
    void s.run(() => (row ? updateScheduleRow(db, row, input) : createScheduleRow(db, { ...input, id: draftId, project_id: projectId, sort_order: nextSort })), row ? 'Taksit güncellendi.' : 'Taksit eklendi.')
  }

  return (
    <FormModal open={open} onClose={onClose} title={row ? 'Taksiti düzenle' : 'Ödeme planına ekle'} description="Müşteriden alınacak tutar (sözleşmeye göre KDV dahil olabilir)." formId="schedule-form" busy={s.busy} error={s.error} submitLabel={row ? 'Kaydet' : 'Ekle'} onSubmit={submit}>
      <SelectField label="Tür" value={d.kind} onChange={(e) => setD((x) => ({ ...x, kind: e.target.value as ScheduleKind }))} data-testid="sc-kind">
        {SCHEDULE_KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </SelectField>
      <TextField label="Açıklama" value={d.label} onChange={(e) => setD((x) => ({ ...x, label: e.target.value }))} placeholder={SCHEDULE_KIND_LABEL[d.kind]} maxLength={200} />
      <TextField label="Vade" type="date" required value={d.due} onChange={(e) => setD((x) => ({ ...x, due: e.target.value }))} error={errors.due} data-testid="sc-due" />
      <TextField label="Tutar" required inputMode="decimal" value={d.amount} onChange={(e) => setD((x) => ({ ...x, amount: e.target.value }))} error={errors.amount} data-testid="sc-amount" />
      <CurrencyField value={d.currency} onChange={(currency) => setD((x) => ({ ...x, currency }))} testId="sc-currency" />
      <TextAreaField label="Not" value={d.notes} onChange={(e) => setD((x) => ({ ...x, notes: e.target.value }))} className="sm:col-span-2" maxLength={2000} />
    </FormModal>
  )
}

// ================================================================== Tahsilat
export function CollectionForm({
  open,
  onClose,
  projectId,
  row,
  schedule,
  base,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  row: Collection | null
  schedule: PaymentScheduleRow[]
  base: Currency
  onSaved?: (c: Collection) => void
}) {
  const [d, setD] = useState({ date: localISODate(), amount: '', currency: base, method: 'havale' as PaymentMethod, scheduleId: '', reference: '', note: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [draftId, setDraftId] = useState('')
  const s = useSave<Collection>(onClose, onSaved, 'Tahsilat kaydı')

  useEffect(() => {
    if (!open) return
    setErrors({})
    s.setError(null)
    setDraftId(crypto.randomUUID())
    setD(
      row
        ? { date: row.received_date, amount: centsToInput(toCents(row.amount)), currency: row.currency, method: row.method, scheduleId: row.schedule_id ?? '', reference: row.reference ?? '', note: row.note ?? '' }
        : { date: localISODate(), amount: '', currency: base, method: 'havale', scheduleId: '', reference: '', note: '' },
    )
  }, [open, row, base])

  const options = schedule.filter((x) => x.currency === d.currency)
  const submit = () => {
    const errs: Errors = {}
    const amount = parseAmount(d.amount)
    if (!d.date) errs.date = 'Tarih zorunludur.'
    if (amount == null || Number.isNaN(amount) || amount <= 0) errs.amount = 'Sıfırdan büyük tutar girin.'
    if (d.scheduleId && !options.some((x) => x.id === d.scheduleId)) errs.scheduleId = 'Seçilen taksit farklı para biriminde.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const input = { received_date: d.date, amount: amount!, currency: d.currency, method: d.method, schedule_id: d.scheduleId || null, reference: d.reference.trim() || null, note: d.note.trim() || null }
    const db = requireSupabase()
    void s.run(() => (row ? updateCollection(db, row, input) : createCollection(db, { ...input, id: draftId, project_id: projectId })), row ? 'Tahsilat güncellendi.' : 'Tahsilat kaydedildi.')
  }

  return (
    <FormModal open={open} onClose={onClose} title={row ? 'Tahsilatı düzenle' : 'Tahsilat kaydı'} formId="collection-form" busy={s.busy} error={s.error} submitLabel={row ? 'Kaydet' : 'Tahsilatı kaydet'} onSubmit={submit}>
      <TextField label="Tahsil tarihi" type="date" required value={d.date} onChange={(e) => setD((x) => ({ ...x, date: e.target.value }))} error={errors.date} data-testid="co-date" />
      <TextField label="Tutar" required inputMode="decimal" value={d.amount} onChange={(e) => setD((x) => ({ ...x, amount: e.target.value }))} error={errors.amount} data-testid="co-amount" />
      <CurrencyField value={d.currency} onChange={(currency) => setD((x) => ({ ...x, currency, scheduleId: '' }))} testId="co-currency" />
      <SelectField label="Yöntem" value={d.method} onChange={(e) => setD((x) => ({ ...x, method: e.target.value as PaymentMethod }))}>
        {PAYMENT_METHODS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Taksit"
        value={d.scheduleId}
        onChange={(e) => setD((x) => ({ ...x, scheduleId: e.target.value }))}
        error={errors.scheduleId}
        hint="Seçilmezse en eski açık taksitten başlayarak dağıtılır."
        className="sm:col-span-2"
        data-testid="co-schedule"
      >
        <option value="">Otomatik (en eski açık taksit)</option>
        {options.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label || SCHEDULE_KIND_LABEL[x.kind]} · {formatDate(x.due_date)} · {formatMoney(toCents(x.amount), x.currency)}
          </option>
        ))}
      </SelectField>
      <TextField label="Referans (dekont / çek no)" value={d.reference} onChange={(e) => setD((x) => ({ ...x, reference: e.target.value }))} maxLength={120} className="sm:col-span-2" />
      <TextAreaField label="Not" value={d.note} onChange={(e) => setD((x) => ({ ...x, note: e.target.value }))} className="sm:col-span-2" maxLength={2000} />
    </FormModal>
  )
}

