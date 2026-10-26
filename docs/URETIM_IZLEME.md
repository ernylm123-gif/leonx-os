# Production erişim izleme, dağıtım kontrolü ve geri alma

## 1. iPhone Safari "güvenli bağlantı kurulamıyor" tanısı (26 Ekim 2026)

Safari bu iletiyi **TLS el sıkışması tamamlanamadığında** gösterir (bağlantı sıfırlanır, sertifika
doğrulanamaz veya araya giren bir ağ cihazı oturumu keser). Uygulama kodu, service worker veya
önbellek bu iletiyi üretemez: bunlar ancak TLS kurulduktan sonra devreye girer.

Sunucu tarafı ölçümler (GitHub Actions, `diag/mobil-erisim`, çalıştırma 40329343279):

| Kontrol | Sonuç |
| --- | --- |
| DNS (Google, Cloudflare, Türkiye'deki çözücüler) | A 64.29.17.x / 216.198.79.x (Vercel), AAAA yok, tutarlı |
| TLS | 1.2 ve 1.3 çalışıyor; `*.vercel.app` → Google Trust Services WR1 → GTS Root R1 → GlobalSign Root CA; bitiş 27.11.2026 (Vercel kendisi yeniler) |
| Yönlendirme | `http://` → 308 → `https://` tek adım; HSTS 2 yıl; döngü yok |
| 20 ardışık bağlantı | 20/20 HTTP 200, sertifika doğrulandı |
| Türkiye'deki ağlar (Globalping) | **42/42 ölçüm HTTP 200, TLS 1.3** — Türk Telekom, Superonline, TurkNet, veri merkezleri; İstanbul, Ankara, Bursa, Trabzon, Antalya |
| WebKit (iPhone 15 / iPad Pro 11 emülasyonu) | Giriş ekranı açılıyor (emülasyon; gerçek iOS değildir) |
| Service worker | Yalnız push; `fetch` dinlemez, önbellek tutmaz → eski sürüme kilitlenemez |
| Vercel güvenlik duvarı | Yapılandırılmamış (istek engellenmiyor) |

**Ölçülemeyenler:** Turkcell ve Vodafone mobil ağlarında ölçüm noktası yok (Globalping
"no_probes_found"); gerçek iPhone erişimi yok.

**Sonuç:** Hata sunucu, sertifika, DNS, yönlendirme veya uygulama kodundan kaynaklanmıyor; bağlantı,
istemcinin ağ yolunda (operatör filtresi / "Güvenli İnternet", VPN veya içerik filtresi profili,
iCloud Özel Geçiş, yanlış tarih-saat) kesiliyor. Tekrarlamasının olası nedeni: `*.vercel.app`
paylaşımlı bir alan adıdır; aynı alan altındaki başka sitelere yönelik SNI tabanlı ağ filtreleri
zaman zaman bu adresi de etkileyebilir. Bu, mobil ağ ölçümü olmadan **kanıtlanmış değildir**.

**Kalıcı çözüm (dış bağımlılık, sahip onayı gerekir):** Uygulamayı şirketin kendi alan adına almak,
ör. `os.leonxmetal.com`:
1. Alan adı sağlayıcısında `os` için `CNAME cname.vercel-dns.com` kaydı.
2. Vercel → Project → Domains → `os.leonxmetal.com` ekle (sertifika otomatik).
3. `src/config/company.ts` → `canonicalOrigin`, Supabase Auth → Site URL / Redirect URLs, izleme
   adresi (`LEONX_ORIGIN`).
4. Eski adres yeni adrese 308 ile yönlendirilir. Not: oturum tarayıcıda alan adına bağlı tutulur;
   her cihaz yeni adreste **bir kez** giriş yapar (tek kullanımlık kayıt kodu ile). Veriler etkilenmez.

## 2. Otomatik izleme (`.github/workflows/uretim-izleme.yml`)

10 dakikada bir, kullanıcı cihazlarından bağımsız olarak GitHub sunucularından:
TLS ve sertifika süresi (<14 gün alarm), HTTP→HTTPS, yönlendirme zinciri (döngü, HTTP'ye düşme,
başka alana kaçış), HSTS/CSP/nosniff, karışık içerik, sayfanın istediği tüm `/assets` paketleri,
`version.json` (no-store), `sw.js` (önbelleksiz, `fetch` dinlemiyor), manifest kapsamı, derin
bağlantı. Saatte bir Türkiye'deki ağlardan ölçüm; çoğunluğu başarısızsa ayrı alarm.

Alarm: sorun 3 denemede (20 sn arayla) sürerse `uretim-alarm` etiketli issue açılır → GitHub,
depo sahibine e-posta ve GitHub mobil bildirimi gönderir. Düzelince issue kendiliğinden kapanır.
Elle çalıştırma: Actions → "Production izleme" → Run workflow. Yerel: `node scripts/izleme/saglik.mjs`.

## 3. Dağıtım kontrolü (`.github/workflows/dagitim-kontrol.yml`)

- Vercel build'i zaten testleri ve yayın kapısını çalıştırır (`vercel.json` → `buildCommand`);
  başarısız build production'a hiç alınmaz.
- Her production dağıtımından sonra kanonik adres, yayındaki commit yeni dağıtımınki olana kadar
  beklenir ve tüm kontroller çalışır; başarısızsa alarm issue'su geri alma adımlarıyla açılır.
- **Sağlıksız sürümün yayına hiç alınmaması için (önerilen, sahip yapar):**
  1. Vercel → Settings → Deployment Protection → *Protection Bypass for Automation* → anahtar üret.
  2. GitHub → Settings → Secrets → Actions → `VERCEL_AUTOMATION_BYPASS_SECRET`.
  3. Vercel → Settings → *Deployment Checks* → GitHub kontrolü "Dağıtım sağlık kontrolü"nü zorunlu seç.

## 4. Geri alma (yalnız ön yüz)

Supabase verisi, oturumlar, cihaz yetkileri, bildirim abonelikleri ve radar ayarları değişmez.

- **En hızlı:** Vercel panosu → Deployments → önceki READY production → *Instant Rollback*.
- **GitHub'dan:** Actions → "Production geri alma" → Run workflow (boş bırakılırsa bir önceki
  production). Gizli değer `VERCEL_TOKEN` gerekir. İş, kanonik adresin hedef sürümü sunduğunu ve
  sağlıklı olduğunu doğrular.
- Geri almadan sonra Vercel yeni birleştirmeleri otomatik yayına almaz; sorun giderilince panoda
  *Undo Rollback* / *Promote*.
- Açık PWA'lar `version.json` üzerinden farklı sürümü görür, kullanıcıya "Yeni sürüm hazır" gösterir;
  kaydedilmemiş form korunur, oturum kapanmaz.
