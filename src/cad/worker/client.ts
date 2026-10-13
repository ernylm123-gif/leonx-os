import { CadAnalysisError } from '../analyze'
import type { DxfAnalysis } from '../types'
import type { WorkerRequest, WorkerResponse } from './cad.worker'

export const STAGE_LABEL: Record<string, string> = {
  okuma: 'Dosya okunuyor',
  ayristirma: 'DXF ayrıştırılıyor',
  sahne: 'Bloklar açılıyor ve geometri hazırlanıyor',
}

export class AnalysisCancelled extends Error {
  constructor() {
    super('Analiz iptal edildi.')
    this.name = 'AnalysisCancelled'
  }
}

let seq = 1

/**
 * DXF analizini ayrı bir Web Worker'da çalıştırır. Her analiz için yeni worker açılır ve iş
 * bitince kapatılır; iptal edilirse worker hemen sonlandırılır (bellek serbest kalır).
 */
export function analyzeInWorker(
  bytes: ArrayBuffer,
  opts: { signal?: AbortSignal; onProgress?: (stage: string, fraction: number) => void } = {},
): Promise<DxfAnalysis> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new AnalysisCancelled())
      return
    }
    const worker = new Worker(new URL('./cad.worker.ts', import.meta.url), { type: 'module', name: 'leonx-cad' })
    const id = seq++
    const cleanup = () => {
      worker.terminate()
      opts.signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(new AnalysisCancelled())
    }
    opts.signal?.addEventListener('abort', onAbort)
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data
      if (msg.id !== id) return
      if (msg.type === 'progress') opts.onProgress?.(msg.stage, msg.fraction)
      else if (msg.type === 'done') {
        cleanup()
        resolve(msg.result)
      } else {
        cleanup()
        reject(new CadAnalysisError(msg.message, (msg.code as CadAnalysisError['code']) ?? 'unknown', msg.detail))
      }
    }
    worker.onerror = (ev) => {
      cleanup()
      reject(new Error(`Analiz çalışanı başlatılamadı: ${ev.message || 'bilinmeyen hata'}`))
    }
    // Bayt dizisi worker'a aktarılır (kopyalanmaz)
    worker.postMessage({ id, bytes } satisfies WorkerRequest, [bytes])
  })
}
