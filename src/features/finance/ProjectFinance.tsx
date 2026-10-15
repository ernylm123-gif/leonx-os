import { Banknote, Calculator, FileDown, HandCoins, Pencil, Plus, Receipt, Trash2, Wallet } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Panel } from '@/components/ui/Panel'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { useToast } from '@/context/toast'
import { deleteCollection, deleteCostLines, deleteExpense, deleteScheduleRow, getProjectFinance } from '@/data/financeApi'
import { listQuotesBy } from '@/data/quoteApi'
import type { Project } from '@/data/types'
import { formatRate } from '@/finance/fx'
import { RECEIVABLE_STATUS_LABEL, type ReceivableStatus } from '@/finance/receivables'
import { summarizeProject } from '@/finance/summary'
import {
  type Collection,
  COST_GROUP_LABEL,
  type CostLine,
  type Expense,
  FIN_UNIT_LABEL,
  MEASURE_BASIS_LABEL,
  PAYMENT_METHOD_LABEL,
  type PaymentScheduleRow,
  type ProjectFinanceData,
  SCHEDULE_KIND_LABEL,
} from '@/finance/types'
import { latestRevisions, useQuoteTotals } from '@/features/quotes/shared'
import { cn } from '@/lib/cn'
import { formatDate, localISODate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useLiveList, useLiveQuery } from '@/lib/useLiveList'
import { formatMoney, toCents } from '@/quote/money'
import type { Quote } from '@/quote/types'
import { BudgetForm, CollectionForm, CostLineForm, ExpenseForm, ScheduleForm } from './FinanceForms'
import { FinNotice, finErrorMessage, KindBadge, money, MoneyByCurrency, numToInput, pctText, StatTile, useFinanceRefs } from './shared'
import { TakeoffImportDialog } from './TakeoffImportDialog'

const EMPTY: ProjectFinanceData = { budget: null, lines: [], expenses: [], schedule: [], collections: [] }
const FIN_TABLES = ['project_budgets', 'project_cost_lines', 'project_expenses', 'project_payment_schedule', 'project_collections'] as const

const STATUS_CLASS: Record<ReceivableStatus, string> = {
  bekliyor: 'border-line bg-surface-2 text-ink-2',
  kismi: 'border-warn-line bg-warn-soft text-warn',
  tahsil_edildi: 'border-ok/25 bg-ok-soft text-ok',
  gecikti: 'border-danger/25 bg-danger-soft text-danger',
}

