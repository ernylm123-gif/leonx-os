import { type FormEvent, useState } from 'react'
import { Eye, EyeOff, Loader2, LockKeyhole, LogIn } from 'lucide-react'
import { Navigate, useLocation } from 'react-router-dom'
import { AuthShell } from '@/components/layout/AuthShell'
import { FormAlert, TextField } from '@/components/ui/Field'
import { useAuth } from '@/context/auth'
import { SetupRequiredPage } from './SetupRequiredPage'

/** Yalnızca giriş. Hesap oluşturma bu ekranda bulunmaz; tek hesap Supabase panelinden açılır. */
export function LoginPage() {
  const { status, signIn, signOutReason } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})

  const next = new URLSearchParams(location.search).get('next')
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/'

  if (status === 'unconfigured') return <SetupRequiredPage />
  if (status === 'owner' || status === 'not_owner' || status === 'checking_owner' || status === 'owner_check_failed') {
    return <Navigate to={target} replace />
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const fe: typeof fieldErrors = {}
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) fe.email = 'Geçerli bir e-posta adresi girin.'
    if (!password) fe.password = 'Şifrenizi girin.'
    setFieldErrors(fe)
    if (Object.keys(fe).length) return
    setBusy(true)
    setError(null)
    const res = await signIn(email, password)
    setBusy(false)
    if (res.error) {
      setError(res.error)
      setPassword('')
    }
  }

  return (
    <AuthShell>
      <div className="mb-8">
        <span className="brushed grid h-12 w-12 place-items-center rounded-2xl shadow-[0_1px_0_rgb(255_255_255/0.7)_inset,0_6px_14px_-8px_rgb(16_24_40/0.45)]">
          <LockKeyhole className="h-5 w-5 text-anthracite" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-[26px] font-semibold tracking-[-0.015em] text-ink">Giriş yap</h1>
        <p className="mt-1.5 text-sm text-muted">LEONX OS hesabınızla oturum açın.</p>
      </div>

      {signOutReason === 'expired' && !error && (
        <FormAlert tone="warn">Oturumunuzun süresi doldu veya başka bir cihazdan kapatıldı. Lütfen tekrar giriş yapın.</FormAlert>
      )}
      {error && <FormAlert>{error}</FormAlert>}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label="E-posta"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          required
          disabled={busy}
        />
        <div className="relative">
          <TextField
            label="Şifre"
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
            required
            disabled={busy}
            className="[&_input]:pr-12"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute top-[30px] right-1.5 grid h-9 w-9 place-items-center rounded-lg text-muted hover:text-ink"
            aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="mt-2 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-ink shadow-card transition hover:bg-primary-hover active:scale-[0.99] disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogIn className="h-4 w-4" aria-hidden="true" />}
          {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
        </button>
      </form>

      <p className="mt-8 border-t border-line pt-5 text-xs leading-relaxed text-subtle">
        Bu sistemde yeni hesap oluşturulamaz. Şifrenizi unuttuysanız Supabase panelinde Authentication → Users bölümünden
        sıfırlayabilirsiniz.
      </p>
    </AuthShell>
  )
}
