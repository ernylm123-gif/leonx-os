/**
 * LEONX Radar — özel sektör proje istihbaratı: kanıtlı aşama, şeffaf fırsat puanı ve satış bölümleri.
 *
 * AŞAMA: 019 aşama tespiti (construction.ts) kanıt tarihi ve güvenle birlikte saklanır. Yakın tarihli
 * kanıt yoksa proje "aktif" sayılmaz; aşama belirsizse "Aşama doğrulanamadı" gösterilir (tahmin yok).
 *
 * PUAN (0–100): kamu ihalesinin belgelerinin daha düzenli olması ona avantaj sağlamaz. Doğrulanmış
 * satın alma ihtiyacı yalnız 12 puanlık bir etkendir; asıl ağırlık ürün uyumu, inşaat aşaması ve
 * kanıtın güncelliğidir. Ölçek uyumunda küçük/yerel/orta yükleniciler EŞİT (1,0), büyük firmalar
 * yerleşik tedarikçileri olabileceği için 0,8 alır; görünürlük puan getirmez.
 * İletişim ve önceki temas etkenleri veritabanında (radar_private_finalize) güncel kayıtlarla eklenir.
 */
import type { Classification } from './classify.ts'
import { type ConstructionIntel, type ConstructionStage, PRODUCT_LABEL, type ProductGroup, STAGE_LABEL } from './construction.ts'
import type { PageKind, SizeBand } from './company.ts'

// ------------------------------------------------------------------ Aşama + kanıt

export type StageConfidence = 'yuksek' | 'orta' | 'dusuk'
export const CONFIDENCE_LABEL: Record<StageConfidence, string> = { yuksek: 'Yüksek', orta: 'Orta', dusuk: 'Düşük' }
export const STAGE_UNVERIFIED = 'Aşama doğrulanamadı'

export interface StageAssessment {
  stage: ConstructionStage | null
  /** Ekranda gösterilecek metin (belirsizse "Aşama doğrulanamadı") */
  display: string
  confidence: StageConfidence | null
  /** true: yakın tarihli (≤180 gün) kanıtla devam eden inşaat · false: tamamlanmış veya kanıt eski · null: bilinmiyor */
  active: boolean | null
  /** Yeni başlayan inşaat (ruhsat/temel atma/hafriyat/temel; ≤120 gün) */
  newStart: boolean
  evidenceDate: string | null
  ageDays: number | null
  explanation: string
}

const EARLY: ConstructionStage[] = ['ruhsat', 'temel_atma', 'hafriyat', 'temel']

export function assessStage(intel: Pick<ConstructionIntel, 'stage' | 'stageTerms'>, publishedAt: string | null, now: Date, pageKind: PageKind | null = null): StageAssessment {
  const age = publishedAt && Number.isFinite(Date.parse(publishedAt)) ? Math.floor((now.getTime() - Date.parse(publishedAt)) / 86400000) : null
  const terms = intel.stageTerms.slice(0, 3).map((t) => `"${t}"`).join(', ')
  if (!intel.stage) {
    return { stage: null, display: STAGE_UNVERIFIED, confidence: null, active: null, newStart: false, evidenceDate: publishedAt, ageDays: age, explanation: pageKind === 'firma_proje_sayfasi' ? 'Firma proje sayfasında aşama ifadesi bulunamadı; firma listelemesi tek başına aktif inşaat kanıtı değildir' : 'Kaynakta inşaat aşaması ifadesi yok' }
  }
  const label = STAGE_LABEL[intel.stage]
  if (intel.stage === 'tamamlandi') {
    return { stage: 'tamamlandi', display: label, confidence: age !== null && age <= 365 ? 'yuksek' : 'orta', active: false, newStart: false, evidenceDate: publishedAt, ageDays: age, explanation: `Kaynakta tamamlandığı yazıyor (${terms})` }
  }
  if (age === null) {
    return { stage: intel.stage, display: `${STAGE_UNVERIFIED} (son bilinen: ${label}, tarihsiz kanıt)`, confidence: 'dusuk', active: null, newStart: false, evidenceDate: null, ageDays: null, explanation: `Kaynakta ${terms} geçiyor ama yayın tarihi yok; güncel aşama doğrulanamadı` }
  }
  if (age > 180) {
    return { stage: intel.stage, display: `${STAGE_UNVERIFIED} (son kanıt ${age} gün önce: ${label})`, confidence: 'dusuk', active: false, newStart: false, evidenceDate: publishedAt, ageDays: age, explanation: `Son aşama kanıtı ${age} gün önce (${terms}); 180 günden eski kanıtla proje aktif sayılmaz` }
  }
  const confidence: StageConfidence = age <= 90 ? 'yuksek' : 'orta'
  return {
    stage: intel.stage,
    display: label,
    confidence,
    active: true,
    newStart: EARLY.includes(intel.stage) && age <= 120,
    evidenceDate: publishedAt,
    ageDays: age,
    explanation: `Kaynakta ${terms} geçiyor; kanıt ${age} gün önce yayımlanmış (${confidence === 'yuksek' ? '≤90 gün' : '90–180 gün'})`,
  }
}

