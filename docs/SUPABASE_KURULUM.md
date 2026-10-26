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
2. E-posta adresinizi ve **güçlü bir şifre** girin (en az 16 karakter; parola yöneticisi önerilir). `123456` gibi kamuya
   açıklanmış veya kısa şifreler kullanılmaz: 0.14.0'dan itibaren giriş ekranında e-posta alanı yoktur, yalnız şifre sorulur.
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
| 7 | `supabase/migrations/20261014000700_leonx_workflow.sql` | Proje aşamaları, görevler, işlem geçmişi, bildirimler, tercihler, push abonelikleri, hatırlatma taraması |
| 8 | `supabase/migrations/20261014000800_leonx_scheduler.sql` | pg_cron + pg_net zamanlayıcı (hatırlatmalar 5 dk, push gönderimi 1 dk) |
| 9 | `supabase/migrations/20261014000900_leonx_hardening.sql` | Tetikleyici fonksiyonlarının istemciden çağrılmasını kapatır |
| 10 | `supabase/migrations/20261015001100_leonx_finance.sql` | Faz 8 finans: birim maliyet kataloğu, kurlar, proje bütçesi, tahmini maliyet, giderler, ödeme planı, tahsilatlar, `project_receivables` görünümü, bütçe aşımı ve tahsilat hatırlatmaları (RLS + Realtime) |
| 11 | `supabase/migrations/20261015001200_leonx_engineering.sql` | Faz 5.2 mühendislik incelemesi: poz için belirsiz işareti, inceleme notu, sunucunun yazdığı onaylayan/onay zamanı ve değiştirilemez ilk tespit değerleri; analiz dosyası SHA-256 özeti; çelişki ve doğrulama bildirimleri |
- Dosyalar **tekrar çalıştırılabilir** ve hiçbir nesneyi silmez (`DROP` içermez): tetikleyiciler
  `create or replace trigger`, politikalar "yoksa oluştur, varsa `ALTER POLICY`" ile tanımlanır.
- Supabase MCP bağlayıcısı (Claude) ile de uygulanabilir; bağlayıcı silme içeren sorgular için onay ister.
- iPad'de GitHub'dan dosya içeriğini kopyalamak için dosyayı açıp **Raw** görünümüne geçin, tümünü seçip kopyalayın.

Kontrol: **Table Editor**'de `app_owner, companies, contacts, projects, project_status_history, project_notes,
project_files, activity_log, cad_analyses, quantity_takeoffs, quantity_items, quantity_item_history, quotes, quote_items, quote_history, quote_settings, quote_counters, cost_rates, fx_rates, project_budgets, project_cost_lines,
project_expenses, project_payment_schedule, project_collections` tabloları görünmeli ve hepsinde **RLS enabled** yazmalıdır.
**Storage**'da `project-files` bucket'ı **Private** olarak görünmelidir.

### Push bildirimleri (Faz 7)

1. Edge Function'ı yayımlayın: `supabase/functions/push-dispatch` (`verify_jwt = false`; istek, veritabanında
   üretilen ve istemciye kapalı `cron_secret` başlığıyla doğrulanır).
2. SQL Editor'da gönderim adresini girin (proje referansınızla):
   `update leonx_private.push_config set dispatch_url = 'https://<proje-ref>.supabase.co/functions/v1/push-dispatch' where singleton;`
3. Zamanlayıcı ilk çağrıda VAPID anahtar çiftini üretip `leonx_private.push_config` tablosuna yazar. Gizli anahtar
   bu kapalı şemada kalır; istemciye, depoya veya Vercel'e yazılmaz. Uygulama yalnız açık anahtarı
   `push_public_key()` ile alır.
4. Uygulamada **Ayarlar → Bildirimler → Bu cihazda aç** ile her cihaz ayrı abone olur. iPhone/iPad'de önce
   Safari → Paylaş → **Ana Ekrana Ekle** gerekir (iOS 16.4+).

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
- Bağlayıcı ile uzaktan çalıştırma için silme içermeyen alt kümeler: `supabase/tests/rls_policies.remote_safe.sql`,
  `quotes.remote_safe.sql`, `workflow.remote_safe.sql`, `finance.remote_safe.sql` (Faz 8; sonuç `LEONX_FAZ8_TEST_SONUC basarili=14/14`)
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

### Yalnız şifre ile giriş (0.14.0)

Giriş ekranı yalnız şifre sorar; e-posta sunucuda tutulur:

1. Migration 017'yi uygulayın (kaba kuvvet sayaçları).
2. **Edge Functions → Secrets** (isteğe bağlı): `OWNER_EMAIL` = sahip hesabının e-postası — tanımlı değilse işlev e-postayı `app_owner` kaydından okur; `RADAR_ALLOWED_ORIGINS=https://leonx-os.vercel.app`.
   İsteğe bağlı `OWNER_LOGIN_SALT` (rastgele uzun bir değer).
