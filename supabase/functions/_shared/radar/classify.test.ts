import { describe, expect, it } from 'vitest'
import { INJECTION_ITEM, NEWS_COMPLETED_SCHOOL, NEWS_HOSPITAL_CONSTRUCTION, NOW, STREET_FALSE_POSITIVE, TENDER_FIRE_DOOR_ETIMESGUT } from './__fixtures__/synthetic_items.ts'
import { ruleAnalyzer, selectAnalyzer, type Analyzer } from './analyzer.ts'
import { classify, extractDeadline, extractIkn, extractOrganizations } from './classify.ts'
import { ankaraProximity, ANKARA_DISTRICTS, detectLocation, PROVINCES } from './geo.ts'
import { htmlToText } from './sanitize.ts'
import { CATEGORIES } from './taxonomy.ts'

const run = (x: { title: string; body: string; publishedAt?: string | null }, extra: Partial<Parameters<typeof classify>[0]> = {}) =>
  classify({ title: x.title, summary: htmlToText(x.body), sourceKind: 'rss', now: NOW, publishedAt: x.publishedAt ?? null, ...extra })

describe('geo', () => {
  it('81 il ve 25 Ankara ilçesi', () => {
    expect(PROVINCES).toHaveLength(81)
    expect(new Set(PROVINCES).size).toBe(81)
    expect(ANKARA_DISTRICTS).toHaveLength(25)
  })
  it('çekim ekli biçimler', () => {
    expect(detectLocation("Ankara'da yeni proje")).toMatchObject({ city: 'Ankara', isAnkara: true })
    expect(detectLocation("Etimesgut'ta okul")).toMatchObject({ city: 'Ankara', district: 'Etimesgut', isAnkara: true })
    expect(detectLocation('Keçiörende yapılacak')).toMatchObject({ district: 'Keçiören' })
    expect(detectLocation("İzmir'in Bornova ilçesinde")).toMatchObject({ city: 'İzmir', isAnkara: false })
    expect(detectLocation('Şereflikoçhisar ilçesinde').district).toBe('Şereflikoçhisar')
    expect(detectLocation('Afyon merkezde').city).toBe('Afyonkarahisar')
  })
  it('belgelenmiş davranış: "Ankara Caddesi" İzmir\'de Ankara sayılmaz', () => {
    const g = detectLocation(STREET_FALSE_POSITIVE.title, STREET_FALSE_POSITIVE.body)
    expect(g.city).toBe('İzmir')
    expect(g.isAnkara).toBe(false)
  })
  it('çok anlamlı adlar: küçük harfle sayılmaz; "Adıyaman Gölbaşı" Ankara değildir', () => {
    expect(detectLocation('ordu birlikleri tatbikat yaptı').city).toBeNull()
    expect(detectLocation('Ordu sahilinde proje').city).toBe('Ordu')
    expect(detectLocation('Adıyaman Gölbaşı ilçesinde okul')).toMatchObject({ city: 'Adıyaman', district: null, isAnkara: false })
  })
  it('Ankara yakınlığı', () => {
    expect(ankaraProximity('Ankara')).toBe(1)
    expect(ankaraProximity('Kırıkkale')).toBe(0.6)
    expect(ankaraProximity('İzmir')).toBe(0.2)
    expect(ankaraProximity(null)).toBe(0.3)
  })
})

