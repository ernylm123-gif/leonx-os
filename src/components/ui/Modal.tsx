import { type ReactNode, useEffect, useId, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useOverlay } from '@/lib/useOverlay'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg'
  /** Kaydetme sürerken kapatmayı engeller */
  busy?: boolean
}

/** Telefonda alttan açılan sayfa, geniş ekranda ortalanmış diyalog. */
export function Modal({ open, onClose, title, description, children, footer, size = 'md', busy = false }: ModalProps) {
  const close = () => {
    if (!busy) onClose()
  }
  useOverlay(open, close)
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>('input:not([disabled]), select, textarea')
      // Dokunmatik cihazlarda klavyenin kendiliğinden açılmaması için yalnızca fareli cihazlarda odakla
      if (first && window.matchMedia('(hover: hover)').matches) first.focus({ preventScroll: true })
      else panelRef.current?.focus({ preventScroll: true })
    }, 60)
    return () => window.clearTimeout(t)
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[65] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <motion.div
            className="absolute inset-0 bg-overlay backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={close}
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            className={cn(
              'relative flex max-h-[min(92dvh,880px)] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-raised outline-none sm:rounded-2xl',
              size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg',
            )}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] } }}
            exit={{ opacity: 0, y: 16, transition: { duration: 0.16 } }}
          >
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 id={titleId} className="text-base font-semibold text-ink">
                  {title}
                </h2>
                {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
              </div>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="-m-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-40"
                aria-label="Kapat"
              >
                <X className="h-[18px] w-[18px]" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
            {footer && (
              <footer className="flex flex-col-reverse gap-2 border-t border-line bg-surface-2/60 px-5 py-3.5 pb-[calc(14px+env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:pb-3.5">
                {footer}
              </footer>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
