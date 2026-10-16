import {
  ArrowRightLeft,
  BarChart3,
  Ban,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  FileDown,
  FileSpreadsheet,
  Landmark,
  ListFilter,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Repeat,
  Tags,
  Trash2,
  Wallet,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Panel } from '@/components/ui/Panel'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { FilterSelect, SearchInput } from '@/components/ui/Toolbar'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { deleteAccount, deleteCategory, deleteRecurring, generateRecurring, updateRecurring, voidEntry, voidTransfer } from '@/data/cashApi'
import { CollectionForm, ExpenseForm } from '@/features/finance/FinanceForms'
import { FinNotice, KindBadge, MoneyByCurrency, pctText, StatTile, useFinanceRefs } from '@/features/finance/shared'
import { ACCOUNT_KIND_LABEL, type DocumentTable, type EntryKind, type FinanceAccount, type FinanceCategory, type FinanceEntry, type FinanceRecurring, FREQUENCY_LABEL } from '@/finance/cash'
import { lastMonths } from '@/finance/cashflow'
import {
  type CashRecord,
  convertedTotal,
  type CurrencyMap,
  filterRecords,
  generalExpenseByCategory,
  LEDGER_SOURCE_LABEL,
  monthlySeries,
  monthRange,
  NO_ACCOUNT,
  payables,
  pendingReceivables,
  periodTotals,
  pick,
  type RecordFilter,
  recordTotals,
  balanceTotals,
} from '@/finance/ledger'
import { summarizeProject } from '@/finance/summary'
import { cn } from '@/lib/cn'
import { isActiveStage } from '@/lib/domain'
import { downloadBytes, loadPdfAssets } from '@/lib/download'
import { formatDate, localISODate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { formatMoney, toCents } from '@/quote/money'
import { CURRENCIES, type Currency } from '@/quote/types'
import { AccountForm, CategoryForm, RecurringForm, TransferDialog } from './CashForms'
import { EntryDialog } from './EntryDialog'
import { ChartLegend, MonthlyChart } from './MonthlyChart'
import { accountLabel, cashErrorMessage, DocumentsSection, HistoryButton, HistoryDialog, MovementKindBadge, RecordStatusBadge, VoidDialog } from './shared'
import type { CashState } from './useCash'

const CUR_ORDER: Currency[] = CURRENCIES.map((c) => c.value)
const nonZero = (m: CurrencyMap) => Object.values(m).some((v) => v)

/** Kimlik → ad çözücüler (liste, geçmiş ve dışa aktarım aynı adları kullanır) */
function useNames(cash: CashState) {
  const { projects } = useData()
  return useMemo(() => {
    const acc = new Map(cash.data.accounts.map((a) => [a.id, a]))
    const cat = new Map(cash.data.categories.map((c) => [c.id, c]))
    const prj = new Map(projects.map((p) => [p.id, p]))
    return {
      account: (id: string | null) => (id ? (acc.get(id)?.name ?? 'Bilinmeyen hesap') : 'Hesapsız'),
      category: (id: string | null) => (id ? (cat.get(id)?.name ?? '—') : '—'),
      project: (id: string | null) => (id ? (prj.get(id)?.code ?? '—') : ''),
      projectRow: (id: string | null) => (id ? (prj.get(id) ?? null) : null),
      resolve: (field: string, v: unknown) => {
        if (typeof v !== 'string') return null
        if (field.endsWith('account_id')) return acc.get(v)?.name ?? null
        if (field === 'category_id') return cat.get(v)?.name ?? null
        return null
      },
    }
  }, [cash.data.accounts, cash.data.categories, projects])
}

// ================================================================== PANEL
export function CashDashboard({ cash, onAdd }: { cash: CashState; onAdd: (k: EntryKind) => void }) {
  const { projects } = useData()
  const refs = useFinanceRefs()
  const today = localISODate()
  const month = today.slice(0, 7)
  const [mFrom, mTo] = monthRange(month)
  const names = useNames(cash)

  const k = useMemo(() => {
    const day = periodTotals(cash.ledger, today, today)
    const mon = periodTotals(cash.ledger, mFrom, mTo)
    const balances = [...cash.balances.values()]
    const kindOf = new Map(cash.data.accounts.map((a) => [a.id, a]))
    const kasa = balanceTotals(balances, (b) => kindOf.get(b.accountId)?.kind === 'kasa')
    const banka = balanceTotals(balances, (b) => kindOf.get(b.accountId)?.kind !== 'kasa')
    const total = balanceTotals(balances)
    const rec = pendingReceivables([...cash.data.projects.values()], cash.data.entries, today)
    const pay = payables(cash.expenses, cash.data.entries)
    const general = generalExpenseByCategory(cash.ledger, mFrom, mTo)
    const unassigned = cash.ledger.filter((l) => !l.accountId).length
    return { day, mon, kasa, banka, total, rec, pay, general, unassigned }
  }, [cash.ledger, cash.balances, cash.data, cash.expenses, today, mFrom, mTo])

  const converted = convertedTotal(k.total, 'TRY', refs.fx, today)
  const months = lastMonths(today, 6)
  const series = monthlySeries(cash.ledger, months)
  const chartCurrencies = CUR_ORDER.filter((c) => series.some((m) => m.perCurrency[c]))

  const profit = useMemo(
    () =>
      projects
        .filter((p) => cash.data.projects.has(p.id) && (isActiveStage(p.stage) || p.stage === 'tamamlandi' || p.stage === 'teslim_edildi'))
        .map((p) => ({ p, s: summarizeProject(p, cash.data.projects.get(p.id)!, refs.fx, today) }))
        .filter((x) => x.s.profit.saleNet != null || x.s.actual.baseNet > 0)
        .sort((a, b) => a.p.code.localeCompare(b.p.code, 'tr'))
        .slice(0, 8),
    [projects, cash.data.projects, refs.fx, today],
  )

  if (cash.error) return <ErrorState message={cash.error} onRetry={() => void cash.reload()} />

  return (
    <div className="flex flex-col gap-6" data-testid="cash-dashboard">
      {cash.data.accounts.length === 0 && !cash.loading && (
        <FinNotice tone="info" testId="cash-no-accounts">
          Henüz kasa veya banka hesabı yok.{' '}
          <Link to="/finans?bolum=kasa-banka" className="font-semibold underline underline-offset-2">
            Kasa & Banka
          </Link>{' '}
          bölümünden hesap ekleyin; gelir ve giderler bu hesaplara yazılır.
        </FinNotice>
      )}
      <section aria-label="Nakit göstergeleri" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Bugünkü gelir" value={<MoneyByCurrency map={pick(k.day, 'income')} empty="0" />} tone="ok" testId="kpi-today-income" />
        <StatTile label="Bugünkü gider" value={<MoneyByCurrency map={pick(k.day, 'expense')} empty="0" />} tone="danger" testId="kpi-today-expense" />
        <StatTile
          label="Bu ay gelir"
          value={<MoneyByCurrency map={pick(k.mon, 'income')} empty="0" />}
          hint={
            <>
              proje <MoneyByCurrency map={pick(k.mon, 'incomeProject')} empty="0" /> · genel <MoneyByCurrency map={pick(k.mon, 'incomeGeneral')} empty="0" />
            </>
          }
          testId="kpi-month-income"
        />
        <StatTile
          label="Bu ay gider"
          value={<MoneyByCurrency map={pick(k.mon, 'expense')} empty="0" />}
          hint={
            <>
              proje <MoneyByCurrency map={pick(k.mon, 'expenseProject')} empty="0" /> · genel <MoneyByCurrency map={pick(k.mon, 'expenseGeneral')} empty="0" />
            </>
          }
          testId="kpi-month-expense"
        />
        <StatTile label="Kasa bakiyesi" value={<MoneyByCurrency map={k.kasa} empty="0" />} testId="kpi-cash-balance" />
        <StatTile label="Banka bakiyesi" value={<MoneyByCurrency map={k.banka} empty="0" />} hint="Banka ve kredi kartı hesapları" testId="kpi-bank-balance" />
        <StatTile
          label="Toplam bakiye"
          value={<MoneyByCurrency map={k.total} empty="0" />}
          hint={converted.total != null && Object.keys(k.total).length > 1 ? `TRY karşılığı (girdiğiniz kurla): ${formatMoney(converted.total, 'TRY')}` : converted.missing.length ? `Birleşik toplam için kur girin: ${converted.missing.join(', ')} → TRY` : 'Para birimi bazında'}
          testId="kpi-total-balance"
        />
        <StatTile
          label="Net nakit akışı (ay)"
          value={<MoneyByCurrency map={pick(k.mon, 'net')} empty="0" />}
          tone={Object.values(pick(k.mon, 'net')).some((v) => v! < 0) ? 'danger' : undefined}
          hint="Gelir − gider · virman hariç"
          testId="kpi-net-flow"
        />
        <StatTile label="Bekleyen tahsilatlar" value={<MoneyByCurrency map={k.rec.total} empty="0" />} hint={<>proje alacağı <MoneyByCurrency map={k.rec.project} empty="0" /> · genel <MoneyByCurrency map={k.rec.general} empty="0" /></>} testId="kpi-receivable" />
        <StatTile label="Ödenecek borçlar" value={<MoneyByCurrency map={k.pay.total} empty="0" />} tone={nonZero(k.pay.total) ? 'warn' : undefined} hint={<>proje <MoneyByCurrency map={k.pay.project} empty="0" /> · genel <MoneyByCurrency map={k.pay.general} empty="0" /></>} testId="kpi-payable" />
      </section>
      {k.unassigned > 0 && (
        <FinNotice tone="info" testId="cash-unassigned">
          {k.unassigned} gerçekleşen hareketin hesabı yok (ör. 0.10 öncesi proje gider/tahsilatları). Bu satırlar gelir/gider raporlarında görünür ama hiçbir hesap bakiyesini etkilemez; Gelir-Gider listesinden hesap atayabilirsiniz.
        </FinNotice>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={Plus} onClick={() => onAdd('gelir')} className="h-11" data-testid="dash-add-income">
          Gelir ekle
        </Button>
        <Button variant="secondary" icon={Plus} onClick={() => onAdd('gider')} className="h-11" data-testid="dash-add-expense">
          Gider ekle
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Aylık gelir / gider" subtitle="Son 6 ay · gerçekleşen hareketler · virman hariç · para birimi bazında" icon={BarChart3}>
          {chartCurrencies.length === 0 ? (
            <p className="text-sm text-subtle">Son 6 ayda gerçekleşen gelir veya gider yok.</p>
          ) : (
            <div className="flex flex-col gap-5">
              {chartCurrencies.map((c) => (
                <MonthlyChart key={c} currency={c} series={series.map((m) => ({ month: m.month, in: m.perCurrency[c]?.in ?? 0, out: m.perCurrency[c]?.out ?? 0 }))} />
              ))}
              <ChartLegend />
            </div>
          )}
        </Panel>
        <Panel title="Genel işletme giderleri" subtitle="Bu ay · projesiz gerçekleşen giderler · kategori bazında" icon={Tags} bodyClassName="p-0">
          {k.general.size === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-subtle">Bu ay genel işletme gideri yok.</p>
          ) : (
            <ul className="divide-y divide-line" data-testid="general-expenses">
              {[...k.general.entries()].map(([cat, m]) => (
                <li key={cat ?? '-'} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px]">
                  <span className="text-ink">{names.category(cat)}</span>
                  <MoneyByCurrency map={m} className="font-semibold text-ink" />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Proje bazlı kârlılık" subtitle="KDV hariç · ayrıntı için projeyi açın" icon={Building2} bodyClassName="p-0">
        {profit.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-subtle">Satış bedeli veya gideri girilmiş proje yok.</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="cash-project-profit">
            {profit.map(({ p, s }) => {
              const f = s.profit.realized ?? s.profit.expected
              return (
                <li key={p.id}>
                  <Link to={`/projeler/${p.id}?sekme=finans`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 hover:bg-surface-2/70">
                    <span className="min-w-0 flex-1">
                      <span className="font-mono text-[11px] text-subtle">{p.code}</span>
                      <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                    </span>
                    <span className="text-right text-[12px] text-muted">
                      gerçekleşen gider <span className="font-mono text-ink-2">{s.actual.complete ? formatMoney(s.actual.baseNet, s.base) : '—'}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-right">
                      {f ? (
                        <>
                          <KindBadge kind={s.profit.realized ? 'gerceklesen' : 'tahmini'} />
                          <span className={cn('font-mono text-sm font-semibold', f.profit < 0 ? 'text-danger' : 'text-ink')}>{formatMoney(f.profit, s.base)}</span>
                          <span className="text-[11px] text-muted">{pctText(f.marginBp)}</span>
                        </>
                      ) : (
                        <span className="text-[12px] text-subtle">{s.saleIssue ?? s.estimateIssue ?? '—'}</span>
                      )}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>
  )
}

// ================================================================== GELİR-GİDER LİSTESİ
type Editing =
  | { kind: 'entry'; entry: FinanceEntry; realize?: boolean }
  | { kind: 'expense'; record: CashRecord }
  | { kind: 'collection'; record: CashRecord }
  | null

export function EntriesPanel({ cash, onAdd }: { cash: CashState; onAdd: (k: EntryKind) => void }) {
  const { projects } = useData()
  const { notify } = useToast()
  const names = useNames(cash)
  const today = localISODate()
  const [f, setF] = useState<RecordFilter>({ from: `${today.slice(0, 7)}-01`, to: '', kind: '', status: '', scope: '' })
  const [editing, setEditing] = useState<Editing>(null)
  const [voiding, setVoiding] = useState<CashRecord | null>(null)
  const [history, setHistory] = useState<CashRecord | null>(null)
  const [docs, setDocs] = useState<CashRecord | null>(null)
  const [exporting, setExporting] = useState<null | 'xlsx' | 'pdf'>(null)
  // Telefonda süzgeçler varsayılan kapalı (liste hemen görünsün); geniş ekranda açık
  const [showFilters, setShowFilters] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 640px)').matches)
  const activeFilters = [f.to, f.kind, f.status, f.scope, f.accountId, f.categoryId, f.projectId, f.text].filter(Boolean).length
  const rows = useMemo(() => filterRecords(cash.records, f), [cash.records, f])
  const totals = useMemo(() => recordTotals(rows), [rows])
  const entryById = useMemo(() => new Map(cash.data.entries.map((e) => [e.id, e])), [cash.data.entries])
  const transferById = useMemo(() => new Map(cash.data.transfers.map((t) => [t.id, t])), [cash.data.transfers])
  const expenseById = useMemo(() => new Map(cash.expenses.map((e) => [e.id, e])), [cash.expenses])
  const collectionById = useMemo(() => new Map(cash.collections.map((c) => [c.id, c])), [cash.collections])
  const set = (patch: Partial<RecordFilter>) => setF((x) => ({ ...x, ...patch }))

  const filterText = () => {
    const parts = [`Tarih: ${f.from ? formatDate(f.from) : 'başlangıç'} – ${f.to ? formatDate(f.to) : 'bugün'}`]
    if (f.kind) parts.push(`tür: ${f.kind}`)
    if (f.status) parts.push(`durum: ${f.status}`)
    if (f.scope) parts.push(f.scope === 'proje' ? 'yalnız proje kayıtları' : 'yalnız genel kayıtlar')
    if (f.categoryId) parts.push(`kategori: ${names.category(f.categoryId)}`)
    if (f.projectId) parts.push(`proje: ${names.project(f.projectId)}`)
    if (f.accountId) parts.push(`hesap: ${f.accountId === NO_ACCOUNT ? 'hesapsız' : names.account(f.accountId)}`)
    if (f.text) parts.push(`arama: “${f.text}”`)
    return `${parts.join(' · ')} · ${rows.length} kayıt`
  }
  const exportAs = async (kind: 'xlsx' | 'pdf') => {
    setExporting(kind)
    try {
      const { buildLedgerReport, ledgerFileName, ledgerToPdf, ledgerToXlsx } = await import('@/export/ledgerExport')
      const t = CUR_ORDER.filter((c) => totals.income[c] != null || totals.expense[c] != null).map((c) => ({ currency: c, income: totals.income[c] ?? 0, expense: totals.expense[c] ?? 0, net: totals.net[c] ?? 0 }))
      const report = buildLedgerReport(rows, names, filterText(), t)
      if (kind === 'xlsx') downloadBytes(ledgerToXlsx(report), ledgerFileName('xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      else downloadBytes(await ledgerToPdf(report, await loadPdfAssets()), ledgerFileName('pdf'), 'application/pdf')
    } catch (e) {
      notify(`Çıktı oluşturulamadı: ${e instanceof Error ? e.message : 'bilinmeyen hata'}`, 'error')
    } finally {
      setExporting(null)
    }
  }

  const edit = (r: CashRecord) => {
    if (r.table === 'finance_entries') {
      const e = entryById.get(r.id)
      if (e) setEditing({ kind: 'entry', entry: e })
    } else if (r.table === 'project_expenses') setEditing({ kind: 'expense', record: r })
    else if (r.table === 'project_collections') setEditing({ kind: 'collection', record: r })
  }

  const editExpense = editing?.kind === 'expense' ? (expenseById.get(editing.record.id) ?? null) : null
  const editCollection = editing?.kind === 'collection' ? (collectionById.get(editing.record.id) ?? null) : null

  return (
    <Panel
      title="Gelir-Gider"
      subtitle="Genel kayıtlar, proje tahsilatları, proje giderleri ve virmanlar tek listede. Silme yerine iptal: kayıt saklanır, toplamlara girmez."
      icon={ListFilter}
      bodyClassName="p-0"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={exporting === 'xlsx' ? Loader2 : FileSpreadsheet} disabled={!!exporting || rows.length === 0} onClick={() => void exportAs('xlsx')} data-testid="ledger-xlsx">
            Excel
          </Button>
          <Button variant="secondary" icon={exporting === 'pdf' ? Loader2 : FileDown} disabled={!!exporting || rows.length === 0} onClick={() => void exportAs('pdf')} data-testid="ledger-pdf">
            PDF
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => onAdd('gider')} data-testid="entries-add">
            Ekle
          </Button>
        </div>
      }
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 sm:hidden">
        <span className="text-[12.5px] text-muted">{f.from ? `${formatDate(f.from)}’den itibaren` : 'Tüm tarihler'}{activeFilters ? ` · ${activeFilters} süzgeç` : ''}</span>
        <Button variant="ghost" icon={ListFilter} className="h-10 px-3" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters} data-testid="ledger-filters-toggle">
          {showFilters ? 'Süzgeçleri gizle' : 'Süzgeçler'}
        </Button>
      </div>
      <div className={cn('grid grid-cols-2 gap-2 border-b border-line px-4 py-3 sm:grid sm:grid-cols-3 lg:grid-cols-5', !showFilters && 'hidden')} data-testid="ledger-filters">
        <TextField label="Başlangıç" type="date" value={f.from ?? ''} onChange={(e) => set({ from: e.target.value })} data-testid="lf-from" />
        <TextField label="Bitiş" type="date" value={f.to ?? ''} onChange={(e) => set({ to: e.target.value })} data-testid="lf-to" />
        <FilterSelect label="Tür" value={f.kind ?? ''} onChange={(v) => set({ kind: v as RecordFilter['kind'] })} className="mt-auto">
          <option value="">Tüm türler</option>
          <option value="gelir">Gelir</option>
          <option value="gider">Gider</option>
          <option value="transfer">Virman</option>
        </FilterSelect>
        <FilterSelect label="Durum" value={f.status ?? ''} onChange={(v) => set({ status: v as RecordFilter['status'] })} className="mt-auto">
          <option value="">Tüm durumlar</option>
          <option value="gerceklesti">Gerçekleşti</option>
          <option value="bekliyor">Bekliyor</option>
          <option value="iptal">İptal</option>
        </FilterSelect>
        <FilterSelect label="Kapsam" value={f.scope ?? ''} onChange={(v) => set({ scope: v as RecordFilter['scope'] })} className="mt-auto">
          <option value="">Proje + genel</option>
          <option value="proje">Yalnız proje</option>
          <option value="genel">Yalnız genel</option>
        </FilterSelect>
        <FilterSelect label="Hesap" value={f.accountId ?? ''} onChange={(v) => set({ accountId: v })}>
          <option value="">Tüm hesaplar</option>
          <option value={NO_ACCOUNT}>Hesapsız</option>
          {cash.data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {accountLabel(a)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Kategori" value={f.categoryId ?? ''} onChange={(v) => set({ categoryId: v })}>
          <option value="">Tüm kategoriler</option>
          {cash.data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.kind === 'gelir' ? 'Gelir' : 'Gider'} · {c.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Proje" value={f.projectId ?? ''} onChange={(v) => set({ projectId: v })}>
          <option value="">Tüm projeler</option>
          {[...projects].sort((a, b) => a.code.localeCompare(b.code, 'tr')).map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </FilterSelect>
        <div className="col-span-2">
          <SearchInput value={f.text ?? ''} onChange={(v) => set({ text: v })} placeholder="Açıklama veya belge no ara" label="Kayıt ara" />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-line bg-surface-2/50 px-4 py-2.5 text-[12.5px]" data-testid="ledger-totals">
        <span className="text-muted">
          Gelir <MoneyByCurrency map={totals.income} empty="0" className="font-semibold text-ok" testId="lt-income" />
        </span>
        <span className="text-muted">
          Gider <MoneyByCurrency map={totals.expense} empty="0" className="font-semibold text-danger" testId="lt-expense" />
        </span>
        <span className="text-muted">
          Net <MoneyByCurrency map={totals.net} empty="0" className="font-semibold text-ink" testId="lt-net" />
        </span>
        <span className="text-subtle">Yalnız gerçekleşen; bekleyen, iptal ve virman hariç</span>
      </div>
      {cash.loading && cash.records.length === 0 ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-subtle">Seçilen süzgeçlere uyan kayıt yok.</p>
      ) : (
        <ul className="divide-y divide-line" data-testid="ledger-list">
          {rows.map((r) => {
            const project = names.projectRow(r.projectId)
            const signed = r.kind === 'gelir' ? r.amount : -r.amount
            const voidable = r.status !== 'iptal' && (r.table === 'finance_entries' || r.table === 'finance_transfers')
            return (
              <li key={`${r.table}:${r.id}`} className={cn('flex flex-wrap items-start gap-x-3 gap-y-1.5 px-4 py-3', r.status === 'iptal' && 'opacity-60')} data-testid="ledger-row" data-table={r.table} data-id={r.id} data-status={r.status}>
                <div className="w-[92px] shrink-0 font-mono text-[12px] whitespace-nowrap text-muted">{formatDate(r.date)}</div>
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <MovementKindBadge kind={r.kind} />
                    <RecordStatusBadge status={r.status} />
                    <span className={cn('min-w-0 text-[13.5px] font-medium break-words text-ink', r.status === 'iptal' && 'line-through')}>{r.description}</span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-muted">
                    {r.transfer ? `${names.account(r.transfer.fromAccountId)} → ${names.account(r.transfer.toAccountId)}` : names.account(r.accountId)}
                    {r.categoryId && ` · ${names.category(r.categoryId)}`}
                    {' · '}
                    {r.source === 'transfer' ? 'Virman' : LEDGER_SOURCE_LABEL[r.source]}
                    {project && (
                      <>
                        {' · '}
                        <Link to={`/projeler/${project.id}?sekme=finans`} className="font-mono underline-offset-2 hover:underline">
                          {project.code}
                        </Link>
                      </>
                    )}
                    {r.status === 'bekliyor' && r.dueDate && ` · vade ${formatDate(r.dueDate)}`}
                    {r.voidedReason && ` · iptal sebebi: ${r.voidedReason}`}
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className={cn('font-mono text-[14px] font-semibold whitespace-nowrap', r.kind === 'gelir' ? 'text-ok' : r.kind === 'gider' ? 'text-danger' : 'text-ink')} data-testid="ledger-amount">
                    {r.kind === 'transfer' ? formatMoney(r.amount, r.currency) : `${signed > 0 ? '+' : '−'}${formatMoney(Math.abs(signed), r.currency)}`}
                  </div>
                  {r.transfer && r.transfer.toCurrency !== r.currency && <div className="font-mono text-[11px] text-muted">→ {formatMoney(r.transfer.toAmount, r.transfer.toCurrency)}</div>}
                  {r.vat > 0 && <div className="text-[11px] text-muted">KDV {formatMoney(r.vat, r.currency)}</div>}
                </div>
                <div className="flex w-full justify-end gap-0.5 sm:w-[188px]">
                  {r.status === 'bekliyor' && r.table === 'finance_entries' && (
                    <button type="button" onClick={() => setEditing({ kind: 'entry', entry: entryById.get(r.id)!, realize: true })} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ok" aria-label="Gerçekleşti olarak işaretle" title="Ödendi / tahsil edildi" data-testid="record-realize">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                  {r.status !== 'iptal' && r.table !== 'finance_transfers' && (
                    <button type="button" onClick={() => edit(r)} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Düzenle" data-testid="record-edit">
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                  {r.table !== 'finance_transfers' && (
                    <button type="button" onClick={() => setDocs(r)} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Belgeler" data-testid="record-docs">
                      <Paperclip className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                  <HistoryButton onClick={() => setHistory(r)} />
                  {voidable && (
                    <button type="button" onClick={() => setVoiding(r)} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger" aria-label="İptal et" data-testid="record-void">
                      <Ban className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <EntryDialog
        open={editing?.kind === 'entry'}
        onClose={() => setEditing(null)}
        accounts={cash.data.accounts}
        categories={cash.data.categories}
        entry={editing?.kind === 'entry' ? editing.entry : null}
        realize={editing?.kind === 'entry' && !!editing.realize}
      />
      {editExpense && (
        <ExpenseForm open onClose={() => setEditing(null)} projectId={editExpense.project_id} expense={editExpense} base={editExpense.currency} />
      )}
      {editCollection && (
        <CollectionForm
          open
          onClose={() => setEditing(null)}
          projectId={editCollection.project_id}
          row={editCollection}
          schedule={cash.data.projects.get(editCollection.project_id)?.schedule ?? []}
          base={editCollection.currency}
        />
      )}
      <VoidDialog
        open={!!voiding}
        onClose={() => setVoiding(null)}
        title={voiding?.table === 'finance_transfers' ? 'Virmanı iptal et' : 'Kaydı iptal et'}
        onConfirm={async (reason) => {
          const db = requireSupabase()
          if (!voiding) return
          if (voiding.table === 'finance_entries') await voidEntry(db, entryById.get(voiding.id)!, reason)
          else await voidTransfer(db, transferById.get(voiding.id)!, reason)
          notify('Kayıt iptal edildi; bakiye ve raporlardan çıkarıldı.')
          await cash.reload()
        }}
      />
      {history && (
        <HistoryDialog open onClose={() => setHistory(null)} table={history.table} rowId={history.id} title={`Geçmiş · ${history.description}`} resolve={names.resolve} />
      )}
      {docs && (
        <Modal open onClose={() => setDocs(null)} title={`Belgeler · ${docs.description}`}>
          <DocumentsSection table={docs.table as DocumentTable} entryId={docs.id} />
        </Modal>
      )}
    </Panel>
  )
}

// ================================================================== KASA & BANKA
export function AccountsPanel({ cash }: { cash: CashState }) {
  const { notify } = useToast()
  const names = useNames(cash)
  const [form, setForm] = useState<{ open: boolean; account: FinanceAccount | null }>({ open: false, account: null })
  const [transfer, setTransfer] = useState<{ open: boolean; from?: string }>({ open: false })
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<FinanceAccount | null>(null)
  const [busy, setBusy] = useState(false)
  const totals = balanceTotals(cash.balances.values(), (b) => cash.data.accounts.find((a) => a.id === b.accountId)?.active !== false)
  const referenced = useMemo(() => {
    const s = new Set<string>()
    for (const r of cash.records) {
      if (r.accountId) s.add(r.accountId)
      if (r.transfer) s.add(r.transfer.toAccountId)
    }
    for (const r of cash.data.recurring) if (r.account_id) s.add(r.account_id)
    return s
  }, [cash.records, cash.data.recurring])

  if (cash.error) return <ErrorState message={cash.error} onRetry={() => void cash.reload()} />
  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Kasa & Banka"
        subtitle="Bakiye = açılış bakiyesi + gerçekleşen girişler − çıkışlar. Ödenmemiş gider, bekleyen kayıt ve alacak bakiyeye girmez."
        icon={Landmark}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={ArrowRightLeft} onClick={() => setTransfer({ open: true })} disabled={cash.data.accounts.filter((a) => a.active).length < 2} data-testid="transfer-add">
              Virman
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => setForm({ open: true, account: null })} data-testid="account-add">
              Hesap ekle
            </Button>
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap items-baseline gap-2 text-[13px] text-muted">
          Etkin hesaplar toplamı: <MoneyByCurrency map={totals} empty="0" className="text-[15px] font-semibold text-ink" testId="accounts-total" />
        </div>
        {cash.loading && cash.data.accounts.length === 0 ? (
          <LoadingState />
        ) : cash.data.accounts.length === 0 ? (
          <p className="text-sm text-subtle">Henüz hesap yok. Önce kasa (nakit) ve banka hesaplarınızı açılış bakiyeleriyle ekleyin.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="accounts">
            {cash.data.accounts.map((a) => {
              const b = cash.balances.get(a.id)
              const Icon = a.kind === 'kasa' ? Wallet : Landmark
              return (
                <li key={a.id} className={cn('rounded-xl border border-line bg-surface-2/40 p-4', !a.active && 'opacity-60')} data-testid="account-card" data-name={a.name}>
                  <div className="flex items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface">
                      <Icon className="h-4 w-4 text-titanium" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink">{a.name}</div>
                      <div className="text-[11.5px] text-muted">
                        {ACCOUNT_KIND_LABEL[a.kind]} · {a.currency}
                        {a.bank_name && ` · ${a.bank_name}`}
                        {!a.active && ' · pasif'}
                      </div>
                      {a.iban && <div className="mt-0.5 font-mono text-[11px] break-all text-subtle">{a.iban.replace(/(.{4})/g, '$1 ').trim()}</div>}
                    </div>
                    <button type="button" onClick={() => setForm({ open: true, account: a })} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-3 hover:text-ink" aria-label={`${a.name} düzenle`} data-testid="account-edit">
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div className={cn('mt-3 font-mono text-[20px] font-semibold', (b?.balance ?? 0) < 0 ? 'text-danger' : 'text-ink')} data-testid="account-balance">
                    {formatMoney(b?.balance ?? toCents(a.opening_balance), a.currency)}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-muted">
                    açılış {formatMoney(b?.opening ?? 0, a.currency)} · giriş {formatMoney(b?.totalIn ?? 0, a.currency)} · çıkış {formatMoney(b?.totalOut ?? 0, a.currency)}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="ghost" icon={ChevronDown} onClick={() => setExpanded(expanded === a.id ? null : a.id)} className="h-9 px-2.5" data-testid="account-movements-toggle">
                      Hareketler ({b?.movementCount ?? 0})
                    </Button>
                    {a.active && (
                      <Button variant="ghost" icon={ArrowRightLeft} onClick={() => setTransfer({ open: true, from: a.id })} className="h-9 px-2.5">
                        Virman
                      </Button>
                    )}
                    {!referenced.has(a.id) && (
                      <Button variant="ghost" icon={Trash2} onClick={() => setPendingDelete(a)} className="h-9 px-2.5 hover:text-danger" data-testid="account-delete">
                        Sil
                      </Button>
                    )}
                  </div>
                  {expanded === a.id && <AccountMovements cash={cash} account={a} names={names} />}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
      <AccountForm open={form.open} onClose={() => setForm({ open: false, account: null })} account={form.account} hasMovements={!!form.account && referenced.has(form.account.id)} />
      <TransferDialog open={transfer.open} onClose={() => setTransfer({ open: false })} accounts={cash.data.accounts} defaultFrom={transfer.from} />
      <ConfirmDialog
        open={!!pendingDelete}
        title="Hesap silinsin mi?"
        message={pendingDelete ? `${pendingDelete.name} silinecek. Hareketi olan hesap silinemez; o durumda pasifleştirin.` : ''}
        busy={busy}
        onConfirm={async () => {
          if (!pendingDelete) return
          setBusy(true)
          try {
            await deleteAccount(requireSupabase(), pendingDelete.id)
            notify('Hesap silindi.')
            setPendingDelete(null)
          } catch (e) {
            notify(cashErrorMessage(e, 'Hesap silme'), 'error')
          } finally {
            setBusy(false)
          }
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}

/** Hesap hareketleri: en yeni üstte, her satırdan sonraki bakiye (yürüyen bakiye) */
function AccountMovements({ cash, account, names }: { cash: CashState; account: FinanceAccount; names: ReturnType<typeof useNames> }) {
  const rows = useMemo(() => {
    const own = cash.ledger.filter((l) => l.accountId === account.id)
    const asc = [...own].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    let bal = toCents(account.opening_balance)
    const out = asc.map((l) => {
      bal += l.direction === 'giris' ? l.amount : -l.amount
      return { l, bal }
    })
    return out.reverse()
  }, [cash.ledger, account])
  if (rows.length === 0) return <p className="mt-3 text-[12.5px] text-subtle">Bu hesapta gerçekleşen hareket yok.</p>
  return (
    <ul className="mt-3 max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-surface" data-testid="account-movements">
      {rows.map(({ l, bal }) => (
        <li key={`${l.source}:${l.sourceId}`} className="flex items-start gap-2 px-3 py-2 text-[12.5px]" data-testid="account-movement">
          <span className="w-[68px] shrink-0 font-mono text-[11px] text-muted">{formatDate(l.date)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ink">{l.description}</span>
            <span className="text-[11px] text-muted">
              {LEDGER_SOURCE_LABEL[l.source]}
              {l.categoryId && ` · ${names.category(l.categoryId)}`}
              {l.projectId && ` · ${names.project(l.projectId)}`}
            </span>
          </span>
          <span className="text-right">
            <span className={cn('block font-mono font-semibold whitespace-nowrap', l.direction === 'giris' ? 'text-ok' : 'text-danger')}>
              {l.direction === 'giris' ? '+' : '−'}
              {formatMoney(l.amount, l.currency)}
            </span>
            <span className="font-mono text-[11px] text-muted">{formatMoney(bal, l.currency)}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

// ================================================================== KATEGORİLER
export function CategoriesPanel({ cash }: { cash: CashState }) {
  const { notify } = useToast()
  const [form, setForm] = useState<{ open: boolean; category: FinanceCategory | null; kind: EntryKind }>({ open: false, category: null, kind: 'gider' })
  const [pending, setPending] = useState<FinanceCategory | null>(null)
  const [busy, setBusy] = useState(false)
  const used = useMemo(() => {
    const s = new Set<string>()
    for (const r of cash.records) if (r.categoryId) s.add(r.categoryId)
    for (const r of cash.data.recurring) s.add(r.category_id)
    return s
  }, [cash.records, cash.data.recurring])
  const col = (kind: EntryKind) => (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-ink">{kind === 'gelir' ? 'Gelir kategorileri' : 'Gider kategorileri'}</h3>
        <Button variant="ghost" icon={Plus} className="h-9 px-2.5" onClick={() => setForm({ open: true, category: null, kind })} data-testid={`category-add-${kind}`}>
          Ekle
        </Button>
      </div>
      <ul className="divide-y divide-line rounded-xl border border-line" data-testid={`categories-${kind}`}>
        {cash.data.categories
          .filter((c) => c.kind === kind)
          .map((c) => (
            <li key={c.id} className={cn('flex items-center gap-2 px-3 py-2 text-[13px]', !c.active && 'opacity-60')} data-testid="category-row" data-name={c.name}>
              <span className="min-w-0 flex-1 truncate text-ink">{c.name}</span>
              {c.is_system && <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">Sistem</span>}
              {!c.active && <span className="text-[11px] text-muted">pasif</span>}
              <button type="button" onClick={() => setForm({ open: true, category: c, kind })} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-ink" aria-label={`${c.name} düzenle`}>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              {!c.is_system && !used.has(c.id) && (
                <button type="button" onClick={() => setPending(c)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger" aria-label={`${c.name} sil`}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
      </ul>
    </div>
  )
  return (
    <Panel title="Kategoriler" subtitle="Sistem kategorileri silinemez (pasifleştirilebilir). Kullanılan kategori silinemez." icon={Tags}>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {col('gider')}
        {col('gelir')}
      </div>
      <CategoryForm open={form.open} onClose={() => setForm((x) => ({ ...x, open: false }))} category={form.category} kind={form.kind} />
      <ConfirmDialog
        open={!!pending}
        title="Kategori silinsin mi?"
        message={pending ? `${pending.name} silinecek.` : ''}
        busy={busy}
        onConfirm={async () => {
          if (!pending) return
          setBusy(true)
          try {
            await deleteCategory(requireSupabase(), pending.id)
            notify('Kategori silindi.')
            setPending(null)
          } catch (e) {
            notify(cashErrorMessage(e, 'Kategori silme'), 'error')
          } finally {
            setBusy(false)
          }
        }}
        onClose={() => setPending(null)}
      />
    </Panel>
  )
}

// ================================================================== DÜZENLİ
export function RecurringPanel({ cash }: { cash: CashState }) {
  const { notify } = useToast()
  const names = useNames(cash)
  const [form, setForm] = useState<{ open: boolean; row: FinanceRecurring | null }>({ open: false, row: null })
  const [pending, setPending] = useState<FinanceRecurring | null>(null)
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [realize, setRealize] = useState<FinanceEntry | null>(null)
  const open = cash.data.entries.filter((e) => e.recurring_id && e.status === 'bekliyor' && !e.voided_at).sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1))
  const generate = async () => {
    setGenerating(true)
    try {
      const n = await generateRecurring(requireSupabase())
      notify(n ? `${n} bekleyen kayıt oluşturuldu.` : 'Vadesi gelmiş yeni kayıt yok.')
      await cash.reload()
    } catch (e) {
      notify(cashErrorMessage(e, 'Düzenli kayıt üretimi'), 'error')
    } finally {
      setGenerating(false)
    }
  }
  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Düzenli gelir / gider"
        subtitle="Kira, maaş, abonelik gibi tekrar eden kayıtlar. Vadesi gelen her tarih için bir kez “bekliyor” kaydı oluşturulur."
        icon={Repeat}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={generating ? Loader2 : CalendarClock} onClick={() => void generate()} disabled={generating} data-testid="recurring-generate">
              Şimdi üret
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => setForm({ open: true, row: null })} data-testid="recurring-add">
              Düzenli kayıt ekle
            </Button>
          </div>
        }
        bodyClassName="p-0"
      >
        {cash.data.recurring.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-subtle">Düzenli kayıt yok.</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="recurring-list">
            {cash.data.recurring.map((r) => (
              <li key={r.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-[13px]', !r.active && 'opacity-60')} data-testid="recurring-row">
                <MovementKindBadge kind={r.kind} />
                <div className="min-w-0 flex-1 basis-48">
                  <div className="font-medium text-ink">{r.description}</div>
                  <div className="text-[11.5px] text-muted">
                    {FREQUENCY_LABEL[r.frequency]} · {names.category(r.category_id)} · {r.account_id ? names.account(r.account_id) : 'hesap ödemede seçilir'} · sıradaki {formatDate(r.next_date)}
                    {r.end_date && ` · bitiş ${formatDate(r.end_date)}`}
                    {!r.active && ' · durduruldu'}
                  </div>
                </div>
                <span className="font-mono font-semibold text-ink">{formatMoney(toCents(r.amount) + toCents(r.vat_amount), r.currency)}</span>
                <div className="flex gap-0.5">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await updateRecurring(requireSupabase(), r, { active: !r.active })
                      } catch (e) {
                        notify(cashErrorMessage(e, 'Düzenli kayıt'), 'error')
                      }
                    }}
                    className="h-8 rounded-md px-2 text-[12px] text-muted hover:bg-surface-3 hover:text-ink"
                  >
                    {r.active ? 'Durdur' : 'Sürdür'}
                  </button>
                  <button type="button" onClick={() => setForm({ open: true, row: r })} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-ink" aria-label={`${r.description} düzenle`}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setPending(r)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger" aria-label={`${r.description} sil`}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Bekleyen düzenli kayıtlar" subtitle="Ödendiğinde / tahsil edildiğinde işaretleyin; hesap bakiyesine o zaman girer." icon={CalendarClock} bodyClassName="p-0">
        {open.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-subtle">Bekleyen düzenli kayıt yok.</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="recurring-open">
            {open.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[13px]">
                <span className={cn('font-mono text-[12px]', (e.due_date ?? e.entry_date) < localISODate() ? 'text-danger' : 'text-muted')}>{formatDate(e.due_date ?? e.entry_date)}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{e.description}</span>
                <span className="font-mono font-semibold">{formatMoney(toCents(e.amount) + toCents(e.vat_amount), e.currency)}</span>
                <Button variant="secondary" icon={CheckCircle2} className="h-9" onClick={() => setRealize(e)}>
                  {e.kind === 'gelir' ? 'Tahsil edildi' : 'Ödendi'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <RecurringForm open={form.open} onClose={() => setForm({ open: false, row: null })} row={form.row} accounts={cash.data.accounts} categories={cash.data.categories} />
      <EntryDialog open={!!realize} onClose={() => setRealize(null)} accounts={cash.data.accounts} categories={cash.data.categories} entry={realize} realize />
      <ConfirmDialog
        open={!!pending}
        title="Düzenli kayıt silinsin mi?"
        message={pending ? `${pending.description} şablonu silinecek. Daha önce üretilmiş kayıtlar korunur.` : ''}
        busy={busy}
        onConfirm={async () => {
          if (!pending) return
          setBusy(true)
          try {
            await deleteRecurring(requireSupabase(), pending.id)
            notify('Düzenli kayıt silindi.')
            setPending(null)
          } catch (e) {
            notify(cashErrorMessage(e, 'Düzenli kayıt silme'), 'error')
          } finally {
            setBusy(false)
          }
        }}
        onClose={() => setPending(null)}
      />
    </div>
  )
}
