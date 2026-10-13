/**
 * LEONX OS — Tarayıcı (uçtan uca) testleri
 *
 * Uygulama, test ortam değişkenleriyle derlenir ve Supabase API'leri bellek içi
 * sahte bir arka uçla (mock-supabase.mjs) değiştirilir. Bu testler arayüz
 * akışlarını doğrular; gerçek Supabase projesine bağlanmaz.
 *
 * Çalıştırma: npm run test:e2e
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from 'playwright'
import { INTRUDER, MockSupabase, OWNER, SUPABASE_URL } from './mock-supabase.mjs'
import { startStaticServer } from './static-server.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT_CONFIGURED = 4181
const PORT_UNCONFIGURED = 4182
const BASE = `http://localhost:${PORT_CONFIGURED}`
const SHOTS = process.env.E2E_SCREENSHOTS

// ------------------------------------------------------------------ derleme
if (!process.env.E2E_SKIP_BUILD) {
  const env = { ...process.env, VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_test_key' }
  execSync('npx vite build --outDir dist-e2e --emptyOutDir --logLevel error', { cwd: ROOT, env, stdio: 'inherit' })
  const bare = { ...process.env }
  delete bare.VITE_SUPABASE_URL
  delete bare.VITE_SUPABASE_PUBLISHABLE_KEY
  execSync('npx vite build --outDir dist-e2e-unconfigured --emptyOutDir --logLevel error', { cwd: ROOT, env: bare, stdio: 'inherit' })
}
const servers = [
  await startStaticServer(path.join(ROOT, 'dist-e2e'), PORT_CONFIGURED, path.join(ROOT, 'vercel.json')),
  await startStaticServer(path.join(ROOT, 'dist-e2e-unconfigured'), PORT_UNCONFIGURED, path.join(ROOT, 'vercel.json')),
]

// ------------------------------------------------------------------ küçük test çatısı
// Kanonik olmayan (sabit dağıtım) adres testi için ek ana makine adı yerel sunucuya yönlendirilir
const ALT_HOST = 'leonx-abc123.vercel.test'
const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${ALT_HOST} 127.0.0.1`] })
const results = []
async function test(name, fn, contextOptions = { viewport: { width: 1366, height: 900 } }) {
  const ctx = await browser.newContext(contextOptions)
  const page = await ctx.newPage()
  const mock = new MockSupabase()
  await mock.attach(page)
  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200)))
  const t0 = Date.now()
  try {
    await fn({ page, mock, ctx, consoleErrors })
    results.push({ name, ok: true, ms: Date.now() - t0 })
    console.log(`  ✓ ${name}`)
  } catch (e) {
    results.push({ name, ok: false, error: e })
    console.log(`  ✗ ${name}\n      ${String(e.message || e).split('\n').slice(0, 6).join('\n      ')}`)
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `FAIL-${name.replace(/[^a-z0-9]+/gi, '_')}.png`) }).catch(() => {})
  } finally {
    await ctx.close()
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg)
}
async function eventually(fn, msg, timeout = 4000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    try {
      if (await fn()) return
    } catch (e) {
      last = e
    }
    await new Promise((r) => setTimeout(r, 60))
  }
  throw new Error(`${msg}${last ? ` (${last.message})` : ''}`)
}
async function login(page, user = OWNER, next = '/') {
  await page.goto(`${BASE}${next === '/' ? '/giris' : `/giris?next=${encodeURIComponent(next)}`}`)
  await page.getByLabel('E-posta').fill(user.email)
  await page.locator('input[name="password"]').fill(user.password)
  await page.getByRole('button', { name: 'Giriş yap' }).click()
}
/** Aynı sahte arka uca bağlı ayrı bir cihaz (ayrı tarayıcı bağlamı = ayrı oturum ve depolama) */
async function openDevice(mock, opts) {
  const { defaultBrowserType: _ignored, ...rest } = opts
  const ctx = await browser.newContext(rest)
  const page = await ctx.newPage()
  await mock.attach(page)
  return { ctx, page }
}
/** Sunucudaki version.json'u "yeni dağıtım" gibi değiştirir */
async function serveNewerVersion(page) {
  await page.route('**/version.json*', async (route) => {
    const real = await (await route.fetch()).json()
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify({ ...real, buildId: `${real.buildId}-yeni`, commit: 'f00dbab' }) })
  })
}
const dataRequests = (mock) => mock.requests.filter((r) => r.kind === 'http' && r.path.startsWith('/rest/v1/') && !r.path.startsWith('/rest/v1/rpc/'))

console.log('\nLEONX OS — tarayıcı testleri (sahte Supabase arka ucu)\n')

// ================================================================== Kurulum ve erişim
await test('Ortam değişkenleri yoksa kurulum ekranı gösterilir, ağ isteği yapılmaz', async ({ page }) => {
  const external = []
  page.on('request', (r) => !r.url().startsWith('http://localhost') && external.push(r.url()))
  for (const p of ['/', '/projeler', '/giris']) {
    await page.goto(`http://localhost:${PORT_UNCONFIGURED}${p}`)
    await page.getByRole('heading', { name: 'Kurulum gerekli' }).waitFor()
  }
  expect(await page.getByText('VITE_SUPABASE_PUBLISHABLE_KEY').count() >= 1, 'değişken adı gösterilmedi')
  expect(external.length === 0, `harici istek yapıldı: ${external.join(', ')}`)
})

await test('Giriş yapılmadan özel sayfa açılamaz ve veri istenmez', async ({ page, mock }) => {
  await page.goto(`${BASE}/projeler/abc?x=1`)
  await page.getByRole('heading', { name: 'Giriş yap' }).waitFor()
  expect(page.url().includes('/giris?next=%2Fprojeler%2Fabc%3Fx%3D1'), `yönlendirme hatalı: ${page.url()}`)
  expect(dataRequests(mock).length === 0, 'oturumsuz veri isteği yapıldı')
  const signup = page.getByRole('link', { name: /hesap oluştur|kayıt ol|üye ol|sign up|register/i })
  const signupBtn = page.getByRole('button', { name: /hesap oluştur|kayıt ol|üye ol|sign up|register/i })
  expect((await signup.count()) + (await signupBtn.count()) === 0, 'herkese açık kayıt seçeneği var')
})

