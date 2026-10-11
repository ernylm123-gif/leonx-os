import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useLocation, useOutlet } from 'react-router-dom'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { MobileDrawer } from '@/components/layout/MobileDrawer'
import { MobileTabBar } from '@/components/layout/MobileTabBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { Topbar } from '@/components/layout/Topbar'
import { findNavItem } from '@/config/navigation'

/** Aynı anda yalnızca bir katman açık olabilir; menü ve arama çakışmaz. */
type Overlay = 'none' | 'menu' | 'search'

export function AppLayout() {
  const location = useLocation()
  const outlet = useOutlet()
  const [overlay, setOverlay] = useState<Overlay>('none')

  const close = useCallback(() => setOverlay('none'), [])
  const openMenu = useCallback(() => setOverlay('menu'), [])
  const openSearch = useCallback(() => setOverlay('search'), [])

  // Ctrl/⌘ + K ile modül arama (açık menüyü kapatarak)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOverlay((o) => (o === 'search' ? 'none' : 'search'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Ekran lg ve üzerine genişlerse (iPad'i yatay çevirme) mobil menüyü kapat
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = () => mq.matches && setOverlay((o) => (o === 'menu' ? 'none' : o))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Sayfa değişiminde katmanları kapat, başa dön ve sekme başlığını güncelle
  useEffect(() => {
    setOverlay('none')
    window.scrollTo({ top: 0 })
    const item = findNavItem(location.pathname)
    document.title = item ? `${item.label} · LEONX OS` : 'LEONX OS'
  }, [location.pathname])

  return (
    <div className="flex min-h-dvh">
      <a
        href="#icerik"
        className="sr-only z-[70] rounded-lg bg-primary px-4 py-2 text-primary-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        İçeriğe geç
      </a>
      <Sidebar />
      <MobileDrawer open={overlay === 'menu'} onClose={close} />
      <CommandPalette open={overlay === 'search'} onClose={close} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar menuOpen={overlay === 'menu'} onOpenMenu={openMenu} onOpenSearch={openSearch} />
        <main
          id="icerik"
          className="flex-1 px-4 pt-6 pb-[calc(96px+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 md:pb-14 lg:px-8 xl:px-10"
        >
          <div className="mx-auto w-full max-w-[1360px]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                {outlet}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
      <MobileTabBar onOpenMenu={openMenu} menuOpen={overlay === 'menu'} />
    </div>
  )
}
