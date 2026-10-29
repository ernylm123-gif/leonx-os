/**
 * LEONX Radar — inşaat satış istihbaratı (kural tabanlı, açıklanabilir).
 *
 * Bir kaynak öğesinden şunları çıkarır:
 *  • İnşaat aşaması (ruhsat → temel atma → hafriyat → temel → kaba inşaat → kaba inşaat tamam →
 *    duvar → cephe → doğrama montajı → ince işler → tamamlandı). Metinde birden çok aşama geçerse
 *    en ileri aşama alınır ("kaba inşaat tamamlandı, ince işlere geçildi" → ince işler).
 *  • Satın alma zamanlaması: YALNIZ ÇIKARIM ('tahmin: true'); kaynakta yazmaz, hiçbir zaman
 *    doğrulanmış bilgi olarak gösterilmez.
 *  • Satış sınıfı: A doğrulanmış açık talep (ilan/RFQ/tedarikçi daveti + ürün), B yüksek öncelikli
 *    aktif proje (açık talep yok), C erken aşama (izlenecek), D düşük ilgi. B ve C asla satın alma
 *    fırsatı olarak sunulmaz.
 *  • LEONX / ERLIN KAPI ürün grupları (taksonomi kategorilerinden ve proje türünden; proje türünden
 *    gelenler 'olasi' işaretlidir).
 *  • Bölge önceliği: 1 Ankara, 2 Hatay, 3 Kahramanmaraş, 4 komşu iller, 5 diğer iller.
 *  • Hariç tutulan firmalar (ör. sahibin listesi): eşleşirse sınıf D ve öneri yapılmaz.
 *
 * Kaynak metni yalnız VERİDİR; içindeki talimatlar yorumlanmaz.
 */
import type { Classification } from './classify.ts'
import { findPrefixPhrase } from './classify.ts'
import { fold, foldTokens, phraseOf } from './text.ts'

export type ConstructionStage =
  | 'ruhsat' | 'temel_atma' | 'hafriyat' | 'temel' | 'kaba_insaat' | 'kaba_tamam' | 'duvar' | 'cephe' | 'dograma' | 'ince_isler' | 'tamamlandi'

/** Sıra = ilerleme. Anahtar sözcükler katlanmış (ASCII) ve sözcük-başı önekidir. */
export const STAGES: { key: ConstructionStage; label: string; terms: string[] }[] = [
  { key: 'ruhsat', label: 'Yapı ruhsatı', terms: ['yapi ruhsat', 'insaat ruhsat', 'ruhsat alindi', 'ruhsati alindi', 'ruhsatini aldi', 'ruhsat verildi'] },
  { key: 'temel_atma', label: 'Temel atma', terms: ['temel atma', 'temeli atildi', 'temelini att', 'temel atildi', 'ilk kazma'] },
  { key: 'hafriyat', label: 'Hafriyat / kazı', terms: ['hafriyat', 'kazi calisma', 'kazi isleri', 'iksa', 'zemin iyilestirme', 'fore kazik'] },
  { key: 'temel', label: 'Temel', terms: ['temel betonu', 'radye temel', 'temel insaat', 'temel calisma', 'temel isleri', 'temel seviyesi'] },
  { key: 'kaba_insaat', label: 'Kaba inşaat / karkas', terms: ['kaba insaat', 'karkas', 'betonarme', 'kat betonu', 'beton dokum', 'kat kat yuksel', 'yukseliyor', 'insaati sur', 'insaati devam', 'insaat devam', 'yapimi sur', 'yapimi devam', 'insaat calismalari sur'] },
  { key: 'kaba_tamam', label: 'Kaba inşaat tamamlandı', terms: ['kaba insaat tamamlan', 'kaba insaati tamamlan', 'karkas tamamlan', 'karkasi tamamlan', 'cati katina ulas', 'son kat betonu', 'en ust kata ulas', 'betonarme tamamlan'] },
  { key: 'duvar', label: 'Duvar örme', terms: ['duvar orme', 'duvar ormeleri', 'duvarlari oruluyor', 'tugla duvar', 'gazbeton duvar', 'bims duvar'] },
  { key: 'cephe', label: 'Cephe', terms: ['cephe kaplama', 'cephe montaj', 'cephe calisma', 'cephe isleri', 'mantolama', 'dis cephe calisma', 'giydirme cephe montaj'] },
  { key: 'dograma', label: 'Doğrama / pencere montajı', terms: ['dograma montaj', 'pencere montaj', 'pencereler takil', 'dogramalar takil', 'dograma isleri basla', 'pencere dograma montaj'] },
  { key: 'ince_isler', label: 'İnce işler', terms: ['ince isler', 'ince insaat', 'ic mimari', 'boya badana', 'seramik dosem', 'ince iscilik', 'ic mekan isleri', 'parke dosem'] },
  { key: 'tamamlandi', label: 'Tamamlandı', terms: ['tamamlandi', 'hizmete girdi', 'hizmete acildi', 'acilisi yapildi', 'teslim edildi', 'kullanima acildi', 'anahtar teslim toren', 'anahtarlari teslim'] },
]

