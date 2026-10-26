import { AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react'
import type { ReactNode } from 'react'
import { loadRadar, RADAR_TABLES } from '@/data/radarApi'
import { EMPTY_RADAR, type RadarData, type NeedStatus } from '@/data/radarTypes'
import { cn } from '@/lib/cn'
import { requireSupabase } from '@/lib/supabase'
import { useLiveQuery } from '@/lib/useLiveList'

/** Radar verisi (canlı): radar tablolarından herhangi biri değişince yeniden yüklenir */
export function useRadarData() {
  return useLiveQuery<RadarData>([...RADAR_TABLES], () => loadRadar(requireSupabase()), EMPTY_RADAR)
}

/** Doğrulanmış / Potansiyel — doğrulanmadı rozeti (iki kavram asla karışmaz) */
export function NeedBadge({ need, children }: { need: NeedStatus; children?: ReactNode }) {
  const ok = need === 'dogrulanmis'
  const Icon = ok ? CheckCircle2 : CircleDashed
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold',
        ok ? 'border-ok/25 bg-ok-soft text-ok' : 'border-warn-line bg-warn-soft text-warn',
      )}
      data-need={need}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{children}</span>
      <span className="shrink-0 font-normal opacity-80">· {ok ? 'Doğrulanmış' : 'Potansiyel — doğrulanmadı'}</span>
    </span>
  )
}

export function Meter({ label, value, tone, testId }: { label: string; value: number; tone?: 'ok' | 'warn' | 'muted'; testId?: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted">
        <span>{label}</span>
        <span className="font-mono text-[13px] font-semibold text-ink" data-value>
          {value}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        <div className={cn('h-full rounded-full', tone === 'ok' ? 'bg-ok' : tone === 'warn' ? 'bg-warn' : 'bg-titanium')} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  )
}

export function Notice({ tone = 'info', children, testId }: { tone?: 'info' | 'warn'; children: ReactNode; testId?: string }) {
  return (
    <div className={cn('flex gap-2 rounded-xl border px-3 py-2 text-[12.5px] leading-relaxed', tone === 'warn' ? 'border-warn-line bg-warn-soft text-warn' : 'border-line bg-surface-2 text-ink-2')} data-testid={testId}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function Kpi({ label, value, hint, testId, tone }: { label: string; value: ReactNode; hint?: string; testId?: string; tone?: 'warn' | 'ok' }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-card" data-testid={testId}>
      <div className="text-[11.5px] font-medium text-muted">{label}</div>
      <div className={cn('mt-1 font-mono text-xl leading-tight font-semibold', tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-ink')} data-value>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] leading-snug text-subtle">{hint}</div>}
    </div>
  )
}

/** Dış bağlantı (kaynak adresleri): yeni sekmede, yönlendiren bilgisi olmadan */
export function ExtLink({ href, children, className }: { href: string; children?: ReactNode; className?: string }) {
  const safe = /^https?:\/\//i.test(href) ? href : undefined
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className={cn('break-all text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink', className)}>
      {children ?? href}
    </a>
  )
}
