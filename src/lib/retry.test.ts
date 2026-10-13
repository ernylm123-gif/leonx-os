import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { insertManyOnce, insertOnce } from '@/data/api'
import { withNetworkRetry } from './retry'

const noSleep = { sleep: async () => {} }
const netErr = () => ({ message: 'TypeError: Failed to fetch', code: '' })

describe('withNetworkRetry', () => {
  it('yalnızca ağ hatasını yeniden dener', async () => {
    let n = 0
    const r = await withNetworkRetry(async () => {
      if (++n < 3) throw netErr()
      return 'ok'
    }, noSleep)
    expect(r).toBe('ok')
    expect(n).toBe(3)
  })

  it('doğrulama/yetki hatası hiç yeniden denenmez', async () => {
    let n = 0
    await expect(
      withNetworkRetry(async () => {
        n++
        throw { code: '42501', message: 'permission denied' }
      }, noSleep),
    ).rejects.toMatchObject({ code: '42501' })
    expect(n).toBe(1)
  })

  it('deneme sınırı aşılınca son hata iletilir', async () => {
    let n = 0
    await expect(
      withNetworkRetry(async () => {
        n++
        throw netErr()
      }, { delays: [1, 1], ...noSleep }),
    ).rejects.toMatchObject({ message: /Failed to fetch/ })
    expect(n).toBe(3)
  })
})

/**
 * Sahte istemci: "sunucu" satırı yazar ama ilk yanıt ağda kaybolur (gerçek hayatta
 * mobil bağlantı kopması). İstemci yeniden dener → 23505 → aynı kimlikli satırı okur.
 */
function lossyDb(loseFirstResponse: boolean) {
  const rows = new Map<string, Record<string, unknown>>()
  let lost = !loseFirstResponse
  const db = {
    from: () => ({
      insert: (input: Record<string, unknown> | Record<string, unknown>[]) => {
        const list = Array.isArray(input) ? input : [input]
        const run = () => {
          if (list.some((r) => rows.has(r.id as string))) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "t_pkey"' } }
          for (const r of list) rows.set(r.id as string, { ...r })
          if (!lost) {
            lost = true
            return { data: null, error: netErr() }
          }
          return { data: Array.isArray(input) ? list : list[0], error: null }
        }
        return { select: () => ({ single: async () => run(), then: (f: (v: unknown) => unknown) => Promise.resolve(run()).then(f) }) }
      },
      select: () => ({
        eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: rows.get(id) ?? null, error: null }) }),
        in: async (_c: string, ids: string[]) => ({ data: ids.map((i) => rows.get(i)).filter(Boolean), error: null }),
      }),
    }),
  }
  return { db: db as unknown as SupabaseClient, rows }
}

describe('tekrarlanabilir ekleme', () => {
  it('yanıt kaybolsa bile tek kayıt oluşur ve kayıt döner', async () => {
    const { db, rows } = lossyDb(true)
    const row = await insertOnce<{ id: string; name: string }>(db, 'companies', { name: 'Test' })
    expect(rows.size).toBe(1)
    expect(row.name).toBe('Test')
    expect(rows.has(row.id)).toBe(true)
  })

  it('toplu eklemede de çift kayıt oluşmaz', async () => {
    const { db, rows } = lossyDb(true)
    const out = await insertManyOnce<{ id: string }>(db, 'quantity_items', [{ a: 1 }, { a: 2 }, { a: 3 }])
    expect(rows.size).toBe(3)
    expect(out.length).toBe(3)
  })

  it('başka kaydın benzersizlik hatası (ör. aynı proje kodu) gizlenmez', async () => {
    const db = {
      from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "projects_code_key"' } }) }) }),
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    } as unknown as SupabaseClient
    await expect(insertOnce(db, 'projects', { code: 'LX-1' })).rejects.toMatchObject({ code: '23505' })
  })
})
