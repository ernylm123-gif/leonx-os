# LEONX OS — Supabase kurulumu (adım adım)

Bu belge, LEONX OS'u kendi Supabase projenize bağlamak için **sizin** yapmanız gereken işlemleri sırasıyla
anlatır. Tüm adımlar tarayıcıdan (iPad Safari dahil) yapılabilir; ek yazılım gerekmez.

> **Önemli:** Bu depodaki migration dosyaları hazırlandı ve yerel bir PostgreSQL üzerinde test edildi, ancak
> sizin Supabase projenize **uygulanmadı**. Aşağıdaki adımları tamamlamadan uygulama giriş ekranında
> "Kurulum gerekli" veya "Veritabanı kurulumu tamamlanmamış" iletisi gösterir.

## Özet: sizin yapmanız gerekenler

| # | Nerede | İşlem |
| --- | --- | --- |
| 1 | supabase.com | Free planda proje oluşturun |
| 2 | Authentication → Sign In / Providers | Herkese açık kaydı **kapatın** |
| 3 | Authentication → Users | Tek kullanıcı hesabınızı oluşturun |
| 4 | SQL Editor | 4 migration dosyasını **sırayla** çalıştırın |
| 5 | SQL Editor | Kendi User UID'nizi sahip olarak tanımlayın |
| 6 | SQL Editor (isteğe bağlı, önerilir) | RLS test dosyasını çalıştırın |
| 7 | Project Settings → API Keys | URL ve publishable anahtarı kopyalayın |
| 8 | Vercel → Settings → Environment Variables | İki değişkeni ekleyin, Redeploy yapın |
| 9 | Uygulama | Giriş yapın, bir firma ve proje ekleyip ikinci cihazda kontrol edin |

---

## 1. Supabase projesi oluşturun

1. `supabase.com` → **Start your project** → GitHub veya e-posta ile oturum açın.
2. **New project**: Organization seçin (yoksa oluşturun, plan: **Free**).
3. Project name: `leonx-os`. **Database Password** için güçlü bir şifre üretin ve bir parola yöneticisinde saklayın
   (uygulama bu şifreyi kullanmaz; yalnızca acil durumda veritabanına doğrudan bağlanmak içindir).
4. Region: Türkiye'ye yakın bir bölge seçin (ör. **Central EU (Frankfurt)**).
5. **Create new project** → hazırlanması 1–2 dakika sürer.

## 2. Herkese açık kaydı kapatın

Uygulamada kayıt ekranı yoktur; ancak Supabase API'si varsayılan olarak yeni hesap açılmasına izin verir.
Bu ayarı kapatın:

1. **Authentication → Sign In / Providers** (eski arayüzde: Authentication → Settings).
2. **Allow new users to sign up** seçeneğini **kapatın** ve kaydedin.
3. **Email** sağlayıcısının açık olduğundan emin olun.

> Bu ayar açık kalsa bile, kaydolan yabancı bir hesap veritabanındaki RLS politikaları nedeniyle **hiçbir
> veriyi göremez** (bkz. RLS testleri). Yine de kapatılması gereken ikinci bir savunma katmanıdır.

## 3. Kullanıcı hesabınızı oluşturun

1. **Authentication → Users → Add user → Create new user**.
2. E-posta adresinizi ve **güçlü bir şifre** girin (en az 12 karakter; parola yöneticisi önerilir).
3. **Auto Confirm User** seçeneğini işaretleyin → **Create user**.
4. Oluşan satırdaki **User UID** değerini kopyalayın (5. adımda gerekecek).

Bu tek hesapla bilgisayar, iPad, iPhone ve Android cihazlarınızdan aynı anda giriş yapabilirsiniz;
cihaz başına ayrı hesap gerekmez.

## 4. Migration dosyalarını sırayla çalıştırın

**SQL Editor → New query**. Aşağıdaki dosyaların içeriğini GitHub'dan açıp **sırasıyla**, her biri için ayrı
sorgu olarak yapıştırın ve **Run** deyin. Her biri "Success. No rows returned" ile bitmelidir.

