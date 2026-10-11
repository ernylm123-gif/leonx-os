import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Tone = 'ready' | 'planned' | 'offline' | 'neutral'

const TONES: Record<Tone, { dot: string; text: string }> = {
  ready: { dot: 'bg-signal-green', text: 'text-signal-green' },
  planned: { dot: 'bg-signal-amber', text: 'text-signal-amber' },
  offline: { dot: 'bg-titanium-500', text: 'text-titanium-300' },
  neutral: { dot: 'bg-silver-300', text: 'text-silver-200' },
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
        'inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium whitespace-nowrap',
        t.text,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', t.dot)} aria-hidden="true" />
      {children}
    </span>
  )
}
