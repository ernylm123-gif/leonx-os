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
const browser = await chromium.launch()
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
  expect(page.url().endsWith('/projeler'), 'listeye dönülmedi')
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
