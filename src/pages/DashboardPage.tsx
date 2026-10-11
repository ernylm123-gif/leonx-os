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
        eyebrow={COMPANY.name}
        title="Dashboard"
        description="LEONX Metal proje, metraj ve teklif süreçlerinin tek merkezden yönetimi. Veri kaynakları bağlandıkça göstergeler burada canlı olarak görünecek."
        status="ready"
      />

      {/* Göstergeler — veri kaynağı bağlanana kadar değer gösterilmez */}
      <section aria-label="Temel göstergeler" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {KPIS.map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 * i, duration: 0.3 }}
            className="panel relative overflow-hidden p-4 sm:p-5"
          >
            <div className="hairline absolute inset-x-0 top-0 opacity-50" aria-hidden="true" />
            <div className="text-xs font-medium text-titanium-400">{kpi.label}</div>
            <div className="mt-3 font-mono text-3xl font-medium text-titanium-600" aria-label="Veri yok">
              —
            </div>
            <div className="mt-3 flex items-start gap-1.5 text-[11px] text-titanium-500">
              <CircleSlash className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="leading-snug">Veri kaynağı bağlı değil</span>
            </div>
          </motion.div>
        ))}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel
          title="Modüller"
          subtitle="Tüm modüllerin arayüzü hazır; iş mantığı aşamalı olarak eklenecek"
          icon={Layers}
          className="xl:col-span-2"
        >
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {modules.map((m) => (
              <li key={m.path}>
                <Link
                  to={m.path}
                  className="group flex h-full items-start gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] p-4 transition hover:border-white/[0.12] hover:bg-white/[0.05]"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-gradient-to-b from-anthracite-700 to-anthracite-800">
                    <m.icon className="h-[18px] w-[18px] text-silver-200" strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-silver-50">{m.label}</span>
                      <ArrowUpRight
                        className="h-3.5 w-3.5 text-titanium-500 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-silver-200"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-titanium-400">{m.description}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="Sistem durumu" subtitle={`${APP.name} v${APP.version}`} icon={PlugZap}>
            <ul className="flex flex-col gap-3">
              <li className="flex items-center justify-between gap-3 text-sm">
                <span className="text-silver-200">Arayüz ve yönlendirme</span>
                <StatusPill tone="ready">Çalışıyor</StatusPill>
              </li>
              {INTEGRATIONS.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-silver-200">{s.label}</span>
                  <StatusPill tone="offline">Bağlı değil</StatusPill>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Geliştirme yol haritası" subtitle={APP.stage} icon={CheckCircle2}>
            <ol className="relative flex flex-col gap-4">
              <span className="absolute top-2 bottom-2 left-[7px] w-px bg-white/[0.08]" aria-hidden="true" />
              {ROADMAP.map((r) => (
                <li key={r.phase} className="relative flex items-start gap-3">
                  {r.done ? (
                    <CheckCircle2 className="relative h-[15px] w-[15px] shrink-0 bg-anthracite-850 text-signal-green" aria-hidden="true" />
                  ) : (
                    <Circle className="relative h-[15px] w-[15px] shrink-0 bg-anthracite-850 text-titanium-600" aria-hidden="true" />
                  )}
                  <div className="-mt-0.5">
                    <div className="text-[11px] font-semibold tracking-wider text-titanium-500 uppercase">{r.phase}</div>
                    <div className={r.done ? 'text-sm text-silver-100' : 'text-sm text-titanium-400'}>
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
