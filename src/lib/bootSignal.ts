/**
 * Açılış koruması (public/boot-guard.js) ile uygulama arasındaki tek bağlantı: React ilk
 * çizimi tamamlayınca çağrılır. Koruma betiği yoksa (ör. test ortamı) yalnızca bayrak kalır.
 */
interface BootGuardHandle {
  booted: () => void
}

declare global {
  interface Window {
    __LEONX_BOOTED__?: boolean
    __LEONX_BOOT_GUARD__?: BootGuardHandle
  }
}

export function markBooted(win: Window = window): void {
  win.__LEONX_BOOTED__ = true
  try {
    win.__LEONX_BOOT_GUARD__?.booted()
  } catch {
    /* koruma betiği hatası uygulamayı etkilemez */
  }
}