const STAGE_INDEX: Record<ConstructionStage, number> = Object.fromEntries(STAGES.map((s, i) => [s.key, i])) as Record<ConstructionStage, number>
export const STAGE_LABEL: Record<ConstructionStage, string> = Object.fromEntries(STAGES.map((s) => [s.key, s.label])) as Record<ConstructionStage, string>

/** LEONX / ERLIN KAPI ürün grupları (kullanıcı listesi) */
export type ProductGroup = 'aluminyum_cephe' | 'pvc' | 'cam' | 'korkuluk' | 'yangin_kapisi' | 'celik_kapi' | 'ic_kapi' | 'metal_celik'
export const PRODUCT_LABEL: Record<ProductGroup, string> = {
  aluminyum_cephe: 'Alüminyum doğrama ve cephe sistemleri',
  pvc: 'PVC pencere ve kapı',
  cam: 'Cam ve camlama',
  korkuluk: 'Cam ve alüminyum korkuluk',
  yangin_kapisi: 'Yangına dayanıklı kapı',
  celik_kapi: 'Çelik güvenlik kapısı',
  ic_kapi: 'İç kapı',
  metal_celik: 'Metal imalat ve çelik konstrüksiyon',
}

/** Taksonomi kategorisi → ürün grubu */
const CATEGORY_GROUP: Record<string, ProductGroup> = {
  aluminyum_dograma: 'aluminyum_cephe', giydirme_cephe: 'aluminyum_cephe', kompozit_cephe: 'aluminyum_cephe', cephe_yenileme: 'aluminyum_cephe',
  pencere_kapi_sistemleri: 'aluminyum_cephe', surme_sistemleri: 'aluminyum_cephe', dekoratif_metal_cephe: 'aluminyum_cephe',
  pvc_dograma: 'pvc',
  cam_cephe: 'cam', cam_bolme: 'cam', ofis_bolme: 'cam',
  aluminyum_korkuluk: 'korkuluk', kupeste: 'korkuluk', metal_korkuluk: 'korkuluk',
  yangin_kapisi: 'yangin_kapisi', teknik_kapi: 'yangin_kapisi',
  celik_kapi: 'celik_kapi', bina_giris_kapisi: 'celik_kapi', villa_giris_kapisi: 'celik_kapi', pivot_kapi: 'celik_kapi',
  oda_kapisi: 'ic_kapi', ahsap_melamin_kapi: 'ic_kapi', lake_kapi: 'ic_kapi', kurumsal_bina_kapi: 'ic_kapi', toplu_konut_kapi: 'ic_kapi',
  ozel_metal_imalat: 'metal_celik', lazer_kesim: 'metal_celik', plazma_kesim: 'metal_celik', boru_profil_lazer: 'metal_celik',
  cnc_abkant: 'metal_celik', delikli_sac: 'metal_celik', bahce_villa_metal: 'metal_celik',
}

