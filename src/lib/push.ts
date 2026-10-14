import type { SupabaseClient } from '@supabase/supabase-js'
import { getPushPublicKey, registerPushSubscription, removePushSubscription } from '@/data/workflowApi'
import { PUSH_SW_URL } from './appVersion'

/**
 * Web Push (VAPID) istemci tarafı. Tek service worker (/sw.js) yalnız bildirim gösterir.
 * Gizli VAPID anahtarı sunucudadır; burada yalnız açık anahtar kullanılır.
 */

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: 'tarayici' | 'ios-ana-ekran' | 'guvensiz' | 'izin-reddedildi'; message: string }

export function isIos(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return { ok: false, reason: 'tarayici', message: 'Tarayıcı ortamı yok.' }
  if (!window.isSecureContext) return { ok: false, reason: 'guvensiz', message: 'Push bildirimleri yalnız güvenli (https) bağlantıda çalışır.' }
  const has = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!has) {
    if (isIos() && !isStandalone())
      return { ok: false, reason: 'ios-ana-ekran', message: 'iPhone/iPad’de push bildirimi için LEONX OS’yi Safari’de Paylaş → “Ana Ekrana Ekle” ile kurun ve ana ekrandaki simgeden açın (iOS 16.4+).' }
    return { ok: false, reason: 'tarayici', message: 'Bu tarayıcı push bildirimlerini desteklemiyor. Güncel Chrome, Edge, Firefox veya Safari kullanın.' }
  }
  if (Notification.permission === 'denied')
    return { ok: false, reason: 'izin-reddedildi', message: 'Bildirim izni bu cihazda reddedilmiş. Tarayıcı / sistem ayarlarından LEONX OS için bildirimlere izin verin.' }
  return { ok: true }
}

/** base64url → Uint8Array (applicationServerKey) */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

const b64url = (buf: ArrayBuffer | null): string => {
  if (!buf) return ''
  let s = ''
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function deviceLabel(ua = navigator.userAgent): string {
  const os = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Cihaz'
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Tarayıcı'
  return `${os} · ${br}${isStandalone() ? ' (uygulama)' : ''}`
}

export async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration('/')) ?? null
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

export class PushSetupError extends Error {}

/** Kullanıcının dokunuşuyla çağrılmalı (izin penceresi) */
export async function enablePush(db: SupabaseClient): Promise<PushSubscription> {
  const support = pushSupport()
  if (!support.ok) throw new PushSetupError(support.message)
  const key = await getPushPublicKey(db)
  if (!key) throw new PushSetupError('Push sunucusu henüz hazırlanıyor (birkaç dakika sürebilir). Lütfen biraz sonra tekrar deneyin.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new PushSetupError('Bildirim izni verilmedi. İzin vermeden push bildirimi gönderilemez.')
  const reg = await navigator.serviceWorker.register(PUSH_SW_URL, { scope: '/' })
  await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  const want = urlBase64ToUint8Array(key)
  // Sunucu anahtarı değiştiyse eski abonelik bırakılır
  if (sub && sub.options.applicationServerKey && b64url(sub.options.applicationServerKey) !== b64url(want.buffer)) {
    await sub.unsubscribe().catch(() => undefined)
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want })
  await saveSubscription(db, sub)
  return sub
}

async function saveSubscription(db: SupabaseClient, sub: PushSubscription) {
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new PushSetupError('Tarayıcı geçerli bir abonelik üretmedi.')
  await registerPushSubscription(db, { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth }, navigator.userAgent.slice(0, 300), deviceLabel())
}

/** Bu cihazın aboneliğini kaldırır (diğer cihazlar etkilenmez) */
export async function disablePush(db: SupabaseClient): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe().catch(() => undefined)
  await removePushSubscription(db, endpoint)
}

/** Açılışta: izin verilmiş ve abonelik varsa sunucudaki kaydı tazeler (yeni anahtar/uç nokta) */
export async function refreshPush(db: SupabaseClient): Promise<'yok' | 'guncel'> {
  if (!pushSupport().ok || Notification.permission !== 'granted') return 'yok'
  const sub = await currentSubscription()
  if (!sub) return 'yok'
  await saveSubscription(db, sub)
  return 'guncel'
}
