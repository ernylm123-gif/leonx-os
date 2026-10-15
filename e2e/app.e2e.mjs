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
// Paralel çalıştırmalarda çakışmamak için E2E_PORT ile değiştirilebilir
const PORT_CONFIGURED = Number(process.env.E2E_PORT ?? 4181)
const PORT_UNCONFIGURED = PORT_CONFIGURED + 1
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
// Geliştirme kolaylığı: E2E_ONLY="PDF" yalnız adı eşleşen testleri çalıştırır (CI tümünü çalıştırır)
const ONLY = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY, 'i') : null
async function test(name, fn, contextOptions = { viewport: { width: 1366, height: 900 } }) {
  if (ONLY && !ONLY.test(name)) return
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
  await eventually(async () => /Aktif proje\s*0/.test((await page.getByRole('link', { name: /Aktif proje/ }).textContent()).replace(/\s+/g, ' ')), 'KPI sıfır göstermedi')
  await eventually(async () => /Geciken görev\s*0/.test((await page.getByRole('link', { name: /Geciken görev/ }).textContent()).replace(/\s+/g, ' ')), 'görev KPI sıfır göstermedi')
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

  // Aşama değişimi → işlem geçmişi (zaman çizelgesi) ve eski durum alanı eşitlenir
  await page.getByLabel('Proje aşamasını değiştir').selectOption('uretimde')
  await page.getByText('Aşama: Üretimde').waitFor()
  await eventually(async () => (await page.getByText(/Yeni fırsat → Üretimde/).count()) === 1, 'işlem geçmişi güncellenmedi')
  expect(mock.db.project_status_history.length === 2 && mock.db.projects[0].status === 'uretim' && mock.db.projects[0].progress >= 55, 'durum geçmişi / eski durum / ilerleme hatalı')

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
  // Proje sayfasının kendi "Sil" düğmesine basılmasın: önce firma sayfası açılmalı
  await page.waitForURL(`${BASE}/firmalar/${company.id}`)
  await page.getByText('1 proje', { exact: true }).waitFor()
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
  mock.externalInsert('projects', { code: 'LX-2026-010', name: 'Çelik kapı montajı', category: 'celik_kapi', stage: 'montajda', company_id: c.id })
  mock.externalInsert('projects', { code: 'LX-2026-011', name: 'Balkon korkuluğu', category: 'korkuluk', stage: 'teslim_edildi' })
  mock.externalInsert('projects', { code: 'LX-2026-012', name: 'PVC pencere', category: 'pvc_dograma', stage: 'teklif_gonderildi', location: 'Bornova' })
  await login(page, OWNER, '/projeler')
  await page.getByText('Çelik kapı montajı').first().waitFor()
  expect((await page.getByText('Balkon korkuluğu').count()) === 0, 'tamamlanan proje aktif listede görünüyor')
  await page.getByLabel('Aşama filtresi').selectOption('teklif')
  await eventually(async () => (await page.getByText('Çelik kapı montajı').count()) === 0 && (await page.getByText('PVC pencere').count()) > 0, 'teklif bekleyen filtresi çalışmadı')
  await page.getByLabel('Aşama filtresi').selectOption('tumu')
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
  mock.externalUpdate('projects', p.id, { stage: 'montajda' })
  await page.getByText(/Yeni fırsat → Montajda/).waitFor({ timeout: 3000 })
  // Eski sürümde açık kalmış istemci yalnız "status" yazarsa aşama da eşitlenir
  mock.externalUpdate('projects', p.id, { status: 'tamamlandi' })
  await page.getByText(/Montajda → Tamamlandı/).waitFor({ timeout: 3000 })
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
  await page.getByRole('heading', { name: 'Ayarlar', exact: true }).waitFor()
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
  await page.getByRole('heading', { name: 'Ayarlar', exact: true }).waitFor()
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
    await ipad.page.getByLabel('Proje aşamasını değiştir').selectOption('montajda')
    await win.getByText(/Yeni fırsat → Montajda/).waitFor({ timeout: 4000 })

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


// ================================================================== Faz 7: iş akışı, görevler, bildirimler
await test('Faz 7: aşama panosu, görev ve termin, zaman çizelgesi; bildirim zili ve okundu durumu cihazlar arası eşitlenir', async ({ page, mock, consoleErrors }) => {
  const c = mock.externalInsert('companies', { name: 'Akış Yapı' })
  const p = mock.externalInsert('projects', { code: 'LX-2026-701', name: 'Akış projesi', category: 'aluminyum_dograma', company_id: c.id })
  const ipad = await openDevice(mock, devices['iPad Pro 11 landscape'])
  try {
    await login(page, OWNER, '/projeler?gorunum=kanban')
    await login(ipad.page, OWNER, '/projeler?gorunum=kanban')
    await page.getByTestId('project-kanban').waitFor()
    await ipad.page.locator('[data-testid="kanban-column"][data-stage="yeni_firsat"] [data-code="LX-2026-701"]').waitFor()
    // Panoda aşama değiştir (dokunmatik uyumlu seçim) → diğer cihaz anında görür
    await page.locator('[data-code="LX-2026-701"]').getByTestId('kanban-move').selectOption('teklif_hazirlaniyor')
    await eventually(() => mock.db.projects[0].stage === 'teklif_hazirlaniyor' && mock.db.projects[0].status === 'teklif', 'aşama kaydedilmedi', 4000)
    await ipad.page.locator('[data-testid="kanban-column"][data-stage="teklif_hazirlaniyor"] [data-code="LX-2026-701"]').waitFor({ timeout: 4000 })

    // Görev: hazır şablon + geçmiş termin → gecikmiş olarak görünür
    await page.goto(`${BASE}/projeler/${p.id}`)
    await page.getByTestId('task-add').click()
    const d = page.getByRole('dialog', { name: 'Yeni görev' })
    await d.getByRole('button', { name: 'Yerinde ölçü alınacak' }).click()
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    await d.getByTestId('task-due').fill(yesterday)
    await d.getByTestId('task-submit').click()
    await page.locator('[data-testid="task-row"][data-state="gecikti"]').getByText('Yerinde ölçü alınacak').waitFor()
    expect(mock.db.project_tasks.length === 1, 'görev kaydedilmedi')

    // Hatırlatma taraması (uygulama açılışında da çalışır): gecikme bildirimi bir kez oluşur
    await page.reload()
    await eventually(() => mock.db.notifications.filter((n) => n.kind === 'gorev_gecikti').length === 1, 'gecikme bildirimi oluşmadı', 6000)
    await page.reload()
    await page.getByRole('heading', { name: 'Akış projesi' }).waitFor()
    await new Promise((r) => setTimeout(r, 800))
    expect(mock.db.notifications.filter((n) => n.kind === 'gorev_gecikti').length === 1, 'gecikme bildirimi tekrarlandı')

    // Görev tamamlanınca zaman çizelgesine yazılır
    await page.getByTestId('task-toggle').first().click()
    await page.locator('[data-testid="timeline-event"][data-kind="gorev_tamam"]').waitFor({ timeout: 4000 })
    await page.locator('[data-testid="timeline-event"][data-kind="asama"]').waitFor()

    // Bildirim zili: iki cihazda aynı okunmamış sayısı; birinde okununca diğerinde düşer
    const unread = mock.db.notifications.filter((n) => !n.read_at).length
    expect(unread >= 3, `okunmamış bildirim ${unread}`)
    await ipad.page.goto(`${BASE}/`)
    await eventually(async () => (await ipad.page.getByTestId('notification-count').textContent()) === String(unread), 'iPad okunmamış sayısı farklı', 5000)
    await page.getByTestId('notification-bell').click()
    await page.getByTestId('notification-panel').getByText(/Görev gecikti: Yerinde ölçü alınacak/).waitFor()
    await page.getByTestId('notification-read-all').click()
    await eventually(() => mock.db.notifications.every((n) => n.read_at), 'okundu sunucuya yazılmadı', 4000)
    await eventually(async () => (await ipad.page.getByTestId('notification-count').count()) === 0, 'iPad okundu durumunu almadı', 5000)

    // Bildirime dokununca ilgili ekran açılır (görevler bölümü)
    const late = mock.db.notifications.find((n) => n.kind === 'gorev_gecikti')
    mock.externalUpdate('notifications', late.id, { read_at: null })
    await page.goto(`${BASE}/bildirimler`)
    await page.getByTestId('notification-list').getByText(/Görev gecikti/).click()
    await page.waitForURL(new RegExp(`/projeler/${p.id}\\?sekme=gorevler`))
    await eventually(() => mock.db.notifications.find((n) => n.id === late.id).read_at, 'açılan bildirim okundu yapılmadı', 4000)

    // Panel: geciken görev kartı tıklanabilir ve filtreli ekrana gider (görev tamamlandığı için 0)
    await page.goto(`${BASE}/`)
    await page.locator('[data-kpi="Teklif bekleyen"]').getByText('1').waitFor()
    await page.locator('[data-kpi="Geciken görev"]').click()
    await page.waitForURL(/\/gorevler\?filtre=geciken/)
    await page.getByText('Geciken görev yok').waitFor()
    const unexpected = consoleErrors.filter((e) => !/WebSocket|realtime/i.test(e))
    expect(unexpected.length === 0, `konsol hataları: ${unexpected.join(' | ')}`)
  } finally {
    await ipad.ctx.close()
  }
}, { viewport: { width: 1440, height: 900 } })

await test('Bildirim ayarları: tercihler sunucuda saklanır ve uygulanır; push sunucusu hazır değilse açıkça söylenir', async ({ page, mock }) => {
  await login(page, OWNER, '/bildirimler')
  await page.getByTestId('notification-settings').waitFor()
  await page.getByRole('switch', { name: 'Proje bildirimleri' }).click()
  await eventually(() => mock.db.notification_prefs[0]?.cat_proje === false, 'tercih kaydedilmedi', 4000)
  mock.externalInsert('companies', { name: 'Sessiz Firma' })
  expect(!mock.db.notifications.some((n) => n.title.includes('Sessiz Firma')), 'kapalı kategoride bildirim oluştu')
  await page.getByRole('switch', { name: 'Proje bildirimleri' }).click()
  await eventually(() => mock.db.notification_prefs[0]?.cat_proje === true, 'tercih geri açılmadı', 4000)
  mock.externalInsert('companies', { name: 'Sesli Firma' })
  await page.getByTestId('notification-list').getByText('Yeni müşteri: Sesli Firma').waitFor({ timeout: 4000 })
  // Push: sunucu anahtarı henüz üretilmemişse izin istenmeden açıklama gösterilir
  const enable = page.getByTestId('push-enable')
  if (await enable.count()) {
    await enable.click()
    await page.getByText(/Push sunucusu henüz hazırlanıyor/).waitFor()
  } else {
    await page.getByTestId('push-unsupported').waitFor()
  }
  expect(mock.db.push_subscriptions.length === 0, 'izin/anahtar olmadan abonelik kaydedildi')
  // Push çalışanı uygulamanın kendi kaynağından, önbellek tutmadan sunulur
  const sw = await page.request.get(`${BASE}/sw.js`)
  expect(sw.ok() && /javascript/.test(sw.headers()['content-type'] ?? '') && !(await sw.text()).includes("addEventListener('fetch'"), 'sw.js yok veya fetch yakalıyor')
}, { viewport: { width: 1366, height: 900 } })

await test('Teklif kabul edilince proje aşaması otomatik değişmez; kullanıcıya önerilir', async ({ page, mock }) => {
  const c = mock.externalInsert('companies', { name: 'Kabul Müşterisi' })
  const pr = mock.externalInsert('projects', { code: 'LX-2026-702', name: 'Kabul projesi', category: 'pvc_dograma', company_id: c.id, stage: 'teklif_gonderildi' })
  const { quote } = seedQuote(mock, { company: c, projectId: pr.id })
  mock.externalUpdate('quotes', quote.id, { status: 'gonderildi' })
  await login(page, OWNER, `/teklifler/${quote.id}`)
  await page.getByTestId('quote-no').waitFor()
  await page.getByLabel(/Teklif durumu/).selectOption('kabul')
  await page.getByRole('dialog', { name: 'Proje aşaması güncellensin mi?' }).waitFor()
  expect(mock.db.projects[0].stage === 'teklif_gonderildi', 'aşama kendiliğinden değişti')
  expect(mock.db.project_events.some((e) => e.kind === 'teklif_kabul'), 'kabul olayı zaman çizelgesine yazılmadı')
  await page.getByTestId('confirm-ok').click()
  await eventually(() => mock.db.projects[0].stage === 'onaylandi', 'aşama güncellenmedi', 4000)
})

// ================================================================== Faz 5.1: mimari PDF analizi
const PDF_FX = path.join(ROOT, 'src/cad/__fixtures__/pdf')

await test('Mimari PDF: tüm sayfalar okunur, otomatik analiz, çizelge+plan adetleri, sayfa geçişi, düzenleme, onay, projeye kayıt ve teklife aktarma', async ({ page, mock, consoleErrors }) => {
  const company = mock.externalInsert('companies', { name: 'Örnek Konut Yapı' })
  const project = mock.externalInsert('projects', { code: 'LX-2026-551', name: 'Örnek konut doğramaları', category: 'pvc_dograma', company_id: company.id })
  await login(page, OWNER, '/cad-analiz')
  await page.getByTestId('cad-workspace').waitFor()
  await page.getByTestId('cad-toolbar-file-input').setInputFiles(path.join(PDF_FX, 'mimari_cok_sayfali.pdf'))
  await page.getByTestId('cad-canvas').waitFor({ timeout: 20000 })
  // Sayfa seçici: 5 sayfa, pafta adlarıyla
  const options = await page.getByTestId('pdf-page-select').locator('option').allInnerTexts()
  expect(options.length === 5, `sayfa sayısı ${options.length}`)
  expect(options.some((o) => /ZEMİN KAT PLANI/.test(o)) && options.some((o) => /DOĞRAMA ÇİZELGESİ/.test(o)) && options.some((o) => /boş/.test(o)), `sayfa adları: ${options.join(' | ')}`)
  // Analiz kendiliğinden başlar ve sonuç tablosu dolar (boş ekran yok)
  await page.getByTestId('result-row').first().waitFor({ timeout: 20000 })
  const rows = await page.getByTestId('result-row').count()
  expect(rows === 6, `aday satırı ${rows}`)
  const p1 = page.locator('[data-testid="result-row"][data-poz="P1"]')
  expect((await p1.getByTestId('result-total').innerText()).includes('9,00 m²'), `P1 toplamı: ${await p1.getByTestId('result-total').innerText()}`)
  const s1 = page.locator('[data-testid="result-row"][data-poz="S1"]')
  expect(/çizelge 2 \/ plan 1/.test(await s1.innerText()), 'S1 çizelge/plan farkı gösterilmedi')
  // Sol panel: okuma özeti ve analiz durumu
  await page.getByRole('tab', { name: /Pozlar/ }).click()
  expect(/5 sayfa/.test(await page.getByTestId('pdf-read-summary').innerText()), 'okuma özeti yok')
  expect(/Analiz yapıldı · 4 sayfa · 6 aday/.test(await page.getByTestId('pdf-analysis-status').innerText()), `durum: ${await page.getByTestId('pdf-analysis-status').innerText()}`)
  // Satıra dokununca planın bulunduğu sayfaya geçilir
  await page.getByTestId('pdf-page-select').locator('select').selectOption('4')
  await eventually(async () => (await page.getByTestId('pdf-page-select').locator('select').inputValue()) === '4', 'sayfa 4 açılmadı', 8000)
  await p1.click()
  await eventually(async () => ['1', '2'].includes(await page.getByTestId('pdf-page-select').locator('select').inputValue()), 'P1 için plan sayfasına geçilmedi', 8000)
  // Düzenleme: S1 adedini 1 yap, onayla
  await s1.getByTestId('result-count').fill('1')
  await s1.getByTestId('result-count').press('Enter')
  await eventually(async () => /3,00 × 2,20|6,60 m²/.test(await s1.getByTestId('result-total').innerText()), `S1 toplamı güncellenmedi: ${await s1.getByTestId('result-total').innerText()}`, 3000)
  await s1.getByTestId('result-approve').click()
  await p1.getByTestId('result-approve').click()
  // Kapsam dışı/malzemesiz aday onaylanamaz
  expect(await page.locator('[data-testid="result-row"][data-poz="K1"]').getByTestId('result-approve').isDisabled(), 'K1 (ahşap) onaylanabiliyor')
  await eventually(async () => /Metrajda · Onaylı/.test(await p1.innerText()), 'P1 metraja onaylı eklenmedi', 4000)
  // Projeye kaydet → teklife aktar
  await page.getByTestId('bind-open').click()
  await page.getByTestId('bind-project').selectOption(project.id)
  await page.getByTestId('bind-submit').click()
  await eventually(() => mock.db.quantity_items.length === 2, `sunucuya yazılan poz ${mock.db.quantity_items.length}`, 8000)
  const p1row = mock.db.quantity_items.find((i) => i.poz_code === 'P1')
  expect(p1row.width_mm === 1200 && p1row.height_mm === 1500 && p1row.quantity === 5 && p1row.verification === 'onaylandi' && p1row.category === 'pvc_pencere', `P1 kaydı: ${JSON.stringify(p1row)}`)
  expect(p1row.drawing_ref?.source === 'cizelge' && p1row.drawing_ref.box_pages?.length > 0, 'P1 çizim bağlantısı/sayfa bilgisi yok')
  const s1row = mock.db.quantity_items.find((i) => i.poz_code === 'S1')
  expect(s1row.quantity === 1 && s1row.category === 'surme', `S1 kaydı: ${JSON.stringify(s1row)}`)
  expect(mock.db.cad_analyses[0]?.summary?.pdf?.sayfalar?.length === 5, 'analiz kaydında sayfa özeti yok')
  await page.getByRole('tab', { name: /Metraj · Rev 1/ }).click()
  await page.getByTestId('send-to-quote').click()
  await page.getByTestId('send-quote-submit').click()
  await page.waitForURL(/\/teklifler\/[0-9a-f-]+$/, { timeout: 10000 })
  await eventually(() => mock.db.quote_items.length === 2, `teklif kalemi ${mock.db.quote_items.length}`, 6000)
  const qi = mock.db.quote_items.find((i) => i.poz_code === 'P1')
  expect(qi.width_mm === 1200 && qi.height_mm === 1500 && qi.quantity === 5 && qi.unit === 'm2' && qi.source === 'metraj' && qi.measure_verified === true, `teklif kalemi: ${JSON.stringify(qi)}`)
  expect(mock.db.quotes[0].project_id === project.id && mock.db.quotes[0].company_id === company.id, 'teklif projeye/müşteriye bağlanmadı')
  const unexpected = consoleErrors.filter((e) => !/WebSocket|realtime/i.test(e))
  expect(unexpected.length === 0, `konsol hataları: ${unexpected.join(' | ')}`)
}, { viewport: { width: 1440, height: 900 } })

await test('Taranmış PDF: OCR olmadan nedeni açıklanır; OCR (üretim CSP altında, kendi sunucudan) ile poz etiketleri okunur', async ({ page, consoleErrors }) => {
  const external = []
  page.on('request', (r) => !r.url().startsWith('http://localhost') && !r.url().includes('supabase') && external.push(r.url()))
  await login(page, OWNER, '/cad-analiz')
  await page.getByTestId('cad-workspace').waitFor()
  await page.getByTestId('cad-toolbar-file-input').setInputFiles(path.join(PDF_FX, 'taranmis_plan.pdf'))
  await page.getByTestId('cad-canvas').waitFor({ timeout: 20000 })
  await page.getByRole('tab', { name: /Pozlar/ }).click()
  await page.getByTestId('pdf-why-none').waitFor({ timeout: 15000 })
  expect(/OCR/.test(await page.getByTestId('pdf-why-none').innerText()), 'OCR önerisi yok')
  await page.getByTestId('pdf-ocr-toggle').check()
  await page.getByTestId('poz-detect').click()
  await page.getByTestId('result-row').first().waitFor({ timeout: 120000 })
  const codes = await page.getByTestId('result-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-poz')))
  expect(codes.includes('P1') && codes.includes('KP1'), `OCR adayları: ${codes.join(', ')}`)
  expect(/OCR/.test(await page.getByTestId('pdf-diagnostics').innerText()), 'OCR uyarısı gösterilmedi')
  expect(external.length === 0, `harici istek: ${external.join(', ')}`)
  const unexpected = consoleErrors.filter((e) => !/WebSocket|realtime/i.test(e))
  expect(unexpected.length === 0, `konsol / CSP hataları: ${unexpected.join(' | ')}`)
}, { viewport: { width: 1440, height: 900 } })