/** Proje türünden OLASI ürün grupları (çıkarım) */
const TYPE_GROUPS: Record<string, ProductGroup[]> = {
  hastane: ['aluminyum_cephe', 'yangin_kapisi', 'ic_kapi', 'cam'],
  otel: ['aluminyum_cephe', 'cam', 'ic_kapi', 'korkuluk', 'yangin_kapisi'],
  toplu_konut: ['pvc', 'celik_kapi', 'ic_kapi', 'korkuluk'],
  avm: ['aluminyum_cephe', 'cam', 'yangin_kapisi'],
  is_merkezi: ['aluminyum_cephe', 'cam', 'yangin_kapisi', 'ic_kapi'],
  okul: ['aluminyum_cephe', 'pvc', 'yangin_kapisi', 'ic_kapi'],
  fabrika: ['metal_celik', 'yangin_kapisi', 'aluminyum_cephe'],
  kamu_binasi: ['aluminyum_cephe', 'yangin_kapisi', 'ic_kapi', 'cam'],
  spor: ['aluminyum_cephe', 'korkuluk', 'yangin_kapisi'],
  villa: ['aluminyum_cephe', 'celik_kapi', 'korkuluk', 'ic_kapi'],
  konut: ['aluminyum_cephe', 'pvc', 'celik_kapi', 'ic_kapi', 'korkuluk'],
  cami: ['aluminyum_cephe', 'metal_celik'],
  otopark: ['korkuluk', 'yangin_kapisi', 'metal_celik'],
}

/** Tedarikçi daveti / teklif talebi işaretleri (ürün de geçmeliyse A) */
const SUPPLIER_INVITE = [
  'tedarikci basvuru', 'tedarikci kayit', 'tedarikci aran', 'tedarikci olmak', 'taseron aran', 'alt yuklenici aran',
  'teklif davet', 'teklif istenm', 'teklif alinacak', 'teklif toplan', 'firmalardan teklif', 'fiyat teklifi talep', 'teklif talep',
]

export const PRIORITY_PROVINCES: Record<string, 1 | 2 | 3> = { Ankara: 1, Hatay: 2, Kahramanmaraş: 3 }
/** Ankara, Hatay ve Kahramanmaraş'a komşu iller */
export const NEIGHBOUR_PROVINCES = [
  'Bolu', 'Çankırı', 'Kırıkkale', 'Kırşehir', 'Aksaray', 'Konya', 'Eskişehir',
  'Adana', 'Osmaniye', 'Gaziantep',
  'Kayseri', 'Sivas', 'Malatya', 'Adıyaman',
]

export function regionPriority(city: string | null): 1 | 2 | 3 | 4 | 5 | null {
  if (!city) return null
  if (PRIORITY_PROVINCES[city]) return PRIORITY_PROVINCES[city]
  return NEIGHBOUR_PROVINCES.includes(city) ? 4 : 5
}

export type SalesClass = 'A' | 'B' | 'C' | 'D'
export const SALES_CLASS_LABEL: Record<SalesClass, string> = {
  A: 'Doğrulanmış aktif fırsat',
  B: 'Yüksek öncelikli proje',
  C: 'Erken aşama proje',
  D: 'Düşük ilgi',
}

export interface ProcurementOutlook {
  /** Her zaman true: bu bir tahmindir, kaynakta yazmaz */
  tahmin: true
  pencere: 'gecmis_olabilir' | 'simdi' | '0-3_ay' | '3-6_ay' | '6-18_ay'
  urunler: ProductGroup[]
  gerekce: string
}

export interface ConstructionIntel {
  version: 1
  stage: ConstructionStage | null
  stageTerms: string[]
  /** Kaynakta inşaat yapıldığına dair işaret (proje haberi/ilerleme) */
  activeConstruction: boolean
  supplierInvite: string[]
  products: { group: ProductGroup; basis: 'kaynak' | 'olasi' }[]
  outlook: ProcurementOutlook | null
  salesClass: SalesClass
  reasons: string[]
  regionPriority: 1 | 2 | 3 | 4 | 5 | null
  excluded: string | null
  action: string
}

