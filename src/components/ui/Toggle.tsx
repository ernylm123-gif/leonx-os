import { cn } from '@/lib/cn'

interface ToggleProps {
  id: string
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description?: string
}

export function Toggle({ id, checked, onChange, label, description }: ToggleProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-7 w-12 shrink-0 rounded-full border transition-colors duration-200',
          checked ? 'border-primary bg-primary' : 'border-line-strong bg-surface-3',
        )}
      >
        <span
          className={cn(
            'absolute top-[3px] left-[3px] h-5 w-5 rounded-full shadow-sm transition-transform duration-200',
            checked ? 'translate-x-5 bg-primary-ink' : 'bg-surface',
          )}
        />
      </button>
    </div>
  )
}
