import { Building, ExternalLink, Info, PlugZap, RotateCcw, Settings, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { StatusPill } from '@/components/ui/StatusPill'
import { Toggle } from '@/components/ui/Toggle'
import { APP, COMPANY, INTEGRATIONS } from '@/config/company'
import { usePreferences } from '@/context/preferences'

export function SettingsPage() {
  const { preferences, setPreference, resetPreferences } = usePreferences()

  return (
    <>
      <PageHeader
        icon={Settings}
        eyebrow="Sistem"
        title="Ayarlar"
        description="Arayüz tercihleri, firma bilgisi ve entegrasyon durumu. Arayüz tercihleri bu cihazda saklanır."
        status="ready"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
            <div className="hairline opacity-40" />
            <Toggle
              id="pref-motion"
              label="Hareketleri azalt"
              description="Sayfa geçişi ve menü animasyonlarını kapatır."
              checked={preferences.reduceMotion}
              onChange={(v) => setPreference('reduceMotion', v)}
            />
          </div>
        </Panel>

        <Panel title="Firma" subtitle="Yazılım yalnızca bu firmanın iç kullanımı içindir" icon={Building}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
            <dt className="text-titanium-400">Firma</dt>
            <dd className="font-semibold tracking-[0.12em] text-silver-50">{COMPANY.name}</dd>
            <dt className="text-titanium-400">Web</dt>
            <dd>
              <a
                href={COMPANY.website}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-silver-200 underline decoration-white/20 underline-offset-4 hover:text-silver-50"
              >
                {COMPANY.websiteLabel}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </dd>
            <dt className="text-titanium-400">Faaliyet</dt>
            <dd className="text-silver-200">{COMPANY.disciplines.join(' · ')}</dd>
          </dl>
        </Panel>

        <Panel title="Entegrasyonlar" subtitle="Harici servis bağlantıları" icon={PlugZap}>
          <ul className="flex flex-col gap-3">
            {INTEGRATIONS.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate text-silver-200">{s.label}</span>
                  <span className="text-[11px] text-titanium-500">Planlanan: {s.phase}</span>
                </span>
                <StatusPill tone="offline">Bağlı değil</StatusPill>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Sürüm bilgisi" icon={Info}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
            <dt className="text-titanium-400">Uygulama</dt>
            <dd className="text-silver-100">{APP.name}</dd>
            <dt className="text-titanium-400">Sürüm</dt>
            <dd className="font-mono text-silver-100">v{APP.version}</dd>
            <dt className="text-titanium-400">Aşama</dt>
            <dd className="text-silver-100">{APP.stage}</dd>
          </dl>
        </Panel>
      </div>
    </>
  )
}