function matchTerms(tokens: string[], terms: string[]): string[] {
  return terms.filter((t) => findPrefixPhrase(tokens, phraseOf(t)) !== -1)
}

export function detectStage(tokens: string[]): { stage: ConstructionStage | null; terms: string[] } {
  let best: ConstructionStage | null = null
  const terms: string[] = []
  for (const s of STAGES) {
    const hit = matchTerms(tokens, s.terms)
    if (!hit.length) continue
    // "tamamlandi" yalnız başına bir alt işin tamamlanması olabilir: kaba inşaat tamam ifadesi varsa o aşama
    if (s.key === 'tamamlandi' && terms.some((t) => t.includes('tamamlan'))) continue
    terms.push(...hit)
    if (best === null || STAGE_INDEX[s.key] > STAGE_INDEX[best]) best = s.key
  }
  return { stage: best, terms }
}

/** Aşamadan satın alma zamanlaması — YALNIZ ÇIKARIM */
export function outlookFor(stage: ConstructionStage | null, groups: ProductGroup[]): ProcurementOutlook | null {
  if (!stage || stage === 'tamamlandi') return null
  const exterior = groups.filter((g) => g === 'aluminyum_cephe' || g === 'pvc' || g === 'cam' || g === 'korkuluk' || g === 'metal_celik')
  const interior = groups.filter((g) => g === 'ic_kapi' || g === 'celik_kapi' || g === 'yangin_kapisi')
  const label = STAGE_LABEL[stage]
  switch (stage) {
    case 'ruhsat':
    case 'temel_atma':
    case 'hafriyat':
    case 'temel':
      return { tahmin: true, pencere: '6-18_ay', urunler: groups, gerekce: `${label} aşamasında doğrama, cephe ve kapı alımı genellikle aylar sonradır` }
    case 'kaba_insaat':
      return { tahmin: true, pencere: '3-6_ay', urunler: exterior.length ? exterior : groups, gerekce: `${label} sürerken dış doğrama/cephe tedarikçisi genellikle kaba inşaat bitmeden seçilir` }
    case 'kaba_tamam':
    case 'duvar':
      return { tahmin: true, pencere: '0-3_ay', urunler: groups, gerekce: `${label}: doğrama, cephe ve korkuluk alımı yaklaşmış olabilir; kapılar ince işlerle gelir` }
    case 'cephe':
    case 'dograma':
      return { tahmin: true, pencere: 'simdi', urunler: interior.length ? interior : groups, gerekce: `${label} başlamış: dış doğrama/cephe büyük olasılıkla sözleşmeli; iç kapı ve yangın kapısı alımı yakın olabilir` }
    case 'ince_isler':
      return { tahmin: true, pencere: interior.length ? 'simdi' : 'gecmis_olabilir', urunler: interior, gerekce: `${label}: dış doğrama ve cephe büyük olasılıkla tamamlandı; iç kapı / yangın kapısı için geç kalınmış olabilir` }
  }
}

export interface IntelInput {
  title: string
  summary: string
  classification: Classification
  /** Kayıtlı/bağlı firma adları (hariç tutma kontrolü için) */
  companyNames?: string[]
  /** Hariç tutulan firma kalıpları (katlanmış; ör. "ozcelik insaat") */
  excludedPatterns?: string[]
}

