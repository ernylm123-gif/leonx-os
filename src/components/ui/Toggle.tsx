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
      <label htmlFor={id} className="cursor-pointer">
        <span className="block text-sm font-medium text-silver-100">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-titanium-400">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
          checked ? 'brushed-silver border-white/30' : 'border-white/10 bg-anthracite-700',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 h-[18px] w-[18px] rounded-full shadow transition-transform',
            checked ? 'translate-x-5 bg-anthracite-900' : 'bg-titanium-400',
          )}
        />
      </button>
    </div>
  )
}
