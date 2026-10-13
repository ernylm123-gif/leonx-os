import { isNetworkError } from './errors'

/**
 * Yalnızca ağ hatalarında (bağlantı yok, istek yarıda kesildi) yeniden deneme.
 * Doğrulama, yetki veya çakışma hataları hiçbir zaman yeniden denenmez.
 * Bekleme: 400 ms, 1,2 sn, 3,6 sn (toplam ~5 sn). Çevrimdışıyken boşuna beklemek yerine
 * çevrimiçi olunmasını en fazla bekleme süresi kadar bekler.
 */
export const RETRY_DELAYS_MS = [400, 1200, 3600]

export interface RetryOptions {
  delays?: number[]
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(t)
      if (typeof window !== 'undefined') window.removeEventListener('online', done)
      resolve()
    }
    const t = setTimeout(done, ms)
    if (typeof window !== 'undefined') window.addEventListener('online', done)
  })

export async function withNetworkRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const delays = opts.delays ?? RETRY_DELAYS_MS
  const sleep = opts.sleep ?? defaultSleep
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (!isNetworkError(e) || attempt >= delays.length) throw e
      await sleep(delays[attempt])
    }
  }
}