await test('Faz 5.2: AutoCAD yazı-çizgi paftası ve görüntü çizelge — neden söylenir, karo OCR ile pozlar okunur (kendi sunucudan, harici istek yok)', async ({ page, consoleErrors }) => {
  const external = []
  page.on('request', (r) => !r.url().startsWith('http://localhost') && !r.url().includes('supabase') && external.push(r.url()))
  await login(page, OWNER, '/cad-analiz')
  await page.getByTestId('cad-workspace').waitFor()
  await page.getByTestId('cad-toolbar-file-input').setInputFiles(path.join(PDF_FX, 'autocad_shx_plan.pdf'))
  await page.getByTestId('cad-canvas').waitFor({ timeout: 20000 })
  await page.getByRole('tab', { name: /Pozlar/ }).click()
  await page.getByTestId('pdf-why-none').waitFor({ timeout: 15000 })
  const why = await page.getByTestId('pdf-why-none').innerText()
  expect(/çizgi olarak gömülü/.test(why) && !/Çizimde yazı yok/.test(why), `neden yanlış: ${why}`)
  expect(/OCR/.test(await page.getByTestId('pdf-ocr-box').innerText()), 'OCR seçeneği gösterilmedi')
  expect(/girdi gerekli/.test(await page.getByTestId('pdf-report').innerText()), 'tanı raporunda kritik girdi yok')
  await page.getByTestId('pdf-run-ocr').click()
  await page.locator('[data-testid="result-row"][data-poz="P1"]').waitFor({ timeout: 120000 })
  const p1 = page.locator('[data-testid="result-row"][data-poz="P1"]')
  expect((await p1.getByTestId('result-total').innerText()).includes('5,40 m²'), `P1 toplamı (1,2 × 1,5 × 3): ${await p1.getByTestId('result-total').innerText()}`)
  const codes = await page.getByTestId('result-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-poz')))
  expect(['P1', 'P2', 'S1'].every((c) => codes.includes(c)), `SHX OCR adayları: ${codes.join(', ')}`)
  // Karma pafta: çizelge görüntüde; OCR ile adet ve malzeme çizelgeden gelir
  await page.getByTestId('cad-toolbar-file-input').setInputFiles(path.join(PDF_FX, 'karma_cizelge_raster.pdf'))
  await page.getByTestId('cad-canvas').waitFor({ timeout: 20000 })
  await page.getByRole('tab', { name: /Pozlar/ }).click()
  await page.getByTestId('pdf-ocr-toggle').check()
  await page.getByTestId('poz-detect').click()
  await eventually(async () => /Çizelge \+ plan/.test(await page.locator('[data-testid="result-row"][data-poz="P1"]').innerText().catch(() => '')), 'karma: çizelge okunmadı', 120000)
  const p1k = page.locator('[data-testid="result-row"][data-poz="P1"]')
  expect((await p1k.getByTestId('result-category').inputValue()) === 'pvc_pencere', 'karma: P1 malzemesi çizelgeden okunmadı')
  expect(external.length === 0, `harici istek: ${external.join(', ')}`)
  const unexpected = consoleErrors.filter((e) => !/WebSocket|realtime/i.test(e))
  expect(unexpected.length === 0, `konsol / CSP hataları: ${unexpected.join(' | ')}`)
}, { viewport: { width: 1440, height: 900 } })

