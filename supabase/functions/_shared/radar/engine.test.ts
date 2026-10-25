import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NEWS_COMPLETED_SCHOOL, NEWS_HOSPITAL_CONSTRUCTION, NEWS_HOSPITAL_SECOND_SOURCE, NOW, TENDER_FIRE_DOOR_ETIMESGUT } from './__fixtures__/synthetic_items.ts'
import { answer, type AssistantOpportunity, draftEmail, NOT_FOUND } from './assistant.ts'
import { classify } from './classify.ts'
import { extractContacts, looksPersonal, normalizePhone, siteDomain } from './contacts.ts'
import { assignCluster, clusterTokens, jaccard, seenState } from './dedupe.ts'
import { buildIngestItem, type IngestItem, type PipelineSettings, type SourceContext } from './pipeline.ts'
import { htmlToText } from './sanitize.ts'
import { corroborationPoints, DEFAULT_WEIGHTS, labelFor, normalizeWeights, reliability, scoreOpportunity } from './score.ts'
import { buildQueries, parseTavilyResponse, querySlice } from './tavily.ts'

const fx = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf-8')
const cls = (x: { title: string; body: string }) => classify({ title: x.title, summary: htmlToText(x.body), sourceKind: 'rss', now: NOW })
const settings: PipelineSettings = { weights: DEFAULT_WEIGHTS, activeCategories: null, extraKeywords: {} }
const rss: SourceContext = { id: 's1', kind: 'rss', sectorHint: 'kamu', permission: 'izinli' }

describe('score', () => {
  it('ağırlıklar normalleştirilir; geçersiz → varsayılan', () => {
    const w = normalizeWeights({ kategori: 50, dogrulama: 50, asama: 0, yakinlik: -5, iletisim: 'x', ticari: 0 })
    expect(w.kategori).toBe(50)
    expect(w.yakinlik).toBe(0)
    expect(normalizeWeights({})).toEqual(DEFAULT_WEIGHTS)
    const s = normalizeWeights({ kategori: 1, dogrulama: 1, asama: 1, yakinlik: 1, iletisim: 1, ticari: 1 })
    expect(Object.values(s).reduce((a, b) => a + b, 0)).toBeCloseTo(100)
  })
  it('doğrulanmış ihale yüksek; haber potansiyel; tamamlanmış düşük', () => {
    const t = scoreOpportunity(cls(TENDER_FIRE_DOOR_ETIMESGUT), { publishedAt: TENDER_FIRE_DOOR_ETIMESGUT.publishedAt, now: NOW })
    const n = scoreOpportunity(cls(NEWS_HOSPITAL_CONSTRUCTION), { publishedAt: NEWS_HOSPITAL_CONSTRUCTION.publishedAt, now: NOW })
    const d = scoreOpportunity(cls(NEWS_COMPLETED_SCHOOL), { publishedAt: NEWS_COMPLETED_SCHOOL.publishedAt, now: NOW })
    expect(t.verifiedNeed).toBe(true)
    expect(t.label).toBe('dogrulanmis_firsat')
    expect(t.score).toBeGreaterThanOrEqual(80)
    expect(n.verifiedNeed).toBe(false)
    expect(n.label).toBe('potansiyel_ihtiyac')
    expect(n.score).toBeLessThan(t.score)
    expect(d.score).toBeLessThan(n.score)
    expect(t.parts.map((p) => p.key)).toEqual(['kategori', 'dogrulama', 'asama', 'yakinlik', 'iletisim', 'ticari'])
    expect(t.parts.find((p) => p.key === 'yakinlik')!.reason).toContain('Etimesgut')
  })
  it('KURAL: doğrulanmış ihtiyaç yoksa en yüksek puan bile "Doğrulanmış iş fırsatı" değildir', () => {
    const c = cls(NEWS_HOSPITAL_CONSTRUCTION)
    const allIn = scoreOpportunity(c, { publishedAt: NEWS_HOSPITAL_CONSTRUCTION.publishedAt, now: NOW, verifiedContacts: { strong: 3, any: 3 } }, { kategori: 0, dogrulama: 0, asama: 0, yakinlik: 100, iletisim: 0, ticari: 0 })
    expect(allIn.score).toBe(100)
    expect(allIn.label).not.toBe('dogrulanmis_firsat')
    expect(labelFor(false, true)).toBe('potansiyel_ihtiyac')
  })
  it('güvenilirlik fırsat puanından ayrıdır; çoklu kaynak teyidi', () => {
    const base = { sourceKind: 'rss' as const, sectorHint: 'kamu' as const, permission: 'izinli' as const, publishedAt: '2026-10-20T00:00:00Z', now: NOW }
    const one = reliability({ ...base, distinctSources: 1 })
    const three = reliability({ ...base, distinctSources: 3 })
    expect(one.score).toBe(75)
    expect(three.score).toBe(100)
    expect(reliability({ ...base, sourceKind: 'search_api', sectorHint: null, distinctSources: 1 }).score).toBeLessThan(one.score)
    expect(reliability({ ...base, publishedAt: null, distinctSources: 1 }).score).toBe(50)
    expect([1, 2, 3, 7].map(corroborationPoints)).toEqual([0, 15, 25, 25])
  })
})

