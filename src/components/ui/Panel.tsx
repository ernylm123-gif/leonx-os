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
    <section className={cn('panel', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.05] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {Icon && (
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.03]">
                <Icon className="h-4 w-4 text-silver-300" strokeWidth={1.75} aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0">
              {title && <h2 className="truncate text-sm font-semibold text-silver-50">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-xs text-titanium-400">{subtitle}</p>}
            </div>
          </div>
          {actions}
        </header>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  )
}
