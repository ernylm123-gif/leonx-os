import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Lock, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  icon?: LucideIcon
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-ink shadow-card hover:bg-primary-hover',
  secondary: 'border border-line bg-surface text-ink shadow-card hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-ink',
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
        'inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.98]',
        'disabled:pointer-events-none disabled:opacity-50',
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
}

/** Henüz geliştirilmemiş bir eylem: devre dışıdır ve nedenini açıkça belirtir. */
export function PlannedAction({ icon: Icon, label, phase }: PlannedActionProps) {
  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <button
        type="button"
        disabled
        aria-disabled="true"
        title={`${phase} ile etkinleşecek`}
        className="inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface-2 px-4 text-sm font-semibold text-muted"
      >
        {Icon && <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
        {label}
        <Lock className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
      </button>
      <span className="text-[11px] text-subtle">{phase} ile etkinleşecek</span>
    </div>
  )
}
