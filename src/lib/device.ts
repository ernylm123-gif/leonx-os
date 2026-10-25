/** Cihaz listesinde görünen kısa ad (yalnız görüntüleme; kimlik doğrulamada kullanılmaz) */
export function deviceLabel(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent, standalone = isStandalone()): string {
  const os = /iPad/.test(ua) ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone'
      : /Android/.test(ua) ? 'Android'
        : /Windows/.test(ua) ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
            : /Linux/.test(ua) ? 'Linux' : 'Cihaz'
  const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Tarayıcı'
  return `${os} · ${standalone ? 'Uygulama (PWA)' : br}`
}

function isStandalone(): boolean {
  try {
    return (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) || (navigator as { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

/** Erişim belirtecindeki Supabase oturum kimliği (bu cihazı listede işaretlemek için) */
export function sessionIdFromToken(token: string | null | undefined): string | null {
  if (!token) return null
  try {
    const p = token.split('.')[1]
    const json = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(p.length / 4) * 4, '=')))
    return typeof json.session_id === 'string' ? json.session_id : null
  } catch {
    return null
  }
}