await test('Form doğrulaması ve hatalı şifre iletisi', async ({ page }) => {
  await page.goto(`${BASE}/giris`)
  await page.getByRole('button', { name: 'Giriş yap' }).click()
  await page.getByText('Geçerli bir e-posta adresi girin.').waitFor()
  await page.getByText('Şifrenizi girin.').waitFor()
  await page.getByLabel('E-posta').fill(OWNER.email)
  await page.locator('input[name="password"]').fill('yanlis-sifre')
  await page.getByRole('button', { name: 'Giriş yap' }).click()
  await page.getByText('E-posta veya şifre hatalı.').waitFor()
  expect((await page.locator('input[name="password"]').inputValue()) === '', 'hatalı denemeden sonra şifre alanı temizlenmedi')
})

await test('Bağlantı hatasında anlaşılır ileti', async ({ page, mock }) => {
  mock.failNext = { match: '/auth/v1/token', abort: true }
  await login(page)
  await page.getByText(/Sunucuya ulaşılamadı/).waitFor()
})

await test('Geçerli ama yetkisiz hesap hiçbir veriye erişemez', async ({ page, mock }) => {
  mock.externalInsert('companies', { name: 'Gizli Firma' })
  await login(page, INTRUDER)
  await page.getByRole('heading', { name: 'Bu hesap yetkili değil' }).waitFor()
  expect((await page.getByText('Gizli Firma').count()) === 0, 'yetkisiz kullanıcı veri gördü')
  expect(dataRequests(mock).length === 0, 'yetkisiz kullanıcı için veri sorgusu yapıldı')
  await page.goto(`${BASE}/firmalar`)
  await page.getByRole('heading', { name: 'Bu hesap yetkili değil' }).waitFor()
  await page.getByRole('button', { name: 'Çıkış yap' }).click()
  await page.getByRole('heading', { name: 'Giriş yap' }).waitFor()
})

await test('Sahip girişi: hedef sayfaya döner, boş durumlar gerçek', async ({ page, mock }) => {
  await login(page, OWNER, '/projeler')
  await page.getByRole('heading', { name: 'Henüz proje yok' }).waitFor()
  expect(page.url().endsWith('/projeler'), `yönlendirme: ${page.url()}`)
  await eventually(() => mock.activeChannelCount === 1, 'Realtime kanalı açılmadı')
  await page.goto(`${BASE}/`)
  await eventually(async () => /Toplam proje\s*0/.test((await page.getByRole('link', { name: /Toplam proje/ }).textContent()).replace(/\s+/g, ' ')), 'KPI sıfır göstermedi')
  await page.getByText('Önümüzdeki 14 gün içinde teslimi olan aktif proje yok.').waitFor()
})

