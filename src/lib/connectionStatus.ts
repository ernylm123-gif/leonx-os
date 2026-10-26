import type { SyncState } from './realtimeSync'

/**
 * Kullanıcıya gösterilen bağlantı durumu. Üç ayrı arıza birbirinden ayrılır:
 *  - "cevrimdisi": cihazın kendisi ağa bağlı değil (navigator.onLine / offline olayı)
 *  - "sunucu": cihaz çevrimiçi ama Supabase REST'e ulaşılamıyor (ağ hatası, zaman aşımı, 5xx)
 *  - "yeniden": yalnız anlık (Realtime) bağlantı yeniden kuruluyor; veri okunabiliyor
 */
export type ConnectionKind = 'canli' | 'baglaniyor' | 'yeniden' | 'sunucu' | 'cevrimdisi' | 'bagli-degil'

export interface ConnectionView {
  kind: ConnectionKind
  label: string
  title: string
}

export function connectionView(sync: SyncState, serverUnreachable: boolean, lastSyncedAt: Date | null = null): ConnectionView {
  const last = lastSyncedAt ? ` · Son güncelleme ${lastSyncedAt.toLocaleTimeString('tr-TR')}` : ''
  if (sync === 'offline') return { kind: 'cevrimdisi', label: 'Çevrimdışı', title: 'Çevrimdışı: değişiklikler kaydedilemez. Bağlantı gelince veriler otomatik yenilenir.' }
  if (serverUnreachable)
    return { kind: 'sunucu', label: 'Sunucuya ulaşılamıyor', title: `Sunucuya (Supabase) ulaşılamıyor — yeniden deneniyor${last}` }
  switch (sync) {
    case 'live':
      return { kind: 'canli', label: 'Canlı', title: `Senkronizasyon: Canlı${last}` }
    case 'reconnecting':
      return { kind: 'yeniden', label: 'Yeniden bağlanıyor', title: `Senkronizasyon: Yeniden bağlanıyor${last}` }
    case 'connecting':
      return { kind: 'baglaniyor', label: 'Bağlanıyor', title: `Senkronizasyon: Bağlanıyor${last}` }
    default:
      return { kind: 'bagli-degil', label: 'Bağlı değil', title: `Senkronizasyon: Bağlı değil${last}` }
  }
}

/** Sunucuya ulaşılamadığında veri yenileme denemeleri arasındaki bekleme (ms) */
export const SERVER_RETRY_MS = [3_000, 6_000, 12_000, 30_000] as const

export function serverRetryDelay(attempt: number): number {
  return SERVER_RETRY_MS[Math.min(Math.max(attempt, 0), SERVER_RETRY_MS.length - 1)]
}
