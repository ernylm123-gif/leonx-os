import { CloudOff, Loader2, Radio } from 'lucide-react'
import { useData } from '@/context/data'
import { cn } from '@/lib/cn'

const LABEL = {
  idle: 'Bağlı değil',
  connecting: 'Bağlanıyor',
  live: 'Canlı',
  reconnecting: 'Yeniden bağlanıyor',
  offline: 'Çevrimdışı',
} as const

/** Realtime bağlantı durumu — cihazlar arası senkronizasyonun canlı olup olmadığını gösterir. */
export function SyncIndicator() {
  const { syncState, lastSyncedAt } = useData()
  const Icon = syncState === 'live' ? Radio : syncState === 'offline' ? CloudOff : Loader2
  const title =
    syncState === 'offline'
      ? 'Çevrimdışı: değişiklikler kaydedilemez. Bağlantı gelince veriler otomatik yenilenir.'
      : `Senkronizasyon: ${LABEL[syncState]}${lastSyncedAt ? ` · Son güncelleme ${lastSyncedAt.toLocaleTimeString('tr-TR')}` : ''}`
  return (
    <div
      className={cn(
        'flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-medium',
        syncState === 'live' && 'border-ok/25 bg-ok-soft text-ok',
        syncState === 'offline' && 'border-danger/25 bg-danger-soft text-danger',
        (syncState === 'connecting' || syncState === 'reconnecting' || syncState === 'idle') && 'border-line bg-surface text-muted',
      )}
      title={title}
      role="status"
      aria-label={title}
    >
      <Icon className={cn('h-4 w-4', syncState !== 'live' && syncState !== 'offline' && 'animate-spin')} aria-hidden="true" />
      <span className="hidden xl:inline">{LABEL[syncState]}</span>
    </div>
  )
}

/** Çevrimdışıyken tüm ekran boyutlarında görünen açıklama (mobilde durum simgesi küçük kalır). */
export function OfflineNotice() {
  const { syncState } = useData()
  if (syncState !== 'offline') return null
  return (
    <div role="alert" data-testid="offline-notice" className="border-b border-danger/25 bg-danger-soft px-4 py-2 text-center text-[12.5px] text-danger">
      <CloudOff className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
      Çevrimdışısınız. Açık formlardaki bilgiler korunur; bağlantı gelince kaydedin. Veriler bağlantı gelince otomatik yenilenir.
    </div>
  )
}
