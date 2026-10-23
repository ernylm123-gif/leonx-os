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

/**
 * Sunucuya (Supabase) ulaşılamıyor mu? Ağ hatası, zaman aşımı/iptal (bkz. supabase.ts →
 * fetchWithTimeout) veya 5xx yanıtı. Cihazın çevrimdışı olup olmadığı ayrıca kontrol edilmelidir.
 */
export function isServerUnreachable(e: unknown): boolean {
  const err = e as AppErrorLike | undefined
  const msg = (err?.message ?? '').toLowerCase()
  if (isNetworkError(e)) return true
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return true
  if (msg.includes('aborterror') || msg.includes('timeouterror') || msg.includes('timed out')) return true
  return typeof err?.status === 'number' && (err.status === 0 || err.status >= 500)
}

/**
 * Oturum belirteci sunucuda geçersiz veya süresi dolmuş (PostgREST 401 / PGRST301 / PGRST303,
 * "JWT expired"). Cihaz saati yanlışsa istemci belirteci geçerli sanabilir; sunucu reddeder.
 */
export function isAuthExpiredError(e: unknown): boolean {
  const err = e as AppErrorLike | undefined
  const msg = (err?.message ?? '').toLowerCase()
  return err?.status === 401 || err?.code === 'PGRST301' || err?.code === 'PGRST303' || msg.includes('jwt expired') || msg.includes('invalid jwt')
}

/** PostgREST yanıtının HTTP durumunu hata nesnesine ekler (hata nesnesi durum taşımaz) */
export function withHttpStatus<E>(error: E, status: number | undefined): E {
  if (error && typeof error === 'object' && typeof status === 'number' && typeof (error as AppErrorLike).status !== 'number') {
    try {
      ;(error as AppErrorLike).status = status
    } catch {
      /* dondurulmuş nesne */
    }
  }
  return error
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
  // Veritabanı tetikleyicilerimizin Türkçe iş kuralı iletileri olduğu gibi gösterilir
  if (err?.message && /^(Onaylanmış|Arşivlenmiş|Poz |Metraj |Yeni metraj|Kaynak metraj)/.test(err.message)) return err.message
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
  if (isServerUnreachable(e)) return 'Sunucuya (Supabase) ulaşılamıyor. Biraz sonra tekrar deneyin; verileriniz güvende.'
  if (isAuthExpiredError(e)) return 'Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.'
  return `${context} tamamlanamadı. Lütfen tekrar deneyin.`
}
