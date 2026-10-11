import { COMPANY } from '@/config/company'

/** LEONX Metal faaliyet alanları — gerçek iş kategorileri, veri değildir. */
export function CategoryChips({ label }: { label: string }) {
  return (
    <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" aria-label={label}>
      {COMPANY.disciplines.map((d) => (
        <li
          key={d}
          className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 shadow-card"
        >
          {d}
        </li>
      ))}
    </ul>
  )
}
