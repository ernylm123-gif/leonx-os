/**
 * LEONX Radar â€” inÅŸaat satÄ±ÅŸ istihbaratÄ± (kural tabanlÄ±, aÃ§Ä±klanabilir).
 *
 * Bir kaynak Ã¶ÄŸesinden ÅŸunlarÄ± Ã§Ä±karÄ±r:
 *  â€¢ Ä°nÅŸaat aÅŸamasÄ± (ruhsat â†’ temel atma â†’ hafriyat â†’ temel â†’ kaba inÅŸaat â†’ kaba inÅŸaat tamam â†’
 *    duvar â†’ cephe â†’ doÄŸrama montajÄ± â†’ ince iÅŸler â†’ tamamlandÄ±). Metinde birden Ã§ok aÅŸama geÃ§erse
 *    en ileri aÅŸama alÄ±nÄ±r ("kaba inÅŸaat tamamlandÄ±, ince iÅŸlere geÃ§ildi" â†’ ince iÅŸler).
 *  â€¢ SatÄ±n alma zamanlamasÄ±: YALNIZ Ã‡IKARIM ('tahmin: true'); kaynakta yazmaz, hiÃ§bir zaman
 *    doÄŸrulanmÄ±ÅŸ bilgi olarak gÃ¶sterilmez.
 *  â€¢ SatÄ±ÅŸ sÄ±nÄ±fÄ±: A doÄŸrulanmÄ±ÅŸ aÃ§Ä±k talep (ilan/RFQ/tedarikÃ§i daveti + Ã¼rÃ¼n), B yÃ¼ksek Ã¶ncelikli
 *    aktif proje (aÃ§Ä±k talep yok), C erken aÅŸama (izlenecek), D dÃ¼ÅŸÃ¼k ilgi. B ve C asla satÄ±n alma
 *    fÄ±rsatÄ± olarak sunulmaz.
 *  â€¢ LEONX / ERLIN KAPI Ã¼rÃ¼n gruplarÄ± (taksonomi kategorilerinden ve proje tÃ¼rÃ¼nden; proje tÃ¼rÃ¼nden
 *    gelenler 'olasi' iÅŸaretlidir).
 *  â€¢ BÃ¶lge Ã¶nceliÄŸi: 1 Ankara, 2 Hatay, 3 KahramanmaraÅŸ, 4 komÅŸu iller, 5 diÄŸer iller.
 *  â€¢ HariÃ§ tutulan firmalar (Ã¶r. sahibin listesi): eÅŸleÅŸirse sÄ±nÄ±f D ve Ã¶neri yapÄ±lmaz.
 *
 * Kaynak metni yalnÄ±z VERÄ°DÄ°R; iÃ§indeki talimatlar yorumlanmaz.
 */
import type { Classification } from './classify.ts'
import { findPrefixPhrase } from './classify.ts'
import { fold, foldTokens, phraseOf } from './text.ts'

export type ConstructionStage =
  | 'ruhsat' | 'temel_atma' | 'hafriyat' | 'temel' | 'kaba_insaat' | 'kaba_tamam' | 'duvar' | 'cephe' | 'dograma' | 'ince_isler' | 'tamamlandi'

