// 020 â€” Ã–zel sektÃ¶r keÅŸfi testleri. TÃ¼m firma/proje/adres verileri SENTETÄ°KTÄ°R (alan adlarÄ± .test / ornek).
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

describe('sorgu planÄ± ve rotasyon', () => {
  const plan = buildDiscoveryPlan()
  it('Ankaraâ€™nÄ±n 25 ilÃ§esinin tamamÄ± ve ikincil iller planda; kamu "ihalesi" kalÄ±bÄ± yok', () => {
    const districts = new Set(plan.filter((q) => q.city === 'Ankara' && q.district).map((q) => q.district))
    expect(ANKARA_DISTRICTS.every((d) => districts.has(d))).toBe(true)
    expect(districts.size).toBe(25)
    expect(plan.some((q) => q.city === 'Hatay') && plan.some((q) => q.city === 'KahramanmaraÅŸ')).toBe(true)
    expect(plan.some((q) => /ihalesi/.test(q.query))).toBe(false)
    expect(new Set(plan.map((q) => q.key)).size).toBe(plan.length)
    expect(plan.find((q) => q.pattern === 'apartman' && q.district === 'Etimesgut')!.query).toBe('Etimesgut Ankara yeni apartman projesi')
    expect(plan.find((q) => q.pattern === 'pvc_tedarikci')!.query).toBe('Ankara PVC doÄŸrama tedarikÃ§i arayan')
    expect(QUERY_PATTERNS.length).toBeGreaterThanOrEqual(19)
  })

  it('en az aranmÄ±ÅŸ ilÃ§eler Ã¶nce; aynÄ± Ã§alÄ±ÅŸtÄ±rmada ilÃ§e tekrar etmez; bekleme sÃ¼resi uygulanÄ±r', () => {
    // Ã‡ankaya ve Etimesgut Ã§ok aranmÄ±ÅŸ; diÄŸerleri hiÃ§
    const states = plan.filter((q) => q.district === 'Ã‡ankaya' || q.district === 'Etimesgut').map((q) => ({ key: q.key, runs: 5, newResults: 10, lastRunAt: daysAgo(10) }))
    const picked = selectQueries(plan, states, { count: 6, now: NOW, runIndex: 1 })
    expect(picked).toHaveLength(6)
    expect(picked.some((q) => q.district === 'Ã‡ankaya' || q.district === 'Etimesgut')).toBe(false)
    expect(new Set(picked.map(coverageUnit)).size).toBe(6)
    // Son 7 gÃ¼nde Ã§alÄ±ÅŸan sorgu seÃ§ilmez
    const recent = plan.map((q) => ({ key: q.key, runs: 1, newResults: 0, lastRunAt: daysAgo(2) }))
    expect(selectQueries(plan, recent, { count: 4, now: NOW, runIndex: 1 })).toHaveLength(0)
    // Ä°kincil il dÃ¶nÃ¼ÅŸÃ¼
    expect(selectQueries(plan, [], { count: 3, now: NOW, runIndex: 6 }).some((q) => q.tier === 2)).toBe(true)
    expect(selectQueries(plan, [], { count: 3, now: NOW, runIndex: 5 }).some((q) => q.tier === 2)).toBe(false)
  })

  it('tÃ¼m plan tekrar etmeden dolaÅŸÄ±lÄ±r (25 ilÃ§e kÄ±sa sÃ¼rede kapsanÄ±r)', () => {
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

  it('kapsam ve Ã§eÅŸitlilik Ã¶lÃ§Ã¼tleri', () => {
    const c = coverageSummary([{ city: 'Ankara', district: 'Sincan', queries30d: 3, results30d: 9, companies: 1, activeProjects: 1, lastSearchedAt: null }])
    expect(c.ankaraDistrictsSearched).toBe(1)
    expect(c.neglected).toContain('Bala')
    const d = diversityMetrics(['a.test', 'a.test', 'a.test', 'b.test', 'c.test', 'd.test'])
    expect(d.distinctDomains).toBe(4)
    expect(d.top3Share).toBeCloseTo(0.83, 2)
  })

  it('dÃ¼rÃ¼st durum: anahtar yok / kaynak yok / kota / baÅŸarÄ±sÄ±z / eksik / yeni yok', () => {
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

describe('sayfa, firma ve Ã¶lÃ§ek', () => {
  it('sayfa tÃ¼rÃ¼ ve kamu/Ã¶zel', () => {
    expect(assessPage('https://www.ankara.bel.tr/ihale/1', 'Ä°hale', '').kind).toBe('kamu')
    expect(assessPage('https://www.sahibinden.com/ilan/x', 'Proje', '').kind).toBe('ilan_portali')
    const f = assessPage('https://www.ornekyapi.test/projelerimiz/', 'Projelerimiz | Ã–rnek YapÄ± Ä°nÅŸaat', 'Devam eden projeler')
    expect(f.kind).toBe('firma_proje_sayfasi')
    expect(f.sector).toBe('ozel')
    expect(f.companyWebsite).toBe('https://www.ornekyapi.test')
    expect(assessPage('https://blog.ornek.test/yazi', 'Tatil Ã¶nerileri', 'deniz').kind).toBe('diger')
  })

  it('firma adÄ± yalnÄ±z metinden; yoksa alan adÄ± aÃ§Ä±kÃ§a iÅŸaretlenir', () => {
    expect(extractCompanyName('Projelerimiz | Kaya YapÄ± Ä°nÅŸaat Ltd. Åti.', '', 'kayayapi.test')).toEqual({ name: 'Kaya YapÄ± Ä°nÅŸaat Ltd. Åti.', basis: 'metin' })
    expect(extractCompanyName('Yeni projemiz', 'GÃ¼lpÄ±nar Konut YapÄ± Kooperatifi Ã¼yeleri', null)!.name).toBe('GÃ¼lpÄ±nar Konut YapÄ± Kooperatifi')
    expect(extractCompanyName('Devam eden projeler', 'Sincan 12 daire', 'ornekinsaat.test')).toEqual({ name: 'ornekinsaat.test', basis: 'alan_adi' })
  })

  it('daire sayÄ±sÄ± ve Ã¶lÃ§ek bandÄ± (kÃ¼Ã§Ã¼k yÃ¼kleniciler ayrÄ± band, Ã¶ne alÄ±nmaz)', () => {
    expect(extractUnitCount('Sincanâ€™da 8 daireli apartman')).toMatchObject({ count: 8, unit: 'daire' })
    expect(sizeBand(extractUnitCount('8 daireli'))).toBe('kucuk')
    expect(sizeBand(extractUnitCount('24 daire'))).toBe('yerel')
    expect(sizeBand(extractUnitCount('64 konutluk'))).toBe('orta')
    expect(sizeBand(extractUnitCount('1.250 konut'))).toBe('buyuk')
    expect(sizeBand(extractUnitCount('12 villa'))).toBe('yerel')
    expect(extractUnitCount('2026 yÄ±lÄ±nda')).toBeNull()
    expect(contractorKind('GÃ¼lpÄ±nar Konut YapÄ± Kooperatifi', '')).toBe('kooperatif')
    expect(contractorKind(null, 'riskli yapÄ± kentsel dÃ¶nÃ¼ÅŸÃ¼m projesi')).toBe('kentsel_donusum')
  })
})

describe('kanÄ±tlÄ± aÅŸama', () => {
  it('aÅŸama yoksa "AÅŸama doÄŸrulanamadÄ±"; tarihsiz veya eski kanÄ±tla aktif sayÄ±lmaz', () => {
    expect(assessStage({ stage: null, stageTerms: [] }, daysAgo(3), NOW).display).toBe(STAGE_UNVERIFIED)
    const undated = assessStage({ stage: 'kaba_insaat', stageTerms: ['kaba insaat'] }, null, NOW)
    expect(undated.active).toBeNull()
    expect(undated.display.startsWith(STAGE_UNVERIFIED)).toBe(true)
    const old = assessStage({ stage: 'kaba_insaat', stageTerms: ['kaba insaat'] }, daysAgo(400), NOW)
    expect(old.active).toBe(false)
    expect(old.confidence).toBe('dusuk')
    const fresh = assessStage({ stage: 'kaba_tamam', stageTerms: ['kaba insaat tamamlan'] }, daysAgo(20), NOW)
    expect(fresh).toMatchObject({ active: true, confidence: 'yuksek', newStart: false, display: 'Kaba inÅŸaat tamamlandÄ±' })
    expect(assessStage({ stage: 'temel_atma', stageTerms: ['temeli atildi'] }, daysAgo(10), NOW).newStart).toBe(true)
  })
})

describe('ÅŸeffaf puan ve bÃ¶lÃ¼mler', () => {
  const settings = { weights: DEFAULT_WEIGHTS, activeCategories: null, extraKeywords: {} }
  const src = { id: 's', kind: 'search_api' as const, sectorHint: null, permission: 'izinli' as const }

  it('aktif Ã¶zel apartman projesi, kamu ihalesinden geri kalmaz; kÃ¼Ã§Ã¼k yÃ¼klenici bÃ¼yÃ¼kten dÃ¼ÅŸÃ¼k puan almaz', async () => {
    const priv = await buildIngestItem({ url: 'https://ornekyapi.test/proje/1', title: 'Etimesgut Eryaman 24 daireli konut projemizin kaba inÅŸaatÄ± tamamlandÄ±', body: 'Ã–rnek YapÄ± Ä°nÅŸaat Ltd. Åti. Etimesgut projesi.', publishedAt: daysAgo(12) }, src, settings, [], NOW)
    const intel = priv!.classification.intel!
    const stage = assessStage(intel, daysAgo(12), NOW)
    const base = { products: intel.products, stage, city: 'Ankara', district: 'Etimesgut', isAnkara: true, verifiedNeed: false, supplierInvite: false }
    const small = privateScore({ ...base, size: 'kucuk' })
    const large = privateScore({ ...base, size: 'buyuk' })
    expect(small.score).toBeGreaterThanOrEqual(large.score)
    expect(small.score).toBeGreaterThanOrEqual(60)
    // 0.16.0 puanÄ± aynÄ± kayÄ±t iÃ§in 60 eÅŸiÄŸinin altÄ±ndaydÄ±
    expect(priv!.score).toBeLessThan(60)
    expect(small.parts.find((p) => p.key === 'talep')!.reason).toMatch(/potansiyel/)
    expect(small.parts.reduce((a, p) => a + p.weight, 0)).toBe(100)
    expect(segmentsFor({ sector: 'ozel', stage, verifiedNeed: false, supplierInvite: false, isProcurement: false, hasCompany: true })).toEqual(['ozel_proje', 'aktif_santiye'])
  })

  it('kamu kaydÄ± yalnÄ±z Kamu Ä°haleleri; doÄŸrulanmÄ±ÅŸ talep Teklif FÄ±rsatlarÄ±', () => {
    const st = assessStage({ stage: null, stageTerms: [] }, null, NOW)
    expect(segmentsFor({ sector: 'kamu', stage: st, verifiedNeed: true, supplierInvite: false, isProcurement: true, hasCompany: false })).toEqual(['kamu_ihale'])
    expect(segmentsFor({ sector: 'ozel', stage: st, verifiedNeed: false, supplierInvite: true, isProcurement: false, hasCompany: true })).toEqual(['ozel_proje', 'teklif_firsati'])
    expect(segmentsFor({ sector: 'bilinmiyor', stage: st, verifiedNeed: false, supplierInvite: false, isProcurement: false, hasCompany: false })).toEqual([])
  })
})

describe('TÃ¼rkÃ§e e-posta ve gÃ¶nderim uygunluÄŸu', () => {
  it('konut â†’ PVC/alÃ¼minyum + Ã§elik/iÃ§/yangÄ±n kapÄ±sÄ±; ticari â†’ cephe + fotoselli; ileri aÅŸamada kapÄ±lar', () => {
    const r = matchServices('konut', 'kaba_tamam')
    expect(r.services).toEqual(expect.arrayContaining(['pvc_dograma', 'aluminyum_dograma', 'celik_kapi', 'oda_kapisi', 'yangin_kapisi']))
    expect(r.brands.sort()).toEqual(['erlin_kapi', 'leonx_metal'])
    const c = matchServices('is_merkezi', 'kaba_insaat')
    expect(c.services).toEqual(expect.arrayContaining(['aluminyum_cephe', 'giydirme_cephe', 'fotoselli_kapi', 'yangin_kapisi']))
    const late = matchServices('konut', 'ince_isler')
    expect(late.services).not.toContain('pvc_dograma')
    expect(late.brands).toEqual(['erlin_kapi'])
  })

  it('e-posta proje uydurmaz, talep iddia etmez, siteleri ve listeden Ã§Ä±kma yolunu iÃ§erir', () => {
    const m = buildEmail({ companyName: 'Ã–rnek YapÄ± Ä°nÅŸaat', companyNameVerified: true, projectLabel: 'Eryaman 24 daireli konut', district: 'Etimesgut', city: 'Ankara', stage: 'kaba_tamam', stageVerified: true, evidenceUrl: 'https://ornekyapi.test/proje/1', verifiedRequest: false, match: matchServices('konut', 'kaba_tamam') })
    expect(m.body).toContain('SayÄ±n Ã–rnek YapÄ± Ä°nÅŸaat Yetkilisi')
    expect(m.body).toContain('https://www.leonxmetal.com')
    expect(m.body).toContain('https://www.erlinkapi.com.tr')
    expect(m.body).toContain('erlindoorkapi@gmail.com')
    expect(m.body).toMatch(/metraj/)
    expect(m.body).toMatch(/LÄ°STEDEN Ã‡IKAR/)
    expect(m.body).not.toMatch(/talebiniz|teklif istediÄŸiniz|tedarikÃ§i teklifi toplandÄ±ÄŸÄ±nÄ±/)
    const anon = buildEmail({ companyName: 'ornek.test', companyNameVerified: false, projectLabel: null, district: null, city: null, stage: null, stageVerified: false, evidenceUrl: null, verifiedRequest: false, match: matchServices('villa', null) })
    expect(anon.body.startsWith('SayÄ±n Yetkili,')).toBe(true)
    expect(anon.body).not.toContain('projenizle ilgili')
  })

  it('denetimler geÃ§meden gÃ¶nderilmez', () => {
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

  it('acil durdurma kapalÄ±yken onaylÄ± ve uygun taslak bile gÃ¶nderilmez', async () => {
    const queue: SendQueue = {
      settings: { auto_send: true, gmail_verified_at: daysAgo(1), legal_confirmed_at: daysAgo(1), daily_limit: 10 }, sent_today: 0,
      drafts: [{ id: 'd1', subject: 'Konu', body: 'GÃ¶vde', opportunity_id: 'o1', company_id: 'c1', sector: 'ozel', has_evidence: true, company: { website: 'https://ornekyapi.test', excluded: false, opted_out: false }, contact: { email: 'info@ornekyapi.test', kind: 'genel_eposta', verified_at: daysAgo(3), source_url: 'https://ornekyapi.test' }, last_email_days: null, suppressed: false }],
    }
    const sent: string[] = []
    const off = await processSendQueue({ queue, killSwitchOpen: false, send: async (to) => (sent.push(to), { id: 'x' }), record: async () => {}, now: () => NOW })
    expect(off.sent).toBe(0)
    expect(off.held[0].reasons).toContain('acil_durdurma')
    const on = await processSendQueue({ queue, killSwitchOpen: true, send: async (to) => (sent.push(to), { id: 'x' }), record: async () => {}, now: () => NOW })
    expect(on.sent).toBe(1)
    expect(sent).toEqual(['info@ornekyapi.test'])
  })

  it('MIME: TÃ¼rkÃ§e konu kodlanÄ±r, baÅŸlÄ±k enjeksiyonu reddedilir', () => {
    expect(encodeHeader('Ã‡elik kapÄ±')).toMatch(/^=\?UTF-8\?B\?/)
    expect(() => buildMime({ from: 'erlindoorkapi@gmail.com', to: 'a@b.test\r\nBcc: x@y.test', subject: 's', body: 'b' })).toThrow()
    const mime = buildMime({ from: 'erlindoorkapi@gmail.com', to: 'info@ornek.test', subject: 'Teklif', body: 'Merhaba' })
    expect(mime).toContain('Content-Type: text/plain; charset=UTF-8')
    expect(base64Url('?>')).not.toMatch(/[+/=]/)
  })
})

// ------------------------------------------------------------------ uÃ§tan uca keÅŸif (sahte veritabanÄ± + sahte arama API)

function source(o: Partial<SourceRow> = {}): SourceRow {
  return { id: 'src-ozel', name: 'Ã–zel sektÃ¶r keÅŸfi', kind: 'search_api', url: null, allowed_hosts: [], sector_hint: 'ozel', permission_status: 'izinli', max_items: 10, etag: null, last_modified: null, active: true, ...o }
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
    reserveSearch: async () => (budget-- > 0 ? { granted: true, reason: null, cursor: 0 } : { granted: false, reason: 'aylÄ±k arama bÃ¼tÃ§esi doldu', cursor: 0 }),
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
  { title: 'Projelerimiz | Ã–rnek YapÄ± Ä°nÅŸaat Ltd. Åti.', url: 'https://www.ornekyapi.test/projelerimiz/', content: 'Sincan Fatih Mahallesi 12 daireli apartman projemizin kaba inÅŸaatÄ± devam ediyor.', published_date: daysAgo(15) },
  { title: 'Ankara BÃ¼yÃ¼kÅŸehir yangÄ±n kapÄ±sÄ± ihalesi', url: 'https://www.ankara.bel.tr/ihale/9', content: 'Hizmet binasÄ± iÃ§in 40 adet yangÄ±n kapÄ±sÄ± alÄ±mÄ± ihalesi. Ä°KN 2026/111111', published_date: daysAgo(3) },
  { title: 'Hava durumu', url: 'https://haber.ornek.test/hava', content: 'YarÄ±n yaÄŸmur bekleniyor', published_date: daysAgo(1) },
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
  it('kaynak Ä°zinli deÄŸilse arama yapmaz ve "kaynak_yok" kaydeder (sahte baÅŸarÄ± yok)', async () => {
    const f = fakeDb({}, source({ permission_status: 'inceleniyor', active: false }))
    const n = netDeps(f.db)
    const r = await runDiscovery(n.d)
    expect(r.status).toBe('kaynak_yok')
    expect(n.calls).toHaveLength(0)
    expect(f.runs).toHaveLength(1)
    expect(r.note).toMatch(/Ä°zinli/)
  })

  it('anahtar yoksa "yapilandirma_eksik"', async () => {
    const f = fakeDb({}, source())
    const r = await runDiscovery(netDeps(f.db, 200, null).d)
    expect(r.status).toBe('yapilandirma_eksik')
    expect(r.note).toMatch(/TAVILY_API_KEY/)
  })

  it('baÅŸarÄ±lÄ± keÅŸif: Ã¶zel firma projesi firma diziniyle, kamu ilanÄ± Kamu Ä°haleleri kanalÄ±nda, ilgisiz sonuÃ§ ret', async () => {
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
    expect(firm.company).toMatchObject({ name: 'Ã–rnek YapÄ± Ä°nÅŸaat Ltd. Åti.', name_basis: 'metin', website: 'https://www.ornekyapi.test', size_band: 'yerel' })
    expect(firm.segments).toContain('ozel_proje')
    expect(firm.segments).toContain('aktif_santiye')
    expect(firm.stage_evidence_at).toBe(daysAgo(15))
    const pub = items.find((i) => i.page_kind === 'kamu')!
    expect(pub.segments).toEqual(['kamu_ihale'])
    expect(pub.company).toBeNull()
    expect(r.results_rejected).toBeGreaterThan(0)
    expect(f.saved[0].seen.some((s) => s.outcome === 'ret')).toBe(true)
  })

  it('arama API hatasÄ± â†’ "basarisiz"; kota ilk sorguda doluysa â†’ "kota_doldu"', async () => {
    const f1 = fakeDb({}, source())
    expect((await runDiscovery(netDeps(f1.db, 500).d)).status).toBe('basarisiz')
    const f2 = fakeDb({}, source(), 0)
    const r2 = await runDiscovery(netDeps(f2.db).d)
    expect(r2.status).toBe('kota_doldu')
    expect(r2.api_calls).toBe(0)
  })
})

describe('firma sitesi', () => {
  it('ana sayfadan proje listesi baÄŸlantÄ±larÄ± (aynÄ± ana makine, "devam eden" Ã¶nce)', () => {
    const html = '<a href="/tamamlanan-projeler">Tamamlanan Projeler</a><a href="/devam-eden-projeler">Devam Eden Projeler</a><a href="https://baska.test/projeler">Projeler</a><a href="/iletisim">Ä°letiÅŸim</a>'
    expect(projectListLinks(html, 'https://ornekyapi.test/', ['ornekyapi.test'])).toEqual(['https://ornekyapi.test/devam-eden-projeler', 'https://ornekyapi.test/tamamlanan-projeler'])
  })
})
