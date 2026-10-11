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
    <nav aria-label="Ana menü" className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group}>
          {collapsed ? (
            <div className="mx-auto mb-2 h-px w-6 bg-line" aria-hidden="true" />
          ) : (
            <div className="mb-1.5 px-3 text-[10.5px] font-semibold tracking-[0.18em] text-subtle uppercase">
              {NAV_GROUPS[group]}
            </div>
          )}
          <ul className="flex flex-col gap-0.5">
            {NAV_ITEMS.filter((i) => i.group === group).map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex h-10 items-center gap-3 rounded-xl text-[13.5px] font-medium transition-colors duration-150',
                      collapsed ? 'justify-center px-0' : 'px-3',
                      isActive ? 'text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span
                          layoutId={layoutId}
                          className="absolute inset-0 rounded-xl border border-line bg-surface-2"
                          transition={{ type: 'spring', stiffness: 460, damping: 38 }}
                        >
                          <span className="brushed absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full" />
                        </motion.span>
                      )}
                      <item.icon
                        className={cn(
                          'relative h-[18px] w-[18px] shrink-0 transition-colors',
                          isActive ? 'text-ink' : 'text-titanium group-hover:text-ink',
                        )}
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      {!collapsed && <span className="relative truncate">{item.label}</span>}
                      {!collapsed && (
                        <span className="relative ml-auto flex items-center gap-2">
                          {item.status === 'planned' && (
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-warn/70"
                              title="Geliştirme aşamasında"
                              aria-label="Geliştirme aşamasında"
                            />
                          )}
                          <span className="font-mono text-[10px] text-subtle opacity-0 transition-opacity group-hover:opacity-100">
                            {item.code}
                          </span>
                        </span>
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
