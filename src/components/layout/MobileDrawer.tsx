import { useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { LeonxLockup } from '@/components/brand/LeonxLogo'
import { APP, COMPANY } from '@/config/company'
import { CURRENT_BUILD } from '@/lib/appVersion'
import { useOverlay } from '@/lib/useOverlay'
import { SidebarNav } from './SidebarNav'

interface MobileDrawerProps {
  open: boolean
  onClose: () => void
}

/** Telefon ve dikey iPad (< lg) için kayan menü çekmecesi. */
export function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  useOverlay(open, onClose)
  const closeRef = useRef<HTMLButtonElement>(null)

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menü">
          <motion.div
            data-testid="drawer-backdrop"
            className="absolute inset-0 bg-overlay backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.aside
            className="absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col border-r border-line bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] shadow-raised"
            initial={{ x: '-100%' }}
            animate={{ x: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } }}
            exit={{ x: '-100%', transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
            onAnimationComplete={() => closeRef.current?.focus({ preventScroll: true })}
          >
            <div className="flex items-start gap-3 px-4 pt-4 pb-3">
              <LeonxLockup className="flex-1" />
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line text-muted transition hover:bg-surface-2 hover:text-ink"
                aria-label="Menüyü kapat"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
              <SidebarNav onNavigate={onClose} layoutId="drawer-active" />
            </div>
            <div className="border-t border-line px-5 py-3.5 text-xs text-subtle">
              <span className="font-semibold tracking-[0.12em] text-ink-2">{COMPANY.name}</span> · LEONX OS v{APP.version} · <span className="font-mono">{CURRENT_BUILD.commit}</span>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  )
}
