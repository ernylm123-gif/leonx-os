/**
 * 0.14.0 — asistan örnek soruları, öneri kuralı ve iletişim etkeninin taban değeri.
 * Tüm kayıtlar SENTETİKTİR.
 */
import { describe, expect, it } from 'vitest'
import { advise } from './advice.ts'
import { answer, type AssistantOpportunity, missingFields, NEED_REFERENCE, NOT_FOUND } from './assistant.ts'
import type { Classification } from './classify.ts'
import { scoreOpportunity } from './score.ts'

const NOW = new Date('2026-10-25T09:00:00Z')
const ctx = { now: NOW, capabilities: ['Alüminyum ve PVC doğrama', 'Çelik ve yangın kapısı'], companyName: 'LEONX METAL', website: 'https://www.leonxmetal.com' }

const mk = (o: Partial<AssistantOpportunity> & { id: string; title: string }): AssistantOpportunity => ({
  city: 'Ankara', district: null, is_ankara: true, sector: 'kamu', stage: 'ihale', score: 50, reliability: 60, verified_need: false, deadline: null,
  first_seen_at: '2026-10-25T06:00:00Z', last_updated_at: '2026-10-25T06:00:00Z', status: 'yeni', tender: null, categories: [], companies: [], sources: [], ...o,
})

const today = mk({ id: 'a0000000-0000-4000-8000-000000000001', title: 'SENTETİK Çankaya okul yangın kapısı alımı', district: 'Çankaya', score: 82, verified_need: true, deadline: '2026-11-05', tender: { ikn: '2026/1' },
  categories: [{ key: 'yangin_kapisi', need_status: 'dogrulanmis' }],
  companies: [{ name: 'SENTETİK Yapı A.Ş.', role: 'ana_yuklenici', verified: true, website: 'https://sentetik.test', contacts: [{ kind: 'satinalma_eposta', value: 'satinalma@sentetik.test', source_url: 'https://sentetik.test/iletisim', verified_at: '2026-10-24T00:00:00Z' }] }],
  sources: [{ url: 'https://ilan.sentetik.test/1', published_at: '2026-10-24T00:00:00Z', accessed_at: '2026-10-25T06:00:00Z' }] })
const planned = mk({ id: 'b0000000-0000-4000-8000-000000000002', title: 'SENTETİK Etimesgut hastane projesi', district: 'Etimesgut', stage: 'planlama', sector: 'ozel', score: 64,
  first_seen_at: '2026-10-10T00:00:00Z', last_updated_at: '2026-10-22T00:00:00Z',
  categories: [{ key: 'aluminyum_dograma', need_status: 'potansiyel' }, { key: 'yangin_kapisi', need_status: 'potansiyel' }] })
const konya = mk({ id: 'c0000000-0000-4000-8000-000000000003', title: 'SENTETİK Konya AVM cephe', city: 'Konya', is_ankara: false, stage: 'yapim', sector: 'ozel', score: 40,
  first_seen_at: '2026-09-01T00:00:00Z', last_updated_at: '2026-09-01T00:00:00Z', categories: [{ key: 'aluminyum_dograma', need_status: 'potansiyel' }] })
const won = mk({ id: 'd0000000-0000-4000-8000-000000000004', title: 'SENTETİK kazanılmış iş', score: 95, status: 'kazanildi', first_seen_at: '2026-09-01T00:00:00Z', last_updated_at: '2026-09-01T00:00:00Z' })
const opps = [today, planned, konya, won]

