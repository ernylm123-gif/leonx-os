/**
 * LEONX Radar — deterministik Türkçe soru ayrıştırıcı (asistan paneli).
 *
 * Yalnız VERİLEN kayıtlardan yanıt üretir; tahmin yapmaz, dış kaynağa gitmez. Eşleşme yoksa
 * yanıt tam olarak "Doğrulanmış sonuç bulunamadı." olur.
 *
 * Desteklenen niyetler: şehir/ilçe süzgeci, kategori süzgeci, son N gün, en yüksek N, kamu/özel,
 * doğrulanmış, bu hafta son tarihi olanlar, "ana yüklenici kim", "nasıl teklif gönderebilirim",
 * "tanıtım e-postası hazırla" (şablon taslak; gönderim yok).
 */
import { detectLocation } from './geo.ts'
import { CATEGORIES, categoryName } from './taxonomy.ts'
import { findPhrase, fold, foldTokens, phraseOf } from './text.ts'

export const NOT_FOUND = 'Doğrulanmış sonuç bulunamadı.'

export interface AssistantCompany {
  name: string
  role: string
  verified: boolean
  website: string | null
  contacts: { kind: string; value: string; source_url: string; verified_at: string }[]
}

export interface AssistantOpportunity {
  id: string
  title: string
  city: string | null
  district: string | null
  is_ankara: boolean
  sector: string
  stage: string
  score: number
  reliability: number
  verified_need: boolean
  deadline: string | null
  first_seen_at: string
  last_updated_at: string
  status: string
  tender: { ikn?: string | null } | null
  categories: { key: string; need_status: string }[]
  companies: AssistantCompany[]
  sources: { url: string; published_at: string | null; accessed_at: string }[]
}

export type AssistantIntent = 'liste' | 'ana_yuklenici' | 'teklif_yolu' | 'eposta' | 'son_tarih' | 'yok'

export interface AssistantAnswer {
  intent: AssistantIntent
  text: string
  /** Yanıtın dayandığı fırsat kimlikleri */
  recordIds: string[]
  draft?: { subject: string; body: string }
}

export interface AssistantContext {
  now: Date
  /** LEONX yetkinlikleri (ayarlardan; yoksa şirket yapılandırmasındaki genel ifadeler) */
  capabilities: string[]
  companyName: string
  website: string | null
}

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : 'bilinmiyor')

function line(o: AssistantOpportunity): string {
  const loc = o.city ? `${o.city}${o.district ? ` / ${o.district}` : ''}` : 'konum bilinmiyor'
  const need = o.verified_need ? 'Doğrulanmış ihtiyaç' : 'Potansiyel — doğrulanmadı'
  return `• ${o.title} — ${loc} · puan ${o.score} · güvenilirlik ${o.reliability} · ${need}${o.deadline ? ` · son tarih ${fmtDate(o.deadline)}` : ''}`
}

/** Sorudaki fırsat referansı: "#kimlik-öneki", tırnak içindeki başlık parçası veya başlık sözcük örtüşmesi */
export function findReferenced(q: string, opps: AssistantOpportunity[]): AssistantOpportunity | null {
  const idm = /#([0-9a-f]{6,36})/i.exec(q)
  if (idm) return opps.find((o) => o.id.toLowerCase().startsWith(idm[1].toLowerCase())) ?? null
  const qm = /["“”'‘’«]([^"“”'‘’»]{3,})["“”'‘’»]/.exec(q)
  if (qm) {
    const needle = fold(qm[1]).trim()
    return opps.find((o) => fold(o.title).includes(needle)) ?? null
  }
  const STOP = new Set(['ana', 'yuklenici', 'kim', 'nasil', 'teklif', 'gonderebilirim', 'icin', 'tanitim', 'eposta', 'posta', 'hazirla', 'taslak', 'bu', 'projenin', 'projesi', 'proje', 'firsat', 'firsatin', 'firsati', 'mail', 'yaz', 'kimdir', 'nedir', 've', 'ile', 'olan'])
  const qt = new Set(foldTokens(q).filter((t) => t.length >= 3 && !STOP.has(t)))
  let best: AssistantOpportunity | null = null
  let bestN = 0
  for (const o of opps) {
    const n = foldTokens(o.title).filter((t) => qt.has(t)).length
    if (n > bestN) {
      bestN = n
      best = o
    }
  }
  return bestN >= 2 ? best : null
}

