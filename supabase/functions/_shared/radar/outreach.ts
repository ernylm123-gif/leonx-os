/**
 * LEONX Radar — proje bazlı Türkçe iş geliştirme e-postası ve gönderim uygunluğu.
 *
 * Ürünler yalnız sahibin bildirdiği gerçek hizmet listesinden seçilir (LEONX METAL, ERLİN KAPI).
 * E-posta:
 *  • Firma ve projeyi YALNIZ doğrulanmış kanıt varsa anar; proje ayrıntısı uydurmaz.
 *  • Firmanın teklif istediğini İDDİA ETMEZ (kaynakta doğrulanmış talep yoksa).
 *  • Projeye uygun ürünleri seçer (her e-postada genel liste yok), proje bazlı teklif sunar,
 *    çizim / teknik şartname / metraj ister, resmî web sitelerini ve ret (listeden çıkma) yolunu verir.
 * Otomatik gönderim yalnız tüm denetimler geçerse; aksi hâlde taslak inceleme kuyruğunda kalır.
 */
import type { ConstructionStage } from './construction.ts'
import { STAGE_LABEL } from './construction.ts'
import { looksPersonal } from './contacts.ts'

export const SENDER_EMAIL = 'info@erlinkapi.tr'

export type Brand = 'leonx_metal' | 'erlin_kapi'
export const BRANDS: Record<Brand, { name: string; websites: string[] }> = {
  leonx_metal: { name: 'LEONX METAL', websites: ['https://www.leonxmetal.com'] },
  erlin_kapi: { name: 'ERLİN KAPI', websites: ['https://www.erlinkapi.com', 'https://www.erlinkapi.com.tr'] },
}

export type ServiceKey =
  | 'aluminyum_dograma' | 'pvc_dograma' | 'aluminyum_cephe' | 'giydirme_cephe' | 'kompozit_kaplama' | 'korkuluk' | 'mimari_metal' | 'cnc_lazer'
  | 'celik_kapi' | 'yangin_kapisi' | 'oda_kapisi' | 'lake_kapi' | 'fotoselli_kapi'

export const SERVICES: Record<ServiceKey, { brand: Brand; label: string }> = {
  aluminyum_dograma: { brand: 'leonx_metal', label: 'alüminyum doğrama ve pencere sistemleri' },
  pvc_dograma: { brand: 'leonx_metal', label: 'PVC kapı ve pencere' },
  aluminyum_cephe: { brand: 'leonx_metal', label: 'alüminyum cephe sistemleri' },
  giydirme_cephe: { brand: 'leonx_metal', label: 'cam giydirme cephe' },
  kompozit_kaplama: { brand: 'leonx_metal', label: 'kompozit panel cephe kaplama' },
  korkuluk: { brand: 'leonx_metal', label: 'cam ve metal korkuluk sistemleri' },
  mimari_metal: { brand: 'leonx_metal', label: 'mimari metal imalat' },
  cnc_lazer: { brand: 'leonx_metal', label: 'CNC lazer kesim ve metal imalat' },
  celik_kapi: { brand: 'erlin_kapi', label: 'çelik daire giriş kapısı' },
  yangin_kapisi: { brand: 'erlin_kapi', label: 'yangına dayanıklı kapı' },
  oda_kapisi: { brand: 'erlin_kapi', label: 'iç oda kapısı' },
  lake_kapi: { brand: 'erlin_kapi', label: 'lake kapı' },
  fotoselli_kapi: { brand: 'erlin_kapi', label: 'otomatik fotoselli kayar kapı' },
}

const RESIDENTIAL = new Set(['konut', 'toplu_konut', 'villa'])
const COMMERCIAL = new Set(['is_merkezi', 'avm', 'otel', 'hastane'])

export interface ProductMatch {
  services: ServiceKey[]
  brands: Brand[]
  reasons: string[]
}

