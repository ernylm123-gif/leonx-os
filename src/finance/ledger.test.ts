import { describe, expect, it } from 'vitest'
import type { FinanceAccount, FinanceEntry, FinanceTransfer } from './cash'
import type { FxRateLike } from './fx'
import {
  accountBalances,
  balanceTotals,
  buildLedger,
  buildRecords,
  convertedTotal,
  filterRecords,
  generalExpenseByCategory,
  monthlySeries,
  monthRange,
  NO_ACCOUNT,
  payables,
  pendingReceivables,
  periodTotals,
  recordTotals,
  type CashSources,
} from './ledger'
import type { Collection, Expense, PaymentScheduleRow } from './types'

const TODAY = '2026-10-16'
const meta = (id: string) => ({ id, created_by: null, created_at: `2026-10-01T00:00:00Z`, updated_at: '2026-10-01T00:00:00Z', version: 1 })

const account = (id: string, currency: FinanceAccount['currency'] = 'TRY', opening = 0): FinanceAccount => ({
  ...meta(id), name: id, kind: 'kasa', currency, opening_balance: opening, opening_date: '2026-01-01', bank_name: null, iban: null, notes: null, active: true, sort_order: 0,
})
const entry = (o: Partial<FinanceEntry> & { id: string }): FinanceEntry => ({
  ...meta(o.id), kind: 'gelir', entry_date: TODAY, amount: 100, vat_amount: 0, currency: 'TRY', category_id: 'cat', account_id: 'kasa', status: 'gerceklesti', due_date: null,
  payment_method: null, company_id: null, description: 'kayıt', document_no: null, notes: null, recurring_id: null, occurrence_date: null, voided_at: null, voided_reason: null, voided_by: null, ...o,
})
const expense = (o: Partial<Expense> & { id: string }): Expense => ({
  ...meta(o.id), project_id: 'P', expense_date: TODAY, cost_group: 'montaj', description: 'gider', supplier: null, amount: 100, vat_amount: 0, currency: 'TRY',
  fx_rate_to_base: null, fx_to_currency: null, document_no: null, paid: true, notes: null, account_id: 'kasa', category_id: null, payment_method: null, ...o,
})
const collection = (o: Partial<Collection> & { id: string }): Collection => ({
  ...meta(o.id), project_id: 'P', received_date: TODAY, amount: 100, currency: 'TRY', method: 'havale', schedule_id: null, reference: null, note: null, account_id: 'banka', category_id: null, ...o,
})
const transfer = (o: Partial<FinanceTransfer> & { id: string }): FinanceTransfer => ({
  ...meta(o.id), transfer_date: TODAY, from_account_id: 'kasa', to_account_id: 'banka', from_amount: 100, to_amount: 100, description: null, voided_at: null, voided_reason: null, voided_by: null, ...o,
})
const src = (o: Partial<CashSources>): CashSources => ({ entries: [], collections: [], expenses: [], transfers: [], accounts: [account('kasa', 'TRY', 1000), account('banka'), account('eur', 'EUR')], ...o })

