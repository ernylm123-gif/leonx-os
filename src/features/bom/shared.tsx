import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'
import { checkFormula, FORMULA_VARS, VAR_LABEL } from '@/bom/formula'
import type { BomWarningRow } from '@/bom/types'
import { listCostRates } from '@/data/financeApi'
import { loadLibrary, type SystemLibrary, toEngineSystems } from '@/data/bomApi'
import type { CostRate } from '@/finance/types'
import { cn } from '@/lib/cn'
import { dataErrorMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { useLiveQuery } from '@/lib/useLiveList'
import { formatMoney } from '@/quote/money'
import { CURRENCIES, type Currency } from '@/quote/types'

/** Sistem kütüphanesi + birim maliyet kataloğu (canlı; başka cihazdaki değişiklik yansır) */
export function useBomLibrary() {
  const q = useLiveQuery<SystemLibrary & { rates: CostRate[] }>(
    ['product_systems', 'system_components', 'system_rules', 'cost_rates'],
    async () => {
      const db = requireSupabase()
      const [lib, rates] = await Promise.all([loadLibrary(db), listCostRates(db)])
      return { ...lib, rates }
    },
    { systems: [], components: [], rules: [], rates: [] },
  )
  const engineSystems = useMemo(() => toEngineSystems(q.data), [q.data])
  return { ...q.data, engineSystems, loading: q.loading, error: q.error, reload: q.reload }
}

/** Reçete tetikleyici/RPC iletileri (Türkçe iş kuralı) olduğu gibi gösterilir */
export function bomErrorMessage(e: unknown, context: string): string {
  const err = e as { code?: string; message?: string }
  const msg = err?.message ?? ''
  if (
    ['23514', 'P0002', '22023', '23503', '42501'].includes(err?.code ?? '') &&
    /^(Onaylanmış|Onaysız|Reçete|Satır|Yeni reçete|İptal|Hatalı|Poz |Metraj|Reddedilmiş|Aynı poz|Taslak reçete|Ürün sistemi|Geçersiz reçete)/.test(msg)
  ) {
    return msg
  }
  return dataErrorMessage(e, context)
}

const CURRENCY_ORDER: Currency[] = CURRENCIES.map((c) => c.value)
export function CostText({ cost, empty = '—', testId }: { cost: Partial<Record<Currency, number>>; empty?: string; testId?: string }) {
  const parts = CURRENCY_ORDER.filter((c) => cost[c])
  return (
    <span className="font-mono whitespace-nowrap" data-testid={testId}>
      {parts.length ? parts.map((c) => formatMoney(cost[c]!, c)).join(' · ') : empty}
    </span>
  )
}

export function Pill({ tone, children, testId }: { tone: 'ok' | 'warn' | 'danger' | 'muted' | 'info'; children: ReactNode; testId?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border px-1.5 py-px text-[11px] font-semibold whitespace-nowrap',
        tone === 'ok' && 'border-ok/30 bg-ok-soft text-ok',
        tone === 'warn' && 'border-warn-line bg-warn-soft text-warn',
        tone === 'danger' && 'border-danger/30 bg-danger-soft text-danger',
        tone === 'muted' && 'border-line bg-surface-2 text-muted',
        tone === 'info' && 'border-line bg-surface text-ink-2',
      )}
      data-testid={testId}
    >
      {children}
    </span>
  )
}