await test('Mühendislik incelemesi: pafta listesi, çelişki kararı, Onayla / Düzelt / Belirsiz / Reddet; onay ve ilk değer sunucuda; çelişki bildirimi', async ({ page, mock, consoleErrors }) => {
  const company = mock.externalInsert('companies', { name: 'Örnek Apartman Yapı' })
  const project = mock.externalInsert('projects', { code: 'LX-2026-552', name: 'Örnek apartman doğramaları', category: 'pvc_dograma', company_id: company.id })
  await login(page, OWNER, '/cad-analiz')
  await page.getByTestId('cad-workspace').waitFor()
  await page.getByTestId('cad-toolbar-file-input').setInputFiles(path.join(PDF_FX, 'dograma_listesi_kart.pdf'))
  await page.getByTestId('cad-canvas').waitFor({ timeout: 20000 })
  await page.locator('[data-testid="result-row"][data-poz="P-03"]').waitFor({ timeout: 20000 })
  expect((await page.getByTestId('result-row').count()) === 6, `aday satırı ${await page.getByTestId('result-row').count()}`)
  // İnceleme modu: pafta listesi (önizlemeli) ve sağ panel
  await page.getByTestId('review-mode').click()
  await page.getByTestId('sheets-panel').waitFor()
  expect((await page.getByTestId('sheet-row').count()) === 2, 'pafta listesi')
  expect(/4 kat/.test(await page.locator('[data-testid="sheet-row"][data-page="2"]').innerText()), 'kat çarpanı paftada gösterilmedi')
  await eventually(async () => (await page.getByTestId('sheets-panel').locator('img').count()) >= 1, 'pafta önizlemesi çizilmedi', 8000)
  // P-03: liste 9, plan 2×4=8 — çelişki kullanıcıya bırakılır
  await page.locator('[data-testid="result-row"][data-poz="P-03"]').click()
  const panel = page.getByTestId('review-panel')
  await panel.waitFor()
  const conf = await panel.getByTestId('review-conflicts').innerText()
  expect(/8 adet/.test(conf) && /9 adet/.test(conf), `çelişki: ${conf}`)
  expect(/Tekil doğrama alanı/.test(await panel.getByTestId('review-calc').innerText()), 'hesap açıklaması yok')
  expect(/Vasistas/.test(await panel.getByTestId('review-attrs').innerText()), 'açılım özelliği yok')
  await panel.getByRole('button', { name: /Plan: 8 adet/ }).click()
  await eventually(async () => /ADET\s*8\b/i.test(await panel.innerText()), 'plan adedi seçilemedi', 3000)
  await panel.getByRole('button', { name: /Çizelge: 9 adet/ }).click()
  await eventually(async () => /ADET\s*9\b/i.test(await panel.innerText()), 'çizelge adedi seçilemedi', 3000)
  await panel.getByTestId('review-note').fill('Liste adedi esas alındı')
  await panel.getByTestId('review-approve').click()
  await eventually(async () => (await panel.getByTestId('review-status').innerText()) === 'Onaylandı', 'P-03 onaylanmadı', 4000)
  // K-01: Düzelt (en 900 → 910), sonra Belirsiz
  await page.locator('[data-testid="result-row"][data-poz="K-01"]').click()
  await eventually(async () => (await panel.getByTestId('review-code').innerText()) === 'K-01', 'K-01 seçilmedi', 3000)
  await panel.getByTestId('review-edit-toggle').click()
  await panel.getByTestId('review-width').fill('910')
  await panel.getByTestId('review-width').blur()
  await eventually(async () => /910 mm/.test(await page.locator('[data-testid="result-row"][data-poz="K-01"]').innerText()) || (await page.locator('[data-testid="result-row"][data-poz="K-01"]').getByTestId('result-width').inputValue().catch(() => '')) === '910', 'K-01 düzeltilmedi', 3000)
  await panel.getByTestId('review-uncertain').click()
  await eventually(async () => (await panel.getByTestId('review-status').innerText()) === 'Belirsiz', 'K-01 belirsiz işaretlenmedi', 4000)
  // CP-01: Reddet → öneriler listesinden çıkar
  await page.locator('[data-testid="result-row"][data-poz="CP-01"]').click()
  await eventually(async () => (await panel.getByTestId('review-code').innerText()) === 'CP-01', 'CP-01 seçilmedi', 3000)
  await panel.getByTestId('review-reject').click()
  await eventually(async () => (await page.locator('[data-testid="result-row"][data-poz="CP-01"]').count()) === 0, 'CP-01 reddedilmedi', 3000)
  // Projeye kaydet: onay bilgisi ve ilk değerler sunucuda
  await page.getByTestId('bind-open').click()
  await page.getByTestId('bind-project').selectOption(project.id)
  await page.getByTestId('bind-submit').click()
  await eventually(() => mock.db.quantity_items.length === 2, `sunucuya yazılan poz ${mock.db.quantity_items.length}`, 8000)
  const p3 = mock.db.quantity_items.find((i) => i.poz_code === 'P-03')
  expect(p3.verification === 'onaylandi' && p3.approved_by === OWNER.id && p3.approved_at && p3.quantity === 9 && p3.review_note === 'Liste adedi esas alındı', `P-03: ${JSON.stringify(p3)}`)
  expect(p3.original?.quantity === 9 && p3.detection?.attrs?.malzeme?.status === 'dogrulandi' && p3.detection?.conflicts?.[0]?.kind === 'adet', `P-03 izlenebilirlik: ${JSON.stringify({ o: p3.original, d: p3.detection })}`)
  const k1 = mock.db.quantity_items.find((i) => i.poz_code === 'K-01')
  expect(k1.uncertain === true && k1.verification === 'bekliyor' && !k1.approved_by && k1.width_mm === 910 && k1.original?.width_mm === 900, `K-01: ${JSON.stringify(k1)}`)
  const an = mock.db.cad_analyses[0]
  expect(/^[0-9a-f]{64}$/.test(an?.file_hash ?? '') && an.summary?.tespit?.celiski === 1, `analiz kaydı: ${JSON.stringify({ h: an?.file_hash, t: an?.summary?.tespit?.celiski })}`)
  expect(mock.db.notifications.some((n) => n.kind === 'cad_celiski') && mock.db.notifications.some((n) => n.kind === 'metraj_dogrulama'), 'çelişki / doğrulama bildirimi yok')
  // Kayıtlı poz incelemede: kullanıcı düzeltmesi görünür
  await page.getByRole('tab', { name: /Metraj · Rev 1/ }).click()
  const unexpected = consoleErrors.filter((e) => !/WebSocket|realtime/i.test(e))
  expect(unexpected.length === 0, `konsol hataları: ${unexpected.join(' | ')}`)
}, { viewport: { width: 1440, height: 900 } })

