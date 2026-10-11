import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  children?: ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, children, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center sm:py-14', className)}>
      <div className="relative mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-line bg-surface shadow-card">
        <span className="absolute inset-1.5 rounded-xl border border-dashed border-line" aria-hidden="true" />
        <Icon className="relative h-6 w-6 text-titanium" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{description}</p>
      {children && <div className="mt-6">{children}</div>}
    </div>
  )
}
