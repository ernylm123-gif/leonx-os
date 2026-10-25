import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NOW } from './__fixtures__/synthetic_items.ts'
import { researchCompanyContacts } from './research.ts'

const html = readFileSync(new URL('./__fixtures__/synthetic_company_site.html', import.meta.url), 'utf-8')

describe('iletişim araştırması (sentetik firma sitesi)', () => {
  it('robots, yalnız aynı alan adı, en çok 8 sayfa; kişisel e-posta saklanmaz', async () => {
    const calls: string[] = []
    const r = await researchCompanyContacts('https://ornekyapi.test', {
      now: () => NOW,
      fetch: async (url) => {
        calls.push(url)
        if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /ihaleler', { status: 200, headers: { 'content-type': 'text/plain' } })
        if (url === 'https://ornekyapi.test/iletisim') return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
        return new Response('yok', { status: 404, headers: { 'content-type': 'text/html' } })
      },
    })
    expect(r.contacts.map((c) => c.value)).toContain('satinalma@ornekyapi.test')
    expect(r.contacts.some((c) => c.value.includes('ahmet'))).toBe(false)
    expect(r.skippedPersonal).toBe(2)
    expect(r.pages.length).toBeLessThanOrEqual(8)
    expect(calls.some((u) => u.includes('/ihaleler'))).toBe(false)
    expect(calls.every((u) => new URL(u).hostname === 'ornekyapi.test')).toBe(true)
    expect(r.contacts.every((c) => c.source_url.startsWith('https://ornekyapi.test/') && c.verified_at === NOW.toISOString())).toBe(true)
  })
  it('geçersiz veya https olmayan site araştırılmaz', async () => {
    const deps = { now: () => NOW, fetch: async () => { throw new Error('çağrılmamalı') } }
    expect((await researchCompanyContacts('http://ornekyapi.test', deps)).pages).toEqual([])
    expect((await researchCompanyContacts('firma adı', deps)).pages).toEqual([])
  })
})
