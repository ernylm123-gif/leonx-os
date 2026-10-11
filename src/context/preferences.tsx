import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { readStorage, writeStorage } from '@/lib/storage'

export interface Preferences {
  /** Masaüstünde kenar çubuğunu simge görünümüne daraltır */
  sidebarCollapsed: boolean
  /** Sayfa geçişi ve animasyonları en aza indirir */
  reduceMotion: boolean
}

const STORAGE_KEY = 'leonx-os:preferences'
const DEFAULTS: Preferences = { sidebarCollapsed: false, reduceMotion: false }

interface PreferencesContextValue {
  preferences: Preferences
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void
  resetPreferences: () => void
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(() => readStorage(STORAGE_KEY, DEFAULTS))

  useEffect(() => {
    writeStorage(STORAGE_KEY, preferences)
  }, [preferences])

  const setPreference = useCallback(<K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPreferences((prev) => ({ ...prev, [key]: value }))
  }, [])

  const resetPreferences = useCallback(() => setPreferences(DEFAULTS), [])

  const value = useMemo(
    () => ({ preferences, setPreference, resetPreferences }),
    [preferences, setPreference, resetPreferences],
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext)
  if (!ctx) throw new Error('usePreferences, PreferencesProvider içinde kullanılmalıdır')
  return ctx
}
