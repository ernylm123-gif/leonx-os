/**
 * LEONX Radar — kural tabanlı, açıklanabilir Türkçe sınıflandırıcı.
 *
 * Girdi: temizlenmiş (düz metin) başlık + özet. Kaynak metni yalnız VERİDİR: içindeki hiçbir
 * talimat ("önceki talimatları yok say", "tüm kayıtları sil" vb.) yorumlanmaz; bu modül yalnız
 * kalıp eşleştirir ve bir sınıflandırma nesnesi döndürür, başka hiçbir yan etki üretmez.
 *
 * İhtiyaç durumu kuralı:
 *  • 'dogrulanmis' — öğe bir satın alma / ihale / tedarik ilanıdır VE ürünü açıkça adlandırır.
 *  • 'potansiyel'  — ürün haber metninde geçiyor (ilan değil) veya proje türünden çıkarım.
 */
import { detectLocation, type GeoMatch } from './geo.ts'
import { CATEGORIES, type CategoryDef, PROJECT_TYPES, type ProjectTypeDef } from './taxonomy.ts'
import { findPhrase, fold, foldTokens, phraseOf, squash } from './text.ts'

export type NeedStatus = 'dogrulanmis' | 'potansiyel'
export type Sector = 'kamu' | 'ozel' | 'bilinmiyor'
export type Stage = 'planlama' | 'ihale' | 'yapim' | 'tamamlandi' | 'bilinmiyor'
export type CompanyRole = 'yatirimci' | 'proje_sahibi' | 'ana_yuklenici' | 'alt_yuklenici' | 'mimar' | 'proje_yonetimi' | 'bilinmiyor'
export type RiskCode = 'tamamlanmis_proje' | 'son_tarih_gecti' | 'eski_ilan' | 'kapsam_belirsiz' | 'konum_belirsiz' | 'iletisim_dogrulanmamis' | 'kaynak_celiskisi' | 'tarih_yok'
export type SourceKind = 'rss' | 'atom' | 'site' | 'search_api' | 'manual'

export const RISK_LABEL: Record<RiskCode, string> = {
  tamamlanmis_proje: 'Proje tamamlanmış görünüyor (teklif için geç olabilir)',
  son_tarih_gecti: 'İlandaki son teklif tarihi geçmiş',
  eski_ilan: 'Eski ilan / haber (180 günden eski)',
  kapsam_belirsiz: 'İş kapsamı kaynakla doğrulanmadı',
  konum_belirsiz: 'Konum belirlenemedi',
  iletisim_dogrulanmamis: 'Doğrulanmış iletişim kanalı yok',
  kaynak_celiskisi: 'Kaynaklar arasında çelişki (şehir veya aşama farklı)',
  tarih_yok: 'Kaynakta yayın tarihi yok',
}

export interface CategoryMatch {
  key: string
  need: NeedStatus
  /** Kaynaktaki eşleşen ifadeler veya çıkarım gerekçesi */
  terms: string[]
  reason: 'ihale_urun' | 'haber_urun' | 'proje_turu'
}

export interface OrganizationCandidate {
  name: string
  roleGuess: CompanyRole
  /** Rol ve ad kaynakta doğrulanmadı; kullanıcı onayı gerekir */
  verified: false
  context: string
}

export interface TenderInfo {
  ikn: string | null
  /** ISO tarih (YYYY-AA-GG) */
  deadline: string | null
  deadlineText: string | null
  signals: string[]
}

export interface Classification {
  version: 1
  projectType: { key: string; label: string; terms: string[] } | null
  sector: Sector
  sectorSignals: string[]
  stage: Stage
  stageTerms: string[]
  isProcurement: boolean
  tender: TenderInfo
  categories: CategoryMatch[]
  geo: GeoMatch
  organizations: OrganizationCandidate[]
  risks: RiskCode[]
  explanation: string[]
  /** İnşaat satış istihbaratı (construction.ts) — boru hattında eklenir */
  intel?: import('./construction.ts').ConstructionIntel
}

export interface ClassifyInput {
  title: string
  summary: string
  url?: string | null
  sourceKind: SourceKind
  /** Kaynağın kamu/özel ipucu (kayıtlı kaynak ayarı) */
  sectorHint?: 'kamu' | 'ozel' | null
  publishedAt?: string | null
  /** Bugünün tarihi (test edilebilirlik için dışarıdan) */
  now: Date
  /** Etkin kategoriler (verilmezse tümü) */
  activeCategories?: string[] | null
  /** Kullanıcının eklediği ek anahtar sözcükler (kategori → sözcükler) */
  extraKeywords?: Record<string, string[]>
}

