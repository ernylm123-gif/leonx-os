import { describe, expect, it } from 'vitest'
import { mergeServerList, REALTIME_TABLES } from './data'

describe('mergeServerList', () => {
  it('yenileme sırasında gelen daha yeni yerel sürümü korur, silinenleri düşürür', () => {
    const server = [
      { id: 'a', version: 2, v: 'sunucu-a' },
      { id: 'b', version: 5, v: 'sunucu-b' },
    ]
    const local = [
      { id: 'a', version: 3, v: 'yerel-a' },
      { id: 'b', version: 4, v: 'yerel-b' },
      { id: 'c', version: 1, v: 'silinmis' },
    ]
    expect(mergeServerList(server, local).map((x) => x.v)).toEqual(['yerel-a', 'sunucu-b'])
  })
})

describe('REALTIME_TABLES', () => {
  it('yeniden bağlanınca tam yenilenen tablolar: bildirimler, projeler, teklifler, finans, firmalar', () => {
    // Bağlantı yeniden kurulunca (SUBSCRIBED) DataProvider firmalar+projeleri, useLiveList/useLiveQuery
    // ve bildirim sağlayıcısı kendi listelerini yeniden okur (syncState → 'live' geçişi).
    for (const t of ['notifications', 'projects', 'quotes', 'quote_items', 'companies', 'project_budgets', 'project_expenses', 'project_collections', 'project_payment_schedule', 'project_cost_lines']) {
      expect(REALTIME_TABLES).toContain(t)
    }
  })
})
