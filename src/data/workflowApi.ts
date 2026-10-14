import type { SupabaseClient } from '@supabase/supabase-js'
import { insertOnce, versionedUpdate } from './api'
import type {
  AppNotification,
  NotificationPrefs,
  NotificationPrefsInput,
  ProjectEvent,
  ProjectTask,
  ProjectTaskInput,
  PushSubscriptionRow,
} from './types'

/**
 * Faz 7 veri erişimi: görevler, zaman çizelgesi, bildirimler, tercihler, push abonelikleri.
 * Bildirimler ve zaman çizelgesi yalnız sunucu tetikleyicileriyle oluşur; istemci yalnız okur
 * (bildirimde yalnız "okundu" alanını günceller).
 */

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error
  return res.data as T
}

// ------------------------------------------------------------------ Görevler
export async function listTasks(db: SupabaseClient, projectId: string): Promise<ProjectTask[]> {
  return unwrap(await db.from('project_tasks').select('*').eq('project_id', projectId).order('done').order('due_date', { ascending: true, nullsFirst: false }).order('created_at').limit(500))
}

/** Tüm açık görevler (görev ekranı ve panel) + son 30 günde tamamlananlar */
export async function listAllTasks(db: SupabaseClient): Promise<ProjectTask[]> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  return unwrap(await db.from('project_tasks').select('*').or(`done.eq.false,done_at.gte.${since}`).order('due_date', { ascending: true, nullsFirst: false }).limit(1000))
}

export function createTask(db: SupabaseClient, input: ProjectTaskInput): Promise<ProjectTask> {
  return insertOnce<ProjectTask>(db, 'project_tasks', input)
}

export function updateTask(db: SupabaseClient, t: Pick<ProjectTask, 'id' | 'version'>, patch: Partial<ProjectTaskInput>): Promise<ProjectTask> {
  return versionedUpdate<ProjectTask>(db, 'project_tasks', t.id, t.version, patch)
}

export async function deleteTask(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('project_tasks').delete().eq('id', id).select('id'))
}

// ------------------------------------------------------------------ Zaman çizelgesi
export async function listProjectEvents(db: SupabaseClient, projectId: string): Promise<ProjectEvent[]> {
  return unwrap(await db.from('project_events').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(300))
}

export async function listRecentEvents(db: SupabaseClient, limit = 12): Promise<ProjectEvent[]> {
  return unwrap(await db.from('project_events').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit))
}

// ------------------------------------------------------------------ Bildirimler
export async function listNotifications(db: SupabaseClient, limit = 300): Promise<AppNotification[]> {
  return unwrap(await db.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit))
}

export async function markNotificationsRead(db: SupabaseClient, ids: string[]): Promise<void> {
  if (!ids.length) return
  unwrap(await db.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids).is('read_at', null).select('id'))
}

export async function markAllNotificationsRead(db: SupabaseClient): Promise<void> {
  unwrap(await db.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null).select('id'))
}

export async function markNotificationUnread(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('notifications').update({ read_at: null }).eq('id', id).select('id'))
}

/** Sunucudaki hatırlatma taramasını tetikler (zamanlayıcıya ek güvence; tekilleştirilmiş) */
export async function checkReminders(db: SupabaseClient): Promise<number> {
  const res = await db.rpc('check_reminders')
  if (res.error) throw res.error
  return (res.data as number) ?? 0
}

export async function notifyClientEvent(db: SupabaseClient, kind: 'surum_yeni' | 'cad_hata' | 'push_test', title: string, body: string | null, link: string | null, key: string): Promise<void> {
  const res = await db.rpc('notify_client_event', { p_kind: kind, p_title: title, p_body: body, p_link: link, p_key: key })
  if (res.error) throw res.error
}

// ------------------------------------------------------------------ Tercihler
export async function getNotificationPrefs(db: SupabaseClient): Promise<NotificationPrefs | null> {
  return unwrap(await db.from('notification_prefs').select('*').maybeSingle())
}

export async function saveNotificationPrefs(db: SupabaseClient, input: NotificationPrefsInput, current: NotificationPrefs | null): Promise<NotificationPrefs> {
  if (!current) {
    const res = await db.from('notification_prefs').insert(input).select('*').single()
    if (!res.error) return res.data as NotificationPrefs
    // Başka cihaz aynı anda oluşturduysa güncellemeye düş
    if ((res.error as { code?: string }).code !== '23505') throw res.error
    const got = await getNotificationPrefs(db)
    if (!got) throw res.error
    current = got
  }
  return unwrap(await db.from('notification_prefs').update(input).eq('user_id', current.user_id).select('*').single())
}

// ------------------------------------------------------------------ Push
export async function getPushPublicKey(db: SupabaseClient): Promise<string | null> {
  const res = await db.rpc('push_public_key')
  if (res.error) throw res.error
  return (res.data as string | null) ?? null
}

export async function registerPushSubscription(db: SupabaseClient, sub: { endpoint: string; p256dh: string; auth: string }, userAgent: string, label: string | null): Promise<void> {
  const res = await db.rpc('register_push_subscription', { p_endpoint: sub.endpoint, p_p256dh: sub.p256dh, p_auth: sub.auth, p_user_agent: userAgent, p_label: label })
  if (res.error) throw res.error
}

export async function listPushSubscriptions(db: SupabaseClient): Promise<PushSubscriptionRow[]> {
  return unwrap(await db.from('push_subscriptions').select('id, endpoint, user_agent, device_label, created_at, last_seen_at, last_success_at, failure_count, disabled_at').order('last_seen_at', { ascending: false }))
}

export async function removePushSubscription(db: SupabaseClient, endpoint: string): Promise<void> {
  unwrap(await db.from('push_subscriptions').delete().eq('endpoint', endpoint).select('id'))
}