await test('PDF tanılama: yazısız planda neden ve elle ölçüm seçeneği; bozuk PDF açıklamalı hata; iPad yerleşimi taşmaz', async ({ page, consoleErrors }) => {
  await login(page, OWNER, '/cad-analiz')
  await page.getByTestId('cad-workspace').waitFor()
  await page.getByTestId('cad-toolbar-file-input').setInputFiles(path.join(PDF_FX, 'plan_etiketsiz.pdf'))
  await page.getByTestId('cad-canvas').waitFor({ timeout: 20000 })
  await page.getByRole('tab', { name: /Pozlar/ }).click()
  await page.getByTestId('pdf-why-none').waitFor({ timeout: 15000 })
  expect(/yazı yok/.test(await page.getByTestId('pdf-why-none').innerText()), 'neden açıklanmadı')
  await page.getByTestId('pdf-manual-calibrate').waitFor()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow <= 1, `yatay taşma ${overflow}px`)
  await page.getByTestId('cad-toolbar-file-input').setInputFiles(path.join(PDF_FX, 'bozuk.pdf'))
  await page.getByText(/PDF okunamadı/).first().waitFor({ timeout: 15000 })
  const unexpected = consoleErrors.filter((e) => !/WebSocket|realtime|Invalid PDF|PDF header|XRef|Warning/i.test(e))
  expect(unexpected.length === 0, `konsol hataları: ${unexpected.join(' | ')}`)
}, { viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

// ================================================================== Teklifler (Faz 6)
const YEAR = new Date().getFullYear()
function seedQuote(mock, o = {}) {
  const company = o.company ?? mock.externalInsert('companies', { name: 'Güneş Yapı A.Ş.', city: 'İzmir' })
  const quote = mock.externalInsert('quotes', { company_id: company.id, project_id: o.projectId ?? null, title: o.title ?? 'Ofis binası doğrama teklifi', quote_date: new Date().toISOString().slice(0, 10), vat_pct: 20, ...o.quote })
  for (const [i, it] of (o.items ?? [{ poz_code: 'P1', description: 'Alüminyum pencere', unit: 'm2', width_mm: 1500, height_mm: 2000, quantity: 4, unit_price: 1000 }]).entries()) {
    mock.externalInsert('quote_items', { quote_id: quote.id, sort_order: i, ...it })
  }
  return { company, quote }
}

await test('Teklif: oluşturma, otomatik numara, kalem (150×200 cm×4 = 12 m²), maliyet, indirim, KDV, kaydet, PDF ve Excel', async ({ page, mock, consoleErrors }) => {
  const company = mock.externalInsert('companies', { name: 'Örnek İnşaat Ltd. Şti.' })
  const project = mock.externalInsert('projects', { code: 'LX-2026-700', name: 'Güneş Bloğu', category: 'cephe', company_id: company.id })
  await login(page, OWNER, '/teklifler')
  await page.getByRole('heading', { name: 'Henüz teklif yok' }).waitFor()
  await page.getByTestId('quote-new').click()
  const d = page.getByRole('dialog', { name: 'Yeni teklif' })
  await d.getByTestId('quote-create').click()
  await d.getByText('Müşteri (firma) seçin.').waitFor()
  await d.getByLabel('Proje').selectOption(project.id)
  expect((await d.getByLabel('Müşteri (firma)').inputValue()) === company.id, 'proje seçilince müşteri dolmadı')
  expect((await d.getByLabel('Teklif başlığı').inputValue()) === 'Güneş Bloğu', 'başlık projeden gelmedi')
  await d.getByTestId('quote-create').click()
  await page.getByTestId('quote-no').getByText(`TKL-${YEAR}-0001 · Rev 1`).waitFor()
  const q = mock.db.quotes[0]
  expect(q.project_id === project.id && q.vat_pct === 20 && q.status === 'taslak', 'teklif alanları hatalı')

  // Kalem 1: cm ile ölçü, elle birim fiyat
  await page.getByTestId('quote-add-item').click()
  const f = page.getByRole('dialog', { name: 'Kalem ekle' })
  await f.getByTestId('qi-poz').fill('P1')
  await f.getByTestId('qi-description').fill('Isı yalıtımlı alüminyum pencere')
  await f.getByTestId('qi-unit').selectOption('m2')
  await f.getByTestId('qi-dimunit').selectOption('cm')
  await f.getByTestId('qi-width').fill('150')
  await f.getByTestId('qi-height').fill('200')
  await f.getByTestId('qi-quantity').fill('4')
  await f.getByTestId('qi-manual-price').check()
  await f.getByTestId('qi-price').fill('1000')
  await f.getByTestId('qi-preview').getByText(/12,000/).waitFor()
  await f.getByTestId('qi-save').click()
  await page.getByTestId('qi-qty').first().getByText('12,000 m²').waitFor()
  const it1 = mock.db.quote_items[0]
  expect(it1.width_mm === 1500 && it1.height_mm === 2000 && it1.dim_unit === 'cm', `ölçü mm olarak kaydedilmedi: ${it1.width_mm}×${it1.height_mm}`)

  // Kalem 2: maliyetten fiyat (fire malzemeye, genel gider, kâr oranı)
  await page.getByTestId('quote-add-item').click()
  await f.getByTestId('qi-description').fill('Çelik kapı')
  await f.getByTestId('qi-unit').selectOption('adet')
  await f.getByTestId('qi-quantity').fill('2')
  await f.getByTestId('qi-material').fill('1000')
  await f.getByTestId('qi-labor').fill('200')
  await f.getByTestId('qi-install').fill('150')
  await f.getByTestId('qi-save').click()
  await eventually(() => mock.db.quote_items.length === 2, 'ikinci kalem kaydedilmedi')

  // Fiyatlandırma: fire %5, genel gider %10, kâr %25, nakliye 500, %10 indirim, KDV %20
  await page.getByTestId('qe-waste').fill('5')
  await page.getByTestId('qe-overhead').fill('10')
  await page.getByTestId('qe-profit').fill('25')
  await page.getByTestId('qe-shipping').fill('500')
  await page.getByTestId('qe-discount-kind').selectOption('yuzde')
  await page.getByTestId('qe-discount').fill('10')
  await page.getByTestId('quote-savebar').waitFor()
  // canlı önizleme: 12.000 + 2×1.925 = 15.850 + 500 = 16.350 − 1.635 = 14.715 + KDV 2.943 = 17.658
  await page.getByTestId('tot-grand').getByText(/17\.658,00/).waitFor()
  await page.getByTestId('tot-markup').waitFor()
  await page.getByTestId('quote-save').click()
  await page.getByText('Teklif kaydedildi.').waitFor()
  const saved = mock.db.quotes[0]
  expect(saved.waste_pct === 5 && saved.overhead_pct === 10 && saved.profit_pct === 25 && saved.discount_kind === 'yuzde' && saved.discount_value === 10 && saved.shipping_amount === 500, 'fiyatlandırma kaydedilmedi')
  expect((await page.getByTestId('quote-savebar').count()) === 0, 'kaydettikten sonra kaydet çubuğu kaldı')
  await page.getByTestId('qi-total').nth(1).getByText(/3\.850,00/).waitFor()

  // Çıktılar
  const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByTestId('quote-pdf').click()])
  expect(new RegExp(`^TKL-${YEAR}-0001-Rev1-Gunes-Blogu\\.pdf$`).test(pdf.suggestedFilename()), `PDF adı: ${pdf.suggestedFilename()}`)
  const fs = await import('node:fs/promises')
  const pbytes = await fs.readFile(await pdf.path())
  expect(pbytes.subarray(0, 5).toString() === '%PDF-', 'PDF geçersiz')
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data: new Uint8Array(pbytes) }).promise
  let text = ''
  for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ')
  text = text.replace(/[  ]/g, ' ')
  expect(text.includes('FİYAT TEKLİFİ') && text.includes('Örnek İnşaat Ltd. Şti.') && /17\.658,00/.test(text), 'PDF içeriği/toplamı hatalı')
  const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByTestId('quote-xlsx').click()])
  expect((await fs.readFile(await xlsx.path())).subarray(0, 2).toString() === 'PK', 'Excel geçersiz')
  const unexpected = consoleErrors.filter((e) => !/WebSocket|realtime/i.test(e))
  expect(unexpected.length === 0, `konsol hataları: ${unexpected.join(' | ')}`)
}, { viewport: { width: 1440, height: 900 }, acceptDownloads: true })

