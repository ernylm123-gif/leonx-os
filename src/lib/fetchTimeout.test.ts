import { describe, expect, it, vi } from 'vitest'
import { fetchWithTimeout } from './fetchTimeout'

const S = 'https://x.supabase.co'

/** Sinyale uyan, hiç yanıt vermeyen sahte fetch */
function hangingFetch() {
  const calls: { url: string; signal?: AbortSignal | null }[] = []
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), signal: init?.signal })
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('signal is aborted without reason', 'AbortError')))
    })
  })
  return { fn: fn as unknown as typeof fetch, calls }
}

describe('fetchWithTimeout', () => {
  it('yanıtsız PostgREST okuması süre dolunca AbortError ile biter (ekran donmaz)', async () => {
    vi.useFakeTimers()
    try {
      const h = hangingFetch()
      const f = fetchWithTimeout(h.fn, 1000)
      const p = f(`${S}/rest/v1/companies?select=*`, { method: 'GET' })
      const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' })
      await vi.advanceTimersByTimeAsync(1001)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('Auth isteklerine (oturum yenileme dahil) süre uygulanır', () => {
    const h = hangingFetch()
    const f = fetchWithTimeout(h.fn, 1000)
    void f(`${S}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' }).catch(() => {})
    expect(h.calls[0].signal).toBeInstanceOf(AbortSignal)
  })

  it('yazma, Storage ve kendi sinyali olan isteklere dokunmaz', () => {
    const h = hangingFetch()
    const f = fetchWithTimeout(h.fn, 1000)
    void f(`${S}/rest/v1/companies`, { method: 'POST' })
    void f(`${S}/rest/v1/companies?id=eq.1`, { method: 'PATCH' })
    void f(`${S}/storage/v1/object/proje/a.pdf`, { method: 'GET' })
    const own = new AbortController()
    void f(`${S}/rest/v1/companies`, { method: 'GET', signal: own.signal })
    expect(h.calls.map((c) => c.signal ?? null)).toEqual([null, null, null, own.signal])
  })

  it('yanıt gelince zamanlayıcı temizlenir', async () => {
    vi.useFakeTimers()
    try {
      const ok = vi.fn(async () => new Response('[]', { status: 200 })) as unknown as typeof fetch
      const f = fetchWithTimeout(ok, 1000)
      const res = await f(`${S}/rest/v1/x`)
      expect(res.status).toBe(200)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
