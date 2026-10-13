import type { ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'

export function SearchInput({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        enterKeyHint="search"
        className="h-11 w-full rounded-xl border border-line bg-surface pr-10 pl-10 text-base text-ink shadow-card placeholder:text-subtle focus:border-titanium focus:ring-2 focus:ring-titanium/20 focus:outline-none sm:text-sm [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-subtle hover:text-ink"
          aria-label="Aramayı temizle"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

export function FilterSelect({
  value,
  onChange,
  label,
  children,
  className,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={cn(
        'h-11 min-w-0 appearance-none rounded-xl border border-line bg-surface bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9 pl-3 text-base text-ink shadow-card focus:border-titanium focus:outline-none sm:text-sm',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23707985' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
    >
      {children}
    </select>
  )
}
