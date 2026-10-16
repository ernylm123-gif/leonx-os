import { AlertTriangle, ArrowRightLeft, BarChart3, Gauge, Landmark, LayoutGrid, ListFilter, Plus, Repeat, Table2, Tags, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { StageBadge } from '@/components/ui/ProjectBadges'
import { ErrorState } from '@/components/ui/States'
import { useData } from '@/context/data'
import { listAllFinance } from '@/data/financeApi'
import { AccountsPanel, CashDashboard, CategoriesPanel, EntriesPanel, RecurringPanel } from '@/features/cash/CashPanels'
import { EntryDialog } from '@/features/cash/EntryDialog'
import { useCash } from '@/features/cash/useCash'
import { CostRatesPanel, FxRatesPanel } from '@/features/finance/CatalogPanels'
import { FinNotice, KindBadge, money, MoneyByCurrency, pctText, StatTile, useFinanceRefs } from '@/features/finance/shared'
import { monthLabel, monthlyCashflow } from '@/finance/cashflow'
import { RECEIVABLE_STATUS_LABEL } from '@/finance/receivables'
import { addTo, type ProjectFinanceSummary, summarizeProject } from '@/finance/summary'
import type { EntryKind } from '@/finance/cash'
import type { ProjectFinanceData } from '@/finance/types'
import { cn } from '@/lib/cn'
import { isActiveStage } from '@/lib/domain'
import { formatDate, localISODate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useLiveQuery } from '@/lib/useLiveList'
import { formatMoney, toCents } from '@/quote/money'
import { CURRENCIES, type Currency } from '@/quote/types'
import type { Project } from '@/data/types'

type Section = 'ozet' | 'panel' | 'gelir-gider' | 'kasa-banka' | 'kategoriler' | 'duzenli' | 'birim-maliyetler' | 'kurlar'
const SECTIONS: { value: Section; label: string; icon: typeof Wallet }[] = [
  { value: 'ozet', label: 'Proje özeti', icon: LayoutGrid },
  { value: 'panel', label: 'Kasa paneli', icon: Gauge },
  { value: 'gelir-gider', label: 'Gelir-Gider', icon: ListFilter },
  { value: 'kasa-banka', label: 'Kasa & Banka', icon: Landmark },
  { value: 'kategoriler', label: 'Kategoriler', icon: Tags },
  { value: 'duzenli', label: 'Düzenli', icon: Repeat },
  { value: 'birim-maliyetler', label: 'Birim maliyetler', icon: Tags },
  { value: 'kurlar', label: 'Kurlar', icon: ArrowRightLeft },
]
const FIN_TABLES = ['project_budgets', 'project_cost_lines', 'project_expenses', 'project_payment_schedule', 'project_collections'] as const

type Row = { project: Project; data: ProjectFinanceData; s: ProjectFinanceSummary }

export function FinancePage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('bolum')
  const section: Section = SECTIONS.some((x) => x.value === raw) ? (raw as Section) : 'ozet'
  const cash = useCash()
  const [quick, setQuick] = useState<{ open: boolean; kind: EntryKind }>({ open: false, kind: 'gider' })
  const add = (kind: EntryKind) => setQuick({ open: true, kind })
  return (
    <>
      <PageHeader
        icon={Wallet}
        code="M11"
        eyebrow="Ticari"
        title="Finans"
        description="Kasa ve banka hesapları, manuel gelir-gider, sözleşme değeri, maliyet, tahsilat ve kârlılık. Tutarlar KDV hariç girilir; farklı para birimleri yalnız girdiğiniz kurla çevrilir."
        status="ready"
      />
      <div role="radiogroup" aria-label="Finans bölümü" className="-mx-4 mb-6 flex gap-1.5 overflow-x-auto overscroll-x-contain px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" data-testid="finance-sections">
        {SECTIONS.map((o) => {
          const selected = o.value === section
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setParams(o.value === 'ozet' ? {} : { bolum: o.value }, { replace: true })}
              className={cn(
                'inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium whitespace-nowrap transition-colors',
                selected ? 'border-line-strong bg-surface text-ink shadow-card' : 'border-transparent bg-surface-2 text-muted hover:text-ink',
              )}
              data-testid={`finance-tab-${o.value}`}
            >
              <o.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              {o.label}
            </button>
          )
        })}
      </div>
      {section === 'ozet' && <FinanceOverview />}
      {section === 'panel' && <CashDashboard cash={cash} onAdd={add} />}
      {section === 'gelir-gider' && <EntriesPanel cash={cash} onAdd={add} />}
      {section === 'kasa-banka' && <AccountsPanel cash={cash} />}
      {section === 'kategoriler' && <CategoriesPanel cash={cash} />}
      {section === 'duzenli' && <RecurringPanel cash={cash} />}
      {section === 'birim-maliyetler' && <CostRatesPanel />}
      {section === 'kurlar' && <FxRatesPanel />}
      {/* Her bölümde görünen hızlı ekleme düğmesi (telefonda alt sekme çubuğunun üstünde) */}
      <button
        type="button"
        onClick={() => add('gider')}
        className="fixed right-4 bottom-[calc(80px+env(safe-area-inset-bottom))] z-30 inline-flex h-14 items-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-ink shadow-raised transition hover:bg-primary-hover active:scale-[0.98] md:right-8 md:bottom-8"
        data-testid="quick-add"
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
        Gelir/Gider ekle
      </button>
      <EntryDialog
        open={quick.open}
        onClose={() => setQuick((x) => ({ ...x, open: false }))}
        accounts={cash.data.accounts}
        categories={cash.data.categories}
        defaultKind={quick.kind}
        defaultAccountId={cash.data.accounts.find((a) => a.active)?.id}
        onSaved={() => void cash.reload()}
      />
    </>
  )
}

