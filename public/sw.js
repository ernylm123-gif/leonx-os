/*
 * LEONX OS — push bildirim çalışanı.
 * YALNIZ bildirim gösterir ve dokunulunca ilgili ekranı açar. "fetch" olayını dinlemez,
 * hiçbir dosyayı önbelleğe almaz: uygulama güncellemeleri bu çalışandan etkilenmez.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'LEONX OS', body: event.data ? event.data.text() : '' }
  }
  const link = typeof data.link === 'string' && data.link.startsWith('/') ? data.link : '/bildirimler'
  // iOS: her push görünür bildirim göstermek zorundadır
  event.waitUntil(
    self.registration.showNotification(String(data.title || 'LEONX OS').slice(0, 120), {
      body: String(data.body || '').slice(0, 240),
      tag: data.id ? `leonx-${data.id}` : undefined,
      renotify: false,
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-32.png',
      lang: 'tr',
      data: { link, id: data.id || null },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/bildirimler'
  const target = new URL(link, self.location.origin)
  if (target.origin !== self.location.origin) return
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const c of wins) {
        if (new URL(c.url).origin === target.origin) {
          await c.focus()
          // Açık uygulama sayfa yenilemeden ilgili ekrana gider
          c.postMessage({ type: 'leonx-open', link: target.pathname + target.search, id: event.notification.data && event.notification.data.id })
          return
        }
      }
      await self.clients.openWindow(target.href)
    })(),
  )
})

// Tarayıcı aboneliği yenilediğinde açık uygulamaya haber verilir (yeniden kaydeder)
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => wins.forEach((c) => c.postMessage({ type: 'leonx-resubscribe' }))),
  )
})
