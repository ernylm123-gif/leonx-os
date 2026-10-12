import { Loader2, LogOut, RotateCw, ShieldX, WifiOff } from 'lucide-react'
import { AuthShell } from '@/components/layout/AuthShell'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/context/auth'

export function AuthSplash({ label = 'Oturum kontrol ediliyor…' }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas" role="status">
      <div className="flex flex-col items-center gap-4">
        <img src="/branding/leonx-symbol.png" width={96} height={67} alt="LEONX" className="rounded-xl border border-plate-line bg-plate p-3" />
        <span className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {label}
        </span>
      </div>
    </div>
  )
}

/** Geçerli Supabase hesabı var ama yetkili sahip değil: veriye erişim yok. */
export function NotAuthorizedPage() {
  const { session, signOut } = useAuth()
  return (
    <AuthShell>
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-danger-soft">
        <ShieldX className="h-5 w-5 text-danger" aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-[26px] font-semibold tracking-[-0.015em] text-ink">Bu hesap yetkili değil</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        <b className="text-ink-2">{session?.user.email}</b> ile giriş yapıldı, ancak bu hesap LEONX OS'un yetkili kullanıcısı
        olarak tanımlı değil. Hiçbir kayda erişilemez.
      </p>
      <p className="mt-3 text-xs leading-relaxed text-subtle">
        Bu sizin hesabınızsa: README'deki "Yetkili kullanıcıyı tanımlama" adımında bu hesabın User UID değerini
        <code className="mx-1 rounded bg-surface-2 px-1">supabase/setup/01_set_owner.sql</code>ile kaydedin.
      </p>
      <Button variant="primary" icon={LogOut} onClick={() => void signOut()} className="mt-8 h-12">
        Çıkış yap
      </Button>
    </AuthShell>
  )
}

export function OwnerCheckFailedPage() {
  const { ownerError, retryOwnerCheck, signOut } = useAuth()
  return (
    <AuthShell>
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-warn-soft">
        <WifiOff className="h-5 w-5 text-warn" aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-[26px] font-semibold tracking-[-0.015em] text-ink">Yetki doğrulanamadı</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">{ownerError}</p>
      <div className="mt-8 flex flex-col gap-2 sm:flex-row">
        <Button variant="primary" icon={RotateCw} onClick={retryOwnerCheck} className="h-12 flex-1">
          Tekrar dene
        </Button>
        <Button variant="secondary" icon={LogOut} onClick={() => void signOut('local')} className="h-12">
          Çıkış yap
        </Button>
      </div>
    </AuthShell>
  )
}
