# LEONX OS 0.14.0 — üretime yayın planı (sahip onayı bekliyor)

Durum (25 Ekim 2026): **hiçbir adım üretimde uygulanmadı.** Bu plan yalnız sahibin açık yazılı onayından sonra uygulanır.
Üretim Supabase projesi: `bqmlggqtclrjefvkfqna` (Free plan; panelde otomatik yedek yok). Üretimde uygulanmış migration'lar: 001–012.

## 0. Ön koşullar (tamamlandı)

| Kontrol | Sonuç |
| --- | --- |
| Üretim verisinin yedeği | Salt okunur `SELECT json_agg` ile alındı (dolu 8 public tablo; diğerleri 0 satır). |
| Geri yükleme denemesi | Yerel PostgreSQL: 001–012 + yedek yüklendi; **8 tablonun satır sayısı ve MD5 sağlama toplamı üretimle birebir aynı**. Ardından 015–017 temiz uygulandı, veri korundu. |
| Yedeğin kapsamı dışında | `auth.users`/`auth.sessions` (Supabase Auth'ta kalır), `leonx_private.push_config` (gizli anahtar; DB'de kalır), Storage (0 nesne). |
| Migration bağımlılıkları | 001–017 zaman damgası sırasıyla **ve** 013/014 (#19, #20) 015–017'den **sonra** uygulandığında: yerel DB testleri 376 kontrol ✓ (her migration iki kez uygulanır). 013/014 ile 015–017 arasında bağımlılık yok. |
| Kod doğrulaması | typecheck, 408 birim testi, build, gizli anahtar taraması, DB testleri, 69 tarayıcı testi, üç Edge Function için `deno check` ✓; PR #25 CI yeşil. |

Yedek dosyası ve geri yükleme betiği proje dosyalarında: `backups/leonx-prod-2026-10-25.json`, `backups/restore-verify.sh`.
Yayın gününde **yedek yeniden alınır** (aynı sorgu) ve sağlama toplamları tekrar karşılaştırılır.

## 1. Birleştirme sırası (GitHub)

1. PR #25 → `feature/ai-radar-uretim` (#24'ün dalı)
2. PR #24 → `feature/ai-radar-altyapi` (#23'ün dalı)
3. PR #23 → `main`
4. #19 (013 kasa) ve #20 (014 malzeme reçetesi) ayrı karar: önce veya sonra birleştirilebilir; iki sıra da test edildi.
   Sonra birleştirilirlerse zaman damgaları 015–017'den eski kalır; `supabase db push` için `--include-all` gerekir
   veya dosyalar SQL Editor'da sırayla çalıştırılır.

## 2. Veritabanı (SQL Editor veya `supabase db push`)

Sırayla: `20261022001500_leonx_radar.sql` → `20261023001600_leonx_radar_intel.sql` → `20261025001700_leonx_radar_release.sql`.
Hepsi ek ve tekrar çalıştırılabilir; mevcut satırları değiştirmez (017 yalnız Radar fırsatlarının puan dökümünü bir kez yeniden yazar — üretimde Radar fırsatı yok).
Ardından mevcut `supabase/tests/*.remote_safe.sql` dosyaları salt okunur doğrulama için çalıştırılır (Radar için ayrı remote_safe dosyası yoktur; `select public.radar_health();` kullanılır).

## 3. Edge Functions ve gizli değerler

Gizli değerler (Dashboard → Edge Functions → Secrets):

| Ad | Değer |
| --- | --- |
| `OWNER_EMAIL` | sahip hesabının e-postası (Authentication → Users) |
| `OWNER_LOGIN_SALT` | uzun rastgele değer (isteğe bağlı, önerilir) |
| `RADAR_ALLOWED_ORIGINS` | `https://leonx-os.vercel.app` |
| `TAVILY_API_KEY` | **tanımlanmaz** (ücretli API kapalı kalır) |

Dağıtım (arayüzden **önce**):

```
supabase functions deploy owner-login --no-verify-jwt
supabase functions deploy radar-scan
supabase functions deploy radar-contacts
```

Zamanlayıcıyı bağlama (SQL Editor, dağıtımdan sonra):

```sql
update leonx_private.radar_config set scan_url = 'https://bqmlggqtclrjefvkfqna.supabase.co/functions/v1/radar-scan' where singleton;
-- İsteğe bağlı sürüm bildirimi:
update leonx_private.release_watch set version_url = 'https://leonx-os.vercel.app/version.json' where singleton;
```

## 4. Sahip girişi ve ilk cihaz

1. Sahip, Supabase panelinde güçlü bir şifre belirler (en az 16 karakter; `123456` değil).
2. İlk cihaz için SQL Editor'da, **hemen kullanmadan önce**: `select public.owner_enrollment_open('123456', 15);`
   Kod 15 dakika geçerli ve tek kullanımlıktır; kullanılınca veya süre dolunca geçersizdir.
3. Sonraki cihazlar: **Ayarlar › Yetkili cihazlar › Yeni cihaz için kod oluştur** (8 haneli, 10 dakika).

## 5. Arayüz (Vercel)

`main` birleştirilince Vercel üretim dağıtımı oluşur. Ortam değişkenleri değişmez (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).

## 6. Üretim doğrulaması (sahip cihazlarıyla)

- [ ] Giriş ekranında e-posta alanı yok; `123456` bir kez çalışır, ikinci cihazda reddedilir.
- [ ] Uygulama kapatılıp açılınca ve PWA olarak yüklüyken şifre sorulmaz.
- [ ] Ayarlar › Yetkili cihazlar: iki cihaz listelenir; birini iptal edince o cihaz açılışta çıkış yapar.
- [ ] Bir cihazda yapılan değişiklik diğerinde anlık görünür (Realtime).
- [ ] LEONX AI › Kaynaklar: sahip, `LEONX_RADAR_KAYNAK_ADAYLARI.md` kontrollerini yapıp bir kaynağı *İzinli + Etkin* yapar,
      **Kaynağı test et** gerçek yanıt döner, saatlik tarama sonrası `radar_health` başarılı tarama gösterir.
- [ ] **Gerçek bir üretim taraması başarılı olmadan "AI Radar canlı" denmez.**

## 7. Geri alma

- Arayüz: Vercel'de önceki üretim dağıtımına "Promote/Rollback".
- Giriş: `owner-login` sorun çıkarırsa arayüz geri alınır (eski sürüm e-posta + şifre ile çalışır); işlev kalabilir.
- Zamanlayıcı: `update leonx_private.radar_config set scan_url = null where singleton;` taramayı durdurur.
- Veritabanı: 015–017 yalnız ek nesneler oluşturur; geri almak gerekmez. Veri kaybı olursa yedek, 001–012 şemasına
  `restore-verify.sh` ile aynı `jsonb_populate_recordset` yöntemiyle geri yüklenir.
