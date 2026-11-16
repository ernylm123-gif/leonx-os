import { AlertTriangle, ArrowUpRight, Bell, CalendarClock, CheckCircle2, Circle, FileText, History, LayoutDashboard, Layers, PlugZap } from 'lucide-react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { StageBadge } from '@/components/ui/ProjectBadges'
import { QuoteStatusBadge } from '@/features/quotes/shared'
import { useNotifications } from '@/context/notifications'
import type { ProjectEvent, ProjectTask } from '@/data/types'
import { listAllTasks, listRecentEvents } from '@/data/workflowApi'
import { listQuotes } from '@/data/quoteApi'
import type { Quote } from '@/quote/types'
import { EventLine } from '@/features/projects/ProjectTimeline'
import { taskState } from '@/features/projects/ProjectTasks'
import { NotificationItem } from '@/features/notifications/NotificationItem'
import { requireSupabase } from '@/lib/supabase'
import { useLiveQuery } from '@/lib/useLiveList'
import { QUOTE_STAGES } from '@/lib/domain'
import { StatusPill } from '@/components/ui/StatusPill'
import { ErrorState } from '@/components/ui/States'
import { APP, COMPANY, INTEGRATIONS, ROADMAP } from '@/config/company'
import { NAV_ITEMS } from '@/config/navigation'
import { useData } from '@/context/data'
import { cn } from '@/lib/cn'
import { computeStats, daysUntil, formatDate, localISODate } from '@/lib/stats'

const modules = NAV_ITEMS.filter((i) => i.path !== '/')

const SYNC_LABEL = { idle: 'Bağlı değil', connecting: 'Bağlanıyor', live: 'Canlı', reconnecting: 'Yeniden bağlanıyor', offline: 'Çevrimdışı' } as const

