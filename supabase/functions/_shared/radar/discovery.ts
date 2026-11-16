/**
 * LEONX Radar — özel sektör inşaat keşfi: sorgu planı, rotasyon, ilçe kapsamı ve kaynak çeşitliliği.
 *
 * Neden ayrı bir keşif hattı? 0.16.0'da otomatik taranan kaynakların tamamı kamu ilan sayfalarıydı ve
 * arama API'si sorguları "… ihalesi" kalıbındaydı; özel müteahhit projeleri yapısal olarak görünmüyordu.
 * Bu modül özel sektöre yönelik Türkçe sorgu kalıplarını Ankara'nın 25 ilçesine (ikincil: Hatay,
 * Kahramanmaraş) yayar ve her çalıştırmada EN AZ aranmış ilçeleri öne alarak seçer. Böylece görünürlüğü
 * yüksek birkaç firma/ilçe tekrar tekrar aranmaz; küçük ilçeler ve küçük yükleniciler de sıra alır.
 *
 * Sorgular yalnız yetkili arama API'sine (Tavily) gönderilir; Google sonuç sayfaları kazınmaz.
 * Sorgu metinleri "örnek arama"dır, doğrulanmış bilgi değildir.
 * Saf modül: ağ, veritabanı veya Deno/Node API'si kullanmaz (Vitest + Edge Function ortak).
 */
import { ANKARA_DISTRICTS, DISTRICTS } from './geo.ts'
import { fold } from './text.ts'

export type QueryFamily = 'proje' | 'firma' | 'asama' | 'tedarik' | 'site'

export interface QueryPattern {
  key: string
  family: QueryFamily
  /** {yer} → ilçe veya il adı */
  template: string
  /** Yalnız il düzeyinde (ör. "Ankara PVC doğrama tedarikçi arayan") */
  cityOnly?: boolean
}

/** Özel sektör sorgu kalıpları (Türkçe). Kamu ihale kalıbı YOK; kamu ihaleleri ayrı, ikincil kanaldır. */
export const QUERY_PATTERNS: QueryPattern[] = [
  { key: 'yeni_baslayan', family: 'proje', template: '{yer} yeni başlayan inşaat projeleri' },
  { key: 'konut_muteahhit', family: 'proje', template: '{yer} yeni konut projeleri müteahhit' },
  { key: 'devam_eden', family: 'proje', template: '{yer} devam eden inşaat projeleri' },
  { key: 'apartman', family: 'proje', template: '{yer} yeni apartman projesi' },
  { key: 'rezidans', family: 'proje', template: '{yer} yeni başlayan rezidans projeleri' },
  { key: 'villa', family: 'proje', template: '{yer} villa inşaat projeleri' },
  { key: 'yapim_asamasinda', family: 'asama', template: '{yer} konut projesi yapım aşamasında' },
  { key: 'kaba_tamam', family: 'asama', template: '{yer} kaba inşaatı tamamlanan projeler' },
  { key: 'firmalar_devam', family: 'firma', template: '{yer} inşaat firmaları devam eden projeler' },
  { key: 'muteahhit_proje', family: 'firma', template: '{yer} müteahhit firma projeleri' },
  { key: 'firma_yeni_proje', family: 'firma', template: '{yer} inşaat firması yeni proje' },
  { key: 'kentsel_donusum', family: 'proje', template: '{yer} kentsel dönüşüm müteahhit yeni proje' },
  { key: 'kooperatif', family: 'proje', template: '{yer} konut yapı kooperatifi inşaat' },
  { key: 'ticari', family: 'proje', template: '{yer} iş merkezi plaza inşaat projesi' },
  { key: 'tesis', family: 'proje', template: '{yer} otel hastane fabrika inşaatı yeni yatırım' },
  // Firma sitelerindeki proje sayfaları (tırnaklı ifade aramaları)
  { key: 'site_projelerimiz', family: 'site', template: '"projelerimiz" "{yer}" inşaat konut' },
  { key: 'site_devam_eden', family: 'site', template: '"devam eden projeler" "{yer}" "inşaat"' },
  { key: 'site_yeni_projemiz', family: 'site', template: '"yeni projemiz" "{yer}" "konut"' },
  { key: 'site_kaba_tamam', family: 'site', template: '"kaba inşaat" "{yer}" "tamamlandı"' },
  // Açık tedarik talepleri (il düzeyi)
  { key: 'site_tedarikci', family: 'tedarik', template: '"tedarikçi başvurusu" "inşaat" "{yer}"', cityOnly: true },
  { key: 'pvc_tedarikci', family: 'tedarik', template: '{yer} PVC doğrama tedarikçi arayan', cityOnly: true },
  { key: 'alu_teklif', family: 'tedarik', template: '{yer} alüminyum doğrama teklif talebi', cityOnly: true },
  { key: 'yangin_kapisi', family: 'tedarik', template: '{yer} yangın kapısı satın alma', cityOnly: true },
  { key: 'celik_kapi', family: 'tedarik', template: '{yer} çelik kapı toplu alım', cityOnly: true },
  { key: 'oda_kapisi', family: 'tedarik', template: '{yer} oda kapısı metraj teklif', cityOnly: true },
  { key: 'fotoselli', family: 'tedarik', template: '{yer} fotoselli kapı proje tedariki', cityOnly: true },
]