| Sıra | Dosya | İçerik |
| --- | --- | --- |
| 1 | `supabase/migrations/20261012000100_leonx_core.sql` | Tablolar, kısıtlar, indeksler, tetikleyiciler, `is_owner()` |
| 2 | `supabase/migrations/20261012000200_leonx_rls.sql` | Row Level Security politikaları ve yetkiler |
| 3 | `supabase/migrations/20261012000300_leonx_realtime.sql` | Realtime yayınına tabloların eklenmesi |
| 4 | `supabase/migrations/20261012000400_leonx_storage.sql` | Özel `project-files` dosya deposu ve politikaları |
| 5 | `supabase/migrations/20261012000500_leonx_quantity.sql` | CAD analizleri, metraj sürümleri, pozlar, düzeltme geçmişi (RLS + Realtime) |
| 6 | `supabase/migrations/20261013000600_leonx_quotes.sql` | Teklifler, kalemler, revizyon geçmişi, teklif ayarları, numara sayacı (RLS + Realtime) |

- Dosyalar **tekrar çalıştırılabilir** ve hiçbir nesneyi silmez (`DROP` içermez): tetikleyiciler
  `create or replace trigger`, politikalar "yoksa oluştur, varsa `ALTER POLICY`" ile tanımlanır.
- Supabase MCP bağlayıcısı (Claude) ile de uygulanabilir; bağlayıcı silme içeren sorgular için onay ister.
- iPad'de GitHub'dan dosya içeriğini kopyalamak için dosyayı açıp **Raw** görünümüne geçin, tümünü seçip kopyalayın.

Kontrol: **Table Editor**'de `app_owner, companies, contacts, projects, project_status_history, project_notes,
project_files, activity_log, cad_analyses, quantity_takeoffs, quantity_items, quantity_item_history, quotes, quote_items, quote_history, quote_settings, quote_counters` tabloları görünmeli ve hepsinde **RLS enabled** yazmalıdır.
**Storage**'da `project-files` bucket'ı **Private** olarak görünmelidir.

## 5. Yetkili kullanıcıyı (sahip) tanımlayın

1. `supabase/setup/01_set_owner.sql` dosyasının içeriğini SQL Editor'a yapıştırın.
2. `00000000-0000-0000-0000-000000000000` yazan yeri 3. adımda kopyaladığınız **User UID** ile değiştirin.
3. **Run**. Sonuç tablosunda kendi e-posta adresinizi görmelisiniz.

Yetki e-posta adresine değil bu UUID'ye dayanır. Uygulamanın kendisi bu tabloyu değiştiremez; değişiklik
yalnızca SQL Editor'dan yapılabilir.

## 6. Güvenlik testlerini Supabase üzerinde çalıştırın (önerilir)

`supabase/tests/rls_policies.test.sql` dosyasının içeriğini SQL Editor'da çalıştırın.

- Önce 5. adım (sahip tanımlama) tamamlanmış olmalıdır; test sahip olarak bu hesabı kullanır.
- `auth.users` tablosuna yazmaz. Yetkisiz kullanıcıyı rastgele bir kimlikle taklit eder; anonim/yetkisiz
  erişim ve veri bütünlüğü senaryolarını yalnızca kendi eklediği test kayıtlarıyla dener ve sonunda
  **ROLLBACK** yapar: mevcut verinize ve sahip ayarınıza dokunmaz.
- Başarılıysa çıktı/bildirimlerde **TÜM TESTLER BAŞARILI** görünür. Bir kontrol başarısız olursa
  "TEST BAŞARISIZ: …" hatasıyla durur.
- Bağlayıcı ile uzaktan çalıştırma için silme içermeyen alt küme: `supabase/tests/rls_policies.remote_safe.sql`
  (sonuçları bilinçli bir `LEONX_TEST_SONUC` hata iletisinde döndürür ve her şeyi geri alır).

## 7. Bağlantı bilgilerini alın

**Project Settings → API Keys** (ve **Data API**) sayfasından:

| Değer | Nereden | Örnek biçim |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Project URL | `https://abcdefghijkl.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key | `sb_publishable_...` |

