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

// 016: zamanlanmış özet raporu (SENTETİK)
describe('radar zamanlanmış raporu', () => {
  it('günlük rapor: potansiyel uyarısı, Excel tek sayfa (kaynak sayfası yok)', async () => {
    const { buildDigestReport } = await import('./radarDigest')
    const r = buildDigestReport({
      id: 'r1', kind: 'gunluk', period_start: '2026-10-23', period_end: '2026-10-23', created_at: '2026-10-23T04:30:00Z',
      payload: {
        generated_at: '2026-10-23T04:30:00Z', new_count: 1, updated_count: 0, verified_count: 0,
        top: [{ id: 'o1', title: 'Sentetik konut projesi', city: 'Ankara', district: 'Çankaya', score: 64, label: 'potansiyel_ihtiyac', stage: 'planlama', status: 'yeni', deadline: null, is_new: true }],
        deadlines: [], sources: { active: 2, failing: 1, runs_24h: 24, errors_24h: 3 },
      },
    })
    expect(r.title).toContain('Günlük öncelikli rapor — 23.10.2026')
    const top = r.sections.find((s) => s.key === 'oncelik')!
    expect(top.note).toMatch(/DEĞİLDİR/)
    expect(top.rows[0].label).toBe('[Yeni] Sentetik konut projesi')
    expect(top.rows[0].value).toContain('Ankara / Çankaya')
    expect(r.sections.find((s) => s.key === 'son')!.rows[0].tone).toBe('muted')
    expect(r.sections.find((s) => s.key === 'kaynak')!.rows[1].tone).toBe('warn')
    const files = unzipSync(radarToXlsx(r))
    expect(Object.keys(files).filter((k) => k.startsWith('xl/worksheets/sheet'))).toHaveLength(1)
  })

  it('haftalık özet: hat dağılımı ve hareketsiz takip', async () => {
    const { buildDigestReport } = await import('./radarDigest')
    const r = buildDigestReport({
      id: 'r2', kind: 'haftalik', period_start: '2026-10-17', period_end: '2026-10-23', created_at: '2026-10-23T05:00:00Z',
      payload: { new_count: 3, won: 1, lost: 0, pipeline: { yeni: 3, iletisime_gecildi: 1 }, follow_ups: [{ id: 'o2', title: 'Sentetik takip', city: null, score: 80, status: 'iletisime_gecildi', deadline: null, next_action: 'Arama yap', last_touch: '2026-10-10T00:00:00Z' }], deadlines: [] },
    })
    expect(r.title).toContain('17.10.2026 – 23.10.2026')
    expect(r.sections.find((s) => s.key === 'hat')!.rows.map((x) => x.label)).toEqual(['Yeni', 'İletişime geçildi'])
    const f = r.sections.find((s) => s.key === 'takip')!.rows[0]
    expect(f.value).toContain('konum bilinmiyor')
    expect(f.value).toContain('sonraki aksiyon: Arama yap')
  })
})
