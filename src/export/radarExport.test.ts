import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { EMPTY_RADAR, type RadarOpportunity } from '@/data/radarTypes'
import { buildViews } from '@/radar/view'
import { buildRadarReport, radarFileName } from './radarReport'
import { radarToXlsx } from './radarXlsx'

// SENTETİK test verisi (gerçek fırsat değildir)
const opp = {
  id: 'o1', title: 'Sentetik Etimesgut yangın kapısı alımı', city: 'Ankara', district: 'Etimesgut', is_ankara: true, sector: 'kamu', project_type: null, stage: 'ihale',
  tender: { ikn: '2026/123456' }, deadline: '2026-11-12', score: 88, score_breakdown: [{ key: 'kategori', label: 'Kategori uygunluğu', weight: 25, factor: 1, points: 25, reason: 'ilan' }],
  reliability: 75, reliability_base: 75, reliability_breakdown: [], verified_need: true, label: 'dogrulanmis_firsat', risks: [], status: 'yeni', status_note: null, next_action: null,
  cluster_key: 'k', first_seen_at: '2026-10-22T07:00:00Z', last_updated_at: '2026-10-22T07:00:00Z', crm_company_id: null, project_id: null, notes: null, version: 1,
} as RadarOpportunity

describe('radar raporu', () => {
  const v = buildViews({
    ...EMPTY_RADAR,
    opportunities: [opp],
    oppCategories: [
      { id: 'a', opportunity_id: 'o1', category_key: 'yangin_kapisi', need_status: 'dogrulanmis', matched_terms: ['yangin kapisi'], evidence_item_id: null },
      { id: 'b', opportunity_id: 'o1', category_key: 'aluminyum_dograma', need_status: 'potansiyel', matched_terms: [], evidence_item_id: null },
    ],
  })[0]
  const r = buildRadarReport(v, [{ id: 'e', opportunity_id: 'o1', item_id: null, field: 'ihtiyac', claim: 'İlanda yangın kapısı geçiyor', excerpt: null, url: 'https://ilan.ornek.test/1', published_at: null, accessed_at: '2026-10-22T07:00:00Z' }], [], new Date('2026-10-22T09:00:00Z'))
  it('A–E bölümleri; doğrulanmış ve potansiyel ayrı; strateji "öneri"; bilinmeyen değerler "bilinmiyor"', () => {
    expect(r.sections.map((s) => s.key)).toEqual(['A', 'B', 'C', 'D', 'E'])
    const b = r.sections[1].rows
    expect(b.find((x) => x.label === 'Doğrulanmış kapsam')!.value).toContain('Yangın kapısı')
    expect(b.find((x) => x.label === 'Potansiyel — doğrulanmadı')!.value).toContain('Alüminyum doğrama')
    expect(r.sections[3].note).toContain('ÖNERİ')
    expect(r.sections[0].rows.find((x) => x.label === 'Proje türü')!.value).toBe('bilinmiyor')
    expect(r.sources[0]).toMatchObject({ url: 'https://ilan.ornek.test/1', published: 'bilinmiyor' })
  })
  it('Excel: iki sayfa, kaynak adresi yazılır; dosya adı Türkçe karaktersiz', () => {
    const files = unzipSync(radarToXlsx(r))
    expect(Object.keys(files)).toContain('xl/worksheets/sheet2.xml')
    expect(strFromU8(files['xl/worksheets/sheet2.xml'])).toContain('https://ilan.ornek.test/1')
    expect(radarFileName('Çankaya İş Merkezi — cephe', 'pdf')).toBe('LEONX-Radar-Cankaya-Is-Merkezi-cephe.pdf')
  })
})
