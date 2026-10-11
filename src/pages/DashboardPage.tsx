import { ArrowUpRight, CheckCircle2, Circle, CircleSlash, LayoutDashboard, Layers, PlugZap } from 'lucide-react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { StatusPill } from '@/components/ui/StatusPill'
import { APP, COMPANY, INTEGRATIONS, ROADMAP } from '@/config/company'
import { NAV_ITEMS } from '@/config/navigation'

const KPIS = [
  { label: 'Aktif projeler', source: 'Projeler' },
  { label: 'Bekleyen teklifler', source: 'Teklifler' },
  { label: 'Analiz edilen çizimler', source: 'CAD Analiz' },
  { label: 'Kayıtlı firmalar', source: 'Firmalar' },
]

const modules = NAV_ITEMS.filter((i) => i.path !== '/')

export function DashboardPage() {
  return (
    <>
      <PageHeader
        icon={LayoutDashboard}
        code="M00"
        eyebrow={COMPANY.name}
        title="Dashboard"
        description="Proje, metraj ve teklif süreçlerinin tek merkezden yönetimi. Veri kaynakları bağlandıkça göstergeler burada canlı olarak görünecek."
        status="ready"
      />

      {/* Göstergeler — veri kaynağı bağlanana kadar değer gösterilmez */}
      <section aria-label="Temel göstergeler" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {KPIS.map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.03 * i, duration: 0.28 }}
            className="card relative min-w-0 overflow-hidden p-4 sm:p-5"
          >
            <span className="brushed absolute inset-x-0 top-0 h-[2px] opacity-70" aria-hidden="true" />
            <div className="flex items-start justify-between gap-2">
              <div className="text-[12.5px] font-medium text-muted">{kpi.label}</div>
              <span className="hidden font-mono text-[10px] text-subtle sm:inline">{kpi.source}</span>
            </div>
            <div className="mt-3 font-mono text-[28px] leading-none font-medium text-line-strong sm:text-[32px]" aria-label="Veri yok">
              —
            </div>
            <div className="mt-3 flex items-start gap-1.5 text-[11px] text-subtle">
              <CircleSlash className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="leading-snug">Veri kaynağı bağlı değil</span>
            </div>
          </motion.div>
        ))}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel
          title="Modüller"
          subtitle="Arayüzler hazır; iş mantığı aşamalı olarak eklenecek"
          icon={Layers}
          className="xl:col-span-2"
        >
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {modules.map((m) => (
              <li key={m.path} className="min-w-0">
                <Link
                  to={m.path}
                  className="group flex h-full items-start gap-3.5 rounded-xl border border-line bg-surface p-4 transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-px hover:border-line-strong hover:shadow-hover"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 transition-colors group-hover:bg-surface-3">
                    <m.icon className="h-[18px] w-[18px] text-titanium transition-colors group-hover:text-ink" strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{m.label}</span>
                      <span className="font-mono text-[10px] text-subtle">{m.code}</span>
                      <ArrowUpRight
                        className="ml-auto h-4 w-4 shrink-0 text-subtle transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ink"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted">{m.description}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Sistem durumu" subtitle={`${APP.name} v${APP.version}`} icon={PlugZap}>
            <ul className="flex flex-col divide-y divide-line">
              <li className="flex items-center justify-between gap-3 pb-3 text-sm">
                <span className="text-ink-2">Arayüz ve yönlendirme</span>
                <StatusPill tone="ready">Çalışıyor</StatusPill>
              </li>
              {INTEGRATIONS.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-3 py-3 text-sm last:pb-0">
                  <span className="min-w-0 truncate text-ink-2">{s.label}</span>
                  <StatusPill tone="offline">Bağlı değil</StatusPill>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Geliştirme yol haritası" subtitle={APP.stage} icon={CheckCircle2}>
            <ol className="relative flex flex-col gap-4">
              <span className="absolute top-2 bottom-2 left-[7px] w-px bg-line" aria-hidden="true" />
              {ROADMAP.map((r) => (
                <li key={r.title} className="relative flex items-start gap-3">
                  {r.done ? (
                    <CheckCircle2 className="relative h-[15px] w-[15px] shrink-0 bg-surface text-ok" aria-hidden="true" />
                  ) : (
                    <Circle className="relative h-[15px] w-[15px] shrink-0 bg-surface text-line-strong" aria-hidden="true" />
                  )}
                  <div className="-mt-0.5">
                    <div className="font-mono text-[10.5px] font-medium tracking-wider text-subtle uppercase">{r.phase}</div>
                    <div className={r.done ? 'text-sm text-ink' : 'text-sm text-muted'}>
                      {r.title}
                      <span className="sr-only">{r.done ? ' (tamamlandı)' : ' (planlandı)'}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  )
}
