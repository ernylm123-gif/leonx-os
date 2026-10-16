import { type FormEvent, useMemo, useState } from 'react'
import { useFormDirty } from '@/lib/unsaved'
import { useResetOnOpen } from '@/lib/useResetOnOpen'
import { Button } from '@/components/ui/Button'
import { FormAlert, TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { ConflictError, createCompany, updateCompany } from '@/data/api'
import type { Company, CompanyInput } from '@/data/types'
import { dataErrorMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { type FieldErrors, validateCompany } from '@/lib/validation'

type FormState = Record<keyof CompanyInput, string>
const EMPTY: FormState = { name: '', phone: '', email: '', address: '', city: '', tax_office: '', tax_number: '', notes: '' }

const toForm = (c: Company): FormState => ({
  name: c.name,
  phone: c.phone ?? '',
  email: c.email ?? '',
  address: c.address ?? '',
  city: c.city ?? '',
  tax_office: c.tax_office ?? '',
  tax_number: c.tax_number ?? '',
  notes: c.notes ?? '',
})

interface CompanyFormProps {
  open: boolean
  onClose: () => void
  company?: Company
  onSaved?: (c: Company) => void
}

export function CompanyForm({ open, onClose, company, onSaved }: CompanyFormProps) {
  const { companies, upsertCompany } = useData()
  const { notify } = useToast()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [baseVersion, setBaseVersion] = useState<number | null>(null)
  const [errors, setErrors] = useState<FieldErrors<CompanyInput>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<'changed' | 'deleted' | null>(null)
  const [busy, setBusy] = useState(false)
  const { markDirty } = useFormDirty(open, 'Firma formu')

  // Açılışta formu render sırasında sıfırla (effect ile sıfırlamak, açılır açılmaz yazılanları/hataları ezebilir)
  useResetOnOpen(open, () => {
    setErrors({})
    setFormError(null)
    setConflict(null)
    setForm(company ? toForm(company) : EMPTY)
    setBaseVersion(company?.version ?? null)
  })

  const latest = useMemo(() => (company ? companies.find((c) => c.id === company.id) : undefined), [companies, company])
  const changedElsewhere = !!company && baseVersion !== null && !!latest && latest.version > baseVersion

  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // Aynı adla kayıtlı firma uyarısı (engellemez)
  const duplicate = useMemo(() => {
    const n = form.name.trim().toLocaleLowerCase('tr-TR')
    return n ? companies.find((c) => c.id !== company?.id && c.name.toLocaleLowerCase('tr-TR') === n) : undefined
  }, [form.name, companies, company])

  const submit = async (e?: FormEvent, overwrite = false) => {
    e?.preventDefault()
    const v = validateCompany(form)
    setErrors(v.errors)
    if (!v.ok) return
    setBusy(true)
    setFormError(null)
    try {
      const db = requireSupabase()
      const saved = company
        ? await updateCompany(db, company.id, overwrite && latest ? latest.version : baseVersion!, v.value)
        : await createCompany(db, v.value)
      upsertCompany(saved)
      notify(company ? 'Firma güncellendi.' : 'Firma eklendi.')
      onSaved?.(saved)
      onClose()
    } catch (err) {
      if (err instanceof ConflictError) setConflict(err.reason)
      else setFormError(dataErrorMessage(err, 'Kayıt'))
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
      title={company ? 'Firmayı düzenle' : 'Yeni firma'}
      description="Zorunlu alanlar * ile işaretlidir. Vergi bilgileri isteğe bağlıdır."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="company-form" disabled={busy || conflict === 'deleted'}>
            {busy ? 'Kaydediliyor…' : company ? 'Değişiklikleri kaydet' : 'Firmayı ekle'}
          </Button>
        </>
      }
    >
      {conflict === 'deleted' && <FormAlert>Bu firma başka bir cihazda silinmiş. Değişiklikler kaydedilemez.</FormAlert>}
      {(conflict === 'changed' || (changedElsewhere && !conflict)) && latest && (
        <FormAlert tone="warn">
          <p>Bu firma siz düzenlerken başka bir cihazda güncellendi. Kaydederseniz oradaki değişikliklerin üzerine yazılır.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              className="h-9 text-xs"
              onClick={() => {
                setForm(toForm(latest))
                setBaseVersion(latest.version)
                setConflict(null)
              }}
            >
              Güncel hali yükle
            </Button>
            <Button variant="ghost" className="h-9 text-xs" disabled={busy} onClick={() => void submit(undefined, true)}>
              Benim değişikliklerimle üzerine yaz
            </Button>
          </div>
        </FormAlert>
      )}
      {formError && <FormAlert>{formError}</FormAlert>}
      <form onChangeCapture={markDirty} id="company-form" onSubmit={(e) => void submit(e)} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label="Firma adı"
          required
          value={form.name}
          onChange={set('name')}
          error={errors.name}
          hint={duplicate ? 'Bu adla kayıtlı bir firma zaten var.' : undefined}
          className="sm:col-span-2"
          maxLength={200}
          autoComplete="organization"
        />
        <TextField label="Telefon" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} error={errors.phone} autoComplete="tel" />
        <TextField label="E-posta" type="email" inputMode="email" autoCapitalize="none" value={form.email} onChange={set('email')} error={errors.email} autoComplete="email" />
        <TextField label="Şehir" value={form.city} onChange={set('city')} error={errors.city} maxLength={100} />
        <TextField label="Vergi dairesi" value={form.tax_office} onChange={set('tax_office')} error={errors.tax_office} maxLength={120} />
        <TextField
          label="Vergi / T.C. kimlik no"
          inputMode="numeric"
          value={form.tax_number}
          onChange={set('tax_number')}
          error={errors.tax_number}
          hint="10 (VKN) veya 11 (TCKN) rakam"
          maxLength={14}
        />
        <TextAreaField label="Adres" value={form.address} onChange={set('address')} error={errors.address} className="sm:col-span-2" maxLength={500} />
        <TextAreaField label="Notlar" value={form.notes} onChange={set('notes')} error={errors.notes} className="sm:col-span-2" maxLength={5000} />
      </form>
    </Modal>
  )
}
