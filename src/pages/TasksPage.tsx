import { ListTodo } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { ErrorState, SkeletonRows } from '@/components/ui/States'
import { FilterSelect } from '@/components/ui/Toolbar'
import { useData } from '@/context/data'
import type { ProjectTask } from '@/data/types'
import { listAllTasks } from '@/data/workflowApi'
import { TaskForm, TaskRow, taskState, useTaskToggle } from '@/features/projects/ProjectTasks'
import { addDays, localISODate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useLiveQuery } from '@/lib/useLiveList'

type Group = { key: string; title: string; tone?: string; items: ProjectTask[] }

/** Tüm projelerin görevleri: gecikenler, bugün, bu hafta, sonra, tarihsiz, son tamamlananlar */
export function TasksPage() {
  const { projects } = useData()
  const [params, setParams] = useSearchParams()
  const filter = params.get('filtre') ?? 'acik'
  const { data: tasks, setData, loading, error, reload } = useLiveQuery<ProjectTask[]>(['project_tasks'], () => listAllTasks(requireSupabase()), [])
  const [edit, setEdit] = useState<ProjectTask | null>(null)
  const project = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const replace = (t: ProjectTask) => setData((l) => l.map((x) => (x.id === t.id ? t : x)))
  const toggle = useTaskToggle(replace, () => void reload())

  const groups = useMemo<Group[]>(() => {
    const today = localISODate()
    const week = addDays(today, 7)
    const open = tasks.filter((t) => !t.done)
    const g: Group[] = [
      { key: 'gecikti', title: 'Gecikenler', tone: 'text-danger', items: open.filter((t) => taskState(t, today) === 'gecikti') },
      { key: 'bugun', title: 'Bugün', tone: 'text-warn', items: open.filter((t) => taskState(t, today) === 'bugun') },
      { key: 'hafta', title: 'Önümüzdeki 7 gün', items: open.filter((t) => t.due_date && t.due_date > today && t.due_date <= week) },
      { key: 'sonra', title: 'Daha sonra', items: open.filter((t) => t.due_date && t.due_date > week) },
      { key: 'tarihsiz', title: 'Tarihsiz', items: open.filter((t) => !t.due_date) },
      { key: 'tamam', title: 'Son 30 günde tamamlananlar', tone: 'text-ok', items: tasks.filter((t) => t.done).sort((a, b) => ((a.done_at ?? '') < (b.done_at ?? '') ? 1 : -1)) },
    ]
    if (filter === 'geciken') return g.filter((x) => x.key === 'gecikti')
    if (filter === 'acik') return g.filter((x) => x.key !== 'tamam')
    return g
  }, [tasks, filter])

  const total = groups.reduce((s, g) => s + g.items.length, 0)

  return (
    <>
      <PageHeader icon={ListTodo} code="M09" eyebrow="Genel" title="Görevler" description="Tüm projelerin görevleri ve terminleri. Görevler proje sayfasından eklenir." status="ready" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterSelect value={filter} onChange={(v) => setParams(v === 'acik' ? {} : { filtre: v }, { replace: true })} label="Görev filtresi" className="w-56">
          <option value="acik">Açık görevler</option>
          <option value="geciken">Yalnız gecikenler</option>
          <option value="tumu">Tamamlananlar dahil</option>
        </FilterSelect>
        <span className="text-xs text-muted">{total} görev</span>
      </div>
      {loading && !tasks.length ? (
        <div className="card">
          <SkeletonRows />
        </div>
      ) : error && !tasks.length ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : total === 0 ? (
        <div className="card">
          <EmptyState icon={ListTodo} title={filter === 'geciken' ? 'Geciken görev yok' : 'Görev yok'} description="Proje sayfasındaki “Görev ekle” ile ölçü, sipariş, montaj gibi adımları terminleriyle girin." />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups
            .filter((g) => g.items.length)
            .map((g) => (
              <section key={g.key} className="card overflow-hidden" aria-label={g.title} data-testid={`task-group-${g.key}`}>
                <h2 className={`border-b border-line px-4 py-2.5 text-[13px] font-semibold ${g.tone ?? 'text-ink'}`}>
                  {g.title} <span className="font-mono text-xs text-muted">({g.items.length})</span>
                </h2>
                <ul className="divide-y divide-line px-4">
                  {g.items.map((t) => {
                    const p = project.get(t.project_id)
                    return (
                      <TaskRow
                        key={t.id}
                        task={t}
                        onToggle={() => void toggle(t)}
                        onEdit={t.done ? undefined : () => setEdit(t)}
                        extra={
                          p ? (
                            <Link to={`/projeler/${p.id}?sekme=gorevler`} className="font-mono text-[11px] text-ink-2 underline-offset-4 hover:underline">
                              {p.code}
                            </Link>
                          ) : null
                        }
                      />
                    )
                  })}
                </ul>
              </section>
            ))}
        </div>
      )}
      {edit && <TaskForm open onClose={() => setEdit(null)} projectId={edit.project_id} task={edit} onSaved={replace} />}
    </>
  )
}
