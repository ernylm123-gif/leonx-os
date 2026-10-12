import { BarChart3, ClipboardList, FileBarChart, Layers, LineChart, ListChecks } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { StatusPill } from '@/components/ui/StatusPill'
import { useData } from '@/context/data'
import { countByCategory, countByStatus } from '@/lib/stats'

function BarList({ rows, total, hrefFor }: { rows: { value: string; label: string; count: number }[]; total: number; hrefFor: (v: string) => string }) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => {
        const pct = total ? Math.round((r.count / total) * 100) : 0
        return (
          <li key={r.value}>
            <Link to={hrefFor(r.value)} className="group block rounded-lg focus-visible:outline-offset-4">
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-ink-2 group-hover:text-ink">{r.label}</span>
                <span className="shrink-0 font-mono text-xs text-muted">
                  {r.count}
                  <span className="ml-1.5 text-subtle">{pct}%</span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                <div className="brushed h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%` }} />
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

const PLANNED = [
  { code: 'R03', icon: LineChart, title: 'Teklif dönüşüm raporu', source: 'Teklifler' },
  { code: 'R04', icon: ClipboardList, title: 'Malzeme ihtiyaç raporu', source: 'Metraj' },
]

export function ReportsPage() {
  const { projects, loading } = useData()
  const total = projects.length
  const byStatus = countByStatus(projects)
  const byCategory = countByCategory(projects).filter((c) => c.count > 0)

  return (
    <>
      <PageHeader
        icon={BarChart3}
        code="M07"
        eyebrow="Ticari"
        title="Raporlar"
        description="Kayıtlı projelerden temel özetler. Teklif ve metraj raporları, ilgili modüller geliştirildiğinde eklenecek."
        status="ready"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Durumlara göre projeler" subtitle={`R01 · ${total} proje`} icon={ListChecks}>
          {loading && !total ? (
            <div className="h-48 animate-pulse rounded-xl bg-surface-2" />
          ) : total === 0 ? (
            <p className="py-8 text-center text-sm text-subtle">Rapor için henüz proje kaydı yok.</p>
          ) : (
            <BarList rows={byStatus} total={total} hrefFor={(v) => `/projeler?durum=${v}`} />
          )}
        </Panel>
        <Panel title="Kategorilere göre projeler" subtitle={`R02 · ${byCategory.length} kategori`} icon={Layers}>
          {loading && !total ? (
            <div className="h-48 animate-pulse rounded-xl bg-surface-2" />
          ) : total === 0 ? (
            <p className="py-8 text-center text-sm text-subtle">Rapor için henüz proje kaydı yok.</p>
          ) : (
            <BarList rows={byCategory} total={total} hrefFor={(v) => `/projeler?durum=tumu&kategori=${v}`} />
          )}
        </Panel>
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-ink">Planlanan raporlar</h2>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {PLANNED.map(({ code, icon: Icon, title, source }) => (
          <li key={code} className="card flex items-center gap-4 p-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-surface-2">
              <Icon className="h-[18px] w-[18px] text-titanium" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-ink">{title}</span>
                <span className="font-mono text-[10px] text-subtle">{code}</span>
              </div>
              <div className="text-xs text-muted">Kaynak modül: {source} (henüz geliştirilmedi)</div>
            </div>
            <StatusPill tone="offline">Veri yok</StatusPill>
          </li>
        ))}
        <li className="card flex items-center gap-4 p-5 md:col-span-2">
          <FileBarChart className="h-5 w-5 shrink-0 text-titanium" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-muted">Finansal rapor üretilmez: teklif ve fiyatlandırma motoru olmadan tutar hesaplanmaz.</p>
        </li>
      </ul>
    </>
  )
}
