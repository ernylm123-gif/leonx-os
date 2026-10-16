/**
 * Nakit defteri — veritabanındaki public.finance_ledger / finance_account_balances görünümleriyle AYNI kurallar.
 * İstemcideki TEK tanım budur: panel, Gelir-Gider listesi, hesap bakiyeleri, grafik ve dışa aktarım
 * yalnız bu modülün sonuçlarını kullanır.
 *
 * Kurallar
 *  1. Kaynaklar: genel kayıt (finance_entries), proje tahsilatı (project_collections), proje gideri
 *     (project_expenses), virman (finance_transfers). Aynı hareket iki kaynakta tutulmaz.
 *  2. Deftere (ve bakiyeye) yalnız GERÇEKLEŞEN hareket girer: genel kayıt "gerceklesti" ve iptal edilmemiş,
 *     tahsilatın tamamı, gider yalnız ödenmişse, virman iptal edilmemişse (çıkış + giriş iki satır).
 *     Ödenmemiş gider, "bekliyor" kayıt ve alacak (ödeme planı) bakiyeyi ASLA etkilemez.
 *  3. Tutar = nakit hareketi: genel kayıt ve gider için KDV hariç tutar + KDV; tahsilat için tahsil edilen tutar.
 *  4. Bakiye = açılış bakiyesi + Σ giriş − Σ çıkış. Hesapsız satır ("hesapsız") hiçbir bakiyeye girmez.
 *  5. Virman gelir veya gider DEĞİLDİR; gelir/gider toplamlarına girmez.
 *  6. Hesaplar tamsayı kuruşla yapılır; farklı para birimleri ASLA kendiliğinden toplanmaz. Birleşik toplam
 *     yalnız tüm kurlar girilmişse, girilen kurla üretilir (src/finance/fx.ts).
 */
import { toCents } from '@/quote/money'
import type { Currency } from '@/quote/types'
import type { EntryKind, FinanceAccount, FinanceEntry, FinanceTransfer } from './cash'
import { convertCents, type FxRateLike, resolveRate } from './fx'
import { receivables } from './receivables'
import type { Collection, Expense, PaymentMethod, PaymentScheduleRow } from './types'

export type LedgerSource = 'genel' | 'proje_tahsilat' | 'proje_gider' | 'transfer_cikis' | 'transfer_giris'
export const LEDGER_SOURCE_LABEL: Record<LedgerSource, string> = {
  genel: 'Genel',
  proje_tahsilat: 'Proje tahsilatı',
  proje_gider: 'Proje gideri',
  transfer_cikis: 'Virman çıkışı',
  transfer_giris: 'Virman girişi',
}
export type Direction = 'giris' | 'cikis'
export type MovementKind = EntryKind | 'transfer'
export type RecordTable = 'finance_entries' | 'project_collections' | 'project_expenses' | 'finance_transfers'
/** Kaydın durumu: iptal edilen kayıt saklanır ama hiçbir toplama girmez */
export type RecordStatus = 'gerceklesti' | 'bekliyor' | 'iptal'
export const RECORD_STATUS_LABEL: Record<RecordStatus, string> = { gerceklesti: 'Gerçekleşti', bekliyor: 'Bekliyor', iptal: 'İptal' }

/** Gelir-Gider listesindeki bir kayıt (gerçekleşmemiş ve iptal edilmişler dahil) */
export interface CashRecord {
  table: RecordTable
  id: string
  /** Virmanda null (iki yönlü) */
  source: Exclude<LedgerSource, 'transfer_cikis' | 'transfer_giris'> | 'transfer'
  kind: MovementKind
  date: string
  status: RecordStatus
  currency: Currency
  /** Nakit tutarı (kuruş, KDV dahil) — virmanda çıkan tutar */
  amount: number
  net: number
  vat: number
  accountId: string | null
  categoryId: string | null
  projectId: string | null
  companyId: string | null
  description: string
  paymentMethod: PaymentMethod | null
  documentNo: string | null
  dueDate: string | null
  createdAt: string
  voidedReason: string | null
  /** Yalnız virman */
  transfer?: { fromAccountId: string; toAccountId: string; fromAmount: number; toAmount: number; toCurrency: Currency }
}