export function DashboardPage() {
  const { projects, companies, loading, error, refresh, syncState } = useData()
  const today = localISODate()
  const stats = computeStats(projects, companies, today)
  const ready = !loading || projects.length > 0 || companies.length > 0

  const { items: notifications, unread, open } = useNotifications()
  const live = useLiveQuery<{ tasks: ProjectTask[]; events: ProjectEvent[]; quotes: Quote[] }>(
    ['project_tasks', 'project_events', 'quotes'],
    async () => {
      const db = requireSupabase()
      const [tasks, events, quotes] = await Promise.all([listAllTasks(db), listRecentEvents(db, 10), listQuotes(db)])
      return { tasks, events, quotes }
    },
    { tasks: [], events: [], quotes: [] },
  )
  const lateTasks = live.data.tasks.filter((t) => taskState(t, today) === 'gecikti')
  const projectOf = new Map(projects.map((p) => [p.id, p]))
  const recentQuotes = live.data.quotes.filter((q) => !q.superseded).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 5)

  const kpis = [
    { label: 'Aktif proje', value: stats.active, to: '/projeler' },
    { label: 'Teklif bekleyen', value: projects.filter((p) => QUOTE_STAGES.includes(p.stage)).length, to: '/projeler?asama=teklif' },
    { label: 'Üretimde', value: projects.filter((p) => p.stage === 'uretimde' || p.stage === 'uretime_hazirlik').length, to: '/projeler?asama=uretimde' },
    { label: 'Montajda', value: projects.filter((p) => p.stage === 'montajda').length, to: '/projeler?asama=montajda' },
    { label: 'Tamamlanan', value: stats.completed, to: '/projeler?asama=kapanan' },
    { label: 'Geciken görev', value: lateTasks.length, to: '/gorevler?filtre=geciken', danger: lateTasks.length > 0 },
  ]

  return (
    <>
      <PageHeader
        icon={LayoutDashboard}
        code="M00"
        eyebrow={COMPANY.name}
        title="Dashboard"
        description="Projeler, görevler, teklifler ve bildirimlerden anlık özet. Değerler veritabanındaki gerçek kayıtlardan hesaplanır ve tüm cihazlarda canlı güncellenir."
        status="ready"
      />

      {error && !projects.length && !companies.length ? (
        <div className="card mb-6">
          <ErrorState message={error} onRetry={() => void refresh()} />
        </div>
      ) : null}

      <section aria-label="Temel göstergeler" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
        {kpis.map((kpi, i) => (
          <motion.div key={kpi.label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i, duration: 0.28 }}>
            <Link to={kpi.to} className="card group relative block min-w-0 overflow-hidden p-4 transition-shadow hover:shadow-hover sm:p-5" data-testid="kpi-card" data-kpi={kpi.label}>
              <span className="brushed absolute inset-x-0 top-0 h-[2px] opacity-70" aria-hidden="true" />
              <div className="flex items-start justify-between gap-2">
                <div className="text-[12.5px] font-medium text-muted">{kpi.label}</div>
                <ArrowUpRight className="h-4 w-4 text-subtle transition group-hover:text-ink" aria-hidden="true" />
              </div>
              <div className={cn('mt-3 font-mono text-[30px] leading-none font-medium sm:text-[34px]', 'danger' in kpi && kpi.danger ? 'text-danger' : 'text-ink')}>
                {ready ? kpi.value : <span className="inline-block h-8 w-12 animate-pulse rounded-md bg-surface-2 align-middle" aria-label="Yükleniyor" />}
              </div>
            </Link>
          </motion.div>
        ))}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <Panel
            title="Yaklaşan teslimler"
            subtitle="Önümüzdeki 14 gün içinde teslimi olan aktif projeler"
            icon={CalendarClock}
            actions={
              stats.overdue > 0 ? (
                <Link to="/projeler?asama=aktif" className="text-xs font-medium text-danger hover:underline">
                  {stats.overdue} geciken proje
                </Link>
              ) : undefined
            }
            bodyClassName="p-0"
          >
            {!ready ? (
              <div className="h-24 animate-pulse" />
            ) : stats.upcoming.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-subtle">Önümüzdeki 14 gün içinde teslimi olan aktif proje yok.</p>
            ) : (
              <ul className="divide-y divide-line">
                {stats.upcoming.slice(0, 8).map((p) => {
                  const d = daysUntil(p.due_date!, today)
                  return (
                    <li key={p.id}>
                      <Link to={`/projeler/${p.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2/70">
                        <div className="w-14 shrink-0 text-center">
                          <div className={cn('font-mono text-lg leading-none font-medium', d <= 2 ? 'text-warn' : 'text-ink')}>{d}</div>
                          <div className="text-[10px] text-subtle">{d === 0 ? 'bugün' : 'gün'}</div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[11px] text-subtle">{p.code}</div>
                          <div className="truncate text-sm font-medium text-ink">{p.name}</div>
                          <div className="text-xs text-muted">{formatDate(p.due_date)}</div>
                        </div>
                        <StageBadge stage={p.stage} onHold={p.on_hold} />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Panel
              title="Geciken görevler"
              subtitle={lateTasks.length ? `${lateTasks.length} görev terminini geçti` : 'Terminini geçen görev yok'}
              icon={AlertTriangle}
              actions={
                <Link to="/gorevler" className="text-xs font-medium text-ink-2 hover:underline">
                  Tüm görevler
                </Link>
              }
              bodyClassName="p-0"
            >
              {lateTasks.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-subtle">{live.loading ? 'Yükleniyor…' : 'Geciken görev yok.'}</p>
              ) : (
                <ul className="divide-y divide-line" data-testid="late-tasks">
                  {lateTasks.slice(0, 6).map((t) => {
                    const p = projectOf.get(t.project_id)
                    return (
                      <li key={t.id}>
                        <Link to={`/projeler/${t.project_id}?sekme=gorevler`} className="block px-5 py-2.5 hover:bg-surface-2/70">
                          <div className="truncate text-sm font-medium text-ink">{t.title}</div>
                          <div className="text-xs text-danger">
                            {p?.code ?? ''} · termin {formatDate(t.due_date)} ({-daysUntil(t.due_date!, today)} gün gecikti)
                          </div>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Panel>
            <Panel
              title="Son teklifler"
              icon={FileText}
              actions={
                <Link to="/teklifler" className="text-xs font-medium text-ink-2 hover:underline">
                  Teklifler
                </Link>
              }
              bodyClassName="p-0"
            >
              {recentQuotes.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-subtle">{live.loading ? 'Yükleniyor…' : 'Henüz teklif yok.'}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {recentQuotes.map((q) => (
                    <li key={q.id}>
                      <Link to={`/teklifler/${q.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-2/70">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[11px] text-subtle">
                            {q.quote_no} · Rev {q.revision}
                          </div>
                          <div className="truncate text-sm font-medium text-ink">{q.title}</div>
                        </div>
                        <QuoteStatusBadge status={q.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel title="Son aktiviteler" subtitle="Projelerdeki gerçek olaylar" icon={History}>
            {live.data.events.length === 0 ? (
              <p className="text-sm text-subtle">{live.loading ? 'Yükleniyor…' : 'Henüz aktivite yok.'}</p>
            ) : (
              <ol className="relative flex flex-col gap-4">
                <span className="absolute top-3 bottom-3 left-[11px] w-px bg-line" aria-hidden="true" />
                {live.data.events.map((e) => (
                  <EventLine key={e.id} to={`/projeler/${e.project_id}`} e={{ ...e, detail: [projectOf.get(e.project_id)?.code, e.detail].filter(Boolean).join(' · ') || null }} />
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Modüller" subtitle="Projeler, Görevler, CAD Analiz, Metraj, Teklifler, Finans ve Firmalar gerçek veriyle çalışır" icon={Layers}>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {modules.map((m) => (
                <li key={m.path} className="min-w-0">
                  <Link
                    to={m.path}
                    className="group flex h-full items-start gap-3.5 rounded-xl border border-line bg-surface p-4 transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-px hover:border-line-strong hover:shadow-hover"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-surface-2">
                      <m.icon className="h-[18px] w-[18px] text-titanium group-hover:text-ink" strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink">{m.label}</span>
                        <span className="font-mono text-[10px] text-subtle">{m.code}</span>
                        {m.status === 'planned' && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-warn/70" title="Geliştirme aşamasında" />}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted">{m.description}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel
            title="Yeni bildirimler"
            subtitle={unread ? `${unread} okunmamış` : 'Okunmamış bildirim yok'}
            icon={Bell}
            actions={
              <Link to="/bildirimler" className="text-xs font-medium text-ink-2 hover:underline">
                Tümü
              </Link>
            }
            bodyClassName="p-0"
          >
            {notifications.filter((n) => !n.read_at).length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-subtle">Yeni bildirim yok.</p>
            ) : (
              <ul className="divide-y divide-line">
                {notifications
                  .filter((n) => !n.read_at)
                  .slice(0, 5)
                  .map((n) => (
                    <NotificationItem key={n.id} n={n} compact onOpen={() => open(n)} />
                  ))}
              </ul>
            )}
          </Panel>
          <Panel title="Sistem durumu" subtitle={`${APP.name} v${APP.version}`} icon={PlugZap}>
            <ul className="flex flex-col divide-y divide-line">
              <li className="flex items-center justify-between gap-3 pb-3 text-sm">
                <span className="text-ink-2">Veritabanı ve oturum</span>
                <StatusPill tone={error ? 'offline' : 'ready'}>{error ? 'Hata' : 'Bağlı'}</StatusPill>
              </li>
              <li className="flex items-center justify-between gap-3 py-3 text-sm">
                <span className="text-ink-2">Cihazlar arası senkronizasyon</span>
                <StatusPill tone={syncState === 'live' ? 'ready' : syncState === 'offline' ? 'offline' : 'planned'}>{SYNC_LABEL[syncState]}</StatusPill>
              </li>
              {INTEGRATIONS.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-3 py-3 text-sm last:pb-0">
                  <span className="min-w-0 truncate text-ink-2">{s.label}</span>
                  {s.connected ? <StatusPill tone="ready">Hazır</StatusPill> : <StatusPill tone="offline">Bağlı değil</StatusPill>}
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
                    <div className={r.done ? 'text-sm text-ink' : 'text-sm text-muted'}>{r.title}</div>
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
