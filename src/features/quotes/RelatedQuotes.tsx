import { FilePlus2, FileText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { listQuotesBy } from '@/data/quoteApi'
import { formatDate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useLiveList } from '@/lib/useLiveList'
import { formatMoney } from '@/quote/money'
import type { Quote } from '@/quote/types'
import { NewQuoteDialog } from './NewQuoteDialog'
import { latestRevisions, QuoteStatusBadge, useQuoteTotals } from './shared'

/** Proje veya firma detayında bağlı teklifler (güncel revizyonlar, canlı) */
export function RelatedQuotes({ by, id, companyId }: { by: 'project_id' | 'company_id'; id: string; companyId?: string | null }) {
  const list = useLiveList<Quote>('quotes', by, id, (x) => listQuotesBy(requireSupabase(), by, x))
  const latest = useMemo(() => latestRevisions(list.items), [list.items])
  const { totals } = useQuoteTotals(latest)
  const [open, setOpen] = useState(false)
  return (
    <Panel
      title="Teklifler"
      subtitle={by === 'project_id' ? 'Bu projeye bağlı teklifler' : 'Bu müşteriye verilen teklifler'}
      icon={FileText}
      actions={
        <Button variant="secondary" icon={FilePlus2} onClick={() => setOpen(true)} data-testid="related-new-quote">
          Yeni teklif
        </Button>
      }
    >
      {latest.length === 0 ? (
        <p className="text-[13px] text-muted">{list.loading ? 'Yükleniyor…' : 'Henüz teklif yok.'}</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line" data-testid="related-quotes">
          {latest.map((q) => (
            <li key={q.id}>
              <Link to={`/teklifler/${q.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[13px] hover:bg-surface-2">
                <span className="font-mono text-[12px] text-subtle">
                  {q.quote_no} · Rev {q.revision}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{q.title}</span>
                <span className="text-muted">{formatDate(q.quote_date)}</span>
                <QuoteStatusBadge status={q.status} />
                <span className="font-mono font-semibold text-ink">{totals.get(q.id) ? formatMoney(totals.get(q.id)!.grandTotal, q.currency) : '…'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <NewQuoteDialog open={open} onClose={() => setOpen(false)} defaultProjectId={by === 'project_id' ? id : undefined} defaultCompanyId={by === 'company_id' ? id : (companyId ?? undefined)} />
    </Panel>
  )
}
