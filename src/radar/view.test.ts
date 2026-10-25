import { describe, expect, it } from 'vitest'
import type { RadarData, RadarOpportunity } from '@/data/radarTypes'
import { EMPTY_RADAR } from '@/data/radarTypes'
import { applyFilters, buildViews, capabilitiesFrom, DEFAULT_FILTERS, kpis, missingInfo, risks, sortAnkaraFirst, strategy, toAssistant } from './view'

// SENTETİK test verisi (gerçek fırsat değildir)
const NOW = new Date('2026-10-22T09:00:00Z')
function opp(o: Partial<RadarOpportunity>): RadarOpportunity {
  return {
    id: 'o1', title: 'Sentetik', city: null, district: null, is_ankara: false, sector: 'bilinmiyor', project_type: null, stage: 'bilinmiyor', tender: {}, deadline: null,
    score: 50, score_breakdown: [], reliability: 50, reliability_base: 50, reliability_breakdown: [], verified_need: false, label: 'potansiyel_ihtiyac', risks: [],
    status: 'yeni', status_note: null, next_action: null, cluster_key: 'x:1', first_seen_at: '2026-10-22T07:00:00Z', last_updated_at: '2026-10-22T07:00:00Z',
    crm_company_id: null, project_id: null, notes: null, version: 1, ...o,
  }
}
const data: RadarData = {
  ...EMPTY_RADAR,
  sources: [{ id: 's1', kind: 'rss' } as never, { id: 's2', kind: 'search_api' } as never],
  items: [
    { id: 'i1', opportunity_id: 'a', source_id: 's1', canonical_url: 'https://a.test/1', published_at: null, first_seen_at: '2026-10-20T00:00:00Z', last_seen_at: '', pending: false },
    { id: 'i2', opportunity_id: 'b', source_id: 's2', canonical_url: 'https://b.test/1', published_at: null, first_seen_at: '2026-10-20T00:00:00Z', last_seen_at: '', pending: false },
  ],
  opportunities: [
    opp({ id: 'b', title: 'İzmir hastane', city: 'İzmir', score: 90, verified_need: true, label: 'dogrulanmis_firsat', deadline: '2026-10-30', sector: 'kamu' }),
    opp({ id: 'a', title: 'Etimesgut okul', city: 'Ankara', district: 'Etimesgut', is_ankara: true, score: 60, first_seen_at: '2026-10-01T00:00:00Z', status: 'firma_dogrulandi' }),
    opp({ id: 'c', title: 'Kapalı', city: 'Ankara', is_ankara: true, status: 'ilgisiz' }),
  ],
  oppCategories: [
    { id: 'k1', opportunity_id: 'b', category_key: 'yangin_kapisi', need_status: 'dogrulanmis', matched_terms: [], evidence_item_id: null },
    { id: 'k2', opportunity_id: 'a', category_key: 'pvc_dograma', need_status: 'potansiyel', matched_terms: [], evidence_item_id: null },
  ],
  companies: [{ id: 'co', name: 'Sentetik Yapı A.Ş.', normalized_name: 'x', website: null, website_verified: false, website_source: null, crm_company_id: null, notes: null, version: 1 }],
  oppCompanies: [{ id: 'l', opportunity_id: 'b', company_id: 'co', role: 'ana_yuklenici', verified: false, evidence_item_id: null }],
  contacts: [{ id: 'ct', company_id: 'co', kind: 'satinalma_eposta', value: 'satinalma@sentetik.test', source_url: 'https://sentetik.test/iletisim', verified_at: '2026-10-21T00:00:00Z' }],
}

describe('radar arayüz mantığı', () => {
  const views = buildViews(data)
  it('Ankara önce sıralama; kapalı fırsatlar varsayılan süzgeçte gizli', () => {
    const list = sortAnkaraFirst(applyFilters(views, DEFAULT_FILTERS))
    expect(list.map((v) => v.opp.id)).toEqual(['a', 'b'])
  })
  it('süzgeçler: şehir, kategori, doğrulama, puan, son tarih, kaynak türü, sektör, durum', () => {
    const f = (p: Partial<typeof DEFAULT_FILTERS>) => applyFilters(views, { ...DEFAULT_FILTERS, ...p }).map((v) => v.opp.id).sort()
    expect(f({ city: 'İzmir' })).toEqual(['b'])
    expect(f({ district: 'Etimesgut' })).toEqual(['a'])
    expect(f({ category: 'pvc_dograma' })).toEqual(['a'])
    expect(f({ verification: 'dogrulanmis' })).toEqual(['b'])
    expect(f({ verification: 'potansiyel' })).toEqual(['a'])
    expect(f({ minScore: 70 })).toEqual(['b'])
    expect(f({ deadlineFrom: '2026-10-25', deadlineTo: '2026-11-01' })).toEqual(['b'])
    expect(f({ sourceKind: 'search_api' })).toEqual(['b'])
    expect(f({ sector: 'kamu' })).toEqual(['b'])
    expect(f({ status: 'ilgisiz' })).toEqual(['c'])
    expect(f({ q: 'sentetik yapı' })).toEqual(['b'])
  })
  it('göstergeler', () => {
    const k = kpis(views, NOW, 75)
    expect(k).toEqual({ todayNew: 1, ankara: 1, turkey: 2, highPriority: 1, deadlineSoon: 1, awaitingContact: 1, updated24h: 2, unverified: 1 })
  })
  it('eksik bilgi, risk ve strateji önerisi veriden üretilir (uydurma yok)', () => {
    const b = views.find((v) => v.opp.id === 'b')!
    const a = views.find((v) => v.opp.id === 'a')!
    expect(missingInfo(b)).toContain('Miktar / metraj kaynakta yok (bilinmiyor)')
    expect(missingInfo(a)).toContain('İş kapsamı kaynakla doğrulanmadı (yalnız potansiyel ihtiyaç)')
    expect(risks(a, '2026-10-22').map((r) => r.code)).toEqual(expect.arrayContaining(['iletisim_dogrulanmamis', 'kapsam_belirsiz']))
    expect(risks(b, '2026-11-15').map((r) => r.code)).toContain('son_tarih_gecti')
    const s = strategy(b)
    expect(s.whom[0]).toBe('Sentetik Yapı A.Ş. — Ana yüklenici (rol doğrulanmadı)')
    expect(s.channels[0]).toContain('satinalma@sentetik.test')
    expect(s.documents).toContain('Kapı çizelgesi (tip, ölçü, yangın dayanım sınıfı)')
    expect(strategy(a).channels[0]).toContain('Doğrulanmış kanal yok')
    expect(strategy(a).whom[0]).toContain('Firma bilinmiyor')
  })
  it('asistan bağdaştırıcısı ve yetkinlik metni', () => {
    const as = toAssistant(views, data)
    expect(as.find((x) => x.id === 'b')!.companies[0].contacts[0].source_url).toBe('https://sentetik.test/iletisim')
    expect(as.find((x) => x.id === 'a')!.sources[0].url).toBe('https://a.test/1')
    expect(capabilitiesFrom('- Kapı\n\n• Cephe', ['x'])).toEqual(['Kapı', 'Cephe'])
    expect(capabilitiesFrom('', ['x'])).toEqual(['x'])
  })
})
