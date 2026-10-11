import { useEffect, useRef } from 'react'

/**
 * Açık katman (menü çekmecesi, arama paleti) davranışları:
 * Escape ile kapanma, arka plan kaydırma kilidi ve kapanınca odağın tetikleyiciye dönmesi.
 */
export function useOverlay(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
      }
    }
    const html = document.documentElement
    const prevHtml = html.style.overflow
    const prevBody = document.body.style.overflow
    html.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      html.style.overflow = prevHtml
      document.body.style.overflow = prevBody
      previouslyFocused?.focus?.({ preventScroll: true })
    }
  }, [open])
}