/** Defter satırı — finance_ledger görünümünün bir satırı */
export interface LedgerRow {
  source: LedgerSource
  sourceId: string
  date: string
  accountId: string | null
  currency: Currency
  direction: Direction
  /** Kuruş, KDV dahil nakit tutarı */
  amount: number
  net: number
  vat: number
  categoryId: string | null
  projectId: string | null
  companyId: string | null
  kind: MovementKind
  description: string
  paymentMethod: PaymentMethod | null
  documentNo: string | null
  createdAt: string
}

export interface CashSources {
  entries: readonly FinanceEntry[]
  collections: readonly Collection[]
  expenses: readonly Expense[]
  transfers: readonly FinanceTransfer[]
  accounts: readonly Pick<FinanceAccount, 'id' | 'currency'>[]
  /** Proje → firma (tahsilat/gider satırının firması projenin firmasıdır) */
  projects?: readonly { id: string; company_id: string | null }[]
}

const nonEmpty = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null)

/** Tüm kayıtlar (liste ekranı). Sıra: tarih (yeni önce), oluşturulma (yeni önce), kimlik. */
export function buildRecords(src: CashSources): CashRecord[] {
  const companyOf = new Map((src.projects ?? []).map((p) => [p.id, p.company_id]))
  const curOf = new Map(src.accounts.map((a) => [a.id, a.currency]))
  const out: CashRecord[] = []
  for (const e of src.entries) {
    const net = toCents(e.amount)
    const vat = toCents(e.vat_amount)
    out.push({
      table: 'finance_entries',
      id: e.id,
      source: 'genel',
      kind: e.kind,
      date: e.entry_date,
      status: e.voided_at ? 'iptal' : e.status,
      currency: e.currency,
      amount: net + vat,
      net,
      vat,
      accountId: e.account_id,
      categoryId: e.category_id,
      projectId: null,
      companyId: e.company_id,
      description: e.description,
      paymentMethod: e.payment_method,
      documentNo: e.document_no,
      dueDate: e.due_date,
      createdAt: e.created_at,
      voidedReason: e.voided_reason,
    })
  }
  for (const c of src.collections) {
    const amt = toCents(c.amount)
    out.push({
      table: 'project_collections',
      id: c.id,
      source: 'proje_tahsilat',
      kind: 'gelir',
      date: c.received_date,
      status: 'gerceklesti',
      currency: c.currency,
      amount: amt,
      net: amt,
      vat: 0,
      accountId: c.account_id ?? null,
      categoryId: c.category_id ?? null,
      projectId: c.project_id,
      companyId: companyOf.get(c.project_id) ?? null,
      description: nonEmpty(c.note) ?? 'Tahsilat',
      paymentMethod: c.method,
      documentNo: c.reference,
      dueDate: null,
      createdAt: c.created_at,
      voidedReason: null,
    })
  }
  for (const x of src.expenses) {
    const net = toCents(x.amount)
    const vat = toCents(x.vat_amount)
    out.push({
      table: 'project_expenses',
      id: x.id,
      source: 'proje_gider',
      kind: 'gider',
      date: x.expense_date,
      status: x.paid ? 'gerceklesti' : 'bekliyor',
      currency: x.currency,
      amount: net + vat,
      net,
      vat,
      accountId: x.account_id ?? null,
      categoryId: x.category_id ?? null,
      projectId: x.project_id,
      companyId: companyOf.get(x.project_id) ?? null,
      description: x.description,
      paymentMethod: x.payment_method ?? null,
      documentNo: x.document_no,
      dueDate: null,
      createdAt: x.created_at,
      voidedReason: null,
    })
  }
  for (const t of src.transfers) {
    const from = curOf.get(t.from_account_id)
    const to = curOf.get(t.to_account_id)
    // Hesabı görünmeyen virman (olmamalı) atlanır: görünümdeki iç birleşimle aynı
    if (!from || !to) continue
    const fa = toCents(t.from_amount)
    out.push({
      table: 'finance_transfers',
      id: t.id,
      source: 'transfer',
      kind: 'transfer',
      date: t.transfer_date,
      status: t.voided_at ? 'iptal' : 'gerceklesti',
      currency: from,
      amount: fa,
      net: fa,
      vat: 0,
      accountId: t.from_account_id,
      categoryId: null,
      projectId: null,
      companyId: null,
      description: nonEmpty(t.description) ?? 'Virman',
      paymentMethod: null,
      documentNo: null,
      dueDate: null,
      createdAt: t.created_at,
      voidedReason: t.voided_reason,
      transfer: { fromAccountId: t.from_account_id, toAccountId: t.to_account_id, fromAmount: fa, toAmount: toCents(t.to_amount), toCurrency: to },
    })
  }
  return out.sort(compareRecords)
}

