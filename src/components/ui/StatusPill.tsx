import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Tone = 'ready' | 'planned' | 'offline' | 'neutral'

const TONES: Record<Tone, { wrap: string; dot: string }> = {
  ready: { wrap: 'border-ok/25 bg-ok-soft text-ok', dot: 'bg-ok' },
  planned: { wrap: 'border-warn-line bg-warn-soft text-warn', dot: 'bg-warn' },
  offline: { wrap: 'border-line bg-surface-2 text-muted', dot: 'bg-subtle' },
  neutral: { wrap: 'border-line bg-surface text-ink-2', dot: 'bg-titanium' },
}

interface StatusPillProps {
  tone: Tone
  children: ReactNode
  className?: string
}

export function StatusPill({ tone, children, className }: StatusPillProps) {
  const t = TONES[tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-medium whitespace-nowrap',
        t.wrap,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', t.dot)} aria-hidden="true" />
      {children}
    </span>
  )
}
