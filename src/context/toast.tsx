import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

type Tone = 'success' | 'error' | 'info'
interface Toast {
  id: number
  tone: Tone
  message: string
}

interface ToastContextValue {
  notify: (message: string, tone?: Tone) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)
const ICONS = { success: CheckCircle2, error: AlertTriangle, info: Info }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const notify = useCallback(
    (message: string, tone: Tone = 'success') => {
      const id = ++seq.current
      setToasts((t) => [...t.slice(-3), { id, tone, message }])
      window.setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 3500)
    },
    [dismiss],
  )

  const value = useMemo(() => ({ notify }), [notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[80] flex flex-col items-center gap-2 px-4 md:right-6 md:bottom-6 md:left-auto md:items-end"
        aria-live="polite"
        role="status"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const Icon = ICONS[t.tone]
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.98 }}
                transition={{ duration: 0.18 }}
                className={cn(
                  'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-surface px-4 py-3 text-sm text-ink shadow-raised',
                  t.tone === 'error' ? 'border-danger/30' : 'border-line',
                )}
              >
                <Icon
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    t.tone === 'success' && 'text-ok',
                    t.tone === 'error' && 'text-danger',
                    t.tone === 'info' && 'text-titanium',
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 leading-relaxed">{t.message}</span>
                <button type="button" onClick={() => dismiss(t.id)} className="-m-1 rounded p-1 text-subtle hover:text-ink" aria-label="Bildirimi kapat">
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast, ToastProvider içinde kullanılmalıdır')
  return ctx
}
