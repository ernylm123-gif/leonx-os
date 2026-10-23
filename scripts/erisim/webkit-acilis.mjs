// Production'ı WebKit ile (Safari'nin motoru) iPhone emülasyonunda açar. Gerçek iOS Safari DEĞİLDİR:
// TLS yığını Linux WebKit'indir; iOS'a özgü ağ/sertifika davranışını kanıtlamaz.
import { devices, webkit } from 'playwright'

const BASE = process.env.ERISIM_URL || 'https://leonx-os.vercel.app'
const browser = await webkit.launch()
let failed = false
for (const name of ['iPhone 15', 'iPad Pro 11']) {
  const ctx = await browser.newContext({ ...devices[name] })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`))
  try {
    const res = await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 })
    const sec = await res?.securityDetails()
    console.log(`[${name}] HTTP ${res?.status()} · TLS ${sec?.protocol ?? '?'} · sertifika: ${sec?.subjectName ?? '?'} / ${sec?.issuer ?? '?'} · geçerlilik bitişi: ${sec?.validTo ? new Date(sec.validTo * 1000).toISOString() : '?'}`)
    await page.waitForTimeout(2500)
    console.log(`[${name}] başlık: ${await page.title()} · görünen metin: ${(await page.locator('body').innerText()).slice(0, 120).replace(/\s+/g, ' ')}`)
    const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest', { cache: 'no-store' })).json())
    console.log(`[${name}] manifest start_url=${manifest.start_url} scope=${manifest.scope} display=${manifest.display}`)
    const sw = await page.evaluate(async () => ('serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope) : 'yok'))
    console.log(`[${name}] service worker kayıtları: ${JSON.stringify(sw)}`)
    for (const e of errors) console.log(`[${name}] ${e}`)
  } catch (e) {
    failed = true
    console.log(`[${name}] AÇILAMADI: ${e.message}`)
  }
  await ctx.close()
}
await browser.close()
process.exit(failed ? 1 : 0)