describe('dedupe ve kümeleme', () => {
  it('aynı öğe iki kez → yeni değil; içerik değişince "değişti"', async () => {
    const a = await buildIngestItem({ ...TENDER_FIRE_DOOR_ETIMESGUT, body: TENDER_FIRE_DOOR_ETIMESGUT.body }, rss, settings, [], NOW)
    const b = await buildIngestItem({ ...TENDER_FIRE_DOOR_ETIMESGUT, url: 'https://ilan.ornek.test/ilanlar/2026-123456#x' }, rss, settings, [], NOW)
    expect(a!.url_hash).toBe(b!.url_hash) // utm ve parça farkı aynı kimlik
    expect(seenState({ contentHash: a!.content_hash }, { contentHash: b!.content_hash })).toBe('ayni')
    expect(seenState(null, { contentHash: 'x' })).toBe('yeni')
    expect(seenState({ contentHash: 'x' }, { contentHash: 'y' })).toBe('degisti')
  })
  it('iki kaynak aynı proje → tek küme (iki kanıt)', async () => {
    const clusters: { clusterKey: string; tokens: string[]; city: string | null }[] = []
    const a = (await buildIngestItem(NEWS_HOSPITAL_CONSTRUCTION, rss, settings, clusters, NOW))!
    clusters.push({ clusterKey: a.cluster_key, tokens: a.cluster_tokens, city: a.city })
    const b = (await buildIngestItem(NEWS_HOSPITAL_SECOND_SOURCE, { ...rss, id: 's2' }, settings, clusters, NOW))!
    expect(b.cluster_key).toBe(a.cluster_key)
    expect(b.url_hash).not.toBe(a.url_hash)
    const other = (await buildIngestItem(TENDER_FIRE_DOOR_ETIMESGUT, rss, settings, clusters, NOW))!
    expect(other.cluster_key).not.toBe(a.cluster_key)
  })
  it('farklı şehir aynı başlık birleşmez; Jaccard', async () => {
    expect(jaccard(['a', 'b'], ['a', 'b'])).toBe(1)
    expect(jaccard(['a'], ['b'])).toBe(0)
    const t = clusterTokens('Yeni hastane inşaatı sürüyor', 'İzmir')
    const r = await assignCluster('Yeni hastane inşaatı sürüyor', 'İzmir', [{ clusterKey: 'ankara:x', tokens: t, city: 'Ankara' }])
    expect(r.matched).toBe(false)
  })
  it('kanıt satırları: her iddia alıntı ve alanla; potansiyel açıkça yazılır', async () => {
    const it1 = (await buildIngestItem(NEWS_HOSPITAL_CONSTRUCTION, rss, settings, [], NOW)) as IngestItem
    expect(it1.evidence.every((e) => e.excerpt.length <= 500 && e.claim.length <= 500)).toBe(true)
    expect(it1.evidence.some((e) => e.field === 'potansiyel' && e.claim.includes('potansiyel'))).toBe(true)
    expect(it1.evidence.some((e) => e.field === 'ihtiyac')).toBe(false)
    expect(it1.companies.find((c) => c.role === 'ana_yuklenici')).toBeDefined()
    const t = (await buildIngestItem(TENDER_FIRE_DOOR_ETIMESGUT, rss, settings, [], NOW)) as IngestItem
    expect(t.evidence.find((e) => e.field === 'ihtiyac')!.excerpt.toLocaleLowerCase('tr-TR')).toContain('yangın kapısı')
    expect(t.evidence.find((e) => e.field === 'son_tarih')!.claim).toContain('12.11.2026')
    expect(t.summary).not.toContain('<p>')
  })
})

