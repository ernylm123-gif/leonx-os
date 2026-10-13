import { AlertTriangle, RefreshCw, X } from 'lucide-react'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { APP } from '@/config/company'
import {
  type BuildInfo,
  canAttemptReload,
  clearReloadAttempts,
  CURRENT_BUILD,
  fetchServerBuild,
  isChunkLoadError,
  isNewer,
  originStatus,
  purgeLegacyCaches,
  recordReloadAttempt,
  reloadUrl,
  safeSessionStorage,
} from '@/lib/appVersion'
import { busyLabels, installBeforeUnloadGuard, useBusyLabels, useUnsavedLabels } from '@/lib/unsaved'

/** Denetim sıklığı: arka planda 5 dk; ön plana dönüş / ağ geri gelişi en fazla 30 sn'de bir */
const POLL_MS = 5 * 60 * 1000
const EVENT_THROTTLE_MS = 30 * 1000

interface UpdateContextValue {
  current: BuildInfo
  latest: BuildInfo | null
  available: boolean
  lastCheckedAt: Date | null
  checking: boolean
  /** Yeniden yükleme denendi ama tarayıcı hâlâ eski sürümü veriyor */
  stuck: boolean
  check: () => Promise<void>
  applyUpdate: (force?: boolean) => void
}

const UpdateContext = createContext<UpdateContextValue | null>(null)

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [latest, setLatest] = useState<BuildInfo | null>(null)
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null)
  const [checking, setChecking] = useState(false)
  const [stuck, setStuck] = useState(false)
  const lastRun = useRef(0)
  const store = safeSessionStorage()

  const check = useCallback(async () => {
    lastRun.current = Date.now()
    setChecking(true)
    try {
      const server = await fetchServerBuild()
      if (server) setLatest(server)
      setLastCheckedAt(new Date())
      if (server && isNewer(server, CURRENT_BUILD) && !canAttemptReload(server.buildId, store)) setStuck(true)
    } finally {
      setChecking(false)
    }
  }, [store])

  // Yeni sürümle açıldıysak önceki deneme kaydı temizlenir
  useEffect(() => clearReloadAttempts(CURRENT_BUILD, store), [store])

  useEffect(() => {
    const first = window.setTimeout(() => void check(), 4000)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void check()
    }, POLL_MS)
    const onEvent = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRun.current < EVENT_THROTTLE_MS) return
      void check()
    }
    document.addEventListener('visibilitychange', onEvent)
    window.addEventListener('online', onEvent)
    window.addEventListener('focus', onEvent)
    window.addEventListener('pageshow', onEvent)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onEvent)
      window.removeEventListener('online', onEvent)
      window.removeEventListener('focus', onEvent)
      window.removeEventListener('pageshow', onEvent)
    }
  }, [check])

  useEffect(() => installBeforeUnloadGuard(), [])

  const applyUpdate = useCallback(
    (force = false) => {
      const target = latest?.buildId ?? 'bilinmiyor'
      if (!force && !canAttemptReload(target, store)) {
        setStuck(true)
        return
      }
      // Dosya yüklemesi sürerken güncellenmez (bildirim yükleme bitince düğmeyi açar)
      if (busyLabels().length > 0) return
      recordReloadAttempt(target, store)
      // Eski önbellekler temizlenir; sürüm parametreli adres HTML'in hiçbir ara önbellekten
      // gelmemesini sağlar (iOS/Android ana ekran uygulaması dahil). Varlık dosyaları içerik
      // karmalı adlarla yeni sürümden gelir.
      void purgeLegacyCaches().finally(() => window.location.replace(reloadUrl(window.location.href, target)))
    },
    [latest, store],
  )

  // Dağıtımdan sonra eski sekmede silinmiş parça (chunk) yüklenemezse hata yutulmaz: sayfa
  // parçalarında rota hata ekranı hedef adreste bir kez güvenli yeniden yükleme yapar
  // (RouteErrorFallback). Burada yalnızca sürüm denetimi tetiklenir; böylece diğer parçalar
  // (dışa aktarma yazı tipleri, PDF okuyucu) için "Yeni sürüm hazır" bildirimi görünür.
  useEffect(() => {
    const onPreloadError = () => void check()
    window.addEventListener('vite:preloadError', onPreloadError)
    return () => window.removeEventListener('vite:preloadError', onPreloadError)
  }, [check])

  const value = useMemo<UpdateContextValue>(
    () => ({ current: CURRENT_BUILD, latest, available: isNewer(latest, CURRENT_BUILD), lastCheckedAt, checking, stuck, check, applyUpdate }),
    [latest, lastCheckedAt, checking, stuck, check, applyUpdate],
  )
  return (
    <UpdateContext.Provider value={value}>
      <EnvironmentBanner />
      {children}
      <UpdateBanner />
    </UpdateContext.Provider>
  )
}

export function useUpdate(): UpdateContextValue {
  const ctx = useContext(UpdateContext)
  if (!ctx) throw new Error('useUpdate, UpdateProvider içinde kullanılmalıdır')
  return ctx
}

