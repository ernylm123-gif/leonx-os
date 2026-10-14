import { AlarmClock, CalendarClock, Check, ListTodo, Pencil, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FormAlert, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Panel } from '@/components/ui/Panel'
import { PriorityLabel } from '@/components/ui/ProjectBadges'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { useToast } from '@/context/toast'
import { ConflictError } from '@/data/api'
import type { ProjectTask, ProjectTaskInput } from '@/data/types'
import { createTask, deleteTask, listTasks, updateTask } from '@/data/workflowApi'
import { cn } from '@/lib/cn'
import { PROJECT_PRIORITIES, type ProjectPriority } from '@/lib/domain'
import { dataErrorMessage } from '@/lib/errors'
import { daysUntil, formatDate, formatDateTime, localISODate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useFormDirty } from '@/lib/unsaved'
import { useLiveList } from '@/lib/useLiveList'

/** Sık kullanılan iş adımları — tek dokunuşla görev başlığı olarak eklenir */
export const TASK_TEMPLATES = [
  'Yerinde ölçü alınacak',
  'Mimari çizim incelenecek',
  'Metraj kontrol edilecek',
  'Teklif hazırlanacak',
  'Müşteriden onay beklenecek',
  'Malzeme sipariş edilecek',
  'Üretime başlanacak',
  'Montaj tarihi belirlenecek',
  'Teslim kontrolü yapılacak',
]

export type TaskState = 'tamam' | 'gecikti' | 'bugun' | 'yakin' | 'normal'

export function taskState(t: Pick<ProjectTask, 'done' | 'due_date'>, today = localISODate()): TaskState {
  if (t.done) return 'tamam'
  if (!t.due_date) return 'normal'
  const d = daysUntil(t.due_date, today)
  return d < 0 ? 'gecikti' : d === 0 ? 'bugun' : d <= 3 ? 'yakin' : 'normal'
}

export function TaskDue({ task }: { task: Pick<ProjectTask, 'done' | 'due_date'> }) {
  if (!task.due_date) return null
  const st = taskState(task)
  const d = daysUntil(task.due_date, localISODate())
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', st === 'gecikti' ? 'font-medium text-danger' : st === 'bugun' || st === 'yakin' ? 'text-warn' : 'text-muted')}>
      <CalendarClock className="h-3 w-3" aria-hidden="true" />
      {formatDate(task.due_date)}
      {st === 'gecikti' && ` · ${-d} gün gecikti`}
      {st === 'bugun' && ' · bugün'}
      {st === 'yakin' && ` · ${d} gün`}
    </span>
  )
}

type Draft = { title: string; description: string; priority: ProjectPriority; start_date: string; due_date: string; remind_at: string; notes: string }
const EMPTY: Draft = { title: '', description: '', priority: 'normal', start_date: '', due_date: '', remind_at: '', notes: '' }