function matchCategories(q: string): string[] {
  const toks = foldTokens(q)
  const out: string[] = []
  for (const c of CATEGORIES) {
    const names = [c.name, ...c.keywords]
    if (names.some((n) => findPhrase(toks, phraseOf(n)) !== -1)) out.push(c.key)
  }
  return out
}

/** Bu haftanın son günü (Pazar) — ISO tarih */
function endOfWeek(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + (7 - dow))
  return d.toISOString().slice(0, 10)
}

export function draftEmail(o: AssistantOpportunity, ctx: AssistantContext, company?: AssistantCompany | null): { subject: string; body: string } {
  const verified = o.categories.filter((c) => c.need_status === 'dogrulanmis').map((c) => categoryName(c.key))
  const potential = o.categories.filter((c) => c.need_status !== 'dogrulanmis').map((c) => categoryName(c.key))
  const cats = verified.length ? verified : potential.slice(0, 3)
  const subject = `${o.title.slice(0, 120)} — ${cats.length ? cats.join(', ') : 'iş kalemleri'} hakkında bilgi ve teklif talebi`
  const src = o.sources[0]
  const lines = [
    company ? `Sayın ${company.name} yetkilisi,` : 'Sayın Yetkili,',
    '',
    `"${o.title}" projesine ilişkin kamuya açık kaynakta yer alan bilgi üzerine iletişime geçiyoruz.`,
    verified.length
      ? `Kaynakta ${verified.join(', ')} ihtiyacı belirtilmektedir.`
      : cats.length
        ? `Projede ${cats.join(', ')} ihtiyacı olabileceğini değerlendiriyoruz; bu bir tahmindir ve sizinle doğrulamak isteriz.`
        : 'Projenin kapsamı hakkında bilgi almak isteriz.',
    '',
    `${ctx.companyName} olarak faaliyet alanlarımız:`,
    ...ctx.capabilities.map((c) => `• ${c}`),
    '',
    'İlgili iş kalemleri için teklif hazırlayabilmemiz amacıyla, uygun görürseniz aşağıdaki belgeleri paylaşmanızı rica ederiz:',
    '• Teknik şartname',
    '• Mimari çizimler / pafta listesi (DWG, DXF veya PDF)',
    '• Metraj veya adet listesi',
    '• Teklif son tarihi, teslim ve montaj koşulları',
    '',
    src ? `Kaynak: ${src.url} (erişim: ${fmtDate(src.accessed_at)})` : '',
    '',
    'Saygılarımızla,',
    ctx.companyName,
    ctx.website ?? '',
  ]
  return { subject, body: lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim() }
}