function RowActions({ label, onEdit, onDelete }: { label: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex shrink-0 gap-0.5">
      <button type="button" onClick={onEdit} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-ink" aria-label={`${label} düzenle`}>
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button type="button" onClick={onDelete} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger" aria-label={`${label} sil`}>
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

function Row({ children, testId, tone }: { children: ReactNode; testId?: string; tone?: 'danger' }) {
  return (
    <li className={cn('flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5 text-[13px]', tone === 'danger' && '-mx-2 rounded-lg bg-danger-soft/40 px-2')} data-testid={testId}>
      {children}
    </li>
  )
}

type Pending = { kind: 'line' | 'expense' | 'schedule' | 'collection'; id: string; label: string } | null

/** Proje detayındaki finans bölümü (?sekme=finans) */
export function ProjectFinance({ project, id }: { project: Project; id?: string }) {
  const { notify } = useToast()
  const today = localISODate()
  const q = useLiveQuery<ProjectFinanceData>([...FIN_TABLES], () => getProjectFinance(requireSupabase(), project.id), EMPTY)
  const refs = useFinanceRefs()
  const d = q.data
  const s = useMemo(() => summarizeProject(project, d, refs.fx, today), [project, d, refs.fx, today])
  const base = s.base

  // Bağlı teklif değişti mi? (yeni revizyon veya farklı tutar)
  const quotes = useLiveList<Quote>('quotes', 'project_id', project.id, (pid) => listQuotesBy(requireSupabase(), 'project_id', pid))
  const accepted = useMemo(() => latestRevisions(quotes.items).filter((x) => x.status === 'kabul'), [quotes.items])
  const { totals } = useQuoteTotals(accepted)
  const linkedId = d.budget?.source_quote_id ?? null
  const linkedQuote = quotes.items.find((x) => x.id === linkedId)
  let quoteChange: string | null = null
  if (d.budget && linkedId && !quotes.loading) {
    const newer = accepted.find((x) => x.id !== linkedId && linkedQuote && x.root_id === linkedQuote.root_id)
    const net = totals.get(linkedId)?.net
    if (!linkedQuote) quoteChange = 'Bağlı teklif bulunamadı.'
    else if (linkedQuote.superseded || newer) quoteChange = `${linkedQuote.quote_no} için yeni revizyon var${newer ? ` (Rev ${newer.revision} kabul edildi)` : ''}.`
    else if (net != null && d.budget.quote_snapshot_net != null && net !== toCents(d.budget.quote_snapshot_net)) quoteChange = `Teklif tutarı değişti: kayıtlı ${money(toCents(d.budget.quote_snapshot_net), linkedQuote.currency)}, güncel ${money(net, linkedQuote.currency)}.`
  }

  const [budgetOpen, setBudgetOpen] = useState(false)
  const [lineForm, setLineForm] = useState<{ open: boolean; line: CostLine | null }>({ open: false, line: null })
  const [importOpen, setImportOpen] = useState(false)
  const [expenseForm, setExpenseForm] = useState<{ open: boolean; row: Expense | null }>({ open: false, row: null })
  const [scheduleForm, setScheduleForm] = useState<{ open: boolean; row: PaymentScheduleRow | null }>({ open: false, row: null })
  const [collectionForm, setCollectionForm] = useState<{ open: boolean; row: Collection | null }>({ open: false, row: null })
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const reload = () => void q.reload()

  const remove = async () => {
    if (!pending) return
    setBusy(true)
    try {
      const db = requireSupabase()
      if (pending.kind === 'line') await deleteCostLines(db, [pending.id])
      if (pending.kind === 'expense') await deleteExpense(db, pending.id)
      if (pending.kind === 'schedule') await deleteScheduleRow(db, pending.id)
      if (pending.kind === 'collection') await deleteCollection(db, pending.id)
      notify('Kayıt silindi.')
      setPending(null)
      reload()
    } catch (e) {
      notify(finErrorMessage(e, 'Silme'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const p = s.profit
  const est = s.estimate
  const recTotals = s.receivables.perCurrency
  const pick = (k: 'collected' | 'outstanding' | 'overdue' | 'planned') => Object.fromEntries(Object.entries(recTotals).map(([c, t]) => [c, t[k]]))
  const overdueAny = Object.values(recTotals).some((t) => t.overdue > 0)
  const perCurrencyTotal = Object.fromEntries(Object.entries(est.perCurrency).map(([c, t]) => [c, t.total]))
  const actualPerCurrency = Object.fromEntries(Object.entries(s.actual.perCurrency).map(([c, t]) => [c, t.net]))
  const nextLineSort = d.lines.reduce((m, l) => Math.max(m, l.sort_order + 1), 0)
  const missingRates = [...new Set([...est.missingRates, ...s.actual.missingRates])]

  if (q.loading && !d.budget && d.lines.length === 0) return <LoadingState label="Finans yükleniyor…" />

  return (
    <div id={id} className="flex flex-col gap-6" data-testid="project-finance">
      <Panel
        title="Finans ve kârlılık"
        subtitle={`Tutarlar KDV hariç · ana para birimi ${base}`}
        icon={Wallet}
        actions={
          <Button variant="secondary" icon={Pencil} onClick={() => setBudgetOpen(true)} data-testid="fin-budget-edit">
            {d.budget ? 'Bütçe' : 'Bütçe oluştur'}
          </Button>
        }
      >
        {q.error && <ErrorState message={q.error} onRetry={reload} />}
        <div className="mb-4 flex flex-col gap-2">
          {missingRates.length > 0 && (
            <FinNotice testId="fin-missing-rate">
              Kur girilmemiş: {missingRates.map((c) => `${c} → ${base}`).join(', ')}. Farklı para birimleri toplanmaz; tutarlar para birimi bazında gösterilir.{' '}
              <Link to="/finans?bolum=kurlar" className="font-semibold underline underline-offset-2">
                Kur gir
              </Link>
            </FinNotice>
          )}
          {est.unpriced > 0 && <FinNotice testId="fin-unpriced">{est.unpriced} maliyet satırının fiyatı tanımlanmamış; tahmini toplam eksik, kâr hesaplanmaz.</FinNotice>}
          {quoteChange && (
            <FinNotice testId="fin-quote-changed">
              Teklif değişti: {quoteChange} Bütçedeki satış bedeli kendiliğinden değiştirilmedi; “Bütçe” ile güncelleyebilirsiniz.
            </FinNotice>
          )}
          {!s.stageClosed && <FinNotice tone="info">Proje tamamlanmadığı için kâr “tahmini”dir; gerçekleşen kâr proje tamamlandı/teslim edildi aşamasında gösterilir.</FinNotice>}
        </div>
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" data-testid="fin-summary">
          <StatTile
            label="Satış (KDV hariç)"
            value={money(p.saleNet, base)}
            hint={p.saleNet != null ? `KDV ${money(p.vat, base)} · KDV dahil ${money(p.saleGross, base)}` : s.saleIssue}
            testId="fin-sale"
          />
          <StatTile
            label="Tahmini maliyet"
            badge={<KindBadge kind="tahmini" />}
            value={est.base && est.unpriced === 0 ? money(est.base.total, base) : <MoneyByCurrency map={perCurrencyTotal} />}
            hint={s.estimateIssue ?? (est.base && (est.base.waste || est.base.overhead) ? `Fire ${money(est.base.waste, base)} · genel gider ${money(est.base.overhead, base)} dahil` : undefined)}
            testId="fin-est"
          />
          <StatTile
            label="Gerçekleşen gider"
            badge={<KindBadge kind="gerceklesen" />}
            value={s.actual.complete ? money(s.actual.baseNet, base) : <MoneyByCurrency map={actualPerCurrency} />}
            hint={s.actualIssue ?? `${d.expenses.length} kayıt · KDV hariç`}
            testId="fin-actual"
          />
          <StatTile
            label="Tahmini kâr"
            badge={<KindBadge kind="tahmini" />}
            value={p.expected ? money(p.expected.profit, base) : '—'}
            tone={p.expected ? (p.expected.profit < 0 ? 'danger' : 'ok') : undefined}
            hint={p.expected ? `Marj ${pctText(p.expected.marginBp)} (kâr/satış) · maliyet üzerinden ${pctText(p.expected.markupBp)}` : (s.saleIssue ?? s.estimateIssue)}
            testId="fin-profit"
          />
          <StatTile
            label="Bütçe sapması"
            value={p.variance ? `${p.variance.amount > 0 ? '+' : ''}${money(p.variance.amount, base)}` : '—'}
            tone={p.variance && p.variance.amount > 0 ? 'danger' : undefined}
            hint={p.variance ? `${pctText(p.variance.bp)} · gerçekleşen − tahmini` : 'Tahmin ve giderler tam olmalı'}
            testId="fin-variance"
          />
          <StatTile
            label="Beklenen sonuç"
            badge={<KindBadge kind="tahmini" />}
            value={p.forecast ? money(p.forecast.profit, base) : '—'}
            tone={p.forecast ? (p.forecast.profit < 0 ? 'danger' : undefined) : undefined}
            hint={p.forecast ? `Maliyet en az gerçekleşen kadar: ${money(p.forecast.cost, base)}` : undefined}
            testId="fin-forecast"
          />
          <StatTile
            label="Gerçekleşen kâr"
            badge={<KindBadge kind="gerceklesen" />}
            value={p.realized ? money(p.realized.profit, base) : '—'}
            tone={p.realized ? (p.realized.profit < 0 ? 'danger' : 'ok') : undefined}
            hint={p.realized ? `Marj ${pctText(p.realized.marginBp)} · maliyet üzerinden ${pctText(p.realized.markupBp)}` : s.stageClosed ? (s.actualIssue ?? s.saleIssue) : 'Proje kapanınca hesaplanır'}
            testId="fin-realized"
          />
          <StatTile label="Tahsil edilen" value={<MoneyByCurrency map={pick('collected')} />} hint={<>Kalan: <MoneyByCurrency map={pick('outstanding')} /></>} testId="fin-collected" />
          {overdueAny && <StatTile label="Geciken tahsilat" tone="danger" value={<MoneyByCurrency map={pick('overdue')} />} testId="fin-overdue" />}
        </div>
        {d.budget?.source_quote_id && d.budget.quote_snapshot_label && (
          <p className="mt-3 text-[11.5px] text-muted">
            Bağlı teklif: {d.budget.quote_snapshot_label} · kayıtlı tutar {money(d.budget.quote_snapshot_net != null ? toCents(d.budget.quote_snapshot_net) : null, d.budget.quote_snapshot_currency ?? base)} (KDV hariç), {formatDate(d.budget.quote_snapshot_at?.slice(0, 10) ?? null)}
          </p>
        )}
      </Panel>

      {/* ------------------------------------------------------------ Tahmini maliyet */}
      <Panel
        title="Tahmini maliyet"
        subtitle={d.lines.length ? `${d.lines.length} satır` : 'Elle veya onaylı metrajdan'}
        icon={Calculator}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={FileDown} onClick={() => setImportOpen(true)} data-testid="fin-import">
              Metrajdan aktar
            </Button>
            <Button variant="secondary" icon={Plus} onClick={() => setLineForm({ open: true, line: null })} data-testid="fin-line-add">
              Satır ekle
            </Button>
          </div>
        }
      >
        {d.lines.length === 0 ? (
          <p className="text-sm text-subtle">Henüz maliyet satırı yok. Profil, cam, işçilik, montaj gibi kalemleri ekleyin veya onaylı metrajdan aktarın.</p>
        ) : (
          <>
            <ul className="divide-y divide-line" data-testid="fin-lines">
              {d.lines.map((l, i) => {
                const amt = est.amounts[i]
                return (
                  <Row key={l.id} testId="fin-line">
                    <div className="min-w-0 flex-1 basis-56">
                      <div className="font-medium break-words text-ink">{l.description}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted">
                        <span>{COST_GROUP_LABEL[l.cost_group]}</span>
                        <span>
                          {numToInput(l.quantity)} {FIN_UNIT_LABEL[l.unit]} × {l.unit_cost == null ? '—' : formatMoney(toCents(l.unit_cost), l.currency)}
                        </span>
                        {l.source === 'metraj' && <span className="rounded border border-line px-1 text-[10px]">metraj</span>}
                        {l.measure_basis === 'cevre' && <span className="text-warn">{MEASURE_BASIS_LABEL.cevre}</span>}
                      </div>
                    </div>
                    <div className="ml-auto text-right">
                      {amt == null ? (
                        <span className="inline-flex rounded-md border border-warn-line bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold text-warn" data-testid="fin-line-unpriced">
                          Fiyat tanımlanmamış
                        </span>
                      ) : (
                        <span className="font-mono font-semibold text-ink" data-testid="fin-line-amount">
                          {formatMoney(amt, l.currency)}
                        </span>
                      )}
                    </div>
                    <RowActions label={l.description} onEdit={() => setLineForm({ open: true, line: l })} onDelete={() => setPending({ kind: 'line', id: l.id, label: l.description })} />
                  </Row>
                )
              })}
            </ul>
            <dl className="mt-3 space-y-1 border-t border-line pt-3 text-[13px]" data-testid="fin-line-totals">
              {Object.keys(est.perCurrency).length > 1 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Para birimi bazında</dt>
                  <dd>
                    <MoneyByCurrency map={perCurrencyTotal} />
                  </dd>
                </div>
              )}
              {est.base ? (
                <>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Doğrudan maliyet</dt>
                    <dd className="font-mono">{money(est.base.direct, base)}</dd>
                  </div>
                  {est.base.waste > 0 && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Fire (%{numToInput(d.budget?.waste_pct ?? 0)} · malzeme)</dt>
                      <dd className="font-mono">{money(est.base.waste, base)}</dd>
                    </div>
                  )}
                  {est.base.overhead > 0 && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Genel gider (%{numToInput(d.budget?.overhead_pct ?? 0)})</dt>
                      <dd className="font-mono">{money(est.base.overhead, base)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3 font-semibold">
                    <dt className="flex items-center gap-1.5">
                      Toplam ({base}) <KindBadge kind="tahmini" />
                    </dt>
                    <dd className="font-mono" data-testid="fin-est-total">
                      {money(est.base.total, base)}
                      {est.unpriced > 0 && <span className="ml-1 text-[11px] font-normal text-warn">(eksik)</span>}
                    </dd>
                  </div>
                  {Object.entries(est.usedRates).map(([c, r]) => (
                    <p key={c} className="text-[11px] text-subtle">
                      Kur {c}→{base}: {formatRate(r!.rate)} ({formatDate(r!.rate_date)}
                      {r!.source ? ` · ${r!.source}` : ''})
                    </p>
                  ))}
                </>
              ) : (
                <p className="text-[12px] text-warn">Kur girilmediği için {base} cinsinden birleşik toplam gösterilmez.</p>
              )}
            </dl>
          </>
        )}
      </Panel>

      {/* ------------------------------------------------------------ Gerçekleşen giderler */}
      <Panel
        title="Gerçekleşen giderler"
        subtitle="KDV hariç tutar; KDV ayrı"
        icon={Receipt}
        actions={
          <Button variant="secondary" icon={Plus} onClick={() => setExpenseForm({ open: true, row: null })} data-testid="fin-expense-add">
            Gider ekle
          </Button>
        }
      >
        {d.expenses.length === 0 ? (
          <p className="text-sm text-subtle">Henüz gider kaydı yok.</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="fin-expenses">
            {d.expenses.map((e) => (
              <Row key={e.id} testId="fin-expense">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="font-medium break-words text-ink">{e.description}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted">
                    {formatDate(e.expense_date)} · {COST_GROUP_LABEL[e.cost_group]}
                    {e.supplier ? ` · ${e.supplier}` : ''}
                    {e.document_no ? ` · ${e.document_no}` : ''} · {e.paid ? 'ödendi' : <span className="text-warn">ödenmedi</span>}
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className="font-mono font-semibold text-ink">{formatMoney(toCents(e.amount), e.currency)}</div>
                  <div className="text-[11px] text-muted">
                    KDV {formatMoney(toCents(e.vat_amount), e.currency)}
                    {e.fx_rate_to_base != null && ` · kur ${formatRate(e.fx_rate_to_base)}`}
                  </div>
                </div>
                <RowActions label={e.description} onEdit={() => setExpenseForm({ open: true, row: e })} onDelete={() => setPending({ kind: 'expense', id: e.id, label: e.description })} />
              </Row>
            ))}
          </ul>
        )}
      </Panel>

      {/* ------------------------------------------------------------ Ödeme planı ve tahsilat */}
      <Panel
        title="Ödeme planı ve tahsilat"
        subtitle="Tahsilatlar taksite bağlanmazsa en eski açık taksitten dağıtılır"
        icon={HandCoins}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={Plus} onClick={() => setScheduleForm({ open: true, row: null })} data-testid="fin-schedule-add">
              Taksit ekle
            </Button>
            <Button variant="secondary" icon={Banknote} onClick={() => setCollectionForm({ open: true, row: null })} data-testid="fin-collection-add">
              Tahsilat ekle
            </Button>
          </div>
        }
      >
        {d.schedule.length === 0 ? (
          <p className="text-sm text-subtle">Ödeme planı yok. Peşinat, ara ödeme ve son ödemeyi vadeleriyle girin; vadesi yaklaşan ve geciken tahsilatlar için bildirim gelir.</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="fin-schedule">
            {d.schedule.map((r) => {
              const st = s.receivables.byId.get(r.id)
              return (
                <Row key={r.id} testId="fin-schedule-row" tone={st?.status === 'gecikti' ? 'danger' : undefined}>
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="font-medium text-ink">{r.label || SCHEDULE_KIND_LABEL[r.kind]}</div>
                    <div className="mt-0.5 text-[11.5px] text-muted">
                      {SCHEDULE_KIND_LABEL[r.kind]} · vade {formatDate(r.due_date)}
                    </div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="font-mono font-semibold text-ink">{formatMoney(toCents(r.amount), r.currency)}</div>
                    {st && st.status !== 'tahsil_edildi' && <div className="text-[11px] text-muted">kalan {formatMoney(st.outstanding, r.currency)}</div>}
                  </div>
                  {st && (
                    <span className={cn('self-center rounded-full border px-2 py-0.5 text-[11px] font-semibold', STATUS_CLASS[st.status])} data-testid="fin-schedule-status" data-status={st.status}>
                      {RECEIVABLE_STATUS_LABEL[st.status]}
                    </span>
                  )}
                  <RowActions label={r.label || SCHEDULE_KIND_LABEL[r.kind]} onEdit={() => setScheduleForm({ open: true, row: r })} onDelete={() => setPending({ kind: 'schedule', id: r.id, label: r.label || SCHEDULE_KIND_LABEL[r.kind] })} />
                </Row>
              )
            })}
          </ul>
        )}
        {Object.values(recTotals).some((t) => t.unallocated > 0) && (
          <p className="mt-2 text-[12px] text-muted">
            Taksitlere dağıtılamayan fazla tahsilat (avans): <MoneyByCurrency map={Object.fromEntries(Object.entries(recTotals).map(([c, t]) => [c, t.unallocated]))} />
          </p>
        )}
        {d.collections.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <h3 className="mb-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">Tahsilatlar</h3>
            <ul className="divide-y divide-line" data-testid="fin-collections">
              {d.collections.map((c) => {
                const linked = d.schedule.find((x) => x.id === c.schedule_id)
                return (
                  <Row key={c.id} testId="fin-collection">
                    <div className="min-w-0 flex-1 basis-48">
                      <div className="text-ink">
                        {formatDate(c.received_date)} · {PAYMENT_METHOD_LABEL[c.method]}
                      </div>
                      <div className="text-[11.5px] text-muted">{linked ? `→ ${linked.label || SCHEDULE_KIND_LABEL[linked.kind]}` : 'Otomatik dağıtım'}{c.reference ? ` · ${c.reference}` : ''}</div>
                    </div>
                    <span className="ml-auto font-mono font-semibold text-ok">{formatMoney(toCents(c.amount), c.currency)}</span>
                    <RowActions label={`Tahsilat ${formatDate(c.received_date)}`} onEdit={() => setCollectionForm({ open: true, row: c })} onDelete={() => setPending({ kind: 'collection', id: c.id, label: `${formatDate(c.received_date)} tahsilatı` })} />
                  </Row>
                )
              })}
            </ul>
          </div>
        )}
      </Panel>

      <BudgetForm open={budgetOpen} onClose={() => setBudgetOpen(false)} projectId={project.id} budget={d.budget} onSaved={reload} />
      <CostLineForm open={lineForm.open} onClose={() => setLineForm({ open: false, line: null })} projectId={project.id} line={lineForm.line} rates={refs.rates} defaultCurrency={base} nextSort={nextLineSort} onSaved={reload} />
      <TakeoffImportDialog open={importOpen} onClose={() => setImportOpen(false)} projectId={project.id} lines={d.lines} rates={refs.rates} base={base} onImported={reload} />
      <ExpenseForm open={expenseForm.open} onClose={() => setExpenseForm({ open: false, row: null })} projectId={project.id} expense={expenseForm.row} base={base} onSaved={reload} />
      <ScheduleForm open={scheduleForm.open} onClose={() => setScheduleForm({ open: false, row: null })} projectId={project.id} row={scheduleForm.row} base={base} nextSort={d.schedule.reduce((m, x) => Math.max(m, x.sort_order + 1), 0)} onSaved={reload} />
      <CollectionForm open={collectionForm.open} onClose={() => setCollectionForm({ open: false, row: null })} projectId={project.id} row={collectionForm.row} schedule={d.schedule} base={base} onSaved={reload} />
      <ConfirmDialog
        open={!!pending}
        title="Kayıt silinsin mi?"
        message={pending ? `"${pending.label}" silinecek. Zaman çizelgesindeki geçmiş kayıtlar korunur.` : ''}
        confirmLabel="Sil"
        busy={busy}
        onConfirm={() => void remove()}
        onClose={() => setPending(null)}
      />
    </div>
  )
}
