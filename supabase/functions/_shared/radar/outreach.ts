/**
 * LEONX Radar â€” proje bazlÄ± TÃ¼rkÃ§e iÅŸ geliÅŸtirme e-postasÄ± ve gÃ¶nderim uygunluÄŸu.
 *
 * ÃœrÃ¼nler yalnÄ±z sahibin bildirdiÄŸi gerÃ§ek hizmet listesinden seÃ§ilir (LEONX METAL, ERLÄ°N KAPI).
 * E-posta:
 *  â€¢ Firma ve projeyi YALNIZ doÄŸrulanmÄ±ÅŸ kanÄ±t varsa anar; proje ayrÄ±ntÄ±sÄ± uydurmaz.
 *  â€¢ FirmanÄ±n teklif istediÄŸini Ä°DDÄ°A ETMEZ (kaynakta doÄŸrulanmÄ±ÅŸ talep yoksa).
 *  â€¢ Projeye uygun Ã¼rÃ¼nleri seÃ§er (her e-postada genel liste yok), proje bazlÄ± teklif sunar,
 *    Ã§izim / teknik ÅŸartname / metraj ister, resmÃ® web sitelerini ve ret (listeden Ã§Ä±kma) yolunu verir.
 * Otomatik gÃ¶nderim yalnÄ±z tÃ¼m denetimler geÃ§erse; aksi hÃ¢lde taslak inceleme kuyruÄŸunda kalÄ±r.
 */
import type { ConstructionStage } from './construction.ts'
import { STAGE_LABEL } from './construction.ts'
import { looksPersonal } from './contacts.ts'

export const SENDER_EMAIL = 'erlindoorkapi@gmail.com'

export type Brand = 'leonx_metal' | 'erlin_kapi'
export const BRANDS: Record<Brand, { name: string; websites: string[] }> = {
  leonx_metal: { name: 'LEONX METAL', websites: ['https://www.leonxmetal.com'] },
  erlin_kapi: { name: 'ERLÄ°N KAPI', websites: ['https://www.erlinkapi.com', 'https://www.erlinkapi.com.tr'] },
}

export type ServiceKey =
  | 'aluminyum_dograma' | 'pvc_dograma' | 'aluminyum_cephe' | 'giydirme_cephe' | 'kompozit_kaplama' | 'korkuluk' | 'mimari_metal' | 'cnc_lazer'
  | 'celik_kapi' | 'yangin_kapisi' | 'oda_kapisi' | 'lake_kapi' | 'fotoselli_kapi'

export const SERVICES: Record<ServiceKey, { brand: Brand; label: string }> = {
  aluminyum_dograma: { brand: 'leonx_metal', label: 'alÃ¼minyum doÄŸrama ve pencere sistemleri' },
  pvc_dograma: { brand: 'leonx_metal', label: 'PVC kapÄ± ve pencere' },
  aluminyum_cephe: { brand: 'leonx_metal', label: 'alÃ¼minyum cephe sistemleri' },
  giydirme_cephe: { brand: 'leonx_metal', label: 'cam giydirme cephe' },
  kompozit_kaplama: { brand: 'leonx_metal', label: 'kompozit panel cephe kaplama' },
  korkuluk: { brand: 'leonx_metal', label: 'cam ve metal korkuluk sistemleri' },
  mimari_metal: { brand: 'leonx_metal', label: 'mimari metal imalat' },
  cnc_lazer: { brand: 'leonx_metal', label: 'CNC lazer kesim ve metal imalat' },
  celik_kapi: { brand: 'erlin_kapi', label: 'Ã§elik daire giriÅŸ kapÄ±sÄ±' },
  yangin_kapisi: { brand: 'erlin_kapi', label: 'yangÄ±na dayanÄ±klÄ± kapÄ±' },
  oda_kapisi: { brand: 'erlin_kapi', label: 'iÃ§ oda kapÄ±sÄ±' },
  lake_kapi: { brand: 'erlin_kapi', label: 'lake kapÄ±' },
  fotoselli_kapi: { brand: 'erlin_kapi', label: 'otomatik fotoselli kayar kapÄ±' },
}

const RESIDENTIAL = new Set(['konut', 'toplu_konut', 'villa'])
const COMMERCIAL = new Set(['is_merkezi', 'avm', 'otel', 'hastane'])

export interface ProductMatch {
  services: ServiceKey[]
  brands: Brand[]
  reasons: string[]
}

