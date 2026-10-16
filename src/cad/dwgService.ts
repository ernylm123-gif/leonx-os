/**
 * DWG dönüştürme servisi istemcisi (services/cad-worker).
 *
 * Servis yalnız VITE_CAD_WORKER_URL ayarlıysa kullanılır; ayarlı değilse uygulama DWG için DXF'e
 * dönüştürme rehberini gösterir (mevcut davranış). Dosya, kullanıcı açıkça onaylamadan gönderilmez.
 * İstek kullanıcının Supabase oturum belirteciyle yapılır; servis dosyayı saklamaz.
 */

export interface DwgQuality {
  status: 'tamam' | 'eksik' | 'basarisiz'
  dxf_valid: boolean
  audit_errors: number
  units: string | null
  counts_dwg: Record<string, number>
  counts_dxf: Record<string, number>
  lost: Record<string, number>
  layers: { dwg: number; dxf: number }
  blocks: { dwg: number; dxf: number }
  layouts: string[]
  xrefs: string[]
  proxy_entities: number
  notes: string[]
}

export interface DwgConversionResult {
  version: string
  release: string
  seconds: number
  repairedTexts: number
  warnings: string[]
  quality: DwgQuality
  dxf: Uint8Array
  pdf: Uint8Array | null
  pdfPages: { name: string; width_mm: number; height_mm: number; entities: number; scale_note: string }[]
}

export class DwgServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

/** Yapılandırılmış servis adresi (sonunda / olmadan); yoksa null */
export function dwgServiceUrl(): string | null {
  const raw = (import.meta.env.VITE_CAD_WORKER_URL ?? '').trim()
  return raw ? raw.replace(/\/+$/, '') : null
}

/** Kullanıcıya gösterilecek sunucu adı (göreli adreste bu uygulamanın kendisi) */
export function dwgServiceHost(url: string): string {
  try {
    return new URL(url, window.location.origin).host
  } catch {
    return url
  }
}

const b64 = (s: string): Uint8Array => {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const MESSAGES: Record<number, [string, string]> = {
  401: ['Oturum doğrulanamadı; yeniden giriş yapın.', 'oturum'],
  403: ['Bu hesap dönüştürme servisini kullanamaz.', 'yetki'],
  413: ['Dosya dönüştürme sınırını (50 MB) aşıyor.', 'cok_buyuk'],
  429: ['Dönüştürücü şu an meşgul; birazdan tekrar deneyin.', 'mesgul'],
}

export async function convertDwgRemote(
  bytes: ArrayBuffer,
  fileName: string,
  token: string,
  opts: { pdf?: boolean; signal?: AbortSignal; baseUrl?: string | null } = {},
): Promise<DwgConversionResult> {
  const base = opts.baseUrl ?? dwgServiceUrl()
  if (!base) throw new DwgServiceError('DWG dönüştürme servisi yapılandırılmamış.', 'yapilandirma')
  const form = new FormData()
  form.append('dosya', new Blob([bytes], { type: 'application/acad' }), fileName)
  let res: Response
  try {
    res = await fetch(`${base}/v1/dwg/donustur${opts.pdf ? '?pdf=1' : ''}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: opts.signal,
    })
  } catch (e) {
    if (opts.signal?.aborted) throw e
    throw new DwgServiceError('Dönüştürme servisine ulaşılamadı (bağlantı yok veya servis kapalı).', 'baglanti')
  }
  if (!res.ok) {
    if (MESSAGES[res.status]) throw new DwgServiceError(...MESSAGES[res.status])
    let detail: { kod?: string; mesaj?: string } | string | undefined
    try {
      detail = (await res.json())?.detail
    } catch {
      detail = undefined
    }
    if (detail && typeof detail === 'object' && detail.mesaj) throw new DwgServiceError(detail.mesaj, detail.kod ?? 'donusum')
    throw new DwgServiceError(`Dönüştürme başarısız (HTTP ${res.status}).`, 'donusum')
  }
  const j = await res.json()
  if (!j.dxf) throw new DwgServiceError('Dönüştürücü geçerli bir DXF üretemedi; dosya okunamadı.', 'gecersiz_dxf')
  return {
    version: j.surum,
    release: j.surum_adi,
    seconds: j.sure_sn,
    repairedTexts: j.onarilan_metin ?? 0,
    warnings: j.uyarilar ?? [],
    quality: j.kalite,
    dxf: b64(j.dxf),
    pdf: j.pdf ? b64(j.pdf) : null,
    pdfPages: j.pdf_rapor?.pages ?? [],
  }
}

/** Kalite raporunun kullanıcıya kısa özeti */
export function qualitySummary(q: DwgQuality, repairedTexts: number): { ok: boolean; lines: string[] } {
  const lines: string[] = []
  const lost = Object.entries(q.lost)
  if (lost.length) lines.push(`Dönüşümde kaybolan: ${lost.map(([t, n]) => `${n} ${t}`).join(', ')}`)
  if (q.audit_errors > 0) lines.push(`DXF yapısal denetiminde ${q.audit_errors} sorun bulundu.`)
  if (repairedTexts) lines.push(`${repairedTexts} metin değerindeki satır sonu onarıldı.`)
  lines.push(...q.notes)
  return { ok: q.status === 'tamam', lines }
}
