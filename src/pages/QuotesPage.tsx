import { ChevronRight, FilePlus2, FileText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { ErrorState, SkeletonRows } from '@/components/ui/States'
import { FilterSelect, SearchInput } from '@/components/ui/Toolbar'
import { useData } from '@/context/data'
import { listQuotes } from '@/data/quoteApi'
import { NewQuoteDialog } from '@/features/quotes/NewQuoteDialog'
import { isExpired, latestRevisions, QuoteStatusBadge, useQuoteTotals } from '@/features/quotes/shared'
import { cn } from '@/lib/cn'
import { formatDate, localISODate, matchesSearch } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useLiveQuery } from '@/lib/useLiveList'
import { formatMoney } from '@/quote/money'
import { type Quote, QUOTE_STATUSES } from '@/quote/types'

type Sort = 'yeni' | 'eski' | 'tutar' | 'numara'
const OPEN = new Set(['taslak', 'gonderildi', 'gorusmede'])

export function QuotesPage() {
  const { companies, projects } = useData()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  const quotesQ = useLiveQuery<Quote[]>(['quotes'], () => listQuotes(requireSupabase()), [])
  const latest = useMemo(() => latestRevisions(quotesQ.data), [quotesQ.data])
  const { totals } = useQuoteTotals(latest)
  const [filters, setFilters] = useState(() => ({
    q: params.get('q') ?? '',
    durum: params.get('durum') ?? 'acik',
    firma: params.get('firma') ?? '',
    sira: (params.get('sira') as Sort) ?? 'yeni',
  }))
  const set = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }))
  useEffect(() => {
    const next = new URLSearchParams()
    if (filters.q) next.set('q', filters.q)
    if (filters.durum !== 'acik') next.set('durum', filters.durum)
    if (filters.firma) next.set('firma', filters.firma)
    if (filters.sira !== 'yeni') next.set('sira', filters.sira)
    setParams(next, { replace: true })
  }, [filters, setParams])

  const companyName = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies])
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const today = localISODate()

  const filtered = useMemo(() => {
    const rows = latest.filter((q) => {
      if (filters.durum === 'acik' && !OPEN.has(q.status)) return false
      if (filters.durum !== 'acik' && filters.durum !== 'tumu' && q.status !== filters.durum) return false
      if (filters.firma && q.company_id !== filters.firma) return false
      const p = q.project_id ? projectById.get(q.project_id) : null
      return matchesSearch(filters.q, q.quote_no, q.title, companyName.get(q.company_id), p?.code, p?.name)
    })
    const total = (q: Quote) => totals.get(q.id)?.grandTotal ?? 0
    const cmp: Record<Sort, (a: Quote, b: Quote) => number> = {
      yeni: (a, b) => b.quote_date.localeCompare(a.quote_date) || b.quote_no.localeCompare(a.quote_no),
      eski: (a, b) => a.quote_date.localeCompare(b.quote_date) || a.quote_no.localeCompare(b.quote_no),
      tutar: (a, b) => total(b) - total(a),
      numara: (a, b) => b.quote_no.localeCompare(a.quote_no, 'tr', { numeric: true }),
    }
    return rows.sort(cmp[filters.sira])
  }, [latest, filters, companyName, projectById, totals])

  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const q of latest) c.set(q.status, (c.get(q.status) ?? 0) + 1)
    return c
  }, [latest])

  const hasFilters = filters.q || filters.durum !== 'acik' || filters.firma

  return (
    <>
      <PageHeader
        icon={FileText}
        code="M04"
        eyebrow="Ticari"
        title="Teklifler"
        description="Müşteri ve projeye bağlı teklifler: poz ve metrajdan kalem, maliyet ve kâr hesabı, revizyonlar, kurumsal PDF ve Excel."
        status="ready"
        actions={
          <Button variant="primary" icon={FilePlus2} onClick={() => setOpen(true)} data-testid="quote-new">
            Yeni teklif
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-5" aria-label="Durumlara göre teklifler">
        {QUOTE_STATUSES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => set('durum', filters.durum === s.value ? 'acik' : s.value)}
            className={cn('card px-3.5 py-3 text-left transition-colors hover:bg-surface-2', filters.durum === s.value && 'ring-2 ring-titanium/40')}
          >
            <span className="block text-[11.5px] text-muted">{s.label}</span>
            <span className="mt-0.5 block font-mono text-xl font-semibold text-ink">{counts.get(s.value) ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-2.5 lg:flex-row">
        <SearchInput value={filters.q} onChange={(v) => set('q', v)} placeholder="No, başlık, müşteri veya proje ara…" label="Tekliflerde ara" />
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 lg:flex">
          <FilterSelect value={filters.durum} onChange={(v) => set('durum', v)} label="Durum filtresi" className="lg:w-44">
            <option value="acik">Açık teklifler</option>
            <option value="tumu">Tüm durumlar</option>
            {QUOTE_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect value={filters.firma} onChange={(v) => set('firma', v)} label="Müşteri filtresi" className="lg:w-52">
            <option value="">Tüm müşteriler</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect value={filters.sira} onChange={(v) => set('sira', v)} label="Sıralama" className="lg:w-44">
            <option value="yeni">Yeniden eskiye</option>
            <option value="eski">Eskiden yeniye</option>
            <option value="tutar">Tutar (büyükten)</option>
            <option value="numara">Teklif no</option>
          </FilterSelect>
        </div>
      </div>

      <section className="card overflow-hidden" aria-label="Teklif listesi">
        <div className="flex items-center justify-between border-b border-line px-4 py-3 text-xs text-muted">
          <span>
            <b className="font-semibold text-ink">{filtered.length}</b> teklif{hasFilters ? ` (toplam ${latest.length})` : ''} · her teklifin güncel revizyonu
          </span>
          {hasFilters && (
            <button type="button" onClick={() => setFilters({ q: '', durum: 'acik', firma: '', sira: filters.sira })} className="font-medium text-ink-2 underline-offset-4 hover:underline">
              Filtreleri temizle
            </button>
          )}
        </div>
        {quotesQ.loading && !quotesQ.data.length ? (
          <SkeletonRows />
        ) : quotesQ.error && !quotesQ.data.length ? (
          <ErrorState message={quotesQ.error} onRetry={() => void quotesQ.reload()} />
        ) : latest.length === 0 ? (
          <EmptyState icon={FileText} title="Henüz teklif yok" description="Müşteri ve proje seçerek ilk teklifinizi oluşturun. Teklifler tüm cihazlarınızda anlık görünür.">
            <Button variant="primary" icon={FilePlus2} onClick={() => setOpen(true)}>
              Yeni teklif
            </Button>
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState icon={FileText} title="Eşleşen teklif yok" description="Arama veya filtreleri değiştirmeyi deneyin." />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm" data-testid="quotes-table">
                <thead className="border-b border-line bg-surface-2 text-[11px] tracking-[0.08em] text-muted uppercase">
                  <tr>
                    {['Teklif', 'Müşteri', 'Proje', 'Tarih', 'Durum', 'Genel toplam'].map((h, i) => (
                      <th key={h} scope="col" className={cn('px-4 py-3 font-semibold whitespace-nowrap', i === 5 && 'text-right')}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.map((q) => {
                    const p = q.project_id ? projectById.get(q.project_id) : null
                    const t = totals.get(q.id)
                    return (
                      <tr key={q.id} className="group cursor-pointer hover:bg-surface-2/70" onClick={() => navigate(`/teklifler/${q.id}`)} data-testid="quote-row">
                        <td className="px-4 py-3">
                          <Link to={`/teklifler/${q.id}`} onClick={(e) => e.stopPropagation()} className="block min-w-0">
                            <span className="block font-mono text-[11px] text-subtle">
                              {q.quote_no} · Rev {q.revision}
                            </span>
                            <span className="block max-w-[320px] truncate font-medium text-ink group-hover:underline">{q.title}</span>
                          </Link>
                        </td>
                        <td className="max-w-[200px] truncate px-4 py-3 text-ink-2">{companyName.get(q.company_id) ?? '—'}</td>
                        <td className="max-w-[180px] truncate px-4 py-3 text-ink-2">{p ? `${p.code} · ${p.name}` : '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-ink-2">
                          {formatDate(q.quote_date)}
                          {isExpired(q, today) && <span className="ml-1.5 text-[11px] font-medium text-danger">süresi doldu</span>}
                        </td>
                        <td className="px-4 py-3">
                          <QuoteStatusBadge status={q.status} />
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold whitespace-nowrap text-ink">{t ? formatMoney(t.grandTotal, q.currency) : '…'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {filtered.map((q) => {
                const t = totals.get(q.id)
                return (
                  <li key={q.id}>
                    <Link to={`/teklifler/${q.id}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-2" data-testid="quote-card">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-subtle">
                            {q.quote_no} · Rev {q.revision}
                          </span>
                          <QuoteStatusBadge status={q.status} />
                        </div>
                        <p className="mt-0.5 truncate font-medium text-ink">{q.title}</p>
                        <p className="truncate text-[12.5px] text-muted">
                          {companyName.get(q.company_id) ?? '—'} · {formatDate(q.quote_date)}
                          {isExpired(q, today) ? ' · süresi doldu' : ''}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-[13.5px] font-semibold text-ink">{t ? formatMoney(t.grandTotal, q.currency) : '…'}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>

      <NewQuoteDialog open={open} onClose={() => setOpen(false)} defaultCompanyId={filters.firma || undefined} />
    </>
  )
}
