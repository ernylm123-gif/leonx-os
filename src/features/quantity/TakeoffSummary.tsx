import { useMemo } from 'react'
import { summarizeByMaterial } from '@/quantity/materials'
import { formatCenti } from '@/quantity/precision'
import { CATEGORY_INFO, type QuantityItem } from '@/quantity/types'
import type { ItemResult, Totals } from '@/quantity/engine'

const opt = (v: number) => (v ? formatCenti(v) : '—')

/**
 * İş grubu bazında onaylı toplamlar (doğrulama bekleyenler ayrı sütunda). Brüt = duvar boşluğu
 * (montaj payı dahil), doğrama = kasa dış ölçüsü, cam = net cam alanı. Kalemler verilirse malzeme ve
 * sistem/seri bazlı tablo da gösterilir.
 */
export function TakeoffSummary({ totals, items, results }: { totals: Totals; items?: readonly QuantityItem[]; results?: readonly ItemResult[] }) {
  const byMaterial = useMemo(() => (items && results ? summarizeByMaterial(items, results) : []), [items, results])
  if (totals.byCategory.length === 0) return null
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-line" data-testid="category-summary">
        <table className="w-full min-w-[720px] text-[12.5px]">
          <thead className="bg-surface-2 text-left text-[10.5px] font-semibold tracking-wide text-subtle uppercase">
            <tr>
              <th className="px-3 py-2">İş grubu</th>
              <th className="px-3 py-2 text-right">Kalem</th>
              <th className="px-3 py-2 text-right">Adet</th>
              <th className="px-3 py-2 text-right" title="Duvar boşluğu (montaj payı dahil)">
                Brüt m²
              </th>
              <th className="px-3 py-2 text-right">Doğrama m²</th>
              <th className="px-3 py-2 text-right" title="Kasa çevresi; profil satın alma boyu değildir">
                Çevre mtül
              </th>
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
                <td className="px-3 py-1.5 text-right font-mono">{opt(c.verified.openingArea)}</td>
                <td className="px-3 py-1.5 text-right font-mono font-semibold text-ink">{formatCenti(c.verified.frameArea)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{opt(c.verified.perimeter)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{c.verified.length ? formatCenti(c.verified.length) : '—'}</td>
                <td className="px-3 py-1.5 text-right font-mono">{c.verified.glassArea ? formatCenti(c.verified.glassArea) : '—'}</td>
                <td className="px-3 py-1.5 text-right font-mono text-warn">{c.pending.items ? formatCenti(c.pending.frameArea) : '—'}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-line-strong bg-surface-2/60 font-semibold">
              <td className="px-3 py-1.5 text-ink">Onaylı toplam</td>
              <td className="px-3 py-1.5 text-right font-mono">{totals.verified.items}</td>
              <td className="px-3 py-1.5 text-right font-mono">{totals.verified.pieces.toLocaleString('tr-TR')}</td>
              <td className="px-3 py-1.5 text-right font-mono">{opt(totals.verified.openingArea)}</td>
              <td className="px-3 py-1.5 text-right font-mono text-ink" data-testid="summary-total-area">
                {formatCenti(totals.verified.frameArea)}
              </td>
              <td className="px-3 py-1.5 text-right font-mono">{opt(totals.verified.perimeter)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{totals.verified.length ? formatCenti(totals.verified.length) : '—'}</td>
              <td className="px-3 py-1.5 text-right font-mono">{totals.verified.glassArea ? formatCenti(totals.verified.glassArea) : '—'}</td>
              <td className="px-3 py-1.5 text-right font-mono text-warn">{totals.pending.items ? formatCenti(totals.pending.frameArea) : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {byMaterial.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line" data-testid="material-summary">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <thead className="bg-surface-2 text-left text-[10.5px] font-semibold tracking-wide text-subtle uppercase">
              <tr>
                <th className="px-3 py-2">Malzeme</th>
                <th className="px-3 py-2">Sistem / seri</th>
                <th className="px-3 py-2 text-right">Adet</th>
                <th className="px-3 py-2 text-right">Doğrama m²</th>
                <th className="px-3 py-2 text-right">Çevre mtül</th>
                <th className="px-3 py-2 text-right">Cam m²</th>
              </tr>
            </thead>
            <tbody>
              {byMaterial.map((m) => (
                <tr key={`${m.material}|${m.system ?? ''}`} className="border-t border-line" data-testid="material-row">
                  <td className="px-3 py-1.5 text-ink">
                    {m.material}
                    {m.candidates > 0 && <span className="ml-1.5 text-[11px] text-warn">({m.candidates} kalemde aday)</span>}
                  </td>
                  <td className="px-3 py-1.5 text-ink-2">{m.system ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{m.pieces.toLocaleString('tr-TR')}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold text-ink">{formatCenti(m.frameArea)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{opt(m.perimeter)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{opt(m.glassArea)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">Yalnız onaylı pozlar. Malzeme çizimden okunamazsa iş grubundan alınır; ikisi de yoksa “Belirtilmemiş”.</p>
        </div>
      )}
    </div>
  )
}
