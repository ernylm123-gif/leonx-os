import { AlarmClock, Bell, CalendarClock, FileText, FolderKanban, ScanLine, Settings2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AppNotification, NotificationCategory } from '@/data/types'
import { cn } from '@/lib/cn'

export const CATEGORY_META: Record<NotificationCategory, { label: string; icon: LucideIcon }> = {
  proje: { label: 'Proje', icon: FolderKanban },
  teklif: { label: 'Teklif', icon: FileText },
  cad: { label: 'Metraj / CAD', icon: ScanLine },
  gorev: { label: 'Görev', icon: AlarmClock },
  termin: { label: 'Termin', icon: CalendarClock },
  sistem: { label: 'Sistem', icon: Settings2 },
}

const rtf = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' })
const dtf = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000
  const abs = Math.abs(diff)
  if (abs < 45) return 'şimdi'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 7 * 86400) return rtf.format(Math.round(diff / 86400), 'day')
  return dtf.format(new Date(iso))
}

export function NotificationItem({ n, onOpen, compact, action }: { n: AppNotification; onOpen: () => void; compact?: boolean; action?: React.ReactNode }) {
  const meta = CATEGORY_META[n.category] ?? { label: n.category, icon: Bell }
  const Icon = meta.icon
  const unread = !n.read_at
  return (
    <li className={cn('group relative flex gap-3', compact ? 'px-3 py-2.5' : 'px-4 py-3', unread ? 'bg-titanium/[0.06]' : '')} data-testid="notification-item" data-unread={unread}>
      <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border', unread ? 'border-titanium/40 bg-surface text-ink' : 'border-line bg-surface-2 text-muted')} aria-hidden="true">
        <Icon className="h-4 w-4" strokeWidth={1.8} />
      </span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 pr-4 text-left">
        <span className={cn('block text-[13px] leading-snug break-words', unread ? 'font-semibold text-ink' : 'text-ink-2')}>{n.title}</span>
        {n.body && <span className="mt-0.5 block text-xs break-words text-muted">{n.body}</span>}
        <span className="mt-1 flex items-center gap-2 text-[11px] text-subtle">
          <span>{meta.label}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={n.created_at} title={new Date(n.created_at).toLocaleString('tr-TR')}>
            {relativeTime(n.created_at)}
          </time>
        </span>
      </button>
      {unread && <span className="absolute top-4 right-3 h-2 w-2 rounded-full bg-primary" aria-label="Okunmadı" />}
      {action}
    </li>
  )
}