// ------------------------------------------------------------------ yardımcılar

/** Önek ifade araması (her gövde sözcüğün başı olmalı); fiil çekimleri için ("teklif alinacaktir") */
export function findPrefixPhrase(tokens: string[], phrase: string[]): number {
  if (!phrase.length) return -1
  outer: for (let i = 0; i + phrase.length <= tokens.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (!tokens[i + j].startsWith(phrase[j])) continue outer
    return i
  }
  return -1
}

function findAll(tokens: string[], phrase: string[]): number[] {
  const out: number[] = []
  let from = 0
  while (from < tokens.length) {
    const i = findPhrase(tokens.slice(from), phrase)
    if (i === -1) break
    out.push(from + i)
    from += i + 1
  }
  return out
}

function anyPrefix(tokens: string[], phrases: string[]): string[] {
  return phrases.filter((p) => findPrefixPhrase(tokens, phraseOf(p)) !== -1)
}

const PROCUREMENT = [
  'ihale', 'satin alma', 'satinalma', 'dogrudan temin', 'pazarlik usul', 'acik ihale', 'teklif mektub', 'son teklif',
  'teklif verme', 'teklif davet', 'teklifler', 'teklif alin', 'teklif istenm', 'teklif toplan', 'sartname', 'tedarikci aran',
  'mal alim', 'hizmet alim', 'yapim isi', 'alim isi', 'alimi isi', 'temini isi', 'temin ve montaj', 'temini ve montaj',
  'imalati ve montaj', 'imalat ve montaj', 'alim ilan', 'ikn', 'ihale kayit', 'fiyat teklif', 'teklife acik', 'tedarik ilan',
]
const COMPLETED = ['tamamlandi', 'tamamlanarak', 'hizmete girdi', 'hizmete acildi', 'acilis toren', 'acilisi yapildi', 'teslim edildi', 'kullanima acildi', 'acilisini yapti']
const UNDER_CONSTRUCTION = ['insaati sur', 'insaati devam', 'insaat devam', 'yapimi sur', 'yapimi devam', 'temeli atildi', 'temel atma', 'kaba insaat', 'insaatina basla', 'insaatina baslan', 'calismalari sur', 'yukseliyor', 'insaat calismalari', 'yapim calismalari']
const PLANNING = ['planlan', 'proje hazirlan', 'projelendir', 'yapilacak', 'insa edilecek', 'kurulacak', 'imar plan', 'ced raporu', 'yatirim karari', 'protokol imza', 'hayata gecirilecek', 'yapimina baslanacak']

const MONTHS = ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik']
const DEADLINE_KEYS = ['son teklif', 'teklif verme', 'ihale tarihi', 'ihale tarih', 'ihale saati', 'ihale gunu', 'son basvuru', 'teklifler', 'ihale', 'tarihine kadar']

