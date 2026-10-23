/*
 * LEONX OS — açılış koruması (boot guard).
 *
 * Uygulama paketi (React) HİÇ yüklenemese bile çalışır: çerçevesiz, bağımsız, ES2017 betik.
 * CSP "script-src 'self'" ile uyumlu olması için satır içi değil, ayrı dosyadır ve index.html'de
 * modül paketinden ÖNCE yüklenir (bkz. public/theme-init.js ile aynı yöntem).
 *
 * Ne yapar:
 *  - main.tsx ilk çizimden sonra window.__LEONX_BOOT_GUARD__.booted() çağırır.
 *  - Bu sinyal ~12 sn içinde gelmezse VEYA aynı kökenden bir /assets/*.js dosyası yüklenemezse
 *    erişilebilir, açık/koyu temaya uyumlu bir kurtarma paneli gösterilir.
 *  - /assets dosyası yüklenemezse (ör. eski HTML silinmiş dosyaya işaret ediyor) panelden önce
 *    EN FAZLA BİR KEZ (10 dk içinde) önbellek atlayan adresle otomatik yeniden açma denenir.
 *    Deneme kaydı sessionStorage'dadır; sonsuz yenileme döngüsü olmaz.
 *  - Panel düğmeleri: "Yeniden dene", "Uygulamayı güncelle", "Bağlantıyı kontrol et".
 *  - localStorage / sessionStorage (kendi deneme kaydı dışında) / IndexedDB / çerezlere DOKUNMAZ:
 *    Supabase oturumu ve form taslakları korunur. Push bildirim çalışanı (/sw.js) kaldırılmaz.
 *
 * Test: src/lib/bootGuard.test.ts bu dosyanın KENDİSİNİ (kopya değil) Node "vm" ile yükler ve
 * saf işlevleri + denetleyiciyi sahte ortamla sınar; panelin gerçek tarayıcıdaki davranışı
 * e2e/app.e2e.mjs içindeki "Açılış koruması" testleriyle doğrulanır.
 */
