import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parseSupabaseConfig, type SupabaseConfigResult } from './supabaseConfig'

/** Ortam değişkenlerinden okunan bağlantı durumu (Vercel → Environment Variables). */
export const supabaseConfig: SupabaseConfigResult = parseSupabaseConfig({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
})

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
        storageKey: 'leonx-os-auth',
      },
    })
  : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase yapılandırılmamış')
  return supabase
}
