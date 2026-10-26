import { CloudOff, Loader2, Radio, RotateCw, ServerCrash } from 'lucide-react'
import { useData } from '@/context/data'
import { cn } from '@/lib/cn'
import { connectionView } from '@/lib/connectionStatus'

/**
 * Bağlantı durumu: cihaz çevrimdışı, sunucuya (Supabase) ulaşılamıyor ve anlık senkronizasyon
 * (Realtime) yeniden bağlanıyor durumları ayrı gösterilir (bkz. src/lib/connectionStatus.ts).
 */
export function SyncIndicator() {
  const { syncState, lastSyncedAt, serverUnreachable } = useData()
  const view = connectionView(syncState, serverUnreachable, lastSyncedAt)
  const Icon = view.kind === 'canli' ? Radio : view.kind === 'cevrimdisi' ? CloudOff : view.kind === 'sunucu' ? ServerCrash : Loader2
  const spinning = view.kind === 'baglaniyor' || view.kind === 'yeniden' || view.kind === 'bagli-degil'
  return (
    <div
      className={cn(
        'flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-medium',
        view.kind === 'canli' && 'border-ok/25 bg-ok-soft text-ok',
        view.kind === 'cevrimdisi' && 'border-danger/25 bg-danger-soft text-danger',
        view.kind === 'sunucu' && 'border-warn-line bg-warn-soft text-warn',
        spinning && 'border-line bg-surface text-muted',
      )}
      title={view.title}
      role="status"
      aria-label={view.title}
      data-testid="sync-indicator"
      data-kind={view.kind}
    >
      <Icon className={cn('h-4 w-4', spinning && 'animate-spin')} aria-hidden="true" />
      <span className="hidden xl:inline">{view.label}</span>
    </div>
  )
}

/**
 * Tüm ekran boyutlarında görünen açıklama (mobilde durum simgesi küçük kalır):
 * çevrimdışı veya cihaz çevrimiçiyken sunucuya ulaşılamıyor.
 */
export function ConnectionNotice() {
  const { syncState, serverUnreachable, refresh } = useData()
  const view = connectionView(syncState, serverUnreachable)
  if (view.kind === 'cevrimdisi')
    return (
      <div role="alert" data-testid="offline-notice" className="border-b border-danger/25 bg-danger-soft px-4 py-2 text-center text-[12.5px] text-danger">
        <CloudOff className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
        Çevrimdışısınız. Açık formlardaki bilgiler korunur; bağlantı gelince kaydedin. Veriler bağlantı gelince otomatik yenilenir.
      </div>
    )
  if (view.kind === 'sunucu')
    return (
      <div
        role="alert"
        data-testid="server-notice"
        className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warn-line bg-warn-soft px-4 py-2 text-center text-[12.5px] text-warn"
      >
        <span>
          <ServerCrash className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
          Sunucuya (Supabase) ulaşılamıyor — yeniden deneniyor. İnternet bağlantınız var; açık formlardaki bilgiler korunur.
        </span>
        <button
          type="button"
          data-testid="server-retry"
          onClick={() => void refresh()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-warn-line px-2.5 font-semibold hover:bg-warn-soft"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          Şimdi dene
        </button>
      </div>
    )
  return null
}