;(function (root, factory) {
  var api = factory()
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api
    return
  }
  root.__LEONX_BOOT_GUARD__ = api.install(root)
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict'

  var DEFAULT_TIMEOUT_MS = 12000
  var ATTEMPT_KEY = 'leonx-boot-attempt'
  var WINDOW_MS = 10 * 60 * 1000
  var MAX_AUTO_RELOADS = 1
  /** src/lib/appVersion.ts → RELOAD_PARAM ile aynı: uygulama açılınca adresten silinir */
  var RELOAD_PARAM = '_surum'
  var PUSH_SW_PATH = '/sw.js'

  // ---------------------------------------------------------------- saf işlevler

  /** Aynı kökenden içerik karmalı JavaScript dosyası mı (/assets/*.js)? */
  function isOwnScriptAsset(url, origin) {
    if (!url || typeof url !== 'string') return false
    try {
      var u = new URL(url, origin)
      return u.origin === origin && u.pathname.indexOf('/assets/') === 0 && /\.m?js$/.test(u.pathname)
    } catch (e) {
      return false
    }
  }

  /** Önbellekten gelmesi imkânsız adres: aynı sayfa + sürüm parametresi */
  function cacheBustUrl(href, tag) {
    var u = new URL(href)
    var clean = String(tag || '').replace(/[^\w.+-]/g, '').slice(0, 64)
    u.searchParams.set(RELOAD_PARAM, clean || '1')
    return u.toString()
  }

  function readAttempt(store) {
    try {
      var raw = store && store.getItem(ATTEMPT_KEY)
      var a = raw ? JSON.parse(raw) : null
      return a && typeof a.count === 'number' && typeof a.at === 'number' ? a : null
    } catch (e) {
      return null
    }
  }

  /** Otomatik yeniden açma yapılabilir mi? (10 dk içinde en fazla 1 kez) */
  function canAutoReload(store, now) {
    if (!store) return false // depolama yoksa döngüden korunamayız: otomatik deneme yapılmaz
    var a = readAttempt(store)
    if (!a || now - a.at > WINDOW_MS) return true
    return a.count < MAX_AUTO_RELOADS
  }

  function recordAutoReload(store, now) {
    var a = readAttempt(store)
    var next = a && now - a.at <= WINDOW_MS ? { count: a.count + 1, at: now } : { count: 1, at: now }
    try {
      store.setItem(ATTEMPT_KEY, JSON.stringify(next))
      return true
    } catch (e) {
      return false
    }
  }

  function clearAttempts(store) {
    try {
      if (store) store.removeItem(ATTEMPT_KEY)
    } catch (e) {
      /* yok say */
    }
  }

  /** version.json gövdesinden derleme kimliği (geçersizse null) */
  function parseBuildId(body) {
    return body && typeof body === 'object' && typeof body.buildId === 'string' && body.buildId ? body.buildId : null
  }

  /** "Bağlantıyı kontrol et" sonucunu kullanıcıya gösterilecek satırlara çevirir */
  function describeCheck(r) {
    var lines = []
    lines.push('Cihaz bağlantısı: ' + (r.online === false ? 'Çevrimdışı — cihaz ağa bağlı görünmüyor' : 'Çevrimiçi'))
    if (r.ok) lines.push('Sunucu (version.json): ulaşıldı · HTTP ' + r.status + ' · ' + r.ms + ' ms')
    else if (r.status) lines.push('Sunucu (version.json): yanıt verdi ama hata · HTTP ' + r.status + ' · ' + r.ms + ' ms')
    else lines.push('Sunucu (version.json): ulaşılamadı' + (r.error ? ' (' + r.error + ')' : '') + ' · ' + r.ms + ' ms')
    if (r.serverBuild) {
      lines.push('Yüklü sürüm: ' + (r.loadedBuild || 'bilinmiyor'))
      lines.push('Sunucudaki sürüm: ' + r.serverBuild)
      if (r.loadedBuild && r.serverBuild !== r.loadedBuild) lines.push('Sunucuda daha yeni bir sürüm var — "Uygulamayı güncelle" ile açın.')
      else if (r.loadedBuild) lines.push('Sürümler aynı.')
    }
    return lines
  }

  // ---------------------------------------------------------------- denetleyici (ortamdan bağımsız)

  /**
   * env: { now(), setTimer(fn, ms), clearTimer(h), store, href(), origin, navigate(url), reload(),
   *        render(view | null), fetchVersion(): Promise<{status, ok, body, ms, error}>,
   *        clearCaches(): Promise, loadedBuild(), online(), timeoutMs }
   */
  function createController(env) {
    var booted = false
    var shown = null
    var timer = null
    var shownCount = 0
    var busy = false
    var lastCheck = null

    function view() {
      return { reason: shown, busy: busy, check: lastCheck }
    }
    function show(reason) {
      if (booted) return
      if (!shown) shownCount++
      // Dosya hatası, "uzun sürüyor" iletisinden daha belirleyicidir
      if (!shown || reason === 'dosya') shown = reason
      env.render(view())
    }

    var api = {
      start: function () {
        timer = env.setTimer(function () {
          timer = null
          if (!booted) show('zaman')
        }, env.timeoutMs || DEFAULT_TIMEOUT_MS)
      },
      /** Uygulama ilk çizimi tamamladı */
      booted: function () {
        if (booted) return
        booted = true
        if (timer !== null) env.clearTimer(timer)
        timer = null
        clearAttempts(env.store)
        if (shown) {
          shown = null
          env.render(null)
        }
      },
      assetError: function (url) {
        if (booted || !isOwnScriptAsset(url, env.origin)) return
        if (!shown && canAutoReload(env.store, env.now()) && recordAutoReload(env.store, env.now())) {
          busy = true
          env.navigate(cacheBustUrl(env.href(), 'yeniden-' + env.now().toString(36)))
          return
        }
        show('dosya')
      },
      retry: function () {
        busy = true
        env.render(view())
        env.reload()
      },
      update: function () {
        busy = true
        env.render(view())
        return env
          .fetchVersion()
          .then(
            function (r) {
              return parseBuildId(r && r.body)
            },
            function () {
              return null
            },
          )
          .then(function (id) {
            return env.clearCaches().then(
              function () {
                return id
              },
              function () {
                return id
              },
            )
          })
          .then(function (id) {
            env.navigate(cacheBustUrl(env.href(), id || 'g' + env.now().toString(36)))
          })
      },
      check: function () {
        busy = true
        env.render(view())
        return env
          .fetchVersion()
          .then(null, function (e) {
            return { ok: false, status: 0, ms: 0, error: String((e && e.name) || e) }
          })
          .then(function (r) {
            lastCheck = {
              online: env.online(),
              ok: !!r.ok,
              status: r.status || 0,
              ms: r.ms || 0,
              error: r.error || null,
              serverBuild: parseBuildId(r.body),
              loadedBuild: env.loadedBuild(),
              at: env.now(),
            }
            busy = false
            env.render(view())
            return lastCheck
          })
      },
      state: function () {
        return { booted: booted, shown: shown, shownCount: shownCount, pending: timer !== null }
      },
    }
    return api
  }

  // ---------------------------------------------------------------- tarayıcı bağlantısı ve panel

  var PALETTE = {
    light: { canvas: '#f7f8fa', surface: '#ffffff', line: '#e0e4e8', ink: '#20242a', muted: '#68717d', primary: '#252a31', primaryInk: '#ffffff', soft: '#f0f2f4' },
    dark: { canvas: '#15181c', surface: '#20242a', line: '#38404a', ink: '#f4f6f8', muted: '#adb5bf', primary: '#e8ebee', primaryInk: '#15181c', soft: '#292e35' },
  }

  function css(el, styles) {
    for (var k in styles) if (Object.prototype.hasOwnProperty.call(styles, k)) el.style[k] = styles[k]
    return el
  }

  function createPanel(win, actions) {
    var doc = win.document
    var el = null
    var resultBox = null
    var heading = null
    var text = null
    var buttons = []

    function build() {
      var dark = doc.documentElement.getAttribute('data-theme') === 'dark'
      var c = dark ? PALETTE.dark : PALETTE.light
      el = css(doc.createElement('div'), {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        background: c.canvas,
        color: c.ink,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))',
        overflowY: 'auto',
        font: '15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
      })
      el.id = 'leonx-boot-fallback'
      el.setAttribute('role', 'alertdialog')
      el.setAttribute('aria-modal', 'true')
      el.setAttribute('aria-labelledby', 'leonx-boot-title')
      el.setAttribute('aria-describedby', 'leonx-boot-text')
      el.setAttribute('lang', 'tr')
      var card = css(doc.createElement('div'), { width: '100%', maxWidth: '440px', background: c.surface, border: '1px solid ' + c.line, borderRadius: '18px', padding: '22px', boxSizing: 'border-box' })
      heading = css(doc.createElement('h1'), { margin: '0 0 6px', fontSize: '19px', fontWeight: '600', outline: 'none' })
      heading.id = 'leonx-boot-title'
      heading.tabIndex = -1
      text = css(doc.createElement('p'), { margin: '0 0 10px', color: c.muted, fontSize: '14px' })
      text.id = 'leonx-boot-text'
      var safe = css(doc.createElement('p'), { margin: '0 0 16px', color: c.muted, fontSize: '12.5px' })
      safe.textContent = 'Oturumunuz ve kaydedilmemiş taslaklarınız bu cihazda korunur; verileriniz sunucuda güvende.'
      var row = css(doc.createElement('div'), { display: 'flex', flexDirection: 'column', gap: '8px' })
      var defs = [
        ['retry', 'Yeniden dene', true],
        ['update', 'Uygulamayı güncelle', false],
        ['check', 'Bağlantıyı kontrol et', false],
      ]
      for (var i = 0; i < defs.length; i++) {
        var b = css(doc.createElement('button'), {
          minHeight: '44px',
          borderRadius: '12px',
          border: '1px solid ' + (defs[i][2] ? c.primary : c.line),
          background: defs[i][2] ? c.primary : c.soft,
          color: defs[i][2] ? c.primaryInk : c.ink,
          font: 'inherit',
          fontWeight: '600',
          fontSize: '15px',
          cursor: 'pointer',
          padding: '0 14px',
        })
        b.type = 'button'
        b.textContent = defs[i][1]
        b.setAttribute('data-action', defs[i][0])
        b.addEventListener('click', actions[defs[i][0]])
        buttons.push(b)
        row.appendChild(b)
      }
      resultBox = css(doc.createElement('div'), { marginTop: '14px', fontSize: '13px', color: c.ink, whiteSpace: 'pre-line', wordBreak: 'break-word' })
      resultBox.id = 'leonx-boot-result'
      resultBox.setAttribute('role', 'status')
      resultBox.setAttribute('aria-live', 'polite')
      var tip = css(doc.createElement('p'), { margin: '14px 0 0', color: c.muted, fontSize: '12px' })
      tip.textContent =
        'Sorun sürerse: tarih ve saatin "Otomatik" olduğunu, VPN / içerik filtresi (ör. operatör "Güvenli İnternet") kullanılmadığını kontrol edin; Wi-Fi ile mobil veriyi karşılaştırın.'
      card.appendChild(heading)
      card.appendChild(text)
      card.appendChild(safe)
      card.appendChild(row)
      card.appendChild(resultBox)
      card.appendChild(tip)
      el.appendChild(card)
      ;(doc.body || doc.documentElement).appendChild(el)
    }

    return function render(v) {
      if (!v) {
        if (el && el.parentNode) el.parentNode.removeChild(el)
        el = null
        buttons = []
        return
      }
      var first = !el
      if (first) build()
      el.setAttribute('data-reason', v.reason || '')
      heading.textContent = v.reason === 'dosya' ? 'LEONX OS açılamadı' : 'LEONX OS beklenenden uzun sürede açılıyor'
      text.textContent =
        v.reason === 'dosya'
          ? 'Uygulama dosyaları yüklenemedi. Bağlantı kesilmiş veya tarayıcı eski bir sürümü tutuyor olabilir.'
          : 'Uygulama henüz başlatılamadı. Bağlantı yavaş olabilir; birkaç saniye bekleyebilir veya aşağıdakileri deneyebilirsiniz.'
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].disabled = !!v.busy
        buttons[i].style.opacity = v.busy ? '0.6' : '1'
      }
      if (v.busy && !v.check) resultBox.textContent = 'Lütfen bekleyin…'
      else if (v.check) resultBox.textContent = describeCheck(v.check).join('\n')
      if (first) {
        try {
          heading.focus()
        } catch (e) {
          /* yok say */
        }
      }
    }
  }

  function safeSession(win) {
    try {
      var s = win.sessionStorage
      s.getItem(ATTEMPT_KEY)
      return s
    } catch (e) {
      return null
    }
  }

  function fetchVersion(win) {
    var t0 = Date.now()
    var ctrl = typeof win.AbortController === 'function' ? new win.AbortController() : null
    var t = ctrl
      ? win.setTimeout(function () {
          ctrl.abort()
        }, 8000)
      : null
    return win
      .fetch('/version.json?t=' + t0, { cache: 'no-store', headers: { accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        var ms = Date.now() - t0
        var type = (res.headers && res.headers.get('content-type')) || ''
        if (!res.ok || type.indexOf('json') === -1) return { ok: res.ok && type.indexOf('json') !== -1, status: res.status, ms: ms, body: null }
        return res.json().then(
          function (body) {
            return { ok: true, status: res.status, ms: ms, body: body }
          },
          function () {
            return { ok: false, status: res.status, ms: ms, body: null, error: 'geçersiz yanıt' }
          },
        )
      })
      .then(
        function (r) {
          if (t) win.clearTimeout(t)
          return r
        },
        function (e) {
          if (t) win.clearTimeout(t)
          var name = (e && e.name) || 'hata'
          return { ok: false, status: 0, ms: Date.now() - t0, body: null, error: name === 'AbortError' ? 'zaman aşımı' : name }
        },
      )
  }

  /** Yalnız Cache Storage (uygulama kullanmaz) ve push dışı eski service worker'lar temizlenir */
  function clearCaches(win) {
    var jobs = []
    try {
      if (win.caches && win.caches.keys) {
        jobs.push(
          win.caches.keys().then(function (keys) {
            return Promise.all(
              keys.map(function (k) {
                return win.caches.delete(k)
              }),
            )
          }),
        )
      }
    } catch (e) {
      /* yok say */
    }
    try {
      var sw = win.navigator && win.navigator.serviceWorker
      if (sw && sw.getRegistrations) {
        jobs.push(
          sw.getRegistrations().then(function (regs) {
            return Promise.all(
              regs.map(function (r) {
                var w = r.active || r.waiting || r.installing
                var path = ''
                try {
                  path = w ? new URL(w.scriptURL).pathname : ''
                } catch (e) {
                  path = ''
                }
                return path === PUSH_SW_PATH ? false : r.unregister()
              }),
            )
          }),
        )
      }
    } catch (e) {
      /* yok say */
    }
    return Promise.all(jobs).then(
      function () {},
      function () {},
    )
  }

  function install(win) {
    var ctl = null
    var render = createPanel(win, {
      retry: function () {
        ctl.retry()
      },
      update: function () {
        void ctl.update()
      },
      check: function () {
        void ctl.check()
      },
    })
    ctl = createController({
      now: function () {
        return Date.now()
      },
      setTimer: function (fn, ms) {
        return win.setTimeout(fn, ms)
      },
      clearTimer: function (h) {
        win.clearTimeout(h)
      },
      store: safeSession(win),
      href: function () {
        return win.location.href
      },
      origin: win.location.origin,
      navigate: function (url) {
        win.location.replace(url)
      },
      reload: function () {
        win.location.reload()
      },
      render: function (v) {
        // Panel body hazır olduğunda eklenir
        if (v && !win.document.body) {
          win.document.addEventListener('DOMContentLoaded', function () {
            render(v)
          })
          return
        }
        render(v)
      },
      fetchVersion: function () {
        return fetchVersion(win)
      },
      clearCaches: function () {
        return clearCaches(win)
      },
      loadedBuild: function () {
        var m = win.document.querySelector('meta[name="leonx-build"]')
        return (m && m.getAttribute('content')) || null
      },
      online: function () {
        return win.navigator ? win.navigator.onLine : null
      },
      // Yalnız testler için: e2e öncesi init betiğiyle kısaltılabilir (üretimde tanımsız)
      timeoutMs: typeof win.__LEONX_BOOT_TIMEOUT_MS__ === 'number' ? win.__LEONX_BOOT_TIMEOUT_MS__ : DEFAULT_TIMEOUT_MS,
    })
    // Kaynak yükleme hataları kabarcıklanmaz: yakalama aşamasında dinlenir
    win.addEventListener(
      'error',
      function (e) {
        var t = e && e.target
        if (!t || (t.tagName !== 'SCRIPT' && t.tagName !== 'LINK')) return
        ctl.assetError(t.src || t.href || '')
      },
      true,
    )
    ctl.start()
    if (win.__LEONX_BOOTED__ === true) ctl.booted()
    return ctl
  }

  return {
    DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
    ATTEMPT_KEY: ATTEMPT_KEY,
    RELOAD_PARAM: RELOAD_PARAM,
    isOwnScriptAsset: isOwnScriptAsset,
    cacheBustUrl: cacheBustUrl,
    canAutoReload: canAutoReload,
    recordAutoReload: recordAutoReload,
    parseBuildId: parseBuildId,
    describeCheck: describeCheck,
    createController: createController,
    install: install,
  }
})
