import { describe, expect, it, vi } from 'vitest'
import { fetchAllPages } from './api'

/** Sahte sorgu kurucusu: verilen sayfa boylarında satır döndürür, istenen aralıkları kaydeder */
function pagedBuilder(sizes: number[]) {
  let call = 0
  const ranges: [number, number][] = []
  const build = vi.fn((from: number, to: number) => {
    ranges.push([from, to])
    const n = sizes[call++] ?? 0
    return Promise.resolve({ data: Array.from({ length: n }, (_, i) => ({ n: from + i })), error: null })
  })
  return { build, ranges }
}

describe('fetchAllPages', () => {
  it('1000, 1000, 3 satırlık sayfaları birleştirir (2003 satır)', async () => {
    const { build, ranges } = pagedBuilder([1000, 1000, 3])
    const rows = await fetchAllPages(build)
    expect(rows).toHaveLength(2003)
    expect(rows[1000]).toEqual({ n: 1000 })
    expect(rows[2002]).toEqual({ n: 2002 })
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('tam sayfa sonrası boş sayfada durur', async () => {
    const { build } = pagedBuilder([1000, 0])
    expect(await fetchAllPages(build)).toHaveLength(1000)
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('güvenlik sınırı aşılırsa sessizce kesmek yerine hata verir', async () => {
    const { build } = pagedBuilder(Array(10).fill(10))
    await expect(fetchAllPages(build, 10, 3)).rejects.toThrow(/Liste çok büyük/)
    expect(build).toHaveBeenCalledTimes(3)
  })

  it('varsayılan güvenlik sınırı 50 sayfadır', async () => {
    const { build } = pagedBuilder(Array(60).fill(1000))
    await expect(fetchAllPages(build)).rejects.toThrow(/50\.000 satırdan fazla/)
    expect(build).toHaveBeenCalledTimes(50)
  })

  it('sorgu hatasını iletir', async () => {
    const err = { code: '42501', message: 'permission denied' }
    await expect(fetchAllPages(() => Promise.resolve({ data: null, error: err }))).rejects.toBe(err)
  })
})