/** "Yeni sürüm hazır — Güncelle". Kaydedilmemiş değişiklik varsa önce uyarır. */
function UpdateBanner() {
  const { available, applyUpdate, latest, stuck } = useUpdate()
  const unsaved = useUnsavedLabels()
  const busy = useBusyLabels()
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  if (!available || !latest || dismissedFor === latest.buildId) return null
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="update-banner"
      className="fixed inset-x-3 top-[calc(12px+env(safe-area-inset-top))] z-[80] mx-auto max-w-xl rounded-2xl border border-line bg-surface p-3.5 shadow-raised"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-ink">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">LEONX OS — Yeni sürüm hazır</p>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {stuck
              ? 'Güncelleme yüklenemedi: tarayıcı eski dosyaları vermeye devam ediyor. Uygulamayı tamamen kapatıp yeniden açın (iPad/iPhone: uygulama değiştiriciden yukarı kaydırın).'
              : `v${latest.version} (${latest.commit}) yayınlandı. Verileriniz sunucuda güvende; güncelleme yalnızca uygulamayı yeniler.`}
          </p>
          {busy.length > 0 && !stuck && (
            <p className="mt-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-muted" data-testid="update-busy">
              {busy.join(', ')}. Güncelleme, işlem bitince yapılabilir.
            </p>
          )}
          {confirming && unsaved.length > 0 && (
            <p className="mt-2 rounded-lg border border-warn-line bg-warn-soft px-2.5 py-1.5 text-[12px] text-warn" data-testid="update-unsaved">
              Kaydedilmemiş değişiklik: {unsaved.join(', ')}. Önce kaydedin; yine de güncellerseniz bu değişiklikler kaybolur.
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap gap-2">
            {!stuck && (
              <button
                type="button"
                data-testid="update-apply"
                disabled={busy.length > 0}
                onClick={() => {
                  if (unsaved.length > 0 && !confirming) {
                    setConfirming(true)
                    return
                  }
                  applyUpdate(confirming)
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-ink hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                {confirming && unsaved.length > 0 ? 'Yine de güncelle' : 'Güncelle'}
              </button>
            )}
            <button type="button" data-testid="update-later" onClick={() => setDismissedFor(latest.buildId)} className="h-9 rounded-lg px-3 text-[13px] font-semibold text-muted hover:bg-surface-2 hover:text-ink">
              Daha Sonra
            </button>
          </div>
        </div>
        <button type="button" onClick={() => setDismissedFor(latest.buildId)} aria-label="Kapat" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

/** Önizleme veya sabit dağıtım adresinde çalışıyorsa kanonik adrese yönlendiren uyarı */
function EnvironmentBanner() {
  const status = originStatus(window.location.origin, APP.canonicalOrigin, CURRENT_BUILD.env)
  const [hidden, setHidden] = useState(false)
  if (hidden || status === 'kanonik' || status === 'yerel') return null
  const target = `${APP.canonicalOrigin}${window.location.pathname}${window.location.search}`
  return (
    <div
      role="note"
      data-testid="env-banner"
      className="relative z-[75] flex items-center justify-center gap-2 border-b border-warn-line bg-warn-soft px-3 py-1.5 text-center text-[12px] text-warn"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        {status === 'onizleme'
          ? `Önizleme sürümü (${CURRENT_BUILD.branch}). Günlük kullanım için tek adres:`
          : 'Bu adres sabit bir dağıtıma aittir ve güncellenmez. Güncel sürüm için:'}{' '}
        <a href={target} className="font-semibold underline underline-offset-2">
          {APP.canonicalOrigin.replace('https://', '')}
        </a>
      </span>
      <button type="button" onClick={() => setHidden(true)} aria-label="Uyarıyı gizle" className="grid h-6 w-6 shrink-0 place-items-center rounded hover:bg-warn-soft">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

let recoveryScheduled = false

/** Rota yükleme hatası (ör. dağıtım sonrası silinmiş sayfa parçası): beyaz ekran yerine güvenli kurtarma */
export function RouteErrorFallback({ error }: { error: unknown }) {
  const chunk = isChunkLoadError(error)
  const store = safeSessionStorage()
  const target = `chunk:${window.location.pathname}`
  const [tried] = useState(() => {
    if (recoveryScheduled) return true
    if (chunk && canAttemptReload(target, store)) {
      recoveryScheduled = true
      recordReloadAttempt(target, store)
      window.setTimeout(() => window.location.replace(reloadUrl(window.location.href, 'parca')), 50)
      return true
    }
    return false
  })
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center p-6 text-center" role="alert" data-testid="route-error">
      <AlertTriangle className="h-8 w-8 text-warn" aria-hidden="true" />
      <h1 className="mt-3 text-base font-semibold text-ink">{chunk ? 'Uygulama güncellendi' : 'Sayfa açılamadı'}</h1>
      <p className="mt-1 max-w-md text-sm text-muted">
        {chunk
          ? tried
            ? 'Yeni sürüm yükleniyor…'
            : 'Yeni sürüm dosyaları yüklenemedi. Bağlantınızı kontrol edip yeniden yükleyin; sorun sürerse uygulamayı kapatıp açın.'
          : 'Beklenmeyen bir hata oluştu. Verileriniz sunucuda güvende.'}
      </p>
      <button type="button" onClick={() => window.location.reload()} className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-ink hover:bg-primary-hover">
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Yeniden yükle
      </button>
    </div>
  )
}
