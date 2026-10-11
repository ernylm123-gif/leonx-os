import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import { NAV_GROUPS, NAV_ITEMS, type NavItem } from '@/config/navigation'
import { cn } from '@/lib/cn'

interface SidebarNavProps {
  collapsed?: boolean
  /** Bir bağlantıya tıklandığında (mobil çekmeceyi kapatmak için) */
  onNavigate?: () => void
  /** Aktif gösterge animasyonu için benzersiz kimlik */
  layoutId: string
}

const groups = Object.keys(NAV_GROUPS) as NavItem['group'][]

export function SidebarNav({ collapsed = false, onNavigate, layoutId }: SidebarNavProps) {
  return (
    <nav aria-label="Ana menü" className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group}>
          {collapsed ? (
            <div className="mx-auto mb-2 h-px w-6 bg-white/10" aria-hidden="true" />
          ) : (
            <div className="mb-2 px-3 text-[10px] font-semibold tracking-[0.22em] text-titanium-500 uppercase">
              {NAV_GROUPS[group]}
            </div>
          )}
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.filter((i) => i.group === group).map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex h-10 items-center gap-3 rounded-xl text-sm font-medium transition-colors',
                      collapsed ? 'justify-center px-0' : 'px-3',
                      isActive ? 'text-silver-50' : 'text-titanium-400 hover:bg-white/[0.04] hover:text-silver-100',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span
                          layoutId={layoutId}
                          className="absolute inset-0 rounded-xl border border-white/[0.08] bg-gradient-to-r from-white/[0.09] to-white/[0.02]"
                          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                        >
                          <span className="brushed-silver absolute top-2 bottom-2 left-0 w-[3px] rounded-full" />
                        </motion.span>
                      )}
                      <item.icon
                        className={cn('relative h-[18px] w-[18px] shrink-0', isActive && 'text-silver-50')}
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      {!collapsed && <span className="relative truncate">{item.label}</span>}
                      {!collapsed && item.status === 'planned' && (
                        <span
                          className="relative ml-auto h-1.5 w-1.5 rounded-full bg-signal-amber/70"
                          title="Geliştirme aşamasında"
                          aria-label="Geliştirme aşamasında"
                        />
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}
