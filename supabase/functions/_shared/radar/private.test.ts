// 020 — Özel sektör keşfi testleri. Tüm firma/proje/adres verileri SENTETİKTİR (alan adları .test / ornek).
import { describe, expect, it } from 'vitest'
import { assessPage, contractorKind, extractCompanyName, extractUnitCount, sizeBand } from './company.ts'
import { ANKARA_DISTRICTS } from './geo.ts'
import { buildDiscoveryPlan, coverageSummary, coverageUnit, discoveryStatus, diversityMetrics, QUERY_PATTERNS, selectQueries } from './discovery.ts'
import { type DiscoveryConfig, type DiscoveryDb, type DiscoveryPayload, type DiscoveryRunRow, projectListLinks, runDiscovery } from './discoveryRunner.ts'
import { base64Url, buildMime, encodeHeader } from './gmail.ts'
import { buildEmail, checkEligibility, matchServices } from './outreach.ts'
import { processSendQueue, type SendQueue } from './outreachRunner.ts'
import { buildIngestItem } from './pipeline.ts'
import { assessStage, privateScore, segmentsFor, STAGE_UNVERIFIED } from './privateIntel.ts'
import { DEFAULT_WEIGHTS } from './score.ts'
import type { SourceRow } from './runner.ts'

const NOW = new Date('2026-11-16T09:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString()

describe('sorgu planı ve rotasyon', () => {
  const plan = buildDiscoveryPlan()
  it('Ankara’nın 25 ilçesinin tamamı ve ikincil iller planda; kamu "ihalesi" kalıbı yok', () => {
    const districts = new Set(plan.filter((q) => q.city === 'Ankara' && q.district).map((q) => q.district))
    expect(ANKARA_DISTRICTS.every((d) => districts.has(d))).toBe(true)
    expect(districts.size).toBe(25)
    expect(plan.some((q) => q.city === 'Hatay') && plan.some((q) => q.city === 'Kahramanmaraş')).toBe(true)
    expect(plan.some((q) => /ihalesi/.test(q.query))).toBe(false)
    expect(new Set(plan.map((q) => q.key)).size).toBe(plan.length)
    expect(plan.find((q) => q.pattern === 'apartman' && q.district === 'Etimesgut')!.query).toBe('Etimesgut Ankara yeni apartman projesi')
    expect(plan.find((q) => q.pattern === 'pvc_tedarikci')!.query).toBe('Ankara PVC doğrama tedarikçi arayan')
    expect(QUERY_PATTERNS.length).toBeGreaterThanOrEqual(19)
  })

  it('en az aranmış ilçeler önce; aynı çalıştırmada ilçe tekrar etmez; bekleme süresi uygulanır', () => {
    // Çankaya ve Etimesgut çok aranmış; diğerleri hiç
    const states = plan.filter((q) => q.district === 'Çankaya' || q.district === 'Etimesgut').map((q) => ({ key: q.key, runs: 5, newResults: 10, lastRunAt: daysAgo(10) }))
    const picked = selectQueries(plan, states, { count: 6, now: NOW, runIndex: 1 })
    expect(picked).toHaveLength(6)
    expect(picked.some((q) => q.district === 'Çankaya' || q.district === 'Etimesgut')).toBe(false)
    expect(new Set(picked.map(coverageUnit)).size).toBe(6)
    // Son 7 günde çalışan sorgu seçilmez
    const recent = plan.map((q) => ({ key: q.key, runs: 1, newResults: 0, lastRunAt: daysAgo(2) }))
    expect(selectQueries(plan, recent, { count: 4, now: NOW, runIndex: 1 })).toHaveLength(0)
    // İkincil il dönüşü
    expect(selectQueries(plan, [], { count: 3, now: NOW, runIndex: 6 }).some((q) => q.tier === 2)).toBe(true)
    expect(selectQueries(plan, [], { count: 3, now: NOW, runIndex: 5 }).some((q) => q.tier === 2)).toBe(false)
  })

  it('tüm plan tekrar etmeden dolaşılır (25 ilçe kısa sürede kapsanır)', () => {
    const states: { key: string; runs: number; newResults: number; lastRunAt: string | null }[] = []
    const seen = new Set<string>()
    for (let run = 1; run <= 33; run++) {
      for (const q of selectQueries(plan, states, { count: 1, now: NOW, runIndex: run })) {
        states.push({ key: q.key, runs: 1, newResults: 0, lastRunAt: daysAgo(30) })
        if (q.district && q.city === 'Ankara') seen.add(q.district)
      }
    }
    expect(seen.size).toBe(25)
  })

  it('kapsam ve çeşitlilik ölçütleri', () => {
    const c = coverageSummary([{ city: 'Ankara', district: 'Sincan', queries30d: 3, results30d: 9, companies: 1, activeProjects: 1, lastSearchedAt: null }])
    expect(c.ankaraDistrictsSearched).toBe(1)
    expect(c.neglected).toContain('Bala')
    const d = diversityMetrics(['a.test', 'a.test', 'a.test', 'b.test', 'c.test', 'd.test'])
    expect(d.distinctDomains).toBe(4)
    expect(d.top3Share).toBeCloseTo(0.83, 2)
  })

  it('dürüst durum: anahtar yok / kaynak yok / kota / başarısız / eksik / yeni yok', () => {
    const b = { planned: 2, executed: 2, failed: 0, quotaStopped: false, budgetStopped: false, newRecords: 0 }
    expect(discoveryStatus({ ...b, configured: 'kaynak_yok' })).toBe('kaynak_yok')
    expect(discoveryStatus({ ...b, configured: 'yapilandirma_eksik' })).toBe('yapilandirma_eksik')
    expect(discoveryStatus({ ...b, configured: 'yapilandirma_eksik', companyPagesChecked: 3 })).toBe('eksik')
    expect(discoveryStatus({ ...b, configured: 'ok', executed: 0, quotaStopped: true })).toBe('kota_doldu')
    expect(discoveryStatus({ ...b, configured: 'ok', executed: 0, failed: 2 })).toBe('basarisiz')
    expect(discoveryStatus({ ...b, configured: 'ok', failed: 1 })).toBe('eksik')
    expect(discoveryStatus({ ...b, configured: 'ok' })).toBe('basarili_yeni_yok')
    expect(discoveryStatus({ ...b, configured: 'ok', newRecords: 3 })).toBe('basarili')
  })
})

describe('sayfa, firma ve ölçek', () => {
  it('sayfa türü ve kamu/özel', () => {
    expect(assessPage('https://www.ankara.bel.tr/ihale/1', 'İhale', '').kind).toBe('kamu')
    expect(assessPage('https://www.sahibinden.com/ilan/x', 'Proje', '').kind).toBe('ilan_portali')
    const f = assessPage('https://www.ornekyapi.test/projelerimiz/', 'Projelerimiz | Örnek Yapı İnşaat', 'Devam eden projeler')
    expect(f.kind).toBe('firma_proje_sayfasi')
    expect(f.sector).toBe('ozel')
    expect(f.companyWebsite).toBe('https://www.ornekyapi.test')
    expect(assessPage('https://blog.ornek.test/yazi', 'Tatil önerileri', 'deniz').kind).toBe('diger')
  })

  it('firma adı yalnız metinden; yoksa alan adı açıkça işaretlenir', () => {
    expect(extractCompanyName('Projelerimiz | Kaya Yapı İnşaat Ltd. Şti.', '', 'kayayapi.test')).toEqual({ name: 'Kaya Yapı İnşaat Ltd. Şti.', basis: 'metin' })
    expect(extractCompanyName('Yeni projemiz', 'Gülpınar Konut Yapı Kooperatifi üyeleri', null)!.name).toBe('Gülpınar Konut Yapı Kooperatifi')
    expect(extractCompanyName('Devam eden projeler', 'Sincan 12 daire', 'ornekinsaat.test')).toEqual({ name: 'ornekinsaat.test', basis: 'alan_adi' })
  })

  it('daire sayısı ve ölçek bandı (küçük yükleniciler ayrı band, öne alınmaz)', () => {
    expect(extractUnitCount('Sincan’da 8 daireli apartman')).toMatchObject({ count: 8, unit: 'daire' })
    expect(sizeBand(extractUnitCount('8 daireli'))).toBe('kucuk')
    expect(sizeBand(extractUnitCount('24 daire'))).toBe('yerel')
    expect(sizeBand(extractUnitCount('64 konutluk'))).toBe('orta')
    expect(sizeBand(extractUnitCount('1.250 konut'))).toBe('buyuk')
    expect(sizeBand(extractUnitCount('12 villa'))).toBe('yerel')
    expect(extractUnitCount('2026 yılında')).toBeNull()
    expect(contractorKind('Gülpınar Konut Yapı Kooperatifi', '')).toBe('kooperatif')
    expect(contractorKind(null, 'riskli yapı kentsel dönüşüm projesi')).toBe('kentsel_donusum')
  })
})

describe('kanıtlı aşama', () => {
  it('aşama yoksa "Aşama doğrulanamadı"; tarihsiz veya eski kanıtla aktif sayılmaz', () => {
    expect(assessStage({ stage: null, stageTerms: [] }, daysAgo(3), NOW).display).toBe(STAGE_UNVERIFIED)
    const undated = assessStage({ stage: 'kaba_insaat', stageTerms: ['kaba insaat'] }, null, NOW)
    expect(undated.active).toBeNull()
    expect(undated.display.startsWith(STAGE_UNVERIFIED)).toBe(true)
    const old = assessStage({ stage: 'kaba_insaat', stageTerms: ['kaba insaat'] }, daysAgo(400), NOW)
    expect(old.active).toBe(false)
    expect(old.confidence).toBe('dusuk')
    const fresh = assessStage({ stage: 'kaba_tamam', stageTerms: ['kaba insaat tamamlan'] }, daysAgo(20), NOW)
    expect(fresh).toMatchObject({ active: true, confidence: 'yuksek', newStart: false, display: 'Kaba inşaat tamamlandı' })
    expect(assessStage({ stage: 'temel_atma', stageTerms: ['temeli atildi'] }, daysAgo(10), NOW).newStart).toBe(true)
  })
})

describe('şeffaf puan ve bölümler', () => {
  const settings = { weights: DEFAULT_WEIGHTS, activeCategories: null, extraKeywords: {} }
  const src = { id: 's', kind: 'search_api' as const, sectorHint: null, permission: 'izinli' as const }

  it('aktif özel apartman projesi, kamu ihalesinden geri kalmaz; küçük yüklenici büyükten düşük puan almaz', async () => {
    const priv = await buildIngestItem({ url: 'https://ornekyapi.test/proje/1', title: 'Etimesgut Eryaman 24 daireli konut projemizin kaba inşaatı tamamlandı', body: 'Örnek Yapı İnşaat Ltd. Şti. Etimesgut projesi.', publishedAt: daysAgo(12) }, src, settings, [], NOW)
    const intel = priv!.classification.intel!
    const stage = assessStage(intel, daysAgo(12), NOW)
    const base = { products: intel.products, stage, city: 'Ankara', district: 'Etimesgut', isAnkara: true, verifiedNeed: false, supplierInvite: false }
    const small = privateScore({ ...base, size: 'kucuk' })
    const large = privateScore({ ...base, size: 'buyuk' })
    expect(small.score).toBeGreaterThanOrEqual(large.score)
    expect(small.score).toBeGreaterThanOrEqual(60)
    // 0.16.0 puanı aynı kayıt için 60 eşiğinin altındaydı
    expect(priv!.score).toBeLessThan(60)
    expect(small.parts.find((p) => p.key === 'talep')!.reason).toMatch(/potansiyel/)
    expect(small.parts.reduce((a, p) => a + p.weight, 0)).toBe(100)
    expect(segmentsFor({ sector: 'ozel', stage, verifiedNeed: false, supplierInvite: false, isProcurement: false, hasCompany: true })).toEqual(['ozel_proje', 'aktif_santiye'])
  })

  it('kamu kaydı yalnız Kamu İhaleleri; doğrulanmış talep Teklif Fırsatları', () => {
    const st = assessStage({ stage: null, stageTerms: [] }, null, NOW)
    expect(segmentsFor({ sector: 'kamu', stage: st, verifiedNeed: true, supplierInvite: false, isProcurement: true, hasCompany: false })).toEqual(['kamu_ihale'])
    expect(segmentsFor({ sector: 'ozel', stage: st, verifiedNeed: false, supplierInvite: true, isProcurement: false, hasCompany: true })).toEqual(['ozel_proje', 'teklif_firsati'])
    expect(segmentsFor({ sector: 'bilinmiyor', stage: st, verifiedNeed: false, supplierInvite: false, isProcurement: false, hasCompany: false })).toEqual([])
  })
})

describe('Türkçe e-posta ve gönderim uygunluğu', () => {
  it('konut → PVC/alüminyum + çelik/iç/yangın kapısı; ticari → cephe + fotoselli; ileri aşamada kapılar', () => {
    const r = matchServices('konut', 'kaba_tamam')
    expect(r.services).toEqual(expect.arrayContaining(['pvc_dograma', 'aluminyum_dograma', 'celik_kapi', 'oda_kapisi', 'yangin_kapisi']))
    expect(r.brands.sort()).toEqual(['erlin_kapi', 'leonx_metal'])
    const c = matchServices('is_merkezi', 'kaba_insaat')
    expect(c.services).toEqual(expect.arrayContaining(['aluminyum_cephe', 'giydirme_cephe', 'fotoselli_kapi', 'yangin_kapisi']))
    const late = matchServices('konut', 'ince_isler')
    expect(late.services).not.toContain('pvc_dograma')
    expect(late.brands).toEqual(['erlin_kapi'])
  })

  it('e-posta proje uydurmaz, talep iddia etmez, siteleri ve listeden çıkma yolunu içerir', () => {
    const m = buildEmail({ companyName: 'Örnek Yapı İnşaat', companyNameVerified: true, projectLabel: 'Eryaman 24 daireli konut', district: 'Etimesgut', city: 'Ankara', stage: 'kaba_tamam', stageVerified: true, evidenceUrl: 'https://ornekyapi.test/proje/1', verifiedRequest: false, match: matchServices('konut', 'kaba_tamam') })
    expect(m.body).toContain('Sayın Örnek Yapı İnşaat Yetkilisi')
    expect(m.body).toContain('https://www.leonxmetal.com')
    expect(m.body).toContain('https://www.erlinkapi.com.tr')
    expect(m.body).toContain('info@erlinkapi.tr')
    expect(m.body).toMatch(/metraj/)
    expect(m.body).toMatch(/LİSTEDEN ÇIKAR/)
    expect(m.body).not.toMatch(/talebiniz|teklif istediğiniz|tedarikçi teklifi toplandığını/)
    const anon = buildEmail({ companyName: 'ornek.test', companyNameVerified: false, projectLabel: null, district: null, city: null, stage: null, stageVerified: false, evidenceUrl: null, verifiedRequest: false, match: matchServices('villa', null) })
    expect(anon.body.startsWith('Sayın Yetkili,')).toBe(true)
    expect(anon.body).not.toContain('projenizle ilgili')
  })

  it('denetimler geçmeden gönderilmez', () => {
    const base = { autoSendEnabled: true, gmailVerifiedAt: daysAgo(1), legalConfirmedAt: daysAgo(1), recipient: { email: 'satinalma@ornekyapi.test', kind: 'satinalma_eposta', verifiedAt: daysAgo(5), sourceUrl: 'https://ornekyapi.test/iletisim' }, companyWebsite: 'https://www.ornekyapi.test', suppressed: false, sentToday: 0, dailyLimit: 10, lastEmailDays: null, hasEvidence: true, sector: 'ozel' as const, companyExcluded: false, approved: true, now: NOW }
    expect(checkEligibility(base)).toEqual({ eligible: true, reasons: [] })
    expect(checkEligibility({ ...base, autoSendEnabled: false }).reasons).toContain('otomatik_gonderim_kapali')
    expect(checkEligibility({ ...base, gmailVerifiedAt: null }).reasons).toContain('gmail_dogrulanmadi')
    expect(checkEligibility({ ...base, recipient: { ...base.recipient, email: 'ahmet.yilmaz@ornekyapi.test' } }).reasons).toContain('kisisel_eposta')
    expect(checkEligibility({ ...base, recipient: { ...base.recipient, email: 'info@baska.test' } }).reasons).toContain('alan_adi_uyusmuyor')
    expect(checkEligibility({ ...base, recipient: { ...base.recipient, verifiedAt: daysAgo(400) } }).reasons).toContain('alici_dogrulanmadi')
    expect(checkEligibility({ ...base, suppressed: true }).reasons).toContain('ret_listesinde')
    expect(checkEligibility({ ...base, sentToday: 10 }).reasons).toContain('gunluk_sinir')
    expect(checkEligibility({ ...base, lastEmailDays: 30 }).reasons).toContain('yakin_zamanda_iletisim')
    expect(checkEligibility({ ...base, sector: 'kamu' }).reasons).toContain('kamu_kurumu')
    expect(checkEligibility({ ...base, approved: false }).reasons).toContain('taslak_onaylanmadi')
  })

  it('acil durdurma kapalıyken onaylı ve uygun taslak bile gönderilmez', async () => {
    const queue: SendQueue = {
      settings: { auto_send: true, gmail_verified_at: daysAgo(1), legal_confirmed_at: daysAgo(1), daily_limit: 10 }, sent_today: 0,
      drafts: [{ id: 'd1', subject: 'Konu', body: 'Gövde', opportunity_id: 'o1', company_id: 'c1', sector: 'ozel', has_evidence: true, company: { website: 'https://ornekyapi.test', excluded: false, opted_out: false }, contact: { email: 'info@ornekyapi.test', kind: 'genel_eposta', verified_at: daysAgo(3), source_url: 'https://ornekyapi.test' }, last_email_days: null, suppressed: false }],
    }
    const sent: string[] = []
    const off = await processSendQueue({ queue, killSwitchOpen: false, send: async (to) => (sent.push(to), { id: 'x' }), record: async () => {}, now: () => NOW })
    expect(off.sent).toBe(0)
    expect(off.held[0].reasons).toContain('acil_durdurma')
    const on = await processSendQueue({ queue, killSwitchOpen: true, send: async (to) => (sent.push(to), { id: 'x' }), record: async () => {}, now: () => NOW })
    expect(on.sent).toBe(1)
    expect(sent).toEqual(['info@ornekyapi.test'])
  })

  it('MIME: Türkçe konu kodlanır, başlık enjeksiyonu reddedilir', () => {
    expect(encodeHeader('Çelik kapı')).toMatch(/^=\?UTF-8\?B\?/)
    expect(() => buildMime({ from: 'info@erlinkapi.tr', to: 'a@b.test\r\nBcc: x@y.test', subject: 's', body: 'b' })).toThrow()
    const mime = buildMime({ from: 'info@erlinkapi.tr', to: 'info@ornek.test', subject: 'Teklif', body: 'Merhaba' })
    expect(mime).toContain('Content-Type: text/plain; charset=UTF-8')
    expect(base64Url('?>')).not.toMatch(/[+/=]/)
  })
})

// ------------------------------------------------------------------ uçtan uca keşif (sahte veritabanı + sahte arama API)

function source(o: Partial<SourceRow> = {}): SourceRow {
  return { id: 'src-ozel', name: 'Özel sektör keşfi', kind: 'search_api', url: null, allowed_hosts: [], sector_hint: 'ozel', permission_status: 'izinli', max_items: 10, etag: null, last_modified: null, active: true, ...o }
}

function fakeDb(cfg: Partial<DiscoveryConfig['settings']>, src: SourceRow | null, budget = 5) {
  const saved: DiscoveryPayload[] = []
  const runs: DiscoveryRunRow[] = []
  const ingested: unknown[] = []
  const db: DiscoveryDb = {
    config: async () => ({ source: src, settings: { discovery_enabled: true, search_api_enabled: true, queries_per_run: 2, company_monitoring_enabled: false, company_pages_per_run: 0, outreach_min_score: 55, excluded_companies: [], ...cfg }, run_index: 1, quota: null }),
    settingsForPipeline: async () => ({ weights: DEFAULT_WEIGHTS, activeCategories: null, extraKeywords: {} }),
    clusters: async () => [],
    queryStates: async () => [],
    recentlySeen: async () => new Set(),
    reserveSearch: async () => (budget-- > 0 ? { granted: true, reason: null, cursor: 0 } : { granted: false, reason: 'aylık arama bütçesi doldu', cursor: 0 }),
    ingest: async (_s, _r, items) => (ingested.push(...items), { items_new: items.length, items_updated: 0, items_seen: items.length }),
    saveDiscovery: async (p) => (saved.push(p), { companies_new: p.items.filter((i) => i.company).length, companies_found: p.items.filter((i) => i.company).length, projects_new: p.items.length, projects_updated: 0, contacts_verified: 0 }),
    dueCompanies: async () => [],
    outreachCandidates: async () => [],
    saveDrafts: async () => 0,
    saveRun: async (r) => void runs.push(r),
    quota: async () => ({ month_used: 3, month_limit: 900, month_remaining: 897, day_used: 3, day_limit: 30 }),
  }
  return { db, saved, runs, ingested }
}

const tavilyBody = JSON.stringify({ results: [
  { title: 'Projelerimiz | Örnek Yapı İnşaat Ltd. Şti.', url: 'https://www.ornekyapi.test/projelerimiz/', content: 'Sincan Fatih Mahallesi 12 daireli apartman projemizin kaba inşaatı devam ediyor.', published_date: daysAgo(15) },
  { title: 'Ankara Büyükşehir yangın kapısı ihalesi', url: 'https://www.ankara.bel.tr/ihale/9', content: 'Hizmet binası için 40 adet yangın kapısı alımı ihalesi. İKN 2026/111111', published_date: daysAgo(3) },
  { title: 'Hava durumu', url: 'https://haber.ornek.test/hava', content: 'Yarın yağmur bekleniyor', published_date: daysAgo(1) },
] })

function netDeps(db: DiscoveryDb, status = 200, key: string | null = 'anahtar') {
  const calls: string[] = []
  return {
    calls,
    d: { db, now: () => NOW, uuid: () => '00000000-0000-4000-8000-000000000001', tavilyKey: key,
      fetch: async (url: string) => (calls.push(url), new Response(status === 200 ? tavilyBody : '{}', { status, headers: { 'content-type': 'application/json' } })) },
  }
}

describe('runDiscovery', () => {
  it('kaynak İzinli değilse arama yapmaz ve "kaynak_yok" kaydeder (sahte başarı yok)', async () => {
    const f = fakeDb({}, source({ permission_status: 'inceleniyor', active: false }))
    const n = netDeps(f.db)
    const r = await runDiscovery(n.d)
    expect(r.status).toBe('kaynak_yok')
    expect(n.calls).toHaveLength(0)
    expect(f.runs).toHaveLength(1)
    expect(r.note).toMatch(/İzinli/)
  })

  it('anahtar yoksa "yapilandirma_eksik"', async () => {
    const f = fakeDb({}, source())
    const r = await runDiscovery(netDeps(f.db, 200, null).d)
    expect(r.status).toBe('yapilandirma_eksik')
    expect(r.note).toMatch(/TAVILY_API_KEY/)
  })

  it('başarılı keşif: özel firma projesi firma diziniyle, kamu ilanı Kamu İhaleleri kanalında, ilgisiz sonuç ret', async () => {
    const f = fakeDb({}, source())
    const n = netDeps(f.db)
    const r = await runDiscovery(n.d)
    expect(n.calls.every((u) => u === 'https://api.tavily.com/search')).toBe(true)
    expect(r.status).toBe('basarili')
    expect(r.api_calls).toBe(2)
    expect(r.query_log).toHaveLength(2)
    expect(r.quota_remaining).toBe(897)
    const items = f.saved.flatMap((p) => p.items)
    const firm = items.find((i) => i.page_kind === 'firma_proje_sayfasi')!
    expect(firm.company).toMatchObject({ name: 'Örnek Yapı İnşaat Ltd. Şti.', name_basis: 'metin', website: 'https://www.ornekyapi.test', size_band: 'yerel' })
    expect(firm.segments).toContain('ozel_proje')
    expect(firm.segments).toContain('aktif_santiye')
    expect(firm.stage_evidence_at).toBe(daysAgo(15))
    const pub = items.find((i) => i.page_kind === 'kamu')!
    expect(pub.segments).toEqual(['kamu_ihale'])
    expect(pub.company).toBeNull()
    expect(r.results_rejected).toBeGreaterThan(0)
    expect(f.saved[0].seen.some((s) => s.outcome === 'ret')).toBe(true)
  })

  it('arama API hatası → "basarisiz"; kota ilk sorguda doluysa → "kota_doldu"', async () => {
    const f1 = fakeDb({}, source())
    expect((await runDiscovery(netDeps(f1.db, 500).d)).status).toBe('basarisiz')
    const f2 = fakeDb({}, source(), 0)
    const r2 = await runDiscovery(netDeps(f2.db).d)
    expect(r2.status).toBe('kota_doldu')
    expect(r2.api_calls).toBe(0)
  })
})

describe('firma sitesi', () => {
  it('ana sayfadan proje listesi bağlantıları (aynı ana makine, "devam eden" önce)', () => {
    const html = '<a href="/tamamlanan-projeler">Tamamlanan Projeler</a><a href="/devam-eden-projeler">Devam Eden Projeler</a><a href="https://baska.test/projeler">Projeler</a><a href="/iletisim">İletişim</a>'
    expect(projectListLinks(html, 'https://ornekyapi.test/', ['ornekyapi.test'])).toEqual(['https://ornekyapi.test/devam-eden-projeler', 'https://ornekyapi.test/tamamlanan-projeler'])
  })
})