function compareRecords(a: { date: string; createdAt: string; id: string }, b: { date: string; createdAt: string; id: string }): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/** Kayıtlardan defter satırları: yalnız gerçekleşen ve iptal edilmemiş; virman iki satır */
export function ledgerFromRecords(records: readonly CashRecord[]): LedgerRow[] {
  const out: LedgerRow[] = []
  for (const r of records) {
    if (r.status !== 'gerceklesti') continue
    const base = { sourceId: r.id, date: r.date, categoryId: r.categoryId, projectId: r.projectId, companyId: r.companyId, kind: r.kind, description: r.description, paymentMethod: r.paymentMethod, documentNo: r.documentNo, createdAt: r.createdAt }
    if (r.transfer) {
      out.push({ ...base, source: 'transfer_cikis', accountId: r.transfer.fromAccountId, currency: r.currency, direction: 'cikis', amount: r.transfer.fromAmount, net: r.transfer.fromAmount, vat: 0 })
      out.push({ ...base, source: 'transfer_giris', accountId: r.transfer.toAccountId, currency: r.transfer.toCurrency, direction: 'giris', amount: r.transfer.toAmount, net: r.transfer.toAmount, vat: 0 })
      continue
    }
    out.push({
      ...base,
      source: r.source as LedgerSource,
      accountId: r.accountId,
      currency: r.currency,
      direction: r.kind === 'gelir' ? 'giris' : 'cikis',
      amount: r.amount,
      net: r.net,
      vat: r.vat,
    })
  }
  return out
}

export function buildLedger(src: CashSources): LedgerRow[] {
  return ledgerFromRecords(buildRecords(src))
}

// ------------------------------------------------------------------ Bakiyeler

export interface AccountBalance {
  accountId: string
  currency: Currency
  opening: number
  totalIn: number
  totalOut: number
  balance: number
  movementCount: number
  lastMovementDate: string | null
}

/** finance_account_balances karşılığı (kuruş) */
export function accountBalances(accounts: readonly Pick<FinanceAccount, 'id' | 'currency' | 'opening_balance'>[], ledger: readonly LedgerRow[]): Map<string, AccountBalance> {
  const out = new Map<string, AccountBalance>()
  for (const a of accounts) {
    const opening = toCents(a.opening_balance)
    out.set(a.id, { accountId: a.id, currency: a.currency, opening, totalIn: 0, totalOut: 0, balance: opening, movementCount: 0, lastMovementDate: null })
  }
  for (const l of ledger) {
    const b = l.accountId ? out.get(l.accountId) : undefined
    if (!b) continue
    if (l.direction === 'giris') {
      b.totalIn += l.amount
      b.balance += l.amount
    } else {
      b.totalOut += l.amount
      b.balance -= l.amount
    }
    b.movementCount++
    if (!b.lastMovementDate || l.date > b.lastMovementDate) b.lastMovementDate = l.date
  }
  return out
}

export type CurrencyMap = Partial<Record<Currency, number>>
const add = (m: CurrencyMap, c: Currency, v: number) => {
  m[c] = (m[c] ?? 0) + v
}

/** Hesap bakiyelerinin para birimi bazında toplamı (yalnız aynı birimler toplanır) */
export function balanceTotals(balances: Iterable<AccountBalance>, filter?: (b: AccountBalance) => boolean): CurrencyMap {
  const m: CurrencyMap = {}
  for (const b of balances) if (!filter || filter(b)) add(m, b.currency, b.balance)
  return m
}

// ------------------------------------------------------------------ Dönem özeti

