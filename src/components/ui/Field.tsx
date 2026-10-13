import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useId } from 'react'
import { cn } from '@/lib/cn'

/** iOS'ta odaklanınca yakınlaşmayı önlemek için yazı boyutu en az 16 px (sm altı). */
const control =
  'w-full rounded-xl border bg-surface px-3.5 text-base text-ink shadow-card transition-colors placeholder:text-subtle focus:border-titanium focus:outline-none focus:ring-2 focus:ring-titanium/20 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm'

interface FieldShellProps {
  label: string
  error?: string
  hint?: string
  required?: boolean
  className?: string
  children: (id: string, describedBy: string | undefined) => ReactNode
}

export function FieldShell({ label, error, hint, required, className, children }: FieldShellProps) {
  const id = useId()
  const msgId = `${id}-msg`
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1 text-[13px] font-medium text-ink-2">
        {label}
        {required && (
          <span className="text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children(id, error || hint ? msgId : undefined)}
      {error ? (
        <p id={msgId} className="mt-1.5 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="mt-1.5 text-xs text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

type Base = { label: string; error?: string; hint?: string; className?: string }

export function TextField({ label, error, hint, className, required, ...rest }: Base & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} className={className}>
      {(id, describedBy) => (
        <input
          id={id}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          aria-required={required}
          className={cn(control, 'h-11', error ? 'border-danger' : 'border-line')}
          {...rest}
        />
      )}
    </FieldShell>
  )
}

export function TextAreaField({ label, error, hint, className, required, ...rest }: Base & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} className={className}>
      {(id, describedBy) => (
        <textarea
          id={id}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={cn(control, 'min-h-[96px] resize-y py-2.5 leading-relaxed', error ? 'border-danger' : 'border-line')}
          {...rest}
        />
      )}
    </FieldShell>
  )
}

export function SelectField({
  label,
  error,
  hint,
  className,
  required,
  children,
  ...rest
}: Base & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} className={className}>
      {(id, describedBy) => (
        <select
          id={id}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={cn(control, 'h-11 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-10', error ? 'border-danger' : 'border-line')}
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23707985' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          }}
          {...rest}
        >
          {children}
        </select>
      )}
    </FieldShell>
  )
}

/** Form üstünde genel hata / uyarı şeridi */
export function FormAlert({ tone = 'error', children }: { tone?: 'error' | 'warn'; children: ReactNode }) {
  return (
    <div
      role="alert"
      className={cn(
        'mb-4 rounded-xl border px-4 py-3 text-sm leading-relaxed',
        tone === 'error' ? 'border-danger/30 bg-danger-soft text-ink' : 'border-warn-line bg-warn-soft text-ink-2',
      )}
    >
      {children}
    </div>
  )
}