// ================================================================== Firmalar
await test('Firma: doğrulama, ekleme, arama, düzenleme, ilgili kişi', async ({ page, mock }) => {
  await login(page, OWNER, '/firmalar')
  await page.getByRole('heading', { name: 'Henüz firma yok' }).waitFor()
  await page.getByRole('button', { name: 'Firma ekle' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Yeni firma' })
  await dialog.getByLabel('E-posta').fill('gecersiz')
  await dialog.getByLabel('Vergi / T.C. kimlik no').fill('12')
  await dialog.getByRole('button', { name: 'Firmayı ekle' }).click()
  await dialog.getByText('Firma adı zorunludur.').waitFor()
  await dialog.getByText('Geçerli bir e-posta adresi girin.').waitFor()
  await dialog.getByText(/10 veya 11 rakam/).waitFor()
  expect(mock.db.companies.length === 0, 'geçersiz form gönderildi')

  await dialog.getByLabel('Firma adı').fill('  Işık Yapı Alüminyum  ')
  await dialog.getByLabel('E-posta').fill('Info@IsikYapi.example')
  await dialog.getByLabel('Vergi / T.C. kimlik no').fill('1234567890')
  await dialog.getByLabel('Şehir').fill('İzmir')
  await dialog.getByRole('button', { name: 'Firmayı ekle' }).click()
  await page.getByRole('heading', { name: 'Işık Yapı Alüminyum' }).waitFor()
  expect(mock.db.companies[0].name === 'Işık Yapı Alüminyum' && mock.db.companies[0].email === 'info@isikyapi.example', 'veri temizlenmeden kaydedildi')
  await page.getByText('Firma eklendi.').waitFor()

  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  const cd = page.getByRole('dialog', { name: 'Yeni ilgili kişi' })
  await cd.getByLabel('Ad soyad').fill('Ayşe Demir')
  await cd.getByLabel('Telefon').fill('+90 532 000 00 00')
  await cd.getByText('Birincil ilgili kişi').click()
  await cd.getByRole('button', { name: 'Kaydet' }).click()
  await page.getByText('Ayşe Demir').waitFor()
  expect(mock.db.contacts[0]?.is_primary === true, 'birincil kişi kaydedilmedi')

  await page.getByRole('button', { name: 'Düzenle', exact: true }).click()
  const ed = page.getByRole('dialog', { name: 'Firmayı düzenle' })
  await ed.getByLabel('Şehir').fill('Manisa')
  await ed.getByRole('button', { name: 'Değişiklikleri kaydet' }).click()
  await page.getByText('Manisa').waitFor()
  expect(mock.db.companies[0].version === 2, 'sürüm artmadı')

  await page.goto(`${BASE}/firmalar`)
  await page.getByLabel('Firmalarda ara').fill('isik')
  await page.getByRole('link', { name: /Işık Yapı/ }).waitFor()
  await page.getByLabel('Firmalarda ara').fill('olmayan firma')
  await page.getByText('Eşleşen firma yok').waitFor()
})

// ================================================================== Projeler
await test('Proje: oluşturma, tarih doğrulaması, durum geçmişi, not, dosya, silme', async ({ page, mock }) => {
  const company = mock.externalInsert('companies', { name: 'Demir Cephe Ltd.' })
  await login(page, OWNER, '/projeler')
  await page.getByRole('button', { name: 'Yeni proje' }).first().click()
  const d = page.getByRole('dialog', { name: 'Yeni proje' })
  await eventually(async () => (await d.getByLabel('Proje kodu').inputValue()) === `LX-${new Date().getFullYear()}-001`, 'önerilen kod doldurulmadı')
  await d.getByRole('button', { name: 'Projeyi oluştur' }).click()
  await d.getByText('Proje adı zorunludur.').waitFor()
  await d.getByText('İş kategorisi seçin.').waitFor()
  await d.getByLabel('Proje adı').fill('Ofis binası giydirme cephe')
  await d.getByLabel('Firma').selectOption(company.id)
  await d.getByLabel('İş kategorisi').selectOption('cephe')
  await d.getByLabel('Başlangıç tarihi').fill('2026-10-20')
  await d.getByLabel('Hedef teslim tarihi').fill('2026-10-10')
  await d.getByRole('button', { name: 'Projeyi oluştur' }).click()
  await d.getByText('Teslim tarihi başlangıç tarihinden önce olamaz.').waitFor()
  await d.getByLabel('Hedef teslim tarihi').fill('2026-12-15')
  await d.getByRole('button', { name: 'Projeyi oluştur' }).click()
  await page.getByRole('heading', { name: 'Ofis binası giydirme cephe' }).waitFor()
  const project = mock.db.projects[0]
  expect(page.url().endsWith(`/projeler/${project.id}`), 'detay sayfasına gidilmedi')

  // Durum değişimi → geçmiş
  await page.getByLabel('Proje durumunu değiştir').selectOption('uretim')
  await page.getByText('Durum: Üretim').waitFor()
  await eventually(async () => (await page.getByText(/Keşif → Üretim/).count()) === 1, 'durum geçmişi güncellenmedi')
  expect(mock.db.project_status_history.length === 2, 'geçmiş kaydı sayısı hatalı')

  // Not
  await page.getByLabel('Yeni not').fill('Ölçü alındı, cam tipi teyit edilecek.')
  await page.getByRole('button', { name: 'Not ekle' }).click()
  await page.getByText('Ölçü alındı, cam tipi teyit edilecek.').waitFor()

  // Dosya: izinli tür yüklenir, yasaklı tür reddedilir
  const input = page.locator('input[type=file]')
  await input.setInputFiles({ name: 'zararli.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') })
  await page.getByText(/zararli\.exe: Desteklenmeyen dosya türü/).waitFor()
  await input.setInputFiles({ name: 'Cephe Kesiti.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') })
  await page.getByText('Cephe Kesiti.pdf yüklendi.').waitFor()
  const file = mock.db.project_files[0]
  expect(file.storage_path.startsWith(`${project.id}/`) && /Cephe-Kesiti\.pdf$/.test(file.storage_path), `depolama yolu: ${file.storage_path}`)
  expect(mock.storage.size === 1, 'dosya depoya yüklenmedi')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Cephe Kesiti.pdf indir' }).click()])
  expect(download.suggestedFilename() === 'Cephe Kesiti.pdf', 'indirilen dosya adı hatalı')

  // Firma silme engeli (projesi var)
  await page.getByRole('link', { name: 'Demir Cephe Ltd.' }).first().click()
  await page.getByRole('button', { name: 'Sil', exact: true }).click()
  await page.getByRole('dialog', { name: 'Firma silinemez' }).waitFor()
  await page.getByRole('button', { name: 'Tamam' }).click()
  expect(mock.db.companies.length === 1, 'projesi olan firma silindi')

  // Proje silme: dosyalar depodan da kaldırılır
  await page.goto(`${BASE}/projeler/${project.id}`)
  await page.getByRole('button', { name: 'Sil', exact: true }).click()
  await page.getByRole('button', { name: 'Projeyi sil' }).click()
  await page.getByText('Proje silindi.').waitFor()
  await eventually(() => page.url().endsWith('/projeler'), 'listeye dönülmedi')
  expect(mock.db.projects.length === 0 && mock.storage.size === 0 && mock.db.project_notes.length === 0, 'proje veya bağlı kayıtlar kaldı')
})

await test('Proje listesi: arama ve filtreler', async ({ page, mock }) => {
  const c = mock.externalInsert('companies', { name: 'Kuzey İnşaat' })
  mock.externalInsert('projects', { code: 'LX-2026-010', name: 'Çelik kapı montajı', category: 'celik_kapi', status: 'montaj', company_id: c.id })
  mock.externalInsert('projects', { code: 'LX-2026-011', name: 'Balkon korkuluğu', category: 'korkuluk', status: 'tamamlandi' })
  mock.externalInsert('projects', { code: 'LX-2026-012', name: 'PVC pencere', category: 'pvc_dograma', status: 'kesif', location: 'Bornova' })
  await login(page, OWNER, '/projeler')
  await page.getByText('Çelik kapı montajı').first().waitFor()
  expect((await page.getByText('Balkon korkuluğu').count()) === 0, 'tamamlanan proje aktif listede görünüyor')
  await page.getByLabel('Durum filtresi').selectOption('tumu')
  await page.getByText('Balkon korkuluğu').first().waitFor()
  await page.getByLabel('Projelerde ara').fill('celik kapi')
  await eventually(async () => (await page.getByText('PVC pencere').count()) === 0, 'arama filtrelemedi')
  await page.getByLabel('Projelerde ara').fill('bornova')
  await page.getByText('PVC pencere').first().waitFor()
  await page.getByLabel('Projelerde ara').fill('')
  await page.getByLabel('Firma filtresi').selectOption(c.id)
  await eventually(async () => (await page.getByText('PVC pencere').count()) === 0 && (await page.getByText('Çelik kapı montajı').count()) > 0, 'firma filtresi çalışmadı')
  expect(page.url().includes('firma='), 'filtre adrese yazılmadı')
  await page.reload()
  await page.getByText('Çelik kapı montajı').first().waitFor()
  expect((await page.getByText('PVC pencere').count()) === 0, 'filtre yenilemeden sonra korunmadı')
})

