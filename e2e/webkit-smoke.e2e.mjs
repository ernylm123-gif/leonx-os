/**
 * LEONX OS — WebKit mobil duman testi (emülasyon — gerçek iOS değil)
 *
 * Playwright WebKit (Safari'nin motoru, Linux derlemesi) + "iPhone 15" cihaz tanımıyla küçük bir
 * alt küme: giriş → dashboard → form (kayıt). Gerçek iOS Safari'nin ağ/TLS yığınını, ana ekran
 * uygulamasını veya iOS'a özgü kısıtları KANITLAMAZ; yalnız WebKit'te uygulamanın açıldığını ve
 * temel akışların çalıştığını gösterir. Sahte Supabase arka ucu kullanılır (e2e/mock-supabase.mjs).
 *
 * Çalıştırma: npx playwright install --with-deps webkit && node e2e/webkit-smoke.e2e.mjs
 *   E2E_SKIP_BUILD=1      → mevcut dist-e2e klasörünü kullan (npm run test:e2e ile derlenmiş)
 *   E2E_SMOKE_BROWSER=chromium → WebKit kurulamayan ortamda betiğin kendisini denemek için
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices, webkit } from 'playwright'
import { MockSupabase, OWNER, SUPABASE_URL } from './mock-supabase.mjs'
import { startStaticServer } from './static-server.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.E2E_PORT ?? 4191)
const BASE = `http://localhost:${PORT}`
const ENGINE = process.env.E2E_SMOKE_BROWSER === 'chromium' ? 'chromium' : 'webkit'
const DEVICE = 'iPhone 15'
const LABEL = `${ENGINE === 'webkit' ? 'WebKit' : 'Chromium'} · ${DEVICE} (emülasyon — gerçek iOS değil)`

if (!process.env.E2E_SKIP_BUILD) {
  const env = { ...process.env, VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_test_key', VITE_CAD_WORKER_URL: '/cad-worker' }
  execSync('npx vite build --outDir dist-e2e --emptyOutDir --logLevel error', { cwd: ROOT, env, stdio: 'inherit' })
}
const server = await startStaticServer(path.join(ROOT, 'dist-e2e'), PORT, path.join(ROOT, 'vercel.json'))
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch()
const { defaultBrowserType: _ignored, ...device } = devices[DEVICE]
const results = []

function expect(cond, msg) {
  if (!cond) throw new Error(msg)
}
async function test(name, fn) {
  const ctx = await browser.newContext({ ...device })
  const page = await ctx.newPage()
  const mock = new MockSupabase()
  await mock.attach(page)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    await fn({ page, mock, errors })
    results.push({ name, ok: true })
    console.log(`  ✓ ${name}`)
  } catch (e) {
    results.push({ name, ok: false })
    console.log(`  ✗ ${name}\n      ${String(e.message || e).split('\n').slice(0, 6).join('\n      ')}`)
  } finally {
    await ctx.close()
  }
}
async function login(page, next) {
  await page.goto(`${BASE}/giris?next=${encodeURIComponent(next)}`)
  await page.getByLabel('E-posta').fill(OWNER.email)
  await page.locator('input[name="password"]').fill(OWNER.password)
  await page.getByRole('button', { name: 'Giriş yap' }).click()
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)

console.log(`\nLEONX OS — mobil duman testi: ${LABEL}\n`)

await test('Giriş ekranı açılır, açılış koruması "açıldı" bilgisini alır, yatay taşma yok', async ({ page, errors }) => {
  await page.goto(`${BASE}/`)
  await page.getByRole('heading', { name: 'Giriş yap' }).waitFor()
  expect(page.url().endsWith('/giris'), `yönlendirme: ${page.url()}`)
  const st = await page.evaluate(() => window.__LEONX_BOOT_GUARD__ && window.__LEONX_BOOT_GUARD__.state())
  expect(st && st.booted && st.shownCount === 0, `açılış koruması durumu: ${JSON.stringify(st)}`)
  expect(!(await overflow(page)), 'giriş ekranı yatay taşıyor')
  const fs = await page.getByLabel('E-posta').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(fs >= 16, `iOS yakınlaşmasını önlemek için giriş alanı ≥16px olmalı (${fs})`)
  expect(errors.length === 0, `sayfa hataları: ${errors.join(' | ')}`)
})

await test('Giriş → dashboard; anlık senkronizasyon canlı', async ({ page, mock }) => {
  mock.externalInsert('projects', { code: 'LX-2026-901', name: 'Mobil duman projesi', category: 'diger' })
  await login(page, '/')
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor()
  await page.getByText('Mobil duman projesi').first().waitFor()
  const deadline = Date.now() + 8000
  while (mock.activeChannelCount !== 1 && Date.now() < deadline) await page.waitForTimeout(100)
  expect(mock.activeChannelCount === 1, 'Realtime kanalı açılmadı')
  expect(!(await overflow(page)), 'dashboard yatay taşıyor')
})

await test('Form: firma ekle (doğrulama + kayıt) ve proje formu ekrana sığar', async ({ page, mock }) => {
  await login(page, '/firmalar')
  await page.getByRole('heading', { name: 'Henüz firma yok' }).waitFor()
  await page.getByRole('button', { name: 'Firma ekle' }).first().click()
  const d = page.getByRole('dialog', { name: 'Yeni firma' })
  await d.getByRole('button', { name: 'Firmayı ekle' }).click()
  await d.getByText('Firma adı zorunludur.').waitFor()
  await d.getByLabel('Firma adı').fill('Mobil Duman Alüminyum')
  await d.getByRole('button', { name: 'Firmayı ekle' }).click()
  await page.getByRole('heading', { name: 'Mobil Duman Alüminyum' }).waitFor()
  expect(mock.db.companies.length === 1, 'kayıt sunucuya yazılmadı')
  await page.goto(`${BASE}/projeler`)
  await page.getByRole('button', { name: 'Yeni proje' }).first().click()
  const p = page.getByRole('dialog', { name: 'Yeni proje' })
  await p.waitFor()
  const box = await p.getByRole('button', { name: 'Projeyi oluştur' }).boundingBox()
  expect(box && box.y + box.height <= device.viewport.height + 1, 'kaydet düğmesi ekran dışında')
  expect(!(await overflow(page)), 'form açıkken yatay taşma')
})

await browser.close()
server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${LABEL}: ${results.length - failed.length}/${results.length} test başarılı${failed.length ? `, ${failed.length} başarısız` : ''}\n`)
process.exit(failed.length ? 1 : 0)
