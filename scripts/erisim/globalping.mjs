// Türkiye'deki gerçek ağlardan (operatör bazında) DNS ve HTTPS ölçümü — Globalping açık API'si
// (https://globalping.io, anahtarsız kullanım sınırları dahilinde). Karşılaştırma için Almanya da ölçülür.
// Yalnız okur; production'a yazmaz.
const API = 'https://api.globalping.io/v1/measurements'
const HOST = process.env.HOST || 'leonx-os.vercel.app'

async function measure(body) {
  const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`Globalping ${r.status}: ${await r.text()}`)
  const { id } = await r.json()
  for (let i = 0; i < 30; i++) {
    await new Promise((s) => setTimeout(s, 2000))
    const m = await (await fetch(`${API}/${id}`)).json()
    if (m.status !== 'in-progress') return m
  }
  throw new Error('Globalping zaman aşımı')
}

const where = (p) => `${p.probe.country}/${p.probe.city} AS${p.probe.asn} ${p.probe.network}`

async function http(target, locations, limit, path = '/version.json') {
  const m = await measure({
    type: 'http',
    target,
    locations,
    limit,
    measurementOptions: { protocol: 'HTTPS', request: { method: 'GET', path } },
  })
  for (const p of m.results) {
    const res = p.result
    const tls = res.tls ? `${res.tls.protocol ?? ''} ${res.tls.authorized === false ? 'YETKİSİZ:' + (res.tls.error ?? '') : 'sertifika geçerli'} bitiş=${res.tls.expiresAt ?? '?'}` : 'TLS yok'
    console.log(`  ${where(p)} → ${res.status} HTTP ${res.statusCode ?? '-'} · ${tls} · ip=${res.resolvedAddress ?? '-'}${res.rawOutput && res.status !== 'finished' ? ' · ' + String(res.rawOutput).slice(0, 160) : ''}`)
  }
}

async function dns(target, locations, limit) {
  const m = await measure({ type: 'dns', target, locations, limit, measurementOptions: { query: { type: 'A' } } })
  for (const p of m.results) {
    const ans = (p.result.answers ?? []).map((a) => `${a.type} ${a.value}`).join(', ')
    console.log(`  ${where(p)} → ${p.result.status} · ${ans || 'yanıt yok'} · çözücü=${p.result.resolver ?? '-'}`)
  }
}

const TR = [
  { magic: 'AS9121' }, // Türk Telekom
  { magic: 'AS34984' }, // Superonline / Turkcell
  { magic: 'AS16135' }, // Turkcell mobil
  { magic: 'AS15897' }, // Vodafone TR
  { country: 'TR' },
]

async function probes() {
  const r = await fetch('https://api.globalping.io/v1/probes')
  const all = await r.json()
  const tr = all.filter((p) => p.location.country === 'TR')
  console.log(`  Türkiye'de ${tr.length} prob`)
  for (const p of tr) console.log(`  ${p.location.city} AS${p.location.asn} ${p.location.network} [${(p.tags ?? []).join(',')}]`)
}

let failed = false
for (const [title, fn] of [
  ['Türkiye prob listesi', probes],
  [`HTTPS ${HOST} — Turkcell mobil (AS16135)`, () => http(HOST, [{ magic: 'AS16135' }], 10, '/')],
  [`HTTPS ${HOST} — Vodafone TR (AS15897)`, () => http(HOST, [{ magic: 'AS15897' }], 10, '/')],
  [`HTTPS ${HOST} — Türk Telekom (AS9121)`, () => http(HOST, [{ magic: 'AS9121' }], 10, '/')],
  [`HTTPS ${HOST} — Superonline (AS34984)`, () => http(HOST, [{ magic: 'AS34984' }], 10, '/')],
  [`HTTPS ${HOST} — Türkiye (tümü, 30)`, () => http(HOST, [{ country: 'TR' }], 30, '/')],
  [`DNS ${HOST} — Türkiye`, () => dns(HOST, TR, 8)],
  [`HTTPS ${HOST} — Türkiye`, () => http(HOST, TR, 8)],
  [`HTTPS vercel.com — Türkiye (karşılaştırma)`, () => http('vercel.com', TR, 6, '/')],
  [`HTTPS ${HOST} — Almanya (karşılaştırma)`, () => http(HOST, [{ country: 'DE' }], 2)],
]) {
  console.log(`== ${title}`)
  try {
    await fn()
  } catch (e) {
    failed = true
    console.log(`  ölçüm yapılamadı: ${e.message}`)
  }
}
process.exit(failed ? 1 : 0)
