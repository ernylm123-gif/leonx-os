import { describe, expect, it } from 'vitest'
import { deviceLabel, sessionIdFromToken } from './device'

describe('cihaz adı', () => {
  it('işletim sistemi ve tarayıcı', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', false)).toBe('iPhone · Safari')
    expect(deviceLabel('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', true)).toBe('iPad · Uygulama (PWA)')
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36', false)).toBe('Android · Chrome')
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0', false)).toBe('Windows · Edge')
  })
  it('oturum kimliği', () => {
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    expect(sessionIdFromToken(`h.${b64({ session_id: 'abc' })}.s`)).toBe('abc')
    expect(sessionIdFromToken('x')).toBeNull()
    expect(sessionIdFromToken(null)).toBeNull()
  })
})
