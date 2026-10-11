# LEONX OS

LEONX Metal'in **iç kullanımına özel** proje, CAD analiz, metraj ve teklif yönetim sistemi.

> Firma: **LEONX METAL** · [leonxmetal.com](https://www.leonxmetal.com)

## Durum — Faz 1, 2A ve 3 tamamlandı

Bu sürüm yalnızca arayüzü ve uygulama iskeletini içerir. Veritabanı (Supabase), CAD analiz motoru ve
yapay zekâ entegrasyonu **henüz yoktur**. Uygulamada sahte müşteri, fiyat veya metraj verisi bulunmaz;
geliştirilmemiş eylemler devre dışıdır ve hangi aşamada geleceği belirtilir.

| Faz | Kapsam | Durum |
| --- | --- | --- |
| 1 | Arayüz ve yazılım altyapısı | ✅ |
| 2A | Güvenli web dağıtım hazırlığı (Vercel, mobil uyumluluk) | ✅ |
| 3 | Kurumsal arayüz, orijinal logo, açık/koyu/sistem teması | ✅ |
| Sıradaki | Veritabanı, kimlik doğrulama, kayıtlar | Planlandı |
| — | DWG / DXF analiz motoru | Planlandı |
| — | Otomatik metraj ve fiyatlandırma | Planlandı |
| — | Teklif hazırlama ve PDF çıktıları | Planlandı |
| — | LEONX AI entegrasyonu | Planlandı |

Gelecek aşamalar uygulamada numara yerine adla anılır (ör. "Veritabanı aşaması").

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

## ⚠️ Güvenlik uyarısı — üretimde özel veri işlemeye hazır değildir

LEONX OS'un bu sürümünde **kimlik doğrulama (giriş sistemi), yetkilendirme ve veritabanı yoktur.**

- Uygulamanın web adresini bilen **herkes** arayüzü açabilir. Adresin gizli tutulması bir güvenlik önlemi değildir.
- Uygulama şu anda hiçbir veri kaydetmez veya sunucuya göndermez; tek yerel kayıt, arayüz tercihlerinin
  (menü daraltma, hareket azaltma) tarayıcıda saklanmasıdır.
- **Müşteri bilgisi, fiyat, teklif, çizim veya başka bir firma içi veri girilmemeli ve yüklenmemelidir.**
  Kimlik doğrulama ve yetkilendirme eklenip test edilene kadar Vercel dağıtımı yalnızca arayüz önizlemesi içindir.
- Arama motorlarının sayfayı dizine eklememesi için `robots.txt`, `noindex` meta etiketi ve `X-Robots-Tag`
  başlığı eklendi. Bu bir erişim kontrolü **değildir**; yalnızca dizinlemeyi engellemeye yöneliktir.
- Depoda gizli anahtar, `.env` dosyası veya parola yoktur. Gelecekte eklenecek anahtarlar yalnızca Vercel'in
  **Environment Variables** bölümüne girilmeli, depoya yazılmamalıdır. `VITE_` ile başlayan değişkenler tarayıcıya
  gönderilen koda gömülür; bu nedenle bu öneke yalnızca herkese açık olabilecek değerler verilmelidir.

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
| Önbellek | `/assets/` altındaki sürümlü dosyalar 1 yıl önbelleğe alınır |

Ortam değişkeni (Environment Variable) **gerekmez**.

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
| Environment Variables | Boş bırakın |

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
   adreslerin korunduğu yazar. Üretim adresi herkese açıksa yukarıdaki güvenlik uyarısı geçerlidir.

### 7. iPad ana ekranına ekleyin (isteğe bağlı)

1. Uygulamayı Safari'de açın.
2. **Paylaş** simgesine (yukarı ok bulunan kare) dokunun → **Ana Ekrana Ekle**.
3. Ad olarak `LEONX OS` görünür; **Ekle**'ye dokunun. Uygulama, adres çubuğu olmadan tam ekran açılır.

### Sorun giderme

| Belirti | Çözüm |
| --- | --- |
| Build hatası: Node.js sürümü | **Settings** → **Build and Deployment** → **Node.js Version** → `22.x` seçin ve **Redeploy** yapın |
| Alt sayfa yenilenince 404 | `vercel.json` dosyasının deponun kök klasöründe olduğunu ve `main` dalına birleştirildiğini kontrol edin |
| Eski sürüm görünüyor | Safari'de sayfayı yenileyin; ana ekran uygulamasında uygulamayı kapatıp yeniden açın |
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
npm run check      # TypeScript kontrolü + production build
```

## Klasör yapısı

```
vercel.json                Vercel build, SPA yönlendirme ve güvenlik başlıkları
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
| `/projeler` | Projeler |
| `/cad-analiz` | CAD Analiz |
| `/metraj` | Metraj |
| `/teklifler` | Teklifler |
| `/firmalar` | Firmalar |
| `/leonx-ai` | LEONX AI |
| `/raporlar` | Raporlar |
| `/ayarlar` | Ayarlar |

Uygulama tarayıcı geçmişi tabanlı yönlendirme kullanır. Vercel'de bu yönlendirme `vercel.json` ile
yapılandırılmıştır; başka bir sunucuya taşınırsa bilinmeyen yolların `index.html`'e yönlendirilmesi gerekir.