// ================================================================== Realtime ve çakışma
await test('Realtime: başka cihazdaki ekleme, güncelleme ve silme anında görünür', async ({ page, mock }) => {
  await login(page, OWNER, '/firmalar')
  await page.getByRole('heading', { name: 'Henüz firma yok' }).waitFor()
  await page.getByRole('status', { name: /Senkronizasyon: Canlı/ }).waitFor()
  const c = mock.externalInsert('companies', { name: 'Uzak Cihaz Firması' })
  await page.getByText('Uzak Cihaz Firması').waitFor({ timeout: 3000 })
  mock.externalUpdate('companies', c.id, { name: 'Uzak Cihaz Firması (güncel)' })
  await page.getByText('Uzak Cihaz Firması (güncel)').waitFor({ timeout: 3000 })
  const p = mock.externalInsert('projects', { code: 'LX-2026-100', name: 'Uzak proje', category: 'diger', company_id: c.id })
  await page.goto(`${BASE}/projeler/${p.id}`)
  await page.getByRole('heading', { name: 'Uzak proje' }).waitFor()
  mock.externalUpdate('projects', p.id, { status: 'montaj' })
  await page.getByText(/Keşif → Montaj/).waitFor({ timeout: 3000 })
  mock.externalInsert('project_notes', { project_id: p.id, body: 'Telefondan eklenen not' })
  await page.getByText('Telefondan eklenen not').waitFor({ timeout: 3000 })
  mock.externalDelete('projects', p.id)
  await page.getByRole('heading', { name: 'Proje bulunamadı' }).waitFor({ timeout: 3000 })
})

await test('Çakışma: başka cihazda değişen kayıt sessizce ezilmez', async ({ page, mock }) => {
  const p = mock.externalInsert('projects', { code: 'LX-2026-200', name: 'Çakışma projesi', category: 'diger' })
  await login(page, OWNER, `/projeler/${p.id}`)
  await page.getByRole('heading', { name: 'Çakışma projesi' }).waitFor()
  await mock.dropSockets() // olay gelmesin: gerçek çakışma kontrolü sunucu sürümüyle yapılmalı
  await page.getByRole('button', { name: 'Düzenle', exact: true }).click()
  const d = page.getByRole('dialog', { name: 'Projeyi düzenle' })
  await d.getByLabel('Proje adı').fill('Bu cihazdaki ad')
  // başka cihaz kaydı değiştirir; ancak bu sayfa olayı alamaz
  mock.db.projects[0] = { ...mock.db.projects[0], name: 'Diğer cihazdaki ad', version: 2 }
  await d.getByRole('button', { name: 'Değişiklikleri kaydet' }).click()
  await d.getByText(/başka bir cihazda güncellendi/).waitFor()
  expect(mock.db.projects[0].name === 'Diğer cihazdaki ad', 'çakışmada veri ezildi')
})

await test('Realtime: bağlantı koparsa yeniden bağlanır ve kaçırılan veriyi yükler', async ({ page, mock }) => {
  await login(page, OWNER, '/firmalar')
  await page.getByRole('status', { name: /Senkronizasyon: Canlı/ }).waitFor()
  mock.dropSockets()
  await page.getByRole('status', { name: /Yeniden bağlanıyor/ }).waitFor({ timeout: 3000 })
  // kopukken başka cihazda eklenen kayıt (olay kaçırılır)
  mock.db.companies.push({ id: crypto.randomUUID(), name: 'Kopukken eklenen', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: 1 })
  await page.getByRole('status', { name: /Senkronizasyon: Canlı/ }).waitFor({ timeout: 8000 })
  await page.getByText('Kopukken eklenen').waitFor({ timeout: 3000 })
})

await test('Çıkış: Realtime kanalı kapanır, özel sayfalar tekrar kilitlenir', async ({ page, mock }) => {
  mock.externalInsert('companies', { name: 'Oturum Testi' })
  await login(page, OWNER, '/firmalar')
  await page.getByText('Oturum Testi').waitFor()
  await eventually(() => mock.activeChannelCount === 1, 'kanal açılmadı')
  await page.goto(`${BASE}/ayarlar`)
  await page.getByRole('button', { name: 'Bu cihazda çıkış yap' }).click()
  await page.getByRole('heading', { name: 'Giriş yap' }).waitFor()
  await eventually(() => mock.activeChannelCount === 0, 'çıkıştan sonra Realtime kanalı açık kaldı')
  const stored = await page.evaluate(() => localStorage.getItem('leonx-os-auth'))
  expect(!stored, 'oturum bilgisi tarayıcıda kaldı')
  await page.goto(`${BASE}/firmalar`)
  await page.getByRole('heading', { name: 'Giriş yap' }).waitFor()
  expect((await page.getByText('Oturum Testi').count()) === 0, 'çıkıştan sonra veri göründü')
})

await test('Oturum sayfa yenilemede ve yeni sekmede korunur (aynı cihaz)', async ({ page, ctx, mock }) => {
  await login(page, OWNER, '/ayarlar')
  await page.getByText(OWNER.email).first().waitFor()
  await page.reload()
  await page.getByRole('heading', { name: 'Ayarlar' }).waitFor()
  const second = await ctx.newPage()
  await mock.attach(second)
  await second.goto(`${BASE}/projeler`)
  await second.getByRole('heading', { name: 'Projeler' }).waitFor()
})


// ================================================================== Sürüm, güncelleme ve önbellek
await test('Sürüm: version.json önbelleğe alınmaz, ayarlar ve kenar çubuğu aynı derlemeyi gösterir', async ({ page }) => {
  const res = await page.request.get(`${BASE}/version.json`)
  expect(res.ok() && res.headers()['content-type'].includes('json'), 'version.json yayımlanmadı')
  expect(/no-store/.test(res.headers()['cache-control']), `version.json önbellek başlığı: ${res.headers()['cache-control']}`)
  const v = await res.json()
  const html = await page.request.get(`${BASE}/projeler`)
  expect(/no-cache/.test(html.headers()['cache-control']), 'HTML önbelleğe alınabiliyor')
  await login(page, OWNER, '/ayarlar')
  await page.getByTestId('version-panel').waitFor()
  const shown = (await page.getByTestId('version-Derleme kimliği').textContent()).trim()
  expect(shown === v.buildId, `ekrandaki derleme ${shown} ≠ sunucudaki ${v.buildId}`)
  expect((await page.getByTestId('sidebar-version').textContent()).includes(v.commit), 'kenar çubuğunda commit yok')
  const asset = await page.evaluate(() => [...document.scripts].map((s) => s.src).find((s) => s.includes('/assets/')))
  const a = await page.request.get(asset)
  expect(/immutable/.test(a.headers()['cache-control']), 'içerik karmalı dosyalar uzun süre önbelleğe alınmıyor')
  await page.getByTestId('version-check').click()
  await page.getByText(/Güncel sürümü kullanıyorsunuz/).waitFor()
  expect((await page.getByTestId('update-banner').count()) === 0, 'aynı sürümde güncelleme bildirimi çıktı')
})