await test('Teklif: gönderildi kilidi, revizyon, kopya, silme; diğer cihaz anında görür', async ({ page, mock }) => {
  const { quote } = seedQuote(mock)
  const ipad = await openDevice(mock, devices['iPad Pro 11'])
  try {
    await login(ipad.page, OWNER, '/teklifler')
    await ipad.page.getByText('Ofis binası doğrama teklifi').filter({ visible: true }).first().waitFor()
    await login(page, OWNER, `/teklifler/${quote.id}`)
    await page.getByTestId('quote-add-item').waitFor()
    await page.getByLabel('Teklif durumu').selectOption('gonderildi')
    await page.getByRole('button', { name: 'Onayla' }).click()
    await page.getByTestId('quote-locked').waitFor()
    expect((await page.getByTestId('quote-add-item').count()) === 0, 'kilitli teklifte kalem eklenebiliyor')
    expect(mock.db.quotes[0].status === 'gonderildi' && mock.db.quotes[0].sent_at, 'durum veya gönderim zamanı yazılmadı')
    await ipad.page.getByTestId('quote-status').filter({ visible: true }).getByText('Gönderildi').first().waitFor({ timeout: 5000 })

    // Revizyon: aynı numara Rev 2, eski kilitli
    await page.getByTestId('quote-revise').click()
    await page.getByTestId('quote-no').getByText(`TKL-${YEAR}-0001 · Rev 2`).waitFor()
    await page.getByTestId('quote-add-item').waitFor()
    const rev1 = mock.db.quotes.find((q) => q.revision === 1)
    const rev2 = mock.db.quotes.find((q) => q.revision === 2)
    expect(rev1.superseded && !rev2.superseded && mock.db.quote_items.filter((i) => i.quote_id === rev2.id).length === 1, 'revizyon kopyalanmadı veya eski kilitlenmedi')
    await page.getByTestId('quote-revisions').getByText('Rev 1').waitFor()
    await ipad.page.getByText('Rev 2').filter({ visible: true }).first().waitFor({ timeout: 5000 })

    // Rev 2'de fiyat değişikliği eski revizyonu etkilemez
    await page.getByTestId('qi-edit').first().click()
    const f = page.getByRole('dialog', { name: 'Kalemi düzenle' })
    await f.getByTestId('qi-price').fill('1100')
    await f.getByTestId('qi-save').click()
    await page.getByTestId('qi-total').first().getByText(/13\.200,00/).waitFor()
    expect(mock.db.quote_items.find((i) => i.quote_id === rev1.id).unit_price === 1000, 'eski revizyonun kalemi değişti')

    // Eski revizyon sayfası: salt okunur
    await page.goto(`${BASE}/teklifler/${rev1.id}`)
    await page.getByTestId('quote-superseded').waitFor()
    expect((await page.getByTestId('quote-revise').count()) === 0, 'eski revizyondan revizyon düğmesi var')

    // Kopya: yeni numara; taslak kopya silinebilir
    await page.getByTestId('quote-copy').click()
    await page.getByTestId('quote-no').getByText(`TKL-${YEAR}-0002 · Rev 1`).waitFor()
    await page.getByTestId('quote-delete').click()
    await page.getByRole('dialog', { name: 'Teklif silinsin mi?' }).getByRole('button', { name: 'Sil', exact: true }).click()
    await page.getByRole('heading', { name: 'Teklifler', exact: true }).waitFor()
    expect(mock.db.quotes.length === 2 && !mock.db.quotes.some((q) => q.quote_no.endsWith('0002')), 'kopya silinmedi')
    expect(mock.db.quote_history.some((h) => h.action === 'durum' && h.to_status === 'gonderildi'), 'durum geçmişi yazılmadı')
  } finally {
    await ipad.ctx.close()
  }
}, { viewport: { width: 1440, height: 900 } })

