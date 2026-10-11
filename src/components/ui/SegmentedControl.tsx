import { motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
}

interface SegmentedControlProps<T extends string> {
  name: string
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  layoutId: string
}

/** Radyo grubu olarak çalışan bölümlü seçim (örn. tema). */
export function SegmentedControl<T extends string>({ name, value, options, onChange, layoutId }: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" aria-label={name} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-line bg-surface-2 p-1">
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative flex h-10 min-w-0 items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium transition-colors',
              selected ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {selected && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-lg border border-line bg-surface shadow-card"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            {o.icon && <o.icon className="relative h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />}
            <span className="relative truncate">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