await test('Yeni dağıtım algılanır: "Yeni sürüm hazır — Güncelle", sonsuz yenileme olmaz', async ({ page }) => {
  await serveNewerVersion(page)
  await login(page, OWNER, '/ayarlar')
  await page.getByTestId('version-panel').waitFor()
  await page.getByTestId('version-check').click()
  await page.getByTestId('update-banner').getByText('Yeni sürüm hazır').waitFor()
  let loads = 0
  page.on('load', () => loads++)
  // Sunucu hâlâ eski paketleri verdiği sürece (CDN gecikmesi) en fazla 2 deneme yapılır
  for (let i = 0; i < 2; i++) {
    await Promise.all([page.waitForEvent('load'), page.getByTestId('update-apply').click()])
    await page.getByTestId('version-panel').waitFor()
    await page.getByTestId('version-check').click()
    await page.getByTestId('update-banner').waitFor()
  }
  await page.getByTestId('update-banner').getByText(/tamamen kapatıp yeniden açın/).waitFor()
  expect((await page.getByTestId('update-apply').count()) === 0, 'deneme sınırından sonra hâlâ güncelle düğmesi var')
  await page.waitForTimeout(1500)
  expect(loads === 2, `beklenmeyen yeniden yükleme sayısı: ${loads}`)
  await page.getByRole('heading', { name: 'Ayarlar' }).waitFor()
})

await test('Güncelleme kaydedilmemiş formu korur: önce uyarı, form verisi kaybolmaz', async ({ page }) => {
  await serveNewerVersion(page)
  await login(page, OWNER, '/projeler')
  await page.getByRole('button', { name: 'Yeni proje' }).first().click()
  const d = page.getByRole('dialog', { name: 'Yeni proje' })
  await d.getByLabel('Proje adı').fill('Kaydedilmemiş proje adı')
  await page.getByTestId('update-banner').waitFor({ timeout: 10000 }) // açılıştan ~4 sn sonra otomatik denetim
  let reloaded = false
  page.on('load', () => (reloaded = true))
  await page.getByTestId('update-apply').click()
  await page.getByTestId('update-unsaved').getByText(/Proje formu/).waitFor()
  await page.waitForTimeout(500)
  expect(!reloaded, 'kaydedilmemiş form varken uyarısız yenilendi')
  expect((await d.getByLabel('Proje adı').inputValue()) === 'Kaydedilmemiş proje adı', 'form verisi kayboldu')
})

await test('Dosya yüklenirken güncelleme ertelenir; yükleme bitince "Güncelle" açılır', async ({ page, mock }) => {
  await serveNewerVersion(page)
  const p = mock.externalInsert('projects', { code: 'LX-2026-610', name: 'Yükleme projesi', category: 'diger' })
  let release
  const gate = new Promise((r) => (release = r))
  await page.route(`${SUPABASE_URL}/storage/v1/object/**`, async (route) => {
    if (route.request().method() === 'POST') await gate
    await route.fallback()
  })
  await login(page, OWNER, `/projeler/${p.id}`)
  await page.getByRole('heading', { name: 'Yükleme projesi' }).waitFor()
  await page.getByTestId('update-banner').waitFor({ timeout: 10000 })
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Uzun Yükleme.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') })
  await page.getByTestId('update-busy').getByText(/Uzun Yükleme\.pdf yükleniyor/).waitFor()
  expect(await page.getByTestId('update-apply').isDisabled(), 'yükleme sürerken güncelle düğmesi açık')
  release()
  await page.getByText('Uzun Yükleme.pdf yüklendi.').waitFor()
  await eventually(async () => !(await page.getByTestId('update-apply').isDisabled()), 'yükleme bitince düğme açılmadı')
  expect(mock.storage.size === 1 && mock.db.project_files.length === 1, 'yükleme tamamlanmadı')
  // "Daha Sonra" bildirimi bu sürüm için kapatır
  await page.getByTestId('update-later').click()
  await eventually(async () => (await page.getByTestId('update-banner').count()) === 0, 'Daha Sonra bildirimi kapatmadı')
})

await test('Güncelle: eski önbellek ve service worker temizlenir, sürüm parametresi adresten silinir', async ({ page }) => {
  await serveNewerVersion(page)
  await login(page, OWNER, '/ayarlar')
  await page.getByTestId('version-panel').waitFor()
  // Önceki bir kurulumdan kalmış önbellek taklidi
  await page.evaluate(async () => {
    const c = await caches.open('eski-surum')
    await c.put('/eski.js', new Response('eski'))
  })
  await page.getByTestId('version-check').click()
  await page.getByTestId('update-banner').getByText('LEONX OS — Yeni sürüm hazır').waitFor()
  await Promise.all([page.waitForEvent('load'), page.getByTestId('update-apply').click()])
  await page.getByTestId('version-panel').waitFor()
  expect(!page.url().includes('_surum='), `sürüm parametresi adreste kaldı: ${page.url()}`)
  expect(page.url().endsWith('/ayarlar'), `sayfa korunmadı: ${page.url()}`)
  expect((await page.evaluate(() => caches.keys())).length === 0, 'eski önbellek temizlenmedi')
  await page.getByTestId('version-Güncelleme durumu').waitFor()
})

await test('Dağıtım sonrası silinmiş sayfa parçası: beyaz ekran yok, bir kez güvenli yeniden yükleme', async ({ page }) => {
  let failed = 0
  await page.route(/\/assets\/ReportsPage-[^/]+\.js$/, (route) => {
    if (failed++ === 0) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' })
    return route.continue()
  })
  await login(page, OWNER, '/')
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Raporlar' }).first().click()
  await page.getByRole('heading', { name: 'Raporlar', exact: true }).first().waitFor({ timeout: 8000 })
  expect(failed >= 2, 'parça hatası taklit edilmedi')
  expect(page.url().endsWith('/raporlar'), `adres: ${page.url()}`)
})