function FinanceOverview() {
  const { projects } = useData()
  const today = localISODate()
  const refs = useFinanceRefs()
  const q = useLiveQuery<Map<string, ProjectFinanceData>>([...FIN_TABLES], () => listAllFinance(requireSupabase()), new Map())

  const rows: Row[] = useMemo(
    () =>
      projects
        .filter((p) => q.data.has(p.id))
        .map((p) => ({ project: p, data: q.data.get(p.id)!, s: summarizeProject(p, q.data.get(p.id)!, refs.fx, today) }))
        .sort((a, b) => a.project.code.localeCompare(b.project.code, 'tr')),
    [projects, q.data, refs.fx, today],
  )

  const agg = useMemo(() => {
    const contract: Partial<Record<Currency, number>> = {}
    const expected: Partial<Record<Currency, number>> = {}
    const realized: Partial<Record<Currency, number>> = {}
    const actual: Partial<Record<Currency, number>> = {}
    const collected: Partial<Record<Currency, number>> = {}
    const outstanding: Partial<Record<Currency, number>> = {}
    const overdue: Partial<Record<Currency, number>> = {}
    let expectedMissing = 0
    for (const { project, data, s } of rows) {
      const active = isActiveStage(project.stage)
      if (active && s.profit.saleNet != null) addTo(contract, s.base, s.profit.saleNet)
      if (active) {
        if (s.profit.expected) addTo(expected, s.base, s.profit.expected.profit)
        else expectedMissing++
      }
      if (s.profit.realized) addTo(realized, s.base, s.profit.realized.profit)
      // Komşu göstergelerle aynı küme: yalnız aktif projeler (kapanan/iptal edilenler hariç), para birimi bazında
      if (active) for (const e of data.expenses) addTo(actual, e.currency, toCents(e.amount))
      for (const [c, t] of Object.entries(s.receivables.perCurrency) as [Currency, NonNullable<(typeof s.receivables.perCurrency)[Currency]>][]) {
        addTo(collected, c, t.collected)
        addTo(outstanding, c, t.outstanding)
        addTo(overdue, c, t.overdue)
      }
    }
    return { contract, expected, realized, actual, collected, outstanding, overdue, expectedMissing }
  }, [rows])

  const flow = useMemo(() => {
    const cols = rows.flatMap((r) => r.data.collections)
    const exps = rows.flatMap((r) => r.data.expenses)
    return monthlyCashflow(cols, exps, today, 6)
  }, [rows, today])
  const flowCurrencies = CURRENCIES.map((c) => c.value).filter((c) => flow.some((m) => m.perCurrency[c]))

  const overdueRows = rows.flatMap(({ project, data, s }) =>
    data.schedule.filter((x) => s.receivables.byId.get(x.id)?.status === 'gecikti').map((x) => ({ project, row: x, rec: s.receivables.byId.get(x.id)! })),
  )

  if (q.error) return <ErrorState message={q.error} onRetry={() => void q.reload()} />

  return (
    <div className="flex flex-col gap-6" data-testid="finance-overview">
      <section aria-label="Finans göstergeleri" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Aktif sözleşme değeri" value={<MoneyByCurrency map={agg.contract} />} hint="KDV hariç, aktif projeler" testId="kpi-contract" />
        <StatTile
          label="Beklenen kâr"
          badge={<KindBadge kind="tahmini" />}
          value={<MoneyByCurrency map={agg.expected} />}
          hint={agg.expectedMissing ? `${agg.expectedMissing} aktif projede eksik veri (satış, fiyat veya kur)` : 'Aktif projeler'}
          testId="kpi-expected"
        />
        <StatTile label="Gerçekleşen gider" badge={<KindBadge kind="gerceklesen" />} value={<MoneyByCurrency map={agg.actual} />} hint="KDV hariç, aktif projeler, para birimi bazında" testId="kpi-actual" />
        <StatTile label="Tahsilat" value={<MoneyByCurrency map={agg.collected} />} testId="kpi-collected" />
        <StatTile label="Açık alacak" value={<MoneyByCurrency map={agg.outstanding} />} testId="kpi-outstanding" />
        <StatTile label="Geciken ödeme" value={<MoneyByCurrency map={agg.overdue} />} tone={Object.values(agg.overdue).some((v) => v! > 0) ? 'danger' : undefined} testId="kpi-overdue" />
        <StatTile label="Gerçekleşen kâr" badge={<KindBadge kind="gerceklesen" />} value={<MoneyByCurrency map={agg.realized} />} hint="Yalnız tamamlanan / teslim edilen projeler" testId="kpi-realized" />
      </section>

      <Panel title="Proje kârlılığı" subtitle="Satıra dokunarak projenin finans bölümünü açın" icon={Table2} bodyClassName="p-0">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-subtle">{q.loading ? 'Yükleniyor…' : 'Henüz finans verisi olan proje yok. Proje sayfasında “Finans” bölümünden bütçe ve maliyet girin.'}</p>
        ) : (
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[860px] text-left text-[13px]" data-testid="finance-table">
              <thead className="border-b border-line bg-surface-2 text-[11px] tracking-[0.06em] text-muted uppercase">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Proje</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Satış (KDV hariç)</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Tahmini maliyet</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Gerçekleşen gider</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Kâr</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Tahsilat / kalan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(({ project, s }) => {
                  const est = s.estimate
                  const profit = s.profit.realized ?? s.profit.expected
                  const rec = s.receivables.perCurrency
                  return (
                    <tr key={project.id} className="align-top hover:bg-surface-2/60" data-testid="finance-row" data-code={project.code}>
                      <td className="px-4 py-2.5">
                        <Link to={`/projeler/${project.id}?sekme=finans`} className="block hover:underline">
                          <span className="font-mono text-[11px] text-subtle">{project.code}</span>
                          <span className="block font-medium text-ink">{project.name}</span>
                        </Link>
                        <div className="mt-1">
                          <StageBadge stage={project.stage} onHold={project.on_hold} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">{money(s.profit.saleNet, s.base)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {est.base && !s.estimateIssue ? (
                          <span className="font-mono">{money(est.base.total, s.base)}</span>
                        ) : (
                          <>
                            <MoneyByCurrency map={Object.fromEntries(Object.entries(est.perCurrency).map(([c, t]) => [c, t.total]))} />
                            {s.estimateIssue && <span className="block text-[11px] text-warn">{s.estimateIssue}</span>}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {s.actual.complete ? (
                          <span className="font-mono">{money(s.actual.baseNet, s.base)}</span>
                        ) : (
                          <>
                            <MoneyByCurrency map={Object.fromEntries(Object.entries(s.actual.perCurrency).map(([c, t]) => [c, t.net]))} />
                            <span className="block text-[11px] text-warn">{s.actualIssue}</span>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {profit ? (
                          <>
                            <span className={cn('font-mono font-semibold', profit.profit < 0 ? 'text-danger' : 'text-ink')}>{money(profit.profit, s.base)}</span>
                            <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted">
                              <KindBadge kind={s.profit.realized ? 'gerceklesen' : 'tahmini'} /> marj {pctText(profit.marginBp)}
                            </span>
                          </>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <MoneyByCurrency map={Object.fromEntries(Object.entries(rec).map(([c, t]) => [c, t.collected]))} />
                        <span className="block text-[11px] text-muted">
                          kalan <MoneyByCurrency map={Object.fromEntries(Object.entries(rec).map(([c, t]) => [c, t.outstanding]))} empty="0" />
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Aylık nakit akışı" subtitle="Son 6 ay · giriş: tahsilat, çıkış: ödenmiş giderler (KDV dahil) · para birimi bazında" icon={BarChart3}>
          {flowCurrencies.length === 0 ? (
            <p className="text-sm text-subtle">Son 6 ayda tahsilat veya ödenmiş gider yok.</p>
          ) : (
            <div className="flex flex-col gap-5" data-testid="cashflow">
              {flowCurrencies.map((c) => {
                const max = Math.max(1, ...flow.map((m) => Math.max(m.perCurrency[c]?.in ?? 0, m.perCurrency[c]?.out ?? 0)))
                return (
                  <div key={c}>
                    <div className="mb-2 text-xs font-semibold text-ink-2">{c}</div>
                    <div className="grid grid-cols-6 items-end gap-2" style={{ height: 120 }} role="img" aria-label={`${c} aylık nakit akışı`}>
                      {flow.map((m) => {
                        const t = m.perCurrency[c] ?? { in: 0, out: 0 }
                        return (
                          <div key={m.month} className="flex h-full items-end justify-center gap-0.5" title={`${monthLabel(m.month)} · giriş ${formatMoney(t.in, c)} · çıkış ${formatMoney(t.out, c)}`}>
                            <span className="w-2.5 rounded-t bg-ok sm:w-3.5" style={{ height: `${(t.in / max) * 100}%` }} />
                            <span className="w-2.5 rounded-t bg-danger/80 sm:w-3.5" style={{ height: `${(t.out / max) * 100}%` }} />
                          </div>
                        )
                      })}
                    </div>
                    <div className="mt-1 grid grid-cols-6 gap-2 text-center text-[10.5px] text-muted">
                      {flow.map((m) => (
                        <span key={m.month}>{monthLabel(m.month)}</span>
                      ))}
                    </div>
                    <div className="mt-1.5 text-[11.5px] text-muted">
                      Bu ay: giriş {formatMoney(flow[5].perCurrency[c]?.in ?? 0, c)} · çıkış {formatMoney(flow[5].perCurrency[c]?.out ?? 0, c)}
                    </div>
                  </div>
                )
              })}
              <div className="flex gap-4 text-[11px] text-muted">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-ok" /> Giriş (tahsilat)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-danger/80" /> Çıkış (ödenen gider)
                </span>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Geciken ödemeler" subtitle={overdueRows.length ? `${overdueRows.length} taksitin vadesi geçti` : 'Vadesi geçmiş açık taksit yok'} icon={AlertTriangle} bodyClassName="p-0">
          {overdueRows.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-subtle">Geciken ödeme yok.</p>
          ) : (
            <ul className="divide-y divide-line" data-testid="finance-overdue">
              {overdueRows.map(({ project, row, rec }) => (
                <li key={row.id}>
                  <Link to={`/projeler/${project.id}?sekme=finans`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-5 py-2.5 hover:bg-surface-2/70">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {project.code} · {row.label || 'Taksit'}
                      </span>
                      <span className="text-xs text-danger">
                        vade {formatDate(row.due_date)} · {RECEIVABLE_STATUS_LABEL[rec.status]}
                      </span>
                    </span>
                    <span className="font-mono text-sm font-semibold text-danger">{formatMoney(rec.outstanding, row.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <FinNotice tone="info">
        Farklı para birimleri hiçbir zaman kendiliğinden toplanmaz. Projede kur eksikse o projenin toplamı para birimi bazında gösterilir;{' '}
        <Link to="/finans?bolum=kurlar" className="font-semibold underline underline-offset-2">
          Kurlar
        </Link>{' '}
        bölümünden tarih ve kaynakla kur girebilirsiniz.
      </FinNotice>
    </div>
  )
}
