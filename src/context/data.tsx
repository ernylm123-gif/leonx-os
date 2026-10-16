import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { LIST_LIMIT, listCompanies, listProjects } from '@/data/api'
import type { Company, Project } from '@/data/types'
import { dataErrorMessage } from '@/lib/errors'
import { type ChangePayload, type RealtimeClientLike, RealtimeSync, type SyncState } from '@/lib/realtimeSync'
import { requireSupabase } from '@/lib/supabase'

/**
 * Canlı veri deposu: firmalar ve projeler bellekte tutulur, Supabase Realtime ile
 * güncellenir. Bağlantı yeniden kurulduğunda, uygulama ön plana geldiğinde ve ağ
 * geri geldiğinde tam yenileme yapılır. Çevrimdışı düzenleme DESTEKLENMEZ;
 * kayıtlar yalnızca sunucuya yazıldığında kalıcıdır.
 */

export const REALTIME_TABLES = [
  'companies',
  'projects',
  'contacts',
  'project_notes',
  'project_files',
  'project_status_history',
  'cad_analyses',
  'quantity_takeoffs',
  'quantity_items',
  'quotes',
  'quote_items',
  'quote_history',
  'quote_settings',
  'project_tasks',
  'project_events',
  'notifications',
  'notification_prefs',
  'cost_rates',
  'fx_rates',
  'project_budgets',
  'project_cost_lines',
  'project_expenses',
  'project_payment_schedule',
  'project_collections',
  'finance_accounts',
  'finance_categories',
  'finance_entries',
  'finance_transfers',
  'finance_recurring',
  'finance_documents',
  'finance_audit_log',
] as const

export type DetailTable = Exclude<(typeof REALTIME_TABLES)[number], 'companies' | 'projects'>
type DetailListener = (payload: ChangePayload) => void

interface DataContextValue {
  companies: Company[]
  projects: Project[]
  loading: boolean
  error: string | null
  /** Liste sınırına ulaşıldı mı (çok büyük veri) */
  truncated: boolean
  syncState: SyncState
  lastSyncedAt: Date | null
  refresh: () => Promise<void>
  /** Kaydetme sonrası yerel depoyu hemen günceller (Realtime olayını beklemeden) */
  upsertCompany: (c: Company) => void
  removeCompany: (id: string) => void
  upsertProject: (p: Project) => void
  removeProject: (id: string) => void
  /** Detay sayfaları için tablo değişikliklerine abone olma */
  subscribeDetail: (table: DetailTable, listener: DetailListener) => () => void
}

const DataContext = createContext<DataContextValue | null>(null)

function upsertById<T extends { id: string; version: number }>(list: T[], row: T): T[] {
  const i = list.findIndex((x) => x.id === row.id)
  if (i === -1) return [row, ...list]
  // Daha eski sürüm gelirse (sıra dışı olay) yok say
  if (list[i].version > row.version) return list
  const next = list.slice()
  next[i] = row
  return next
}

/**
 * Sunucudan gelen tam listeyi yerel listeyle birleştirir: yenileme sürerken Realtime ile
 * gelmiş daha yeni bir sürüm varsa korunur. Sunucuda olmayan kayıtlar (silinmiş) düşer.
 */
export function mergeServerList<T extends { id: string; version: number }>(server: T[], local: T[]): T[] {
  const localById = new Map(local.map((x) => [x.id, x]))
  return server.map((row) => {
    const l = localById.get(row.id)
    return l && l.version > row.version ? l : row
  })
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [companies, setCompanies] = useState<Company[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const listeners = useRef(new Map<DetailTable, Set<DetailListener>>())
  const inflight = useRef<Promise<void> | null>(null)

  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current
    const run = (async () => {
      const db = requireSupabase()
      try {
        const [c, p] = await Promise.all([listCompanies(db), listProjects(db)])
        setCompanies((prev) => mergeServerList(c, prev))
        setProjects((prev) => mergeServerList(p, prev))
        setTruncated(c.length >= LIST_LIMIT || p.length >= LIST_LIMIT)
        setError(null)
        setLastSyncedAt(new Date())
      } catch (e) {
        setError(dataErrorMessage(e, 'Veri yükleme'))
      } finally {
        setLoading(false)
        inflight.current = null
      }
    })()
    inflight.current = run
    return run
  }, [])

  const handleChange = useCallback((payload: ChangePayload) => {
    const { table, eventType } = payload
    if (table === 'companies') {
      if (eventType === 'DELETE') setCompanies((l) => l.filter((x) => x.id !== payload.old.id))
      else setCompanies((l) => upsertById(l, payload.new as unknown as Company).sort((a, b) => a.name.localeCompare(b.name, 'tr')))
    } else if (table === 'projects') {
      if (eventType === 'DELETE') setProjects((l) => l.filter((x) => x.id !== payload.old.id))
      else setProjects((l) => upsertById(l, payload.new as unknown as Project))
    } else {
      listeners.current.get(table as DetailTable)?.forEach((fn) => fn(payload))
    }
    setLastSyncedAt(new Date())
  }, [])

  useEffect(() => {
    const db = requireSupabase()
    void refresh()
    const sync = new RealtimeSync(db as unknown as RealtimeClientLike, {
      tables: REALTIME_TABLES,
      onChange: handleChange,
      onResync: () => void refresh(),
      onState: setSyncState,
    })
    sync.start()

    const onVisible = () => document.visibilityState === 'visible' && sync.resume()
    const onOnline = () => sync.resume()
    const onOffline = () => sync.markOffline()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('pageshow', onOnline)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) sync.markOffline()

    // Oturum kapanınca (bileşen kaldırılınca) abonelikler temizlenir
    return () => {
      sync.stop()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('pageshow', onOnline)
    }
  }, [refresh, handleChange])

  const subscribeDetail = useCallback((table: DetailTable, listener: DetailListener) => {
    const set = listeners.current.get(table) ?? new Set()
    set.add(listener)
    listeners.current.set(table, set)
    return () => {
      set.delete(listener)
    }
  }, [])

  const value = useMemo<DataContextValue>(
    () => ({
      companies,
      projects,
      loading,
      error,
      truncated,
      syncState,
      lastSyncedAt,
      refresh,
      upsertCompany: (c) => setCompanies((l) => upsertById(l, c).sort((a, b) => a.name.localeCompare(b.name, 'tr'))),
      removeCompany: (id) => setCompanies((l) => l.filter((x) => x.id !== id)),
      upsertProject: (p) => setProjects((l) => upsertById(l, p)),
      removeProject: (id) => setProjects((l) => l.filter((x) => x.id !== id)),
      subscribeDetail,
    }),
    [companies, projects, loading, error, truncated, syncState, lastSyncedAt, refresh, subscribeDetail],
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData, DataProvider içinde kullanılmalıdır')
  return ctx
}
