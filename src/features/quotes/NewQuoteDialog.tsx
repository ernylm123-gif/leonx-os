import { type FormEvent, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { FormAlert, SelectField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { createQuote } from '@/data/quoteApi'
import { dataErrorMessage } from '@/lib/errors'
import { addDays, localISODate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useFormDirty } from '@/lib/unsaved'
import { useResetOnOpen } from '@/lib/useResetOnOpen'
import { CURRENCIES, type Currency, type PricingMode, type QuoteInput } from '@/quote/types'
import { useQuoteSettings } from './shared'

interface Props {
  open: boolean
  onClose: () => void
  defaultCompanyId?: string
  defaultProjectId?: string
}

/** Yeni teklif: müşteri ve (isteğe bağlı) proje seçilir; numara sunucuda atanır, ardından teklif ekranı açılır. */
export function NewQuoteDialog({ open, onClose, defaultCompanyId, defaultProjectId }: Props) {
  const { companies, projects } = useData()
  const { values: settings } = useQuoteSettings()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [companyId, setCompanyId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [currency, setCurrency] = useState<Currency>('TRY')
  const [mode, setMode] = useState<PricingMode>('detayli')
  const [date, setDate] = useState(localISODate())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { markDirty } = useFormDirty(open, 'Yeni teklif formu')

  // Açılışta formu render sırasında sıfırla (effect ile sıfırlamak, açılır açılmaz yazılanları/hataları ezebilir)
  useResetOnOpen(open, () => {
    const p = defaultProjectId ? projects.find((x) => x.id === defaultProjectId) : undefined
    setProjectId(p?.id ?? '')
    setCompanyId(p?.company_id ?? defaultCompanyId ?? '')
    setTitle(p ? p.name : '')
    setCurrency(settings.default_currency)
    setMode('detayli')
    setDate(localISODate())
    setErrors({})
    setFormError(null)
  })

  const companyProjects = useMemo(() => projects.filter((p) => !companyId || p.company_id === companyId || p.id === projectId), [projects, companyId, projectId])
  const sortedCompanies = useMemo(() => [...companies].sort((a, b) => a.name.localeCompare(b.name, 'tr')), [companies])

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const errs: Record<string, string> = {}
    if (!companyId) errs.company = 'Müşteri (firma) seçin.'
    if (!title.trim()) errs.title = 'Teklif başlığı zorunludur.'
    else if (title.trim().length > 200) errs.title = 'En fazla 200 karakter.'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errs.date = 'Geçerli bir tarih girin.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setFormError(null)
    try {
      const input: QuoteInput = {
        company_id: companyId,
        contact_id: null,
        project_id: projectId || null,
        title: title.trim(),
        scope: null,
        quote_date: date,
        valid_until: addDays(date, settings.default_validity_days),
        currency,
        pricing_mode: mode,
        lump_sum: null,
        lump_cost: null,
        waste_pct: 0,
        overhead_pct: 0,
        profit_pct: 0,
        shipping_amount: 0,
        other_amount: 0,
        other_label: null,
        discount_kind: 'yok',
        discount_value: 0,
        vat_pct: settings.default_vat_pct,
        hide_unit_prices: false,
        payment_terms: settings.default_payment_terms,
        delivery_terms: settings.default_delivery_terms,
        notes: null,
        internal_notes: null,
      }
      const q = await createQuote(requireSupabase(), input)
      notify(`${q.quote_no} oluşturuldu.`)
      onClose()
      navigate(`/teklifler/${q.id}`)
    } catch (err) {
      setFormError(dataErrorMessage(err, 'Teklif oluşturma'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title="Yeni teklif"
      description="Teklif numarası kayıtta otomatik verilir. Kalemleri ve fiyatları sonraki adımda eklersiniz."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy} data-testid="quote-create">
            {busy ? 'Oluşturuluyor…' : 'Teklifi oluştur'}
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} onChangeCapture={markDirty} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        {formError && (
          <div className="sm:col-span-2">
            <FormAlert>{formError}</FormAlert>
          </div>
        )}
        <SelectField
          label="Müşteri (firma)"
          required
          value={companyId}
          error={errors.company}
          onChange={(e) => {
            setCompanyId(e.target.value)
            const p = projects.find((x) => x.id === projectId)
            if (p && p.company_id !== e.target.value) setProjectId('')
          }}
          hint={companies.length === 0 ? 'Önce Firmalar ekranından müşteri ekleyin.' : undefined}
        >
          <option value="">Seçin…</option>
          {sortedCompanies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Proje"
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value)
            const p = projects.find((x) => x.id === e.target.value)
            if (p) {
              if (p.company_id) setCompanyId(p.company_id)
              if (!title.trim()) setTitle(p.name)
            }
          }}
          hint="İsteğe bağlı; sonradan da bağlanabilir."
        >
          <option value="">Projesiz teklif</option>
          {companyProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </SelectField>
        <TextField label="Teklif başlığı" required value={title} error={errors.title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="sm:col-span-2" placeholder="Ör. Ofis binası alüminyum doğrama" />
        <TextField label="Teklif tarihi" type="date" required value={date} error={errors.date} onChange={(e) => setDate(e.target.value)} hint={`Geçerlilik: ${settings.default_validity_days} gün (değiştirilebilir)`} />
        <SelectField label="Para birimi" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
          {CURRENCIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </SelectField>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Fiyatlandırma</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              [
                ['detayli', 'Detaylı', 'Her kalemin maliyeti ve satış fiyatı ayrı hesaplanır'],
                ['toplam', 'Toplam bedel', 'Kalemler listelenir, yalnızca toplam bedel girilir'],
              ] as const
            ).map(([v, l, d]) => (
              <label key={v} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-3 ${mode === v ? 'border-titanium bg-surface-2' : 'border-line'}`}>
                <input type="radio" name="pricing" className="mt-1" checked={mode === v} onChange={() => setMode(v)} />
                <span>
                  <span className="block text-sm font-semibold text-ink">{l}</span>
                  <span className="block text-[12px] text-muted">{d}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
