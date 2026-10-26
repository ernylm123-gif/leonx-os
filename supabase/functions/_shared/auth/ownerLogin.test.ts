import { describe, expect, it, vi } from 'vitest'
import { clientIp, deviceLabel, handleOwnerLogin, type OwnerLoginDeps, sessionIdOf, sha256Hex } from './ownerLogin.ts'

const SESSION = { access_token: 'erisim', refresh_token: 'yenileme', expires_in: 3600, expires_at: 1 }

function deps(over: Partial<OwnerLoginDeps> = {}): OwnerLoginDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    ownerEmail: 'sahip@ornek.test',
    check: vi.fn(async () => 0),
    record: vi.fn(async () => 0),
    signIn: vi.fn(async (email: string, password: string) => {
      calls.push(email)
      return password === 'Dogru-Sifre' ? { session: SESSION, error: null } : { session: null, error: 'invalid' as const }
    }),
    sleep: vi.fn(async () => {}),
    consumeCode: vi.fn(async () => false),
    issueSession: vi.fn(async () => ({ session: { ...SESSION, access_token: 'kod-erisim' }, error: null as null })),
    registerDevice: vi.fn(async () => {}),
    ...over,
  }
}

describe('owner-login', () => {
  it('yalnız şifre ile sunucu tarafı e-postayla giriş yapar; e-posta yanıta girmez', async () => {
    const d = deps()
    const r = await handleOwnerLogin({ password: 'Dogru-Sifre' }, '203.0.113.5', d)
    expect(r.status).toBe(200)
    expect(r.body.access_token).toBe('erisim')
    expect(d.calls).toEqual(['sahip@ornek.test'])
    expect(JSON.stringify(r.body)).not.toContain('sahip@ornek.test')
    expect(d.record).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/), true)
  })

  it('istemcinin gönderdiği e-posta yok sayılır', async () => {
    const d = deps()
    await handleOwnerLogin({ password: 'Dogru-Sifre', email: 'saldirgan@kotu.test' }, '1.1.1.1', d)
    expect(d.calls).toEqual(['sahip@ornek.test'])
  })

  it('hatalı şifre: genel ileti, sayaç artar, sabit gecikme', async () => {
    const d = deps()
    const r = await handleOwnerLogin({ password: 'yanlis' }, '1.1.1.1', d)
    expect(r).toEqual({ status: 401, body: { error: 'Şifre hatalı.', code: 'invalid_credentials' } })
    expect(d.record).toHaveBeenCalledWith(expect.any(String), false)
    expect(d.sleep).toHaveBeenCalled()
  })

  it('kilitliyken Supabase Auth çağrılmaz', async () => {
    const d = deps({ check: vi.fn(async () => 90) })
    const r = await handleOwnerLogin({ password: 'Dogru-Sifre' }, '1.1.1.1', d)
    expect(r.status).toBe(429)
    expect(r.body.retry_after).toBe(90)
    expect(String(r.body.error)).toContain('90 saniye')
    expect(d.signIn).not.toHaveBeenCalled()
  })

  it('kilidi başlatan hatalı deneme bekleme süresini bildirir', async () => {
    const r = await handleOwnerLogin({ password: 'yanlis' }, '1.1.1.1', deps({ record: vi.fn(async () => 30) }))
    expect(r.status).toBe(429)
    expect(String(r.body.error)).toContain('30 saniye')
  })

  it('boş/çok uzun şifre ve yapılandırılmamış hizmet', async () => {
    expect((await handleOwnerLogin({}, '1.1.1.1', deps())).status).toBe(400)
    expect((await handleOwnerLogin({ password: 'x'.repeat(201) }, '1.1.1.1', deps())).status).toBe(400)
    expect((await handleOwnerLogin(null, '1.1.1.1', deps())).status).toBe(400)
    const r = await handleOwnerLogin({ password: 'Dogru-Sifre' }, '1.1.1.1', deps({ ownerEmail: '' }))
    expect(r.status).toBe(503)
    expect(r.body.code).toBe('not_configured')
  })

  it('Supabase Auth hız sınırı ve erişilemezlik ayrı iletilir, sayaç artmaz', async () => {
    const rl = deps({ signIn: vi.fn(async () => ({ session: null, error: 'rate_limited' as const })) })
    expect((await handleOwnerLogin({ password: 'a' }, '1.1.1.1', rl)).status).toBe(429)
    expect(rl.record).not.toHaveBeenCalled()
    const un = deps({ signIn: vi.fn(async () => ({ session: null, error: 'unavailable' as const })) })
    expect((await handleOwnerLogin({ password: 'a' }, '1.1.1.1', un)).status).toBe(502)
  })

  it('IP açık metin saklanmaz; tuz özeti değiştirir', async () => {
    const seen: string[] = []
    const d = deps({ record: vi.fn(async (h: string) => (seen.push(h), 0)) })
    await handleOwnerLogin({ password: 'yanlis' }, '203.0.113.5', d)
    await handleOwnerLogin({ password: 'yanlis' }, '203.0.113.5', { ...d, salt: 'gizli' })
    expect(seen[0]).toBe(await sha256Hex('|203.0.113.5'))
    expect(seen[0]).not.toBe(seen[1])
    expect(seen.join('')).not.toContain('203.0.113.5')
  })

  it('istemci IP başlıkları', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }))).toBe('203.0.113.5')
    expect(clientIp(new Headers({ 'cf-connecting-ip': '2001:DB8::1' }))).toBe('2001:db8::1')
    expect(clientIp(new Headers({ 'x-forwarded-for': '<script>' }))).toBe('bilinmiyor')
    expect(clientIp(new Headers())).toBe('bilinmiyor')
  })

  it('tek kullanımlık kayıt kodu: özetle tüketilir, oturum sunucuda üretilir, cihaz kaydedilir', async () => {
    const used = new Set<string>()
    const open = await sha256Hex('123456')
    const d = deps({ consumeCode: vi.fn(async (h: string) => h === open && !used.has(h) && (used.add(h), true)) })
    const r = await handleOwnerLogin({ password: '123456', device: 'iPhone · Safari' }, '1.1.1.1', d)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ access_token: 'kod-erisim', method: 'kod' })
    expect(d.signIn).not.toHaveBeenCalled()
    expect(d.registerDevice).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'kod-erisim' }), 'iPhone · Safari', 'kod')
    // İkinci kullanım: kod tükenmiş → şifre olarak denenir ve reddedilir
    const again = await handleOwnerLogin({ password: '123456' }, '1.1.1.1', d)
    expect(again.status).toBe(401)
    expect(d.consumeCode).toHaveBeenCalledWith(open)
  })

  it('kilitliyken kod da denenemez; şifre girişi de cihaz kaydeder', async () => {
    const locked = deps({ check: vi.fn(async () => 60), consumeCode: vi.fn(async () => true) })
    expect((await handleOwnerLogin({ password: '123456' }, '1.1.1.1', locked)).status).toBe(429)
    expect(locked.consumeCode).not.toHaveBeenCalled()
    const d = deps()
    await handleOwnerLogin({ password: 'Dogru-Sifre' }, '1.1.1.1', d)
    expect(d.registerDevice).toHaveBeenCalledWith(expect.anything(), 'Cihaz', 'sifre')
  })

  it('kod kabul edilip oturum üretilemezse açık ileti', async () => {
    const d = deps({ consumeCode: vi.fn(async () => true), issueSession: vi.fn(async () => ({ session: null, error: 'unavailable' as const })) })
    const r = await handleOwnerLogin({ password: '123456' }, '1.1.1.1', d)
    expect(r.status).toBe(502)
    expect(String(r.body.error)).toContain('Yeni bir kod')
  })

  it('cihaz adı temizlenir; oturum kimliği belirteçten okunur', () => {
    expect(deviceLabel('<b>iPad</b>\n Safari')).toBe('biPad/b Safari')
    expect(deviceLabel(42)).toBe('Cihaz')
    expect(deviceLabel('x'.repeat(300))).toHaveLength(120)
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    expect(sessionIdOf(`h.${b64({ session_id: '99999999-9999-4999-8999-999999999999' })}.s`)).toBe('99999999-9999-4999-8999-999999999999')
    expect(sessionIdOf('bozuk')).toBeNull()
  })
})
