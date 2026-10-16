import { monthLabel } from '@/finance/cashflow'
import { formatAmount, formatMoney } from '@/quote/money'
import type { Currency } from '@/quote/types'

/**
 * Aylık gelir / gider çubuk grafiği (satır içi SVG; ek grafik kütüphanesi yok). Her para birimi ayrı
 * grafiktir — farklı birimler aynı eksende gösterilmez. Renkler tema belirteçlerinden (açık/koyu).
 */
export function MonthlyChart({ currency, series }: { currency: Currency; series: { month: string; in: number; out: number }[] }) {
  const W = 560
  const H = 170
  const PAD = { l: 8, r: 8, t: 14, b: 26 }
  const max = Math.max(1, ...series.flatMap((s) => [s.in, s.out]))
  const slot = (W - PAD.l - PAD.r) / series.length
  const bw = Math.min(18, slot / 3)
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max)
  const last = series[series.length - 1]
  return (
    <figure className="min-w-0" data-testid="cash-chart" data-currency={currency}>
      <figcaption className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-ink-2">{currency}</span>
        <span className="text-[11px] text-muted">
          Bu ay: gelir {formatMoney(last?.in ?? 0, currency)} · gider {formatMoney(last?.out ?? 0, currency)}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${currency} aylık gelir ve gider`}>
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--line)" />
        <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t} y2={PAD.t} stroke="var(--line)" strokeDasharray="3 4" />
        <text x={W - PAD.r} y={PAD.t - 4} textAnchor="end" fontSize="10" fill="var(--subtle)">
          {formatAmount(max)}
        </text>
        {series.map((s, i) => {
          const cx = PAD.l + slot * i + slot / 2
          return (
            <g key={s.month}>
              <title>{`${monthLabel(s.month)} · gelir ${formatMoney(s.in, currency)} · gider ${formatMoney(s.out, currency)}`}</title>
              <rect x={cx - bw - 1} y={y(s.in)} width={bw} height={Math.max(0, H - PAD.b - y(s.in))} rx="2" fill="var(--ok)" />
              <rect x={cx + 1} y={y(s.out)} width={bw} height={Math.max(0, H - PAD.b - y(s.out))} rx="2" fill="var(--danger)" opacity="0.85" />
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="10.5" fill="var(--muted)">
                {monthLabel(s.month)}
              </text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

export function ChartLegend() {
  return (
    <div className="flex gap-4 text-[11px] text-muted">
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-sm bg-ok" /> Gelir (gerçekleşen)
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-sm bg-danger/85" /> Gider (ödenen, KDV dahil)
      </span>
    </div>
  )
}
