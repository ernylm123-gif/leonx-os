/**
 * LEONX Radar — firma iletişim araştırması (Edge Function "radar-contacts").
 *
 * Firmanın KENDİ sitesinde (kanıttan gelen veya sahibin girdiği adres; firma adından TAHMİN EDİLMEZ)
 * ana sayfa + yaygın iletişim/tedarikçi yolları + sayfalardaki aynı alan adlı iletişim bağlantıları
 * (en çok 8 sayfa) incelenir. robots.txt ve SSRF kuralları uygulanır; adres üretilmez.
 */
import { COMMON_CONTACT_PATHS, type ExtractedContact, extractContacts, siteDomain } from './contacts.ts'
import { isAllowed, policyForStatus } from './robots.ts'
import { GuardError, HTML_TYPES, safeFetch, type SafeFetchDeps, TEXT_TYPES } from './urlGuard.ts'

export interface ContactResearchResult {
  pages: { url: string; status: number | null; note: string | null }[]
  contacts: ExtractedContact[]
  skippedPersonal: number
  skippedForeignDomain: number
  skippedIrrelevant: number
}

export async function researchCompanyContacts(website: string, deps: SafeFetchDeps & { now: () => Date }, maxPages = 8): Promise<ContactResearchResult> {
  const res: ContactResearchResult = { pages: [], contacts: [], skippedPersonal: 0, skippedForeignDomain: 0, skippedIrrelevant: 0 }
  let home: URL
  try {
    home = new URL(website)
  } catch {
    return res
  }
  const base = siteDomain(website)
  if (!base || home.protocol !== 'https:') return res
  const policy = { allowedHosts: [...new Set([home.hostname.toLowerCase(), base, `www.${base}`])] }
  const rb = await safeFetch(`https://${home.hostname}/robots.txt`, { policy, accept: [...TEXT_TYPES, ...HTML_TYPES, 'application/octet-stream'] }, deps).catch((e) =>
    e instanceof GuardError && e.code === 'icerik_turu' ? { status: 200, body: '' } : { status: 503, body: '' },
  )
  const robots = policyForStatus(rb.status, rb.body)
  const queue = [home.toString(), ...COMMON_CONTACT_PATHS.map((p) => new URL(p, home).toString())]
  const seen = new Set<string>()
  const verifiedAt = deps.now().toISOString()
  while (queue.length && res.pages.length < maxPages) {
    const url = queue.shift()!
    if (seen.has(url)) continue
    seen.add(url)
    const u = new URL(url)
    if (!isAllowed(robots, u.pathname + u.search)) {
      res.pages.push({ url, status: null, note: 'robots.txt izin vermiyor' })
      continue
    }
    try {
      const r = await safeFetch(url, { policy, accept: HTML_TYPES }, deps)
      if (r.status < 200 || r.status >= 300) {
        res.pages.push({ url, status: r.status, note: null })
        continue
      }
      res.pages.push({ url: r.finalUrl, status: r.status, note: null })
      const ex = extractContacts(r.body, r.finalUrl, website, verifiedAt)
      res.skippedPersonal += ex.skippedPersonal
      res.skippedForeignDomain += ex.skippedForeignDomain
      res.skippedIrrelevant += ex.skippedIrrelevant
      for (const c of ex.contacts) if (!res.contacts.some((x) => x.kind === c.kind && x.value === c.value)) res.contacts.push(c)
      for (const l of ex.followLinks) if (!seen.has(l)) queue.unshift(l)
    } catch (e) {
      res.pages.push({ url, status: null, note: e instanceof Error ? e.message.slice(0, 200) : 'hata' })
    }
  }
  return res
}
