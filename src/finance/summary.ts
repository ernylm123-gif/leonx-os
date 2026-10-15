/**
 * Proje finans özeti: tahmini maliyet, gerçekleşen gider, tahsilat ve kârlılık tek yerde.
 * Proje sekmesi ve /finans paneli aynı fonksiyonu kullanır.
 */
import { toCents } from '@/quote/money'
import type { Currency } from '@/quote/types'
import type { ProjectStage } from '@/lib/domain'
import { actualTotals, type ActualResult, estimateTotals, type EstimateResult } from './estimate'
import type { FxRateLike } from './fx'
import { isRealizedStage, profitability, type ProfitResult } from './profit'
import { receivables, type ReceivablesResult } from './receivables'
import { DEFAULT_BASE_CURRENCY, type ProjectFinanceData } from './types'

export interface ProjectFinanceSummary {
  base: Currency
  estimate: EstimateResult
  actual: ActualResult
  receivables: ReceivablesResult
  profit: ProfitResult
  /** Tahmini maliyet neden hesaplanamadı (null: hesaplandı) */
  estimateIssue: string | null
  actualIssue: string | null
  saleIssue: string | null
  stageClosed: boolean
}

export function summarizeProject(project: { id: string; stage: ProjectStage }, d: ProjectFinanceData, rates: readonly FxRateLike[], today: string): ProjectFinanceSummary {
  const base = d.budget?.currency ?? DEFAULT_BASE_CURRENCY
  const fx = { base, rates, projectId: project.id }
  const estimate = estimateTotals(d.lines, { fx, date: today, wastePct: d.budget?.waste_pct ?? 0, overheadPct: d.budget?.overhead_pct ?? 0 })
  const actual = actualTotals(d.expenses, fx)
  const rec = receivables(d.schedule, d.collections, today)
  let estimateIssue: string | null = null
  if (d.lines.length === 0) estimateIssue = 'Tahmini maliyet satırı yok'
  else if (estimate.missingRates.length) estimateIssue = `Kur girilmemiş: ${estimate.missingRates.map((c) => `${c}→${base}`).join(', ')}`
  else if (estimate.unpriced) estimateIssue = `${estimate.unpriced} satırın fiyatı tanımlanmamış`
  const actualIssue = actual.complete ? null : `Kur girilmemiş gider: ${actual.missingRates.map((c) => `${c}→${base}`).join(', ')}`
  const saleNet = d.budget?.sale_net_amount != null ? toCents(d.budget.sale_net_amount) : null
  const stageClosed = isRealizedStage(project.stage)
  const profit = profitability({
    saleNet,
    vatPct: d.budget?.vat_pct ?? 0,
    estimatedCost: estimateIssue ? null : estimate.base!.total,
    actualCost: actual.complete ? actual.baseNet : null,
    stageClosed,
  })
  return {
    base,
    estimate,
    actual,
    receivables: rec,
    profit,
    estimateIssue,
    actualIssue,
    saleIssue: saleNet == null ? 'KDV hariç satış bedeli girilmedi' : null,
    stageClosed,
  }
}

/** Para birimi bazında toplama yardımcısı (farklı birimler asla toplanmaz) */
export function addTo(map: Partial<Record<Currency, number>>, cur: Currency, cents: number): void {
  map[cur] = (map[cur] ?? 0) + cents
}
