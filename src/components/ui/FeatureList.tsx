import type { LucideIcon } from 'lucide-react'

export interface Feature {
  icon: LucideIcon
  title: string
  description: string
}

/** Bir modülde planlanan yetenekleri listeler. Bunlar çalışan özellikler değil, yol haritasıdır. */
export function FeatureList({ items }: { items: Feature[] }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map(({ icon: Icon, title, description }) => (
        <li key={title} className="flex gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] p-4">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-titanium-300" strokeWidth={1.75} aria-hidden="true" />
          <div>
            <div className="text-sm font-medium text-silver-100">{title}</div>
            <p className="mt-1 text-xs leading-relaxed text-titanium-400">{description}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
