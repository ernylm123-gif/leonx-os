/*
 * LEONX OS — ilk boyamadan önce tema belirleme.
 * React yüklenmeden çalışır; yanlış temanın bir an görünmesini (titreme) önler.
 * CSP "script-src 'self'" ile uyumlu olması için satır içi değil, ayrı dosyadır.
 */
;(function () {
  var pref = 'system'
  try {
    var raw = localStorage.getItem('leonx-os:preferences')
    var parsed = raw ? JSON.parse(raw) : null
    if (parsed && (parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system')) pref = parsed.theme
    if (parsed && parsed.reduceMotion === true) document.documentElement.setAttribute('data-reduce-motion', '')
  } catch (e) {
    /* depolama erişilemiyor — sistem teması kullanılır */
  }
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
  var root = document.documentElement
  root.setAttribute('data-theme', dark ? 'dark' : 'light')
  root.style.colorScheme = dark ? 'dark' : 'light'
})()
