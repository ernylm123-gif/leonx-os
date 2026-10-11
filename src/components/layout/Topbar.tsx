import { ChevronRight, Menu, Search, ShieldCheck } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { LeonxMark } from '@/components/brand/LeonxLogo'
import { findNavItem } from '@/config/navigation'

interface TopbarProps {
  onOpenMenu: () => void
  onOpenSearch: () => void
}

const dateFormatter = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export function Topbar({ onOpenMenu, onOpenSearch }: TopbarProps) {
  const { pathname } = useLocation()
  const current = findNavItem(pathname)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.05] bg-anthracite-950/75 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:h-[72px] lg:px-8">
        <button
          type="button"
          onClick={onOpenMenu}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.07] text-titanium-300 hover:bg-white/[0.05] hover:text-silver-50 lg:hidden"
          aria-label="Menüyü aç"
        >
          <Menu className="h-5 w-5" />
        </button>
        <LeonxMark className="h-8 w-8 sm:hidden" />

        <nav aria-label="Konum" className="hidden min-w-0 items-center gap-2 text-sm sm:flex">
          <span className="font-semibold tracking-[0.18em] text-titanium-400">LEONX OS</span>
          <ChevronRight className="h-4 w-4 text-titanium-600" aria-hidden="true" />
          <span className="truncate font-medium text-silver-100">{current?.label ?? 'Sayfa bulunamadı'}</span>
        </nav>
        <span className="truncate text-sm font-medium text-silver-100 sm:hidden">{current?.label ?? 'LEONX OS'}</span>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 text-sm text-titanium-400 transition hover:bg-white/[0.06] hover:text-silver-100 md:w-64"
            aria-label="Modül ara"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="hidden md:inline">Modüllere git…</span>
            <kbd className="ml-auto hidden rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-titanium-500 md:inline">
              {isMac ? '⌘' : 'Ctrl'} K
            </kbd>
          </button>
          <div className="hidden text-right xl:block">
            <div className="text-xs text-titanium-500 first-letter:uppercase">{dateFormatter.format(new Date())}</div>
          </div>
          <div
            className="hidden h-10 items-center gap-2 rounded-xl border border-white/[0.07] px-3 text-xs text-titanium-300 sm:flex"
            title="Bu yazılım yalnızca LEONX Metal iç kullanımı içindir"
          >
            <ShieldCheck className="h-4 w-4 text-silver-300" aria-hidden="true" />
            <span className="hidden lg:inline">İç kullanım</span>
          </div>
        </div>
      </div>
    </header>
  )
}