await test('Kanonik olmayan adres: tek üretim adresine yönlendiren uyarı', async ({ page }) => {
  await page.goto(`http://${ALT_HOST}:${PORT_CONFIGURED}/giris`)
  const banner = page.getByTestId('env-banner')
  await banner.waitFor()
  expect((await banner.getByRole('link').getAttribute('href')).startsWith('https://leonx-os.vercel.app/giris'), 'uyarı bağlantısı kanonik adres değil')
  await page.goto(`${BASE}/giris`)
  await page.getByRole('heading', { name: 'Giriş yap' }).waitFor()
  expect((await page.getByTestId('env-banner').count()) === 0, 'yerel adreste ortam uyarısı çıktı')
})

// ================================================================== Çoklu cihaz senkronizasyonu
await test('Çoklu cihaz: Windows, iPad ve telefon değişiklikleri yenilemeden birbirine yansır', async ({ page: win, mock }) => {
  const ipad = await openDevice(mock, devices['iPad Pro 11'])
  const phone = await openDevice(mock, devices['iPhone 15'])
  try {
    await Promise.all([login(win, OWNER, '/firmalar'), login(ipad.page, OWNER, '/firmalar'), login(phone.page, OWNER, '/projeler')])
    await eventually(() => mock.activeChannelCount === 3, 'üç cihazın canlı kanalı açılmadı', 8000)
    let ipadLoads = 0
    let winLoads = 0
    ipad.page.on('load', () => ipadLoads++)
    win.on('load', () => winLoads++)

    // 1) Windows firma ve proje oluşturur → iPad ve telefon görür
    await win.getByRole('button', { name: 'Firma ekle' }).first().click()
    const fd = win.getByRole('dialog', { name: 'Yeni firma' })
    await fd.getByLabel('Firma adı').fill('Çoklu Cihaz Alüminyum')
    await fd.getByRole('button', { name: 'Firmayı ekle' }).click()
    await win.getByRole('heading', { name: 'Çoklu Cihaz Alüminyum' }).waitFor()
    await ipad.page.getByText('Çoklu Cihaz Alüminyum').filter({ visible: true }).first().waitFor({ timeout: 4000 })
    const company = mock.db.companies[0]
    await win.goto(`${BASE}/projeler`)
    await win.getByRole('button', { name: 'Yeni proje' }).first().click()
    const pd = win.getByRole('dialog', { name: 'Yeni proje' })
    await pd.getByLabel('Proje adı').fill('Windows’ta açılan proje')
    await pd.getByLabel('Firma').selectOption(company.id)
    await pd.getByLabel('İş kategorisi').selectOption('pvc_dograma')
    await pd.getByRole('button', { name: 'Projeyi oluştur' }).click()
    await win.getByRole('heading', { name: 'Windows’ta açılan proje' }).waitFor()
    await phone.page.getByText('Windows’ta açılan proje').filter({ visible: true }).first().waitFor({ timeout: 4000 })
    const project = mock.db.projects[0]

    // 2) iPad projeyi günceller → Windows proje detayında görür
    await ipad.page.goto(`${BASE}/projeler/${project.id}`)
    await ipad.page.getByRole('heading', { name: 'Windows’ta açılan proje' }).waitFor()
    ipadLoads = 0
    winLoads = 0
    await ipad.page.getByLabel('Proje durumunu değiştir').selectOption('montaj')
    await win.getByText(/Keşif → Montaj/).waitFor({ timeout: 4000 })

    // 3) Telefon firmayı günceller → Windows ve iPad görür
    await phone.page.goto(`${BASE}/firmalar/${company.id}`)
    await phone.page.getByRole('heading', { name: 'Çoklu Cihaz Alüminyum' }).waitFor()
    await phone.page.getByRole('button', { name: 'Düzenle', exact: true }).click()
    const ed = phone.page.getByRole('dialog', { name: 'Firmayı düzenle' })
    await ed.getByLabel('Firma adı').fill('Çoklu Cihaz Alüminyum (telefon)')
    await ed.getByRole('button', { name: 'Değişiklikleri kaydet' }).click()
    await phone.page.getByRole('heading', { name: 'Çoklu Cihaz Alüminyum (telefon)' }).waitFor()
    await win.getByText('Çoklu Cihaz Alüminyum (telefon)').filter({ visible: true }).first().waitFor({ timeout: 4000 })
    await ipad.page.getByText('Çoklu Cihaz Alüminyum (telefon)').filter({ visible: true }).first().waitFor({ timeout: 4000 })

    expect(ipadLoads === 0 && winLoads === 0, 'güncellemeler için sayfa yenilendi')
    expect(mock.db.companies.length === 1 && mock.db.projects.length === 1, 'çift kayıt oluştu')
  } finally {
    await ipad.ctx.close()
    await phone.ctx.close()
  }
})

await test('Çevrimdışı → çevrimiçi: uyarı, form korunur, otomatik yeniden deneme, kaçırılan veri gelir', async ({ page, ctx, mock }) => {
  await login(page, OWNER, '/firmalar')
  await page.getByRole('heading', { name: 'Henüz firma yok' }).waitFor()
  await eventually(() => mock.activeChannelCount === 1, 'kanal açılmadı')
  // Playwright yönlendirmeleri çevrimdışı öykünmesinden önce çalışır: arka uç istekleri de kesilir
  let offline = false
  await page.route(`${SUPABASE_URL}/**`, (route) => (offline ? route.abort('internetdisconnected') : route.fallback()))
  offline = true
  await ctx.setOffline(true)
  await page.getByTestId('offline-notice').waitFor()
  mock.externalInsert('companies', { name: 'Başka cihazdan eklenen' }) // bu cihaz kopukken
  await page.getByRole('button', { name: 'Firma ekle' }).first().click()
  const d = page.getByRole('dialog', { name: 'Yeni firma' })
  await d.getByLabel('Firma adı').fill('Bağlantısızken girilen firma')
  await d.getByRole('button', { name: 'Firmayı ekle' }).click()
  await page.waitForTimeout(700)
  expect(mock.db.companies.length === 1, 'çevrimdışıyken kayıt yazıldı')
  offline = false
  await ctx.setOffline(false)
  await page.getByRole('heading', { name: 'Bağlantısızken girilen firma' }).waitFor({ timeout: 8000 })
  expect(mock.db.companies.filter((c) => c.name === 'Bağlantısızken girilen firma').length === 1, 'çift kayıt')
  await eventually(async () => (await page.getByTestId('offline-notice').count()) === 0, 'çevrimdışı uyarısı kalktı mı', 6000)
  await page.getByRole('link', { name: 'Firmalar' }).first().click()
  await page.getByText('Başka cihazdan eklenen').first().waitFor({ timeout: 6000 })
})

