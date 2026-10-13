import { useRef, useState } from 'react'
import { Download, FileText, Loader2, Paperclip, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Panel } from '@/components/ui/Panel'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { useToast } from '@/context/toast'
import { deleteProjectFile, downloadProjectFile, listProjectFiles, uploadProjectFile } from '@/data/api'
import type { ProjectFile } from '@/data/types'
import { dataErrorMessage } from '@/lib/errors'
import { ACCEPT_ATTRIBUTE, fileExtension, formatBytes, MAX_FILE_BYTES, validateFile } from '@/lib/files'
import { formatDateTime } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useLiveList } from '@/lib/useLiveList'

export function ProjectFiles({ projectId }: { projectId: string }) {
  const { notify } = useToast()
  const { items, setItems, loading, error, reload } = useLiveList<ProjectFile>('project_files', 'project_id', projectId, (id) =>
    listProjectFiles(requireSupabase(), id),
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<ProjectFile | null>(null)
  const [deleting, setDeleting] = useState(false)

  const onPick = async (files: FileList | null) => {
    if (!files?.length) return
    for (const file of Array.from(files)) {
      const problem = validateFile(file)
      if (problem) {
        notify(`${file.name}: ${problem}`, 'error')
        continue
      }
      setUploading(file.name)
      try {
        const saved = await uploadProjectFile(requireSupabase(), projectId, file)
        setItems((l) => [saved, ...l.filter((f) => f.id !== saved.id)])
        notify(`${file.name} yüklendi.`)
      } catch (err) {
        notify(`${file.name}: ${dataErrorMessage(err, 'Yükleme')}`, 'error')
      }
    }
    setUploading(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const download = async (f: ProjectFile) => {
    setDownloading(f.id)
    try {
      const blob = await downloadProjectFile(requireSupabase(), f)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = f.file_name
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (err) {
      notify(dataErrorMessage(err, 'İndirme'), 'error')
    } finally {
      setDownloading(null)
    }
  }

  const remove = async () => {
    if (!toDelete) return
    setDeleting(true)
    try {
      await deleteProjectFile(requireSupabase(), toDelete)
      setItems((l) => l.filter((f) => f.id !== toDelete.id))
      notify('Dosya silindi.')
      setToDelete(null)
    } catch (err) {
      notify(dataErrorMessage(err, 'Silme'), 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Panel
      title="Dosyalar"
      subtitle={`Özel depolama · dosya başına en fazla ${formatBytes(MAX_FILE_BYTES)}`}
      icon={Paperclip}
      actions={
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            className="sr-only"
            id={`file-input-${projectId}`}
            onChange={(e) => void onPick(e.target.files)}
            disabled={!!uploading}
          />
          <Button variant="secondary" icon={uploading ? Loader2 : Upload} onClick={() => inputRef.current?.click()} disabled={!!uploading} className="h-9 px-3 text-xs">
            {uploading ? 'Yükleniyor…' : 'Dosya yükle'}
          </Button>
        </>
      }
    >
      {uploading && (
        <p className="mb-3 flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-muted" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> {uploading} yükleniyor…
        </p>
      )}
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center">
          <p className="text-sm text-muted">Henüz dosya yok.</p>
          <p className="mt-1 text-xs text-subtle">PDF, görsel, DWG/DXF, Office, CSV, TXT, ZIP. CAD dosyalarının analizi henüz yapılmaz; yalnızca saklanır.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 font-mono text-[9.5px] font-semibold text-muted uppercase">
                {fileExtension(f.file_name).slice(0, 4) || <FileText className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{f.file_name}</div>
                <div className="text-[11px] text-subtle">
                  {formatBytes(f.size_bytes)} · {formatDateTime(f.created_at)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void download(f)}
                disabled={downloading === f.id}
                className="grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                aria-label={`${f.file_name} indir`}
              >
                {downloading === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setToDelete(f)}
                className="grid h-9 w-9 place-items-center rounded-lg text-subtle transition hover:bg-danger-soft hover:text-danger"
                aria-label={`${f.file_name} sil`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!toDelete}
        title="Dosya silinsin mi?"
        message={`"${toDelete?.file_name ?? ''}" depodan kalıcı olarak silinecek.`}
        busy={deleting}
        onConfirm={() => void remove()}
        onClose={() => setToDelete(null)}
      />
    </Panel>
  )
}
