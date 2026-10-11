import { forwardRef, type ButtonHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  icon?: LucideIcon
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'brushed-silver text-anthracite-950 shadow-[0_1px_0_rgb(255_255_255/0.6)_inset,0_8px_20px_-10px_rgb(0_0_0/0.8)] hover:brightness-105',
  secondary: 'border border-white/10 bg-white/[0.04] text-silver-100 hover:bg-white/[0.08]',
  ghost: 'text-titanium-300 hover:bg-white/[0.05] hover:text-silver-100',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', icon: Icon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition',
        'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:brightness-100',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
      {children}
    </button>
  )
})

interface PlannedActionProps {
  icon?: LucideIcon
  label: string
  /** Özelliğin hangi aşamada geleceği */
  phase: string
  variant?: Variant
}

/** Henüz geliştirilmemiş bir eylem: devre dışıdır ve nedenini açıkça belirtir. */
export function PlannedAction({ icon, label, phase, variant = 'primary' }: PlannedActionProps) {
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button variant={variant} icon={icon} disabled aria-describedby={undefined} title={`${phase} ile etkinleşecek`}>
        {label}
      </Button>
      <span className="text-[11px] text-titanium-500">{phase} ile etkinleşecek</span>
    </div>
  )
}
