import { PRIORITY_LABEL, STATUS_LABEL, type ProjectPriority, type ProjectStatus } from '@/lib/domain'
import { cn } from '@/lib/cn'

const STATUS_TONE: Record<ProjectStatus, string> = {
  kesif: 'border-line bg-surface-2 text-ink-2',
  olcu: 'border-line bg-surface-2 text-ink-2',
  tasarim: 'border-line bg-surface-2 text-ink-2',
  teklif: 'border-warn-line bg-warn-soft text-warn',
  uretim: 'border-titanium/40 bg-titanium/10 text-ink',
  montaj: 'border-titanium/40 bg-titanium/10 text-ink',
  tamamlandi: 'border-ok/30 bg-ok-soft text-ok',
  beklemede: 'border-line bg-surface-3 text-muted',
  iptal: 'border-danger/25 bg-danger-soft text-danger',
}

export function StatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-[3px] text-[11px] font-medium whitespace-nowrap', STATUS_TONE[status], className)}>
      {STATUS_LABEL[status]}
    </span>
  )
}

const PRIORITY_DOT: Record<ProjectPriority, string> = {
  dusuk: 'bg-line-strong',
  normal: 'bg-titanium',
  yuksek: 'bg-warn',
  acil: 'bg-danger',
}

export function PriorityLabel({ priority }: { priority: ProjectPriority }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted">
      <span className={cn('h-1.5 w-1.5 rounded-full', PRIORITY_DOT[priority])} aria-hidden="true" />
      {PRIORITY_LABEL[priority]}
    </span>
  )
}