export function Notice({ tone = 'warn', children, testId }: { tone?: 'warn' | 'info' | 'danger' | 'ok'; children: ReactNode; testId?: string }) {
  const Icon = tone === 'info' ? Info : tone === 'ok' ? CheckCircle2 : AlertTriangle
  return (
    <div
      className={cn(
        'flex gap-2 rounded-xl border px-3 py-2.5 text-[12.5px] leading-relaxed',
        tone === 'warn' && 'border-warn-line bg-warn-soft text-warn',
        tone === 'info' && 'border-line bg-surface-2 text-ink-2',
        tone === 'danger' && 'border-danger/30 bg-danger-soft text-danger',
        tone === 'ok' && 'border-ok/25 bg-ok-soft text-ok',
      )}
      role={tone === 'info' || tone === 'ok' ? undefined : 'status'}
      data-testid={testId}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Uyarı listesi: hata / uyarı / bilgi düzeyleriyle */
export function WarningList({ warnings, testId = 'bom-warnings', max = 50 }: { warnings: BomWarningRow[]; testId?: string; max?: number }) {
  if (!warnings.length) return null
  const shown = warnings.slice(0, max)
  return (
    <ul className="space-y-1.5" data-testid={testId}>
      {shown.map((w, i) => {
        const Icon = w.level === 'hata' ? XCircle : w.level === 'uyari' ? AlertTriangle : Info
        return (
          <li
            key={i}
            className={cn('flex gap-2 text-[12.5px] leading-relaxed', w.level === 'hata' ? 'text-danger' : w.level === 'uyari' ? 'text-warn' : 'text-muted')}
            data-testid="bom-warning"
            data-level={w.level}
            data-code={w.code}
          >
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{w.message}</span>
          </li>
        )
      })}
      {warnings.length > max && <li className="text-[12px] text-subtle">… ve {warnings.length - max} uyarı daha (Excel/PDF raporunda tamamı)</li>}
    </ul>
  )
}

/** Formül girişi: yazarken doğrulanır, değişken başvurusu yanında gösterilir */
export function FormulaField({
  label,
  value,
  onChange,
  required,
  hint,
  testId,
  serverError,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  hint?: string
  testId?: string
  serverError?: string
}) {
  const err = value.trim() ? checkFormula(value) : null
  const id = `ff-${testId ?? label}`
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1 text-[13px] font-medium text-ink-2">
        {label}
        {required && (
          <span className="text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoCapitalize="characters"
        autoComplete="off"
        maxLength={500}
        aria-invalid={!!(err || serverError)}
        className={cn(
          'h-11 w-full rounded-xl border bg-surface px-3.5 font-mono text-base text-ink shadow-card placeholder:text-subtle focus:border-titanium focus:ring-2 focus:ring-titanium/20 focus:outline-none sm:text-sm',
          err || serverError ? 'border-danger' : value.trim() ? 'border-ok/50' : 'border-line',
        )}
        placeholder="ör. (W-60)/K"
        data-testid={testId}
      />
      {err || serverError ? (
        <p className="mt-1.5 text-xs text-danger" role="alert" data-testid={testId ? `${testId}-error` : undefined}>
          {err ?? serverError}
        </p>
      ) : value.trim() ? (
        <p className="mt-1.5 text-xs text-ok" data-testid={testId ? `${testId}-ok` : undefined}>
          Geçerli formül
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  )
}

export function FormulaReference() {
  return (
    <details className="rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-[12.5px] text-ink-2">
      <summary className="cursor-pointer font-semibold text-ink">Formül dili</summary>
      <div className="mt-2 space-y-1.5 leading-relaxed">
        <p>
          Değişkenler:{' '}
          {FORMULA_VARS.map((v) => (
            <span key={v} className="mr-2 whitespace-nowrap">
              <code className="font-mono font-semibold">{v}</code> {VAR_LABEL[v]}
            </span>
          ))}
        </p>
        <p>
          İşleçler <code className="font-mono">+ - * / ( )</code>, işlevler <code className="font-mono">min max ceil floor round</code>. Ondalık ayırıcı nokta (1.5); işlev değerleri virgül veya noktalı virgülle ayrılır.
        </p>
        <p>Karşılaştırma, koşul ve üs yoktur. Tanımsız değişken veya hatalı formül açık hata verir; sonuç asla 0 sayılmaz.</p>
      </div>
    </details>
  )
}

/** Sayı girişi (Türkçe virgül veya nokta). Boş → null, geçersiz → NaN */
export function parseNum(raw: string, decimals = 3): number | null {
  const s = raw.trim().replace(/\s/g, '')
  if (!s) return null
  const n = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  if (!/^-?\d+(\.\d+)?$/.test(n)) return Number.NaN
  const f = 10 ** decimals
  return Math.round(Number((Number(n) * f).toPrecision(15))) / f
}
export const numInput = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))
