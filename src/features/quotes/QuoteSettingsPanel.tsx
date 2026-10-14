import { FileCog } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormAlert, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Panel } from '@/components/ui/Panel'
import { useToast } from '@/context/toast'
import { ConflictError } from '@/data/api'
import { saveQuoteSettings } from '@/data/quoteApi'
import { dataErrorMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { useUnsavedChanges } from '@/lib/unsaved'
import { CURRENCIES, type Currency, type QuoteSettingsInput } from '@/quote/types'
import { numText, parseNum, useQuoteSettings } from './shared'

type Form = Record<Exclude<keyof QuoteSettingsInput, 'default_currency'>, string> & { default_currency: Currency }

const toForm = (s: QuoteSettingsInput): Form => ({
  legal_name: s.legal_name ?? '',
  address: s.address ?? '',
  phone: s.phone ?? '',
  email: s.email ?? '',
  website: s.website ?? '',
  tax_office: s.tax_office ?? '',
  tax_number: s.tax_number ?? '',
  bank_name: s.bank_name ?? '',
  iban: s.iban ?? '',
  quote_prefix: s.quote_prefix,
  default_validity_days: String(s.default_validity_days),
  default_vat_pct: numText(s.default_vat_pct),
  default_currency: s.default_currency,
  default_payment_terms: s.default_payment_terms ?? '',
  default_delivery_terms: s.default_delivery_terms ?? '',
  closing_text: s.closing_text ?? '',
})

/** Teklif çıktısındaki firma bilgileri ve yeni tekliflerin varsayılanları. Uydurma bilgi içermez; boş alanlar PDF'e yazılmaz. */
export function QuoteSettingsPanel() {
  const { settings, values } = useQuoteSettings()
  const { notify } = useToast()
  const [form, setForm] = useState<Form>(() => toForm(values))
  const [base, setBase] = useState<string>('')
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = !!base && JSON.stringify(form) !== base
  useUnsavedChanges(dirty, 'Teklif ayarları')

  useEffect(() => {
    if (dirty) return
    const f = toForm(values)
    setForm(f)
    setBase(JSON.stringify(f))
    // Yalnızca kayıt değiştiğinde (bu veya başka cihaz) yenilenir
  }, [settings?.version]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const errs: Partial<Record<keyof Form, string>> = {}
    const iban = form.iban.replace(/\s/g, '').toUpperCase()
    const tax = form.tax_number.trim()
    const prefix = form.quote_prefix.trim().toUpperCase()
    const days = Number(form.default_validity_days)
    const vat = parseNum(form.default_vat_pct)
    if (iban && !/^[A-Z]{2}[0-9A-Z]{13,32}$/.test(iban)) errs.iban = 'Geçerli bir IBAN girin (ör. TR00 0000 …).'
    if (tax && !/^[0-9]{10,11}$/.test(tax)) errs.tax_number = '10 veya 11 rakam.'
    if (!/^[A-Z0-9]{1,8}$/.test(prefix)) errs.quote_prefix = '1–8 büyük harf veya rakam (ör. TKL).'
    if (!Number.isInteger(days) || days < 1 || days > 365) errs.default_validity_days = '1–365 gün.'
    if (vat == null || Number.isNaN(vat) || vat < 0 || vat > 100) errs.default_vat_pct = '0–100 arası.'
    if (form.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) errs.email = 'Geçerli bir e-posta girin.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const t = (v: string) => v.trim() || null
    const input: QuoteSettingsInput = {
      legal_name: t(form.legal_name),
      address: t(form.address),
      phone: t(form.phone),
      email: t(form.email),
      website: t(form.website),
      tax_office: t(form.tax_office),
      tax_number: tax || null,
      bank_name: t(form.bank_name),
      iban: iban || null,
      quote_prefix: prefix,
      default_validity_days: days,
      default_vat_pct: vat!,
      default_currency: form.default_currency,
      default_payment_terms: t(form.default_payment_terms),
      default_delivery_terms: t(form.default_delivery_terms),
      closing_text: t(form.closing_text),
    }
    setBusy(true)
    setFormError(null)
    try {
      const saved = await saveQuoteSettings(requireSupabase(), input, settings)
      const f = toForm(saved)
      setForm(f)
      setBase(JSON.stringify(f))
      notify('Teklif ayarları kaydedildi.')
    } catch (err) {
      setFormError(err instanceof ConflictError ? 'Ayarlar başka bir cihazda değiştirildi. Sayfayı yenileyip tekrar deneyin.' : dataErrorMessage(err, 'Kaydetme'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Teklif ayarları" subtitle="PDF tekliflerde görünen firma bilgileri ve yeni tekliflerin varsayılanları" icon={FileCog} className="lg:col-span-2">
      <form onSubmit={submit} noValidate className="space-y-5" data-testid="quote-settings">
        {formError && <FormAlert>{formError}</FormAlert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextField label="Ticari unvan" value={form.legal_name} onChange={set('legal_name')} maxLength={200} placeholder="LEONX METAL" />
          <TextField label="Telefon" value={form.phone} onChange={set('phone')} maxLength={60} />
          <TextField label="E-posta" type="email" value={form.email} error={errors.email} onChange={set('email')} maxLength={254} />
          <TextField label="Adres" value={form.address} onChange={set('address')} maxLength={500} className="sm:col-span-2" />
          <TextField label="Web sitesi" value={form.website} onChange={set('website')} maxLength={200} placeholder="leonxmetal.com" />
          <TextField label="Vergi dairesi" value={form.tax_office} onChange={set('tax_office')} maxLength={120} />
          <TextField label="Vergi no" inputMode="numeric" value={form.tax_number} error={errors.tax_number} onChange={set('tax_number')} maxLength={11} />
          <TextField label="Banka" value={form.bank_name} onChange={set('bank_name')} maxLength={120} />
          <TextField label="IBAN" value={form.iban} error={errors.iban} onChange={set('iban')} maxLength={42} className="sm:col-span-2" />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <TextField label="Teklif no öneki" value={form.quote_prefix} error={errors.quote_prefix} onChange={set('quote_prefix')} maxLength={8} hint="Ör. TKL → TKL-2026-0001" data-testid="qs-prefix" />
          <TextField label="Geçerlilik (gün)" inputMode="numeric" value={form.default_validity_days} error={errors.default_validity_days} onChange={set('default_validity_days')} />
          <TextField label="Varsayılan KDV (%)" inputMode="decimal" value={form.default_vat_pct} error={errors.default_vat_pct} onChange={set('default_vat_pct')} data-testid="qs-vat" />
          <SelectField label="Varsayılan para birimi" value={form.default_currency} onChange={(e) => setForm((f) => ({ ...f, default_currency: e.target.value as Currency }))}>
            {CURRENCIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.value}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <TextAreaField label="Varsayılan ödeme şartları" value={form.default_payment_terms} onChange={set('default_payment_terms')} maxLength={2000} rows={3} />
          <TextAreaField label="Varsayılan teslim / montaj" value={form.default_delivery_terms} onChange={set('default_delivery_terms')} maxLength={2000} rows={3} />
          <TextAreaField label="Kapanış metni" value={form.closing_text} onChange={set('closing_text')} maxLength={2000} rows={3} placeholder="Teklifimizin uygun bulunacağını umar, iyi çalışmalar dileriz." />
        </div>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={busy || !dirty} data-testid="qs-save">
            {busy ? 'Kaydediliyor…' : 'Ayarları kaydet'}
          </Button>
        </div>
      </form>
    </Panel>
  )
}
