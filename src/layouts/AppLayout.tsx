import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useLocation, useOutlet } from 'react-router-dom'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { MobileDrawer } from '@/components/layout/MobileDrawer'
import { MobileTabBar } from '@/components/layout/MobileTabBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { Topbar } from '@/components/layout/Topbar'
import { findNavItem } from '@/config/navigation'

export function AppLayout() {
  const location = useLocation()
  const outlet = useOutlet()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const closeSearch = useCallback(() => setSearchOpen(false), [])

  // Ctrl/⌘ + K ile modül arama
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Sayfa değişiminde başa dön ve sekme başlığını güncelle
  useEffect(() => {
    window.scrollTo({ top: 0 })
    const item = findNavItem(location.pathname)
    document.title = item ? `${item.label} · LEONX OS` : 'LEONX OS'
  }, [location.pathname])

  return (
    <div className="flex min-h-dvh">
      <a
        href="#icerik"
        className="sr-only z-[70] rounded-lg bg-silver-100 px-4 py-2 text-anthracite-950 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        İçeriğe geç
      </a>
      <Sidebar />
      <MobileDrawer open={menuOpen} onClose={closeMenu} />
      <CommandPalette open={searchOpen} onClose={closeSearch} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMenu={() => setMenuOpen(true)} onOpenSearch={() => setSearchOpen(true)} />
        <main id="icerik" className="flex-1 px-4 pt-6 pb-28 sm:px-6 sm:pt-8 md:pb-12 lg:px-8">
          <div className="mx-auto w-full max-w-[1400px]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                {outlet}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
      <MobileTabBar onOpenMenu={() => setMenuOpen(true)} />
    </div>
  )
}
