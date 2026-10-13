import { useCallback, useMemo, useState } from 'react'
import { ConflictError } from '@/data/api'
import { createItems, deleteItems, listItems, updateItem } from '@/data/quantityApi'
import type { QuantityTakeoff } from '@/data/types'
import { useToast } from '@/context/toast'
import { dataErrorMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { useLiveList } from '@/lib/useLiveList'
import type { QuantityItem, QuantityItemInput } from '@/quantity/types'

/** Metraj tablosunun veri kaynağı: projeye kayıtlı sürüm (Supabase + Realtime) veya kaydedilmemiş yerel liste. */
export interface ItemsStore {
  kind: 'local' | 'remote'
  items: QuantityItem[]
  loading: boolean
  error: string | null
  readOnly: boolean
  readOnlyReason: string | null
  create: (inputs: QuantityItemInput[]) => Promise<QuantityItem[] | null>
  update: (item: QuantityItem, patch: Partial<QuantityItemInput>) => Promise<boolean>
  /** Birden çok kaleme aynı değişiklik; çakışan kalemler raporlanır */
  updateMany: (items: QuantityItem[], patch: Partial<QuantityItemInput>) => Promise<number>
  remove: (ids: string[]) => Promise<boolean>
  reload: () => Promise<void>
}

export function useRemoteItems(takeoff: QuantityTakeoff | null): ItemsStore {
  const { notify } = useToast()
  const takeoffId = takeoff?.id
  const live = useLiveList<QuantityItem>('quantity_items', 'takeoff_id', takeoffId, (id) => listItems(requireSupabase(), id))
  const { setItems, reload } = live

  const fail = useCallback(
    async (e: unknown, ctx: string) => {
      if (e instanceof ConflictError) {
        notify(e.reason === 'deleted' ? 'Kalem başka bir cihazda silinmiş.' : 'Kalem başka bir cihazda değiştirilmiş; güncel hali yüklendi.', 'error')
        await reload()
      } else notify(dataErrorMessage(e, ctx), 'error')
    },
    [notify, reload],
  )

  const create = useCallback(
    async (inputs: QuantityItemInput[]) => {
      if (!takeoff) return null
      try {
        const rows = await createItems(requireSupabase(), takeoff.id, takeoff.project_id, inputs)
        setItems((list) => [...list.filter((x) => !rows.some((r) => r.id === x.id)), ...rows])
        return rows
      } catch (e) {
        await fail(e, 'Poz ekleme')
        return null
      }
    },
    [takeoff, setItems, fail],
  )

  const update = useCallback(
    async (item: QuantityItem, patch: Partial<QuantityItemInput>) => {
      try {
        const row = await updateItem(requireSupabase(), item, patch)
        setItems((list) => list.map((x) => (x.id === row.id ? row : x)))
        return true
      } catch (e) {
        await fail(e, 'Poz güncelleme')
        return false
      }
    },
    [setItems, fail],
  )

  const updateMany = useCallback(
    async (items: QuantityItem[], patch: Partial<QuantityItemInput>) => {
      let ok = 0
      let conflicts = 0
      for (const it of items) {
        try {
          const row = await updateItem(requireSupabase(), it, patch)
          setItems((list) => list.map((x) => (x.id === row.id ? row : x)))
          ok++
        } catch (e) {
          if (e instanceof ConflictError) conflicts++
          else {
            notify(dataErrorMessage(e, 'Toplu güncelleme'), 'error')
            break
          }
        }
      }
      if (conflicts) {
        notify(`${conflicts} kalem başka cihazda değiştiği için güncellenmedi.`, 'error')
        await reload()
      }
      return ok
    },
    [setItems, notify, reload],
  )

  const remove = useCallback(
    async (ids: string[]) => {
      try {
        await deleteItems(requireSupabase(), ids)
        setItems((list) => list.filter((x) => !ids.includes(x.id)))
        return true
      } catch (e) {
        await fail(e, 'Poz silme')
        return false
      }
    },
    [setItems, fail],
  )

  const readOnly = !!takeoff && takeoff.status !== 'taslak'
  return useMemo(
    () => ({
      kind: 'remote' as const,
      items: live.items,
      loading: live.loading,
      error: live.error,
      readOnly,
      readOnlyReason: readOnly ? (takeoff?.status === 'onaylandi' ? 'Bu sürüm onaylandı ve kilitlendi. Değişiklik için yeni revizyon oluşturun.' : 'Bu sürüm arşivlendi.') : null,
      create,
      update,
      updateMany,
      remove,
      reload,
    }),
    [live.items, live.loading, live.error, readOnly, takeoff?.status, create, update, updateMany, remove, reload],
  )
}

/** Projeye kaydedilmemiş metraj (CAD çalışma alanında dosya projeye bağlanmadan önce) */
export function useLocalItems(): ItemsStore & { replaceAll: (items: QuantityItem[]) => void } {
  const [items, setItems] = useState<QuantityItem[]>([])
  const now = () => new Date().toISOString()
  const create = useCallback(async (inputs: QuantityItemInput[]) => {
    const rows: QuantityItem[] = inputs.map((i) => ({
      ...i,
      poz_code: i.poz_code.trim(),
      id: crypto.randomUUID(),
      takeoff_id: 'yerel',
      project_id: '',
      created_by: null,
      created_at: now(),
      updated_at: now(),
      version: 1,
    }))
    setItems((l) => [...l, ...rows])
    return rows
  }, [])
  const update = useCallback(async (item: QuantityItem, patch: Partial<QuantityItemInput>) => {
    setItems((l) => l.map((x) => (x.id === item.id ? { ...x, ...patch, version: x.version + 1, updated_at: now() } : x)))
    return true
  }, [])
  const updateMany = useCallback(async (list: QuantityItem[], patch: Partial<QuantityItemInput>) => {
    const ids = new Set(list.map((x) => x.id))
    setItems((l) => l.map((x) => (ids.has(x.id) ? { ...x, ...patch, version: x.version + 1, updated_at: now() } : x)))
    return list.length
  }, [])
  const remove = useCallback(async (ids: string[]) => {
    setItems((l) => l.filter((x) => !ids.includes(x.id)))
    return true
  }, [])
  return useMemo(
    () => ({
      kind: 'local' as const,
      items,
      loading: false,
      error: null,
      readOnly: false,
      readOnlyReason: null,
      create,
      update,
      updateMany,
      remove,
      reload: async () => {},
      replaceAll: setItems,
    }),
    [items, create, update, updateMany, remove],
  )
}
