import { describe, expect, it } from 'vitest'
import { parseSupabaseConfig } from './supabaseConfig'

const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.imza`

describe('parseSupabaseConfig', () => {
  it('eksik değişkenleri bildirir', () => {
    const r = parseSupabaseConfig({})
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('missing')
      expect(r.missing).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'])
    }
  })

  it('publishable anahtarı kabul eder', () => {
    const r = parseSupabaseConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co/', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xyz' })
    expect(r).toEqual({ ok: true, url: 'https://abc.supabase.co', key: 'sb_publishable_xyz' })
  })

  it('eski anon JWT anahtarını kabul eder', () => {
    const r = parseSupabaseConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'anon' }) })
    expect(r.ok).toBe(true)
  })

  it('sb_secret_ anahtarını reddeder', () => {
    const r = parseSupabaseConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_123' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('secret_key')
  })

  it('service_role JWT anahtarını reddeder', () => {
    const r = parseSupabaseConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'service_role' }) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('secret_key')
  })

  it('http ve geçersiz adresleri reddeder', () => {
    expect(parseSupabaseConfig({ VITE_SUPABASE_URL: 'http://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }).ok).toBe(false)
    expect(parseSupabaseConfig({ VITE_SUPABASE_URL: 'abc', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }).ok).toBe(false)
  })

  it('tanınmayan anahtar biçimini reddeder', () => {
    const r = parseSupabaseConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'rastgele' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_key')
  })
})
