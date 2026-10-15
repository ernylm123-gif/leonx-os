import { AlertTriangle, Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { listCostRates, listFxRates } from '@/data/financeApi'
import type { CostRate, FxRate } from '@/finance/types'
import { cn } from '@/lib/cn'
import { dataErrorMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { useLiveQuery } from '@/lib/useLiveList'
import { formatMoney, formatPct, parseMoneyInput } from '@/quote/money'
import { CURRENCIES, type Currency } from '@/quote/types'

export const CURRENCY_ORDER: Currency[] = CURRENCIES.map((c) => c.value)

/** Para birimi bazında tutarlar: "12.000,00 ₺ · 100,00 €". Farklı birimler toplanmaz. */
export function MoneyByCurrency({ map, empty = '—', className, testId }: { map: Partial<Record<Currency, number>>; empty?: string; className?: string; testId?: string }) {
  const parts = CURRENCY_ORDER.filter((c) => map[c] != null && map[c] !== 0)
  return (
    <span className={cn('font-mono', className)} data-testid={testId}>
      {parts.length === 0
        ? empty
        : parts.map((c, i) => (
            <span key={c} className="whitespace-nowrap">
              {i > 0 && ' · '}
              {formatMoney(map[c]!, c)}
            </span>
          )).reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, ' ', el] : [el]), [])}
    </span>
  )
}

/** "Tahmini" / "Gerçekleşen" etiketi — iki kavram asla karıştırılmaz */
export function KindBadge({ kind }: { kind: 'tahmini' | 'gerceklesen' }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide whitespace-nowrap uppercase',
        kind === 'tahmini' ? 'border-warn-line bg-warn-soft text-warn' : 'border-ok/25 bg-ok-soft text-ok',
      )}
    >
      {kind === 'tahmini' ? 'Tahmini' : 'Gerçekleşen'}
    </span>
  )
}

export function FinNotice({ tone = 'warn', children, testId }: { tone?: 'warn' | 'info' | 'danger'; children: ReactNode; testId?: string }) {
  const Icon = tone === 'info' ? Info : AlertTriangle
  return (
    <div
      className={cn(
        'flex gap-2 rounded-xl border px-3 py-2 text-[12.5px] leading-relaxed',
        tone === 'warn' && 'border-warn-line bg-warn-soft text-warn',
        tone === 'info' && 'border-line bg-surface-2 text-ink-2',
        tone === 'danger' && 'border-danger/30 bg-danger-soft text-danger',
      )}
      role={tone === 'info' ? undefined : 'status'}
      data-testid={testId}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export const pctText = (bp: number | null) => (bp == null ? '—' : formatPct(bp, 1))
export const money = (cents: number | null | undefined, c: Currency) => (cents == null ? '—' : formatMoney(cents, c))

/** Kuruş → form girişi ("1234,56") */
export const centsToInput = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','))
export const numToInput = (n: number | null | undefined, decimals = 3) =>
  n == null ? '' : String(Number(n.toFixed(decimals))).replace('.', ',')

/** Tutar girişi → sayı (veritabanı numeric(14,2)); boş → null; geçersiz → NaN */
export function parseAmount(raw: string): number | null {
  if (!raw.trim()) return null
  const c = parseMoneyInput(raw)
  return c == null ? Number.NaN : c / 100
}

/**
 * Miktar / yüzde girişi → sayı (en fazla `decimals` ondalık); boş → null; geçersiz → NaN.
 * Virgül ondalık ayırıcıdır ("12,345"; binlik nokta: "1.250,5"); virgül yoksa nokta ondalıktır ("12.5").
 */
export function parseNumber(raw: string, decimals = 3): number | null {
  const s = raw.trim().replace(/\s/g, '')
  if (!s) return null
  const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  if (!/^\d+(\.\d+)?$/.test(norm)) return Number.NaN
  const f = 10 ** decimals
  return Math.round(Number((Number(norm) * f).toPrecision(15))) / f
}

/** Kurlar ve birim maliyet kataloğu (canlı) */
export function useFinanceRefs() {
  const q = useLiveQuery<{ fx: FxRate[]; rates: CostRate[] }>(
    ['fx_rates', 'cost_rates'],
    async () => {
      const db = requireSupabase()
      const [fx, rates] = await Promise.all([listFxRates(db), listCostRates(db)])
      return { fx, rates }
    },
    { fx: [], rates: [] },
  )
  return { fx: q.data.fx, rates: q.data.rates, loading: q.loading, error: q.error, reload: q.reload }
}

/** Finans tetikleyici iletilerini (Türkçe iş kuralı) olduğu gibi, benzersizlik hatalarını anlaşılır gösterir */
export function finErrorMessage(e: unknown, context: string): string {
  const err = e as { code?: string; message?: string }
  const msg = err?.message ?? ''
  if (err?.code === '23514' && /^(Yalnız|Doğrulanmamış|Bu projeye|Metraj|Poz|Bütçe|Teklif|Tahsilat|Taksit|Kayıt|Maliyet)/.test(msg)) return msg
  if (err?.code === '23505') {
    if (msg.includes('project_cost_lines_source_unique')) return 'Bu metraj pozu bu maliyet grubuna zaten aktarılmış (çift sayım engellendi).'
    if (msg.includes('project_expenses_document_unique')) return 'Bu tedarikçinin aynı belge numarası bu projede zaten kayıtlı.'
    if (msg.includes('fx_rates_unique')) return 'Bu tarih ve para birimi çifti için kur zaten girilmiş.'
    if (msg.includes('cost_rates_code_valid_unique')) return 'Bu kod için aynı geçerlilik tarihli fiyat zaten var.'
    if (msg.includes('project_budgets')) return 'Bu projenin bütçesi başka bir cihazda oluşturuldu; sayfa yenilendi, tekrar deneyin.'
  }
  return dataErrorMessage(e, context)
}

export function StatTile({ label, value, hint, badge, tone, testId }: { label: string; value: ReactNode; hint?: ReactNode; badge?: ReactNode; tone?: 'ok' | 'danger' | 'warn'; testId?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface-2/50 px-3 py-2.5" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] font-medium text-muted">
        {label}
        {badge}
      </div>
      <div
        className={cn(
          'mt-1 font-mono text-[15px] leading-tight font-semibold break-words',
          tone === 'ok' ? 'text-ok' : tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ink',
        )}
        data-value
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] leading-snug text-subtle">{hint}</div>}
    </div>
  )
}
