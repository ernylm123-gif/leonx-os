import { useEffect, useMemo, useRef } from 'react'
import { useData } from '@/context/data'
import { CASH_TABLES, EMPTY_CASH, generateRecurring, loadCashData, type CashData } from '@/data/cashApi'
import { accountBalances, buildRecords, ledgerFromRecords } from '@/finance/ledger'
import { requireSupabase } from '@/lib/supabase'
import { useLiveQuery } from '@/lib/useLiveList'

/**
 * Kasa/banka ekranlarının ortak canlı verisi: hesaplar, kategoriler, genel kayıtlar, virmanlar, düzenli
 * şablonlar ve proje finansı. Kayıtlar, defter ve bakiyeler yalnız src/finance/ledger.ts ile türetilir.
 * Açılışta vadesi gelen düzenli kayıtlar sunucuda üretilir (idempotent; başka cihazda üretilmişse 0 döner).
 */
export function useCash() {
  const { projects } = useData()
  const q = useLiveQuery<CashData>([...CASH_TABLES], () => loadCashData(requireSupabase()), EMPTY_CASH)
  const generated = useRef(false)
  const reload = q.reload
  useEffect(() => {
    if (generated.current) return
    generated.current = true
    void generateRecurring(requireSupabase())
      .then((n) => (n > 0 ? reload() : undefined))
      .catch(() => {
        /* üretim başarısızsa ekran mevcut veriyle çalışır; sonraki açılışta tekrar denenir */
      })
  }, [reload])

  const derived = useMemo(() => {
    const d = q.data
    const expenses = [...d.projects.values()].flatMap((p) => p.expenses)
    const collections = [...d.projects.values()].flatMap((p) => p.collections)
    const records = buildRecords({ entries: d.entries, collections, expenses, transfers: d.transfers, accounts: d.accounts, projects })
    const ledger = ledgerFromRecords(records)
    const balances = accountBalances(d.accounts, ledger)
    return { expenses, collections, records, ledger, balances }
  }, [q.data, projects])

  return { ...q, ...derived }
}

export type CashState = ReturnType<typeof useCash>
