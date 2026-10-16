import { useState } from 'react'

/**
 * Diyalog kapalıdan açığa geçtiği render'da `reset`'i çağırır.
 *
 * Sıfırlama effect yerine render sırasında yapılır: effect boyamadan sonra çalıştığı için,
 * hızlı bir kullanıcı (veya yük altındaki e2e testi) effect çalışmadan yazabilir/gönderebilir
 * ve geç gelen sıfırlama yazılan değerleri ya da doğrulama hatalarını siler.
 *
 * `deps` verilirse, diyalog açıkken bu değerlerden biri değiştiğinde de (Object.is) yeniden sıfırlanır.
 *
 * `reset` yalnızca bu bileşenin kendi state'ini senkron olarak ayarlamalıdır (setState çağrıları);
 * yan etki (fetch vb.) içermemelidir. O render'ın güncel prop'larını kullanır.
 */
export function useResetOnOpen(open: boolean, reset: () => void, deps: readonly unknown[] = []): void {
  const [prev, setPrev] = useState<{ open: boolean; deps: readonly unknown[] }>({ open: false, deps })
  if (open !== prev.open || (open && !sameDeps(deps, prev.deps))) {
    setPrev({ open, deps })
    if (open) reset()
  }
}

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
}
