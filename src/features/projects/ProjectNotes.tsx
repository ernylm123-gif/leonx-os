import { type FormEvent, useState } from 'react'
import { useUnsavedChanges } from '@/lib/unsaved'
import { MessageSquareText, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { TextAreaField } from '@/components/ui/Field'
import { Panel } from '@/components/ui/Panel'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { useToast } from '@/context/toast'
import { createNote, deleteNote, listNotes } from '@/data/api'
import type { ProjectNote } from '@/data/types'
import { dataErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useLiveList } from '@/lib/useLiveList'
import { validateNote } from '@/lib/validation'

export function ProjectNotes({ projectId }: { projectId: string }) {
  const { notify } = useToast()
  const { items, setItems, loading, error, reload } = useLiveList<ProjectNote>('project_notes', 'project_id', projectId, (id) =>
    listNotes(requireSupabase(), id),
  )
  const [body, setBody] = useState('')
  const [fieldError, setFieldError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  useUnsavedChanges(body.trim().length > 0, 'Proje notu')
  const [toDelete, setToDelete] = useState<ProjectNote | null>(null)
  const [deleting, setDeleting] = useState(false)

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const v = validateNote(body)
    if (!v.ok) {
      setFieldError(v.error)
      return
    }
    setBusy(true)
    try {
      const note = await createNote(requireSupabase(), projectId, v.value)
      setItems((l) => [note, ...l.filter((n) => n.id !== note.id)])
      setBody('')
      setFieldError(undefined)
      notify('Not eklendi.')
    } catch (err) {
      notify(dataErrorMessage(err, 'Not ekleme'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!toDelete) return
    setDeleting(true)
    try {
      await deleteNote(requireSupabase(), toDelete.id)
      setItems((l) => l.filter((n) => n.id !== toDelete.id))
      notify('Not silindi.')
      setToDelete(null)
    } catch (err) {
      notify(dataErrorMessage(err, 'Silme'), 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Panel title="Notlar" subtitle={`${items.length} not`} icon={MessageSquareText}>
      <form onSubmit={(e) => void add(e)} noValidate className="mb-5">
        <TextAreaField
          label="Yeni not"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          error={fieldError}
          maxLength={5000}
          placeholder="Görüşme, ölçü, değişiklik talebi…"
          disabled={busy}
        />
        <div className="mt-2 flex justify-end">
          <Button type="submit" variant="secondary" icon={Plus} disabled={busy || !body.trim()}>
            {busy ? 'Ekleniyor…' : 'Not ekle'}
          </Button>
        </div>
      </form>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-sm text-subtle">Henüz not yok.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((n) => (
            <li key={n.id} className="group rounded-xl border border-line bg-surface-2/50 p-4">
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink">{n.body}</p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-subtle">{formatDateTime(n.created_at)}</span>
                <button
                  type="button"
                  onClick={() => setToDelete(n)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-subtle transition hover:bg-danger-soft hover:text-danger"
                  aria-label="Notu sil"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!toDelete}
        title="Not silinsin mi?"
        message="Bu not kalıcı olarak silinecek ve diğer cihazlarınızdan da kaldırılacak."
        busy={deleting}
        onConfirm={() => void remove()}
        onClose={() => setToDelete(null)}
      />
    </Panel>
  )
}
