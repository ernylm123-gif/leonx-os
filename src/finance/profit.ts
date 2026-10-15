/**
 * Kârlılık — tüm tutarlar ana para biriminde, KDV HARİÇ kuruş.
 *
 *  Kâr                    = net satış − maliyet
 *  Kâr marjı (bp)         = kâr / net satış          (satış içindeki pay)
 *  Maliyet üzerinden kâr  = kâr / maliyet            (markup)
 *  KDV kâra dahil edilmez; yalnız bilgi olarak (net satış × KDV oranı) gösterilir.
 *
 *  Tahmini (beklenen) kâr: net satış − tahmini maliyet. Proje bitmeden "gerçekleşen" DEĞİLDİR.
 *  Beklenen sonuç: gerçekleşen gider tahmini aştıysa maliyet en az gerçekleşen kadar kabul edilir.
 *  Gerçekleşen kâr: yalnız kapanmış (tamamlandı / teslim edildi) projede, kayıtlı giderlerden.
 */
import { mulDiv } from '@/quote/money'
import type { ProjectStage } from '@/lib/domain'
import { pctOf } from './estimate'

/** Gerçekleşen kâr yalnız bu aşamalarda hesaplanır (iptal hariç) */
export const REALIZED_STAGES: readonly ProjectStage[] = ['tamamlandi', 'teslim_edildi']
export const isRealizedStage = (s: ProjectStage): boolean => REALIZED_STAGES.includes(s)

/** num / den, baz puan (1/100 %), yarım yukarı; payda ≤ 0 ise null */
export function ratioBp(num: number, den: number): number | null {
  if (!(den > 0)) return null
  return Math.sign(num) * mulDiv(Math.abs(num), 10_000, den)
}

export interface ProfitInput {
  /** KDV hariç satış (null: girilmedi) */
  saleNet: number | null
  vatPct: number
  /** Tahmini toplam maliyet (null: eksik/çevrilemedi) */
  estimatedCost: number | null
  /** Gerçekleşen gider toplamı, KDV hariç (null: çevrilemeyen gider var) */
  actualCost: number | null
  stageClosed: boolean
}

export interface ProfitFigures {
  cost: number
  profit: number
  marginBp: number | null
  markupBp: number | null
}

export interface ProfitResult {
  saleNet: number | null
  vat: number | null
  saleGross: number | null
  /** Tahmini kâr (net satış − tahmini maliyet) */
  expected: ProfitFigures | null
  /** Bütçe sapması: gerçekleşen − tahmini; oran tahmini maliyete göre */
  variance: { amount: number; bp: number | null } | null
  /** Beklenen sonuç (tahmini): maliyet = max(tahmini, gerçekleşen) */
  forecast: ProfitFigures | null
  /** Gerçekleşen kâr — yalnız kapanmış projede */
  realized: ProfitFigures | null
}

function figures(sale: number, cost: number): ProfitFigures {
  const profit = sale - cost
  return { cost, profit, marginBp: ratioBp(profit, sale), markupBp: ratioBp(profit, cost) }
}

export function profitability(i: ProfitInput): ProfitResult {
  const vat = i.saleNet == null ? null : pctOf(i.saleNet, i.vatPct)
  const expected = i.saleNet != null && i.estimatedCost != null ? figures(i.saleNet, i.estimatedCost) : null
  const variance =
    i.estimatedCost != null && i.actualCost != null ? { amount: i.actualCost - i.estimatedCost, bp: ratioBp(i.actualCost - i.estimatedCost, i.estimatedCost) } : null
  let forecast: ProfitFigures | null = null
  if (i.saleNet != null && i.estimatedCost != null) forecast = figures(i.saleNet, Math.max(i.estimatedCost, i.actualCost ?? 0))
  const realized = i.stageClosed && i.saleNet != null && i.actualCost != null ? figures(i.saleNet, i.actualCost) : null
  return { saleNet: i.saleNet, vat, saleGross: i.saleNet != null && vat != null ? i.saleNet + vat : null, expected, variance, forecast, realized }
}
