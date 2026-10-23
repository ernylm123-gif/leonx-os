import { describe, expect, it } from 'vitest'
import { connectionView, serverRetryDelay } from './connectionStatus'

describe('connectionView', () => {
  it('çevrimdışı, sunucuya ulaşılamıyor ve Realtime yeniden bağlanma ayrı durumlardır', () => {
    expect(connectionView('offline', true).kind).toBe('cevrimdisi') // cihaz çevrimdışıysa sunucu suçlanmaz
    expect(connectionView('live', true)).toMatchObject({ kind: 'sunucu', label: 'Sunucuya ulaşılamıyor' })
    expect(connectionView('reconnecting', true).title).toMatch(/Sunucuya \(Supabase\) ulaşılamıyor — yeniden deneniyor/)
    expect(connectionView('reconnecting', false)).toMatchObject({ kind: 'yeniden', label: 'Yeniden bağlanıyor' })
    expect(connectionView('live', false)).toMatchObject({ kind: 'canli', title: 'Senkronizasyon: Canlı' })
    expect(connectionView('connecting', false).kind).toBe('baglaniyor')
    expect(connectionView('idle', false).kind).toBe('bagli-degil')
  })
  it('yeniden deneme beklemesi artar ve üst sınırda kalır', () => {
    expect([0, 1, 2, 3, 9].map(serverRetryDelay)).toEqual([3000, 6000, 12000, 30000, 30000])
    expect(serverRetryDelay(-1)).toBe(3000)
  })
})