/** SÄ±ra = ilerleme. Anahtar sÃ¶zcÃ¼kler katlanmÄ±ÅŸ (ASCII) ve sÃ¶zcÃ¼k-baÅŸÄ± Ã¶nekidir. */
export const STAGES: { key: ConstructionStage; label: string; terms: string[] }[] = [
  { key: 'ruhsat', label: 'YapÄ± ruhsatÄ±', terms: ['yapi ruhsat', 'insaat ruhsat', 'ruhsat alindi', 'ruhsati alindi', 'ruhsatini aldi', 'ruhsat verildi'] },
  { key: 'temel_atma', label: 'Temel atma', terms: ['temel atma', 'temeli atildi', 'temelini att', 'temel atildi', 'ilk kazma'] },
  { key: 'hafriyat', label: 'Hafriyat / kazÄ±', terms: ['hafriyat', 'kazi calisma', 'kazi isleri', 'iksa', 'zemin iyilestirme', 'fore kazik'] },
  { key: 'temel', label: 'Temel', terms: ['temel betonu', 'radye temel', 'temel insaat', 'temel calisma', 'temel isleri', 'temel seviyesi'] },
  { key: 'kaba_insaat', label: 'Kaba inÅŸaat / karkas', terms: ['kaba insaat', 'karkas', 'betonarme', 'kat betonu', 'beton dokum', 'kat kat yuksel', 'yukseliyor', 'insaati sur', 'insaati devam', 'insaat devam', 'yapimi sur', 'yapimi devam', 'insaat calismalari sur'] },
  { key: 'kaba_tamam', label: 'Kaba inÅŸaat tamamlandÄ±', terms: ['kaba insaat tamamlan', 'kaba insaati tamamlan', 'karkas tamamlan', 'karkasi tamamlan', 'cati katina ulas', 'son kat betonu', 'en ust kata ulas', 'betonarme tamamlan'] },
  { key: 'duvar', label: 'Duvar Ã¶rme', terms: ['duvar orme', 'duvar ormeleri', 'duvarlari oruluyor', 'tugla duvar', 'gazbeton duvar', 'bims duvar'] },
  { key: 'cephe', label: 'Cephe', terms: ['cephe kaplama', 'cephe montaj', 'cephe calisma', 'cephe isleri', 'mantolama', 'dis cephe calisma', 'giydirme cephe montaj'] },
  { key: 'dograma', label: 'DoÄŸrama / pencere montajÄ±', terms: ['dograma montaj', 'pencere montaj', 'pencereler takil', 'dogramalar takil', 'dograma isleri basla', 'pencere dograma montaj'] },
  { key: 'ince_isler', label: 'Ä°nce iÅŸler', terms: ['ince isler', 'ince insaat', 'ic mimari', 'boya badana', 'seramik dosem', 'ince iscilik', 'ic mekan isleri', 'parke dosem'] },
  { key: 'tamamlandi', label: 'TamamlandÄ±', terms: ['tamamlandi', 'hizmete girdi', 'hizmete acildi', 'acilisi yapildi', 'teslim edildi', 'kullanima acildi', 'anahtar teslim toren', 'anahtarlari teslim'] },
]

const STAGE_INDEX: Record<ConstructionStage, number> = Object.fromEntries(STAGES.map((s, i) => [s.key, i])) as Record<ConstructionStage, number>
export const STAGE_LABEL: Record<ConstructionStage, string> = Object.fromEntries(STAGES.map((s) => [s.key, s.label])) as Record<ConstructionStage, string>

/** LEONX / ERLIN KAPI Ã¼rÃ¼n gruplarÄ± (kullanÄ±cÄ± listesi) */
export type ProductGroup = 'aluminyum_cephe' | 'pvc' | 'cam' | 'korkuluk' | 'yangin_kapisi' | 'celik_kapi' | 'ic_kapi' | 'metal_celik'
export const PRODUCT_LABEL: Record<ProductGroup, string> = {
  aluminyum_cephe: 'AlÃ¼minyum doÄŸrama ve cephe sistemleri',
  pvc: 'PVC pencere ve kapÄ±',
  cam: 'Cam ve camlama',
  korkuluk: 'Cam ve alÃ¼minyum korkuluk',
  yangin_kapisi: 'YangÄ±na dayanÄ±klÄ± kapÄ±',
  celik_kapi: 'Ã‡elik gÃ¼venlik kapÄ±sÄ±',
  ic_kapi: 'Ä°Ã§ kapÄ±',
  metal_celik: 'Metal imalat ve Ã§elik konstrÃ¼ksiyon',
}

/** Taksonomi kategorisi â†’ Ã¼rÃ¼n grubu */
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

/** Proje tÃ¼rÃ¼nden OLASI Ã¼rÃ¼n gruplarÄ± (Ã§Ä±karÄ±m) */
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

/** TedarikÃ§i daveti / teklif talebi iÅŸaretleri (Ã¼rÃ¼n de geÃ§meliyse A) */
const SUPPLIER_INVITE = [
  'tedarikci basvuru', 'tedarikci kayit', 'tedarikci aran', 'tedarikci olmak', 'taseron aran', 'alt yuklenici aran',
  'teklif davet', 'teklif istenm', 'teklif alinacak', 'teklif toplan', 'firmalardan teklif', 'fiyat teklifi talep', 'teklif talep',
]

