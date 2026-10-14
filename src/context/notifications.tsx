import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/auth'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { useUpdate } from '@/context/update'
import { type AppNotification, DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs, type NotificationPrefsInput } from '@/data/types'
import {
  checkReminders,
  getNotificationPrefs,
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  markNotificationUnread,
  notifyClientEvent,
  saveNotificationPrefs,
} from '@/data/workflowApi'
import { dataErrorMessage } from '@/lib/errors'
import { refreshPush } from '@/lib/push'
import { requireSupabase } from '@/lib/supabase'

/**
 * Bildirim merkezi: Supabase'de kalıcı bildirimler, Realtime ile tüm cihazlarda anlık
 * (okundu durumu dahil). Hatırlatma taraması sunucu zamanlayıcısıyla çalışır; uygulama açıkken
 * ayrıca 10 dakikada bir tetiklenir (tekilleştirildiği için çift bildirim oluşmaz).
 */

const REMINDER_MS = 10 * 60 * 1000

interface NotificationsValue {
  items: AppNotification[]
  unread: number
  loading: boolean
  error: string | null
  prefs: NotificationPrefs | null
  prefsValue: NotificationPrefsInput
  reload: () => Promise<void>
  markRead: (ids: string[]) => Promise<void>
  markAllRead: () => Promise<void>
  markUnread: (id: string) => Promise<void>
  savePrefs: (input: NotificationPrefsInput) => Promise<NotificationPrefs | null>
  /** Bildirimi aç: okundu işaretle ve bağlantıya git */
  open: (n: AppNotification) => void
}

