import { AlertTriangle, Loader2, RotateCw } from 'lucide-react'
import { Button } from './Button'

export function LoadingState({ label = 'Yükleniyor…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 px-6 py-14 text-sm text-muted" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" role="alert">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-danger-soft">
        <AlertTriangle className="h-5 w-5 text-danger" aria-hidden="true" />
      </span>
      <p className="mt-4 max-w-md text-sm text-ink-2">{message}</p>
      {onRetry && (
        <Button variant="secondary" icon={RotateCw} onClick={onRetry} className="mt-5">
          Tekrar dene
        </Button>
      )}
    </div>
  )
}

/** Yükleme sırasında kart yer tutucuları (iskelet) */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 p-4" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-xl bg-surface-2" />
      ))}
    </div>
  )
}