export const PRIORITY_PROVINCES: Record<string, 1 | 2 | 3> = { Ankara: 1, Hatay: 2, KahramanmaraÅŸ: 3 }
/** Ankara, Hatay ve KahramanmaraÅŸ'a komÅŸu iller */
export const NEIGHBOUR_PROVINCES = [
  'Bolu', 'Ã‡ankÄ±rÄ±', 'KÄ±rÄ±kkale', 'KÄ±rÅŸehir', 'Aksaray', 'Konya', 'EskiÅŸehir',
  'Adana', 'Osmaniye', 'Gaziantep',
  'Kayseri', 'Sivas', 'Malatya', 'AdÄ±yaman',
]

export function regionPriority(city: string | null): 1 | 2 | 3 | 4 | 5 | null {
  if (!city) return null
  if (PRIORITY_PROVINCES[city]) return PRIORITY_PROVINCES[city]
  return NEIGHBOUR_PROVINCES.includes(city) ? 4 : 5
}

export type SalesClass = 'A' | 'B' | 'C' | 'D'
export const SALES_CLASS_LABEL: Record<SalesClass, string> = {
  A: 'DoÄŸrulanmÄ±ÅŸ aktif fÄ±rsat',
  B: 'YÃ¼ksek Ã¶ncelikli proje',
  C: 'Erken aÅŸama proje',
  D: 'DÃ¼ÅŸÃ¼k ilgi',
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
  /** Kaynakta inÅŸaat yapÄ±ldÄ±ÄŸÄ±na dair iÅŸaret (proje haberi/ilerleme) */
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
    // "tamamlandi" yalnÄ±z baÅŸÄ±na bir alt iÅŸin tamamlanmasÄ± olabilir: kaba inÅŸaat tamam ifadesi varsa o aÅŸama
    if (s.key === 'tamamlandi' && terms.some((t) => t.includes('tamamlan'))) continue
    terms.push(...hit)
    if (best === null || STAGE_INDEX[s.key] > STAGE_INDEX[best]) best = s.key
  }
  return { stage: best, terms }
}

/** AÅŸamadan satÄ±n alma zamanlamasÄ± â€” YALNIZ Ã‡IKARIM */
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
      return { tahmin: true, pencere: '6-18_ay', urunler: groups, gerekce: `${label} aÅŸamasÄ±nda doÄŸrama, cephe ve kapÄ± alÄ±mÄ± genellikle aylar sonradÄ±r` }
    case 'kaba_insaat':
      return { tahmin: true, pencere: '3-6_ay', urunler: exterior.length ? exterior : groups, gerekce: `${label} sÃ¼rerken dÄ±ÅŸ doÄŸrama/cephe tedarikÃ§isi genellikle kaba inÅŸaat bitmeden seÃ§ilir` }
    case 'kaba_tamam':
    case 'duvar':
      return { tahmin: true, pencere: '0-3_ay', urunler: groups, gerekce: `${label}: doÄŸrama, cephe ve korkuluk alÄ±mÄ± yaklaÅŸmÄ±ÅŸ olabilir; kapÄ±lar ince iÅŸlerle gelir` }
    case 'cephe':
    case 'dograma':
      return { tahmin: true, pencere: 'simdi', urunler: interior.length ? interior : groups, gerekce: `${label} baÅŸlamÄ±ÅŸ: dÄ±ÅŸ doÄŸrama/cephe bÃ¼yÃ¼k olasÄ±lÄ±kla sÃ¶zleÅŸmeli; iÃ§ kapÄ± ve yangÄ±n kapÄ±sÄ± alÄ±mÄ± yakÄ±n olabilir` }
    case 'ince_isler':
      return { tahmin: true, pencere: interior.length ? 'simdi' : 'gecmis_olabilir', urunler: interior, gerekce: `${label}: dÄ±ÅŸ doÄŸrama ve cephe bÃ¼yÃ¼k olasÄ±lÄ±kla tamamlandÄ±; iÃ§ kapÄ± / yangÄ±n kapÄ±sÄ± iÃ§in geÃ§ kalÄ±nmÄ±ÅŸ olabilir` }
  }
}