describe('contacts (sentetik firma sitesi)', () => {
  const html = fx('synthetic_company_site.html')
  const r = extractContacts(html, 'https://ornekyapi.test/iletisim', 'https://www.ornekyapi.test', '2026-10-22T09:00:00.000Z')
  it('yalnız firmanın alan adı; kişisel adlar saklanmaz; İK atlanır', () => {
    const emails = r.contacts.filter((c) => c.kind.endsWith('eposta')).map((c) => [c.kind, c.value])
    expect(emails).toEqual([
      ['genel_eposta', 'info@ornekyapi.test'],
      ['satinalma_eposta', 'satinalma@ornekyapi.test'],
      ['teknik_ofis_eposta', 'teknik@proje.ornekyapi.test'],
    ])
    expect(r.skippedPersonal).toBe(2)
    expect(r.skippedForeignDomain).toBe(1)
    expect(r.skippedIrrelevant).toBe(1)
    expect(r.contacts.some((c) => c.value.includes('gizli'))).toBe(false) // betik içi
  })
  it('telefon, portal, ihale sayfası, form; her kayıt kaynak + zaman taşır', () => {
    expect(r.contacts.filter((c) => c.kind === 'telefon').map((c) => c.value)).toEqual(['+90 312 000 00 00', '444 00 00'])
    expect(r.contacts.find((c) => c.kind === 'tedarikci_portali')?.value).toBe('https://ornekyapi.test/tedarikci-portali')
    expect(r.contacts.find((c) => c.kind === 'ihale_adresi')?.value).toBe('https://ornekyapi.test/ihaleler?x=1')
    expect(r.contacts.some((c) => c.value.includes('baska-portal'))).toBe(false)
    expect(r.contacts.find((c) => c.kind === 'iletisim_formu')?.value).toBe('https://ornekyapi.test/iletisim')
    expect(r.contacts.every((c) => c.source_url === 'https://ornekyapi.test/iletisim' && c.verified_at)).toBe(true)
  })
  it('adres asla üretilmez: sayfada yoksa satın alma e-postası yoktur', () => {
    const none = extractContacts('<p>Bize ulaşın: info@ornekyapi.test</p>', 'https://ornekyapi.test/', 'https://ornekyapi.test', 'x')
    expect(none.contacts.map((c) => c.value)).toEqual(['info@ornekyapi.test'])
    // Başka alan adındaki sayfadan hiçbir şey alınmaz
    expect(extractContacts(html, 'https://baska.test/iletisim', 'https://ornekyapi.test', 'x').contacts).toEqual([])
  })
  it('yardımcılar', () => {
    expect(siteDomain('https://www.firma.com.tr/x')).toBe('firma.com.tr')
    expect(siteDomain('https://alt.firma.com/x')).toBe('firma.com')
    expect(looksPersonal('ahmet.yilmaz')).toBe(true)
    expect(looksPersonal('a.yilmaz')).toBe(true)
    expect(looksPersonal('ahmetyilmaz')).toBe(true)
    expect(looksPersonal('satinalma')).toBe(false)
    expect(looksPersonal('info.ankara')).toBe(false)
    expect(normalizePhone('0 (312) 123 45 67')).toBe('+90 312 123 45 67')
    expect(normalizePhone('12345')).toBeNull()
  })
})

describe('tavily (sentetik kayıtlı yanıt)', () => {
  it('yanıt doğrulama: yalnız https, boş/bozuk kayıt atlanır', () => {
    const r = parseTavilyResponse(JSON.parse(fx('synthetic_tavily_response.json')))
    expect(r.map((x) => x.url)).toEqual(['https://haber.ornek.test/sincan-okul-yangin-kapisi', 'https://haber.ornek.test/golbasi-hastane'])
    expect(r[0].publishedAt).toBe('2026-10-19T00:00:00.000Z')
    expect(r[1].publishedAt).toBeNull()
  })
  it('özet tek başına ilan değilse ihtiyaç doğrulanmaz; ilan özeti ürünü adlandırıyorsa doğrulanır', async () => {
    const [a, b] = parseTavilyResponse(JSON.parse(fx('synthetic_tavily_response.json')))
    const src: SourceContext = { id: 't', kind: 'search_api', sectorHint: null, permission: 'izinli' }
    const ia = (await buildIngestItem({ url: a.url, title: a.title, body: a.content, publishedAt: a.publishedAt }, src, settings, [], NOW))!
    const ib = (await buildIngestItem({ url: b.url, title: b.title, body: b.content, publishedAt: b.publishedAt }, src, settings, [], NOW))!
    expect(ia.verified_need).toBe(true)
    expect(ib.verified_need).toBe(false)
    expect(ib.reliability_base).toBeLessThan(40)
  })
  it('sorgular Ankara öncelikli ve döngüsel dilimlenir', () => {
    const q = buildQueries(['yangin_kapisi', 'aluminyum_dograma'])
    expect(q[0]).toBe('Ankara yangın kapısı ihalesi')
    expect(q).toContain('Etimesgut hastane projesi alüminyum doğrama')
    expect(q.findIndex((x) => x.startsWith('İstanbul'))).toBeGreaterThan(q.findIndex((x) => x.startsWith('Etimesgut')))
    expect(querySlice(['a', 'b', 'c'], 2, 2)).toEqual(['c', 'a'])
  })
})

