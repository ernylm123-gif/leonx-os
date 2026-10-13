/**
 * CAD analiz Web Worker'ı: büyük DXF dosyaları arayüzü kilitlemeden ayrıştırılır.
 * İptal, ana iş parçacığının worker'ı sonlandırmasıyla (terminate) yapılır.
 */
import { analyzeDxfBytes, CadAnalysisError } from '../analyze'

export type WorkerRequest = { id: number; bytes: ArrayBuffer }
export type WorkerResponse =
  | { id: number; type: 'progress'; stage: string; fraction: number }
  | { id: number; type: 'done'; result: ReturnType<typeof analyzeDxfBytes> }
  | { id: number; type: 'error'; message: string; code: string; detail?: string }

// Uygulama tsconfig'i DOM kütüphanesini kullanır; worker kapsamı için asgari tip yeterlidir
interface WorkerScope {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void
}
const ctx = self as unknown as WorkerScope

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { id, bytes } = ev.data
  let last = 0
  try {
    const result = analyzeDxfBytes(new Uint8Array(bytes), {
      onProgress: (stage, fraction) => {
        const now = performance.now()
        if (now - last < 80 && fraction < 1) return
        last = now
        ctx.postMessage({ id, type: 'progress', stage, fraction } satisfies WorkerResponse)
      },
    })
    ctx.postMessage({ id, type: 'done', result } satisfies WorkerResponse, [result.scene.coords.buffer as ArrayBuffer])
  } catch (e) {
    const err = e instanceof CadAnalysisError ? e : null
    ctx.postMessage({
      id,
      type: 'error',
      message: err ? err.message : e instanceof Error ? `Analiz hatası: ${e.message}` : 'Bilinmeyen analiz hatası',
      code: err?.code ?? 'internal',
      detail: err?.detail,
    } satisfies WorkerResponse)
  }
}