await test('Teklif: CAD metrajından aktarma; doğrulanmamış ölçü işaretlenir, reddedilen ve tekrar aktarım engellenir', async ({ page, mock }) => {
  const company = mock.externalInsert('companies', { name: 'Metraj Müşterisi' })
  const project = mock.externalInsert('projects', { code: 'LX-2026-710', name: 'Metraj projesi', category: 'pvc_dograma', company_id: company.id })
  const tk = mock.externalInsert('quantity_takeoffs', { project_id: project.id, name: 'Uygulama', revision: 1 })
  const base = { takeoff_id: tk.id, shape: 'dikdortgen', unit: 'm2', measure_basis: 'dograma', glass_mode: 'yok', quantity: 1, floor: null, space: null, description: null }
  mock.externalInsert('quantity_items', { ...base, poz_code: 'P1', category: 'al_pencere', width_mm: 1500, height_mm: 2000, quantity: 4, verification: 'onaylandi' })
  mock.externalInsert('quantity_items', { ...base, poz_code: 'KR1', category: 'korkuluk', unit: 'mtul', width_mm: 8400, height_mm: null, verification: 'bekliyor' })
  mock.externalInsert('quantity_items', { ...base, poz_code: 'X9', category: 'al_pencere', width_mm: 1000, height_mm: 1000, verification: 'reddedildi' })
  const { quote } = seedQuote(mock, { company, projectId: project.id, items: [] })
  await login(page, OWNER, `/teklifler/${quote.id}`)
  await page.getByTestId('quote-import').click()
  const d = page.getByRole('dialog', { name: 'Metrajdan aktar' })
  await d.getByTestId('import-row').nth(2).waitFor()
  // Varsayılan: yalnız onaylı poz seçili; doğrulanmamış poz kullanıcı isterse eklenir (işaretlenerek)
  await d.getByTestId('import-submit').getByText('1 pozu aktar').waitFor()
  await d.getByTestId('import-row').filter({ hasText: 'KR1' }).locator('input[type=checkbox]').check()
  await d.getByTestId('import-submit').getByText('2 pozu aktar').waitFor()
  await d.getByTestId('import-submit').click()
  await eventually(() => mock.db.quote_items.length === 2, 'pozlar aktarılmadı')
  const p1 = mock.db.quote_items.find((i) => i.poz_code === 'P1')
  const kr = mock.db.quote_items.find((i) => i.poz_code === 'KR1')
  expect(p1.source === 'metraj' && p1.measure_verified === true && p1.unit === 'm2' && kr.unit === 'mtul' && kr.measure_verified === false, 'kaynak/doğrulama aktarılmadı')
  await page.getByTestId('qi-row').filter({ hasText: 'P1' }).getByTestId('qi-qty').getByText('12,000 m²').waitFor()
  await page.getByTestId('qi-row').filter({ hasText: 'KR1' }).getByText('Ölçü doğrulanmadı').waitFor()
  await page.getByTestId('quote-warnings').getByText(/1 kalemin ölçüsü doğrulanmadı/).waitFor()
  // Tekrar açınca daha önce aktarılanlar seçili gelmez
  await page.getByTestId('quote-import').click()
  await d.getByTestId('import-row').nth(2).waitFor()
  await d.getByText('aktarıldı').first().waitFor()
  expect(await d.getByTestId('import-submit').isDisabled(), 'aynı pozlar yeniden seçili geldi')
}, { viewport: { width: 1440, height: 900 } })

