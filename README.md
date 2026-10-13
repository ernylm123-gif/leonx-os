# LEONX OS

LEONX Metal'in **iç kullanımına özel** proje, CAD analiz, metraj ve teklif yönetim sistemi.

> Firma: **LEONX METAL** · [leonxmetal.com](https://www.leonxmetal.com)

## Durum — Faz 5: CAD analizi ve metraj + tüm cihazlarda tek sürüm

LEONX OS gerçek veriyle çalışan, **tek kişiye ait** bir proje, CAD analizi ve metraj sistemidir:

- Supabase Auth ile e-posta/şifre girişi (herkese açık kayıt yok, tek hesap, çoklu cihaz oturumu)
- Veritabanında tek yetkili kullanıcı UUID'si üzerinden **Row Level Security** (varsayılan erişim kapalı)
- Firmalar, ilgili kişiler, projeler, durum geçmişi, notlar ve özel depoda dosyalar
- **CAD analizi:** DXF okuma (katman, blok, birim, ölçü), PDF vektör/raster ayrımı ve iki noktalı kalibrasyon,
  görüntüleyici (yakınlaştırma, ölçüm, katman, arama). DWG doğrudan okunmaz; DXF'e dönüştürme rehberi gösterilir
- **Metraj:** poz bazlı alan/çevre/adet hesapları, otomatik poz önerisi (her zaman kullanıcı onayıyla),
  sürümler, onay kilidi, düzeltme geçmişi, Excel ve PDF çıktıları (ekran toplamı = dosya toplamı)
- Cihazlar arası **anlık senkronizasyon** (Supabase Realtime), kopmada otomatik yeniden bağlanma,
  sürüm tabanlı çakışma kontrolü, bağlantı kopmasında **çift kayıt oluşturmayan** otomatik yeniden deneme
- **Tek sürüm:** her derlemenin kimliği vardır; açık uygulamalar yeni dağıtımı algılayıp
  "Yeni sürüm hazır — Güncelle" bildirimi gösterir (bkz. [Sürüm ve güncelleme](#sürüm-ve-güncelleme))

Teklif/fiyatlandırma ve LEONX AI **henüz geliştirilmedi**; arayüzde "Geliştirme aşamasında" olarak gösterilir.

| Faz | Kapsam | Durum |
| --- | --- | --- |
| 1 | Arayüz ve yazılım altyapısı | ✅ |
| 2A | Güvenli web dağıtım hazırlığı (Vercel, mobil uyumluluk) | ✅ |
| 3 | Kurumsal arayüz, orijinal logo, açık/koyu/sistem teması | ✅ |
| 4 | Giriş, Supabase veritabanı, RLS, firmalar, projeler, dosyalar, Realtime | ✅ |
| 5 | CAD analizi (DXF/PDF), metraj, Excel/PDF çıktıları, sürüm/güncelleme sistemi | ✅ (kod) |
| — | Teklif hazırlama ve fiyatlandırma | Planlandı |
| — | LEONX AI entegrasyonu | Planlandı |

> **Kurulum:** Uygulamanın çalışması için Supabase projesi, migration'lar ve ortam değişkenleri gereklidir.
> Adım adım yönerge: **[docs/SUPABASE_KURULUM.md](docs/SUPABASE_KURULUM.md)**

## Marka ve logo

`public/branding/leonx-logo.png`, LEONX Metal'in **orijinal logo dosyasıdır** ve değiştirilmeden saklanır.
Arayüzde kullanılan diğer dosyalar bu görselden **yalnızca kırpma ve yeniden boyutlandırma** ile üretilmiştir;
LX sembolü, LEONX yazısı, metalik görünüm, renkler ve oranlar yeniden çizilmemiştir.

| Dosya | İçerik | Kullanım |
| --- | --- | --- |
| `branding/leonx-logo.png` | Orijinal logo (1254×1254) | Kaynak dosya |
| `branding/leonx-lockup.png` | LX sembolü + LEONX yazısı | Kenar çubuğu, mobil menü, Ayarlar |
| `branding/leonx-symbol.png` | Yalnızca LX sembolü | Daraltılmış menü, telefon üst çubuğu, LEONX AI |
| `branding/leonx-wordmark.png` | Yalnızca LEONX yazısı | Tablet üst çubuğu |
| `icons/*.png` | LX sembolü, kare tuvale ortalanmış | Favicon, iOS/Android ana ekran simgeleri |

Logonun zemin rengi düz `#F6F6F6`'dır. Bu zemin kaldırılmaz; logo her iki temada da aynı renkte bir
"plaka" içinde gösterilir. Kare simgelerde eklenen kenar payı da aynı `#F6F6F6` rengindedir.

## Tema

Ayarlar → Görünüm'de **Sistem / Açık / Koyu** seçilebilir; üst çubuktaki düğme de bu üç seçenek arasında geçiş yapar.

- Varsayılan **Sistem**'dir: cihazın açık/koyu ayarı (`prefers-color-scheme`) izlenir ve iPadOS, iOS,
  Android, Windows veya macOS'ta tema değiştiğinde uygulama sayfa yenilenmeden güncellenir.
- Seçim tarayıcıda (`localStorage`, `leonx-os:preferences`) saklanır.
- `public/theme-init.js`, React yüklenmeden önce temayı uygular; açılışta yanlış tema görünmez. CSP'ye uyum
  için satır içi değil, ayrı dosyadır.
- Tüm renkler `src/index.css` içindeki CSS değişkenlerinden gelir (`--canvas`, `--surface`, `--ink`, `--line` vb.).
  Koyu tema yalnızca bu değişkenleri `[data-theme='dark']` altında yeniden tanımlar.
- "Hareketleri azalt" tercihi ve cihazın hareket azaltma ayarı animasyonları en aza indirir.

## Güvenlik

### Gerçek müşteri verisi girmeden önce

Kod ve veritabanı politikaları hazırlandı ve test edildi; ancak **sizin Supabase projenizde** henüz
kurulmadı ve doğrulanmadı. Gerçek müşteri verisi girmeden önce:

1. [docs/SUPABASE_KURULUM.md](docs/SUPABASE_KURULUM.md) adımlarını eksiksiz tamamlayın (özellikle herkese
   açık kaydın kapatılması ve sahip UUID'sinin tanımlanması).
2. `supabase/tests/rls_policies.test.sql` dosyasını Supabase SQL Editor'da çalıştırıp **TÜM TESTLER
   BAŞARILI** sonucunu görün.
3. İkinci bir test hesabıyla giriş yapıp hiçbir veri görmediğinizi doğrulayın, sonra bu hesabı silin.

### Erişim modeli

- **Tek hesap, çoklu cihaz.** Hesap Supabase panelinden elle oluşturulur; uygulamada kayıt ekranı yoktur.
- **Yetki veritabanındadır.** `app_owner` tablosundaki tek UUID ile `auth.uid()` karşılaştırılır
  (`public.is_owner()`). E-posta adresine veya arayüz kontrolüne dayanılmaz; arayüzdeki ekranlar yalnızca
  kullanıcı deneyimi içindir.
- **Varsayılan erişim kapalı.** Tüm tablolarda RLS açık; `anon` rolünün tablo ve fonksiyon yetkileri
  kaldırıldı. Geçerli bir Supabase hesabı olan ama sahip olmayan kullanıcı hiçbir satırı göremez veya
  değiştiremez.
- **İstemciye güvenilmez.** `created_by`, `created_at`, `updated_at`, `version` alanları tetikleyicilerle
  sunucuda belirlenir; durum geçmişi ve etkinlik günlüğüne istemci yazamaz.

### Risk değerlendirmesi

| Risk | Önlem |
| --- | --- |
| SQL injection | İstemci SQL metni oluşturmaz; tüm sorgular supabase-js/PostgREST üzerinden parametreli. Veritabanı fonksiyonları `search_path = ''` ile tanımlı. Arama, bellekteki listede yapılır |
| Yetkisiz erişim | RLS + sahip UUID'si; anon yetkileri kaldırıldı; 46 kontrollük SQL test paketi (yerelde geçti) |
| Veri sızıntısı | Realtime olayları abone başına RLS ile süzülür; silme olaylarında yalnızca kimlik gider. Hata iletileri tablo/SQL ayrıntısı göstermez. Yayın paketinde gizli anahtar yok |
| Gizli anahtarın sızması | Yalnızca publishable anahtar kullanılır; `sb_secret_` veya `service_role` anahtarı algılanırsa uygulama çalışmayı reddeder |
| Hatalı dosya erişimi | Özel bucket; okuma/yazma yalnızca sahip; yükleme yalnızca mevcut bir projenin klasörüne; uzantı izin listesi, 50 MB sınırı, içerik türü uzantıdan belirlenir; indirme yetkili oturumla yapılır, herkese açık bağlantı üretilmez |
| XSS / oturum çalınması | Oturum belirteci tarayıcıda saklanır (Supabase varsayılanı). Katı CSP satır içi betiği yasaklar; React çıktıyı kaçışlar; `dangerouslySetInnerHTML` kullanılmaz |
| Kaba kuvvet giriş denemeleri | Supabase Auth hız sınırları; hatalı denemede şifre alanı temizlenir |
| Sessiz veri kaybı | Sürüm tabanlı çakışma kontrolü; projesi olan firma silinemez (veritabanı kısıtı) |

### Bilinen sınırlar

- İki aşamalı doğrulama (MFA) henüz yok. Güçlü ve benzersiz bir şifre kullanın.
- Çevrimdışı düzenleme **desteklenmez**: iş verisi yalnızca Supabase'de tutulur. Bağlantı yokken açık formdaki
  bilgiler korunur, kayıt birkaç saniye içinde bağlantı gelirse otomatik gönderilir; gelmezse "Bağlantı yok" iletisi
  gösterilir ve form açık kalır. Bağlantı gelince tüm veriler otomatik yenilenir.
- Listeler 1000 kayıtla sınırlıdır (Supabase API varsayılanı); aşılırsa uyarı gösterilir.
- Etkinlik günlüğü (`activity_log`) veritabanında tutulur ancak henüz arayüzde gösterilmez.
- Dosya içerikleri virüs taramasından geçirilmez; yalnızca kendi yüklediğiniz dosyalar saklanır.
- Arama motorlarının dizinlemesi `robots.txt`, `noindex` ve `X-Robots-Tag` ile engellenir; bu bir erişim kontrolü değildir.

### Maliyet ve plan kısıtları

- Hedef: **ek aylık maliyet yok.** Supabase **Free** ve Vercel **Hobby** planlarıyla çalışacak şekilde
  tasarlandı; ücretli API, ek veritabanı veya depolama servisi kullanılmaz.
- **Vercel Hobby planı yalnızca kişisel, ticari olmayan kullanım içindir** (Vercel kullanım koşulları).
  LEONX Metal'in iş süreçleri için kullanım ticari kullanım sayılabilir; bu durumda Vercel **Pro** planı
  gerekebilir. Karar ve sorumluluk hesap sahibindedir; güncel koşulları Vercel'in Fair Use / Terms
  sayfalarından kontrol edin.
- Supabase Free projeleri uzun süre kullanılmazsa duraklatılabilir; kota ve yedekleme sınırları için
  [docs/SUPABASE_KURULUM.md](docs/SUPABASE_KURULUM.md#free-plan-notları) bölümüne bakın.

## Tarayıcı desteği

| Platform | En düşük sürüm |
| --- | --- |
| iPad (iPadOS Safari) | iPadOS 16.4 |
| iPhone (iOS Safari ve iOS'taki tüm tarayıcılar) | iOS 16.4 |
| Android (Chrome) | Chrome 111 |
| Masaüstü | Chrome / Edge 111, Firefox 114, Safari 16.4 |

Bu sınır Tailwind CSS v4 ve Vite'ın hedeflediği tarayıcılarla aynıdır (`vite.config.ts` → `build.target`).
Daha eski cihazlarda sayfa düzeni bozulabilir.

Mobil uyumluluk için yapılanlar:

- iPhone çentiği ve ana ekran çubuğu için güvenli alan boşlukları (`env(safe-area-inset-*)`)
- iOS'ta arama kutusuna dokunulduğunda sayfanın yakınlaşmaması (16 px yazı boyutu)
- 320 px genişliğindeki ekranlarda (iPhone SE) yatay taşma olmaması
- "Ana Ekrana Ekle" için uygulama simgesi ve `manifest.webmanifest`
- Fontlar uygulamayla birlikte sunulur; Google Fonts gibi harici servislere istek gönderilmez

## Vercel yapılandırması

Dağıtım ayarları `vercel.json` dosyasındadır:

| Ayar | Değer |
| --- | --- |
| Framework | Vite |
| Kurulum komutu | `npm ci` |
| Build komutu | `npm run build` (TypeScript kontrolü + Vite build) |
| Çıktı klasörü | `dist` |
| Node.js | 20.19+ veya 22.12+ (`package.json` → `engines`, `.nvmrc`) |
| SPA yönlendirme | `/assets/` dışındaki ve dosya karşılığı olmayan tüm yollar `index.html`'e yönlendirilir; böylece `/projeler` gibi alt sayfalar doğrudan açıldığında veya yenilendiğinde 404 vermez |
| Güvenlik başlıkları | Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS, X-Robots-Tag |
| Önbellek | `/assets/` altındaki içerik karmalı dosyalar 1 yıl önbelleğe alınır; HTML `no-cache`, `version.json` `no-store` |

Gerekli ortam değişkenleri (Vercel → Settings → Environment Variables, **Production** ve **Preview**):

| Değişken | Değer |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<proje>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` (asla secret/service_role değil) |

Değişkenleri ekledikten veya değiştirdikten sonra **Redeploy** gerekir. Değişkenler yoksa uygulama çökmez,
"Kurulum gerekli" ekranını gösterir. CSP, tarayıcının yalnızca `*.supabase.co` adresine bağlanmasına izin verir.

## Sürüm ve güncelleme

**Tek üretim adresi: <https://leonx-os.vercel.app>** (yalnızca `main` dalından yayınlanır). Önizleme
(`leonx-os-git-...vercel.app`) ve sabit dağıtım adresleri (`leonx-xxxx.vercel.app`) günlük kullanım için değildir;
bu adreslerde uygulamanın üstünde uyarı ve üretim adresine bağlantı gösterilir.

- Her derleme `sürüm + commit + zaman` biçiminde bir **derleme kimliği** alır ve `/version.json` olarak yayımlanır.
- **Ayarlar → Sürüm bilgisi** ekranı derleme kimliğini, commit'i, ortamı, sunucudaki (yayındaki) sürümü, güncelleme
  durumunu, uygulama türünü (tarayıcı / ana ekran uygulaması) ve canlı senkronizasyon durumunu gösterir. Tüm cihazlarda bu kimlik aynı olmalıdır.
  Kenar çubuğunda da `v<sürüm> · <commit>` görünür.
- Açık uygulama sunucudaki kimliği açılıştan ~4 sn sonra, her 5 dakikada bir ve uygulama ön plana döndüğünde /
  bağlantı geldiğinde denetler. Farklıysa **"LEONX OS — Yeni sürüm hazır"** bildirimi **Güncelle / Daha Sonra** seçenekleriyle
  gösterilir; kaydedilmemiş form varsa önce uyarılır, dosya yüklemesi sürerken güncelleme ertelenir. Güncelleme yalnızca uygulamayı yeniler, veriler sunucudadır.
- Service worker yoktur; HTML önbelleğe alınmaz. Güncelleme, önceki kurulumlardan kalmış service worker ve
  önbellekleri temizler ve sayfayı sürüm parametreli adresle açar (iOS/Android ana ekran uygulaması dahil hiçbir
  ara önbellek eski HTML'i veremez); parametre açılışta adresten silinir.
  Aynı sürüm için en fazla 2 deneme yapılır (sonsuz yenileme olmaz); tarayıcı yine eski dosyayı verirse
  uygulamayı tamamen kapatıp açma yönergesi gösterilir. Uygulamayı silip yeniden yüklemek gerekmez.
- Dağıtım sonrası eski sekmede silinmiş sayfa parçası yüklenemezse beyaz ekran yerine hedef sayfada bir kez
  güvenli yeniden yükleme yapılır.

### Yayın hattı (GitHub → Vercel)

1. Her PR'da GitHub Actions (`.github/workflows/ci.yml`): TypeScript, birim testleri, production build, yayın kapısı
   (`scripts/check-bundle.mjs`: gizli anahtar taraması, sürüm dosyası), kritik bağımlılık açığı denetimi,
   veritabanı/RLS testleri ve tarayıcı testleri.
2. `main`'e birleştirme → Vercel production yayınını otomatik başlatır. Vercel build'i birim testlerini ve yayın
   kapısını yeniden çalıştırır (`vercel.json → buildCommand`); başarısızsa yayın durur, production değişmez.
3. Yayın tamamlanınca `/version.json` yeni derleme kimliğini verir; açık uygulamalar (ana ekran uygulamaları dahil)
   en geç 5 dakika içinde veya ön plana gelince "Yeni sürüm hazır" bildirimini gösterir.

Testleri geçen PR'ların kendiliğinden birleşmesi için GitHub'da bir kez: **Settings → General → Allow auto-merge**
ve **Settings → Branches → main** kuralında "Require status checks" (Kalite ve güvenlik, Veritabanı ve RLS testleri,
Tarayıcı testleri) açılmalı; ardından PR'da **Enable auto-merge** seçilir.

## iPad Safari üzerinden Vercel'de yayınlama

Aşağıdaki adımlar bilgisayar gerektirmez; tamamı iPad'de Safari ile yapılabilir. Vercel arayüzündeki
düğme adları zamanla değişebilir; adımlar 2026 itibarıyla geçerli adlarla yazılmıştır.

### 1. Kodun `main` dalında olduğundan emin olun

Vercel varsayılan olarak `main` dalını yayına alır.

1. Safari'de `github.com/ernylm123-gif/leonx-os` adresini açın ve GitHub hesabınızla giriş yapın.
2. **Pull requests** sekmesinde açık PR'ları sırayla açın: önce Faz 1 (arayüz), ardından bu PR (Vercel hazırlığı).
3. Her birinde değişiklikleri inceleyip **Merge pull request** → **Confirm merge** düğmelerine dokunun.

> PR'ları birleştirmeden önce de deneyebilirsiniz: Vercel bağlandıktan sonra her PR için otomatik bir
> **Preview** (önizleme) adresi oluşturulur ve PR sayfasında görünür.

### 2. Vercel hesabı açın

1. Safari'de `vercel.com` adresine gidin ve **Sign Up** (hesabınız varsa **Log In**) düğmesine dokunun.
2. Plan sorulursa iç kullanım önizlemesi için **Hobby** yeterlidir.
3. **Continue with GitHub** seçeneğini seçin ve GitHub'a erişim iznini onaylayın.

### 3. Depoyu içe aktarın

1. Vercel panelinde **Add New…** → **Project** seçin.
2. **Import Git Repository** listesinde `leonx-os` görünmüyorsa **Adjust GitHub App Permissions**
   bağlantısına dokunun, **Only select repositories** altında `leonx-os` deposunu seçip **Save** deyin.
3. `leonx-os` satırındaki **Import** düğmesine dokunun.

### 4. Proje ayarlarını kontrol edin

**Configure Project** ekranında:

| Alan | Olması gereken |
| --- | --- |
| Project Name | `leonx-os` (isteğe bağlı değiştirilebilir) |
| Framework Preset | **Vite** (otomatik algılanır) |
| Root Directory | `./` |
| Build and Output Settings | Değiştirmeyin; `vercel.json` kullanılır |
| Environment Variables | `VITE_SUPABASE_URL` ve `VITE_SUPABASE_PUBLISHABLE_KEY` (bkz. [Supabase kurulumu](docs/SUPABASE_KURULUM.md#8-vercel-ortam-değişkenleri)) |

**Deploy** düğmesine dokunun. Build yaklaşık 1 dakika sürer. Tamamlandığında ekranda önizleme görüntüsü
ve `https://leonx-os-….vercel.app` biçiminde bir adres görünür.

### 5. Yayını doğrulayın

1. **Visit** (veya **Continue to Dashboard** → **Domains** altındaki adres) ile uygulamayı açın.
2. Menüden birkaç sayfaya geçin, ardından örneğin `/projeler` sayfasındayken sayfayı **yenileyin**:
   404 hatası **görülmemeli**.
3. Adres çubuğuna `…vercel.app/teklifler` yazarak sayfayı doğrudan açın; Teklifler sayfası açılmalıdır.
4. iPad'i yatay ve dikey çevirerek menünün kenar çubuğu ↔ açılır menü olarak değiştiğini kontrol edin.

### 6. Erişimi sınırlayın (önerilir)

1. Vercel'de projeyi açın → **Settings** → **Deployment Protection**.
2. **Vercel Authentication** seçeneğini açık tutun. Bu, önizleme (Preview) adreslerine yalnızca Vercel
   ekibinizdeki kişilerin girebilmesini sağlar.
3. Üretim (Production) adresinin korunup korunmadığı Vercel planınıza bağlıdır; bu sayfada hangi
   adreslerin korunduğu yazar. Üretim adresi herkese açık olsa bile yalnızca giriş ekranı görünür;
   veriler Supabase oturumu ve RLS ile korunur (bkz. Güvenlik bölümü).

### 7. iPad ana ekranına ekleyin (isteğe bağlı)

1. Uygulamayı Safari'de açın.
2. **Paylaş** simgesine (yukarı ok bulunan kare) dokunun → **Ana Ekrana Ekle**.
3. Ad olarak `LEONX OS` görünür; **Ekle**'ye dokunun. Uygulama, adres çubuğu olmadan tam ekran açılır.

### Sorun giderme

| Belirti | Çözüm |
| --- | --- |
| Build hatası: Node.js sürümü | **Settings** → **Build and Deployment** → **Node.js Version** → `22.x` seçin ve **Redeploy** yapın |
| Alt sayfa yenilenince 404 | `vercel.json` dosyasının deponun kök klasöründe olduğunu ve `main` dalına birleştirildiğini kontrol edin |
| Eski sürüm görünüyor | Adresin `leonx-os.vercel.app` olduğunu kontrol edin; **Ayarlar → Sürüm bilgisi → Güncellemeleri kontrol et**. Ana ekran uygulamasında uygulama değiştiriciden kapatıp yeniden açın |
| Proje listede yok | 3. adımdaki **Adjust GitHub App Permissions** ile depoya erişim verin |

Her `main` dalına birleştirme otomatik olarak yeni bir üretim dağıtımı başlatır.

## Teknolojiler

React 19 · TypeScript · Vite · Tailwind CSS v4 · React Router · Framer Motion · Lucide React

## Komutlar

```bash
npm install        # bağımlılıkları kur
npm run dev        # geliştirme sunucusu (http://localhost:5173)
npm run typecheck  # TypeScript kontrolü
npm run build      # production build (dist/)
npm run preview    # build çıktısını önizle
npm run test       # birim testleri (Vitest)
npm run test:db    # veritabanı/RLS testleri — yerel PostgreSQL 15+ gerektirir
npm run test:e2e   # tarayıcı testleri (Playwright, sahte Supabase arka ucu)
npm run check      # TypeScript + birim testleri + production build
```

### Testler

| Komut | Ne test eder | Gerçek Supabase'e bağlanır mı |
| --- | --- | --- |
| `npm run test` | Form doğrulamaları, dosya kuralları, anahtar güvenliği, istatistikler, Realtime yaşam döngüsü (sahte kanal) | Hayır |
| `npm run test:db` | Migration'ları geçici bir PostgreSQL'e **iki kez** uygular (tekrar çalıştırılabilirlik) ve RLS/bütünlük testlerini çalıştırır. Supabase'in `auth`/`storage` şemaları `supabase/tests/local/supabase_stub.sql` ile taklit edilir | Hayır |
| `npm run test:e2e` | Giriş, yetkisiz hesap, CRUD, dosya, çakışma, yeniden bağlanma, çıkış; üç cihaz (masaüstü/iPad/telefon) arası canlı senkronizasyon; çevrimdışı → çevrimiçi; kaybolan yanıtta çift kayıt olmaması; yeni sürüm algılama, yenileme döngüsü koruması, kaydedilmemiş form uyarısı, silinmiş parça kurtarma; DXF → metraj → onay → Excel/PDF; PDF'in CSP altında açılması; 6 ekran × açık/koyu tema | Hayır — Supabase API'leri `e2e/mock-supabase.mjs` ile taklit edilir |

Gerçek Supabase projesinde doğrulama için `supabase/tests/rls_policies.test.sql` dosyasını SQL Editor'da çalıştırın.

## Klasör yapısı

```
vercel.json                Vercel build, SPA yönlendirme ve güvenlik başlıkları
.env.example               Ortam değişkeni adları (gerçek değer içermez)
supabase/
  migrations/              Veritabanı şeması, RLS, Realtime, Storage (sırayla uygulanır)
  setup/01_set_owner.sql   Tek yetkili kullanıcıyı tanımlama
  tests/                   RLS/bütünlük testleri + yerel Supabase taklit iskeleti
scripts/test-db.sh         Yerel PostgreSQL ile veritabanı testleri
e2e/                       Tarayıcı testleri ve sahte Supabase arka ucu
docs/SUPABASE_KURULUM.md   Supabase kurulum yönergesi
public/
  theme-init.js            İlk boyamadan önce temayı uygular
  branding/                Orijinal LEONX logosu ve ondan kırpılan sürümler
  manifest.webmanifest     Ana ekrana ekleme bilgileri
  icons/                   iOS ve Android uygulama simgeleri
  robots.txt               Arama motoru dizinlemesini engeller
src/
  App.tsx                  Rota tanımları (modüller ihtiyaç anında yüklenir)
  main.tsx                 Giriş noktası
  index.css                Tema belirteçleri (açık/koyu), bileşen sınıfları ve fontlar
  config/
    navigation.ts          Menü öğeleri, gruplar ve modül durumları
    company.ts             Firma bilgisi, sürüm, entegrasyon durumu, yol haritası
  context/preferences.tsx  Tema ve arayüz tercihleri (cihazda saklanır)
  context/auth.tsx         Oturum, sahip doğrulaması, çıkış
  context/data.tsx         Canlı veri deposu (firmalar, projeler) + Realtime
  data/                    Veri erişim katmanı (supabase-js) ve satır tipleri
  features/                Proje ve firma formları, notlar, dosyalar
  lib/supabase.ts          Merkezi Supabase istemcisi (ortam değişkenlerinden)
  lib/realtimeSync.ts      Realtime abonelik yaşam döngüsü ve yeniden bağlanma
  lib/useOverlay.ts        Menü/arama katmanları: Escape, kaydırma kilidi, odak yönetimi
  layouts/AppLayout.tsx    Ana yerleşim ve sayfa geçişleri
  components/
    brand/                 Orijinal LEONX logosunun gösterimi
    layout/                Kenar çubuğu, üst çubuk, mobil çekmece, alt navigasyon, komut paleti, tema düğmesi
    ui/                    Panel, PageHeader, EmptyState, Button, Toggle, SegmentedControl, StatusPill vb.
  pages/                   Dashboard, Projeler, CAD Analiz, Metraj, Teklifler,
                           Firmalar, LEONX AI, Raporlar, Ayarlar, 404
```

## Rotalar

| Yol | Sayfa |
| --- | --- |
| `/` | Dashboard |
| `/giris` | Giriş (herkese açık tek sayfa) |
| `/projeler` | Projeler |
| `/projeler/:id` | Proje detayı |
| `/cad-analiz` | CAD Analiz |
| `/metraj` | Metraj |
| `/teklifler` | Teklifler |
| `/firmalar` | Firmalar |
| `/firmalar/:id` | Firma detayı |
| `/leonx-ai` | LEONX AI |
| `/raporlar` | Raporlar |
| `/ayarlar` | Ayarlar |

Uygulama tarayıcı geçmişi tabanlı yönlendirme kullanır. Vercel'de bu yönlendirme `vercel.json` ile
yapılandırılmıştır; başka bir sunucuya taşınırsa bilinmeyen yolların `index.html`'e yönlendirilmesi gerekir.
