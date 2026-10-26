// LEONX OS — production sağlık kontrolü (komut satırı). Yalnız okur.
//
//   node scripts/izleme/saglik.mjs [--origin https://leonx-os.vercel.app] [--expect-commit <sha>]
//                                  [--no-http] [--tr-probes] [--out sonuc.json]
//
// Ortam: VERCEL_AUTOMATION_BYPASS_SECRET (isteğe bağlı) — korumalı dağıtım adresini (önizleme /
// yayın öncesi) test etmek için Vercel "Protection Bypass for Automation" anahtarı.
// Geçici ağ dalgalanmasında yanlış alarm olmasın diye başarısız kontrol 3 kez (20 sn arayla) denenir.
import { writeFileSync, appendFileSync } from 'node:fs'
import tls from 'node:tls'
import { daysLeft, runChecks } from './kontroller.mjs'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : def
}
const origin = opt('--origin', process.env.LEONX_ORIGIN || 'https://leonx-os.vercel.app')
const expectCommit = opt('--expect-commit', '') || undefined
const out = opt('--out', '')
const attempts = Number(opt('--attempts', '3'))
const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}
const host = new URL(origin).host
const CERT_MIN_DAYS = 14

function certInfo() {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 15000 }, () => {
      const c = s.getPeerCertificate()
      resolve({ ok: s.authorized, error: s.authorizationError ? String(s.authorizationError) : null, protocol: s.getProtocol(), validTo: c.valid_to, issuer: c.issuer?.CN, subject: c.subject?.CN })
      s.end()
    })
    s.on('timeout', () => {
      s.destroy()
      resolve({ ok: false, error: 'TLS el sıkışması zaman aşımı' })
    })
    s.on('error', (e) => resolve({ ok: false, error: `${e.code ?? ''} ${e.message}`.trim() }))
  })
}

const timedFetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) })

async function once() {
  const sorunlar = []
  const cert = await certInfo()
  if (!cert.ok) sorunlar.push({ kod: 'tls', mesaj: `TLS/sertifika hatası: ${cert.error}` })
  else if (daysLeft(cert.validTo) < CERT_MIN_DAYS) sorunlar.push({ kod: 'sertifika_bitiyor', mesaj: `Sertifika ${daysLeft(cert.validTo)} gün içinde bitiyor (${cert.validTo})` })
  let bilgi = {}
  try {
    const r = await runChecks({ origin, fetchImpl: timedFetch, headers, expectCommit, checkHttpRedirect: !args.includes('--no-http') })
    sorunlar.push(...r.sorunlar)
    bilgi = r.bilgi
  } catch (e) {
    sorunlar.push({ kod: 'erisim', mesaj: `${origin} erişilemedi: ${e.cause?.code ?? ''} ${e.message}`.trim() })
  }
  return { sorunlar, bilgi, cert }
}

/** Türkiye'deki ağlardan bilgi amaçlı ölçüm (Globalping, anahtarsız). Prob yoksa veya API kapalıysa alarm üretmez. */
async function trProbes() {
  try {
    const api = 'https://api.globalping.io/v1/measurements'
    const r = await fetch(api, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'http', target: host, locations: [{ country: 'TR' }], limit: 8, measurementOptions: { protocol: 'HTTPS', request: { method: 'HEAD', path: '/' } } }),
    })
    if (!r.ok) return { atlandi: `Globalping ${r.status}` }
    const { id } = await r.json()
    for (let i = 0; i < 20; i++) {
      await new Promise((s) => setTimeout(s, 2000))
      const m = await (await fetch(`${api}/${id}`)).json()
      if (m.status === 'in-progress') continue
      const rows = m.results.map((p) => ({ ag: `${p.probe.city} AS${p.probe.asn} ${p.probe.network}`, ok: p.result.status === 'finished' && p.result.statusCode < 400, durum: p.result.statusCode ?? p.result.status }))
      return { rows, basarisiz: rows.filter((x) => !x.ok).length }
    }
    return { atlandi: 'Globalping zaman aşımı' }
  } catch (e) {
    return { atlandi: e.message }
  }
}

let result
for (let i = 1; i <= attempts; i++) {
  result = await once()
  if (!result.sorunlar.length) break
  if (i < attempts) {
    console.log(`Deneme ${i}: ${result.sorunlar.length} sorun; 20 sn sonra yeniden denenecek`)
    await new Promise((s) => setTimeout(s, 20000))
  }
}
const tr = args.includes('--tr-probes') ? await trProbes() : null
// Türkiye'deki probların çoğu başarısızsa (sunucu sağlam görünse bile) bölgesel erişim sorunu alarmı
if (tr?.rows?.length >= 4 && tr.basarisiz / tr.rows.length >= 0.5) {
  result.sorunlar.push({ kod: 'turkiye_erisim', mesaj: `Türkiye ağlarından ${tr.rows.length} ölçümün ${tr.basarisiz} tanesi başarısız` })
}

const ok = result.sorunlar.length === 0
const lines = [
  `### ${ok ? '✅' : '❌'} ${origin}`,
  '',
  `- Sürüm: ${result.bilgi.surum ?? '—'} (${result.bilgi.commit ?? '—'})`,
  `- TLS: ${result.cert.protocol ?? '—'} · ${result.cert.subject ?? ''} / ${result.cert.issuer ?? ''} · bitiş ${result.cert.validTo ?? '—'}`,
  `- Kontrol edilen paket: ${result.bilgi.paketler ?? 0}`,
  ...(result.sorunlar.length ? ['', '**Sorunlar**', ...result.sorunlar.map((s) => `- \`${s.kod}\` ${s.mesaj}`)] : []),
  ...(tr ? ['', `**Türkiye ölçümü** ${tr.atlandi ? `(atlandı: ${tr.atlandi})` : `${tr.rows.length - tr.basarisiz}/${tr.rows.length} başarılı`}`, ...(tr.rows ?? []).map((x) => `- ${x.ok ? '✓' : '✗'} ${x.ag} → ${x.durum}`)] : []),
]
console.log(lines.join('\n'))
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
if (out) writeFileSync(out, JSON.stringify({ ok, origin, ...result, tr, rapor: lines.join('\n') }, null, 2))
process.exit(ok ? 0 : 1)
