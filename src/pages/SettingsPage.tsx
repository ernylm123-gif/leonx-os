import { useState } from 'react'
import { Building, ExternalLink, LogOut, Monitor, Moon, Palette, PlugZap, RotateCcw, Settings, ShieldCheck, SlidersHorizontal, Sun } from 'lucide-react'
import { LeonxLockup } from '@/components/brand/LeonxLogo'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { StatusPill } from '@/components/ui/StatusPill'
import { Toggle } from '@/components/ui/Toggle'
import { COMPANY, INTEGRATIONS } from '@/config/company'
import { useAuth } from '@/context/auth'
import { useData } from '@/context/data'
import { usePreferences, type ThemePreference } from '@/context/preferences'
import { formatDateTime } from '@/lib/stats'
import { supabaseConfig } from '@/lib/supabase'
import { QuoteSettingsPanel } from '@/features/quotes/QuoteSettingsPanel'
import { VersionPanel } from '@/features/system/VersionPanel'

const THEME_OPTIONS = [
  { value: 'system' as const, label: 'Sistem', icon: Monitor },
  { value: 'light' as const, label: 'Açık', icon: Sun },
  { value: 'dark' as const, label: 'Koyu', icon: Moon },
]

export function SettingsPage() {
  const { preferences, resolvedTheme, setPreference, resetPreferences } = usePreferences()
  const { session, signOut } = useAuth()
  const { syncState, lastSyncedAt } = useData()
  const [confirmGlobal, setConfirmGlobal] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const user = session?.user
  const host = supabaseConfig.ok ? new URL(supabaseConfig.url).hostname : '—'

  const doSignOut = async (scope: 'local' | 'global') => {
    setSigningOut(true)
    await signOut(scope)
  }

  return (
    <>
      <PageHeader
        icon={Settings}
        code="M08"
        eyebrow="Sistem"
        title="Ayarlar"
        description="Hesap ve oturum, görünüm tercihleri, firma bilgisi ve entegrasyon durumu."
        status="ready"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Hesap ve oturum" subtitle="Tek yetkili kullanıcı · birden fazla cihazda aynı anda açık olabilir" icon={ShieldCheck} className="lg:col-span-2">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <dl className="grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-3 lg:flex-1">
              <div className="min-w-0">
                <dt className="text-xs text-muted">E-posta</dt>
                <dd className="mt-1 truncate font-medium text-ink">{user?.email ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Son giriş</dt>
                <dd className="mt-1 text-ink">{user?.last_sign_in_at ? formatDateTime(user.last_sign_in_at) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Senkronizasyon</dt>
                <dd className="mt-1 text-ink">
                  {syncState === 'live' ? 'Canlı' : syncState === 'offline' ? 'Çevrimdışı' : 'Bağlanıyor'}
                  {lastSyncedAt && <span className="ml-1.5 text-xs text-subtle">· {lastSyncedAt.toLocaleTimeString('tr-TR')}</span>}
                </dd>
              </div>
            </dl>
            <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
              <Button variant="secondary" icon={LogOut} onClick={() => void doSignOut('local')} disabled={signingOut}>
                Bu cihazda çıkış yap
              </Button>
              <Button variant="ghost" onClick={() => setConfirmGlobal(true)} disabled={signingOut} className="hover:!bg-danger-soft hover:!text-danger">
                Tüm cihazlarda çıkış yap
              </Button>
            </div>
          </div>
        </Panel>

        <Panel title="Görünüm" subtitle="Tema seçimi anında uygulanır" icon={Palette}>
          <SegmentedControl<ThemePreference>
            name="Tema"
            value={preferences.theme}
            options={THEME_OPTIONS}
            onChange={(v) => setPreference('theme', v)}
            layoutId="theme-segment"
          />
          <p className="mt-3 text-xs leading-relaxed text-muted" aria-live="polite">
            {preferences.theme === 'system'
              ? `Cihazınızın teması izleniyor — şu anda ${resolvedTheme === 'dark' ? 'koyu' : 'açık'}. iPad, iPhone, Android, Windows veya macOS'ta tema değiştiğinde LEONX OS da otomatik değişir.`
              : `${resolvedTheme === 'dark' ? 'Koyu' : 'Açık'} tema sabitlendi; cihaz teması değişse de korunur.`}
          </p>
        </Panel>

        <Panel
          title="Arayüz tercihleri"
          subtitle="Bu cihazın tarayıcısında saklanır"
          icon={SlidersHorizontal}
          actions={
            <Button variant="ghost" icon={RotateCcw} onClick={resetPreferences} className="h-8 px-2.5 text-xs">
              Sıfırla
            </Button>
          }
        >
          <div className="flex flex-col gap-5">
            <Toggle
              id="pref-sidebar"
              label="Kenar çubuğunu daralt"
              description="Masaüstü ve yatay iPad'de menüyü yalnızca simgelerle gösterir."
              checked={preferences.sidebarCollapsed}
              onChange={(v) => setPreference('sidebarCollapsed', v)}
            />
            <div className="h-px bg-line" />
            <Toggle
              id="pref-motion"
              label="Hareketleri azalt"
              description="Sayfa geçişi, menü ve tema animasyonlarını en aza indirir. Cihazın 'Hareketi Azalt' ayarı da otomatik uygulanır."
              checked={preferences.reduceMotion}
              onChange={(v) => setPreference('reduceMotion', v)}
            />
          </div>
        </Panel>

        <Panel title="Firma" subtitle="Yazılım yalnızca bu firmanın iç kullanımı içindir" icon={Building}>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <LeonxLockup className="w-full max-w-[180px] shrink-0" />
            <dl className="grid min-w-0 grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-sm">
              <dt className="text-muted">Firma</dt>
              <dd className="font-semibold tracking-[0.1em] text-ink">{COMPANY.name}</dd>
              <dt className="text-muted">Web</dt>
              <dd>
                <a
                  href={COMPANY.website}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink"
                >
                  {COMPANY.websiteLabel}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </dd>
              <dt className="text-muted">Faaliyet</dt>
              <dd className="text-ink-2">{COMPANY.disciplines.join(' · ')}</dd>
            </dl>
          </div>
        </Panel>

        <Panel title="Entegrasyonlar" subtitle="Harici servis bağlantıları" icon={PlugZap}>
          <ul className="flex flex-col divide-y divide-line">
            <li className="flex items-center justify-between gap-3 pb-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-ink-2">Veritabanı, oturum, dosya deposu (Supabase)</span>
                <span className="block truncate font-mono text-[11px] text-subtle">{host}</span>
              </span>
              <StatusPill tone="ready">Bağlı</StatusPill>
            </li>
            {INTEGRATIONS.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3 py-3 text-sm last:pb-0">
                <span className="min-w-0">
                  <span className="block truncate text-ink-2">{s.label}</span>
                  {!s.connected && <span className="text-[11px] text-subtle">Planlanan: {s.milestone}</span>}
                </span>
                {s.connected ? <StatusPill tone="ready">Hazır</StatusPill> : <StatusPill tone="offline">Bağlı değil</StatusPill>}
              </li>
            ))}
          </ul>
        </Panel>

        <QuoteSettingsPanel />
        <VersionPanel />
      </div>

      <ConfirmDialog
        open={confirmGlobal}
        title="Tüm cihazlarda çıkış yapılsın mı?"
        message="Bilgisayar, iPad ve telefonlarınızdaki tüm açık LEONX OS oturumları kapatılır. Her cihazda yeniden giriş yapmanız gerekir. Açık oturumların kapanması, erişim belirtecinin süresi dolana kadar (en fazla yaklaşık 1 saat) sürebilir."
        confirmLabel="Tümünden çıkış yap"
        busy={signingOut}
        onConfirm={() => void doSignOut('global')}
        onClose={() => setConfirmGlobal(false)}
      />
    </>
  )
}
