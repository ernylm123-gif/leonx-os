import { describe, expect, it } from 'vitest'
import { authErrorMessage, dataErrorMessage, isAuthExpiredError, isServerUnreachable, withHttpStatus } from './errors'

describe('bağlantı ve oturum hatası sınıflandırması', () => {
  it('ağ hatası, zaman aşımı ve 5xx "sunucuya ulaşılamıyor" sayılır; iş kuralı hataları sayılmaz', () => {
    expect(isServerUnreachable({ message: 'TypeError: Failed to fetch', status: 0 })).toBe(true)
    expect(isServerUnreachable({ message: 'AbortError: signal is aborted without reason', code: '' })).toBe(true)
    expect(isServerUnreachable({ name: 'TimeoutError', message: 'x' })).toBe(true)
    expect(isServerUnreachable({ message: 'Service Unavailable', status: 503 })).toBe(true)
    expect(isServerUnreachable({ message: 'upstream', status: 520 })).toBe(true)
    expect(isServerUnreachable({ code: '23505', status: 409 })).toBe(false)
    expect(isServerUnreachable({ code: 'PGRST303', status: 401 })).toBe(false)
    expect(isServerUnreachable(null)).toBe(false)
  })
  it('süresi dolmuş / geçersiz belirteç ayırt edilir', () => {
    expect(isAuthExpiredError({ code: 'PGRST303', message: 'JWT expired', status: 401 })).toBe(true)
    expect(isAuthExpiredError({ code: 'PGRST301' })).toBe(true)
    expect(isAuthExpiredError({ message: 'JWT expired' })).toBe(true)
    expect(isAuthExpiredError({ code: '42501', status: 403 })).toBe(false)
  })
  it('HTTP durumu hata nesnesine eklenir, var olan durum ezilmez', () => {
    expect(withHttpStatus({ message: 'x' }, 503)).toEqual({ message: 'x', status: 503 })
    expect(withHttpStatus({ message: 'x', status: 413 }, 400)).toEqual({ message: 'x', status: 413 })
    expect(withHttpStatus(null, 500)).toBeNull()
  })
  it('kullanıcı iletileri', () => {
    expect(dataErrorMessage({ message: 'Service Unavailable', status: 503 })).toMatch(/Sunucuya \(Supabase\) ulaşılamıyor/)
    expect(dataErrorMessage({ code: 'PGRST303', message: 'JWT expired', status: 401 })).toMatch(/süresi doldu/)
  })
})

describe('hata iletileri', () => {
  it('giriş hataları', () => {
    expect(authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('E-posta veya şifre hatalı.')
    expect(authErrorMessage({ message: 'Failed to fetch' })).toMatch(/Sunucuya ulaşılamadı/)
    expect(authErrorMessage({ status: 429 })).toMatch(/Çok fazla deneme/)
  })
  it('veri hataları teknik ayrıntı sızdırmaz', () => {
    expect(dataErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "projects_code_key"' })).not.toMatch(/projects_code_key/)
    expect(dataErrorMessage({ code: '23503' })).toMatch(/ilişkili/)
    expect(dataErrorMessage({ code: '42501' })).toMatch(/yetkiniz yok/)
    expect(dataErrorMessage({ code: 'PGRST202' })).toMatch(/Migration/)
    expect(dataErrorMessage({ code: 'XX000', message: 'iç hata' }, 'Kayıt')).toBe('Kayıt tamamlanamadı. Lütfen tekrar deneyin.')
  })
})
