import { AnimatePresence, motion } from 'framer-motion'
import { Monitor, Moon, Sun } from 'lucide-react'
import { usePreferences, type ThemePreference } from '@/context/preferences'

const NEXT: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' }
const LABEL: Record<ThemePreference, string> = { system: 'Sistem', light: 'Açık', dark: 'Koyu' }
const ICON = { system: Monitor, light: Sun, dark: Moon }

/** Üst çubuktaki hızlı tema düğmesi: Sistem → Açık → Koyu döngüsü. */
export function ThemeToggle() {
  const { preferences, setPreference } = usePreferences()
  const current = preferences.theme
  const Icon = ICON[current]
  return (
    <button
      type="button"
      onClick={() => setPreference('theme', NEXT[current])}
      className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-surface text-muted transition hover:bg-surface-2 hover:text-ink"
      aria-label={`Tema: ${LABEL[current]}. Değiştirmek için dokunun.`}
      title={`Tema: ${LABEL[current]}`}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={current}
          initial={{ y: 14, opacity: 0, rotate: -30 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: -14, opacity: 0, rotate: 30 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="grid place-items-center"
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
        </motion.span>
      </AnimatePresence>
    </button>
  )
}
