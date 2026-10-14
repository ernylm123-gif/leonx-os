import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SupportLevel } from '@/cad/types'
import { cn } from '@/lib/cn'

/** Araç çubuğu düğmesi: simge + erişilebilir ad + kısayol ipucu */
export function ToolButton({
  icon: Icon,
  label,
  shortcut,
  active,
  disabled,
  onClick,
  className,
  testId,
}: {
  icon: LucideIcon
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  className?: string
  testId?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={shortcut ? `${label} (${shortcut})` : label}
      title={shortcut ? `${label} — ${shortcut}` : label}
      data-testid={testId}
      className={cn(
        'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors',
        'hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-primary text-primary-ink hover:bg-primary-hover hover:text-primary-ink',
        className,
      )}
    >
      <Icon className="h-[17px] w-[17px]" strokeWidth={1.9} aria-hidden="true" />
    </button>
  )
}

export function ToolDivider() {
  return <span className="mx-1 h-6 w-px shrink-0 bg-line" aria-hidden="true" />
}

export interface TabDef<T extends string> {
  id: T
  label: string
  icon?: LucideIcon
  badge?: number | string | null
}

export function PanelTabs<T extends string>({ tabs, value, onChange, label }: { tabs: TabDef<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-2 pt-2">
      {tabs.map((t) => {
        const on = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cn(
              'relative flex h-9 shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 text-[12.5px] font-semibold transition-colors',
              on ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {t.icon && <t.icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
            {t.label}
            {t.badge != null && t.badge !== 0 && (
              <span className="rounded-md bg-surface-3 px-1.5 py-px font-mono text-[10px] text-ink-2">{t.badge}</span>
            )}
            {on && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-ink" aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}

const LEVEL: Record<SupportLevel, { label: string; cls: string }> = {
  tam: { label: 'Tam', cls: 'border-ok/30 bg-ok-soft text-ok' },
  kismi: { label: 'Kısmi', cls: 'border-warn-line bg-warn-soft text-warn' },
  desteklenmiyor: { label: 'Desteklenmiyor', cls: 'border-danger/30 bg-danger-soft text-danger' },
}

export function SupportBadge({ level }: { level: SupportLevel }) {
  const l = LEVEL[level]
  return <span className={cn('inline-flex shrink-0 items-center rounded-md border px-1.5 py-px text-[10.5px] font-semibold', l.cls)}>{l.label}</span>
}

export function StatusChip({ tone, children, title }: { tone: 'ok' | 'warn' | 'danger' | 'muted'; children: ReactNode; title?: string }) {
  const cls = {
    ok: 'border-ok/30 bg-ok-soft text-ok',
    warn: 'border-warn-line bg-warn-soft text-warn',
    danger: 'border-danger/30 bg-danger-soft text-danger',
    muted: 'border-line bg-surface-2 text-muted',
  }[tone]
  return (
    <span title={title} className={cn('inline-flex max-w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-[11px] font-semibold', cls)}>
      {children}
    </span>
  )
}

export function Section({ title, children, actions, className }: { title: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={cn('border-b border-line px-4 py-3.5 last:border-b-0', className)}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function KV({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[12.5px]">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className={cn('min-w-0 truncate text-right text-ink', mono && 'font-mono text-[12px]')}>{v}</dd>
    </div>
  )
}

export function MiniButton({
  children,
  onClick,
  disabled,
  tone = 'default',
  title,
  testId,
  className,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'primary' | 'danger'
  title?: string
  testId?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
      className={cn(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-45',
        tone === 'primary' && 'bg-primary text-primary-ink hover:bg-primary-hover',
        tone === 'default' && 'border border-line bg-surface text-ink hover:bg-surface-2',
        tone === 'danger' && 'border border-danger/30 bg-danger-soft text-danger hover:brightness-95',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function rgbCss(rgb: number | null, fallback = 'var(--ink)'): string {
  return rgb == null ? fallback : `#${rgb.toString(16).padStart(6, '0')}`
}