/**
 * Proje türü + aşama → ilgili hizmetler. Aşama ilerlemişse (cephe/doğrama/ince işler) dış doğrama ve cephe
 * büyük olasılıkla sözleşmeli olduğundan kapılar öne çıkar; erken aşamada hepsi.
 * Kaynakta açıkça geçen ürün grupları her zaman eklenir.
 */
export function matchServices(projectType: string | null, stage: ConstructionStage | null, sourceGroups: string[] = []): ProductMatch {
  const s = new Set<ServiceKey>()
  const reasons: string[] = []
  const late = stage === 'cephe' || stage === 'dograma' || stage === 'ince_isler'
  if (projectType && RESIDENTIAL.has(projectType)) {
    if (!late) {
      s.add('pvc_dograma').add('aluminyum_dograma')
      if (projectType !== 'villa') s.add('korkuluk')
    }
    s.add('celik_kapi').add('oda_kapisi')
    if (projectType === 'toplu_konut' || projectType === 'konut') s.add('yangin_kapisi')
    if (projectType === 'villa') s.add('lake_kapi')
    reasons.push(`Konut projesi${late ? ' (ileri aşama: kapılar öncelikli)' : ''}`)
  } else if (projectType && COMMERCIAL.has(projectType)) {
    if (!late) s.add('aluminyum_cephe').add('giydirme_cephe').add('kompozit_kaplama')
    s.add('fotoselli_kapi').add('yangin_kapisi')
    if (projectType === 'otel' || projectType === 'hastane') s.add('lake_kapi').add('oda_kapisi')
    s.add('mimari_metal')
    reasons.push(`Ticari proje${late ? ' (ileri aşama: kapılar öncelikli)' : ''}`)
  } else if (projectType === 'fabrika') {
    s.add('mimari_metal').add('cnc_lazer').add('yangin_kapisi').add('celik_kapi')
    reasons.push('Sanayi yapısı')
  } else if (projectType) {
    s.add('aluminyum_dograma').add('yangin_kapisi')
    reasons.push('Diğer bina türü')
  }
  const map: Record<string, ServiceKey[]> = {
    aluminyum_cephe: ['aluminyum_cephe', 'aluminyum_dograma'], pvc: ['pvc_dograma'], cam: ['giydirme_cephe'], korkuluk: ['korkuluk'],
    yangin_kapisi: ['yangin_kapisi'], celik_kapi: ['celik_kapi'], ic_kapi: ['oda_kapisi'], metal_celik: ['mimari_metal'],
  }
  for (const g of sourceGroups) for (const k of map[g] ?? []) if (!s.has(k)) {
    s.add(k)
    reasons.push(`Kaynakta geçen ürün: ${SERVICES[k].label}`)
  }
  const services = [...s]
  const brands = [...new Set(services.map((k) => SERVICES[k].brand))]
  return { services, brands, reasons }
}

export interface EmailInput {
  /** Firma adı yalnız kaynak metninden; alan adı tabanlı ad kullanılmaz */
  companyName: string | null
  companyNameVerified: boolean
  /** Proje başlığı/kısa tanımı yalnız kanıt varsa */
  projectLabel: string | null
  district: string | null
  city: string | null
  stage: ConstructionStage | null
  stageVerified: boolean
  evidenceUrl: string | null
  verifiedRequest: boolean
  match: ProductMatch
}

export interface EmailDraft {
  subject: string
  body: string
  brands: Brand[]
  services: ServiceKey[]
}

