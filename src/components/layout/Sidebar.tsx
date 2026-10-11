import { ExternalLink, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import { LeonxLogo } from '@/components/brand/LeonxLogo'
import { APP, COMPANY } from '@/config/company'
import { usePreferences } from '@/context/preferences'
import { cn } from '@/lib/cn'
import { SidebarNav } from './SidebarNav'

/** Masaüstü ve iPad (≥ lg) kenar çubuğu. */
export function Sidebar() {
  const { preferences, setPreference } = usePreferences()
  const collapsed = preferences.sidebarCollapsed

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-white/[0.06] bg-anthracite-900/80 backdrop-blur-xl transition-[width] duration-300 lg:flex',
        collapsed ? 'w-[76px]' : 'w-[264px]',
      )}
    >
      <div className={cn('flex h-[72px] items-center', collapsed ? 'justify-center' : 'px-5')}>
        <Link to="/" aria-label="LEONX OS ana sayfa">
          <LeonxLogo compact={collapsed} />
        </Link>
      </div>
      <div className="hairline mx-4 opacity-60" />

      <div className={cn('flex-1 overflow-y-auto py-6', collapsed ? 'px-3' : 'px-4')}>
        <SidebarNav collapsed={collapsed} layoutId="sidebar-active" />
      </div>

      <div className={cn('border-t border-white/[0.05] p-4', collapsed && 'px-3')}>
        {!collapsed && (
          <a
            href={COMPANY.website}
            target="_blank"
            rel="noreferrer"
            className="mb-3 flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5 text-xs text-titanium-300 transition hover:text-silver-100"
          >
            <span>
              <span className="block font-semibold tracking-[0.14em] text-silver-200">{COMPANY.name}</span>
              <span className="text-titanium-500">{COMPANY.websiteLabel}</span>
            </span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
        <button
          type="button"
          onClick={() => setPreference('sidebarCollapsed', !collapsed)}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-lg text-xs text-titanium-400 transition hover:bg-white/[0.04] hover:text-silver-100',
            collapsed ? 'justify-center' : 'px-2',
          )}
          aria-label={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed && (
            <>
              <span>Menüyü daralt</span>
              <span className="ml-auto font-mono text-[10px] text-titanium-600">v{APP.version}</span>
            </>
          )}
        </button>
      </div>
    </aside>
  )
}
