import { AlertTriangle, Calculator, EyeOff } from 'lucide-react'
import { Panel } from '@/components/ui/Panel'
import { cn } from '@/lib/cn'
import type { QuoteTotals } from '@/quote/engine'
import { formatMoney, formatPct } from '@/quote/money'
import type { Currency } from '@/quote/types'

function Row({ label, value, strong, muted, testId }: { label: string; value: string; strong?: boolean; muted?: boolean; testId?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1', strong && 'border-t border-line pt-2.5 text-[15px]')}>
      <dt className={cn(muted ? 'text-muted' : 'text-ink-2', strong && 'font-semibold text-ink')}>{label}</dt>
      <dd className={cn('font-mono whitespace-nowrap', strong ? 'font-semibold text-ink' : 'text-ink')} data-testid={testId}>
        {value}
      </dd>
    </div>
  )
}

/** Teklif toplamları (müşteriye yansıyan) ve iç maliyet/kâr özeti (çıktılara yazılmaz) */
export function QuoteTotalsCard({ t, currency, otherLabel, detailed }: { t: QuoteTotals; currency: Currency; otherLabel: string | null; detailed: boolean }) {
  const m = (c: number) => formatMoney(c, currency)
  return (
    <Panel title="Toplamlar" subtitle={detailed ? 'Kalem tutarlarından hesaplanır' : 'Toplam bedelli teklif'} icon={Calculator}>
      <dl className="text-[13.5px]" data-testid="quote-totals">
        <Row label={detailed ? 'Kalemler toplamı' : 'Teklif bedeli'} value={m(t.itemsTotal)} />
        {t.shipping > 0 && <Row label="Nakliye" value={m(t.shipping)} />}
        {t.other > 0 && <Row label={otherLabel || 'Diğer giderler'} value={m(t.other)} />}
        <Row label="Ara toplam" value={m(t.subtotal)} testId="tot-subtotal" />
        {t.discount > 0 && <Row label="İndirim" value={`− ${m(t.discount)}`} testId="tot-discount" />}
        {t.discount > 0 && <Row label="İndirimli toplam" value={m(t.net)} />}
        <Row label={`KDV (${formatPct(t.vatBp)})`} value={m(t.vat)} testId="tot-vat" />
        <Row label="Genel toplam" value={m(t.grandTotal)} strong testId="tot-grand" />
      </dl>

      {(t.unverified.items > 0 || t.invalidItems > 0 || t.unpricedItems > 0) && (
        <ul className="mt-3 space-y-1.5 rounded-xl border border-warn-line bg-warn-soft px-3 py-2.5 text-[12.5px] text-warn" data-testid="quote-warnings">
          {t.invalidItems > 0 && (
            <li className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t.invalidItems} kalem hatalı ve toplama katılmadı.
            </li>
          )}
          {t.unpricedItems > 0 && (
            <li className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t.unpricedItems} kalemin fiyatı girilmedi.
            </li>
          )}
          {t.unverified.items > 0 && (
            <li className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t.unverified.items} kalemin ölçüsü doğrulanmadı{detailed ? ` (${m(t.unverified.amount)})` : ''}. PDF'te işaretlenir.
            </li>
          )}
        </ul>
      )}

      <div className="mt-4 rounded-xl border border-dashed border-line px-3 py-2.5">
        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase">
          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> İç bilgi — çıktılara yazılmaz
        </p>
        {t.totalCost == null ? (
          <p className="text-[12.5px] text-muted">Maliyet girilmedi; kâr hesaplanamıyor.</p>
        ) : (
          <dl className="text-[13px]" data-testid="quote-profit">
            <Row label="Doğrudan maliyet" value={m(t.directCost ?? 0)} muted />
            {(t.overheadCost ?? 0) > 0 && <Row label="Genel gider" value={m(t.overheadCost ?? 0)} muted />}
            {t.shipping + t.other > 0 && <Row label="Nakliye ve diğer" value={m(t.shipping + t.other)} muted />}
            <Row label="Toplam maliyet" value={m(t.totalCost)} />
            <Row label="Kâr (KDV hariç)" value={m(t.profit ?? 0)} testId="tot-profit" />
            <Row label="Kâr oranı (maliyet üzerine)" value={t.markupBp == null ? '—' : formatPct(t.markupBp)} testId="tot-markup" />
            <Row label="Kâr marjı (satış içinde)" value={t.marginBp == null ? '—' : formatPct(t.marginBp)} testId="tot-margin" />
          </dl>
        )}
      </div>
    </Panel>
  )
}
