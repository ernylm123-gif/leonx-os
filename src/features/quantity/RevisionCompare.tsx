import { ArrowLeftRight, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FormAlert } from '@/components/ui/Field'
import { listCostRates } from '@/data/financeApi'
import { listItems } from '@/data/quantityApi'
import { listQuoteItems, listQuotesBy } from '@/data/quoteApi'
import type { QuantityTakeoff } from '@/data/types'
import type { CostRate } from '@/finance/types'
import { dataErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { requireSupabase } from '@/lib/supabase'
import { formatCenti } from '@/quantity/precision'
import { diffRevisions, type DiffRow, type DiffStatus, type MoneyDelta, type QuoteContext } from '@/quantity/revisionDiff'
import { type QuantityItem, UNIT_LABEL } from '@/quantity/types'
import { formatMoney } from '@/quote/money'
import type { Quote } from '@/quote/types'

const STATUS: Record<DiffStatus, { label: string; cls: string }> = {
  degisen: { label: 'Değişen', cls: 'border-warn-line bg-warn-soft text-warn' },
  eklenen: { label: 'Eklenen', cls: 'border-ok/30 bg-ok-soft text-ok' },
  silinen: { label: 'Silinen', cls: 'border-danger/30 bg-danger-soft text-danger' },
  ayni: { label: 'Aynı', cls: 'border-line bg-surface-2 text-muted' },
}

const signed = (s: string, v: number) => (v > 0 ? `+${s}` : s)
const money = (m: MoneyDelta) => signed(formatMoney(m.cents, m.currency), m.cents)

/** Karşılaştırmada kullanılacak teklif: projenin geçerli (eskimemiş, reddedilmemiş) teklifi; kabul edilen öncelikli */
export function pickQuote(quotes: readonly Quote[]): Quote | null {
  const live = quotes.filter((q) => !q.superseded && q.status !== 'red')
  return live.find((q) => q.status === 'kabul') ?? [...live].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null
}

/**
 * Metraj revizyon karşılaştırması: seçili sürüm (yeni) ile önceki bir sürüm (eski). Eklenen, silinen ve
 * ölçüsü değişen pozlar; metraj farkı; katalog maliyeti ve teklif tutarı üzerindeki etki.
 */
export function RevisionCompare({ takeoff, takeoffs, newItems, onClose }: { takeoff: QuantityTakeoff; takeoffs: QuantityTakeoff[]; newItems: QuantityItem[]; onClose: () => void }) {
  const others = takeoffs.filter((t) => t.id !== takeoff.id)
  const [baseId, setBaseId] = useState(() =>
    takeoff.based_on && others.some((t) => t.id === takeoff.based_on) ? takeoff.based_on : (others.find((t) => t.revision < takeoff.revision)?.id ?? others[0]?.id ?? ''),
  )
  const [oldItems, setOldItems] = useState<QuantityItem[] | null>(null)
  const [rates, setRates] = useState<CostRate[]>([])
  const [quote, setQuote] = useState<{ q: Quote; ctx: QuoteContext } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSame, setShowSame] = useState(false)

  useEffect(() => {
    if (!baseId) return
    let cancelled = false
    setOldItems(null)
    setError(null)
    const db = requireSupabase()
    Promise.all([listItems(db, baseId), listCostRates(db), listQuotesBy(db, 'project_id', takeoff.project_id)])
      .then(async ([items, r, quotes]) => {
        const q = pickQuote(quotes)
        const qi = q ? await listQuoteItems(db, q.id) : []
        if (cancelled) return
        setOldItems(items)
        setRates(r)
        setQuote(q ? { q, ctx: { currency: q.currency, params: q, items: qi } } : null)
      })
      .catch((e) => !cancelled && setError(dataErrorMessage(e, 'Karşılaştırma verisi')))
    return () => {
      cancelled = true
    }
  }, [baseId, takeoff.project_id])

  const base = others.find((t) => t.id === baseId) ?? null
  const diff = useMemo(() => (oldItems ? diffRevisions(oldItems, newItems, { rates, quote: quote?.ctx ?? null }) : null), [oldItems, newItems, rates, quote])
  const rows = diff ? diff.rows.filter((r) => showSame || r.status !== 'ayni') : []

  return (
    <section className="card mb-5 overflow-hidden" data-testid="rev-compare">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-ink">Revizyon karşılaştırması</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <label className="flex items-center gap-1.5">
            <span className="text-muted">Eski:</span>
            <select value={baseId} onChange={(e) => setBaseId(e.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2 text-ink" data-testid="rev-compare-base">
              {others.map((t) => (
                <option key={t.id} value={t.id}>
                  Rev {t.revision} · {t.name}
                </option>
              ))}
            </select>
          </label>
          <span className="text-muted">→ Yeni: Rev {takeoff.revision}</span>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-surface-2" aria-label="Karşılaştırmayı kapat">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {!others.length ? (
        <p className="p-4 text-sm text-muted">Karşılaştırmak için bu projede en az iki metraj sürümü olmalı.</p>
      ) : error ? (
        <div className="p-4">
          <FormAlert>{error}</FormAlert>
        </div>
      ) : !diff ? (
        <p className="p-4 text-sm text-muted">Yükleniyor…</p>
      ) : (
        <>
          <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="rev-compare-summary">
            <div>
              <div className="text-xs text-muted">Pozlar</div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[12.5px]">
                {(['degisen', 'eklenen', 'silinen', 'ayni'] as const).map((s) => (
                  <span key={s} className={cn('rounded-md border px-1.5 py-px font-semibold', STATUS[s].cls)} data-testid={`rev-count-${s}`}>
                    {diff.counts[s]} {STATUS[s].label.toLocaleLowerCase('tr-TR')}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Maliyet etkisi (katalog)</div>
              <div className="mt-1 text-sm font-semibold text-ink" data-testid="rev-cost-total">
                {diff.costTotals.length ? diff.costTotals.map(money).join(' · ') : '—'}
              </div>
              {diff.unpricedCost > 0 && <div className="text-[11.5px] text-warn">{diff.unpricedCost} değişen pozun katalog fiyatı yok; toplama dahil değil</div>}
            </div>
            <div>
              <div className="text-xs text-muted">Teklif etkisi{quote ? ` (${quote.q.quote_no})` : ''}</div>
              <div className="mt-1 text-sm font-semibold text-ink" data-testid="rev-quote-total">
                {!quote ? 'Projede geçerli teklif yok' : diff.quoteTotal ? money(diff.quoteTotal) : '—'}
              </div>
              {quote && diff.unpricedQuote > 0 && <div className="text-[11.5px] text-warn">{diff.unpricedQuote} değişen poz teklifte yok veya fiyatsız</div>}
            </div>
            <div className="text-[11.5px] leading-relaxed text-muted">
              Fark = Rev {takeoff.revision} − Rev {base?.revision}. Reddedilen pozlar dahil değildir. Fiyatı tanımlı olmayan pozlar için tutar hesaplanmaz; para birimleri ayrı gösterilir. KDV
              hariçtir.
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 px-4 py-2 text-[12.5px]">
            <label className="inline-flex items-center gap-1.5 text-muted">
              <input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} />
              Değişmeyenleri de göster
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[12.5px]" data-testid="rev-compare-table">
              <thead className="border-y border-line bg-surface-2 text-[11.5px] text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Poz</th>
                  <th className="px-3 py-2 font-medium">Durum</th>
                  <th className="px-3 py-2 font-medium">Değişiklik</th>
                  <th className="px-3 py-2 text-right font-medium">Metraj farkı</th>
                  <th className="px-3 py-2 text-right font-medium">Maliyet farkı</th>
                  <th className="px-3 py-2 text-right font-medium">Teklif farkı</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <Row key={r.key} r={r} hasQuote={!!quote} />
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-muted">
                      İki sürüm arasında fark yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function Row({ r, hasQuote }: { r: DiffRow; hasQuote: boolean }) {
  const desc =
    r.status === 'eklenen'
      ? `${r.new!.width_mm ?? '—'}×${r.new!.height_mm ?? '—'} mm · ${r.new!.pieces} adet`
      : r.status === 'silinen'
        ? `${r.old!.width_mm ?? '—'}×${r.old!.height_mm ?? '—'} mm · ${r.old!.pieces} adet`
        : r.changes.join(' · ') || '—'
  return (
    <tr data-testid="rev-row" data-poz={r.poz} data-status={r.status}>
      <td className="px-3 py-2 font-semibold text-ink">
        {r.poz}
        {r.where && <span className="block text-[11px] font-normal text-muted">{r.where}</span>}
      </td>
      <td className="px-3 py-2">
        <span className={cn('rounded-md border px-1.5 py-px text-[11px] font-semibold', STATUS[r.status].cls)}>{STATUS[r.status].label}</span>
      </td>
      <td className="px-3 py-2 text-ink-2">{desc}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">
        {r.deltaCenti == null ? (r.status === 'ayni' ? '0' : 'birim değişti') : `${signed(formatCenti(r.deltaCenti), r.deltaCenti)} ${r.deltaUnit ? UNIT_LABEL[r.deltaUnit] : ''}`}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">
        {r.costMissing ? <span className="text-warn">fiyat tanımlı değil</span> : r.costDelta.length ? r.costDelta.map(money).join(' · ') : '0'}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">
        {!hasQuote || r.status === 'ayni' ? '—' : r.quoteMissing ? <span className="text-warn">teklifte yok</span> : r.quoteDelta ? money(r.quoteDelta) : '0'}
      </td>
    </tr>
  )
}
