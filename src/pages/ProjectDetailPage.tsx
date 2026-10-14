import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Building2, CalendarCheck, CalendarClock, ExternalLink, FolderKanban, Info, MapPin, PauseCircle, Pencil, PlayCircle, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Panel } from '@/components/ui/Panel'
import { PriorityLabel, ProgressBar, StageBadge } from '@/components/ui/ProjectBadges'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { FilterSelect } from '@/components/ui/Toolbar'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { ConflictError, deleteProject, updateProjectStage } from '@/data/api'
import { ProjectFiles } from '@/features/projects/ProjectFiles'
import { ProjectForm } from '@/features/projects/ProjectForm'
import { ProjectNotes } from '@/features/projects/ProjectNotes'
import { ProjectQuantity } from '@/features/projects/ProjectQuantity'
import { ProjectTasks } from '@/features/projects/ProjectTasks'
import { ProjectTimeline } from '@/features/projects/ProjectTimeline'
import { RelatedQuotes } from '@/features/quotes/RelatedQuotes'
import { CATEGORY_LABEL, isActiveStage, isStage, PROJECT_STAGES, STAGE_LABEL, STAGE_PROGRESS } from '@/lib/domain'
import { dataErrorMessage } from '@/lib/errors'
import { daysUntil, formatDate, formatDateTime, localISODate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'

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
  const [progressDraft, setProgressDraft] = useState<number | null>(null)
  const [params] = useSearchParams()
  const tab = params.get('sekme')

  // Bildirimden "?sekme=gorevler" ile gelindiyse görev bölümüne kaydır
  useEffect(() => {
    if (tab === 'gorevler' && project) document.getElementById('gorevler')?.scrollIntoView({ block: 'start' })
  }, [tab, project?.id])

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

  const patch = async (p: Parameters<typeof updateProjectStage>[3], message: string) => {
    setStatusBusy(true)
    try {
      const saved = await updateProjectStage(requireSupabase(), project.id, project.version, p)
      upsertProject(saved)
      notify(message)
    } catch (err) {
      if (err instanceof ConflictError) {
        notify('Proje başka bir cihazda güncellendi; güncel hali yüklendi. Tekrar deneyin.', 'error')
        void refresh()
      } else notify(dataErrorMessage(err, 'Proje güncelleme'), 'error')
    } finally {
      setStatusBusy(false)
      setProgressDraft(null)
    }
  }
  const changeStage = (next: string) => {
    if (!isStage(next) || next === project.stage) return
    void patch({ stage: next }, `Aşama: ${STAGE_LABEL[next]}`)
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

  const active = isActiveStage(project.stage)
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
            <StageBadge stage={project.stage} onHold={project.on_hold} />
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
            <div className="mb-5 space-y-3 rounded-xl border border-line bg-surface-2/60 p-3" data-testid="stage-control">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="text-sm font-medium text-ink-2">Aşama</span>
                <FilterSelect value={project.stage} onChange={changeStage} label="Proje aşamasını değiştir" className="sm:ml-auto sm:w-60">
                  {PROJECT_STAGES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </FilterSelect>
                {active && (
                  <Button
                    variant="ghost"
                    icon={project.on_hold ? PlayCircle : PauseCircle}
                    onClick={() => void patch({ on_hold: !project.on_hold }, project.on_hold ? 'Proje beklemeden çıkarıldı.' : 'Proje beklemeye alındı.')}
                    disabled={statusBusy}
                    className="h-9 text-xs"
                  >
                    {project.on_hold ? 'Devam ettir' : 'Beklemeye al'}
                  </Button>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label htmlFor="progress" className="text-sm font-medium text-ink-2">
                  İlerleme
                </label>
                <input
                  id="progress"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={progressDraft ?? project.progress}
                  onChange={(e) => setProgressDraft(Number(e.target.value))}
                  onPointerUp={() => progressDraft != null && progressDraft !== project.progress && void patch({ progress: progressDraft }, `İlerleme %${progressDraft}`)}
                  onKeyUp={() => progressDraft != null && progressDraft !== project.progress && void patch({ progress: progressDraft }, `İlerleme %${progressDraft}`)}
                  className="w-full accent-[var(--color-titanium,#8a9099)] sm:ml-auto sm:w-60"
                  aria-valuetext={`%${progressDraft ?? project.progress}`}
                  data-testid="progress-slider"
                />
                <span className="w-12 text-right font-mono text-sm text-ink tabular-nums">%{progressDraft ?? project.progress}</span>
              </div>
              <ProgressBar value={project.progress} label="Proje ilerlemesi" />
              {(progressDraft ?? project.progress) < STAGE_PROGRESS[project.stage] && (
                <p className="text-[11px] text-muted">Bu aşama için asgari ilerleme %{STAGE_PROGRESS[project.stage]}; daha düşük değer kaydedilirken yükseltilir.</p>
              )}
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
                {project.location || project.address ? (
                  <span className="inline-flex items-start gap-1.5">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-titanium" aria-hidden="true" />
                    <span>
                      {project.location}
                      {project.address && <span className="block text-xs whitespace-pre-wrap text-muted">{project.address}</span>}
                    </span>
                  </span>
                ) : (
                  <span className="text-subtle">—</span>
                )}
                {project.map_url && (
                  <a href={project.map_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-ink-2 underline underline-offset-4">
                    Haritada aç <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
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
              <Detail label="Gerçek tamamlanma">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarCheck className="h-3.5 w-3.5 text-titanium" aria-hidden="true" />
                  {formatDate(project.completed_on)}
                </span>
              </Detail>
              <Detail label="Öncelik">
                <PriorityLabel priority={project.priority} />
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
          <ProjectTasks projectId={project.id} id="gorevler" />
          <RelatedQuotes by="project_id" id={project.id} companyId={project.company_id} />
          <ProjectQuantity projectId={project.id} />
          <ProjectFiles projectId={project.id} />
          <ProjectNotes projectId={project.id} />
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <ProjectTimeline projectId={project.id} />
        </div>
      </div>

      <ProjectForm open={editOpen} onClose={() => setEditOpen(false)} project={project} />
      <ConfirmDialog
        open={confirmDelete}
        title="Proje silinsin mi?"
        message={`"${project.code} · ${project.name}" projesi; notları, dosyaları, görevleri ve işlem geçmişiyle birlikte kalıcı olarak silinecek. Bu işlem geri alınamaz.`}
        confirmLabel="Projeyi sil"
        busy={deleting}
        onConfirm={() => void remove()}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  )
}
