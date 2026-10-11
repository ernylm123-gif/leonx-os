import { cn } from '@/lib/cn'

/*
 * LEONX Metal orijinal logosu.
 * Görseller public/branding/leonx-logo.png dosyasından yalnızca kırpılarak ve
 * yeniden boyutlandırılarak üretilmiştir; şekil, renk ve oranlar değiştirilmemiştir.
 * Logonun kendi zemin rengi (#F6F6F6) korunur ve "plaka" içinde gösterilir;
 * böylece koyu temada da orijinal görünüm bozulmaz.
 */

const LOCKUP = { src: '/branding/leonx-lockup.png', width: 480, height: 326 }
const SYMBOL = { src: '/branding/leonx-symbol.png', width: 192, height: 134 }
const WORDMARK = { src: '/branding/leonx-wordmark.png', width: 640, height: 86 }

const plate = 'overflow-hidden rounded-xl border border-plate-line bg-plate'

/** LX sembolü + LEONX yazısı (tam logo). */
export function LeonxLockup({ className }: { className?: string }) {
  return (
    <div className={cn(plate, 'px-4 py-2.5', className)}>
      <img
        {...LOCKUP}
        alt="LEONX"
        decoding="async"
        draggable={false}
        className="mx-auto h-auto w-full max-w-[148px] select-none"
      />
    </div>
  )
}

/** Yalnızca LX sembolü — daraltılmış menü ve mobil üst çubuk için. */
export function LeonxSymbol({ className, size = 40 }: { className?: string; size?: number }) {
  return (
    <div
      className={cn(plate, 'grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size, padding: Math.round(size * 0.12) }}
    >
      <img {...SYMBOL} alt="LEONX" decoding="async" draggable={false} className="h-auto w-full select-none" />
    </div>
  )
}

/** Yalnızca LEONX yazısı — tablet üst çubuğu için. */
export function LeonxWordmark({ className }: { className?: string }) {
  return (
    <div className={cn(plate, 'flex items-center px-3 py-2', className)}>
      <img {...WORDMARK} alt="LEONX" decoding="async" draggable={false} className="h-3.5 w-auto select-none" />
    </div>
  )
}
