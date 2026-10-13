import { ExternalLink, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import { LeonxLockup, LeonxSymbol } from '@/components/brand/LeonxLogo'
import { APP, COMPANY } from '@/config/company'
import { useAuth } from '@/context/auth'
import { CURRENT_BUILD } from '@/lib/appVersion'
import { usePreferences } from '@/context/preferences'
import { cn } from '@/lib/cn'
import { SidebarNav } from './SidebarNav'

/** Masaüstü ve yatay iPad (≥ lg) kenar çubuğu. */
export function Sidebar() {
  const { preferences, setPreference } = usePreferences()
  const collapsed = preferences.sidebarCollapsed
  const { session, signOut } = useAuth()

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] transition-[width] duration-300 ease-out lg:flex',
        collapsed ? 'w-[80px]' : 'w-[272px]',
      )}
    >
      <div className={cn('pt-5 pb-4', collapsed ? 'flex justify-center px-3' : 'px-5')}>
        <Link to="/" aria-label="LEONX OS — Dashboard" className="block rounded-xl">
          {collapsed ? <LeonxSymbol size={48} /> : <LeonxLockup />}
        </Link>
        {!collapsed && (
          <div className="mt-3 flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold tracking-[0.24em] text-ink-2">LEONX OS</span>
            <Link to="/ayarlar" className="font-mono text-[10px] text-subtle hover:text-ink" title={`Derleme ${CURRENT_BUILD.buildId}`} data-testid="sidebar-version">
              v{APP.version} · {CURRENT_BUILD.commit}
            </Link>
          </div>
        )}
      </div>

      <div className={cn('flex-1 overflow-y-auto overscroll-contain py-3', collapsed ? 'px-3' : 'px-4')}>
        <SidebarNav collapsed={collapsed} layoutId="sidebar-active" />
      </div>

      <div className={cn('border-t border-line p-3', !collapsed && 'px-4')}>
        {!collapsed && (
          <a
            href={COMPANY.website}
            target="_blank"
            rel="noreferrer"
            className="mb-2 flex items-center justify-between rounded-xl px-2 py-2 text-xs text-muted transition hover:bg-surface-2 hover:text-ink"
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold tracking-[0.12em] text-ink-2">{COMPANY.name}</span>
              <span className="text-subtle">{COMPANY.websiteLabel}</span>
            </span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </a>
        )}
        <button
          type="button"
          onClick={() => void signOut()}
          className={cn(
            'mb-1 flex h-9 w-full items-center gap-2 rounded-lg text-xs text-muted transition hover:bg-surface-2 hover:text-ink',
            collapsed ? 'justify-center' : 'px-2',
          )}
          title={session?.user.email ? `${session.user.email} — çıkış yap` : 'Çıkış yap'}
          aria-label="Çıkış yap"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="min-w-0 truncate">Çıkış · {session?.user.email}</span>}
        </button>
        <button
          type="button"
          onClick={() => setPreference('sidebarCollapsed', !collapsed)}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-lg text-xs text-muted transition hover:bg-surface-2 hover:text-ink',
            collapsed ? 'justify-center' : 'px-2',
          )}
          aria-label={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed && <span>Menüyü daralt</span>}
        </button>
      </div>
    </aside>
  )
}