await test('Teklif: tekliften proje oluşturma; proje ve firma sayfasında görünür; ayarlar yeni teklife uygulanır', async ({ page, mock }) => {
  mock.externalInsert('quote_settings', { id: 1, quote_prefix: 'LXT', default_vat_pct: 10, default_validity_days: 30, default_payment_terms: '%50 peşin, %50 teslimde.' })
  const company = mock.externalInsert('companies', { name: 'Ayar Test Firması' })
  await login(page, OWNER, `/firmalar/${company.id}`)
  await page.getByTestId('related-new-quote').click()
  const d = page.getByRole('dialog', { name: 'Yeni teklif' })
  await d.getByLabel('Teklif başlığı').fill('Cephe kaplama')
  await d.getByTestId('quote-create').click()
  await page.getByTestId('quote-no').getByText(`LXT-${YEAR}-0001 · Rev 1`).waitFor()
  const q = mock.db.quotes[0]
  expect(q.vat_pct === 10 && q.payment_terms === '%50 peşin, %50 teslimde.' && q.valid_until, 'ayarlardaki varsayılanlar uygulanmadı')
  await page.getByTestId('quote-create-project').click()
  const pd = page.getByRole('dialog', { name: 'Yeni proje' })
  // Ön doldurma diyalog açıldıktan hemen sonra yapılır: değer gelene kadar beklenir
  await eventually(async () => (await pd.getByLabel('Proje adı').inputValue()) === 'Cephe kaplama', 'proje adı tekliften gelmedi')
  await pd.getByLabel('İş kategorisi').selectOption('cephe')
  await pd.getByRole('button', { name: 'Projeyi oluştur' }).click()
  await page.getByTestId('quote-project-link').waitFor()
  const project = mock.db.projects[0]
  expect(mock.db.quotes[0].project_id === project.id && project.company_id === company.id, 'proje oluşturulmadı veya bağlanmadı')
  await page.getByTestId('quote-project-link').click()
  await page.getByTestId('related-quotes').getByText('Cephe kaplama').waitFor()
  await page.goto(`${BASE}/firmalar/${company.id}`)
  await page.getByTestId('related-quotes').getByText('Cephe kaplama').waitFor()
  // Teklifi olan firma silinemez (veri korunur)
  await page.getByRole('button', { name: 'Sil', exact: true }).click()
  await eventually(async () => (await page.getByRole('dialog').count()) > 0, 'silme diyaloğu açılmadı')
  expect(mock.db.companies.length === 1, 'teklifi olan firma silindi')
}, { viewport: { width: 1440, height: 900 } })

// ================================================================== Faz 8: finans
await test('Faz 8: bütçe, maliyet satırı, gider, ödeme planı ve tahsilat; kâr tahmini, bütçe aşımı bir kez, finans paneli güncellenir', async ({ page, mock, consoleErrors }) => {
  const c = mock.externalInsert('companies', { name: 'Finans Müşterisi' })
  const p = mock.externalInsert('projects', { code: 'LX-2026-801', name: 'Finans projesi', category: 'aluminyum_dograma', company_id: c.id, stage: 'uretimde' })
  const inTwoDays = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  await login(page, OWNER, `/projeler/${p.id}?sekme=finans`)
  await page.getByTestId('project-finance').waitFor()
  await page.getByTestId('fin-profit').getByText('—').waitFor()

  // Bütçe: KDV hariç satış 100.000 ₺
  await page.getByTestId('fin-budget-edit').click()
  const bd = page.getByRole('dialog', { name: 'Proje bütçesi' })
  await bd.getByTestId('budget-sale').fill('100.000')
  await bd.getByTestId('budget-form-submit').click()
  await eventually(() => mock.db.project_budgets[0]?.sale_net_amount === 100000 && mock.db.project_budgets[0]?.vat_pct === 20, 'bütçe kaydedilmedi')
  await page.getByTestId('fin-sale').getByText(/100\.000,00/).waitFor()

  // Tahmini maliyet satırı: 12 m² × 1.000 ₺ = 12.000 ₺ → tahmini kâr 88.000 ₺, marj %88
  await page.getByTestId('fin-line-add').click()
  const ld = page.getByRole('dialog', { name: 'Tahmini maliyet satırı' })
  await ld.getByTestId('cl-description').fill('Alüminyum profil')
  await ld.getByTestId('cl-quantity').fill('12')
  await ld.getByTestId('cl-cost').fill('1000')
  await ld.getByTestId('cost-line-form-submit').click()
  await page.getByTestId('fin-line-amount').getByText(/12\.000,00/).waitFor()
  await page.getByTestId('fin-est').getByText(/12\.000,00/).waitFor()
  await page.getByTestId('fin-profit').getByText(/88\.000,00/).waitFor()
  expect((await page.getByTestId('fin-profit').textContent()).includes('Tahmini'), 'kâr "tahmini" olarak etiketlenmedi')
  expect(/Marj %88/.test(await page.getByTestId('fin-profit').textContent()), 'marj hatalı')
  expect((await page.getByTestId('fin-realized').textContent()).includes('Proje kapanınca'), 'tamamlanmamış projede gerçekleşen kâr gösterildi')

  // Ödeme planı + tahsilat (otomatik dağıtım) → kısmi
  await page.getByTestId('fin-schedule-add').click()
  const sd = page.getByRole('dialog', { name: 'Ödeme planına ekle' })
  await sd.getByTestId('sc-due').fill(inTwoDays)
  await sd.getByTestId('sc-amount').fill('50000')
  await sd.getByTestId('schedule-form-submit').click()
  await page.locator('[data-testid="fin-schedule-status"][data-status="bekliyor"]').waitFor()
  await page.getByTestId('fin-collection-add').click()
  const cd = page.getByRole('dialog', { name: 'Tahsilat kaydı' })
  await cd.getByTestId('co-amount').fill('20000')
  await cd.getByTestId('collection-form-submit').click()
  await page.locator('[data-testid="fin-schedule-status"][data-status="kismi"]').waitFor()
  await page.getByTestId('fin-collected').getByText(/20\.000,00/).waitFor()
  expect(mock.db.project_collections.length === 1 && mock.db.project_collections[0].schedule_id === null, 'tahsilat kaydedilmedi')
  await page.locator('[data-testid="timeline-event"][data-kind="tahsilat"]').waitFor()

  // Gider 15.000 ₺ (tahmini 12.000'i aşar) → bütçe aşımı bildirimi BİR kez; ikinci gider aynı eşikte tekrar üretmez
  await page.getByTestId('fin-expense-add').click()
  const ed = page.getByRole('dialog', { name: 'Gerçekleşen gider' })
  await ed.getByTestId('ex-description').fill('Montaj ekibi')
  await ed.getByTestId('ex-amount').fill('15000')
  await ed.getByRole('button', { name: '%20' }).click()
  expect((await ed.getByTestId('ex-vat').inputValue()) === '3000,00', 'KDV hesaplanmadı')
  await ed.getByTestId('expense-form-submit').click()
  await page.getByTestId('fin-actual').getByText(/15\.000,00/).waitFor()
  await page.getByTestId('fin-variance').getByText(/3\.000,00/).waitFor()
  expect(mock.db.project_expenses[0].amount === 15000 && mock.db.project_expenses[0].vat_amount === 3000, 'gider tutarı/KDV ayrı kaydedilmedi')
  await eventually(() => mock.db.notifications.filter((n) => n.kind === 'butce_asildi').length === 1, 'bütçe aşımı bildirimi oluşmadı')
  await page.getByTestId('fin-expense-add').click()
  await ed.getByTestId('ex-description').fill('Nakliye')
  await ed.getByTestId('ex-amount').fill('100')
  await ed.getByTestId('expense-form-submit').click()
  await eventually(() => mock.db.project_expenses.length === 2, 'ikinci gider kaydedilmedi')
  expect(mock.db.notifications.filter((n) => n.kind === 'butce_asildi').length === 1, 'bütçe aşımı tekrarlandı')
  await page.locator('[data-testid="timeline-event"][data-kind="butce_asildi"]').waitFor()

  // Hatırlatma taraması (uygulama açılışında): vadesi 2 gün kalan taksit için tek bildirim
  await page.reload()
  await eventually(() => mock.db.notifications.filter((n) => n.kind === 'tahsilat_yaklasiyor').length === 1, 'tahsilat hatırlatması oluşmadı', 6000)

  // Finans paneli: sözleşme değeri, beklenen kâr, tahsilat ve kalan alacak; satır projeye götürür
  await page.goto(`${BASE}/finans`)
  await page.getByTestId('kpi-contract').getByText(/100\.000,00/).waitFor()
  await page.getByTestId('kpi-expected').getByText(/88\.000,00/).waitFor()
  await page.getByTestId('kpi-collected').getByText(/20\.000,00/).waitFor()
  await page.getByTestId('kpi-outstanding').getByText(/30\.000,00/).waitFor()
  await page.getByTestId('kpi-actual').getByText(/15\.100,00/).waitFor()
  await page.getByTestId('cashflow').waitFor()
  // Başka cihazdan gelen tahsilat panele canlı yansır
  mock.externalInsert('project_collections', { project_id: p.id, received_date: new Date().toISOString().slice(0, 10), amount: 5000, currency: 'TRY', method: 'nakit' })
  await page.getByTestId('kpi-collected').getByText(/25\.000,00/).waitFor({ timeout: 5000 })
  await page.locator('[data-testid="finance-row"][data-code="LX-2026-801"]').getByRole('link').first().click()
  await page.waitForURL(new RegExp(`/projeler/${p.id}\\?sekme=finans`))
  await page.getByTestId('project-finance').waitFor()
  const unexpected = consoleErrors.filter((e) => !/WebSocket|realtime/i.test(e))
  expect(unexpected.length === 0, `konsol hataları: ${unexpected.join(' | ')}`)
}, { viewport: { width: 1440, height: 900 } })

