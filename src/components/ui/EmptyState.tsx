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
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="relative mb-5">
        <div className="absolute inset-0 rounded-2xl bg-silver-300/10 blur-xl" aria-hidden="true" />
        <div className="relative grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-gradient-to-b from-anthracite-700 to-anthracite-800">
          <Icon className="h-6 w-6 text-silver-200" strokeWidth={1.5} aria-hidden="true" />
        </div>
      </div>
      <h3 className="text-base font-semibold text-silver-50">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-titanium-400">{description}</p>
      {children && <div className="mt-6">{children}</div>}
    </div>
  )
}