export interface PlannedQuery {
  /** Kararlı anahtar: kalıp|il|ilçe */
  key: string
  pattern: string
  family: QueryFamily
  city: string
  district: string | null
  query: string
  /** 1: Ankara (birincil) · 2: Hatay / Kahramanmaraş (ikincil) */
  tier: 1 | 2
}

export const SECONDARY_CITIES = ['Hatay', 'Kahramanmaraş'] as const

/** İkincil illerde ilçe düzeyinde aranacak ana ilçeler (yapılaşmanın yoğun olduğu merkezler) */
export const SECONDARY_DISTRICTS: Record<string, string[]> = {
  Hatay: ['Antakya', 'İskenderun', 'Defne', 'Dörtyol', 'Kırıkhan'],
  Kahramanmaraş: ['Onikişubat', 'Dulkadiroğlu', 'Elbistan', 'Pazarcık'],
}

/** Tüm sorgu planı: Ankara'nın 25 ilçesi × kalıplar + Ankara il düzeyi; ikincil iller daha dar. */
export function buildDiscoveryPlan(patterns: QueryPattern[] = QUERY_PATTERNS): PlannedQuery[] {
  const out: PlannedQuery[] = []
  const add = (p: QueryPattern, city: string, district: string | null, tier: 1 | 2) => {
    const place = district ?? city
    // İlçe adı tek başına belirsiz olabilir (ör. "Bala", "Evren"): ilçe sorgularına il adı eklenir
    const where = district ? `${district} ${city}` : city
    out.push({ key: `${p.key}|${fold(city)}|${district ? fold(district) : '-'}`, pattern: p.key, family: p.family, city, district, query: p.template.replace('{yer}', p.family === 'site' || p.family === 'tedarik' ? place : where), tier })
  }
  for (const p of patterns) {
    if (p.cityOnly) {
      add(p, 'Ankara', null, 1)
      continue
    }
    add(p, 'Ankara', null, 1)
    for (const d of ANKARA_DISTRICTS) add(p, 'Ankara', d, 1)
  }
  for (const city of SECONDARY_CITIES) {
    for (const p of patterns) {
      if (p.family === 'tedarik' && !p.cityOnly) continue
      add(p, city, null, 2)
      if (!p.cityOnly && (p.family === 'proje' || p.family === 'firma')) for (const d of SECONDARY_DISTRICTS[city] ?? []) if ((DISTRICTS[city] ?? []).includes(d)) add(p, city, d, 2)
    }
  }
  return out
}

/** Bir sorgunun geçmişi (veritabanı radar_discovery_queries satırı) */
export interface QueryState {
  key: string
  runs: number
  newResults: number
  lastRunAt: string | null
}

export interface RotationOptions {
  /** Bu çalıştırmada kaç sorgu (bütçe ayrıca uygulanır) */
  count: number
  now: Date
  /** Aynı sorgu en erken kaç gün sonra tekrar (varsayılan 7) */
  cooldownDays?: number
  /** Her n çalıştırmadan birinde ikincil il sorgusu (varsayılan 6) */
  secondaryEvery?: number
  /** Çalıştırma sırası (ikincil il dönüşü için) */
  runIndex: number
}