function list(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ve ${items[items.length - 1]}`
}

export function buildEmail(i: EmailInput): EmailDraft {
  const brands = i.match.brands.length ? i.match.brands : (['leonx_metal', 'erlin_kapi'] as Brand[])
  const services = i.match.services
  const brandNames = brands.map((b) => BRANDS[b].name)
  const where = i.district ? `${i.district}${i.city && i.city !== i.district ? `/${i.city}` : ''}` : i.city
  const hasProject = !!(i.projectLabel && i.evidenceUrl)
  const subject = hasProject
    ? `${where ? `${where} ` : ''}projeniz için ${services.length ? SERVICES[services[0]].label : 'doğrama ve kapı'} teklifi — ${brandNames.join(' & ')}`
    : `${brandNames.join(' & ')} — proje bazlı ${services.length ? SERVICES[services[0]].label : 'doğrama ve kapı'} tedariki`
  const greeting = i.companyName && i.companyNameVerified ? `Sayın ${i.companyName} Yetkilisi,` : 'Sayın Yetkili,'
  const lines: string[] = [greeting, '']
  if (hasProject) {
    const stageText = i.stage && i.stageVerified ? ` ${STAGE_LABEL[i.stage].toLocaleLowerCase('tr-TR')} aşamasındaki` : ''
    lines.push(`${where ? `${where} bölgesindeki` : ''}${stageText} "${i.projectLabel}" projenizle ilgili yayımlanmış bilgiye (${i.evidenceUrl}) ulaştık.`)
    if (i.verifiedRequest) lines.push('Projeniz için tedarikçi teklifi toplandığını kaynakta gördük ve bu kapsamda teklif sunmak isteriz.')
  } else {
    lines.push('Ankara ve çevresinde yürüttüğünüz inşaat projelerine yönelik olarak sizinle iletişime geçmek istedik.')
  }
  lines.push('')
  const byBrand = brands.map((b) => {
    const svc = services.filter((k) => SERVICES[k].brand === b).map((k) => SERVICES[k].label)
    return svc.length ? `${BRANDS[b].name}: ${list(svc)}` : null
  }).filter((x): x is string => !!x)
  if (byBrand.length) {
    lines.push(brands.length > 1 ? 'Grubumuz bünyesinde projenize uygun olabilecek çözümler:' : `${brandNames[0]} olarak projenize uygun olabilecek çözümlerimiz:`)
    for (const b of byBrand) lines.push(`• ${b}`)
    lines.push('')
  }
  lines.push('Projeye özel üretim, tedarik ve montaj hizmeti veriyoruz. Mimari çizimler, teknik şartname veya metraj/kapı-pencere listesi paylaşmanız hâlinde projenize özel fiyat teklifi hazırlayabiliriz.')
  lines.push('')
  lines.push('Uygun gördüğünüz bir zamanda kısa bir görüşme ya da şantiye ziyareti de planlayabiliriz.')
  lines.push('')
  lines.push('Saygılarımızla,')
  lines.push(brandNames.join(' & '))
  lines.push(SENDER_EMAIL)
  for (const b of brands) lines.push(...BRANDS[b].websites)
  lines.push('')
  lines.push('Bu e-postayı kamuya açık kurumsal iletişim adresinize gönderdik. Benzer iletiler almak istemiyorsanız bu e-postayı "LİSTEDEN ÇIKAR" yazarak yanıtlamanız yeterlidir; adresiniz derhâl listemizden çıkarılır.')
  return { subject: subject.slice(0, 300), body: lines.join('\n'), brands, services }
}

// ------------------------------------------------------------------ Gönderim uygunluğu

export type BlockReason =
  | 'otomatik_gonderim_kapali' | 'gmail_dogrulanmadi' | 'hukuki_dayanak_onaylanmadi' | 'alici_yok' | 'alici_dogrulanmadi'
  | 'kisisel_eposta' | 'alan_adi_uyusmuyor' | 'ret_listesinde' | 'gunluk_sinir' | 'yakin_zamanda_iletisim' | 'proje_kaniti_yok'
  | 'kamu_kurumu' | 'firma_haric' | 'taslak_onaylanmadi'

export const BLOCK_LABEL: Record<BlockReason, string> = {
  otomatik_gonderim_kapali: 'Otomatik gönderim ayarlarda kapalı',
  gmail_dogrulanmadi: 'Gmail (info@erlinkapi.tr) bağlantısı doğrulanmadı',
  hukuki_dayanak_onaylanmadi: 'Ticari ileti hukuki dayanağı sahip tarafından belgelenmedi',
  alici_yok: 'Alıcı e-posta adresi yok',
  alici_dogrulanmadi: 'Alıcı adresi son 180 günde firmanın kendi sitesinden doğrulanmadı',
  kisisel_eposta: 'Alıcı kişisel e-posta gibi görünüyor',
  alan_adi_uyusmuyor: 'Alıcı adresi firmanın alan adında değil',
  ret_listesinde: 'Alıcı veya alan adı ret (listeden çıkma) listesinde',
  gunluk_sinir: 'Günlük gönderim sınırı doldu',
  yakin_zamanda_iletisim: 'Firmaya son 90 günde e-posta gönderildi',
  proje_kaniti_yok: 'Projeye ait kaynak kanıtı yok',
  kamu_kurumu: 'Kamu kurumlarına otomatik tanıtım e-postası gönderilmez',
  firma_haric: 'Firma önerilmeyecekler listesinde',
  taslak_onaylanmadi: 'Taslak sahip tarafından onaylanmadı',
}

export interface EligibilityInput {
  autoSendEnabled: boolean
  gmailVerifiedAt: string | null
  legalConfirmedAt: string | null
  recipient: { email: string; kind: string; verifiedAt: string; sourceUrl: string } | null
  companyWebsite: string | null
  suppressed: boolean
  sentToday: number
  dailyLimit: number
  lastEmailDays: number | null
  hasEvidence: boolean
  sector: 'kamu' | 'ozel' | 'bilinmiyor'
  companyExcluded: boolean
  /** Taslak sahibin onayından geçti mi (otomatik kuyrukta 'onaylandi') */
  approved: boolean
  now: Date
}

function baseDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.')
  const sl = ['com', 'net', 'org', 'gen', 'web', 'biz', 'info', 'av', 'bel', 'gov', 'edu', 'k12', 'tsk', 'pol']
  return parts.length >= 3 && sl.includes(parts[parts.length - 2]) ? parts.slice(-3).join('.') : parts.slice(-2).join('.')
}

/** Tüm denetimler geçerse eligible; değilse taslak inceleme kuyruğunda kalır */
export function checkEligibility(i: EligibilityInput): { eligible: boolean; reasons: BlockReason[] } {
  const r: BlockReason[] = []
  if (!i.autoSendEnabled) r.push('otomatik_gonderim_kapali')
  if (!i.gmailVerifiedAt) r.push('gmail_dogrulanmadi')
  if (!i.legalConfirmedAt) r.push('hukuki_dayanak_onaylanmadi')
  if (!i.approved) r.push('taslak_onaylanmadi')
  if (i.sector === 'kamu') r.push('kamu_kurumu')
  if (i.companyExcluded) r.push('firma_haric')
  if (!i.hasEvidence) r.push('proje_kaniti_yok')
  if (!i.recipient) r.push('alici_yok')
  else {
    const [local, domain] = i.recipient.email.toLowerCase().split('@')
    const fresh = Number.isFinite(Date.parse(i.recipient.verifiedAt)) && i.now.getTime() - Date.parse(i.recipient.verifiedAt) <= 180 * 86400000
    if (!fresh || !/^(satinalma_eposta|teknik_ofis_eposta|genel_eposta)$/.test(i.recipient.kind)) r.push('alici_dogrulanmadi')
    if (looksPersonal(local ?? '')) r.push('kisisel_eposta')
    let site: string | null = null
    try {
      site = i.companyWebsite ? baseDomain(new URL(i.companyWebsite).hostname) : null
    } catch {
      site = null
    }
    if (!site || !domain || baseDomain(domain) !== site) r.push('alan_adi_uyusmuyor')
  }
  if (i.suppressed) r.push('ret_listesinde')
  if (i.sentToday >= i.dailyLimit) r.push('gunluk_sinir')
  if (i.lastEmailDays !== null && i.lastEmailDays < 90) r.push('yakin_zamanda_iletisim')
  return { eligible: r.length === 0, reasons: r }
}
