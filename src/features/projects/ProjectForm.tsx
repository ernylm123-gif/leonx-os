import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useFormDirty } from '@/lib/unsaved'
import { useResetOnOpen } from '@/lib/useResetOnOpen'
import { Button } from '@/components/ui/Button'
import { FormAlert, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { ConflictError, createProject, suggestProjectCode, updateProject } from '@/data/api'
import type { Project, ProjectInput } from '@/data/types'
import { PROJECT_CATEGORIES, PROJECT_PRIORITIES, PROJECT_STAGES } from '@/lib/domain'
import { dataErrorMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { type FieldErrors, validateProject } from '@/lib/validation'

type FormState = Record<keyof ProjectInput, string>

const EMPTY: FormState = {
  code: '',
  name: '',
  company_id: '',
  category: '',
  stage: 'yeni_firsat',
  progress: '0',
  on_hold: 'false',
  priority: 'normal',
  description: '',
  start_date: '',
  due_date: '',
  completed_on: '',
  location: '',
  address: '',
  map_url: '',
  notes: '',
}

function toForm(p: Project): FormState {
  return {
    code: p.code,
    name: p.name,
    company_id: p.company_id ?? '',
    category: p.category,
    stage: p.stage,
    progress: String(p.progress ?? 0),
    on_hold: String(!!p.on_hold),
    priority: p.priority,
    description: p.description ?? '',
    start_date: p.start_date ?? '',
    due_date: p.due_date ?? '',
    completed_on: p.completed_on ?? '',
    location: p.location ?? '',
    address: p.address ?? '',
    map_url: p.map_url ?? '',
    notes: p.notes ?? '',
  }
}

interface ProjectFormProps {
  open: boolean
  onClose: () => void
  /** Düzenlenecek proje; yoksa yeni proje */
  project?: Project
  /** Yeni projede ön seçili firma */
  defaultCompanyId?: string
  /** Yeni projede ön doldurulan ad (ör. tekliften proje oluşturma) */
  defaultName?: string
  onSaved?: (p: Project) => void
}

export function ProjectForm({ open, onClose, project, defaultCompanyId, defaultName, onSaved }: ProjectFormProps) {
  const { companies, projects, upsertProject } = useData()
  const { notify } = useToast()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [baseVersion, setBaseVersion] = useState<number | null>(null)
  const [errors, setErrors] = useState<FieldErrors<ProjectInput>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<'changed' | 'deleted' | null>(null)
  const [busy, setBusy] = useState(false)
  const { markDirty } = useFormDirty(open, 'Proje formu')

  // Form açıldığında başlangıç değerleri (render sırasında; effect ile sıfırlamak açılır açılmaz yazılanları ezebilir)
  useResetOnOpen(open, () => {
    setErrors({})
    setFormError(null)
    setConflict(null)
    if (project) {
      setForm(toForm(project))
      setBaseVersion(project.version)
    } else {
      setForm({ ...EMPTY, company_id: defaultCompanyId ?? '', name: defaultName ?? '' })
      setBaseVersion(null)
    }
  })

  // Yeni projede kod önerisi (asenkron; kullanıcı kod yazdıysa ezmez)
  useEffect(() => {
    if (!open || project) return
    let cancelled = false
    suggestProjectCode(requireSupabase()).then((code) => {
      if (!cancelled && code) setForm((f) => (f.code ? f : { ...f, code }))
    })
    return () => {
      cancelled = true
    }
  }, [open])

  // Düzenleme sırasında başka cihazdan gelen değişiklik
  const latest = useMemo(() => (project ? projects.find((p) => p.id === project.id) : undefined), [projects, project])
  const changedElsewhere = !!project && baseVersion !== null && (latest ? latest.version > baseVersion : true)

  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e?: FormEvent, overwrite = false) => {
    e?.preventDefault()
    const v = validateProject(form)
    setErrors(v.errors)
    if (!v.ok) return
    setBusy(true)
    setFormError(null)
    try {
      const db = requireSupabase()
      let saved: Project
      if (project) {
        const version = overwrite && latest ? latest.version : baseVersion!
        saved = await updateProject(db, project.id, version, v.value)
      } else {
        saved = await createProject(db, v.value)
      }
      upsertProject(saved)
      notify(project ? 'Proje güncellendi.' : 'Proje oluşturuldu.')
      onSaved?.(saved)
      onClose()
    } catch (err) {
      if (err instanceof ConflictError) setConflict(err.reason)
      else setFormError(dataErrorMessage(err, 'Kayıt'))
    } finally {
      setBusy(false)
    }
  }

  const loadLatest = () => {
    if (latest) {
      setForm(toForm(latest))
      setBaseVersion(latest.version)
      setConflict(null)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title={project ? 'Projeyi düzenle' : 'Yeni proje'}
      description={project ? `${project.code} · sürüm ${baseVersion ?? '—'}` : 'Zorunlu alanlar * ile işaretlidir.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="project-form" disabled={busy || conflict === 'deleted'}>
            {busy ? 'Kaydediliyor…' : project ? 'Değişiklikleri kaydet' : 'Projeyi oluştur'}
          </Button>
        </>
      }
    >
      {conflict === 'deleted' && <FormAlert>Bu proje başka bir cihazda silinmiş. Değişiklikler kaydedilemez.</FormAlert>}
      {(conflict === 'changed' || (changedElsewhere && !conflict)) && latest && (
        <FormAlert tone="warn">
          <p>
            Bu proje siz düzenlerken başka bir cihazda güncellendi (sürüm {baseVersion} → {latest.version}). Kaydederseniz diğer
            cihazdaki değişikliklerin üzerine yazılır.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={loadLatest} className="h-9 text-xs">
              Güncel hali yükle
            </Button>
            <Button variant="ghost" onClick={() => void submit(undefined, true)} className="h-9 text-xs" disabled={busy}>
              Benim değişikliklerimle üzerine yaz
            </Button>
          </div>
        </FormAlert>
      )}
      {formError && <FormAlert>{formError}</FormAlert>}

      <form onChangeCapture={markDirty} id="project-form" onSubmit={(e) => void submit(e)} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label="Proje kodu"
          required
          value={form.code}
          onChange={set('code')}
          error={errors.code}
          hint={project ? undefined : 'Önerilen kod otomatik doldurulur; değiştirebilirsiniz.'}
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
        />
        <TextField label="Proje adı" required value={form.name} onChange={set('name')} error={errors.name} maxLength={200} />
        <SelectField label="Firma" value={form.company_id} onChange={set('company_id')} error={errors.company_id}>
          <option value="">— Firma seçilmedi —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="İş kategorisi" required value={form.category} onChange={set('category')} error={errors.category}>
          <option value="">— Seçin —</option>
          {PROJECT_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Aşama" value={form.stage} onChange={set('stage')} error={errors.stage} data-testid="project-stage-field">
          {PROJECT_STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Öncelik" value={form.priority} onChange={set('priority')} error={errors.priority}>
          {PROJECT_PRIORITIES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </SelectField>
        <TextField label="Başlangıç tarihi" type="date" value={form.start_date} onChange={set('start_date')} error={errors.start_date} />
        <TextField label="Hedef teslim tarihi" type="date" value={form.due_date} onChange={set('due_date')} error={errors.due_date} />
        <TextField label="Gerçek tamamlanma tarihi" type="date" value={form.completed_on} onChange={set('completed_on')} error={errors.completed_on} hint="Tamamlandı/Teslim aşamasında boşsa bugün atanır." />
        <TextField label="İlerleme (%)" type="number" inputMode="numeric" min={0} max={100} value={form.progress} onChange={set('progress')} error={errors.progress} />
        <TextField label="Konum (il / ilçe / şantiye)" value={form.location} onChange={set('location')} error={errors.location} maxLength={300} placeholder="ör. Karşıyaka / İzmir" />
        <TextField label="Harita bağlantısı" type="url" value={form.map_url} onChange={set('map_url')} error={errors.map_url} maxLength={500} placeholder="https://maps.google.com/…" />
        <TextAreaField label="Proje adresi" value={form.address} onChange={set('address')} error={errors.address} className="sm:col-span-2" maxLength={500} />
        <TextAreaField label="Açıklama" value={form.description} onChange={set('description')} error={errors.description} className="sm:col-span-2" maxLength={5000} />
        <TextAreaField label="Notlar" value={form.notes} onChange={set('notes')} error={errors.notes} className="sm:col-span-2" maxLength={5000} />
      </form>
    </Modal>
  )
}
