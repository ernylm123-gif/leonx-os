/**
 * LEONX Radar — tavsiye niteliğinde sonraki adım (DOĞRULANMIŞ BİLGİ DEĞİLDİR).
 *
 * Kayıtlı alanlardan açıklanabilir bir kuralla beş öneriden biri seçilir:
 *   Hemen iletişime geç · Teklif hazırla · Araştırmaya devam et · Sonra takip et · Düşük öncelik
 * Gerekçe her zaman döner; arayüz ve asistan bunu "öneri" olarak etiketler.
 */

export type AdviceKey = 'hemen_iletisim' | 'teklif_hazirla' | 'arastir' | 'takip' | 'dusuk'

export const ADVICE_TEXT: Record<AdviceKey, string> = {
  hemen_iletisim: 'Hemen iletişime geç',
  teklif_hazirla: 'Teklif hazırla',
  arastir: 'Araştırmaya devam et',
  takip: 'Sonra takip et',
  dusuk: 'Düşük öncelik',
}

export interface AdviceInput {
  score: number
  verified_need: boolean
  stage: string
  status: string
  deadline: string | null
  /** Doğrulanmış (kaynaklı) iletişim kanalı var mı */
  hasContact: boolean
  /** Fırsata bağlı teklif taslağı var mı */
  hasQuote?: boolean
  now: Date
}

export interface Advice {
  key: AdviceKey
  text: string
  reason: string
}

const CLOSED = new Set(['kazanildi', 'kaybedildi', 'ilgisiz'])

export function advise(o: AdviceInput): Advice {
  const out = (key: AdviceKey, reason: string): Advice => ({ key, text: ADVICE_TEXT[key], reason })
  const today = o.now.toISOString().slice(0, 10)
  const daysLeft = o.deadline ? Math.round((Date.parse(o.deadline) - Date.parse(today)) / 86400000) : null
  if (CLOSED.has(o.status)) return out('dusuk', 'Kayıt kapatılmış (kazanıldı / kaybedildi / ilgisiz)')
  if (daysLeft !== null && daysLeft < 0) return out('dusuk', 'Son teklif tarihi geçmiş')
  if (o.stage === 'tamamlandi') return out('dusuk', 'Proje tamamlanmış görünüyor')
  if (o.status === 'teklif_verildi' || o.status === 'gorusme') return out('takip', 'Teklif verildi / görüşme sürüyor; yanıtı takip edin')
  if (o.status === 'teklif_istendi' && !o.hasQuote) return out('teklif_hazirla', 'Teklif istendi ama bağlı teklif taslağı yok')
  if (o.status === 'teklif_istendi') return out('teklif_hazirla', 'Teklif taslağını tamamlayıp gönderin')
  if (o.status === 'iletisime_gecildi') return out('takip', 'İletişime geçildi; dönüşü takip edin')
  if (o.verified_need && o.hasContact && o.score >= 60) {
    return out('hemen_iletisim', daysLeft !== null ? `Doğrulanmış ihtiyaç, kaynaklı iletişim kanalı var; son tarihe ${daysLeft} gün` : 'Doğrulanmış ihtiyaç ve kaynaklı iletişim kanalı var')
  }
  if (o.score >= 50 && !o.hasContact) return out('arastir', 'Puan yüksek ama doğrulanmış iletişim kanalı yok; firmayı ve satın alma birimini araştırın')
  if (o.score >= 50 && !o.verified_need) return out('arastir', 'İhtiyaç kaynakla doğrulanmadı; ilanı / proje sahibini doğrulayın')
  if (o.score >= 40) return out('takip', o.stage === 'planlama' ? 'Planlama aşamasında; ihale/satın alma aşamasını izleyin' : 'Gelişmeleri izleyin')
  return out('dusuk', `Puan düşük (${o.score})`)
}
