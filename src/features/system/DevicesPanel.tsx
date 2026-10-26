import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { StatusPill } from '@/components/ui/StatusPill'
import { useAuth } from '@/context/auth'
import { sessionIdFromToken } from '@/lib/device'
import { dataErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'

interface OwnerDevice {
  id: string
  session_id: string
  label: string
  method: 'kod' | 'sifre'
  created_at: string
  last_seen_at: string
  revoked_at: string | null
}

const CODE_MINUTES = 10

/** Kayıt kodu: 8 haneli, kriptografik rastgele; yalnız bir kez gösterilir, sunucuda özeti saklanır */
export function randomEnrollmentCode(): string {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return String(a[0] % 100_000_000).padStart(8, '0')
}

/**
 * Yetkili cihazlar: her başarılı giriş bir satır açar. "İptal et" o cihazın oturumunu
 * sunucuda siler; cihaz uygulamayı açtığında (veya en geç belirteç süresi dolunca) çıkış yapar.
 */
export function DevicesPanel() {
  const { session } = useAuth()
  const current = sessionIdFromToken(session?.access_token)
  const [devices, setDevices] = useState<OwnerDevice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [code, setCode] = useState<{ value: string; until: Date } | null>(null)

  const load = useCallback(async () => {
    try {
      const { data, error: e } = await requireSupabase()
        .from('owner_devices')
        .select('id,session_id,label,method,created_at,last_seen_at,revoked_at')
        .order('last_seen_at', { ascending: false })
      if (e) throw e
      setDevices((data ?? []) as OwnerDevice[])
      setError(null)
    } catch (e) {
      setDevices([])
      setError(dataErrorMessage(e, 'Cihaz listesi'))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const revoke = async (id: string) => {
    setBusy(id)
    try {
      const { error: e } = await requireSupabase().rpc('owner_device_revoke', { p_device: id })
      if (e) throw e
      await load()
    } catch (e) {
      setError(dataErrorMessage(e, 'Cihaz iptali'))
    } finally {
      setBusy(null)
    }
  }

  const openCode = async () => {
    setBusy('code')
    try {
      const value = randomEnrollmentCode()
      const { error: e } = await requireSupabase().rpc('owner_enrollment_open', { p_code: value, p_minutes: CODE_MINUTES })
      if (e) throw e
      setCode({ value, until: new Date(Date.now() + CODE_MINUTES * 60_000) })
    } catch (e) {
      setError(dataErrorMessage(e, 'Kayıt kodu'))
    } finally {
      setBusy(null)
    }
  }

  const active = (devices ?? []).filter((d) => !d.revoked_at)

  return (
    <Panel
      title="Yetkili cihazlar"
      subtitle="Bu cihazlar şifre sorulmadan açılır · iptal edilen cihaz oturumu kapatılır"
      icon={Smartphone}
      className="lg:col-span-2"
      actions={
        <Button variant="secondary" icon={KeyRound} onClick={() => void openCode()} disabled={busy !== null} className="h-8 px-2.5 text-xs">
          Yeni cihaz için kod oluştur
        </Button>
      }
    >
      {code && (
        <div role="status" className="mb-4 rounded-lg border border-line bg-surface-2 p-3 text-sm">
          <p className="text-muted">Yeni cihazda giriş ekranına bu kodu yazın. Kod tek kullanımlıktır ve {CODE_MINUTES} dakika geçerlidir:</p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-[0.2em] text-ink" data-testid="enrollment-code">{code.value}</p>
          <p className="mt-1 text-xs text-subtle">Son geçerlilik: {code.until.toLocaleTimeString('tr-TR')} · yeni kod oluşturmak öncekini geçersiz kılar.</p>
        </div>
      )}
      {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
      {devices === null ? (
        <p className="text-sm text-muted">Yükleniyor…</p>
      ) : active.length === 0 ? (
        <p className="text-sm text-muted">Kayıtlı cihaz yok. Giriş hizmeti kurulduktan sonraki girişler burada listelenir.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line" aria-label="Yetkili cihazlar">
          {active.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
              <span className="min-w-0">
                <span className="block truncate text-ink-2">
                  {d.label}
                  {d.session_id === current && <StatusPill tone="ready" className="ml-2">Bu cihaz</StatusPill>}
                </span>
                <span className="block truncate text-[11px] text-subtle">
                  {d.method === 'kod' ? 'Kayıt kodu ile' : 'Şifre ile'} · ilk giriş {formatDateTime(d.created_at)} · son görülme {formatDateTime(d.last_seen_at)}
                </span>
              </span>
              <Button
                variant="ghost"
                onClick={() => void revoke(d.id)}
                disabled={busy !== null}
                aria-label={`${d.label} cihazını iptal et`}
                className="h-8 shrink-0 px-2.5 text-xs hover:!bg-danger-soft hover:!text-danger"
              >
                İptal et
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
