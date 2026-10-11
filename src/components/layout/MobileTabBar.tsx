import { NavLink } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { NAV_ITEMS } from '@/config/navigation'
import { cn } from '@/lib/cn'

const PRIMARY = NAV_ITEMS.filter((i) => i.mobilePrimary)

/** Telefonlar için alt sekme çubuğu (< md). */
export function MobileTabBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  return (
    <nav
      aria-label="Hızlı erişim"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.07] bg-anthracite-900/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="grid grid-cols-5">
        {PRIMARY.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                cn(
                  'flex h-16 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors',
                  isActive ? 'text-silver-50' : 'text-titanium-500',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'grid h-7 w-12 place-items-center rounded-full transition-colors',
                      isActive && 'bg-white/[0.08]',
                    )}
                  >
                    <item.icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <span className="max-w-full truncate px-1">{item.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={onOpenMenu}
            className="flex h-16 w-full flex-col items-center justify-center gap-1 text-[10px] font-medium text-titanium-500"
          >
            <span className="grid h-7 w-12 place-items-center rounded-full">
              <Menu className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
            </span>
            Tümü
          </button>
        </li>
      </ul>
    </nav>
  )
}