await test('Yanıtı kaybolan kayıt isteği yeniden denenir, çift kayıt oluşmaz', async ({ page, mock }) => {
  await login(page, OWNER, '/firmalar')
  await page.getByRole('heading', { name: 'Henüz firma yok' }).waitFor()
  mock.failNext = { match: '/rest/v1/companies', method: 'POST', loseResponse: true }
  await page.getByRole('button', { name: 'Firma ekle' }).first().click()
  const d = page.getByRole('dialog', { name: 'Yeni firma' })
  await d.getByLabel('Firma adı').fill('Tek Kayıt Metal')
  await d.getByRole('button', { name: 'Firmayı ekle' }).click()
  await page.getByRole('heading', { name: 'Tek Kayıt Metal' }).waitFor({ timeout: 6000 })
  expect(mock.db.companies.length === 1, `kayıt sayısı ${mock.db.companies.length}`)
  const posts = mock.requests.filter((r) => r.kind === 'http' && r.method === 'POST' && r.path.startsWith('/rest/v1/companies'))
  expect(posts.length >= 2, 'yeniden deneme yapılmadı')
})


// ================================================================== CAD analizi ve metraj
await test('CAD → metraj: DXF analizi, poz tespiti, projeye bağlama, onay, Excel/PDF; iPad canlı görür', async ({ page, mock, consoleErrors }) => {
  const project = mock.externalInsert('projects', { code: 'LX-2026-500', name: 'Pencere metraj projesi', category: 'pvc_dograma' })
  const ipad = await openDevice(mock, devices['iPad Pro 11 landscape'])
  try {
    await login(ipad.page, OWNER, `/projeler/${project.id}`)
    await ipad.page.getByTestId('project-quantity').waitFor()
    await login(page, OWNER, '/cad-analiz')
    await page.getByTestId('cad-workspace').waitFor()
    await page.getByTestId('cad-toolbar-file-input').setInputFiles(path.join(ROOT, 'src/cad/__fixtures__/window_schedule.dxf'))
    await page.getByTestId('cad-canvas').waitFor()
    await page.getByRole('tab', { name: /Pozlar/ }).click()
    await page.getByTestId('poz-detect').click()
    await page.getByTestId('poz-candidate').first().waitFor()
    const candidates = await page.getByTestId('poz-candidate').count()
    expect(candidates >= 3, `aday sayısı ${candidates}`)
    await page.getByTestId('poz-add-all').click()
    await page.getByTestId('qt-totals').waitFor()
    const rows = await page.getByTestId('qt-row').count()
    expect(rows === candidates, `tabloya eklenen ${rows} ≠ aday ${candidates}`)
    expect(/Doğrulanmamış|bekleyen/i.test(await page.getByTestId('qt-totals').innerText()), 'doğrulanmamış pozlar ayrı gösterilmiyor')

    // Projeye bağla: dosya özel depoya, analiz kaydı ve yeni metraj sürümü
    await page.getByTestId('bind-open').click()
    await page.getByTestId('bind-project').selectOption(project.id)
    await page.getByTestId('bind-submit').click()
    await eventually(() => mock.db.quantity_items.length === rows, `sunucuya yazılan poz ${mock.db.quantity_items.length}/${rows}`, 8000)
    expect(mock.db.quantity_takeoffs.length === 1 && mock.db.cad_analyses.length === 1, 'sürüm veya analiz kaydı oluşmadı')
    expect(mock.db.project_files.length === 1 && mock.storage.size === 1, 'çizim dosyası projeye yüklenmedi')
    // iPad sayfa yenilemeden görür
    await ipad.page.getByText(/Rev 1/).first().waitFor({ timeout: 5000 })
    await ipad.page.getByText('window_schedule.dxf').first().waitFor({ timeout: 5000 })

    // Metraj ekranı: tüm pozları doğrula, onayla ve kilitle
    const takeoff = mock.db.quantity_takeoffs[0]
    await page.goto(`${BASE}/metraj?proje=${project.id}&surum=${takeoff.id}`)
    await page.getByTestId('quantity-table').waitFor()
    await page.getByTestId('qt-row').first().waitFor()
    await page.getByRole('checkbox', { name: /Tümünü seç/ }).check()
    await page.getByTestId('qt-bulk-approve').click()
    await eventually(() => mock.db.quantity_items.every((i) => i.verification === 'onaylandi'), 'toplu doğrulama sunucuya yazılmadı', 6000)
    const total = (await page.getByTestId('qt-total-area').innerText()).trim()
    await page.getByTestId('qp-approve').click()
    await page.getByRole('button', { name: 'Onayla ve kilitle' }).click()
    await eventually(() => mock.db.quantity_takeoffs[0].status === 'onaylandi', 'sürüm onaylanmadı', 6000)
    await ipad.page.getByText('Onaylı').first().waitFor({ timeout: 5000 })

    // Dışa aktarma: ekrandaki toplam dosyalarla aynı kaynaktan
    const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-xlsx').click()])
    expect(/\.xlsx$/.test(xlsx.suggestedFilename()), `Excel adı ${xlsx.suggestedFilename()}`)
    const xbuf = await (await import('node:fs/promises')).readFile(await xlsx.path())
    expect(xbuf.subarray(0, 2).toString() === 'PK', 'Excel dosyası geçersiz')
    const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByTestId('export-pdf').click()])
    const pbuf = await (await import('node:fs/promises')).readFile(await pdf.path())
    expect(pbuf.subarray(0, 5).toString() === '%PDF-', 'PDF dosyası geçersiz')
    expect(/\d/.test(total), `toplam alan okunamadı: ${total}`)
    const unexpected = consoleErrors.filter((e) => !/WebSocket|realtime/i.test(e))
    expect(unexpected.length === 0, `konsol hataları: ${unexpected.join(' | ')}`)
  } finally {
    await ipad.ctx.close()
  }
}, { viewport: { width: 1440, height: 900 }, acceptDownloads: true })

