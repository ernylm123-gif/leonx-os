import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { StatusPill } from './StatusPill'
import type { ModuleStatus } from '@/config/navigation'

interface PageHeaderProps {
  icon: LucideIcon
  eyebrow?: string
  title: string
  description: string
  status?: ModuleStatus
  actions?: ReactNode
}

export function PageHeader({ icon: Icon, eyebrow, title, description, status, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-5 sm:mb-8 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <div className="brushed-silver grid h-12 w-12 shrink-0 place-items-center rounded-2xl shadow-[0_1px_0_rgb(255_255_255/0.6)_inset,0_12px_24px_-12px_rgb(0_0_0/0.9)]">
          <Icon className="h-6 w-6 text-anthracite-900" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {eyebrow && (
              <span className="text-[11px] font-semibold tracking-[0.2em] text-titanium-400 uppercase">{eyebrow}</span>
            )}
            {status === 'planned' && <StatusPill tone="planned">Geliştirme aşamasında</StatusPill>}
            {status === 'ready' && <StatusPill tone="ready">Kullanıma hazır</StatusPill>}
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-silver-50 sm:text-3xl">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-titanium-400">{description}</p>
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-3 lg:shrink-0">{actions}</div>}
    </header>
  )
}
