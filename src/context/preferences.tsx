import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { readStorage, writeStorage } from '@/lib/storage'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export interface Preferences {
  /** Sistem (cihaz teması), Açık veya Koyu */
  theme: ThemePreference
  /** Masaüstünde kenar çubuğunu simge görünümüne daraltır */
  sidebarCollapsed: boolean
  /** Sayfa geçişi ve animasyonları en aza indirir */
  reduceMotion: boolean
}

/** public/theme-init.js aynı anahtarı okur; değiştirilirse orası da güncellenmelidir. */
const STORAGE_KEY = 'leonx-os:preferences'
const DEFAULTS: Preferences = { theme: 'system', sidebarCollapsed: false, reduceMotion: false }
const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#F7F8FA', dark: '#15181C' }
const DARK_QUERY = '(prefers-color-scheme: dark)'

function sanitize(p: Preferences): Preferences {
  return {
    theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : 'system',
    sidebarCollapsed: p.sidebarCollapsed === true,
    reduceMotion: p.reduceMotion === true,
  }
}

function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light'
}

interface PreferencesContextValue {
  preferences: Preferences
  /** Şu anda ekranda uygulanan tema */
  resolvedTheme: ResolvedTheme
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void
  resetPreferences: () => void
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(() => sanitize(readStorage(STORAGE_KEY, DEFAULTS)))
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)

  // Cihaz temasındaki değişiklikleri (iPadOS, iOS, Android, Windows, macOS) anlık takip et
  useEffect(() => {
    const mq = window.matchMedia?.(DARK_QUERY)
    if (!mq) return
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light')
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolvedTheme: ResolvedTheme = preferences.theme === 'system' ? system : preferences.theme

  // Temayı belge köküne uygula
  useEffect(() => {
    const root = document.documentElement
    if (root.getAttribute('data-theme') !== resolvedTheme) {
      // Renk geçişini yalnızca tema değişiminde kısa süre etkinleştir
      root.setAttribute('data-theme-transition', '')
      window.setTimeout(() => root.removeAttribute('data-theme-transition'), 320)
    }
    root.setAttribute('data-theme', resolvedTheme)
    root.style.colorScheme = resolvedTheme
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.setAttribute('content', THEME_COLORS[resolvedTheme])
    })
  }, [resolvedTheme])

  useEffect(() => {
    document.documentElement.toggleAttribute('data-reduce-motion', preferences.reduceMotion)
  }, [preferences.reduceMotion])

  useEffect(() => {
    writeStorage(STORAGE_KEY, preferences)
  }, [preferences])

  const setPreference = useCallback(<K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPreferences((prev) => ({ ...prev, [key]: value }))
  }, [])

  const resetPreferences = useCallback(() => setPreferences(DEFAULTS), [])

  const value = useMemo(
    () => ({ preferences, resolvedTheme, setPreference, resetPreferences }),
    [preferences, resolvedTheme, setPreference, resetPreferences],
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext)
  if (!ctx) throw new Error('usePreferences, PreferencesProvider içinde kullanılmalıdır')
  return ctx
}
