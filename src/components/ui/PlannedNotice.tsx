import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/cn'

interface PlannedNoticeProps {
  children: ReactNode
  className?: string
}

/** Modülün iş mantığının henüz bağlanmadığını açıkça belirten bilgi şeridi. */
export function PlannedNotice({ children, className }: PlannedNoticeProps) {
  return (
    <div
      role="note"
      className={cn(
        'flex items-start gap-3 rounded-xl border border-signal-amber/20 bg-signal-amber/[0.06] px-4 py-3 text-sm text-silver-200',
        className,
      )}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-signal-amber" aria-hidden="true" />
      <div className="leading-relaxed">{children}</div>
    </div>
  )
}
