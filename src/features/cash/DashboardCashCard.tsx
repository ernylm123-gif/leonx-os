import { Landmark } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Panel } from '@/components/ui/Panel'
import { type AccountBalanceRow, listAccountBalances } from '@/data/cashApi'
import { MoneyByCurrency } from '@/features/finance/shared'
import { ACCOUNT_KIND_LABEL } from '@/finance/cash'
import type { CurrencyMap } from '@/finance/ledger'
import { cn } from '@/lib/cn'
import { requireSupabase } from '@/lib/supabase'
import { useLiveQuery } from '@/lib/useLiveList'
import { formatMoney, toCents } from '@/quote/money'

/**
 * Dashboard özeti: etkin hesapların bakiyesi doğrudan sunucudaki finance_account_balances görünümünden
 * okunur (bakiye tanımı tek yerde: finance_ledger). Para birimleri ayrı gösterilir.
 */
export function DashboardCashCard() {
  const q = useLiveQuery<AccountBalanceRow[]>(
    ['finance_accounts', 'finance_entries', 'finance_transfers', 'project_expenses', 'project_collections'],
    () => listAccountBalances(requireSupabase()),
    [],
  )
  const active = q.data.filter((a) => a.active)
  const totals: CurrencyMap = {}
  for (const a of active) totals[a.currency] = (totals[a.currency] ?? 0) + toCents(a.balance)
  return (
    <Panel
      title="Kasa & banka"
      subtitle="Gerçekleşen hareketlerle güncel bakiye"
      icon={Landmark}
      actions={
        <Link to="/finans?bolum=panel" className="text-xs font-medium text-ink-2 hover:underline">
          Kasa paneli
        </Link>
      }
      bodyClassName="p-0"
    >
      {active.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-subtle">
          {q.loading ? (
            'Yükleniyor…'
          ) : q.error ? (
            q.error
          ) : (
            <>
              Hesap yok.{' '}
              <Link to="/finans?bolum=kasa-banka" className="font-medium underline underline-offset-2">
                Kasa veya banka ekleyin
              </Link>
            </>
          )}
        </p>
      ) : (
        <>
          <div className="border-b border-line px-5 py-3" data-testid="dash-cash-total">
            <div className="text-[11.5px] font-medium text-muted">Toplam</div>
            <MoneyByCurrency map={totals} className="text-[17px] font-semibold text-ink" />
          </div>
          <ul className="divide-y divide-line" data-testid="dash-cash-accounts">
            {active.slice(0, 6).map((a) => (
              <li key={a.account_id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{a.name}</span>
                  <span className="text-[11px] text-muted">{ACCOUNT_KIND_LABEL[a.kind]}</span>
                </span>
                <span className={cn('font-mono font-semibold', toCents(a.balance) < 0 ? 'text-danger' : 'text-ink')}>{formatMoney(toCents(a.balance), a.currency)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}
