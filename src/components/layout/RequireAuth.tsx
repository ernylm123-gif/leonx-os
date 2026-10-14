import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { DataProvider } from '@/context/data'
import { NotificationsProvider } from '@/context/notifications'
import { useAuth } from '@/context/auth'
import { AuthSplash, NotAuthorizedPage, OwnerCheckFailedPage } from '@/pages/auth/AccessPages'
import { SetupRequiredPage } from '@/pages/auth/SetupRequiredPage'

/**
 * Özel sayfaların koruması. Arayüz yalnızca oturum açmış ve veritabanında yetkili sahip
 * olarak doğrulanmış kullanıcıya gösterilir. Veri erişimi ayrıca RLS ile korunur.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, session } = useAuth()
  const location = useLocation()

  switch (status) {
    case 'unconfigured':
      return <SetupRequiredPage />
    case 'loading':
      return <AuthSplash />
    case 'signed_out': {
      const next = location.pathname + location.search
      return <Navigate to={next === '/' ? '/giris' : `/giris?next=${encodeURIComponent(next)}`} replace />
    }
    case 'checking_owner':
      return <AuthSplash label="Yetki doğrulanıyor…" />
    case 'not_owner':
      return <NotAuthorizedPage />
    case 'owner_check_failed':
      return <OwnerCheckFailedPage />
    case 'owner':
      // Kullanıcı değişirse veri deposu sıfırdan kurulur
      return (
        <DataProvider key={session?.user.id}>
          <NotificationsProvider>{children}</NotificationsProvider>
        </DataProvider>
      )
  }
}
