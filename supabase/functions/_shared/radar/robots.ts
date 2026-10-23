/**
 * LEONX Radar — asgari robots.txt ayrıştırıcı (site türü kaynaklar ve iletişim araştırması için).
 *
 * • Önce "LEONX-Radar" kullanıcı aracısına özel grup aranır; yoksa "*" grubu kullanılır.
 * • Allow/Disallow kurallarında en uzun eşleşme kazanır; eşit uzunlukta Allow önceliklidir.
 * • "*" joker ve satır sonu "$" desteklenir.
 * • robots.txt alınamazsa (404) her şey serbest; 401/403/5xx ise tedbiren her şey yasak sayılır.
 */

export const ROBOTS_AGENT = 'leonx-radar'

interface Rule {
  allow: boolean
  pattern: string
}

export interface RobotsPolicy {
  rules: Rule[]
  /** Saniye cinsinden tarama gecikmesi (varsa) */
  crawlDelay: number | null
  /** Hangi grup uygulandı: 'ozel' (LEONX-Radar), 'genel' (*), 'yok' */
  group: 'ozel' | 'genel' | 'yok'
}

export function parseRobots(text: string): RobotsPolicy {
  const groups: { agents: string[]; rules: Rule[]; delay: number | null }[] = []
  let cur: { agents: string[]; rules: Rule[]; delay: number | null } | null = null
  let lastWasAgent = false
  for (const rawLine of text.slice(0, 500_000).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [], delay: null }
        groups.push(cur)
      }
      cur.agents.push(val.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!cur) continue
    if (key === 'allow' || key === 'disallow') {
      if (key === 'disallow' && val === '') continue // boş Disallow = her şey serbest
      cur.rules.push({ allow: key === 'allow', pattern: val })
    } else if (key === 'crawl-delay') {
      const n = Number(val)
      if (Number.isFinite(n) && n >= 0) cur.delay = n
    }
  }
  const own = groups.filter((g) => g.agents.some((a) => a.replace(/\/.*$/, '') === ROBOTS_AGENT))
  if (own.length) return { rules: own.flatMap((g) => g.rules), crawlDelay: own.find((g) => g.delay != null)?.delay ?? null, group: 'ozel' }
  const star = groups.filter((g) => g.agents.includes('*'))
  if (star.length) return { rules: star.flatMap((g) => g.rules), crawlDelay: star.find((g) => g.delay != null)?.delay ?? null, group: 'genel' }
  return { rules: [], crawlDelay: null, group: 'yok' }
}

function patternToRegex(p: string): RegExp {
  const anchored = p.endsWith('$')
  const body = (anchored ? p.slice(0, -1) : p)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp('^' + body + (anchored ? '$' : ''))
}

/** Yol (+ sorgu) robots kurallarına göre izinli mi */
export function isAllowed(policy: RobotsPolicy, pathAndQuery: string): boolean {
  let best: Rule | null = null
  for (const r of policy.rules) {
    if (!patternToRegex(r.pattern).test(pathAndQuery)) continue
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow && !best.allow)) best = r
  }
  return best ? best.allow : true
}

/** robots.txt HTTP durumuna göre politika (404/410 → serbest; 401/403/5xx → tümü yasak) */
export function policyForStatus(status: number, body: string): RobotsPolicy {
  if (status >= 200 && status < 300) return parseRobots(body)
  if (status === 404 || status === 410) return { rules: [], crawlDelay: null, group: 'yok' }
  return { rules: [{ allow: false, pattern: '/' }], crawlDelay: null, group: 'yok' }
}