// ------------------------------------------------------------------ Puan

export type PrivateWeightKey = 'urun' | 'asama' | 'guncellik' | 'cografya' | 'talep' | 'iletisim' | 'gecmis' | 'olcek'
export const PRIVATE_WEIGHTS: Record<PrivateWeightKey, number> = { urun: 22, asama: 20, guncellik: 15, cografya: 12, talep: 12, iletisim: 10, gecmis: 4, olcek: 5 }
export const PRIVATE_WEIGHT_LABEL: Record<PrivateWeightKey, string> = {
  urun: 'Ürün uyumu',
  asama: 'İnşaat aşaması',
  guncellik: 'Kanıtın güncelliği',
  cografya: 'Coğrafi uygunluk',
  talep: 'Doğrulanmış satın alma ihtiyacı',
  iletisim: 'Kurumsal iletişim kanalı',
  gecmis: 'Önceki temas geçmişi',
  olcek: 'Ölçek uyumu',
}

export interface PrivateScorePart {
  key: PrivateWeightKey
  label: string
  weight: number
  factor: number
  points: number
  reason: string
}

const STAGE_FACTOR: Record<ConstructionStage, number> = {
  ruhsat: 0.5, temel_atma: 0.6, hafriyat: 0.6, temel: 0.65, kaba_insaat: 0.9, kaba_tamam: 1, duvar: 1, cephe: 0.85, dograma: 0.8, ince_isler: 0.6, tamamlandi: 0,
}
const CONF_FACTOR: Record<StageConfidence, number> = { yuksek: 1, orta: 0.8, dusuk: 0.5 }

export interface PrivateScoreInput {
  products: { group: ProductGroup; basis: 'kaynak' | 'olasi' }[]
  stage: StageAssessment
  city: string | null
  district: string | null
  isAnkara: boolean
  verifiedNeed: boolean
  supplierInvite: boolean
  size: SizeBand
  /** Veritabanındaki gerçek durum (keşif anında bilinmiyorsa varsayılanlar) */
  contact?: 'satinalma' | 'genel' | 'site' | 'yok'
  lastContactDays?: number | null
}

function part(key: PrivateWeightKey, factor: number, reason: string): PrivateScorePart {
  const f = Math.max(0, Math.min(1, factor))
  const w = PRIVATE_WEIGHTS[key]
  return { key, label: PRIVATE_WEIGHT_LABEL[key], weight: w, factor: Math.round(f * 100) / 100, points: Math.round(w * f * 10) / 10, reason }
}

export function contactPart(contact: PrivateScoreInput['contact']): PrivateScorePart {
  return contact === 'satinalma' ? part('iletisim', 1, 'Doğrulanmış satın alma / tedarikçi kanalı var')
    : contact === 'genel' ? part('iletisim', 0.7, 'Doğrulanmış kurumsal genel e-posta/telefon var')
      : contact === 'site' ? part('iletisim', 0.4, 'Firma web sitesi biliniyor, iletişim kanalı henüz doğrulanmadı')
        : part('iletisim', 0, 'Kurumsal iletişim kanalı yok')
}

export function historyPart(lastContactDays: number | null | undefined): PrivateScorePart {
  return lastContactDays === null || lastContactDays === undefined ? part('gecmis', 1, 'Daha önce temas kurulmadı')
    : lastContactDays > 90 ? part('gecmis', 0.6, `Son temas ${lastContactDays} gün önce`)
      : part('gecmis', 0, `Son temas ${lastContactDays} gün önce (90 günden yakın)`)
}

