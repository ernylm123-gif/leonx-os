import { NavLink } from 'react-router-dom'
import { LayoutGrid } from 'lucide-react'
import { NAV_ITEMS } from '@/config/navigation'
import { cn } from '@/lib/cn'

const PRIMARY = NAV_ITEMS.filter((i) => i.mobilePrimary)

/** Telefonlar için alt navigasyon (< md). */
export function MobileTabBar({ onOpenMenu, menuOpen }: { onOpenMenu: () => void; menuOpen: boolean }) {
  return (
    <nav
      aria-label="Hızlı erişim"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="grid grid-cols-5">
        {PRIMARY.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              end={item.path === '/'}
              aria-label={item.label}
              className={({ isActive }) =>
                cn(
                  'flex h-[60px] flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors',
                  isActive ? 'text-ink' : 'text-muted',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'relative grid h-7 w-12 place-items-center rounded-full transition-colors',
                      isActive && 'bg-surface-2 ring-1 ring-line',
                    )}
                  >
                    <item.icon className="h-[19px] w-[19px]" strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <span className="max-w-full truncate px-1">{item.shortLabel ?? item.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={onOpenMenu}
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            className={cn(
              'flex h-[60px] w-full flex-col items-center justify-center gap-1 text-[10.5px] font-medium',
              menuOpen ? 'text-ink' : 'text-muted',
            )}
          >
            <span className="grid h-7 w-12 place-items-center rounded-full">
              <LayoutGrid className="h-[19px] w-[19px]" strokeWidth={1.75} aria-hidden="true" />
            </span>
            Tümü
          </button>
        </li>
      </ul>
    </nav>
  )
}