> ⚠️ **secret** (`sb_secret_...`) veya **service_role** anahtarını hiçbir yere girmeyin. Bu anahtarlar tüm
> güvenlik politikalarını aşar. Uygulama böyle bir anahtar algılarsa çalışmayı reddeder.
> Eski arayüzde publishable anahtar yerine **anon public** anahtarı da kullanılabilir.

## 8. Vercel ortam değişkenleri

1. Vercel → proje → **Settings → Environment Variables**.
2. Yukarıdaki iki değişkeni ekleyin; **Production** ve **Preview** ortamlarını işaretleyin.
3. **Deployments** → en son dağıtım → **⋯ → Redeploy**. (`VITE_` değişkenleri derleme sırasında okunur;
   değişiklikten sonra yeniden derleme gerekir.)

> Yalnızca **Production** işaretlenirse PR önizleme dağıtımları Supabase ayarı olmadan derlenir ve
> uygulama "Kurulum gerekli" ekranını gösterir. Değişkenler yalnızca publishable anahtar içerdiği için
> Preview ortamına eklenmeleri güvenlidir; `service_role` / `sb_secret_` anahtarı hiçbir ortama eklenmez.

## 9. Doğrulama

1. Uygulamayı açın → giriş ekranı görünmeli (kayıt bağlantısı yoktur).
2. Hesabınızla giriş yapın → Dashboard açılmalı; üst çubukta senkronizasyon göstergesi **Canlı** olmalı.
3. Bir firma ve bir proje ekleyin.
4. iPad veya telefonunuzda aynı hesapla giriş yapın; kayıtlar görünmeli. Bir cihazda proje durumunu
   değiştirin, diğer cihazda birkaç saniye içinde güncellendiğini görün.
5. (İsteğe bağlı) Supabase'de ikinci bir test kullanıcısı oluşturup onunla giriş yapın: "Bu hesap yetkili
   değil" ekranı görünmeli ve hiçbir veri görünmemelidir. Testten sonra bu kullanıcıyı silin.

## Free plan notları

- Supabase Free projeleri uzun süre (yaklaşık 1 hafta) kullanılmazsa **duraklatılabilir**; panelden tek
  tıkla yeniden başlatılır. Veriler silinmez.
- Dosya başına yükleme sınırı uygulamada ve bucket'ta **50 MB** olarak ayarlandı.
- Veritabanı ve depolama kotaları planla sınırlıdır; güncel değerleri Supabase fiyatlandırma sayfasından
  kontrol edin. Büyük CAD arşivleri için kotayı izleyin (Settings → Usage).
- Free plan otomatik günlük yedek sunmaz veya kısıtlıdır; önemli veriler için düzenli dışa aktarma planlayın.

## Sorun giderme

| Belirti | Olası neden / çözüm |
| --- | --- |
| "Kurulum gerekli" | Vercel'de değişkenler yok veya Redeploy yapılmadı |
| "Gizli anahtar algılandı" | Publishable yerine secret/service_role anahtarı girilmiş. Anahtarı Supabase'de **yenileyin (rotate)** ve publishable anahtarı girin |
| "Veritabanı kurulumu tamamlanmamış" | Migration'lar çalıştırılmamış veya sırası yanlış |
| "Bu hesap yetkili değil" | 5. adım yapılmamış veya farklı UUID girilmiş |
| "E-posta veya şifre hatalı" | Şifreyi Authentication → Users → kullanıcı → **Reset password / Update password** ile değiştirin |
| Senkronizasyon "Yeniden bağlanıyor"da kalıyor | 3. migration'ı kontrol edin (Database → Publications → `supabase_realtime`); proje duraklatılmış olabilir |
| Dosya yüklenmiyor | 4. migration'ı kontrol edin; dosya türü/boyutu desteklenmiyor olabilir |
