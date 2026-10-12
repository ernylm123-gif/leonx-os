/**
 * Supabase / PostgREST / Auth hatalarını kullanıcıya gösterilecek Türkçe iletiye çevirir.
 * Teknik ayrıntı (SQL, tablo adı vb.) kullanıcıya gösterilmez.
 */
export interface AppErrorLike {
  code?: string
  message?: string
  status?: number
  name?: string
}

export function isNetworkError(e: unknown): boolean {
  const err = e as AppErrorLike | undefined
  const msg = (err?.message ?? '').toLowerCase()
  return (
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    err?.name === 'AuthRetryableFetchError' ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('load failed') ||
    msg.includes('network request failed')
  )
}

export function authErrorMessage(e: unknown): string {
  if (isNetworkError(e)) return 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.'
  const err = e as AppErrorLike
  const code = err?.code ?? ''
  const msg = (err?.message ?? '').toLowerCase()
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return 'E-posta veya şifre hatalı.'
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) return 'E-posta adresi henüz doğrulanmamış. Supabase panelinden kullanıcıyı onaylayın.'
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || err?.status === 429)
    return 'Çok fazla deneme yapıldı. Birkaç dakika bekleyip tekrar deneyin.'
  if (code === 'user_banned') return 'Bu hesap devre dışı bırakılmış.'
  return 'Giriş yapılamadı. Lütfen tekrar deneyin.'
}

export function dataErrorMessage(e: unknown, context = 'İşlem'): string {
  if (isNetworkError(e)) return 'Bağlantı yok. İnternet bağlantınızı kontrol edip tekrar deneyin.'
  const err = e as AppErrorLike
  switch (err?.code) {
    case '23505':
      return 'Bu değer zaten kullanılıyor (ör. aynı proje kodu).'
    case '23503':
      return 'Bu kayıt başka kayıtlarla ilişkili olduğu için işlem yapılamadı.'
    case '23514':
    case '22P02':
    case '22007':
    case '22008':
      return 'Girilen bilgilerden biri geçersiz. Alanları kontrol edin.'
    case '42501':
    case 'PGRST301':
      return 'Bu işlem için yetkiniz yok. Oturumunuzu yenileyin.'
    case 'PGRST202':
    case 'PGRST205':
    case '42P01':
    case '42883':
      return 'Veritabanı kurulumu tamamlanmamış. Migration dosyalarının uygulandığını kontrol edin.'
    case 'PGRST116':
      return 'Kayıt bulunamadı. Başka bir cihazda silinmiş olabilir.'
  }
  if (err?.status === 413 || (err?.message ?? '').toLowerCase().includes('exceeded the maximum allowed size')) {
    return 'Dosya boyut sınırını aşıyor.'
  }
  return `${context} tamamlanamadı. Lütfen tekrar deneyin.`
}
