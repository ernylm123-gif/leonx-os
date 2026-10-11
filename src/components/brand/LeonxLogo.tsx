import { useId } from 'react'
import { cn } from '@/lib/cn'

interface LeonxMarkProps {
  className?: string
}

/** LEONX OS amblemi — fırçalanmış gümüş "L" profil kesiti. */
export function LeonxMark({ className }: LeonxMarkProps) {
  const id = useId()
  return (
    <svg viewBox="0 0 40 40" className={cn('h-9 w-9 shrink-0', className)} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6f7f8" />
          <stop offset="0.45" stopColor="#a6abb2" />
          <stop offset="0.7" stopColor="#e6e8eb" />
          <stop offset="1" stopColor="#8d939b" />
        </linearGradient>
        <linearGradient id={`${id}-base`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b3038" />
          <stop offset="1" stopColor="#15171b" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="39" height="39" rx="10" fill={`url(#${id}-base)`} stroke="rgb(255 255 255 / 0.08)" />
      <path d="M11 9h5v17h13v5H11z" fill={`url(#${id}-metal)`} />
      <path d="M20 9h9l-4.5 7.5z" fill={`url(#${id}-metal)`} opacity="0.7" />
    </svg>
  )
}

interface LeonxLogoProps {
  compact?: boolean
  className?: string
}

export function LeonxLogo({ compact = false, className }: LeonxLogoProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <LeonxMark />
      {!compact && (
        <div className="leading-none">
          <div className="text-brushed text-[15px] font-bold tracking-[0.28em]">LEONX</div>
          <div className="mt-1 text-[10px] font-medium tracking-[0.34em] text-titanium-400">OS · METAL</div>
        </div>
      )}
    </div>
  )
}
