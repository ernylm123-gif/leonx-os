import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { LeonxLogo } from '@/components/brand/LeonxLogo'
import { APP, COMPANY } from '@/config/company'
import { SidebarNav } from './SidebarNav'

interface MobileDrawerProps {
  open: boolean
  onClose: () => void
}

/** Telefon ve dikey iPad (< lg) için kayan menü çekmecesi. */
export function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menü">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col border-r border-white/[0.08] bg-anthracite-900 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
          >
            <div className="flex h-16 items-center justify-between px-5">
              <LeonxLogo />
              <button
                type="button"
                onClick={onClose}
                className="grid h-10 w-10 place-items-center rounded-xl text-titanium-300 hover:bg-white/[0.06] hover:text-silver-50"
                aria-label="Menüyü kapat"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="hairline mx-4 opacity-60" />
            <div className="flex-1 overflow-y-auto px-4 py-6">
              <SidebarNav onNavigate={onClose} layoutId="drawer-active" />
            </div>
            <div className="border-t border-white/[0.05] px-5 py-4 text-xs text-titanium-500">
              <span className="font-semibold tracking-[0.14em] text-titanium-300">{COMPANY.name}</span> · v{APP.version}
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  )
}