export function analyzeConstruction(input: IntelInput): ConstructionIntel {
  const c = input.classification
  const text = `${input.title}. ${input.summary}`
  const tokens = foldTokens(text)
  const reasons: string[] = []

  const st = detectStage(tokens)
  // Sınıflandırıcının kaba aşaması da işaret sayılır
  const activeConstruction = (st.stage !== null && st.stage !== 'tamamlandi' && st.stage !== 'ruhsat') || c.stage === 'yapim'
  const supplierInvite = matchTerms(tokens, SUPPLIER_INVITE)

  const groups = new Map<ProductGroup, 'kaynak' | 'olasi'>()
  for (const cat of c.categories) {
    const g = CATEGORY_GROUP[cat.key]
    if (!g) continue
    if (cat.reason === 'proje_turu') { if (!groups.has(g)) groups.set(g, 'olasi') }
    else groups.set(g, 'kaynak')
  }
  for (const g of c.projectType ? TYPE_GROUPS[c.projectType.key] ?? [] : []) if (!groups.has(g)) groups.set(g, 'olasi')
  const products = [...groups].map(([group, basis]) => ({ group, basis }))
  const sourceProducts = products.filter((p) => p.basis === 'kaynak')

  const names = [...(input.companyNames ?? []), ...c.organizations.map((o) => o.name)]
  const folded = ` ${fold(text).replace(/[^a-z0-9]+/g, ' ')} `
  let excluded: string | null = null
  for (const p of input.excludedPatterns ?? []) {
    const pat = fold(p).replace(/[^a-z0-9]+/g, ' ').trim()
    if (!pat) continue
    if (folded.includes(` ${pat} `) || names.some((n) => ` ${fold(n).replace(/[^a-z0-9]+/g, ' ')} `.includes(` ${pat} `))) {
      excluded = p
      break
    }
  }

  // Sınıflandırıcı "tamamlandı"yı alt iş için de yakalar ("kaba inşaat tamamlandı"): ayrıntılı aşama önceliklidir
  const completed = st.stage === 'tamamlandi' || (c.stage === 'tamamlandi' && st.stage === null)
  const deadlinePassed = c.risks.includes('son_tarih_gecti')
  const procurement = c.isProcurement || supplierInvite.length > 0
  const relevantProject = !!c.projectType || sourceProducts.length > 0

  let salesClass: SalesClass
  if (excluded) {
    salesClass = 'D'
    reasons.push(`Hariç tutulan firma listesinde: ${excluded}`)
  } else if (completed) {
    salesClass = 'D'
    reasons.push('Proje tamamlanmış görünüyor')
  } else if (procurement && sourceProducts.length > 0 && !deadlinePassed) {
    salesClass = 'A'
    reasons.push(c.isProcurement ? 'Satın alma / ihale ilanı ve LEONX ürünü kaynakta geçiyor' : `Tedarikçi daveti / teklif talebi (${supplierInvite.join(', ')}) ve LEONX ürünü kaynakta geçiyor`)
  } else if (relevantProject && activeConstruction && st.stage && STAGE_INDEX[st.stage] >= STAGE_INDEX.kaba_insaat) {
    salesClass = 'B'
    reasons.push(`Aktif inşaat (${STAGE_LABEL[st.stage]}); açık satın alma ilanı doğrulanmadı`)
  } else if (relevantProject && (activeConstruction || st.stage !== null || c.stage === 'planlama' || c.stage === 'ihale' || procurement)) {
    salesClass = 'C'
    reasons.push(st.stage ? `Erken aşama (${STAGE_LABEL[st.stage]}); izlenmeli` : 'Yeni/planlanan proje; izlenmeli')
    if (deadlinePassed) reasons.push('İlandaki son tarih geçmiş')
  } else {
    salesClass = 'D'
    reasons.push(relevantProject ? 'İnşaat aşaması veya satın alma işareti yok' : 'LEONX ürünü veya ilgili proje türü yok')
  }

  const outlook = salesClass === 'D' ? null : outlookFor(st.stage, products.map((p) => p.group))
  const action =
    salesClass === 'A' ? 'İlan/talep belgesini indir, son tarihi takvime ekle, teklif hazırla'
    : salesClass === 'B' ? 'Yükleniciyi/geliştiriciyi belirle, resmî iletişim kanalından tanıtım ve tedarikçi başvurusu yap'
    : salesClass === 'C' ? 'İzleme listesine al; aşama değişiminde yeniden değerlendir'
    : 'İşlem gerekmiyor'

  return {
    version: 1,
    stage: st.stage,
    stageTerms: st.terms.slice(0, 10),
    activeConstruction,
    supplierInvite: supplierInvite.slice(0, 5),
    products,
    outlook,
    salesClass,
    reasons,
    regionPriority: regionPriority(c.geo.city),
    excluded,
    action,
  }
}