/** "Ankara" il düzeyi sorgularını ayrı bir kapsam birimi sayar */
export function coverageUnit(q: Pick<PlannedQuery, 'city' | 'district'>): string {
  return `${q.city}/${q.district ?? '*'}`
}

/**
 * Rotasyon: (1) bekleme süresi dolmamış sorgular atlanır, (2) en az aranmış kapsam birimi (ilçe) öne
 * alınır, (3) aynı çalıştırmada bir ilçe/kalıp ailesi bir kez seçilir (çeşitlilik), (4) hiç çalışmamış
 * sorgu, çalışmışa göre öncelikli; verimli kalıplar (yeni sonuç/çalıştırma) yalnız eşitlik bozucu.
 * Deterministiktir (testlerde aynı girdi → aynı seçim).
 */
export function selectQueries(plan: PlannedQuery[], states: QueryState[], opts: RotationOptions): PlannedQuery[] {
  const byKey = new Map(states.map((s) => [s.key, s]))
  const cooldown = (opts.cooldownDays ?? 7) * 86400000
  const now = opts.now.getTime()
  const unitRuns = new Map<string, number>()
  for (const q of plan) {
    const s = byKey.get(q.key)
    unitRuns.set(coverageUnit(q), (unitRuns.get(coverageUnit(q)) ?? 0) + (s?.runs ?? 0))
  }
  const secondaryTurn = opts.runIndex % (opts.secondaryEvery ?? 6) === 0
  const eligible = plan.filter((q) => {
    const s = byKey.get(q.key)
    return !s?.lastRunAt || now - Date.parse(s.lastRunAt) >= cooldown
  })
  const ranked = eligible
    .map((q, i) => {
      const s = byKey.get(q.key)
      const runs = s?.runs ?? 0
      const yieldRate = runs ? (s!.newResults / runs) : 0
      return { q, i, unit: unitRuns.get(coverageUnit(q)) ?? 0, never: runs === 0 ? 0 : 1, last: s?.lastRunAt ? Date.parse(s.lastRunAt) : 0, yieldRate }
    })
    .sort((a, b) => a.unit - b.unit || a.never - b.never || a.last - b.last || b.yieldRate - a.yieldRate || a.i - b.i)
  const picked: PlannedQuery[] = []
  const units = new Set<string>()
  const families = new Map<QueryFamily, number>()
  const wantSecondary = secondaryTurn ? 1 : 0
  // İkincil il dönüşü: en az aranmış ikincil sorgu önce
  if (wantSecondary) {
    const sec = ranked.find((r) => r.q.tier === 2)
    if (sec) {
      picked.push(sec.q)
      units.add(coverageUnit(sec.q))
      families.set(sec.q.family, 1)
    }
  }
  for (const pass of [0, 1]) {
    for (const r of ranked) {
      if (picked.length >= opts.count) break
      if (r.q.tier === 2 || picked.includes(r.q)) continue
      if (pass === 0 && (units.has(coverageUnit(r.q)) || (families.get(r.q.family) ?? 0) >= Math.max(1, Math.ceil(opts.count / 3)))) continue
      picked.push(r.q)
      units.add(coverageUnit(r.q))
      families.set(r.q.family, (families.get(r.q.family) ?? 0) + 1)
    }
  }
  return picked.slice(0, opts.count)
}

// ------------------------------------------------------------------ Kapsam ve çeşitlilik

export interface DistrictStat {
  city: string
  district: string
  queries30d: number
  results30d: number
  companies: number
  activeProjects: number
  lastSearchedAt: string | null
}

export interface CoverageSummary {
  /** Son 30 günde en az bir kez aranan Ankara ilçesi sayısı (25 üzerinden) */
  ankaraDistrictsSearched: number
  ankaraDistrictsTotal: number
  /** Hiç aranmamış veya 30 günden uzun süredir aranmamış Ankara ilçeleri */
  neglected: string[]
  /** En çok aranan ilçenin en az arananla oranı (1 = dengeli) */
  imbalance: number | null
}

