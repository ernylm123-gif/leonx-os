import { Menu, Search, ShieldCheck } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { LeonxSymbol, LeonxWordmark } from '@/components/brand/LeonxLogo'
import { findNavItem } from '@/config/navigation'
import { SyncIndicator } from './SyncIndicator'
import { ThemeToggle } from './ThemeToggle'

interface TopbarProps {
  menuOpen: boolean
  onOpenMenu: () => void
  onOpenSearch: () => void
}

const dateFormatter = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)

export function Topbar({ menuOpen, onOpenMenu, onOpenSearch }: TopbarProps) {
  const { pathname } = useLocation()
  const current = findNavItem(pathname)

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:h-[68px] lg:px-8">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-surface text-muted transition hover:bg-surface-2 hover:text-ink lg:hidden"
          aria-label="Menüyü aç"
        >
          <Menu className="h-5 w-5" />
        </button>

        <Link to="/" aria-label="LEONX OS — Dashboard" className="shrink-0 rounded-xl lg:hidden">
          <span className="block sm:hidden">
            <LeonxSymbol size={40} />
          </span>
          <span className="hidden sm:block">
            <LeonxWordmark className="h-10" />
          </span>
        </Link>

        <nav aria-label="Konum" className="hidden min-w-0 items-center gap-2.5 text-sm md:flex">
          <span className="hidden text-[11px] font-semibold tracking-[0.22em] text-subtle lg:inline">LEONX OS</span>
          <span className="hidden h-4 w-px bg-line-strong lg:inline-block" aria-hidden="true" />
          {current && <span className="font-mono text-[11px] text-subtle">{current.code}</span>}
          <span className="truncate font-semibold text-ink">{current?.label ?? 'Sayfa bulunamadı'}</span>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm text-muted transition hover:bg-surface-2 hover:text-ink md:w-60 xl:w-72"
            aria-label="Modül ara"
            aria-haspopup="dialog"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="hidden md:inline">Modüllere git…</span>
            <kbd className="ml-auto hidden rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-subtle md:inline">
              {isApple ? '⌘' : 'Ctrl'} K
            </kbd>
          </button>
          <SyncIndicator />
          <ThemeToggle />
          <span className="hidden px-2 text-xs text-subtle first-letter:uppercase 2xl:inline">{dateFormatter.format(new Date())}</span>
          <div
            className="hidden h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-xs font-medium text-muted xl:flex"
            title="Bu yazılım yalnızca LEONX Metal iç kullanımı içindir"
          >
            <ShieldCheck className="h-4 w-4 text-titanium" aria-hidden="true" />
            İç kullanım
          </div>
        </div>
      </div>
    </header>
  )
}
