/// <reference types="node" />
import { createECDH, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { type ClaimedNotification, payloadOf, runDispatch, safeEqual } from './dispatch'

/**
 * Push gönderim çekirdeği: yetki, VAPID anahtarının bir kez üretilmesi, gönderim sonuçlarının
 * (başarılı / geçersiz abonelik / geçici hata) doğru bildirilmesi ve gerçek Web Push
 * şifrelemesinin (RFC 8291 aes128gcm + VAPID) abone anahtarıyla çözülebilmesi.
 */
function fakeDb(opts: { keys?: boolean; claimed?: ClaimedNotification[] } = {}) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = []
  let cfg = { vapid_public: opts.keys ? 'PUB' : null, vapid_private: opts.keys ? 'PRIV' : null, vapid_subject: 'mailto:test@leonx.test', cron_secret: 'gizli-123' }
  return {
    calls,
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args })
      if (fn === 'push_service_config') return cfg
      if (fn === 'push_service_set_keys') {
        if (!cfg.vapid_public) cfg = { ...cfg, vapid_public: String(args!.p_public), vapid_private: String(args!.p_private) }
        return cfg
      }
      if (fn === 'push_service_claim') return opts.claimed ?? []
      return null
    },
  }
}

const notif = (subs: string[]): ClaimedNotification => ({
  id: 'n1',
  title: 'Görev gecikti: Ölçü',
  body: 'LX-2026-001',
  link: '/projeler/x?sekme=gorevler',
  category: 'gorev',
  subscriptions: subs.map((e) => ({ endpoint: e, p256dh: 'k', auth: 'a' })),
})

describe('push-dispatch', () => {
  it('gizli başlık yanlışsa hiçbir şey yapmaz (401)', async () => {
    const db = fakeDb({ keys: true })
    const r = await runDispatch('yanlis', { rpc: db.rpc, generateKeys: () => ({ publicKey: 'x', privateKey: 'y' }), send: async () => 201 })
    expect(r.status).toBe(401)
    expect(db.calls.map((c) => c.fn)).toEqual(['push_service_config'])
    expect((await runDispatch(null, { rpc: db.rpc, generateKeys: () => ({ publicKey: 'x', privateKey: 'y' }), send: async () => 201 })).status).toBe(401)
  })

  it('anahtar yoksa bir kez üretir ve saklar', async () => {
    const db = fakeDb()
    let gen = 0
    const deps = { rpc: db.rpc, generateKeys: () => (gen++, { publicKey: 'YENI_PUB', privateKey: 'YENI_PRIV' }), send: async () => 201 }
    expect((await runDispatch('gizli-123', deps)).keysCreated).toBe(true)
    expect((await runDispatch('gizli-123', deps)).keysCreated).toBe(false)
    expect(gen).toBe(1)
  })

  it('sonuçlar: 201 gönderildi, 410/404 geçersiz, 500/ağ hatası geçici', async () => {
    const db = fakeDb({ keys: true, claimed: [notif(['https://ok', 'https://gone', 'https://nf', 'https://err', 'https://net'])] })
    const codes: Record<string, number> = { 'https://ok': 201, 'https://gone': 410, 'https://nf': 404, 'https://err': 500 }
    const r = await runDispatch('gizli-123', {
      rpc: db.rpc,
      generateKeys: () => ({ publicKey: 'x', privateKey: 'y' }),
      send: async (s) => {
        if (s.endpoint === 'https://net') throw Object.assign(new Error('ECONNRESET'), {})
        if (codes[s.endpoint] >= 400) throw Object.assign(new Error('push hata'), { statusCode: codes[s.endpoint] })
        return codes[s.endpoint]
      },
    })
    expect([r.claimed, r.sent, r.gone, r.failed]).toEqual([1, 1, 2, 2])
    const rep = db.calls.find((c) => c.fn === 'push_service_report')!.args!
    expect(rep).toEqual({ p_notification: 'n1', p_sent: 1, p_gone: ['https://gone', 'https://nf'], p_failed: ['https://err', 'https://net'] })
  })

  it('yük yalnız uygulama içi bağlantı taşır ve kısaltılır', () => {
    const p = JSON.parse(payloadOf({ ...notif([]), link: 'https://kotu.example', title: 'x'.repeat(500) }))
    expect(p.link).toBe('/bildirimler')
    expect(p.title.length).toBe(120)
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
  })

  it('gerçek Web Push şifrelemesi: abone kendi anahtarıyla yükü çözer, VAPID başlığı imzalı', async () => {
    const webpush = (await import('web-push')).default
    const ece = (await import('http_ece')).default
    const vapid = webpush.generateVAPIDKeys()
    const sub = createECDH('prime256v1')
    sub.generateKeys()
    const authSecret = randomBytes(16)
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-abone', keys: { p256dh: sub.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') } }
    const payload = payloadOf(notif([]))
    const req = webpush.generateRequestDetails(subscription, payload, { TTL: 86400, vapidDetails: { subject: 'mailto:test@leonx.test', ...vapid } })
    expect(req.headers['Content-Encoding']).toBe('aes128gcm')
    expect(String(req.headers.Authorization)).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/)
    const plain = ece.decrypt(req.body, { version: 'aes128gcm', privateKey: sub, authSecret })
    expect(JSON.parse(plain.toString('utf8'))).toMatchObject({ id: 'n1', link: '/projeler/x?sekme=gorevler', category: 'gorev' })
  })
})
