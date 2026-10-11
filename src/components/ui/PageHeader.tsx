import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { StatusPill } from './StatusPill'
import type { ModuleStatus } from '@/config/navigation'

interface PageHeaderProps {
  icon: LucideIcon
  code: string
  eyebrow?: string
  title: string
  description: string
  status?: ModuleStatus
  actions?: ReactNode
}

export function PageHeader({ icon: Icon, code, eyebrow, title, description, status, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 sm:mb-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="brushed relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl shadow-[0_1px_0_rgb(255_255_255/0.7)_inset,0_6px_14px_-8px_rgb(16_24_40/0.45)] sm:h-14 sm:w-14">
            <Icon className="h-6 w-6 text-anthracite" strokeWidth={1.6} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <span className="font-mono text-[11px] font-medium text-subtle">{code}</span>
              {eyebrow && (
                <>
                  <span className="h-3 w-px bg-line-strong" aria-hidden="true" />
                  <span className="text-[11px] font-semibold tracking-[0.18em] text-muted uppercase">{eyebrow}</span>
                </>
              )}
              {status === 'planned' && <StatusPill tone="planned">Geliştirme aşamasında</StatusPill>}
              {status === 'ready' && <StatusPill tone="ready">Kullanıma hazır</StatusPill>}
            </div>
            <h1 className="mt-1.5 text-[26px] leading-tight font-semibold tracking-[-0.015em] text-ink sm:text-[32px]">
              {title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted sm:text-[15px]">{description}</p>
          </div>
        </div>
        {actions && <div className="flex flex-wrap gap-3 lg:shrink-0">{actions}</div>}
      </div>
      <div className="ruler mt-6 opacity-80" aria-hidden="true" />
    </header>
  )
}
