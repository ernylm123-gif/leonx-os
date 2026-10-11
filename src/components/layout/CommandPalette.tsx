import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CornerDownLeft, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { NAV_ITEMS } from '@/config/navigation'
import { cn } from '@/lib/cn'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

function normalize(s: string) {
  return s.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i')
}

/** Modüller arasında klavye ile hızlı geçiş (Ctrl/⌘ + K). */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return NAV_ITEMS
    return NAV_ITEMS.filter((i) => normalize(`${i.label} ${i.description}`).includes(q))
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
    navigate(path)
    onClose()
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
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[max(12vh,env(safe-area-inset-top))]" role="dialog" aria-modal="true" aria-label="Modül arama">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="panel relative w-full max-w-lg overflow-hidden !bg-anthracite-850"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-3 border-b border-white/[0.06] px-4">
              <Search className="h-4 w-4 text-titanium-400" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Modül adı yazın…"
                className="h-14 min-w-0 flex-1 bg-transparent text-base text-silver-50 placeholder:text-titanium-500 focus:outline-none"
                aria-label="Modül ara"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-results"
                aria-activedescendant={results[active] ? `cmd-${results[active].path}` : undefined}
              />
              <kbd className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-titanium-500">Esc</kbd>
            </div>
            <ul id="command-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
              {results.length === 0 && <li className="px-3 py-8 text-center text-sm text-titanium-500">Eşleşen modül yok</li>}
              {results.map((item, idx) => (
                <li
                  key={item.path}
                  id={`cmd-${item.path}`}
                  role="option"
                  aria-selected={idx === active}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => go(item.path)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5',
                    idx === active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]',
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0 text-silver-300" strokeWidth={1.75} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-silver-50">{item.label}</div>
                    <div className="truncate text-xs text-titanium-500">{item.description}</div>
                  </div>
                  {idx === active && <CornerDownLeft className="h-3.5 w-3.5 text-titanium-500" aria-hidden="true" />}
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