await test('PDF çizim: üretim CSP kuralları altında açılır, vektörel algılanır, ölçek doğrulanmadan kesin ölçü yok', async ({ page, consoleErrors }) => {
  const { PDFDocument, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const pg = doc.addPage([842, 595])
  pg.drawRectangle({ x: 100, y: 100, width: 68, height: 85, borderColor: rgb(0, 0, 0), borderWidth: 0.5 })
  pg.drawLine({ start: { x: 300, y: 100 }, end: { x: 500, y: 100 }, thickness: 0.5 })
  const bytes = Buffer.from(await doc.save())
  await login(page, OWNER, '/cad-analiz')
  await page.getByTestId('cad-workspace').waitFor()
  await page.getByTestId('cad-toolbar-file-input').setInputFiles({ name: 'kesit.pdf', mimeType: 'application/pdf', buffer: bytes })
  await page.getByTestId('cad-canvas').waitFor({ timeout: 15000 })
  await page.getByTestId('properties').or(page.getByText('PDF türü')).first().waitFor({ timeout: 15000 })
  await page.getByText('Vektörel', { exact: true }).first().waitFor({ timeout: 15000 })
  await page.getByText(/PDF ölçeği belirsiz/).first().waitFor()
  const unexpected = consoleErrors.filter((e) => !/WebSocket|realtime/i.test(e))
  expect(unexpected.length === 0, `konsol / CSP hataları: ${unexpected.join(' | ')}`)
}, { viewport: { width: 1440, height: 900 } })

// ================================================================== Duyarlı ekranlar ve temalar
const SCREENS = {
  'iphone-se': devices['iPhone SE'],
  'iphone-15': devices['iPhone 15'],
  'pixel-7': devices['Pixel 7'],
  'ipad-portrait': devices['iPad Pro 11'],
  'ipad-landscape': devices['iPad Pro 11 landscape'],
  desktop: { viewport: { width: 1440, height: 900 } },
}
for (const [name, dev] of Object.entries(SCREENS)) {
  for (const scheme of ['light', 'dark']) {
    const { defaultBrowserType: _ignored, ...opts } = dev
    await test(
      `Ekran ${name} / ${scheme}: giriş, liste, detay, form — taşma ve hata yok`,
      async ({ page, mock, consoleErrors }) => {
        const c = mock.externalInsert('companies', { name: 'Uzun Adlı Alüminyum ve PVC Doğrama Sanayi Ticaret Limited Şirketi', city: 'İstanbul', phone: '+90 212 000 00 00' })
        const p = mock.externalInsert('projects', {
          code: 'LX-2026-300',
          name: 'Çok uzun proje adı: 24 katlı ofis kulesi giydirme cephe ve alüminyum doğrama işleri',
          category: 'cephe',
          status: 'uretim',
          company_id: c.id,
          due_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
          location: 'Ataşehir, İstanbul',
        })
        const vw = opts.viewport.width
        const overflow = () => page.evaluate((w) => window.innerWidth > w || document.documentElement.scrollWidth > w + 1, vw)
        const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'))
        await page.goto(`${BASE}/giris`)
        await page.getByRole('heading', { name: 'Giriş yap' }).waitFor()
        expect(!(await overflow()), 'giriş ekranı taşıyor')
        expect((await theme()) === scheme, 'tema uygulanmadı')
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}-${scheme}-login.png`) })
        await login(page, OWNER, '/')
        await page.getByText('LX-2026-300').first().waitFor()
        for (const [route, heading] of [
          ['/', 'Dashboard'],
          ['/projeler', 'Projeler'],
          [`/projeler/${p.id}`, p.name],
          ['/firmalar', 'Firmalar'],
          [`/firmalar/${c.id}`, c.name],
          ['/raporlar', 'Raporlar'],
          ['/ayarlar', 'Ayarlar'],
        ]) {
          await page.goto(`${BASE}${route}`)
          await page.getByRole('heading', { name: heading, exact: true }).first().waitFor()
          await page.waitForTimeout(150)
          expect(!(await overflow()), `${route} yatay taşıyor`)
          if (SHOTS && ['/', '/projeler', `/projeler/${p.id}`].includes(route)) {
            await page.screenshot({ path: path.join(SHOTS, `${name}-${scheme}-${route === '/' ? 'dashboard' : route.includes(p.id) ? 'project' : 'projects'}.png`) })
          }
        }
        await page.goto(`${BASE}/projeler`)
        await page.getByRole('button', { name: 'Yeni proje' }).first().click()
        const d = page.getByRole('dialog', { name: 'Yeni proje' })
        await d.waitFor()
        expect(!(await overflow()), 'form açıkken taşma')
        const fs = await d.getByLabel('Proje adı').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
        if (vw < 640) expect(fs >= 16, `iOS yakınlaşmasını önlemek için form yazısı ≥16px olmalı (${fs})`)
        const box = await d.getByRole('button', { name: 'Projeyi oluştur' }).boundingBox()
        expect(box && box.y + box.height <= opts.viewport.height + 1, 'kaydet düğmesi ekran dışında')
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}-${scheme}-form.png`) })
        await page.keyboard.press('Escape')
        await eventually(async () => (await page.getByRole('dialog').count()) === 0, 'Escape formu kapatmadı')
        const unexpected = consoleErrors.filter((e) => !/WebSocket|realtime/i.test(e))
        expect(unexpected.length === 0, `konsol hataları: ${unexpected.join(' | ')}`)
      },
      { ...opts, colorScheme: scheme },
    )
  }
}

await browser.close()
for (const s of servers) s.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} test başarılı${failed.length ? `, ${failed.length} başarısız` : ''}\n`)
process.exit(failed.length ? 1 : 0)
