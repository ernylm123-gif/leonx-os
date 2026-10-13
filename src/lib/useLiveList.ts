import { useCallback, useEffect, useRef, useState } from 'react'
import { type DetailTable, useData } from '@/context/data'
import { dataErrorMessage } from './errors'


/**
 * Bir kayda bağlı alt listeyi (ör. projenin notları) yükler ve Realtime ile güncel tutar.
 * Silme olaylarında yalnızca birincil anahtar geldiği için ilgili liste yeniden sorgulanır.
 * Uygulama ön plana döndüğünde veya bağlantı yeniden kurulduğunda da yenilenir.
 */
export function useLiveList<T>(table: DetailTable, parentKey: string, parentId: string | undefined, fetcher: (id: string) => Promise<T[]>) {
  const { subscribeDetail, lastSyncedAt, syncState } = useData()
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher

  const reload = useCallback(async () => {
    if (!parentId) return
    try {
      const rows = await fetchRef.current(parentId)
      setItems(rows)
      setError(null)
    } catch (e) {
      setError(dataErrorMessage(e, 'Liste yükleme'))
    } finally {
      setLoading(false)
    }
  }, [parentId])

  useEffect(() => {
    setLoading(true)
    void reload()
  }, [reload])

  // Bağlantı canlıya döndüğünde (yeniden bağlanma) yenile
  const prevState = useRef(syncState)
  useEffect(() => {
    if (syncState === 'live' && prevState.current !== 'live') void reload()
    prevState.current = syncState
  }, [syncState, reload])

  useEffect(() => {
    if (!parentId) return
    return subscribeDetail(table, (payload) => {
      if (payload.eventType === 'DELETE' || payload.new[parentKey] === parentId) void reload()
    })
  }, [table, parentKey, parentId, subscribeDetail, reload])

  return { items, setItems, loading, error, reload, lastSyncedAt }
}

/**
 * Bir veya birkaç tablonun tamamına bağlı sorgu (ör. tüm teklifler ve kalemleri). Bu tablolarda
 * başka cihazdan gelen her değişiklikte (kısa bir gecikmeyle toplanarak) yeniden yüklenir.
 */
export function useLiveQuery<T>(tables: DetailTable[], fetcher: () => Promise<T>, initial: T) {
  const { subscribeDetail, syncState } = useData()
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher
  const key = tables.join(',')

  const reload = useCallback(async () => {
    try {
      setData(await fetchRef.current())
      setError(null)
    } catch (e) {
      setError(dataErrorMessage(e, 'Liste yükleme'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const prevState = useRef(syncState)
  useEffect(() => {
    if (syncState === 'live' && prevState.current !== 'live') void reload()
    prevState.current = syncState
  }, [syncState, reload])

  useEffect(() => {
    let timer: number | undefined
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void reload(), 120)
    }
    const offs = key.split(',').map((t) => subscribeDetail(t as DetailTable, schedule))
    return () => {
      window.clearTimeout(timer)
      offs.forEach((off) => off())
    }
  }, [key, subscribeDetail, reload])

  return { data, setData, loading, error, reload }
}
