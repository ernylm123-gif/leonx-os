import { describe, expect, it } from 'vitest'
import { urlBase64ToUint8Array } from './push'

describe('push yardımcıları', () => {
  it('VAPID açık anahtarı (base64url) 65 baytlık P-256 noktasına çözülür', () => {
    // web-push ile üretilmiş örnek açık anahtar biçimi
    const key = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
    const bytes = urlBase64ToUint8Array(key)
    expect(bytes.length).toBe(65)
    expect(bytes[0]).toBe(4)
  })
})