/** datetime-local ↔ ISO (yerel saat) */
const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function TaskForm({ open, onClose, projectId, task, onSaved }: { open: boolean; onClose: () => void; projectId: string; task?: ProjectTask | null; onSaved?: (t: ProjectTask) => void }) {
  const { notify } = useToast()
  const [d, setD] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { markDirty } = useFormDirty(open, 'Görev formu')

  useEffect(() => {
    if (!open) return
    setErrors({})
    setFormError(null)
    setD(
      task
        ? { title: task.title, description: task.description ?? '', priority: task.priority, start_date: task.start_date ?? '', due_date: task.due_date ?? '', remind_at: toLocalInput(task.remind_at), notes: task.notes ?? '' }
        : EMPTY,
    )
  }, [open, task])

  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }))

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const errs: Partial<Record<keyof Draft, string>> = {}
    if (!d.title.trim()) errs.title = 'Görev başlığı zorunludur.'
    else if (d.title.trim().length > 200) errs.title = 'En fazla 200 karakter.'
    if (d.start_date && d.due_date && d.due_date < d.start_date) errs.due_date = 'Bitiş tarihi başlangıçtan önce olamaz.'
    if (d.remind_at && Number.isNaN(new Date(d.remind_at).getTime())) errs.remind_at = 'Geçerli bir zaman girin.'
    if (d.description.length > 5000) errs.description = 'En fazla 5000 karakter.'
    if (d.notes.length > 5000) errs.notes = 'En fazla 5000 karakter.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const input: Omit<ProjectTaskInput, 'done' | 'sort_order'> = {
      project_id: projectId,
      title: d.title.trim(),
      description: d.description.trim() || null,
      priority: d.priority,
      start_date: d.start_date || null,
      due_date: d.due_date || null,
      remind_at: d.remind_at ? new Date(d.remind_at).toISOString() : null,
      notes: d.notes.trim() || null,
    }
    setBusy(true)
    setFormError(null)
    try {
      const db = requireSupabase()
      const saved = task ? await updateTask(db, task, input) : await createTask(db, { ...input, done: false, sort_order: 0 })
      notify(task ? 'Görev güncellendi.' : 'Görev eklendi.')
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setFormError(err instanceof ConflictError ? 'Görev başka bir cihazda değiştirildi veya silindi. Kapatıp yeniden açın.' : dataErrorMessage(err, 'Görev kaydı'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title={task ? 'Görevi düzenle' : 'Yeni görev'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="task-form" disabled={busy} data-testid="task-submit">
            {busy ? 'Kaydediliyor…' : task ? 'Kaydet' : 'Görevi ekle'}
          </Button>
        </>
      }
    >
      {formError && <FormAlert>{formError}</FormAlert>}
      <form id="task-form" onChangeCapture={markDirty} onSubmit={(e) => void submit(e)} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Başlık" required value={d.title} onChange={set('title')} error={errors.title} maxLength={200} className="sm:col-span-2" data-testid="task-title" />
        {!task && (
          <div className="-mt-2 flex flex-wrap gap-1.5 sm:col-span-2" aria-label="Hazır görevler">
            {TASK_TEMPLATES.map((t) => (
              <button key={t} type="button" onClick={() => setD((x) => ({ ...x, title: t }))} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2 hover:bg-surface-3 hover:text-ink">
                {t}
              </button>
            ))}
          </div>
        )}
        <SelectField label="Öncelik" value={d.priority} onChange={set('priority')}>
          {PROJECT_PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </SelectField>
        <TextField label="Hatırlatma zamanı" type="datetime-local" value={d.remind_at} onChange={set('remind_at')} error={errors.remind_at} hint="Bu saatte bildirim gelir." data-testid="task-remind" />
        <TextField label="Başlangıç" type="date" value={d.start_date} onChange={set('start_date')} />
        <TextField label="Bitiş (termin)" type="date" value={d.due_date} onChange={set('due_date')} error={errors.due_date} data-testid="task-due" />
        <TextAreaField label="Açıklama" value={d.description} onChange={set('description')} error={errors.description} className="sm:col-span-2" maxLength={5000} />
        <TextAreaField label="Notlar" value={d.notes} onChange={set('notes')} error={errors.notes} className="sm:col-span-2" maxLength={5000} />
      </form>
    </Modal>
  )
}

export function TaskRow({ task, onToggle, onEdit, onDelete, extra }: { task: ProjectTask; onToggle: () => void; onEdit?: () => void; onDelete?: () => void; extra?: React.ReactNode }) {
  const st = taskState(task)
  return (
    <li className={cn('flex items-start gap-3 py-3', st === 'gecikti' && 'bg-danger-soft/40 -mx-2 rounded-lg px-2')} data-testid="task-row" data-state={st}>
      <button
        type="button"
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? `${task.title} — tamamlanmadı olarak işaretle` : `${task.title} — tamamlandı olarak işaretle`}
        onClick={onToggle}
        className={cn('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors', task.done ? 'border-ok bg-ok text-white' : 'border-line-strong bg-surface hover:border-ink')}
        data-testid="task-toggle"
      >
        {task.done && <Check className="h-4 w-4" aria-hidden="true" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn('text-sm font-medium break-words', task.done ? 'text-muted line-through' : 'text-ink')}>{task.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {extra}
          <PriorityLabel priority={task.priority} />
          <TaskDue task={task} />
          {task.remind_at && !task.done && (
            <span className="inline-flex items-center gap-1 text-muted">
              <AlarmClock className="h-3 w-3" aria-hidden="true" />
              {formatDateTime(task.remind_at)}
            </span>
          )}
          {task.done && task.done_at && <span className="text-ok">Tamamlandı {formatDateTime(task.done_at)}</span>}
        </div>
        {task.description && <p className="mt-1 text-xs whitespace-pre-wrap text-muted">{task.description}</p>}
      </div>
      {(onEdit || onDelete) && (
        <div className="flex shrink-0 gap-0.5">
          {onEdit && (
            <button type="button" onClick={onEdit} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-ink" aria-label={`${task.title} düzenle`}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          {onDelete && (
            <button type="button" onClick={onDelete} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger" aria-label={`${task.title} sil`}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </li>
  )
}

/** Tamamla / geri al (iyimser güncelleme; çakışmada yenilenir) */
export function useTaskToggle(onChanged: (t: ProjectTask) => void, reload: () => void) {
  const { notify } = useToast()
  return async (t: ProjectTask) => {
    try {
      const saved = await updateTask(requireSupabase(), t, { done: !t.done })
      onChanged(saved)
      notify(saved.done ? `Tamamlandı: ${saved.title}` : `Yeniden açıldı: ${saved.title}`)
    } catch (err) {
      notify(err instanceof ConflictError ? 'Görev başka bir cihazda değişti; güncel hali yüklendi.' : dataErrorMessage(err, 'Görev güncelleme'), 'error')
      reload()
    }
  }
}

export function ProjectTasks({ projectId, id }: { projectId: string; id?: string }) {
  const { notify } = useToast()
  const tasks = useLiveList<ProjectTask>('project_tasks', 'project_id', projectId, (pid) => listTasks(requireSupabase(), pid))
  const [form, setForm] = useState<{ open: boolean; task: ProjectTask | null }>({ open: false, task: null })
  const [confirm, setConfirm] = useState<ProjectTask | null>(null)
  const [busy, setBusy] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const replace = (t: ProjectTask) => tasks.setItems((l) => (l.some((x) => x.id === t.id) ? l.map((x) => (x.id === t.id ? t : x)) : [...l, t]))
  const toggle = useTaskToggle(replace, () => void tasks.reload())

  const open = tasks.items.filter((t) => !t.done)
  const done = tasks.items.filter((t) => t.done)
  const late = open.filter((t) => taskState(t) === 'gecikti').length

  return (
    <div id={id}>
      <Panel
        title="Görevler ve terminler"
        subtitle={tasks.items.length ? `${open.length} açık${late ? ` · ${late} gecikmiş` : ''} · ${done.length} tamamlandı` : 'Proje adımlarını termin ve hatırlatmayla takip edin'}
        icon={ListTodo}
        actions={
          <Button variant="secondary" icon={Plus} onClick={() => setForm({ open: true, task: null })} data-testid="task-add">
            Görev ekle
          </Button>
        }
      >
        {tasks.loading ? (
          <LoadingState />
        ) : tasks.error ? (
          <ErrorState message={tasks.error} onRetry={() => void tasks.reload()} />
        ) : tasks.items.length === 0 ? (
          <p className="text-sm text-subtle">Henüz görev yok. "Görev ekle" ile ölçü, sipariş, montaj gibi adımları terminleriyle girin.</p>
        ) : (
          <>
            <ul className="divide-y divide-line" aria-label="Açık görevler">
              {open.map((t) => (
                <TaskRow key={t.id} task={t} onToggle={() => void toggle(t)} onEdit={() => setForm({ open: true, task: t })} onDelete={() => setConfirm(t)} />
              ))}
              {open.length === 0 && <li className="py-3 text-sm text-ok">Tüm görevler tamamlandı.</li>}
            </ul>
            {done.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <button type="button" onClick={() => setShowDone((v) => !v)} className="text-xs font-semibold text-muted hover:text-ink">
                  {showDone ? 'Tamamlananları gizle' : `Tamamlananları göster (${done.length})`}
                </button>
                {showDone && (
                  <ul className="divide-y divide-line" aria-label="Tamamlanan görevler">
                    {done.map((t) => (
                      <TaskRow key={t.id} task={t} onToggle={() => void toggle(t)} onDelete={() => setConfirm(t)} />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </Panel>
      <TaskForm open={form.open} onClose={() => setForm({ open: false, task: null })} projectId={projectId} task={form.task} onSaved={replace} />
      <ConfirmDialog
        open={!!confirm}
        title="Görev silinsin mi?"
        message={confirm ? `"${confirm.title}" görevi silinecek. Zaman çizelgesindeki geçmiş kayıtlar korunur.` : ''}
        confirmLabel="Görevi sil"
        busy={busy}
        onConfirm={async () => {
          if (!confirm) return
          setBusy(true)
          try {
            await deleteTask(requireSupabase(), confirm.id)
            tasks.setItems((l) => l.filter((x) => x.id !== confirm.id))
            notify('Görev silindi.')
            setConfirm(null)
          } catch (err) {
            notify(dataErrorMessage(err, 'Silme'), 'error')
          } finally {
            setBusy(false)
          }
        }}
        onClose={() => setConfirm(null)}
      />
    </div>
  )
}