export function privateScore(i: PrivateScoreInput): { score: number; parts: PrivateScorePart[] } {
  const parts: PrivateScorePart[] = []
  const src = i.products.filter((p) => p.basis === 'kaynak')
  parts.push(src.length ? part('urun', 1, `Kaynakta geçen ürün: ${src.map((p) => PRODUCT_LABEL[p.group]).join(', ')}`)
    : i.products.length ? part('urun', 0.6, `Proje türünden olası ürünler: ${i.products.slice(0, 4).map((p) => PRODUCT_LABEL[p.group]).join(', ')}`)
      : part('urun', 0, 'LEONX METAL / ERLİN KAPI ürünüyle eşleşme yok'))
  const st = i.stage
  parts.push(st.stage ? part('asama', STAGE_FACTOR[st.stage] * (st.confidence ? CONF_FACTOR[st.confidence] : 0.5) * (st.active === false && st.stage !== 'tamamlandi' ? 0.5 : 1), `${st.display}${st.confidence ? ` · güven ${CONFIDENCE_LABEL[st.confidence].toLocaleLowerCase('tr-TR')}` : ''}`)
    : part('asama', 0.25, STAGE_UNVERIFIED))
  const age = st.ageDays
  parts.push(age === null ? part('guncellik', 0.3, 'Kanıtın yayın tarihi yok') : age <= 30 ? part('guncellik', 1, 'Son 30 gün') : age <= 90 ? part('guncellik', 0.8, '30–90 gün') : age <= 180 ? part('guncellik', 0.5, '90–180 gün') : part('guncellik', 0.1, `${age} gün önce`))
  parts.push(i.isAnkara ? (i.district ? part('cografya', 1, `Ankara / ${i.district}`) : part('cografya', 0.9, 'Ankara (ilçe belirsiz)'))
    : i.city === 'Hatay' || i.city === 'Kahramanmaraş' ? part('cografya', 0.6, `${i.city} (ikincil bölge)`)
      : i.city ? part('cografya', 0.1, i.city) : part('cografya', 0.3, 'Konum bilinmiyor'))
  parts.push(i.verifiedNeed ? part('talep', 1, 'Satın alma / teklif talebi kaynakla doğrulandı')
    : i.supplierInvite ? part('talep', 0.6, 'Tedarikçi daveti ifadesi var; ürün kaynakta adlandırılmadı')
      : part('talep', 0, 'Açık satın alma talebi doğrulanmadı (potansiyel fırsat)'))
  parts.push(contactPart(i.contact ?? 'yok'))
  parts.push(historyPart(i.lastContactDays))
  parts.push(i.size === 'buyuk' ? part('olcek', 0.8, 'Büyük proje: yerleşik tedarikçileri olabilir') : i.size === 'bilinmiyor' ? part('olcek', 0.7, 'Ölçek bilinmiyor') : part('olcek', 1, 'Küçük/yerel/orta ölçek: doğrudan karar verici, eşit öncelik'))
  return { score: Math.max(0, Math.min(100, Math.round(parts.reduce((a, p) => a + p.points, 0)))), parts }
}

// ------------------------------------------------------------------ Bölümler

export type Segment = 'ozel_proje' | 'yeni_baslayan' | 'aktif_santiye' | 'teklif_firsati' | 'kamu_ihale'
export const SEGMENT_LABEL: Record<Segment, string> = {
  ozel_proje: 'Özel Sektör Projeleri',
  yeni_baslayan: 'Yeni Başlayan İnşaatlar',
  aktif_santiye: 'Aktif Şantiyeler',
  teklif_firsati: 'Teklif Fırsatları',
  kamu_ihale: 'Kamu İhaleleri',
}

export function segmentsFor(i: { sector: 'kamu' | 'ozel' | 'bilinmiyor'; stage: StageAssessment; verifiedNeed: boolean; supplierInvite: boolean; isProcurement: boolean; hasCompany: boolean }): Segment[] {
  if (i.sector === 'kamu') return ['kamu_ihale']
  // Sektörü belirsiz ve firması yoksa özel sektör listesine alınmaz (kanıt yok)
  if (i.sector === 'bilinmiyor' && !i.hasCompany) return i.isProcurement ? ['kamu_ihale'] : []
  const out: Segment[] = ['ozel_proje']
  if (i.stage.newStart) out.push('yeni_baslayan')
  if (i.stage.active && !i.stage.newStart) out.push('aktif_santiye')
  if (i.verifiedNeed || i.supplierInvite) out.push('teklif_firsati')
  return out
}

/** Neden ilgili bir müşteri olabilir? (kanıta dayalı kısa açıklama; satın alma iddiası içermez) */
export function relevanceExplanation(i: { companyName: string | null; projectTypeLabel: string | null; district: string | null; city: string | null; stage: StageAssessment; products: ProductGroup[]; verifiedNeed: boolean; unitText: string | null }): string {
  const who = i.companyName ? `${i.companyName}` : 'Yüklenici (adı kaynakta yok)'
  const where = i.district ? `${i.district}${i.city && i.city !== i.district ? ` / ${i.city}` : ''}` : i.city ?? 'konumu belirsiz'
  const what = [i.unitText, i.projectTypeLabel?.toLocaleLowerCase('tr-TR')].filter(Boolean).join(' ') || 'inşaat projesi'
  const stage = i.stage.stage && i.stage.active ? `${i.stage.display.toLocaleLowerCase('tr-TR')} aşamasında` : i.stage.display.toLocaleLowerCase('tr-TR')
  const products = i.products.slice(0, 4).map((g) => PRODUCT_LABEL[g].toLocaleLowerCase('tr-TR')).join(', ')
  const need = i.verifiedNeed ? 'Kaynakta açık satın alma/teklif talebi var.' : 'Açık bir tedarikçi talebi doğrulanmadı; bu bir potansiyel fırsattır.'
  return `${who}, ${where} bölgesinde ${what} (${stage}). ${products ? `Uygun ürünler: ${products}. ` : ''}${need}`
}

/** Keşif kaydının sınıflandırmadan türetilen özeti */
export function procurementStatus(c: Pick<Classification, 'isProcurement'>, verifiedNeed: boolean, supplierInvite: boolean): 'dogrulanmis_talep' | 'tedarikci_daveti' | 'potansiyel' {
  return verifiedNeed && c.isProcurement ? 'dogrulanmis_talep' : supplierInvite || verifiedNeed ? 'tedarikci_daveti' : 'potansiyel'
}