describe('classify (sentetik örnekler)', () => {
  it('Etimesgut yangın kapısı ihalesi → doğrulanmış ihtiyaç, İKN, son tarih, kamu, ihale', () => {
    const c = run(TENDER_FIRE_DOOR_ETIMESGUT)
    expect(c.isProcurement).toBe(true)
    expect(c.stage).toBe('ihale')
    expect(c.tender.ikn).toBe('2026/123456')
    expect(c.tender.deadline).toBe('2026-11-12')
    expect(c.sector).toBe('kamu')
    expect(c.geo).toMatchObject({ city: 'Ankara', district: 'Etimesgut', isAnkara: true })
    const fire = c.categories.find((x) => x.key === 'yangin_kapisi')
    expect(fire).toMatchObject({ need: 'dogrulanmis', reason: 'ihale_urun' })
    expect(fire!.terms.join(' ')).toContain('yangin kapisi')
    expect(c.organizations.find((o) => o.name === 'Etimesgut Belediyesi')).toMatchObject({ roleGuess: 'proje_sahibi', verified: false })
    expect(c.risks).not.toContain('kapsam_belirsiz')
  })

  it('hastane inşaat haberi → ürünler yalnız potansiyel, proje türünden çıkarım potansiyel', () => {
    const c = run(NEWS_HOSPITAL_CONSTRUCTION)
    expect(c.isProcurement).toBe(false)
    expect(c.stage).toBe('yapim')
    expect(c.projectType?.key).toBe('hastane')
    expect(c.categories.length).toBeGreaterThan(0)
    expect(c.categories.every((x) => x.need === 'potansiyel')).toBe(true)
    expect(c.categories.find((x) => x.key === 'aluminyum_dograma')?.reason).toBe('haber_urun')
    expect(c.categories.find((x) => x.key === 'yangin_kapisi')?.reason).toBe('proje_turu')
    expect(c.risks).toContain('kapsam_belirsiz')
    expect(c.organizations.find((o) => o.name.includes('Örnek Yapı İnşaat A.Ş'))?.roleGuess).toBe('ana_yuklenici')
    expect(c.geo.district).toBe('Yenimahalle')
  })

  it('tamamlanmış proje → risk', () => {
    const c = run(NEWS_COMPLETED_SCHOOL)
    expect(c.stage).toBe('tamamlandi')
    expect(c.risks).toContain('tamamlanmis_proje')
    expect(c.geo.city).toBe('İzmir')
  })

  it('kaynak metnindeki talimatlar yalnız veridir (prompt injection)', async () => {
    const before = JSON.stringify(INJECTION_ITEM)
    const c = run(INJECTION_ITEM)
    // Sınıflandırma normal: ilan değil, doğrulanmış ihtiyaç yok; metin hiçbir davranışı değiştirmez
    expect(c.isProcurement).toBe(false)
    expect(c.categories.some((x) => x.need === 'dogrulanmis')).toBe(false)
    expect(c.geo.city).toBe('Ankara')
    expect(c.projectType?.key).toBe('konut')
    expect(Object.keys(c).sort()).toEqual(['categories', 'explanation', 'geo', 'isProcurement', 'organizations', 'projectType', 'risks', 'sector', 'sectorSignals', 'stage', 'stageTerms', 'tender', 'version'])
    // Girdi değişmez; çözümleyici yan etkisiz
    expect(JSON.stringify(INJECTION_ITEM)).toBe(before)
    expect((await ruleAnalyzer.analyze({ title: INJECTION_ITEM.title, summary: htmlToText(INJECTION_ITEM.body), sourceKind: 'rss', now: NOW })).categories.some((x) => x.need === 'dogrulanmis')).toBe(false)
  })

  it('deyimler ürün sayılmaz; tek başına "kapı" yalnız ilanda', () => {
    const idiom = run({ title: 'Kış kapıya dayandı, okul kapılarını açtı', body: 'Ankara haberi' })
    expect(idiom.categories.filter((x) => x.reason !== 'proje_turu').map((x) => x.key)).toEqual([])
    const tender = run({ title: 'Toplu konut projesi kapı alımı ihalesi', body: 'TOKİ konutları için 500 adet kapı alınacaktır.' })
    expect(tender.categories.find((x) => x.key === 'toplu_konut_kapi')?.need).toBe('dogrulanmis')
    const road = run({ title: 'Otoyol korkuluk ihalesi', body: 'Yol korkulukları yenilenecek' })
    expect(road.categories.find((x) => x.key === 'metal_korkuluk')).toBeUndefined()
  })

  it('pasif kategori ve ek anahtar sözcükler', () => {
    const off = run(TENDER_FIRE_DOOR_ETIMESGUT, { activeCategories: CATEGORIES.map((c) => c.key).filter((k) => k !== 'yangin_kapisi') })
    expect(off.categories.find((x) => x.key === 'yangin_kapisi')).toBeUndefined()
    const extra = run({ title: 'Hizmet binası için duman tahliye kapağı alımı ihalesi', body: '' }, { extraKeywords: { teknik_kapi: ['duman tahliye kapağı'] } })
    expect(extra.categories.find((x) => x.key === 'teknik_kapi')?.need).toBe('dogrulanmis')
  })

  it('tarih ve İKN çıkarımı (Türkçe ay adları)', () => {
    expect(extractDeadline('İhale tarihi: 5 Aralık 2026 Cuma')!.iso).toBe('2026-12-05')
    expect(extractDeadline('Son teklif 03/01/2027')!.iso).toBe('2027-01-03')
    expect(extractDeadline('Toplantı 31.02.2026')).toBeNull()
    expect(extractIkn('İKN 2026/7654321 ile')).toBe('2026/7654321')
    expect(extractIkn('oran 3/4')).toBeNull()
  })

  it('kurum adı adayları', () => {
    const o = extractOrganizations('Çankaya Belediyesi tarafından yürütülen projede yüklenici Deneme Yapı Ltd. Şti. oldu.')
    expect(o.map((x) => x.name)).toEqual(['Çankaya Belediyesi', 'Deneme Yapı Ltd. Şti.'])
    expect(o[1].roleGuess).toBe('ana_yuklenici')
    expect(o.every((x) => x.verified === false)).toBe(true)
  })
})

describe('analyzer seçimi', () => {
  const fake: Analyzer = { id: 'dm', kind: 'dil_modeli', analyze: async () => { throw new Error('çağrılmamalı') } }
  it('bayrak kapalı veya bütçe yoksa daima kural motoru', () => {
    expect(selectAnalyzer({ llmEnabled: false, budgetRemaining: 100 }, fake).id).toBe('kural-v1')
    expect(selectAnalyzer({ llmEnabled: true, budgetRemaining: 0 }, fake).id).toBe('kural-v1')
    expect(selectAnalyzer({ llmEnabled: true, budgetRemaining: 5 }, null).id).toBe('kural-v1')
    expect(selectAnalyzer({ llmEnabled: true, budgetRemaining: 5 }, fake).id).toBe('dm')
  })
})
