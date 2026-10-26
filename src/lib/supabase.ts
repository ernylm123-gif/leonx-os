import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchWithTimeout } from './fetchTimeout'
import { parseSupabaseConfig, type SupabaseConfigResult } from './supabaseConfig'

/** Ortam değişkenlerinden okunan bağlantı durumu (Vercel → Environment Variables). */
export const supabaseConfig: SupabaseConfigResult = parseSupabaseConfig({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
})

export const AUTH_STORAGE_KEY = 'leonx-os-auth'

/**
 * Açılışta bu cihazda kayıtlı bir oturum var mıydı? İstemci oturumu yenileyemeyip silerse
 * (süresi dolmuş / başka cihazdan kapatılmış) giriş ekranı nedenini söyleyebilsin diye
 * istemci oluşturulmadan ÖNCE okunur.
 */
export const storedSessionAtBoot: boolean = (() => {
  try {
    return typeof localStorage !== 'undefined' && !!localStorage.getItem(AUTH_STORAGE_KEY)
  } catch {
    return false
  }
})()

/**
 * Uygulamanın tek Supabase istemcisi. Yapılandırma eksik/hatalıysa null'dır;
 * bu durumda uygulama kurulum ekranını gösterir ve hiçbir istek göndermez.
 */
export const supabase: SupabaseClient | null = supabaseConfig.ok
  ? createClient(supabaseConfig.url, supabaseConfig.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: AUTH_STORAGE_KEY,
      },
      global: { fetch: fetchWithTimeout() },
    })
  : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase yapılandırılmamış')
  return supabase
}