export function coverageSummary(stats: DistrictStat[]): CoverageSummary {
  const ankara = ANKARA_DISTRICTS.map((d) => stats.find((s) => s.city === 'Ankara' && s.district === d) ?? { city: 'Ankara', district: d, queries30d: 0, results30d: 0, companies: 0, activeProjects: 0, lastSearchedAt: null })
  const searched = ankara.filter((s) => s.queries30d > 0)
  const counts = ankara.map((s) => s.queries30d)
  const max = Math.max(...counts)
  const min = Math.min(...counts)
  return {
    ankaraDistrictsSearched: searched.length,
    ankaraDistrictsTotal: ANKARA_DISTRICTS.length,
    neglected: ankara.filter((s) => s.queries30d === 0).map((s) => s.district),
    imbalance: max === 0 ? null : min === 0 ? null : Math.round((max / min) * 100) / 100,
  }
}

export interface DiversityMetrics {
  results: number
  distinctDomains: number
  /** En sık 3 alan adının sonuçlardaki payı (0–1); yüksekse birkaç görünür site baskın */
  top3Share: number
  topDomains: { domain: string; n: number }[]
}

export function diversityMetrics(domains: string[]): DiversityMetrics {
  const counts = new Map<string, number>()
  for (const d of domains) counts.set(d, (counts.get(d) ?? 0) + 1)
  const top = [...counts].map(([domain, n]) => ({ domain, n })).sort((a, b) => b.n - a.n || a.domain.localeCompare(b.domain))
  const top3 = top.slice(0, 3).reduce((a, x) => a + x.n, 0)
  return { results: domains.length, distinctDomains: counts.size, top3Share: domains.length ? Math.round((top3 / domains.length) * 100) / 100 : 0, topDomains: top.slice(0, 10) }
}

// ------------------------------------------------------------------ Tarama durumu

/**
 * Dürüst tarama durumu. Sıfır sonuç asla "başarılı" diye gizlenmez:
 *  - kaynak_yok: etkin + izinli özel sektör keşif kaynağı yok (veya keşif ayarlarda kapalı)
 *  - yapilandirma_eksik: arama API anahtarı tanımlı değil
 *  - kota_doldu: bütçe ilk sorgudan önce bitti
 *  - basarisiz: hiçbir sorgu tamamlanamadı (HTTP/ağ hatası)
 *  - eksik: bazı sorgular hata verdi veya süre/kota yarıda kesti
 *  - basarili_yeni_yok: tüm sorgular çalıştı, yeni proje yok
 *  - basarili: en az bir yeni proje/firma
 */
export type DiscoveryStatus = 'basarili' | 'basarili_yeni_yok' | 'eksik' | 'basarisiz' | 'kaynak_yok' | 'yapilandirma_eksik' | 'kota_doldu'

export const DISCOVERY_STATUS_LABEL: Record<DiscoveryStatus, string> = {
  basarili: 'Başarılı — yeni kayıt bulundu',
  basarili_yeni_yok: 'Başarılı — yeni proje yok',
  eksik: 'Eksik tarama',
  basarisiz: 'Başarısız tarama',
  kaynak_yok: 'Yapılandırılmış keşif kaynağı yok',
  yapilandirma_eksik: 'Arama API anahtarı tanımlı değil',
  kota_doldu: 'Arama API kotası doldu',
}

export function discoveryStatus(r: { configured: 'ok' | 'kaynak_yok' | 'yapilandirma_eksik'; planned: number; executed: number; failed: number; quotaStopped: boolean; budgetStopped: boolean; newRecords: number; companyPagesChecked?: number }): DiscoveryStatus {
  if (r.configured !== 'ok') return r.companyPagesChecked ? 'eksik' : r.configured
  if (r.quotaStopped && r.executed === 0 && !(r.companyPagesChecked ?? 0)) return 'kota_doldu'
  if (r.executed === 0 && r.failed > 0 && !(r.companyPagesChecked ?? 0)) return 'basarisiz'
  if (r.failed > 0 || r.budgetStopped || (r.quotaStopped && r.executed < r.planned)) return 'eksik'
  return r.newRecords > 0 ? 'basarili' : 'basarili_yeni_yok'
}