describe('assistant', () => {
  const now = NOW
  const ctx = { now, capabilities: ['Alüminyum ve PVC doğrama', 'Çelik ve yangın kapısı'], companyName: 'LEONX METAL', website: 'https://www.leonxmetal.com' }
  const base: AssistantOpportunity = {
    id: 'aaaaaaaa-0000-4000-8000-000000000001', title: 'Etimesgut hizmet binası yangın kapısı alımı', city: 'Ankara', district: 'Etimesgut', is_ankara: true, sector: 'kamu', stage: 'ihale',
    score: 88, reliability: 75, verified_need: true, deadline: '2026-10-24', first_seen_at: '2026-10-21T08:00:00Z', last_updated_at: '2026-10-21T08:00:00Z', status: 'yeni', tender: { ikn: '2026/123456' },
    categories: [{ key: 'yangin_kapisi', need_status: 'dogrulanmis' }],
    companies: [{ name: 'Etimesgut Belediyesi', role: 'proje_sahibi', verified: false, website: null, contacts: [] }],
    sources: [{ url: 'https://ilan.ornek.test/1', published_at: '2026-10-20T00:00:00Z', accessed_at: '2026-10-21T08:00:00Z' }],
  }
  const hosp: AssistantOpportunity = {
    ...base, id: 'bbbbbbbb-0000-4000-8000-000000000002', title: 'İzmir Bornova hastane inşaatı', city: 'İzmir', district: null, is_ankara: false, sector: 'ozel', stage: 'yapim', score: 45, reliability: 50,
    verified_need: false, deadline: null, first_seen_at: '2026-09-01T00:00:00Z', tender: null, categories: [{ key: 'aluminyum_dograma', need_status: 'potansiyel' }],
    companies: [{ name: 'Deneme Yapı A.Ş.', role: 'ana_yuklenici', verified: false, website: 'https://denemeyapi.test', contacts: [{ kind: 'satinalma_eposta', value: 'satinalma@denemeyapi.test', source_url: 'https://denemeyapi.test/iletisim', verified_at: '2026-10-01T00:00:00Z' }] }],
  }
  const opps = [base, hosp]
  it('şehir / ilçe / kategori / son N gün / en yüksek N / kamu-özel / bu hafta son tarih', () => {
    expect(answer('Ankara fırsatlarını göster', opps, ctx).recordIds).toEqual([base.id])
    expect(answer("Etimesgut'taki işler", opps, ctx).recordIds).toEqual([base.id])
    expect(answer('alüminyum doğrama fırsatları', opps, ctx).recordIds).toEqual([hosp.id])
    expect(answer('son 7 gün', opps, ctx).recordIds).toEqual([base.id])
    expect(answer('en yüksek 1 fırsat', opps, ctx).recordIds).toEqual([base.id])
    expect(answer('özel sektör projeleri', opps, ctx).recordIds).toEqual([hosp.id])
    expect(answer('kamu ihaleleri', opps, ctx).recordIds).toEqual([base.id])
    const w = answer('bu hafta son tarihi olan ihaleler', opps, ctx)
    expect(w.intent).toBe('son_tarih')
    expect(w.recordIds).toEqual([base.id])
  })
  it('ana yüklenici kim; nasıl teklif gönderebilirim (kaynaklı)', () => {
    const a = answer('"Bornova hastane" ana yüklenici kim?', opps, ctx)
    expect(a.text).toContain('Deneme Yapı A.Ş.')
    expect(a.text).toContain('doğrulanmadı')
    expect(answer('"yangın kapısı alımı" ana yüklenici kim?', opps, ctx).text).toBe(NOT_FOUND)
    const h = answer('İzmir Bornova hastane için nasıl teklif gönderebilirim', opps, ctx)
    expect(h.text).toContain('satinalma@denemeyapi.test')
    expect(h.text).toContain('kaynak: https://denemeyapi.test/iletisim')
  })
  it('tanıtım e-postası: şablon, yetkinlikler ayarlardan, referans/sertifika uydurulmaz', () => {
    const e = answer(`#${base.id.slice(0, 8)} için tanıtım e-postası hazırla`, opps, ctx)
    expect(e.intent).toBe('eposta')
    expect(e.draft!.body).toContain('Alüminyum ve PVC doğrama')
    expect(e.draft!.body).toContain('Teknik şartname')
    expect(e.draft!.body).not.toMatch(/referans|sertifika|tamamladığımız|daha önce yaptığımız/i)
    const pot = draftEmail(hosp, ctx)
    expect(pot.body).toContain('tahmindir')
  })
  it('eşleşme yoksa tam olarak "Doğrulanmış sonuç bulunamadı."', () => {
    expect(answer('Trabzon fırsatları', opps, ctx).text).toBe(NOT_FOUND)
    expect(answer('merhaba', opps, ctx).text).toBe(NOT_FOUND)
    expect(answer('Ankara', [], ctx).text).toBe(NOT_FOUND)
    expect(answer('#ffffffff tanıtım e-postası hazırla', opps, ctx).text).toBe(NOT_FOUND)
  })
})