export interface PeriodTotals {
  incomeProject: number
  incomeGeneral: number
  expenseProject: number
  expenseGeneral: number
  income: number
  expense: number
  /** Net nakit akışı = gelir − gider (virman hariç) */
  net: number
}
const emptyPeriod = (): PeriodTotals => ({ incomeProject: 0, incomeGeneral: 0, expenseProject: 0, expenseGeneral: 0, income: 0, expense: 0, net: 0 })

/** [from, to] tarih aralığındaki gerçekleşen gelir/gider, para birimi bazında. Virman dahil edilmez. */
export function periodTotals(ledger: readonly LedgerRow[], from: string, to: string): Partial<Record<Currency, PeriodTotals>> {
  const out: Partial<Record<Currency, PeriodTotals>> = {}
  for (const l of ledger) {
    if (l.kind === 'transfer' || l.date < from || l.date > to) continue
    const t = (out[l.currency] ??= emptyPeriod())
    if (l.kind === 'gelir') {
      t.income += l.amount
      if (l.source === 'genel') t.incomeGeneral += l.amount
      else t.incomeProject += l.amount
    } else {
      t.expense += l.amount
      if (l.source === 'genel') t.expenseGeneral += l.amount
      else t.expenseProject += l.amount
    }
    t.net = t.income - t.expense
  }
  return out
}

/** Para birimi bazındaki dönem toplamlarından tek alan */
export function pick(p: Partial<Record<Currency, PeriodTotals>>, key: keyof PeriodTotals): CurrencyMap {
  const m: CurrencyMap = {}
  for (const [c, t] of Object.entries(p) as [Currency, PeriodTotals][]) m[c] = t[key]
  return m
}

