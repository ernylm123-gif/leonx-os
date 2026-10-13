import { describe, expect, it } from 'vitest'
import { authErrorMessage, dataErrorMessage } from './errors'

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