describe('nakit defteri (finance_ledger ile aynı kurallar)', () => {
  it('yalnız gerçekleşen hareketler: bekliyor, iptal ve ödenmemiş gider deftere girmez', () => {
    const l = buildLedger(src({
      entries: [entry({ id: 'e1' }), entry({ id: 'e2', status: 'bekliyor', account_id: null }), entry({ id: 'e3', voided_at: '2026-10-16T10:00:00Z', voided_reason: 'yanlış' })],
      expenses: [expense({ id: 'x1' }), expense({ id: 'x2', paid: false, account_id: null })],
      collections: [collection({ id: 'c1' })],
    }))
    expect(l.map((r) => r.sourceId).sort()).toEqual(['c1', 'e1', 'x1'])
  })

  it('tutar = KDV hariç + KDV (nakit hareketi); tahsilat tahsil edilen tutardır', () => {
    const l = buildLedger(src({ entries: [entry({ id: 'e', kind: 'gider', amount: 200, vat_amount: 40 })], collections: [collection({ id: 'c', amount: 1200 })] }))
    expect(l.find((r) => r.sourceId === 'e')).toMatchObject({ direction: 'cikis', amount: 24_000, net: 20_000, vat: 4_000, source: 'genel' })
    expect(l.find((r) => r.sourceId === 'c')).toMatchObject({ direction: 'giris', amount: 120_000, source: 'proje_tahsilat', description: 'Tahsilat' })
  })

  it('virman iki satırdır (çıkış + giriş), gelir/gider değildir; bakiyeyi taşır', () => {
    const s = src({ entries: [entry({ id: 'e', amount: 500, vat_amount: 100 })], transfers: [transfer({ id: 't', from_amount: 300, to_amount: 300 })] })
    const l = buildLedger(s)
    expect(l.filter((r) => r.sourceId === 't').map((r) => `${r.source}:${r.accountId}:${r.direction}`).sort()).toEqual(['transfer_cikis:kasa:cikis', 'transfer_giris:banka:giris'])
    const b = accountBalances(s.accounts as FinanceAccount[], l)
    expect(b.get('kasa')!.balance).toBe(100_000 + 60_000 - 30_000)
    expect(b.get('banka')!.balance).toBe(30_000)
    const p = periodTotals(l, TODAY, TODAY).TRY!
    expect(p.income).toBe(60_000)
    expect(p.expense).toBe(0)
    expect(p.net).toBe(60_000)
  })

  it('iptal edilen virman ve kayıt bakiyeyi geri getirir', () => {
    const s = src({ entries: [entry({ id: 'e', kind: 'gider', amount: 200, vat_amount: 40, voided_at: 'x', voided_reason: 'y' })], transfers: [transfer({ id: 't', voided_at: 'x', voided_reason: 'y' })] })
    const b = accountBalances(s.accounts as FinanceAccount[], buildLedger(s))
    expect(b.get('kasa')!.balance).toBe(100_000)
    expect(b.get('banka')!.balance).toBe(0)
    expect(buildRecords(s).map((r) => r.status)).toEqual(['iptal', 'iptal'])
  })

  it('farklı para birimleri arasında virman: elle girilen iki tutar, her hesap kendi biriminde', () => {
    const s = src({ transfers: [transfer({ id: 't', from_account_id: 'banka', to_account_id: 'eur', from_amount: 1000, to_amount: 25 })] })
    const l = buildLedger(s)
    expect(l.map((r) => `${r.currency}:${r.amount}`).sort()).toEqual(['EUR:2500', 'TRY:100000'])
    const b = accountBalances(s.accounts as FinanceAccount[], l)
    expect(b.get('eur')!.balance).toBe(2_500)
    expect(balanceTotals(b.values())).toEqual({ TRY: 100_000 - 100_000, EUR: 2_500 })
  })

  it('hesapsız satır defterde görünür ama hiçbir bakiyeye girmez', () => {
    const s = src({ expenses: [expense({ id: 'x', account_id: null, amount: 50 })] })
    const l = buildLedger(s)
    expect(l).toHaveLength(1)
    expect(l[0].accountId).toBeNull()
    const b = accountBalances(s.accounts as FinanceAccount[], l)
    expect([...b.values()].every((x) => x.movementCount === 0)).toBe(true)
    expect(periodTotals(l, TODAY, TODAY).TRY!.expenseProject).toBe(5_000)
  })

  it('kuruş hassasiyeti: 0,1 + 0,2 = 0,30 ve 3 × 33,33 = 99,99 (kayan nokta hatası yok)', () => {
    const s = src({
      entries: [
        entry({ id: 'a', amount: 0.1, account_id: 'banka' }),
        entry({ id: 'b', amount: 0.2, account_id: 'banka' }),
        entry({ id: 'p1', kind: 'gider', amount: 33.33, account_id: 'banka' }),
        entry({ id: 'p2', kind: 'gider', amount: 33.33, account_id: 'banka' }),
        entry({ id: 'p3', kind: 'gider', amount: 33.33, account_id: 'banka' }),
      ],
    })
    const l = buildLedger(s)
    const p = periodTotals(l, TODAY, TODAY).TRY!
    expect(p.income).toBe(30)
    expect(p.expense).toBe(9_999)
    expect(accountBalances(s.accounts as FinanceAccount[], l).get('banka')!.balance).toBe(30 - 9_999)
    // 1,005 gibi ikili sistemde tam gösterilemeyen değer yarım yukarı yuvarlanır
    expect(buildLedger(src({ entries: [entry({ id: 'r', amount: 1.005 })] }))[0].amount).toBe(101)
  })

  it('farklı para birimleri asla toplanmaz; birleşik toplam yalnız tüm kurlar girilmişse', () => {
    const s = src({ entries: [entry({ id: 't', amount: 1000 }), entry({ id: 'e', amount: 100, currency: 'EUR', account_id: 'eur' })] })
    const p = periodTotals(buildLedger(s), TODAY, TODAY)
    expect(p.TRY!.income).toBe(100_000)
    expect(p.EUR!.income).toBe(10_000)
    const map = { TRY: 100_000, EUR: 10_000 }
    expect(convertedTotal(map, 'TRY', [], TODAY)).toEqual({ total: null, missing: ['EUR'] })
    const rates: FxRateLike[] = [{ id: 'r', rate_date: '2026-10-01', from_currency: 'EUR', to_currency: 'TRY', rate: 35.5, project_id: null, created_at: '2026-10-01T00:00:00Z' }]
    expect(convertedTotal(map, 'TRY', rates, TODAY)).toEqual({ total: 100_000 + 355_000, missing: [] })
    // Projeye özel kur genel toplamda kullanılmaz
    expect(convertedTotal(map, 'TRY', [{ ...rates[0], project_id: 'P' }], TODAY).total).toBeNull()
  })

  it('dönem: proje ve genel gelir/gider ayrı; ay aralığı ve bugünkü toplam', () => {
    const s = src({
      entries: [entry({ id: 'g', amount: 100 }), entry({ id: 'k', kind: 'gider', amount: 30, entry_date: '2026-10-02' }), entry({ id: 'old', amount: 999, entry_date: '2026-09-30' })],
      collections: [collection({ id: 'c', amount: 500 })],
      expenses: [expense({ id: 'x', amount: 70, vat_amount: 14, expense_date: '2026-10-05' })],
    })
    const l = buildLedger(s)
    const [from, to] = monthRange('2026-10')
    expect([from, to]).toEqual(['2026-10-01', '2026-10-31'])
    expect(monthRange('2028-02')[1]).toBe('2028-02-29')
    const m = periodTotals(l, from, to).TRY!
    expect(m).toEqual({ incomeProject: 50_000, incomeGeneral: 10_000, expenseProject: 8_400, expenseGeneral: 3_000, income: 60_000, expense: 11_400, net: 48_600 })
    const d = periodTotals(l, TODAY, TODAY).TRY!
    expect(d.income).toBe(60_000)
    expect(d.expense).toBe(0)
  })

  it('aylık seri virmanı dışarıda bırakır, para birimi bazındadır', () => {
    const s = src({ entries: [entry({ id: 'a', amount: 10 }), entry({ id: 'b', kind: 'gider', amount: 4, entry_date: '2026-09-10' })], transfers: [transfer({ id: 't', from_amount: 5, to_amount: 5 })] })
    const series = monthlySeries(buildLedger(s), ['2026-09', '2026-10'])
    expect(series).toEqual([
      { month: '2026-09', perCurrency: { TRY: { in: 0, out: 400 } } },
      { month: '2026-10', perCurrency: { TRY: { in: 1_000, out: 0 } } },
    ])
  })

  it('bekleyen tahsilat: ödeme planı kalanı (FIFO) + bekleyen genel gelir; borç: ödenmemiş gider + bekleyen genel gider', () => {
    const schedule: PaymentScheduleRow[] = [{ ...meta('s1'), project_id: 'P', kind: 'pesinat', label: null, due_date: '2026-10-20', amount: 5000, currency: 'TRY', sort_order: 0, notes: null }]
    const cols = [collection({ id: 'c', amount: 1000 })]
    const entries = [
      entry({ id: 'g', status: 'bekliyor', account_id: null, amount: 200, vat_amount: 40 }),
      entry({ id: 'v', status: 'bekliyor', account_id: null, amount: 999, voided_at: 'x', voided_reason: 'y' }),
      entry({ id: 'k', kind: 'gider', status: 'bekliyor', account_id: null, amount: 300 }),
    ]
    const rec = pendingReceivables([{ schedule, collections: cols }], entries, TODAY)
    expect(rec).toEqual({ project: { TRY: 400_000 }, general: { TRY: 24_000 }, total: { TRY: 424_000 } })
    const pay = payables([expense({ id: 'x', paid: false, account_id: null, amount: 100, vat_amount: 20 }), expense({ id: 'y' })], entries)
    expect(pay).toEqual({ project: { TRY: 12_000 }, general: { TRY: 30_000 }, total: { TRY: 42_000 } })
  })

  it('genel işletme giderleri kategori bazında; proje giderleri ve gelirler dahil değil', () => {
    const l = buildLedger(src({
      entries: [entry({ id: 'a', kind: 'gider', category_id: 'kira', amount: 100 }), entry({ id: 'b', kind: 'gider', category_id: 'kira', amount: 50 }), entry({ id: 'c', category_id: 'satis' })],
      expenses: [expense({ id: 'x', category_id: 'kira' })],
    }))
    const m = generalExpenseByCategory(l, '2026-10-01', '2026-10-31')
    expect([...m.entries()]).toEqual([['kira', { TRY: 15_000 }]])
  })

  it('liste süzgeci: tarih, tür, durum, hesap (hesapsız dahil), proje/genel; özet iptal ve virmanı saymaz', () => {
    const s = src({
      entries: [entry({ id: 'a' }), entry({ id: 'b', kind: 'gider', status: 'bekliyor', account_id: null }), entry({ id: 'v', voided_at: 'x', voided_reason: 'y' })],
      expenses: [expense({ id: 'x', account_id: null })],
      collections: [collection({ id: 'c', received_date: '2026-09-01' })],
      transfers: [transfer({ id: 't' })],
    })
    const r = buildRecords(s)
    expect(filterRecords(r, { kind: 'gelir' }).map((x) => x.id).sort()).toEqual(['a', 'c', 'v'])
    expect(filterRecords(r, { status: 'bekliyor' }).map((x) => x.id)).toEqual(['b'])
    expect(filterRecords(r, { from: '2026-10-01' }).some((x) => x.id === 'c')).toBe(false)
    expect(filterRecords(r, { accountId: 'banka' }).map((x) => x.id).sort()).toEqual(['c', 't'])
    expect(filterRecords(r, { accountId: NO_ACCOUNT }).map((x) => x.id).sort()).toEqual(['b', 'x'])
    expect(filterRecords(r, { scope: 'proje' }).map((x) => x.id).sort()).toEqual(['c', 'x'])
    expect(filterRecords(r, { scope: 'genel' }).map((x) => x.id).sort()).toEqual(['a', 'b', 'v'])
    const t = recordTotals(r)
    expect(t.income).toEqual({ TRY: 20_000 })
    expect(t.expense).toEqual({ TRY: 10_000 })
    expect(t.net).toEqual({ TRY: 10_000 })
  })
})
