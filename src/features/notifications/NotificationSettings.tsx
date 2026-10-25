import { BellRing, Info, Send, Smartphone, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { Toggle } from '@/components/ui/Toggle'
import { useNotifications } from '@/context/notifications'
import { useToast } from '@/context/toast'
import type { NotificationPrefsInput, PushSubscriptionRow } from '@/data/types'
import { listPushSubscriptions, notifyClientEvent, removePushSubscription } from '@/data/workflowApi'
import { dataErrorMessage } from '@/lib/errors'
import { currentSubscription, disablePush, enablePush, PushSetupError, pushSupport } from '@/lib/push'
import { formatDateTime } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'

const CATEGORY_TOGGLES: { key: keyof NotificationPrefsInput; label: string; description: string }[] = [
  { key: 'cat_proje', label: 'Proje bildirimleri', description: 'Yeni müşteri, yeni proje, aşama değişikliği, yeni dosya' },
  { key: 'cat_teklif', label: 'Teklif bildirimleri', description: 'Teklif oluşturuldu, gönderildi, kabul/red, geçerlilik süresi' },
  { key: 'cat_cad', label: 'Metraj / CAD bildirimleri', description: 'CAD analizi, metraj hazırlandı / revize / onaylandı' },
  { key: 'cat_gorev', label: 'Görev hatırlatmaları', description: 'Hatırlatma zamanı gelen, bugün biten ve geciken görevler' },
  { key: 'cat_termin', label: 'Termin bildirimleri', description: 'Yaklaşan ve geçen proje teslim tarihleri' },
  { key: 'cat_firsat', label: 'İş fırsatı bildirimleri (LEONX AI Radar)', description: 'Yeni doğrulanmış iş, potansiyel ihtiyaç ve öncelikli teklif fırsatları (puan, şehir ve kategori süzgeçleri radar ayarlarında)' },
  { key: 'cat_sistem', label: 'Sistem güncellemeleri', description: 'Yeni uygulama sürümü hazır' },
]

/** Ayarlar > Bildirimler: tercihler Supabase'de saklanır ve tüm cihazlarda aynıdır */
export function NotificationSettings() {
  const { prefsValue, savePrefs } = useNotifications()
  const { notify } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [devices, setDevices] = useState<PushSubscriptionRow[]>([])
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null)
  const support = pushSupport()

  const loadDevices = useCallback(async () => {
    try {
      setDevices(await listPushSubscriptions(requireSupabase()))
      setThisEndpoint((await currentSubscription())?.endpoint ?? null)
    } catch {
      /* cihaz listesi isteğe bağlı */
    }
  }, [])
  useEffect(() => void loadDevices(), [loadDevices])

  const set = async (key: keyof NotificationPrefsInput, value: boolean) => {
    setBusy(key)
    const saved = await savePrefs({ ...prefsValue, [key]: value })
    if (saved) notify('Bildirim tercihi kaydedildi.')
    setBusy(null)
  }

  const enable = async () => {
    setBusy('push-enable')
    try {
      await enablePush(requireSupabase())
      if (!prefsValue.push) await savePrefs({ ...prefsValue, push: true })
      notify('Bu cihaz için push bildirimleri açıldı.')
      await loadDevices()
    } catch (e) {
      notify(e instanceof PushSetupError ? e.message : dataErrorMessage(e, 'Push aboneliği'), 'error')
    } finally {
      setBusy(null)
    }
  }

  const disable = async () => {
    setBusy('push-disable')
    try {
      await disablePush(requireSupabase())
      notify('Bu cihazın push aboneliği kaldırıldı.')
      await loadDevices()
    } catch (e) {
      notify(dataErrorMessage(e, 'Push aboneliği'), 'error')
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    setBusy('push-test')
    try {
      await notifyClientEvent(requireSupabase(), 'push_test', 'LEONX OS test bildirimi', 'Bu bildirim geldiyse push çalışıyor.', '/bildirimler', String(Date.now()))
      notify('Test bildirimi oluşturuldu. Push açık cihazlara en geç 1–2 dakika içinde ulaşır.')
    } catch (e) {
      notify(dataErrorMessage(e, 'Test bildirimi'), 'error')
    } finally {
      setBusy(null)
    }
  }

  const active = devices.filter((d) => !d.disabled_at)
  const thisActive = !!thisEndpoint && active.some((d) => d.endpoint === thisEndpoint)

  return (
    <div className="flex flex-col gap-6" data-testid="notification-settings">
      <Panel title="Bildirim tercihleri" subtitle="Tüm cihazlarınızda aynıdır (Supabase'de saklanır)" icon={BellRing}>
        <div className="flex flex-col gap-5">
          <Toggle id="pref-in-app" checked={prefsValue.in_app} onChange={(v) => void set('in_app', v)} label="Uygulama içi bildirimler" description="Kapalıysa yeni bildirim oluşturulmaz (zaman çizelgesi yine kaydedilir)." />
          <div className="h-px bg-line" />
          {CATEGORY_TOGGLES.map((t) => (
            <Toggle key={t.key} id={`pref-${t.key}`} checked={prefsValue[t.key]} onChange={(v) => void set(t.key, v)} label={t.label} description={t.description} />
          ))}
          <div className="h-px bg-line" />
          <Toggle
            id="pref-own"
            checked={prefsValue.own_actions}
            onChange={(v) => void set('own_actions', v)}
            label="Kendi işlemlerimden bildirim al"
            description="Kapalıysa kendi yaptığınız kayıtlar (ör. başka cihazdan eklediğiniz proje) bildirim üretmez; hatırlatma ve terminler etkilenmez."
          />
          {busy && !busy.startsWith('push') && <p className="text-xs text-muted">Kaydediliyor…</p>}
        </div>
      </Panel>

      <Panel title="Push bildirimleri" subtitle="Uygulama kapalıyken de cihaza bildirim (izin gerekir)" icon={Smartphone}>
        <div className="flex flex-col gap-4">
          <Toggle
            id="pref-push"
            checked={prefsValue.push}
            onChange={(v) => void set('push', v)}
            label="Push gönderimi (tüm cihazlar)"
            description="Kapalıysa hiçbir cihaza push gönderilmez; bildirimler yalnız uygulama içinde görünür."
          />
          {!support.ok ? (
            <p className="flex gap-2 rounded-xl border border-warn-line bg-warn-soft px-3 py-2.5 text-[13px] text-ink" data-testid="push-unsupported">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
              {support.message}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
              <span className="text-[13px] text-ink">
                Bu cihaz: <strong>{thisActive ? 'Push açık' : 'Push kapalı'}</strong>
              </span>
              <div className="ml-auto flex flex-wrap gap-2">
                {thisActive ? (
                  <Button variant="ghost" onClick={() => void disable()} disabled={!!busy} className="h-9 text-xs">
                    Bu cihazda kapat
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => void enable()} disabled={!!busy} className="h-9 text-xs" data-testid="push-enable">
                    {busy === 'push-enable' ? 'Açılıyor…' : 'Bu cihazda aç'}
                  </Button>
                )}
              </div>
            </div>
          )}
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Kayıtlı cihazlar ({active.length})</h3>
            {active.length === 0 ? (
              <p className="text-sm text-subtle">Push açık cihaz yok.</p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {active.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                    <Smartphone className="h-4 w-4 shrink-0 text-titanium" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink">
                        {d.device_label ?? 'Cihaz'}
                        {d.endpoint === thisEndpoint && <span className="ml-1.5 text-xs font-normal text-ok">(bu cihaz)</span>}
                      </div>
                      <div className="text-[11px] text-subtle">
                        Son görülme {formatDateTime(d.last_seen_at)}
                        {d.last_success_at ? ` · son başarılı gönderim ${formatDateTime(d.last_success_at)}` : ' · henüz gönderim yok'}
                        {d.failure_count ? ` · ${d.failure_count} hata` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await removePushSubscription(requireSupabase(), d.endpoint)
                          await loadDevices()
                        } catch (e) {
                          notify(dataErrorMessage(e, 'Cihaz kaldırma'), 'error')
                        }
                      }}
                      className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger"
                      aria-label={`${d.device_label ?? 'Cihaz'} aboneliğini kaldır`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" icon={Send} onClick={() => void test()} disabled={!!busy || !prefsValue.push || !active.length} className="h-9 text-xs">
              Test bildirimi gönder
            </Button>
            <span className="text-[11px] text-muted">Gönderim sunucu zamanlayıcısıyla en geç 1–2 dakika içinde yapılır.</span>
          </div>
        </div>
      </Panel>
    </div>
  )
}
