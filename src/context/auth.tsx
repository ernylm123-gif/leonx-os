import type { Session } from '@supabase/supabase-js'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { checkIsOwner } from '@/data/api'
import { authErrorMessage, dataErrorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

/**
 * Oturum durumu. Yetkilendirmenin asıl kaynağı veritabanıdır (RLS + is_owner());
 * buradaki kontrol yalnızca doğru ekranı göstermek içindir.
 */
export type AuthStatus =
  | 'unconfigured' // ortam değişkenleri eksik/hatalı
  | 'loading' // oturum okunuyor
  | 'signed_out'
  | 'checking_owner'
  | 'owner'
  | 'not_owner' // geçerli hesap, yetkili sahip değil
  | 'owner_check_failed' // ağ veya kurulum hatası

export type SignOutReason = 'manual' | 'expired' | null

interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  /** owner_check_failed durumunda kullanıcıya gösterilecek ileti */
  ownerError: string | null
  signOutReason: SignOutReason
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: (scope?: 'local' | 'global') => Promise<void>
  retryOwnerCheck: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<AuthStatus>(supabase ? 'loading' : 'unconfigured')
  const [ownerError, setOwnerError] = useState<string | null>(null)
  const [signOutReason, setSignOutReason] = useState<SignOutReason>(null)
  const manualSignOut = useRef(false)
  const hadSession = useRef(false)
  const checkedFor = useRef<string | null>(null)

  const verifyOwner = useCallback(async (userId: string) => {
    if (!supabase) return
    checkedFor.current = userId
    setStatus('checking_owner')
    setOwnerError(null)
    try {
      const ok = await checkIsOwner(supabase)
      if (checkedFor.current !== userId) return
      setStatus(ok ? 'owner' : 'not_owner')
    } catch (e) {
      if (checkedFor.current !== userId) return
      setOwnerError(dataErrorMessage(e, 'Yetki kontrolü'))
      setStatus('owner_check_failed')
    }
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      setSession(next)
      if (!next) {
        checkedFor.current = null
        // Kullanıcı çıkış yapmadıysa oturum süresi dolmuş / yenilenememiştir
        if (hadSession.current) setSignOutReason(manualSignOut.current ? 'manual' : 'expired')
        manualSignOut.current = false
        hadSession.current = false
        setStatus('signed_out')
        return
      }
      hadSession.current = true
      // Belirteç yenilemesi (TOKEN_REFRESHED) veya aynı kullanıcı: yeniden doğrulama gerekmez
      if (checkedFor.current === next.user.id) return
      // onAuthStateChange içinde doğrudan Supabase çağrısı yapılmaz (kilitlenme önlemi)
      setTimeout(() => void verifyOwner(next.user.id), 0)
    })

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (!data.session) setStatus((s) => (s === 'loading' ? 'signed_out' : s))
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [verifyOwner])

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return { error: 'Supabase yapılandırılmamış.' }
    setSignOutReason(null)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      return { error: error ? authErrorMessage(error) : null }
    } catch (e) {
      return { error: authErrorMessage(e) }
    }
  }, [])

  const signOut = useCallback(async (scope: 'local' | 'global' = 'local') => {
    if (!supabase) return
    manualSignOut.current = true
    const { error } = await supabase.auth.signOut({ scope })
    // Sunucuya ulaşılamasa bile yerel oturum temizlenir
    if (error) await supabase.auth.signOut({ scope: 'local' })
  }, [])

  const retryOwnerCheck = useCallback(() => {
    if (session) void verifyOwner(session.user.id)
  }, [session, verifyOwner])

  const value = useMemo(
    () => ({ status, session, ownerError, signOutReason, signIn, signOut, retryOwnerCheck }),
    [status, session, ownerError, signOutReason, signIn, signOut, retryOwnerCheck],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalıdır')
  return ctx
}
