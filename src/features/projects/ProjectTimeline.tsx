import { Calculator, CheckCircle2, FileText, FileUp, Flag, FolderPlus, History, ListPlus, PauseCircle, ScanLine, Send, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Panel } from '@/components/ui/Panel'
import { ErrorState, LoadingState } from '@/components/ui/States'
import type { ProjectEvent } from '@/data/types'
import { listProjectEvents } from '@/data/workflowApi'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useLiveList } from '@/lib/useLiveList'

export const EVENT_ICON: Record<string, { icon: LucideIcon; tone: string }> = {
  proje_olustu: { icon: FolderPlus, tone: 'bg-titanium' },
  asama: { icon: Flag, tone: 'bg-titanium' },
  beklemede: { icon: PauseCircle, tone: 'bg-line-strong' },
  dosya: { icon: FileUp, tone: 'bg-line-strong' },
  cad_analiz: { icon: ScanLine, tone: 'bg-titanium' },
  metraj: { icon: Calculator, tone: 'bg-titanium' },
  metraj_onay: { icon: CheckCircle2, tone: 'bg-ok' },
  teklif: { icon: FileText, tone: 'bg-warn' },
  teklif_gonderildi: { icon: Send, tone: 'bg-warn' },
  teklif_kabul: { icon: ThumbsUp, tone: 'bg-ok' },
  teklif_red: { icon: ThumbsDown, tone: 'bg-danger' },
  gorev_eklendi: { icon: ListPlus, tone: 'bg-line-strong' },
  gorev_tamam: { icon: CheckCircle2, tone: 'bg-ok' },
}

export function EventLine({ e, to }: { e: ProjectEvent; to?: string }) {
  const meta = EVENT_ICON[e.kind] ?? { icon: History, tone: 'bg-line-strong' }
  const Icon = meta.icon
  const body = (
    <div className="min-w-0 pt-0.5">
      <div className="text-sm font-medium text-ink">{e.title}</div>
      {e.detail && <div className="text-xs break-words text-muted">{e.detail}</div>}
      <div className="text-[11px] text-subtle">{formatDateTime(e.created_at)}</div>
    </div>
  )
  return (
    <li className="relative flex gap-3" data-testid="timeline-event" data-kind={e.kind}>
      <span className={cn('relative grid h-6 w-6 shrink-0 place-items-center rounded-full text-white ring-4 ring-surface', meta.tone)} aria-hidden="true">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
      {to ? (
        <Link to={to} className="min-w-0 rounded-md hover:underline">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  )
}

/** Proje zaman çizelgesi: yalnız sunucuda gerçekleşen olaylardan oluşur (tetikleyiciler yazar) */
export function ProjectTimeline({ projectId, className }: { projectId: string; className?: string }) {
  const events = useLiveList<ProjectEvent>('project_events', 'project_id', projectId, (pid) => listProjectEvents(requireSupabase(), pid))
  return (
    <Panel title="İşlem geçmişi" subtitle="Sunucudaki gerçek olaylardan otomatik oluşur" icon={History} className={cn('h-fit', className)}>
      {events.loading ? (
        <LoadingState />
      ) : events.error ? (
        <ErrorState message={events.error} onRetry={() => void events.reload()} />
      ) : events.items.length === 0 ? (
        <p className="text-sm text-subtle">Kayıt yok.</p>
      ) : (
        <ol className="relative flex flex-col gap-4" aria-label="Proje zaman çizelgesi">
          <span className="absolute top-3 bottom-3 left-[11px] w-px bg-line" aria-hidden="true" />
          {events.items.map((e) => (
            <EventLine key={e.id} e={e} />
          ))}
        </ol>
      )}
    </Panel>
  )
}