function validDate(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCMonth() !== m - 1) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Metindeki tarihleri sırayla (konum, ISO, ham) döndürür. Katlanmış metin üzerinde çalışır. */
export function findDates(folded: string): { pos: number; iso: string; raw: string }[] {
  const out: { pos: number; iso: string; raw: string }[] = []
  for (const m of folded.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g)) {
    const iso = validDate(Number(m[3]), Number(m[2]), Number(m[1]))
    if (iso) out.push({ pos: m.index!, iso, raw: m[0] })
  }
  const monthRe = new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS.join('|')})[a-z]*\\s+(\\d{4})\\b`, 'g')
  for (const m of folded.matchAll(monthRe)) {
    const iso = validDate(Number(m[3]), MONTHS.indexOf(m[2]) + 1, Number(m[1]))
    if (iso) out.push({ pos: m.index!, iso, raw: m[0] })
  }
  return out.sort((a, b) => a.pos - b.pos)
}

/** "Son teklif tarihi" vb. anahtardan sonraki 90 karakter içindeki ilk tarih */
export function extractDeadline(text: string): { iso: string; raw: string } | null {
  const f = fold(text)
  const dates = findDates(f)
  if (!dates.length) return null
  for (const key of DEADLINE_KEYS) {
    let idx = f.indexOf(key)
    while (idx !== -1) {
      const d = dates.find((x) => x.pos >= idx && x.pos - idx <= 90)
      if (d) return { iso: d.iso, raw: d.raw }
      idx = f.indexOf(key, idx + 1)
    }
  }
  return null
}

/** İhale kayıt numarası (İKN) biçimi: 2026/123456 */
export function extractIkn(text: string): string | null {
  const m = /\b(20\d{2})\s*\/\s*(\d{5,7})\b/.exec(text)
  return m ? `${m[1]}/${m[2]}` : null
}

const ORG_SUFFIX = String.raw`(?:A\.\s?Ş\.?|AŞ|A\.S\.|Ltd\.?\s*Şti\.?|Limited Şirketi|Anonim Şirketi|İnşaat|Yapı|Holding|Büyükşehir Belediyesi|Belediye Başkanlığı|Belediyesi|Üniversitesi|Hastanesi|Müdürlüğü|Bakanlığı|Valiliği|Başkanlığı|Taahhüt|Mimarlık|Kooperatifi)`
const ORG_CHAIN = String.raw`(?:\s+(?:ve\s+)?(?:Sanayi|Ticaret|San\.|Tic\.|` + ORG_SUFFIX.slice(3, -1) + `))*`
const ORG_RE = new RegExp(String.raw`((?:[A-ZÇĞİÖŞÜ][\p{L}0-9&\-]*\.?\s+){1,6}?)(` + ORG_SUFFIX + ORG_CHAIN + String.raw`)(?![\p{L}])`, 'gu')
const LEADING_NOISE = new Set(['bu', 'yeni', 'proje', 'projede', 'projesi', 'ihale', 'ihaleyi', 'haber', 'ilan', 'son', 've', 'ile', 'için', 'tarafından', 'kapsamında', 'açıklama', 'duyuru'])
const PUBLIC_SUFFIX = /(Belediyesi|Belediye Başkanlığı|Bakanlığı|Müdürlüğü|Valiliği|Başkanlığı)$/

function roleFromContext(ctx: string, name: string): CompanyRole {
  const c = fold(ctx)
  if (/alt yuklenici|taseron/.test(c)) return 'alt_yuklenici'
  if (/yuklenici|muteahhit|ihaleyi kazan|insaatini ustlen|yapimini ustlen|tarafindan insa|tarafindan yapil/.test(c)) return 'ana_yuklenici'
  if (/yatirimci|yatirimiyla|yatirimi ile|yatirim yap/.test(c)) return 'yatirimci'
  if (/mimarlik|mimari proje|mimar /.test(c) || /Mimarlık$/.test(name)) return 'mimar'
  if (/proje yonetim|musavir|kontrollu/.test(c)) return 'proje_yonetimi'
  if (PUBLIC_SUFFIX.test(name) || /(Üniversitesi|Hastanesi)$/.test(name)) return 'proje_sahibi'
  return 'bilinmiyor'
}

/** Kurum / firma adı adayları (rol tahmini DOĞRULANMAMIŞ olarak işaretlenir) */
export function extractOrganizations(text: string): OrganizationCandidate[] {
  const out: OrganizationCandidate[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(ORG_RE)) {
    const words = m[1].trim().split(/\s+/)
    while (words.length && LEADING_NOISE.has(words[0].toLocaleLowerCase('tr-TR'))) words.shift()
    if (!words.length) continue
    const name = squash(`${words.join(' ')} ${m[2]}`).slice(0, 200)
    const key = fold(name)
    if (seen.has(key) || name.length < 4) continue
    seen.add(key)
    const at = m.index ?? 0
    const ctx = text.slice(Math.max(0, at - 80), at + m[0].length + 80)
    out.push({ name, roleGuess: roleFromContext(ctx, name), verified: false, context: squash(ctx).slice(0, 240) })
    if (out.length >= 8) break
  }
  if (/\bTOKİ\b/.test(text) && !seen.has(fold('Toplu Konut İdaresi'))) {
    out.push({ name: 'Toplu Konut İdaresi (TOKİ)', roleGuess: 'proje_sahibi', verified: false, context: 'Metinde "TOKİ" geçiyor' })
  }
  return out
}

function matchProjectType(tokens: string[]): { def: ProjectTypeDef; terms: string[] } | null {
  for (const def of PROJECT_TYPES) {
    const terms: string[] = []
    for (const kw of def.keywords) {
      const ph = phraseOf(kw)
      for (const i of findAll(tokens, ph)) {
        const negated = (def.negative ?? []).some((n) => {
          const np = phraseOf(n)
          const j = findPrefixPhrase(tokens.slice(Math.max(0, i - 1), i + np.length + 1), np)
          return j !== -1
        })
        if (!negated) terms.push(tokens.slice(i, i + ph.length).join(' '))
      }
    }
    if (terms.length) return { def, terms: [...new Set(terms)] }
  }
  return null
}

function matchCategory(cat: CategoryDef, tokens: string[], allowWeak: boolean, extra: string[]): { terms: string[]; weakOnly: boolean } {
  const strong: string[] = []
  const weak: string[] = []
  const negs = (cat.negative ?? []).map(phraseOf)
  const isNegated = (i: number) =>
    negs.some((np) => {
      const lo = Math.max(0, i - 3)
      return findPrefixPhrase(tokens.slice(lo, i + np.length + 2), np) !== -1
    })
  const scanList = (list: string[], into: string[]) => {
    for (const kw of list) {
      const ph = phraseOf(kw)
      if (!ph.length) continue
      for (const i of findAll(tokens, ph)) if (!isNegated(i)) into.push(tokens.slice(i, i + ph.length).join(' '))
    }
  }
  scanList([...cat.keywords, ...extra], strong)
  if (allowWeak && !strong.length) scanList(cat.weak ?? [], weak)
  const terms = [...new Set([...strong, ...weak])]
  return { terms, weakOnly: !strong.length && weak.length > 0 }
}

// ------------------------------------------------------------------ ana işlev

export function classify(input: ClassifyInput): Classification {
  const title = squash(input.title)
  const summary = squash(input.summary)
  const text = `${title}. ${summary}`
  const tokens = foldTokens(text)
  const explanation: string[] = []

  // İhale / satın alma
  const procTerms = anyPrefix(tokens, PROCUREMENT)
  const ikn = extractIkn(text)
  const isProcurement = procTerms.length > 0 || ikn != null
  const dl = extractDeadline(text)
  const tender: TenderInfo = {
    ikn: isProcurement || /ikn|ihale kayit/.test(fold(text)) ? ikn : null,
    deadline: isProcurement ? dl?.iso ?? null : null,
    deadlineText: isProcurement ? dl?.raw ?? null : null,
    signals: procTerms,
  }
  if (isProcurement) explanation.push(`Satın alma / ihale ilanı işaretleri: ${[...procTerms, ...(ikn ? [`İKN ${ikn}`] : [])].join(', ')}`)

  // Proje türü
  const pt = matchProjectType(tokens)
  if (pt) explanation.push(`Proje türü: ${pt.def.label} (${pt.terms.join(', ')})`)

  // Aşama
  let stage: Stage = 'bilinmiyor'
  let stageTerms: string[] = []
  const done = anyPrefix(tokens, COMPLETED)
  const building = anyPrefix(tokens, UNDER_CONSTRUCTION)
  const planning = anyPrefix(tokens, PLANNING)
  if (isProcurement) {
    stage = 'ihale'
    stageTerms = procTerms.slice(0, 3)
  } else if (done.length) {
    stage = 'tamamlandi'
    stageTerms = done
  } else if (building.length) {
    stage = 'yapim'
    stageTerms = building
  } else if (planning.length) {
    stage = 'planlama'
    stageTerms = planning
  }
  if (stage !== 'bilinmiyor') explanation.push(`Aşama: ${stage} (${stageTerms.join(', ')})`)

  // Kategoriler
  const active = input.activeCategories ? new Set(input.activeCategories) : null
  const categories: CategoryMatch[] = []
  let genericDoorOnly = false
  for (const cat of CATEGORIES) {
    if (active && !active.has(cat.key)) continue
    const extra = (input.extraKeywords?.[cat.key] ?? []).map((k) => foldTokens(k).join(' ')).filter(Boolean)
    const r = matchCategory(cat, tokens, isProcurement, extra)
    if (!r.terms.length) continue
    if (cat.key === 'kurumsal_bina_kapi' && r.weakOnly) genericDoorOnly = true
    categories.push({ key: cat.key, need: isProcurement ? 'dogrulanmis' : 'potansiyel', terms: r.terms, reason: isProcurement ? 'ihale_urun' : 'haber_urun' })
  }
  // Tek başına "kapı" (yalnız ilanda): özgül kapı türü varsa düşer; toplu konutta toplu konut kapı işlerine taşınır
  if (genericDoorOnly) {
    const i = categories.findIndex((c) => c.key === 'kurumsal_bina_kapi')
    const specificDoor = categories.some((c) => c.key !== 'kurumsal_bina_kapi' && CATEGORIES.find((d) => d.key === c.key)?.group === 'kapi')
    if (specificDoor) categories.splice(i, 1)
    else if (pt?.def.key === 'toplu_konut' && (!active || active.has('toplu_konut_kapi'))) categories[i] = { ...categories[i], key: 'toplu_konut_kapi' }
  }
  for (const c of categories) {
    explanation.push(
      c.need === 'dogrulanmis'
        ? `Doğrulanmış ihtiyaç — ilan ürünü açıkça adlandırıyor: ${c.key} (${c.terms.join(', ')})`
        : `Potansiyel ihtiyaç — ürün haberde geçiyor, ilan değil: ${c.key} (${c.terms.join(', ')})`,
    )
  }
  // Proje türünden çıkarım (yalnız potansiyel)
  if (pt) {
    for (const key of pt.def.needs) {
      if (active && !active.has(key)) continue
      if (categories.some((c) => c.key === key)) continue
      categories.push({ key, need: 'potansiyel', terms: [`proje türü: ${pt.def.label}`], reason: 'proje_turu' })
    }
    explanation.push(`Proje türünden olası (doğrulanmamış) ihtiyaçlar: ${pt.def.needs.join(', ')}`)
  }

  // Sektör
  const orgs = extractOrganizations(text)
  const kamuSignals: string[] = []
  const ozelSignals: string[] = []
  for (const o of orgs) {
    if (PUBLIC_SUFFIX.test(o.name) || /TOKİ/.test(o.name) || /(Devlet|Şehir|Eğitim ve Araştırma) Hastanesi$/.test(o.name)) kamuSignals.push(o.name)
    else if (/(A\.\s?Ş\.?|AŞ|A\.S\.|Ltd\.?\s*Şti\.?|Limited Şirketi|Anonim Şirketi|Holding)$/.test(o.name)) ozelSignals.push(o.name)
  }
  const ft = fold(text)
  if (/\bkamu\b|dogrudan temin|4734|acik ihale usul|ekap/.test(ft)) kamuSignals.push('kamu ihale ifadesi')
  if (/\bozel sektor|\bozel yatirim|\byatirimci firma|\brezidans/.test(ft)) ozelSignals.push('özel yatırım ifadesi')
  if (input.sectorHint === 'kamu') kamuSignals.push('kaynak: kamu')
  if (input.sectorHint === 'ozel') ozelSignals.push('kaynak: özel')
  const sector: Sector = kamuSignals.length > ozelSignals.length ? 'kamu' : ozelSignals.length > kamuSignals.length ? 'ozel' : 'bilinmiyor'

  // Konum
  const geo = detectLocation(title, summary)
  if (geo.city) explanation.push(`Konum: ${geo.city}${geo.district ? ` / ${geo.district}` : ''} ("${geo.matchedText}", güven ${Math.round(geo.confidence * 100)}%)`)

  // Riskler
  const risks: RiskCode[] = []
  const today = input.now.toISOString().slice(0, 10)
  if (stage === 'tamamlandi') risks.push('tamamlanmis_proje')
  if (tender.deadline && tender.deadline < today) risks.push('son_tarih_gecti')
  if (input.publishedAt) {
    const age = (input.now.getTime() - Date.parse(input.publishedAt)) / 86400000
    if (age > 180) risks.push('eski_ilan')
  } else risks.push('tarih_yok')
  if (!categories.some((c) => c.need === 'dogrulanmis')) risks.push('kapsam_belirsiz')
  if (!geo.city) risks.push('konum_belirsiz')

  return {
    version: 1,
    projectType: pt ? { key: pt.def.key, label: pt.def.label, terms: pt.terms } : null,
    sector,
    sectorSignals: sector === 'kamu' ? kamuSignals : sector === 'ozel' ? ozelSignals : [...kamuSignals, ...ozelSignals],
    stage,
    stageTerms,
    isProcurement,
    tender,
    categories,
    geo,
    organizations: orgs,
    risks,
    explanation,
  }
}
