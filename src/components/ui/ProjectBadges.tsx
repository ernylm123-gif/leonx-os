import { PRIORITY_LABEL, STAGE_LABEL, STATUS_LABEL, type ProjectPriority, type ProjectStage, type ProjectStatus } from '@/lib/domain'
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

const STAGE_TONE: Record<ProjectStage, string> = {
  yeni_firsat: 'border-line bg-surface-2 text-ink-2',
  teklif_hazirlaniyor: 'border-warn-line bg-warn-soft text-warn',
  teklif_gonderildi: 'border-warn-line bg-warn-soft text-warn',
  gorusme: 'border-warn-line bg-warn-soft text-warn',
  onaylandi: 'border-ok/30 bg-ok-soft text-ok',
  olcu_kesif: 'border-titanium/40 bg-titanium/10 text-ink',
  uretime_hazirlik: 'border-titanium/40 bg-titanium/10 text-ink',
  uretimde: 'border-titanium/40 bg-titanium/10 text-ink',
  montajda: 'border-titanium/40 bg-titanium/10 text-ink',
  tamamlandi: 'border-ok/30 bg-ok-soft text-ok',
  teslim_edildi: 'border-ok/30 bg-ok-soft text-ok',
  iptal: 'border-danger/25 bg-danger-soft text-danger',
}

export function StageBadge({ stage, onHold, className }: { stage: ProjectStage; onHold?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-[3px] text-[11px] font-medium whitespace-nowrap', STAGE_TONE[stage], className)}>
      {STAGE_LABEL[stage]}
      {onHold && <span className="rounded-full bg-surface-3 px-1.5 text-[10px] text-muted">beklemede</span>}
    </span>
  )
}

export function ProgressBar({ value, className, label }: { value: number; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-1.5 min-w-[48px] flex-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? 'İlerleme'}>
        <div className={cn('h-full rounded-full', v >= 100 ? 'bg-ok' : 'bg-titanium')} style={{ width: `${v}%` }} />
      </div>
      <span className="w-9 text-right font-mono text-[11px] text-muted tabular-nums">%{v}</span>
    </div>
  )
}
