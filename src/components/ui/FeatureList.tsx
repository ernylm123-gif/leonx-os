import type { LucideIcon } from 'lucide-react'
import { Panel } from './Panel'

export interface Feature {
  icon: LucideIcon
  title: string
  description: string
}

/** Bir modülde planlanan yetenekleri listeler. Bunlar çalışan özellikler değil, yol haritasıdır. */
export function FeatureList({ items }: { items: Feature[] }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map(({ icon: Icon, title, description }, i) => (
        <li key={title} className="flex gap-3 rounded-xl border border-line bg-surface-2/60 p-4">
          <span className="font-mono text-[10px] leading-5 text-subtle">{String(i + 1).padStart(2, '0')}</span>
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-titanium" strokeWidth={1.75} aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">{title}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** "Planlanan yetenekler" paneli — tüm modüllerde aynı başlık ve açıklama. */
export function RoadmapPanel({ items, className }: { items: Feature[]; className?: string }) {
  return (
    <Panel title="Planlanan yetenekler" subtitle="Yol haritası — henüz çalışan özellikler değildir" className={className ?? 'mt-6'}>
      <FeatureList items={items} />
    </Panel>
  )
}
