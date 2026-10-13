import { CheckCircle2, Info, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { Panel } from '@/components/ui/Panel'
import { APP } from '@/config/company'
import { useData } from '@/context/data'
import { useUpdate } from '@/context/update'
import { CURRENT_BUILD, displayMode, envLabel, originStatus } from '@/lib/appVersion'
import { formatDateTime } from '@/lib/stats'
import { cn } from '@/lib/cn'

const SYNC_LABEL = { idle: 'Beklemede', connecting: 'Bağlanıyor', live: 'Canlı', reconnecting: 'Yeniden bağlanıyor', offline: 'Çevrimdışı' } as const
const MODE_LABEL = { 'ios-pwa': 'Ana ekran uygulaması (iOS/iPadOS)', pwa: 'Yüklü uygulama (PWA)', tarayici: 'Tarayıcı' } as const

/**
 * Sürüm bilgisi: tüm cihazlarda aynı sürümün çalıştığını doğrulamak için derleme kimliği,
 * commit, ortam ve sunucudaki güncel sürüm karşılaştırılır.
 */
export function VersionPanel() {
  const { current, latest, available, check, checking, lastCheckedAt, applyUpdate, stuck } = useUpdate()
  const { syncState, lastSyncedAt } = useData()
  const origin = originStatus(window.location.origin, APP.canonicalOrigin, CURRENT_BUILD.env)
  const rows: [string, string, boolean?][] = [
    ['Sürüm', `v${current.version}`],
    ['Derleme kimliği', current.buildId, true],
    ['Commit', current.commit, true],
    ['Dal (branch)', current.branch, true],
    ['Ortam', envLabel(current.env)],
    ['Derleme zamanı', formatDateTime(current.builtAt)],
    ['Adres', window.location.host, true],
    ['Uygulama türü', MODE_LABEL[displayMode()]],
    ['Yayındaki sürüm (sunucu)', latest ? latest.buildId : lastCheckedAt ? 'Okunamadı' : 'Denetleniyor…', true],
    ['Güncelleme durumu', available ? (stuck ? 'Yeni sürüm yüklenemedi — uygulamayı kapatıp açın' : 'Yeni sürüm hazır') : latest ? 'Güncel' : 'Denetlenmedi'],
    ['Anlık senkronizasyon', `${SYNC_LABEL[syncState]}${lastSyncedAt ? ` · son eşitleme ${formatDateTime(lastSyncedAt.toISOString())}` : ''}`],
  ]
  return (
    <Panel
      title="Sürüm bilgisi"
      subtitle="Tüm cihazlarda derleme kimliği aynı olmalıdır"
      icon={Info}
      className="lg:col-span-2"
      actions={
        <button
          type="button"
          onClick={() => void check()}
          disabled={checking}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-surface-2 disabled:opacity-60"
          data-testid="version-check"
        >
          {checking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          Güncellemeleri kontrol et
        </button>
      }
    >
      <div data-testid="version-panel">
        <div
          className={cn(
            'mb-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13px]',
            available ? 'border-warn-line bg-warn-soft text-warn' : origin === 'kanonik' || origin === 'yerel' ? 'border-ok/30 bg-ok-soft text-ok' : 'border-warn-line bg-warn-soft text-warn',
          )}
          data-testid="version-status"
        >
          {available || (origin !== 'kanonik' && origin !== 'yerel') ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          <div className="min-w-0">
            {available && latest ? (
              <>
                Sunucuda daha yeni sürüm var: <span className="font-mono">{latest.buildId}</span>.{' '}
                {stuck ? 'Uygulamayı tamamen kapatıp açın.' : (
                  <button type="button" onClick={() => applyUpdate()} className="font-semibold underline underline-offset-2">
                    Şimdi güncelle
                  </button>
                )}
              </>
            ) : origin === 'onizleme' ? (
              <>Bu bir önizleme sürümüdür. Günlük kullanım için yalnızca {APP.canonicalOrigin.replace('https://', '')} adresini kullanın.</>
            ) : origin === 'sabit-dagitim' ? (
              <>Bu adres sabit bir dağıtıma aittir ve güncellenmez. {APP.canonicalOrigin.replace('https://', '')} adresini kullanın.</>
            ) : lastCheckedAt ? (
              <>Güncel sürümü kullanıyorsunuz. Son denetim: {formatDateTime(lastCheckedAt.toISOString())}.</>
            ) : (
              <>Sürüm denetimi uygulama açıldıktan birkaç saniye sonra ve her 5 dakikada bir yapılır.</>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          {rows.map(([k, v, mono]) => (
            <div key={k} className="min-w-0 rounded-xl border border-line bg-surface-2/60 px-4 py-3">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className={cn('mt-1 truncate font-medium text-ink', mono && 'font-mono text-[12.5px]')} title={v} data-testid={`version-${k}`}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[12px] text-muted">
          Tüm iş verileri (firmalar, projeler, metrajlar, pozlar, dosya kayıtları) yalnızca Supabase'de tutulur ve oturum açık tüm cihazlara anlık yansır. Bu cihazda yalnızca
          tema ve görünüm tercihleri saklanır. Ana ekrana eklenen iPhone/iPad uygulaması Safari'den ayrı oturum kullanır; ilk açılışta bir kez giriş yapılır.
        </p>
      </div>
    </Panel>
  )
}