3. `supabase functions deploy owner-login --no-verify-jwt`
4. Bu işlev dağıtılmadan yeni arayüz yayımlanırsa giriş ekranı "Giriş hizmeti henüz kurulmamış" der; önce işlevi dağıtın.
5. **İlk cihaz kaydı (tek kullanımlık kod).** SQL Editor'da yalnız cihazı kaydetmeye hazır olduğunuzda çalıştırın:
   `select public.owner_enrollment_open('123456', 15);` — kod **15 dakika** geçerlidir, **bir kez** kullanılır, sunucuda yalnız
   SHA-256 özeti saklanır ve yeni bir kod öncekini geçersiz kılar. Giriş ekranına `123456` yazın; cihaz hatırlanır (uygulama
   kapatılıp açıldığında veya PWA olarak yüklendiğinde şifre sorulmaz). `123456` herkesçe bilinen bir değerdir: kodu yalnız hemen
   kullanacaksanız açın. Sonraki cihazlar için **Ayarlar › Yetkili cihazlar › Yeni cihaz için kod oluştur** 8 haneli rastgele,
   10 dakikalık kod üretir. Aynı ekrandan bir cihaz **İptal et** ile kapatılır (oturumu sunucuda silinir).

## 9. Doğrulama

1. Uygulamayı açın → giriş ekranı görünmeli (kayıt bağlantısı yoktur; yalnız Şifre alanı ve Giriş Yap düğmesi).
2. Şifrenizle giriş yapın → Dashboard açılmalı; üst çubukta senkronizasyon göstergesi **Canlı** olmalı.
3. Bir firma ve bir proje ekleyin.
4. iPad veya telefonunuzda aynı hesapla giriş yapın; kayıtlar görünmeli. Bir cihazda proje durumunu
   değiştirin, diğer cihazda birkaç saniye içinde güncellendiğini görün.
5. Yanlış şifreyi 5 kez deneyin: "Çok fazla hatalı deneme … sonra tekrar deneyin" iletisi görünmeli (kilit kısa sürelidir).
6. `OWNER_EMAIL` yanlışlıkla sahip olmayan bir hesabı gösteriyorsa "Bu hesap yetkili değil" ekranı görünür ve hiçbir veri görünmez.

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

## Faz 8 — finans migration'ı (011) notları

- Dosya numarası 011'dir (010 numarası kullanılmadı); sıra dosya adındaki tarih/saat ile korunur.
- `leonx_run_reminders()` fonksiyonu 007'deki gövdesi **aynen** korunarak yeniden tanımlanır ve yalnız tahsilat
  vadesi yaklaşıyor (3 gün) / gecikti hatırlatmaları eklenir (kategori `termin`, tekilleştirme anahtarları
  `tahsilat-yaklasiyor:<taksit>:<vade>` ve `tahsilat-gecikti:<taksit>`). pg_cron işi (008) değişmez.
- Bildirim kategorilerine yeni değer eklenmedi; bütçe aşımı `proje`, tahsilat hatırlatmaları `termin` kategorisindedir.
- Kur otomatik çekilmez: **Finans → Kurlar** bölümünden tarih ve kaynak (ör. "TCMB döviz satış, elle girildi")
  ile girilir. Kur yoksa farklı para birimleri toplanmaz.
- Uygulamadan sonra kontrol: `select public.check_reminders();` (sahip oturumunda) hata vermemeli;
  `finance.remote_safe.sql` çalıştırılıp `LEONX_FAZ8_TEST_SONUC basarili=14/14 sorunlar=[]` görülmelidir.
