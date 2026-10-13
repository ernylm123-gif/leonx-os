import { formatCenti } from '@/quantity/precision'
import { CATEGORY_INFO } from '@/quantity/types'
import type { Totals } from '@/quantity/engine'

/** İş grubu bazında onaylı toplamlar (doğrulama bekleyenler ayrı sütunda) */
export function TakeoffSummary({ totals }: { totals: Totals }) {
  if (totals.byCategory.length === 0) return null
  return (
    <div className="overflow-x-auto rounded-xl border border-line" data-testid="category-summary">
      <table className="w-full min-w-[560px] text-[12.5px]">
        <thead className="bg-surface-2 text-left text-[10.5px] font-semibold tracking-wide text-subtle uppercase">
          <tr>
            <th className="px-3 py-2">İş grubu</th>
            <th className="px-3 py-2 text-right">Kalem</th>
            <th className="px-3 py-2 text-right">Adet</th>
            <th className="px-3 py-2 text-right">Doğrama m²</th>
            <th className="px-3 py-2 text-right">Doğrusal mtül</th>
            <th className="px-3 py-2 text-right">Cam m²</th>
            <th className="px-3 py-2 text-right">Bekleyen m²</th>
          </tr>
        </thead>
        <tbody>
          {totals.byCategory.map((c) => (
            <tr key={c.category} className="border-t border-line">
              <td className="px-3 py-1.5 text-ink">{CATEGORY_INFO[c.category]?.label}</td>
              <td className="px-3 py-1.5 text-right font-mono">{c.verified.items}</td>
              <td className="px-3 py-1.5 text-right font-mono">{c.verified.pieces.toLocaleString('tr-TR')}</td>
              <td className="px-3 py-1.5 text-right font-mono font-semibold text-ink">{formatCenti(c.verified.frameArea)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{c.verified.length ? formatCenti(c.verified.length) : '—'}</td>
              <td className="px-3 py-1.5 text-right font-mono">{c.verified.glassArea ? formatCenti(c.verified.glassArea) : '—'}</td>
              <td className="px-3 py-1.5 text-right font-mono text-warn">{c.pending.items ? formatCenti(c.pending.frameArea) : '—'}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-line-strong bg-surface-2/60 font-semibold">
            <td className="px-3 py-1.5 text-ink">Onaylı toplam</td>
            <td className="px-3 py-1.5 text-right font-mono">{totals.verified.items}</td>
            <td className="px-3 py-1.5 text-right font-mono">{totals.verified.pieces.toLocaleString('tr-TR')}</td>
            <td className="px-3 py-1.5 text-right font-mono text-ink" data-testid="summary-total-area">
              {formatCenti(totals.verified.frameArea)}
            </td>
            <td className="px-3 py-1.5 text-right font-mono">{totals.verified.length ? formatCenti(totals.verified.length) : '—'}</td>
            <td className="px-3 py-1.5 text-right font-mono">{totals.verified.glassArea ? formatCenti(totals.verified.glassArea) : '—'}</td>
            <td className="px-3 py-1.5 text-right font-mono text-warn">{totals.pending.items ? formatCenti(totals.pending.frameArea) : '—'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