const Ctx = createContext<NotificationsValue | null>(null)

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { subscribeDetail, syncState } = useData()
  const { notify } = useToast()
  const { session } = useAuth()
  const { available, latest } = useUpdate()
  const navigate = useNavigate()
  const me = session?.user.id ?? null
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null)
  const seen = useRef(new Set<string>())
  const lastReminder = useRef(0)

  const reload = useCallback(async () => {
    const db = requireSupabase()
    try {
      const [list, p] = await Promise.all([listNotifications(db), getNotificationPrefs(db)])
      for (const n of list) seen.current.add(n.id)
      setItems(list)
      setPrefs(p)
      setError(null)
    } catch (e) {
      setError(dataErrorMessage(e, 'Bildirimleri yükleme'))
    } finally {
      setLoading(false)
    }
  }, [])

  const runReminders = useCallback(async () => {
    if (Date.now() - lastReminder.current < 60_000) return
    lastReminder.current = Date.now()
    try {
      await checkReminders(requireSupabase())
    } catch {
      /* zamanlayıcı sunucuda da çalışır; burada hata kullanıcıya gösterilmez */
    }
  }, [])

  useEffect(() => {
    void reload().then(() => void runReminders())
    void refreshPush(requireSupabase()).catch(() => undefined)
    const t = window.setInterval(() => document.visibilityState === 'visible' && void runReminders(), REMINDER_MS)
    const onVisible = () => document.visibilityState === 'visible' && Date.now() - lastReminder.current > REMINDER_MS && void runReminders()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [reload, runReminders])

  // Yeniden bağlanınca tam yenileme (kaçırılan olaylar)
  const prevSync = useRef(syncState)
  useEffect(() => {
    if (syncState === 'live' && prevSync.current !== 'live') void reload()
    prevSync.current = syncState
  }, [syncState, reload])

  // Realtime: yeni bildirim ve okundu değişiklikleri (diğer cihazlardan da)
  useEffect(
    () =>
      subscribeDetail('notifications', (payload) => {
        if (payload.eventType === 'DELETE') return void reload()
        const row = payload.new as unknown as AppNotification
        if (!row?.id) return
        setItems((l) => {
          const i = l.findIndex((x) => x.id === row.id)
          if (i === -1) return [row, ...l].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          const next = l.slice()
          next[i] = { ...next[i], ...row }
          return next
        })
        // Başka cihazdaki işlemden / sistemden gelen yeni bildirim kısa uyarıyla gösterilir
        if (payload.eventType === 'INSERT' && !seen.current.has(row.id)) {
          seen.current.add(row.id)
          const own = !!me && row.actor === me
          if (!own && !row.read_at) notify(row.title, 'info')
        }
      }),
    [subscribeDetail, reload, notify, me],
  )
  useEffect(() => subscribeDetail('notification_prefs', () => void getNotificationPrefs(requireSupabase()).then(setPrefs).catch(() => undefined)), [subscribeDetail])

  // Yeni uygulama sürümü: bildirim merkezine bir kez (tüm cihazlarda aynı kayıt)
  useEffect(() => {
    if (!available || !latest?.buildId) return
    void notifyClientEvent(requireSupabase(), 'surum_yeni', 'Yeni LEONX OS sürümü hazır', `Sürüm ${latest.version} · ${latest.commit}`, '/ayarlar', latest.buildId).catch(() => undefined)
  }, [available, latest?.buildId, latest?.version, latest?.commit])

  // Push bildirimine dokunulunca açık uygulama ilgili ekrana gider
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; link?: string; id?: string } | null
      if (d?.type === 'leonx-open' && typeof d.link === 'string' && d.link.startsWith('/')) {
        navigate(d.link)
        if (d.id) void markNotificationsRead(requireSupabase(), [d.id]).catch(() => undefined)
      }
      if (d?.type === 'leonx-resubscribe') void refreshPush(requireSupabase()).catch(() => undefined)
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [navigate])

  const markRead = useCallback(async (ids: string[]) => {
    const now = new Date().toISOString()
    const target = new Set(ids)
    setItems((l) => l.map((n) => (target.has(n.id) && !n.read_at ? { ...n, read_at: now } : n)))
    try {
      await markNotificationsRead(requireSupabase(), ids)
    } catch (e) {
      notify(dataErrorMessage(e, 'Okundu işaretleme'), 'error')
      void reload()
    }
  }, [notify, reload])

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString()
    setItems((l) => l.map((n) => (n.read_at ? n : { ...n, read_at: now })))
    try {
      await markAllNotificationsRead(requireSupabase())
    } catch (e) {
      notify(dataErrorMessage(e, 'Okundu işaretleme'), 'error')
      void reload()
    }
  }, [notify, reload])

  const markUnread = useCallback(async (id: string) => {
    setItems((l) => l.map((n) => (n.id === id ? { ...n, read_at: null } : n)))
    try {
      await markNotificationUnread(requireSupabase(), id)
    } catch (e) {
      notify(dataErrorMessage(e, 'Güncelleme'), 'error')
      void reload()
    }
  }, [notify, reload])

  const savePrefs = useCallback(
    async (input: NotificationPrefsInput) => {
      try {
        const saved = await saveNotificationPrefs(requireSupabase(), input, prefs)
        setPrefs(saved)
        return saved
      } catch (e) {
        notify(dataErrorMessage(e, 'Bildirim tercihleri'), 'error')
        return null
      }
    },
    [prefs, notify],
  )

  const open = useCallback(
    (n: AppNotification) => {
      if (!n.read_at) void markRead([n.id])
      if (n.link) navigate(n.link)
    },
    [markRead, navigate],
  )

  const value = useMemo<NotificationsValue>(() => {
    const { user_id: _u, version: _v, ...rest } = prefs ?? ({ ...DEFAULT_NOTIFICATION_PREFS, user_id: '', version: 0 } as NotificationPrefs)
    return {
      items,
      unread: items.filter((n) => !n.read_at).length,
      loading,
      error,
      prefs,
      prefsValue: rest,
      reload,
      markRead,
      markAllRead,
      markUnread,
      savePrefs,
      open,
    }
  }, [items, loading, error, prefs, reload, markRead, markAllRead, markUnread, savePrefs, open])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNotifications(): NotificationsValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNotifications, NotificationsProvider içinde kullanılmalıdır')
  return ctx
}