describe('asistan — yayın örnek soruları', () => {
  it("Ankara'da bugün hangi yeni işler var?", () => {
    const a = answer("Ankara'da bugün hangi yeni işler var?", opps, ctx)
    expect(a.recordIds).toEqual([today.id])
  })
  it('Henüz ihaleye çıkmamış alüminyum doğrama projeleri hangileri?', () => {
    expect(answer('Henüz ihaleye çıkmamış alüminyum doğrama projeleri hangileri?', opps, ctx).recordIds).toEqual([planned.id, konya.id])
  })
  it('Hangi firmalara teklif göndermeliyim? — yalnız kaynaklı kanal, öneri etiketli', () => {
    const a = answer('Hangi firmalara teklif göndermeliyim?', opps, ctx)
    expect(a.intent).toBe('firma_onerisi')
    expect(a.text).toContain('ÖNERİ (doğrulanmış bilgi değildir')
    expect(a.text).toContain('satinalma@sentetik.test')
    expect(a.text).toContain('kaynak: https://sentetik.test/iletisim')
    expect(a.recordIds).toEqual([today.id])
    expect(answer('Hangi firmalara teklif göndermeliyim?', [planned], ctx).text).toContain('bulunamadı')
  })
  it('Yangın kapısı ihtimali olan yeni projeleri göster.', () => {
    expect(answer('Yangın kapısı ihtimali olan yeni projeleri göster.', opps, ctx).recordIds).toEqual([today.id, planned.id])
  })
  it('Son 7 günde hangi fırsatlar değişti?', () => {
    const a = answer('Son 7 günde hangi fırsatlar değişti?', opps, ctx)
    expect(a.intent).toBe('degisiklik')
    expect(a.recordIds).toEqual([planned.id])
  })
  it('Öncelikli 10 işimi sırala. — kapalı kayıtlar hariç, her satırda öneri', () => {
    const a = answer('Öncelikli 10 işimi sırala.', opps, ctx)
    expect(a.intent).toBe('oncelik')
    expect(a.recordIds).toEqual([today.id, planned.id, konya.id])
    expect(a.text).toContain('Öneri: Hemen iletişime geç')
    expect(a.text).toContain('doğrulanmış bilgi değildir')
  })
  it('Bu proje için hangi bilgiler eksik? — odak gerekir; eksikler "bilinmiyor" olarak listelenir', () => {
    expect(answer('Bu proje için hangi bilgiler eksik?', opps, ctx).text).toBe(NEED_REFERENCE)
    const a = answer('Bu proje için hangi bilgiler eksik?', opps, { ...ctx, focusId: planned.id })
    expect(a.intent).toBe('eksik')
    expect(a.recordIds).toEqual([planned.id])
    expect(a.text).toContain('Ana yüklenici')
    expect(a.text).toContain('Son teklif / başvuru tarihi')
    expect(a.text).toContain('Doğrulanmış iletişim kanalı')
    expect(missingFields(today)).not.toContain('Ana yüklenici')
    expect(missingFields(today)).not.toContain('İhale kayıt numarası (İKN)')
  })
  it('Bu firmaya kurumsal teklif talep mesajı hazırla. — taslak, gönderilmez, uydurma yok', () => {
    expect(answer('Bu firmaya kurumsal teklif talep mesajı hazırla.', opps, ctx).text).toBe(NEED_REFERENCE)
    const a = answer('Bu firmaya kurumsal teklif talep mesajı hazırla.', opps, { ...ctx, focusId: today.id })
    expect(a.intent).toBe('eposta')
    expect(a.text).toContain('otomatik gönderilmez')
    expect(a.draft!.body).toContain('Sayın SENTETİK Yapı A.Ş. yetkilisi')
    expect(a.draft!.body).not.toMatch(/referans|sertifika|tamamladığımız/i)
  })
  it('açıkça verilen ama bulunamayan kayıt odaktaki kayda düşmez', () => {
    expect(answer('"Olmayan proje" için eksik bilgiler', opps, { ...ctx, focusId: today.id }).text).toBe(NOT_FOUND)
  })
})

describe('öneri kuralı (doğrulanmış bilgi değildir)', () => {
  const b = { score: 70, verified_need: true, stage: 'ihale', status: 'yeni', deadline: '2026-11-01', hasContact: true, now: NOW }
  it('beş öneri', () => {
    expect(advise(b).key).toBe('hemen_iletisim')
    expect(advise({ ...b, status: 'teklif_istendi' }).key).toBe('teklif_hazirla')
    expect(advise({ ...b, hasContact: false }).key).toBe('arastir')
    expect(advise({ ...b, status: 'teklif_verildi' }).key).toBe('takip')
    expect(advise({ ...b, deadline: '2026-10-01' }).key).toBe('dusuk')
    expect(advise({ ...b, status: 'ilgisiz' }).key).toBe('dusuk')
    expect(advise({ ...b, score: 20, verified_need: false, hasContact: false }).key).toBe('dusuk')
    expect(advise(b).reason).toContain('7 gün')
  })
})

describe('iletişim etkeni taban değeri (017 yeniden hesaplama ile aynı kural)', () => {
  const c = {
    version: 1, projectType: null, sector: 'kamu', sectorSignals: [], stage: 'ihale', stageTerms: [], isProcurement: true,
    tender: { ikn: '2026/1', deadline: null, deadlineText: null, signals: [] }, categories: [],
    geo: { city: 'Ankara', district: null, isAnkara: true, confidence: 1, matchedText: 'Ankara', others: [] }, organizations: [], risks: [],
  } as unknown as Classification
  it('taban etken kayıtlı; kanal varsa yükselir', () => {
    const none = scoreOpportunity(c, { publishedAt: null, now: NOW }).parts.find((p) => p.key === 'iletisim')!
    expect(none).toMatchObject({ factor: 0.6, base_factor: 0.6, base_reason: 'İlan teklif yolunu tanımlıyor (İKN / son tarih)' })
    const any = scoreOpportunity(c, { publishedAt: null, now: NOW, verifiedContacts: { strong: 0, any: 1 } }).parts.find((p) => p.key === 'iletisim')!
    expect(any).toMatchObject({ factor: 0.7, base_factor: 0.6 })
    const strong = scoreOpportunity(c, { publishedAt: null, now: NOW, verifiedContacts: { strong: 1, any: 1 } }).parts.find((p) => p.key === 'iletisim')!
    expect(strong).toMatchObject({ factor: 1, base_factor: 0.6 })
  })
})
