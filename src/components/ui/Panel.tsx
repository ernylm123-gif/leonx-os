import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

interface PanelProps {
  title?: string
  subtitle?: string
  icon?: LucideIcon
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

export function Panel({ title, subtitle, icon: Icon, actions, children, className, bodyClassName }: PanelProps) {
  return (
    <section className={cn('card min-w-0', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {Icon && (
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-surface-2">
                <Icon className="h-4 w-4 text-titanium" strokeWidth={1.75} aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0">
              {title && <h2 className="truncate text-[14px] font-semibold text-ink">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  )
}
