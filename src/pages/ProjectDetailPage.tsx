import { type ReactNode, useMemo, useState } from 'react'
import { ArrowLeft, Building2, CalendarClock, FolderKanban, History, Info, MapPin, Pencil, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Panel } from '@/components/ui/Panel'
import { PriorityLabel, StatusBadge } from '@/components/ui/ProjectBadges'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { FilterSelect } from '@/components/ui/Toolbar'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { ConflictError, deleteProject, listStatusHistory, updateProjectStatus } from '@/data/api'
import type { StatusHistoryEntry } from '@/data/types'
import { ProjectFiles } from '@/features/projects/ProjectFiles'
import { ProjectForm } from '@/features/projects/ProjectForm'
import { ProjectNotes } from '@/features/projects/ProjectNotes'
import { ProjectQuantity } from '@/features/projects/ProjectQuantity'
import { RelatedQuotes } from '@/features/quotes/RelatedQuotes'
import { CATEGORY_LABEL, isActiveStatus, isStatus, PROJECT_STATUSES, STATUS_LABEL } from '@/lib/domain'
import { dataErrorMessage } from '@/lib/errors'
import { daysUntil, formatDate, formatDateTime, localISODate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useLiveList } from '@/lib/useLiveList'

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-sm break-words text-ink">{children}</dd>
    </div>
  )
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { notify } = useToast()
  const { projects, companies, loading, error, refresh, upsertProject, removeProject } = useData()
  const project = projects.find((p) => p.id === id)
  const company = useMemo(() => companies.find((c) => c.id === project?.company_id), [companies, project?.company_id])
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)

  const history = useLiveList<StatusHistoryEntry>('project_status_history', 'project_id', project?.id, (pid) =>
    listStatusHistory(requireSupabase(), pid),
  )

  if (loading && !project) return <LoadingState label="Proje yükleniyor…" />
  if (!project) {
    return error ? (
      <ErrorState message={error} onRetry={() => void refresh()} />
    ) : (
      <div className="card">
        <EmptyState icon={FolderKanban} title="Proje bulunamadı" description="Bu proje silinmiş veya adres hatalı olabilir.">
          <Link to="/projeler" className="text-sm font-medium text-ink underline underline-offset-4">
            Projelere dön
          </Link>
        </EmptyState>
      </div>
    )
  }

  const changeStatus = async (next: string) => {
    if (!isStatus(next) || next === project.status) return
    setStatusBusy(true)
    try {
      const saved = await updateProjectStatus(requireSupabase(), project.id, project.version, next)
      upsertProject(saved)
      notify(`Durum: ${STATUS_LABEL[next]}`)
    } catch (err) {
      if (err instanceof ConflictError) {
        notify('Proje başka bir cihazda güncellendi; güncel hali yüklendi. Durumu tekrar seçin.', 'error')
        void refresh()
      } else notify(dataErrorMessage(err, 'Durum güncelleme'), 'error')
    } finally {
      setStatusBusy(false)
    }
  }

  const remove = async () => {
    setDeleting(true)
    try {
      await deleteProject(requireSupabase(), project.id)
      removeProject(project.id)
      notify('Proje silindi.')
      navigate('/projeler', { replace: true })
    } catch (err) {
      notify(dataErrorMessage(err, 'Silme'), 'error')
      setDeleting(false)
    }
  }

  const active = isActiveStatus(project.status)
  const dueIn = project.due_date ? daysUntil(project.due_date, localISODate()) : null

  return (
    <>
      <Link to="/projeler" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Projeler
      </Link>

      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-subtle">{project.code}</span>
            <StatusBadge status={project.status} />
            <PriorityLabel priority={project.priority} />
          </div>
          <h1 className="mt-1.5 text-[26px] leading-tight font-semibold tracking-[-0.015em] break-words text-ink sm:text-[32px]">{project.name}</h1>
          <p className="mt-1.5 text-sm text-muted">
            {CATEGORY_LABEL[project.category]}
            {company && (
              <>
                {' · '}
                <Link to={`/firmalar/${company.id}`} className="text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">
                  {company.name}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={Pencil} onClick={() => setEditOpen(true)}>
            Düzenle
          </Button>
          <Button variant="ghost" icon={Trash2} onClick={() => setConfirmDelete(true)} className="hover:!bg-danger-soft hover:!text-danger">
            Sil
          </Button>
        </div>
      </header>
      <div className="ruler mb-6 opacity-80" aria-hidden="true" />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <Panel title="Proje bilgileri" icon={Info}>
            <div className="mb-5 flex flex-col gap-2 rounded-xl border border-line bg-surface-2/60 p-3 sm:flex-row sm:items-center">
              <span className="text-sm font-medium text-ink-2">Durum</span>
              <FilterSelect value={project.status} onChange={(v) => void changeStatus(v)} label="Proje durumunu değiştir" className="sm:ml-auto sm:w-56">
                {PROJECT_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </FilterSelect>
              {statusBusy && <span className="text-xs text-muted">Kaydediliyor…</span>}
            </div>
            <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Detail label="Firma">
                {company ? (
                  <Link to={`/firmalar/${company.id}`} className="inline-flex items-center gap-1.5 hover:underline">
                    <Building2 className="h-3.5 w-3.5 text-titanium" aria-hidden="true" /> {company.name}
                  </Link>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </Detail>
              <Detail label="Konum">
                {project.location ? (
                  <span className="inline-flex items-start gap-1.5">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-titanium" aria-hidden="true" /> {project.location}
                  </span>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </Detail>
              <Detail label="Başlangıç">{formatDate(project.start_date)}</Detail>
              <Detail label="Hedef teslim">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5 text-titanium" aria-hidden="true" />
                  {formatDate(project.due_date)}
                  {dueIn !== null && active && (
                    <span className={dueIn < 0 ? 'text-xs font-medium text-danger' : 'text-xs text-muted'}>
                      ({dueIn < 0 ? `${-dueIn} gün gecikti` : dueIn === 0 ? 'bugün' : `${dueIn} gün kaldı`})
                    </span>
                  )}
                </span>
              </Detail>
              <Detail label="Açıklama">
                {project.description ? <span className="whitespace-pre-wrap">{project.description}</span> : <span className="text-subtle">—</span>}
              </Detail>
              <Detail label="Notlar">
                {project.notes ? <span className="whitespace-pre-wrap">{project.notes}</span> : <span className="text-subtle">—</span>}
              </Detail>
            </dl>
            <p className="mt-5 border-t border-line pt-3 text-[11px] text-subtle">
              Oluşturuldu {formatDateTime(project.created_at)} · Güncellendi {formatDateTime(project.updated_at)} · Sürüm {project.version}
            </p>
          </Panel>
          <RelatedQuotes by="project_id" id={project.id} companyId={project.company_id} />
          <ProjectQuantity projectId={project.id} />
          <ProjectFiles projectId={project.id} />
          <ProjectNotes projectId={project.id} />
        </div>

        <Panel title="Durum geçmişi" subtitle="Sunucu tarafından otomatik kaydedilir" icon={History} className="h-fit">
          {history.loading ? (
            <LoadingState />
          ) : history.error ? (
            <ErrorState message={history.error} onRetry={() => void history.reload()} />
          ) : history.items.length === 0 ? (
            <p className="text-sm text-subtle">Kayıt yok.</p>
          ) : (
            <ol className="relative flex flex-col gap-4">
              <span className="absolute top-2 bottom-2 left-[5px] w-px bg-line" aria-hidden="true" />
              {history.items.map((h) => (
                <li key={h.id} className="relative flex gap-3">
                  <span className="relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-surface bg-titanium" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-sm text-ink">
                      {h.from_status ? (
                        <>
                          {STATUS_LABEL[h.from_status]} → <b className="font-semibold">{STATUS_LABEL[h.to_status]}</b>
                        </>
                      ) : (
                        <>
                          Oluşturuldu · <b className="font-semibold">{STATUS_LABEL[h.to_status]}</b>
                        </>
                      )}
                    </div>
                    <div className="text-[11px] text-subtle">{formatDateTime(h.changed_at)}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <ProjectForm open={editOpen} onClose={() => setEditOpen(false)} project={project} />
      <ConfirmDialog
        open={confirmDelete}
        title="Proje silinsin mi?"
        message={`"${project.code} · ${project.name}" projesi; notları, dosyaları ve durum geçmişiyle birlikte kalıcı olarak silinecek. Bu işlem geri alınamaz.`}
        confirmLabel="Projeyi sil"
        busy={deleting}
        onConfirm={() => void remove()}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  )
}
