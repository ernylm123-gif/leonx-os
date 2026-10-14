/**
 * Push gönderim çekirdeği (Edge Function ve testler ortak kullanır; çalışma ortamı bağımlılığı yok).
 *
 * Akış: yetki (zamanlayıcı gizli başlığı) → VAPID anahtarı yoksa üret ve sakla → bekleyen
 * bildirimleri sahiplen → her aboneliğe gönder → sonucu bildir (404/410: abonelik geçersiz).
 */

export interface PushConfig {
  vapid_public: string | null
  vapid_private: string | null
  vapid_subject: string
  cron_secret: string
}

export interface ClaimedNotification {
  id: string
  title: string
  body: string | null
  link: string | null
  category: string
  subscriptions: { endpoint: string; p256dh: string; auth: string }[]
}

export interface DispatchDeps {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<unknown>
  generateKeys: () => { publicKey: string; privateKey: string }
  /** Gönderir; HTTP durum kodunu döner (hata durumunda statusCode taşıyan istisna da olabilir) */
  send: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, vapid: { subject: string; publicKey: string; privateKey: string }) => Promise<number>
  log?: (msg: string) => void
}

export interface DispatchResult {
  status: number
  claimed: number
  sent: number
  gone: number
  failed: number
  keysCreated: boolean
}

/** Sabit zamanlı karşılaştırma (gizli başlık) */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

/** Bildirim yükü: SW gösterir; tag ile aynı bildirim cihazda bir kez görünür */
export function payloadOf(n: ClaimedNotification): string {
  return JSON.stringify({
    id: n.id,
    title: n.title.slice(0, 120),
    body: (n.body ?? '').slice(0, 240),
    link: n.link && n.link.startsWith('/') ? n.link : '/bildirimler',
    category: n.category,
  })
}

export async function runDispatch(secretHeader: string | null, deps: DispatchDeps, limit = 50): Promise<DispatchResult> {
  const res: DispatchResult = { status: 200, claimed: 0, sent: 0, gone: 0, failed: 0, keysCreated: false }
  let cfg = (await deps.rpc('push_service_config')) as PushConfig | null
  if (!cfg || !secretHeader || !safeEqual(secretHeader, cfg.cron_secret)) return { ...res, status: 401 }
  if (!cfg.vapid_public || !cfg.vapid_private) {
    const k = deps.generateKeys()
    cfg = (await deps.rpc('push_service_set_keys', { p_public: k.publicKey, p_private: k.privateKey })) as PushConfig
    res.keysCreated = true
    deps.log?.('VAPID anahtar çifti üretildi')
  }
  const vapid = { subject: cfg.vapid_subject, publicKey: cfg.vapid_public!, privateKey: cfg.vapid_private! }
  const claimed = ((await deps.rpc('push_service_claim', { p_limit: limit })) as ClaimedNotification[] | null) ?? []
  res.claimed = claimed.length
  for (const n of claimed) {
    const payload = payloadOf(n)
    const gone: string[] = []
    const failed: string[] = []
    let sent = 0
    for (const s of n.subscriptions) {
      let code: number
      try {
        code = await deps.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, vapid)
      } catch (e) {
        code = typeof (e as { statusCode?: unknown }).statusCode === 'number' ? (e as { statusCode: number }).statusCode : 0
      }
      if (code >= 200 && code < 300) sent++
      else if (code === 404 || code === 410) gone.push(s.endpoint)
      else failed.push(s.endpoint)
    }
    res.sent += sent
    res.gone += gone.length
    res.failed += failed.length
    await deps.rpc('push_service_report', { p_notification: n.id, p_sent: sent, p_gone: gone, p_failed: failed })
  }
  return res
}
