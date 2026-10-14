import { Bell, CheckCheck, MailOpen } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { ErrorState, SkeletonRows } from '@/components/ui/States'
import { FilterSelect } from '@/components/ui/Toolbar'
import { useNotifications } from '@/context/notifications'
import type { NotificationCategory } from '@/data/types'
import { CATEGORY_META, NotificationItem } from '@/features/notifications/NotificationItem'
import { NotificationSettings } from '@/features/notifications/NotificationSettings'

export function NotificationsPage() {
  const { items, unread, loading, error, reload, markAllRead, markUnread, open } = useNotifications()
  const [cat, setCat] = useState<NotificationCategory | ''>('')
  const [onlyUnread, setOnlyUnread] = useState(false)
  const list = useMemo(() => items.filter((n) => (!cat || n.category === cat) && (!onlyUnread || !n.read_at)), [items, cat, onlyUnread])

  return (
    <>
      <PageHeader
        icon={Bell}
        code="M10"
        eyebrow="Genel"
        title="Bildirimler"
        description="Projeler, teklifler, metraj, görevler ve terminlerle ilgili tüm bildirimler. Okundu durumu tüm cihazlarınızda eşitlenir."
        status="ready"
        actions={
          unread > 0 ? (
            <Button variant="secondary" icon={CheckCheck} onClick={() => void markAllRead()}>
              Tümünü okundu yap ({unread})
            </Button>
          ) : undefined
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="card min-w-0 overflow-hidden" aria-label="Bildirim geçmişi">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <FilterSelect value={cat} onChange={(v) => setCat(v as NotificationCategory | '')} label="Kategori" className="w-48">
              <option value="">Tüm kategoriler</option>
              {Object.entries(CATEGORY_META).map(([k, m]) => (
                <option key={k} value={k}>
                  {m.label}
                </option>
              ))}
            </FilterSelect>
            <label className="inline-flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" className="h-4 w-4" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} />
              Yalnız okunmamış
            </label>
            <span className="ml-auto text-xs text-muted">
              {list.length} bildirim · {unread} okunmamış
            </span>
          </div>
          {loading && !items.length ? (
            <SkeletonRows />
          ) : error && !items.length ? (
            <ErrorState message={error} onRetry={() => void reload()} />
          ) : list.length === 0 ? (
            <EmptyState icon={Bell} title={items.length ? 'Eşleşen bildirim yok' : 'Henüz bildirim yok'} description="Proje, teklif, metraj ve görev olayları burada görünür." />
          ) : (
            <ul className="divide-y divide-line" data-testid="notification-list">
              {list.map((n) => (
                <NotificationItem
                  key={n.id}
                  n={n}
                  onOpen={() => open(n)}
                  action={
                    n.read_at ? (
                      <button type="button" onClick={() => void markUnread(n.id)} className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-subtle hover:bg-surface-3 hover:text-ink" aria-label="Okunmadı olarak işaretle" title="Okunmadı olarak işaretle">
                        <MailOpen className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    ) : null
                  }
                />
              ))}
            </ul>
          )}
        </section>
        <NotificationSettings />
      </div>
    </>
  )
}
