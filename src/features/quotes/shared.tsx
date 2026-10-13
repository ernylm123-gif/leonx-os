import { AlertTriangle, Lock } from 'lucide-react'
import { useMemo } from 'react'
import { getQuoteSettings, listAllQuoteItems } from '@/data/quoteApi'
import { cn } from '@/lib/cn'
import { requireSupabase } from '@/lib/supabase'
import { useLiveQuery } from '@/lib/useLiveList'
import { parseDecimalInput } from '@/quantity/precision'
import { computeQuote, type QuoteTotals } from '@/quote/engine'
import { DEFAULT_QUOTE_SETTINGS, type Quote, type QuoteItem, type QuoteSettings, QUOTE_STATUS_LABEL, type QuoteStatus } from '@/quote/types'

const STATUS_CLASS: Record<QuoteStatus, string> = {
  taslak: 'border-line bg-surface-2 text-ink-2',
  gonderildi: 'border-titanium/30 bg-surface text-ink',
  gorusmede: 'border-warn-line bg-warn-soft text-warn',
  kabul: 'border-ok/25 bg-ok-soft text-ok',
  red: 'border-danger/25 bg-danger-soft text-danger',
}

export function QuoteStatusBadge({ status, superseded, className }: { status: QuoteStatus; superseded?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap',
        superseded ? 'border-line bg-surface-2 text-subtle' : STATUS_CLASS[status],
        className,
      )}
      data-testid="quote-status"
    >
      {superseded && <Lock className="h-3 w-3" aria-hidden="true" />}
      {superseded ? `Eski revizyon · ${QUOTE_STATUS_LABEL[status]}` : QUOTE_STATUS_LABEL[status]}
    </span>
  )
}

export function UnverifiedBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border border-warn-line bg-warn-soft px-1.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap text-warn', className)} title="Ölçü metrajda henüz doğrulanmadı; kesin ölçü değildir">
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      Ölçü doğrulanmadı
    </span>
  )
}

/** Teklif ayarları (canlı). Kayıt yoksa veritabanı varsayılanları kullanılır. */
export function useQuoteSettings() {
  const q = useLiveQuery<QuoteSettings | null>(['quote_settings'], () => getQuoteSettings(requireSupabase()), null)
  return { settings: q.data, values: q.data ?? { ...DEFAULT_QUOTE_SETTINGS, id: 1 as const, version: 0 }, loading: q.loading, error: q.error, reload: q.reload }
}

/** Tüm tekliflerin toplamları (liste ekranları için; kalem değişikliklerinde canlı güncellenir) */
export function useQuoteTotals(quotes: Quote[]) {
  const items = useLiveQuery<QuoteItem[]>(['quote_items'], () => listAllQuoteItems(requireSupabase()), [])
  const totals = useMemo(() => {
    const byQuote = new Map<string, QuoteItem[]>()
    for (const i of items.data) byQuote.set(i.quote_id, [...(byQuote.get(i.quote_id) ?? []), i])
    const out = new Map<string, QuoteTotals>()
    for (const q of quotes) out.set(q.id, computeQuote(q, byQuote.get(q.id) ?? []))
    return out
  }, [items.data, quotes])
  return { totals, loading: items.loading }
}

/** Her teklif zincirinin yalnız güncel (en yüksek) revizyonu */
export function latestRevisions(quotes: Quote[]): Quote[] {
  const best = new Map<string, Quote>()
  for (const q of quotes) {
    const cur = best.get(q.root_id)
    if (!cur || q.revision > cur.revision) best.set(q.root_id, q)
  }
  return quotes.filter((q) => best.get(q.root_id) === q)
}

/** Sayı alanı metnini çözer: boş → null; geçersiz → NaN */
export function parseNum(raw: string): number | null {
  if (!raw.trim()) return null
  const { value } = parseDecimalInput(raw)
  return value == null ? Number.NaN : value
}

/** Sayıyı Türkçe giriş metnine çevirir (12.5 → "12,5") */
export function numText(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return ''
  return String(v).replace('.', ',')
}

/** Geçerlilik süresi dolmuş mu (gönderilmiş/görüşmedeki teklifler için) */
export function isExpired(q: Pick<Quote, 'valid_until' | 'status'>, today: string): boolean {
  return !!q.valid_until && q.valid_until < today && (q.status === 'gonderildi' || q.status === 'gorusmede')
}
