import { CalendarClock, GripVertical } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PriorityLabel, ProgressBar } from '@/components/ui/ProjectBadges'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { ConflictError, updateProjectStage } from '@/data/api'
import type { Project } from '@/data/types'
import { cn } from '@/lib/cn'
import { PROJECT_STAGES, type ProjectStage, STAGE_LABEL } from '@/lib/domain'
import { dataErrorMessage } from '@/lib/errors'
import { daysUntil, formatDate, localISODate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'

const GROUP_LABEL = { satis: 'Satış', uygulama: 'Uygulama', kapanis: 'Kapanış' } as const

/**
 * Aşama panosu: her aşama bir sütun. Masaüstünde kart sürüklenerek, dokunmatik cihazlarda
 * kart üzerindeki seçimle aşama değiştirilir. Değişiklik sürüm denetimiyle kaydedilir.
 */
export function ProjectKanban({ projects, companyName, showClosed }: { projects: Project[]; companyName: Map<string, string>; showClosed: boolean }) {
  const { upsertProject, refresh } = useData()
  const { notify } = useToast()
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<ProjectStage | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const stages = PROJECT_STAGES.filter((s) => showClosed || s.group !== 'kapanis' || projects.some((p) => p.stage === s.value))
  const today = localISODate()

  const move = async (p: Project, stage: ProjectStage) => {
    if (p.stage === stage) return
    setBusy(p.id)
    try {
      const saved = await updateProjectStage(requireSupabase(), p.id, p.version, { stage })
      upsertProject(saved)
      notify(`${p.code}: ${STAGE_LABEL[stage]}`)
    } catch (err) {
      if (err instanceof ConflictError) {
        notify('Proje başka bir cihazda güncellendi; pano yenilendi.', 'error')
        void refresh()
      } else notify(dataErrorMessage(err, 'Aşama güncelleme'), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="overflow-x-auto overscroll-x-contain pb-2" data-testid="project-kanban">
      <div className="flex min-w-max gap-3">
        {stages.map((s, i) => {
          const items = projects.filter((p) => p.stage === s.value)
          const firstOfGroup = i === 0 || stages[i - 1].group !== s.group
          return (
            <section
              key={s.value}
              aria-label={`${s.label} (${items.length})`}
              className={cn('flex w-[260px] shrink-0 flex-col rounded-xl border bg-surface-2/60 transition-colors', over === s.value ? 'border-titanium bg-titanium/10' : 'border-line')}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                setOver(s.value)
              }}
              onDragLeave={() => setOver((o) => (o === s.value ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                const p = projects.find((x) => x.id === dragId)
                setOver(null)
                setDragId(null)
                if (p) void move(p, s.value)
              }}
              data-testid="kanban-column"
              data-stage={s.value}
            >
              <header className="border-b border-line px-3 py-2.5">
                {firstOfGroup && <div className="font-mono text-[10px] tracking-[0.12em] text-subtle uppercase">{GROUP_LABEL[s.group]}</div>}
                <div className="flex items-center justify-between gap-2">
                  <h3 className="truncate text-[13px] font-semibold text-ink">{s.label}</h3>
                  <span className="rounded-full bg-surface px-2 py-0.5 font-mono text-[11px] text-muted">{items.length}</span>
                </div>
              </header>
              <ul className="flex min-h-[80px] flex-col gap-2 p-2">
                {items.map((p) => {
                  const late = p.due_date ? daysUntil(p.due_date, today) < 0 && s.group !== 'kapanis' : false
                  return (
                    <li
                      key={p.id}
                      draggable
                      onDragStart={(e) => {
                        setDragId(p.id)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', p.id)
                      }}
                      onDragEnd={() => {
                        setDragId(null)
                        setOver(null)
                      }}
                      className={cn('rounded-lg border border-line bg-surface p-2.5 shadow-card', busy === p.id && 'opacity-60', dragId === p.id && 'opacity-40')}
                      data-testid="kanban-card"
                      data-code={p.code}
                    >
                      <div className="flex items-start gap-1.5">
                        <GripVertical className="mt-0.5 hidden h-3.5 w-3.5 shrink-0 cursor-grab text-subtle lg:block" aria-hidden="true" />
                        <Link to={`/projeler/${p.id}`} className="min-w-0 flex-1">
                          <span className="block font-mono text-[10.5px] text-subtle">{p.code}</span>
                          <span className="block text-[13px] leading-snug font-medium break-words text-ink hover:underline">{p.name}</span>
                          <span className="mt-0.5 block truncate text-[11.5px] text-muted">{p.company_id ? companyName.get(p.company_id) ?? '—' : 'Firma yok'}</span>
                        </Link>
                      </div>
                      <ProgressBar value={p.progress} className="mt-2" label={`${p.code} ilerleme`} />
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
                        <PriorityLabel priority={p.priority} />
                        {p.due_date && (
                          <span className={cn('inline-flex items-center gap-1', late ? 'font-medium text-danger' : 'text-muted')}>
                            <CalendarClock className="h-3 w-3" aria-hidden="true" />
                            {formatDate(p.due_date)}
                          </span>
                        )}
                        {p.on_hold && <span className="rounded-full bg-surface-3 px-1.5 text-muted">beklemede</span>}
                      </div>
                      <label className="sr-only" htmlFor={`move-${p.id}`}>
                        {p.code} aşamasını değiştir
                      </label>
                      <select
                        id={`move-${p.id}`}
                        value={p.stage}
                        disabled={busy === p.id}
                        onChange={(e) => void move(p, e.target.value as ProjectStage)}
                        className="mt-2 h-8 w-full rounded-md border border-line bg-surface-2 px-1.5 text-base text-ink-2 sm:text-[12px]"
                        data-testid="kanban-move"
                      >
                        {PROJECT_STAGES.map((o) => (
                          <option key={o.value} value={o.value}>
                            → {o.label}
                          </option>
                        ))}
                      </select>
                    </li>
                  )
                })}
                {items.length === 0 && <li className="px-1 py-3 text-center text-[11.5px] text-subtle">Proje yok</li>}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