export interface IntelInput {
  title: string
  summary: string
  classification: Classification
  /** KayÄ±tlÄ±/baÄŸlÄ± firma adlarÄ± (hariÃ§ tutma kontrolÃ¼ iÃ§in) */
  companyNames?: string[]
  /** HariÃ§ tutulan firma kalÄ±plarÄ± (katlanmÄ±ÅŸ; Ã¶r. "ozcelik insaat") */
  excludedPatterns?: string[]
}

export function analyzeConstruction(input: IntelInput): ConstructionIntel {
  const c = input.classification
  const text = `${input.title}. ${input.summary}`
  const tokens = foldTokens(text)
  const reasons: string[] = []

  const st = detectStage(tokens)
  // SÄ±nÄ±flandÄ±rÄ±cÄ±nÄ±n kaba aÅŸamasÄ± da iÅŸaret sayÄ±lÄ±r
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

  // SÄ±nÄ±flandÄ±rÄ±cÄ± "tamamlandÄ±"yÄ± alt iÅŸ iÃ§in de yakalar ("kaba inÅŸaat tamamlandÄ±"): ayrÄ±ntÄ±lÄ± aÅŸama Ã¶nceliklidir
  const completed = st.stage === 'tamamlandi' || (c.stage === 'tamamlandi' && st.stage === null)
  const deadlinePassed = c.risks.includes('son_tarih_gecti')
  const procurement = c.isProcurement || supplierInvite.length > 0
  const relevantProject = !!c.projectType || sourceProducts.length > 0

  let salesClass: SalesClass
  if (excluded) {
    salesClass = 'D'
    reasons.push(`HariÃ§ tutulan firma listesinde: ${excluded}`)
  } else if (completed) {
    salesClass = 'D'
    reasons.push('Proje tamamlanmÄ±ÅŸ gÃ¶rÃ¼nÃ¼yor')
  } else if (procurement && sourceProducts.length > 0 && !deadlinePassed) {
    salesClass = 'A'
    reasons.push(c.isProcurement ? 'SatÄ±n alma / ihale ilanÄ± ve LEONX Ã¼rÃ¼nÃ¼ kaynakta geÃ§iyor' : `TedarikÃ§i daveti / teklif talebi (${supplierInvite.join(', ')}) ve LEONX Ã¼rÃ¼nÃ¼ kaynakta geÃ§iyor`)
  } else if (relevantProject && activeConstruction && st.stage && STAGE_INDEX[st.stage] >= STAGE_INDEX.kaba_insaat) {
    salesClass = 'B'
    reasons.push(`Aktif inÅŸaat (${STAGE_LABEL[st.stage]}); aÃ§Ä±k satÄ±n alma ilanÄ± doÄŸrulanmadÄ±`)
  } else if (relevantProject && (activeConstruction || st.stage !== null || c.stage === 'planlama' || c.stage === 'ihale' || procurement)) {
    salesClass = 'C'
    reasons.push(st.stage ? `Erken aÅŸama (${STAGE_LABEL[st.stage]}); izlenmeli` : 'Yeni/planlanan proje; izlenmeli')
    if (deadlinePassed) reasons.push('Ä°landaki son tarih geÃ§miÅŸ')
  } else {
    salesClass = 'D'
    reasons.push(relevantProject ? 'Ä°nÅŸaat aÅŸamasÄ± veya satÄ±n alma iÅŸareti yok' : 'LEONX Ã¼rÃ¼nÃ¼ veya ilgili proje tÃ¼rÃ¼ yok')
  }

  const outlook = salesClass === 'D' ? null : outlookFor(st.stage, products.map((p) => p.group))
  const action =
    salesClass === 'A' ? 'Ä°lan/talep belgesini indir, son tarihi takvime ekle, teklif hazÄ±rla'
    : salesClass === 'B' ? 'YÃ¼kleniciyi/geliÅŸtiriciyi belirle, resmÃ® iletiÅŸim kanalÄ±ndan tanÄ±tÄ±m ve tedarikÃ§i baÅŸvurusu yap'
    : salesClass === 'C' ? 'Ä°zleme listesine al; aÅŸama deÄŸiÅŸiminde yeniden deÄŸerlendir'
    : 'Ä°ÅŸlem gerekmiyor'

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
