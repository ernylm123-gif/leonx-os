import { type FormEvent, useEffect, useState } from 'react'
import { useFormDirty } from '@/lib/unsaved'
import { Button } from '@/components/ui/Button'
import { FormAlert, TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/context/toast'
import { ConflictError, createContact, updateContact } from '@/data/api'
import type { Contact, ContactInput } from '@/data/types'
import { dataErrorMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { type FieldErrors, validateContact } from '@/lib/validation'

interface ContactFormProps {
  open: boolean
  onClose: () => void
  companyId: string
  contact?: Contact
  onSaved: (c: Contact) => void
}

export function ContactForm({ open, onClose, companyId, contact, onSaved }: ContactFormProps) {
  const { notify } = useToast()
  const [form, setForm] = useState({ full_name: '', title: '', phone: '', email: '', notes: '' })
  const [isPrimary, setIsPrimary] = useState(false)
  const [errors, setErrors] = useState<FieldErrors<ContactInput>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { markDirty } = useFormDirty(open, 'İlgili kişi formu')

  useEffect(() => {
    if (!open) return
    setErrors({})
    setFormError(null)
    setForm({
      full_name: contact?.full_name ?? '',
      title: contact?.title ?? '',
      phone: contact?.phone ?? '',
      email: contact?.email ?? '',
      notes: contact?.notes ?? '',
    })
    setIsPrimary(contact?.is_primary ?? false)
  }, [open]) // yalnızca açılışta

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = validateContact({ ...form, company_id: companyId, is_primary: isPrimary })
    setErrors(v.errors)
    if (!v.ok) return
    setBusy(true)
    setFormError(null)
    try {
      const db = requireSupabase()
      const saved = contact ? await updateContact(db, contact.id, contact.version, v.value) : await createContact(db, v.value)
      onSaved(saved)
      notify(contact ? 'Kişi güncellendi.' : 'Kişi eklendi.')
      onClose()
    } catch (err) {
      setFormError(
        err instanceof ConflictError
          ? 'Bu kişi başka bir cihazda değiştirildi veya silindi. Pencereyi kapatıp listeyi yeniledikten sonra tekrar deneyin.'
          : dataErrorMessage(err, 'Kayıt'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title={contact ? 'Kişiyi düzenle' : 'Yeni ilgili kişi'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="contact-form" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      {formError && <FormAlert>{formError}</FormAlert>}
      <form onChangeCapture={markDirty} id="contact-form" onSubmit={(e) => void submit(e)} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Ad soyad" required value={form.full_name} onChange={set('full_name')} error={errors.full_name} className="sm:col-span-2" maxLength={160} autoComplete="name" />
        <TextField label="Görev / unvan" value={form.title} onChange={set('title')} error={errors.title} maxLength={120} />
        <TextField label="Telefon" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} error={errors.phone} />
        <TextField label="E-posta" type="email" inputMode="email" autoCapitalize="none" value={form.email} onChange={set('email')} error={errors.email} className="sm:col-span-2" />
        <TextAreaField label="Notlar" value={form.notes} onChange={set('notes')} error={errors.notes} className="sm:col-span-2" maxLength={2000} />
        <label className="flex items-center gap-3 text-sm text-ink-2 sm:col-span-2">
          <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} className="h-5 w-5 rounded accent-[var(--anthracite)]" />
          Birincil ilgili kişi
        </label>
      </form>
    </Modal>
  )
}