/** Ayın ilk ve son günü ("2026-10" → ["2026-10-01", "2026-10-31"]) */
export function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`]
}

/** Aylık gelir / gider serisi (para birimi bazında, virman hariç); eskiden yeniye */
export function monthlySeries(ledger: readonly LedgerRow[], months: readonly string[]): { month: string; perCurrency: Partial<Record<Currency, { in: number; out: number }>> }[] {
  const map = new Map(months.map((k) => [k, {} as Partial<Record<Currency, { in: number; out: number }>>]))
  for (const l of ledger) {
    if (l.kind === 'transfer') continue
    const row = map.get(l.date.slice(0, 7))
    if (!row) continue
    const t = (row[l.currency] ??= { in: 0, out: 0 })
    if (l.kind === 'gelir') t.in += l.amount
    else t.out += l.amount
  }
  return months.map((m) => ({ month: m, perCurrency: map.get(m)! }))
}

// ------------------------------------------------------------------ Alacak ve borç

/**
 * Bekleyen tahsilatlar: proje ödeme planındaki kalan (mevcut FIFO alacak hesabı) + "bekliyor" genel gelir kayıtları.
 * İptal edilen kayıt girmez. Bakiyeyi etkilemez.
 */
export function pendingReceivables(
  projects: readonly { schedule: readonly PaymentScheduleRow[]; collections: readonly Collection[] }[],
  entries: readonly FinanceEntry[],
  today: string,
): { project: CurrencyMap; general: CurrencyMap; total: CurrencyMap } {
  const project: CurrencyMap = {}
  const general: CurrencyMap = {}
  for (const d of projects) {
    for (const [c, t] of Object.entries(receivables(d.schedule, d.collections, today).perCurrency) as [Currency, { outstanding: number }][]) {
      if (t.outstanding) add(project, c, t.outstanding)
    }
  }
  for (const e of entries) if (e.kind === 'gelir' && e.status === 'bekliyor' && !e.voided_at) add(general, e.currency, toCents(e.amount) + toCents(e.vat_amount))
  return { project, general, total: sumMaps(project, general) }
}

/** Ödenecek borçlar: ödenmemiş proje giderleri (KDV dahil) + "bekliyor" genel gider kayıtları */
export function payables(expenses: readonly Expense[], entries: readonly FinanceEntry[]): { project: CurrencyMap; general: CurrencyMap; total: CurrencyMap } {
  const project: CurrencyMap = {}
  const general: CurrencyMap = {}
  for (const x of expenses) if (!x.paid) add(project, x.currency, toCents(x.amount) + toCents(x.vat_amount))
  for (const e of entries) if (e.kind === 'gider' && e.status === 'bekliyor' && !e.voided_at) add(general, e.currency, toCents(e.amount) + toCents(e.vat_amount))
  return { project, general, total: sumMaps(project, general) }
}

export function sumMaps(...maps: CurrencyMap[]): CurrencyMap {
  const m: CurrencyMap = {}
  for (const x of maps) for (const [c, v] of Object.entries(x) as [Currency, number][]) add(m, c, v)
  return m
}

/** Genel işletme giderleri kategori bazında (dönem, para birimi) — yalnız projesiz gerçekleşen giderler */
export function generalExpenseByCategory(ledger: readonly LedgerRow[], from: string, to: string): Map<string | null, CurrencyMap> {
  const out = new Map<string | null, CurrencyMap>()
  for (const l of ledger) {
    if (l.source !== 'genel' || l.kind !== 'gider' || l.date < from || l.date > to) continue
    let m = out.get(l.categoryId)
    if (!m) out.set(l.categoryId, (m = {}))
    add(m, l.currency, l.amount)
  }
  return out
}

// ------------------------------------------------------------------ Birleşik toplam (yalnız girilen kurla)

export interface ConvertedTotal {
  /** null: en az bir para biriminin kuru girilmemiş — birleşik toplam üretilmez */
  total: number | null
  missing: Currency[]
}

/** Para birimi bazındaki tutarları ana birime çevirir; eksik kur varsa toplam üretilmez */
export function convertedTotal(map: CurrencyMap, base: Currency, rates: readonly FxRateLike[], date: string): ConvertedTotal {
  let total = 0
  const missing: Currency[] = []
  for (const [c, v] of Object.entries(map) as [Currency, number][]) {
    if (!v) continue
    const r = resolveRate({ base, rates, projectId: null }, c, date)
    if (!r) missing.push(c)
    else total += convertCents(v, r.micro)
  }
  return { total: missing.length ? null : total, missing }
}

// ------------------------------------------------------------------ Liste süzgeci

export interface RecordFilter {
  from?: string
  to?: string
  kind?: MovementKind | ''
  status?: RecordStatus | ''
  categoryId?: string
  projectId?: string
  /** '__none__': hesapsız */
  accountId?: string
  /** Proje kayıtları / genel kayıtlar */
  scope?: 'proje' | 'genel' | ''
  text?: string
}

export const NO_ACCOUNT = '__none__'

export function filterRecords(records: readonly CashRecord[], f: RecordFilter): CashRecord[] {
  const q = f.text?.trim().toLocaleLowerCase('tr')
  return records.filter((r) => {
    if (f.from && r.date < f.from) return false
    if (f.to && r.date > f.to) return false
    if (f.kind && r.kind !== f.kind) return false
    if (f.status && r.status !== f.status) return false
    if (f.categoryId && r.categoryId !== f.categoryId) return false
    if (f.projectId && r.projectId !== f.projectId) return false
    if (f.scope === 'proje' && !r.projectId) return false
    if (f.scope === 'genel' && (r.projectId || r.kind === 'transfer')) return false
    if (f.accountId) {
      if (f.accountId === NO_ACCOUNT) {
        if (r.accountId || r.transfer) return false
      } else if (r.accountId !== f.accountId && r.transfer?.toAccountId !== f.accountId) return false
    }
    if (q && !`${r.description} ${r.documentNo ?? ''}`.toLocaleLowerCase('tr').includes(q)) return false
    return true
  })
}

/** Süzülmüş kayıtların özeti (gerçekleşen, iptal hariç; virman hariç), para birimi bazında */
export function recordTotals(records: readonly CashRecord[]): { income: CurrencyMap; expense: CurrencyMap; net: CurrencyMap } {
  const income: CurrencyMap = {}
  const expense: CurrencyMap = {}
  for (const r of records) {
    if (r.status !== 'gerceklesti' || r.kind === 'transfer') continue
    if (r.kind === 'gelir') add(income, r.currency, r.amount)
    else add(expense, r.currency, r.amount)
  }
  const net: CurrencyMap = { ...income }
  for (const [c, v] of Object.entries(expense) as [Currency, number][]) net[c] = (net[c] ?? 0) - v
  return { income, expense, net }
}
