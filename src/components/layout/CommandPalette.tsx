import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CornerDownLeft, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { NAV_ITEMS } from '@/config/navigation'
import { cn } from '@/lib/cn'
import { useOverlay } from '@/lib/useOverlay'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

function normalize(s: string) {
  return s.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i')
}

/** Modüller arasında klavye ile hızlı geçiş (Ctrl/⌘ + K). */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  useOverlay(open, onClose)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return NAV_ITEMS
    return NAV_ITEMS.filter((i) => normalize(`${i.label} ${i.description} ${i.code}`).includes(q))
  }, [query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => setActive(0), [query])

  const go = (path: string) => {
    onClose()
    navigate(path)
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (results.length ? (a + 1) % results.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0))
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault()
      go(results[active].path)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[max(12vh,calc(env(safe-area-inset-top)+16px))]"
          role="dialog"
          aria-modal="true"
          aria-label="Modül arama"
        >
          <motion.div
            data-testid="search-backdrop"
            className="absolute inset-0 bg-overlay backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-raised"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="h-4 w-4 shrink-0 text-titanium" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Modül adı veya kodu yazın…"
                className="h-14 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-subtle focus:outline-none"
                aria-label="Modül ara"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-results"
                aria-activedescendant={results[active] ? `cmd-${results[active].code}` : undefined}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
              />
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-subtle"
                aria-label="Aramayı kapat"
              >
                Esc
              </button>
            </div>
            <ul id="command-results" role="listbox" className="max-h-[min(50vh,420px)] overflow-y-auto overscroll-contain p-2">
              {results.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">Eşleşen modül yok</li>}
              {results.map((item, idx) => (
                <li
                  key={item.path}
                  id={`cmd-${item.code}`}
                  role="option"
                  aria-selected={idx === active}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => go(item.path)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors',
                    idx === active ? 'bg-surface-2' : 'hover:bg-surface-2',
                  )}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface">
                    <item.icon className="h-4 w-4 text-titanium" strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-ink">
                      {item.label}
                      <span className="font-mono text-[10px] text-subtle">{item.code}</span>
                    </div>
                    <div className="truncate text-xs text-muted">{item.description}</div>
                  </div>
                  {idx === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" />}
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