export function answer(question: string, opps: AssistantOpportunity[], ctx: AssistantContext): AssistantAnswer {
  const q = question.trim()
  const f = fold(q)
  const none: AssistantAnswer = { intent: 'yok', text: NOT_FOUND, recordIds: [] }
  if (!q || !opps.length) return { ...none }

  // --- Tanıtım e-postası
  if (/(e ?-?posta|mail)/.test(f) && /(hazirla|taslak|yaz|olustur)/.test(f)) {
    const o = findReferenced(q, opps)
    if (!o) return { ...none, intent: 'eposta' }
    const co = o.companies.find((c) => c.role === 'ana_yuklenici') ?? o.companies[0] ?? null
    const draft = draftEmail(o, ctx, co)
    return { intent: 'eposta', text: `Taslak hazırlandı (otomatik gönderilmez; gözden geçirip kendiniz gönderin):\n\nKonu: ${draft.subject}\n\n${draft.body}`, recordIds: [o.id], draft }
  }

  // --- Ana yüklenici
  if (/ana yuklenici|yuklenici kim|muteahhit/.test(f)) {
    const o = findReferenced(q, opps)
    if (!o) return { ...none, intent: 'ana_yuklenici' }
    const list = o.companies.filter((c) => c.role === 'ana_yuklenici')
    if (!list.length) return { ...none, intent: 'ana_yuklenici', recordIds: [] }
    return {
      intent: 'ana_yuklenici',
      text: `"${o.title}" için kaynaklarda ana yüklenici olarak geçen firma(lar):\n${list.map((c) => `• ${c.name}${c.verified ? ' (doğrulandı)' : ' (rol tahmini — doğrulanmadı)'}`).join('\n')}`,
      recordIds: [o.id],
    }
  }

  // --- Nasıl teklif gönderebilirim
  if (/nasil teklif|teklif nasil|teklifi nasil|nasil ulas|kime teklif|teklif yolu/.test(f)) {
    const o = findReferenced(q, opps)
    if (!o) return { ...none, intent: 'teklif_yolu' }
    const rows: string[] = []
    if (o.tender?.ikn) rows.push(`• İhale kayıt numarası (İKN): ${o.tender.ikn} — ihale dokümanı ilgili resmî ihale sistemi üzerinden alınır`)
    if (o.deadline) rows.push(`• Son teklif tarihi: ${fmtDate(o.deadline)}`)
    for (const c of o.companies) for (const k of c.contacts) rows.push(`• ${c.name} — ${k.kind}: ${k.value} (kaynak: ${k.source_url}, doğrulama: ${fmtDate(k.verified_at)})`)
    if (!rows.length) return { ...none, intent: 'teklif_yolu' }
    for (const s of o.sources.slice(0, 3)) rows.push(`• Kaynak: ${s.url} (yayın: ${fmtDate(s.published_at)}, erişim: ${fmtDate(s.accessed_at)})`)
    return { intent: 'teklif_yolu', text: `"${o.title}" için doğrulanmış teklif / iletişim yolları:\n${rows.join('\n')}`, recordIds: [o.id] }
  }

  // --- Liste sorguları
  let list = [...opps]
  let filtered = false
  const today = ctx.now.toISOString().slice(0, 10)
  let intent: AssistantIntent = 'liste'
  if (/(son tarih|son teklif|suresi dol|yaklasan|bu hafta)/.test(f) && /(bu hafta|hafta)/.test(f)) {
    const end = endOfWeek(ctx.now)
    list = list.filter((o) => o.deadline && o.deadline >= today && o.deadline <= end)
    intent = 'son_tarih'
    filtered = true
  }
  const geo = detectLocation(q)
  if (geo.district) {
    list = list.filter((o) => o.district && fold(o.district) === fold(geo.district!))
    filtered = true
  } else if (geo.city) {
    list = list.filter((o) => o.city && fold(o.city) === fold(geo.city!))
    filtered = true
  }
  const cats = matchCategories(q)
  if (cats.length) {
    list = list.filter((o) => o.categories.some((c) => cats.includes(c.key)))
    filtered = true
  }
  const days = /son\s+(\d{1,3})\s+gun/.exec(f)
  if (days || /\bbugun/.test(f)) {
    const n = days ? Number(days[1]) : 1
    const from = new Date(ctx.now.getTime() - n * 86400000).toISOString()
    list = list.filter((o) => o.first_seen_at >= from)
    filtered = true
  }
  if (/\bkamu/.test(f)) {
    list = list.filter((o) => o.sector === 'kamu')
    filtered = true
  } else if (/\bozel\b|\bozel sektor/.test(f)) {
    list = list.filter((o) => o.sector === 'ozel')
    filtered = true
  }
  if (/dogrulanmis/.test(f)) {
    list = list.filter((o) => o.verified_need)
    filtered = true
  }
  const top = /(?:en yuksek|en iyi|ilk|top)\s*(\d{1,3})|(\d{1,3})\s*(?:firsat|proje|kayit)/.exec(f)
  let limit = 20
  if (top || /en yuksek|en iyi|oncelikli/.test(f)) {
    limit = Number(top?.[1] ?? top?.[2] ?? 5) || 5
    filtered = true
  }
  if (!filtered) return { ...none }
  list.sort((a, b) => (intent === 'son_tarih' ? (a.deadline ?? '').localeCompare(b.deadline ?? '') : b.score - a.score || Number(b.is_ankara) - Number(a.is_ankara)))
  list = list.slice(0, Math.max(1, Math.min(50, limit)))
  if (!list.length) return { ...none, intent }
  return { intent, text: `${list.length} kayıt bulundu:\n${list.map(line).join('\n')}`, recordIds: list.map((o) => o.id) }
}