/**
 * Proje tÃ¼rÃ¼ + aÅŸama â†’ ilgili hizmetler. AÅŸama ilerlemiÅŸse (cephe/doÄŸrama/ince iÅŸler) dÄ±ÅŸ doÄŸrama ve cephe
 * bÃ¼yÃ¼k olasÄ±lÄ±kla sÃ¶zleÅŸmeli olduÄŸundan kapÄ±lar Ã¶ne Ã§Ä±kar; erken aÅŸamada hepsi.
 * Kaynakta aÃ§Ä±kÃ§a geÃ§en Ã¼rÃ¼n gruplarÄ± her zaman eklenir.
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
    reasons.push(`Konut projesi${late ? ' (ileri aÅŸama: kapÄ±lar Ã¶ncelikli)' : ''}`)
  } else if (projectType && COMMERCIAL.has(projectType)) {
    if (!late) s.add('aluminyum_cephe').add('giydirme_cephe').add('kompozit_kaplama')
    s.add('fotoselli_kapi').add('yangin_kapisi')
    if (projectType === 'otel' || projectType === 'hastane') s.add('lake_kapi').add('oda_kapisi')
    s.add('mimari_metal')
    reasons.push(`Ticari proje${late ? ' (ileri aÅŸama: kapÄ±lar Ã¶ncelikli)' : ''}`)
  } else if (projectType === 'fabrika') {
    s.add('mimari_metal').add('cnc_lazer').add('yangin_kapisi').add('celik_kapi')
    reasons.push('Sanayi yapÄ±sÄ±')
  } else if (projectType) {
    s.add('aluminyum_dograma').add('yangin_kapisi')
    reasons.push('DiÄŸer bina tÃ¼rÃ¼')
  }
  const map: Record<string, ServiceKey[]> = {
    aluminyum_cephe: ['aluminyum_cephe', 'aluminyum_dograma'], pvc: ['pvc_dograma'], cam: ['giydirme_cephe'], korkuluk: ['korkuluk'],
    yangin_kapisi: ['yangin_kapisi'], celik_kapi: ['celik_kapi'], ic_kapi: ['oda_kapisi'], metal_celik: ['mimari_metal'],
  }
  for (const g of sourceGroups) for (const k of map[g] ?? []) if (!s.has(k)) {
    s.add(k)
    reasons.push(`Kaynakta geÃ§en Ã¼rÃ¼n: ${SERVICES[k].label}`)
  }
  const services = [...s]
  const brands = [...new Set(services.map((k) => SERVICES[k].brand))]
  return { services, brands, reasons }
}

export interface EmailInput {
  /** Firma adÄ± yalnÄ±z kaynak metninden; alan adÄ± tabanlÄ± ad kullanÄ±lmaz */
  companyName: string | null
  companyNameVerified: boolean
  /** Proje baÅŸlÄ±ÄŸÄ±/kÄ±sa tanÄ±mÄ± yalnÄ±z kanÄ±t varsa */
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
    ? `${where ? `${where} ` : ''}projeniz iÃ§in ${services.length ? SERVICES[services[0]].label : 'doÄŸrama ve kapÄ±'} teklifi â€” ${brandNames.join(' & ')}`
    : `${brandNames.join(' & ')} â€” proje bazlÄ± ${services.length ? SERVICES[services[0]].label : 'doÄŸrama ve kapÄ±'} tedariki`
  const greeting = i.companyName && i.companyNameVerified ? `SayÄ±n ${i.companyName} Yetkilisi,` : 'SayÄ±n Yetkili,'
  const lines: string[] = [greeting, '']
  if (hasProject) {
    const stageText = i.stage && i.stageVerified ? ` ${STAGE_LABEL[i.stage].toLocaleLowerCase('tr-TR')} aÅŸamasÄ±ndaki` : ''
    lines.push(`${where ? `${where} bÃ¶lgesindeki` : ''}${stageText} "${i.projectLabel}" projenizle ilgili yayÄ±mlanmÄ±ÅŸ bilgiye (${i.evidenceUrl}) ulaÅŸtÄ±k.`)
    if (i.verifiedRequest) lines.push('Projeniz iÃ§in tedarikÃ§i teklifi toplandÄ±ÄŸÄ±nÄ± kaynakta gÃ¶rdÃ¼k ve bu kapsamda teklif sunmak isteriz.')
  } else {
    lines.push('Ankara ve Ã§evresinde yÃ¼rÃ¼ttÃ¼ÄŸÃ¼nÃ¼z inÅŸaat projelerine yÃ¶nelik olarak sizinle iletiÅŸime geÃ§mek istedik.')
  }
  lines.push('')
  const byBrand = brands.map((b) => {
    const svc = services.filter((k) => SERVICES[k].brand === b).map((k) => SERVICES[k].label)
    return svc.length ? `${BRANDS[b].name}: ${list(svc)}` : null
  }).filter((x): x is string => !!x)
  if (byBrand.length) {
    lines.push(brands.length > 1 ? 'Grubumuz bÃ¼nyesinde projenize uygun olabilecek Ã§Ã¶zÃ¼mler:' : `${brandNames[0]} olarak projenize uygun olabilecek Ã§Ã¶zÃ¼mlerimiz:`)
    for (const b of byBrand) lines.push(`â€¢ ${b}`)
    lines.push('')
  }
  lines.push('Projeye Ã¶zel Ã¼retim, tedarik ve montaj hizmeti veriyoruz. Mimari Ã§izimler, teknik ÅŸartname veya metraj/kapÄ±-pencere listesi paylaÅŸmanÄ±z hÃ¢linde projenize Ã¶zel fiyat teklifi hazÄ±rlayabiliriz.')
  lines.push('')
  lines.push('Uygun gÃ¶rdÃ¼ÄŸÃ¼nÃ¼z bir zamanda kÄ±sa bir gÃ¶rÃ¼ÅŸme ya da ÅŸantiye ziyareti de planlayabiliriz.')
  lines.push('')
  lines.push('SaygÄ±larÄ±mÄ±zla,')
  lines.push(brandNames.join(' & '))
  lines.push(SENDER_EMAIL)
  for (const b of brands) lines.push(...BRANDS[b].websites)
  lines.push('')
  lines.push('Bu e-postayÄ± kamuya aÃ§Ä±k kurumsal iletiÅŸim adresinize gÃ¶nderdik. Benzer iletiler almak istemiyorsanÄ±z bu e-postayÄ± "LÄ°STEDEN Ã‡IKAR" yazarak yanÄ±tlamanÄ±z yeterlidir; adresiniz derhÃ¢l listemizden Ã§Ä±karÄ±lÄ±r.')
  return { subject: subject.slice(0, 300), body: lines.join('\n'), brands, services }
}

