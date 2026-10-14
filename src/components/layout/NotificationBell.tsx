import { Bell, CheckCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNotifications } from '@/context/notifications'
import { NotificationItem } from '@/features/notifications/NotificationItem'
import { cn } from '@/lib/cn'

/** Üst çubukta bildirim zili: okunmamış sayacı ve son bildirimler */
export function NotificationBell() {
  const { items, unread, markAllRead, open, loading } = useNotifications()
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!show) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setShow(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShow(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [show])

  const recent = items.slice(0, 12)
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-expanded={show}
        aria-haspopup="dialog"
        aria-label={unread ? `Bildirimler, ${unread} okunmamış` : 'Bildirimler'}
        className="relative grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-muted transition hover:bg-surface-2 hover:text-ink"
        data-testid="notification-bell"
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.8} />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full border-2 border-canvas bg-danger px-1 font-mono text-[10px] font-semibold text-white" data-testid="notification-count">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {show && (
        <div
          role="dialog"
          aria-label="Son bildirimler"
          className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+4.5rem)] z-50 flex max-h-[min(70dvh,560px)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-raised sm:absolute sm:inset-x-auto sm:top-12 sm:right-0 sm:w-[380px]"
          data-testid="notification-panel"
        >
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">Bildirimler</h2>
              <p className="text-[11px] text-muted">{unread ? `${unread} okunmamış` : 'Hepsi okundu'}</p>
            </div>
            {unread > 0 && (
              <button type="button" onClick={() => void markAllRead()} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink" data-testid="notification-read-all">
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Tümünü okundu yap
              </button>
            )}
          </header>
          <ul className={cn('min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain')}>
            {recent.map((n) => (
              <NotificationItem
                key={n.id}
                n={n}
                compact
                onOpen={() => {
                  setShow(false)
                  open(n)
                }}
              />
            ))}
            {!recent.length && <li className="px-4 py-8 text-center text-sm text-subtle">{loading ? 'Yükleniyor…' : 'Henüz bildirim yok.'}</li>}
          </ul>
          <footer className="border-t border-line px-4 py-2.5 text-right">
            <Link to="/bildirimler" onClick={() => setShow(false)} className="text-xs font-semibold text-ink-2 underline-offset-4 hover:underline">
              Tüm bildirimler ve ayarlar →
            </Link>
          </footer>
        </div>
      )}
    </div>
  )
}