await test('Faz 8: kuru girilmemiş para birimi uyarısı, kur girilince birleşik toplam; onaylı metrajdan aktarım ve çift aktarım engeli', async ({ page, mock }) => {
  const c = mock.externalInsert('companies', { name: 'Kur Müşterisi' })
  const p = mock.externalInsert('projects', { code: 'LX-2026-802', name: 'Kur projesi', category: 'aluminyum_dograma', company_id: c.id, stage: 'uretimde' })
  mock.externalInsert('project_budgets', { project_id: p.id, currency: 'TRY', sale_net_amount: 50000, vat_pct: 20 })
  mock.externalInsert('project_cost_lines', { project_id: p.id, cost_group: 'cam', description: 'İthal cam', quantity: 1, unit: 'goturu', unit_cost: 100, currency: 'EUR', sort_order: 0 })
  mock.externalInsert('project_cost_lines', { project_id: p.id, cost_group: 'iscilik', description: 'İşçilik', quantity: 10, unit: 'saat', unit_cost: 500, currency: 'TRY', sort_order: 1 })
  await login(page, OWNER, `/projeler/${p.id}?sekme=finans`)
  // Kur yok: uyarı, para birimi bazında ara toplamlar, birleşik toplam ve kâr yok
  await page.getByTestId('fin-missing-rate').getByText(/EUR → TRY/).waitFor()
  const est = await page.getByTestId('fin-est').textContent()
  expect(/5\.000,00/.test(est) && /100,00/.test(est) && est.includes('€'), `para birimi bazında toplam yok: ${est}`)
  expect((await page.getByTestId('fin-est-total').count()) === 0, 'kur yokken birleşik toplam gösterildi')
  await page.getByText(/birleşik toplam gösterilmez/).waitFor()
  expect((await page.getByTestId('fin-profit').textContent()).includes('—'), 'kur yokken kâr hesaplandı')

  // Kur gir (kaynak zorunlu) → birleşik toplam: 100 € × 35 = 3.500 + 5.000 = 8.500 ₺
  await page.getByTestId('fin-missing-rate').getByRole('link', { name: 'Kur gir' }).click()
  await page.waitForURL(/\/finans\?bolum=kurlar/)
  await page.getByTestId('fx-rate').fill('35')
  await page.getByTestId('fx-submit').click()
  await page.getByText(/Kaynağı yazın/).waitFor()
  await page.getByTestId('fx-source').fill('TCMB döviz satış, elle girildi')
  await page.getByTestId('fx-submit').click()
  await page.getByTestId('fx-row').getByText(/1 EUR = 35,0000 TRY/).waitFor()
  expect(mock.db.fx_rates.length === 1 && mock.db.fx_rates[0].rate === 35 && mock.db.fx_rates[0].project_id === null, 'kur kaydedilmedi')
  await page.goto(`${BASE}/projeler/${p.id}?sekme=finans`)
  await page.getByTestId('fin-est-total').getByText(/8\.500,00/).waitFor()
  expect((await page.getByTestId('fin-missing-rate').count()) === 0, 'kur girildiği hâlde uyarı sürüyor')
  await page.getByTestId('fin-profit').getByText(/41\.500,00/).waitFor()

  // Onaylı metraj: yalnız onaylı pozlar; katalogda fiyatı olmayan iş "fiyat tanımlanmamış"
  const tk = mock.externalInsert('quantity_takeoffs', { project_id: p.id, name: 'Uygulama', revision: 1 })
  const base = { takeoff_id: tk.id, shape: 'dikdortgen', unit: 'm2', measure_basis: 'dograma', glass_mode: 'yok', quantity: 1, floor: null, space: null, description: null }
  mock.externalInsert('quantity_items', { ...base, poz_code: 'P1', category: 'al_pencere', width_mm: 1500, height_mm: 2000, quantity: 4, verification: 'onaylandi' })
  mock.externalInsert('quantity_items', { ...base, poz_code: 'P2', category: 'al_pencere', width_mm: 1000, height_mm: 1000, verification: 'bekliyor' })
  mock.externalInsert('quantity_items', { ...base, poz_code: 'KR1', category: 'korkuluk', unit: 'mtul', width_mm: 8400, height_mm: null, verification: 'onaylandi' })
  mock.externalInsert('cost_rates', { code: 'AL-PROF', name: 'Alüminyum doğrama', cost_group: 'profil', unit: 'm2', currency: 'TRY', unit_cost: 1000, quantity_category: 'al_pencere', valid_from: '2026-01-01' })
  // Taslak sürüm aktarılamaz
  await page.getByTestId('fin-import').click()
  const d = page.getByRole('dialog', { name: 'Metrajdan maliyete aktar' })
  await d.getByTestId('ti-not-approved').waitFor()
  expect(await d.getByTestId('ti-submit').isDisabled(), 'onaysız metraj aktarılabildi')
  await d.getByRole('button', { name: 'Vazgeç' }).click()
  mock.externalUpdate('quantity_takeoffs', tk.id, { status: 'onaylandi' })
  await page.getByTestId('fin-import').click()
  await d.locator('[data-testid="ti-row"]').nth(1).waitFor()
  await d.getByTestId('ti-excluded').getByText(/P2/).waitFor()
  await d.getByTestId('ti-excluded').getByText(/doğrulaması bekliyor/).waitFor()
  expect((await d.locator('[data-testid="ti-row"][data-needs-price="true"]').count()) === 1, 'fiyatsız satır işaretlenmedi')
  await d.getByTestId('ti-submit').getByText('2 satırı aktar').waitFor()
  await d.getByTestId('ti-submit').click()
  await eventually(() => mock.db.project_cost_lines.filter((l) => l.source === 'metraj').length === 2, 'metraj aktarılmadı')
  const metraj = mock.db.project_cost_lines.filter((l) => l.source === 'metraj')
  const prof = metraj.find((l) => l.cost_group === 'profil')
  const kr = metraj.find((l) => l.unit_cost === null)
  expect(prof && prof.quantity === 12 && prof.unit_cost === 1000 && prof.source_takeoff_id === tk.id, 'profil satırı hatalı')
  expect(kr && kr.quantity === 8.4 && kr.unit === 'mtul', 'fiyatsız satır sıfır yazıldı veya hatalı')
  await page.getByTestId('fin-unpriced').waitFor()
  await page.getByTestId('fin-line-unpriced').first().waitFor()
  // Tekrar açınca aynı pozlar önerilmez
  await page.getByTestId('fin-import').click()
  await d.getByTestId('ti-already').waitFor()
  expect(await d.getByTestId('ti-submit').isDisabled(), 'aynı metraj tekrar aktarılabilir')
}, { viewport: { width: 1366, height: 900 } })

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
          stage: 'uretimde',
          company_id: c.id,
          due_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
          location: 'Ataşehir, İstanbul',
        })
        const { quote: sq } = seedQuote(mock, { company: c, projectId: p.id, title: 'Çok uzun teklif başlığı: 24 katlı ofis kulesi giydirme cephe, alüminyum doğrama ve cam korkuluk işleri' })
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
          ['/teklifler', 'Teklifler'],
          [`/teklifler/${sq.id}`, sq.title],
          ['/finans', 'Finans'],
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