// ------------------------------------------------------------------ GÃ¶nderim uygunluÄŸu

export type BlockReason =
  | 'otomatik_gonderim_kapali' | 'gmail_dogrulanmadi' | 'hukuki_dayanak_onaylanmadi' | 'alici_yok' | 'alici_dogrulanmadi'
  | 'kisisel_eposta' | 'alan_adi_uyusmuyor' | 'ret_listesinde' | 'gunluk_sinir' | 'yakin_zamanda_iletisim' | 'proje_kaniti_yok'
  | 'kamu_kurumu' | 'firma_haric' | 'taslak_onaylanmadi'

export const BLOCK_LABEL: Record<BlockReason, string> = {
  otomatik_gonderim_kapali: 'Otomatik gÃ¶nderim ayarlarda kapalÄ±',
  gmail_dogrulanmadi: 'Gmail (erlindoorkapi@gmail.com) baÄŸlantÄ±sÄ± doÄŸrulanmadÄ±',
  hukuki_dayanak_onaylanmadi: 'Ticari ileti hukuki dayanaÄŸÄ± sahip tarafÄ±ndan belgelenmedi',
  alici_yok: 'AlÄ±cÄ± e-posta adresi yok',
  alici_dogrulanmadi: 'AlÄ±cÄ± adresi son 180 gÃ¼nde firmanÄ±n kendi sitesinden doÄŸrulanmadÄ±',
  kisisel_eposta: 'AlÄ±cÄ± kiÅŸisel e-posta gibi gÃ¶rÃ¼nÃ¼yor',
  alan_adi_uyusmuyor: 'AlÄ±cÄ± adresi firmanÄ±n alan adÄ±nda deÄŸil',
  ret_listesinde: 'AlÄ±cÄ± veya alan adÄ± ret (listeden Ã§Ä±kma) listesinde',
  gunluk_sinir: 'GÃ¼nlÃ¼k gÃ¶nderim sÄ±nÄ±rÄ± doldu',
  yakin_zamanda_iletisim: 'Firmaya son 90 gÃ¼nde e-posta gÃ¶nderildi',
  proje_kaniti_yok: 'Projeye ait kaynak kanÄ±tÄ± yok',
  kamu_kurumu: 'Kamu kurumlarÄ±na otomatik tanÄ±tÄ±m e-postasÄ± gÃ¶nderilmez',
  firma_haric: 'Firma Ã¶nerilmeyecekler listesinde',
  taslak_onaylanmadi: 'Taslak sahip tarafÄ±ndan onaylanmadÄ±',
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
  /** Taslak sahibin onayÄ±ndan geÃ§ti mi (otomatik kuyrukta 'onaylandi') */
  approved: boolean
  now: Date
}

function baseDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.')
  const sl = ['com', 'net', 'org', 'gen', 'web', 'biz', 'info', 'av', 'bel', 'gov', 'edu', 'k12', 'tsk', 'pol']
  return parts.length >= 3 && sl.includes(parts[parts.length - 2]) ? parts.slice(-3).join('.') : parts.slice(-2).join('.')
}

/** TÃ¼m denetimler geÃ§erse eligible; deÄŸilse taslak inceleme kuyruÄŸunda kalÄ±r */
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
