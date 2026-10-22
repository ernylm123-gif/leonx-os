# LEONX AI — İş Fırsatı Radarı: mevcut altyapı denetimi ve mimari (PR-A)

Tarih: Ekim 2026 · Taban: `main` 0.9.2 (8aa0073). Açık ve onay bekleyen PR'lar: #17 (DWG sunucusu),
#18 (metraj referans ölçümü), #19 (kasa/banka, migration 013), #20 (malzeme reçetesi, migration 014).
Radar bunlardan bağımsızdır; migration numarası 015'tir.

## 1. Mevcut durum (kod incelemesi)

| Alan | Durum | Radar için anlamı |
| --- | --- | --- |
| LEONX AI sayfası (`src/pages/AiPage.tsx`, M06) | Yalnız "planlandı" ekranı; sohbet kutusu devre dışı, hiçbir veri yok | Aynı rota korunarak gerçek modüle dönüştürülecek |
| Bildirim merkezi (migration 007: `notifications`, `notification_prefs`, `leonx_notify`) | Çalışıyor; kategori bazlı tercih, `dedupe_key` ile tekilleştirme, uygulama içi + push durumu | Yeni kategori `firsat` eklenir; aynı fırsat için `radar:<id>` anahtarıyla tekrar bildirim engellenir |
| Web Push (`push_subscriptions`, `push-dispatch` edge function, VAPID gizli anahtarı kapalı şemada) | Çalışıyor; geçersiz abonelik (404/410) kapatılıyor | Radar bildirimleri aynı kuyruktan gönderilir; ek altyapı gerekmez |
| Zamanlayıcı (migration 008: `pg_cron` + `pg_net`, gizli başlıklı çağrı) | Çalışıyor (hatırlatma 5 dk, push 1 dk) | Saatlik tarama aynı desenle eklenir; istemciye gizli değer verilmez |
| Sürüm kontrolü (`src/lib/appVersion.ts`, `/version.json`) | Açık uygulama yeni derlemeyi algılayıp "Yeni sürüm hazır" gösteriyor; production'da çalışıyor | Sürüm bildirimi (PR-G) için temel; gerçek yayını kanıtlayan sinyal production'dan servis edilen `version.json` |
| Realtime | Tüm ana tablolar yayında; cihazlar arası eşitleme e2e ile test edilmiş | Radar tabloları da eklenir |
| CRM (`companies`), projeler, teklifler, görevler | Çalışıyor | Fırsattan firma/proje adayı yalnız kullanıcı onayıyla oluşturulur |

## 2. Veri kaynakları — izin değerlendirmesi

**İlke:** Yalnız kullanım izni açık olan kaynaklar otomatik taranır. CAPTCHA aşma, oturum, engel
atlatma, kişisel veri toplama yapılmaz. Kaynak metni güvenilmeyen veridir; içindeki "talimatlar"
uygulanmaz.

| Kaynak | Bulgular | Karar |
| --- | --- | --- |
| EKAP (ekap.kik.gov.tr) | Resmî API veya otomatik erişime izin veren yayımlanmış koşul bulunamadı; erişimler kayıt altına alınıyor | **Otomatik taranmaz.** Kullanıcı bağlantı ekleyebilir (elle kaynak); resmî izin/servis netleşirse bağlayıcı yazılır |
| ilan.gov.tr (Basın İlan Kurumu) | Resmî RSS/API/açık veri lisansı bulunamadı; yalnız üçüncü taraf sarmalayıcılar var | **Otomatik taranmaz** (aynı gerekçe) |
| Google News RSS | İkincil kaynaklara göre ticari olmayan kullanım için | **Kullanılmaz** (LEONX ticari kullanımdır) |
| Yayıncıların kendi RSS/Atom akışları (sektör haberleri, kurum duyuruları) | RSS, içerik paylaşımı için sunulur; yalnız başlık + kısa özet + bağlantı saklanır, kaynağa bağlantı verilir | **Kullanılır** — her akış kayıtta "izinli" işaretlenmeden önce canlı test edilir ve sitenin koşulları not edilir |
| Firma resmî siteleri (iletişim / tedarikçi sayfaları) | Kamuya açık kurumsal iletişim | **Yalnız gerektiğinde, robots.txt'ye uyarak**, yalnız firmanın kendi alan adındaki kurumsal adresler |
| Tavily arama API'si | Ayda 1.000 ücretsiz kredi, kart gerekmiyor; temel arama 1 kredi. Ücretsiz plan "bireysel keşif" için tanımlanıyor; ticari kullanım koşulu doğrulanmadı | Kullanıcı onayıyla bağlayıcı yazılır; **varsayılan kapalı**, ayda 900 sorgu sert sınırı; açmadan önce Tavily kullanım koşulları kullanıcı tarafından teyit edilmeli |
| Brave Search API | Ücretsiz katman kaldırılmış (kredi tabanlı faturalandırma) | Kullanılmaz |
| LinkedIn vb. | Yalnız izinli resmî API ile | Bu sürümde yok |

Not: Bu geliştirme ortamı Türk sitelerine ağ erişimine sahip değildir; akış adresleri burada
doğrulanamaz. Tarayıcı Supabase'de çalıştıktan sonra her kaynak "Kaynağı test et" ile canlı
denenir, sonra "izinli" yapılır.

## 3. Teknoloji değerlendirmesi

| Aday | Lisans | Değerlendirme | Karar |
| --- | --- | --- | --- |
| Crawl4AI | Apache-2.0 | Python + tarayıcı; ayrı sunucu ister, Supabase/Vercel'de çalışmaz | Şimdilik hayır (RSS + hedefli sayfa okuma yeterli) |
| Scrapy | BSD-3 | Güçlü tarayıcı; ayrı Python sunucusu ister | Şimdilik hayır |
| Playwright | Apache-2.0 | JS gerektiren siteler için; ağır, sunucu ister | Hayır (izinsiz kazıma riski de doğurur) |
| Haystack / LangChain | Apache-2.0 / MIT | LLM boru hattı çerçeveleri; kural motoru için gereksiz bağımlılık | Hayır (LLM onaylanırsa yeniden değerlendirilir) |
| Ollama | MIT | Yerel model; GPU/sunucu ister, Supabase'de çalışmaz | Hayır |
| sentence-transformers | Apache-2.0 | Anlamsal benzerlik için iyi; Python sunucusu ister | Sonraki faz (tekrar kayıt kümelemesi gerekirse) |
| pgvector | PostgreSQL lisansı | Supabase'de hazır eklenti; gömme vektörü üretimi için model gerekir | Sonraki faz |
| **Seçilen** | — | Supabase Edge Function (Deno) + bağımlılıksız TypeScript modülleri: RSS/Atom ayrıştırıcı, HTML temizleyici, SSRF koruması, robots.txt, Türkçe sözlük/il-ilçe tabanlı sınıflandırma, açıklanabilir puanlama | Ek sunucu ve ücret yok; tamamı birim testli |

**Yapay zekâ katmanı:** Kullanıcı kararıyla ilk sürüm ücretsiz, açıklanabilir Türkçe kural
motorudur. Model "internette arıyormuş" gibi davranmaz; tüm güncel bilgi tarama katmanından ve
kaydedilmiş kanıtlardan gelir. LLM ileride bütçe sınırı ve onayla eklenebilecek biçimde arayüzle
ayrılmıştır.

## 4. Mimari

```
pg_cron (saatlik) ──gizli başlık──▶ radar-scan (Edge Function)
                                       │ izinli + zamanı gelmiş kaynaklar
                                       │ SSRF koruması · ETag/Last-Modified · boyut/süre sınırı
                                       ▼
                         RSS/Atom ayrıştır → HTML temizle → kanonik URL + içerik özeti
                                       ▼
                 sınıflandır (il/ilçe, proje türü, aşama, ihale, kategori, doğrulanmış/potansiyel)
                                       ▼
                 puanla (fırsat puanı ≠ güvenilirlik) → radar_ingest() (yalnız servis rolü)
                                       ▼
        radar_items · radar_opportunities (kümeleme) · radar_evidence · firmalar · bildirim (tekil)
                                       ▼
                     LEONX AI paneli (RLS, realtime) · rapor PDF/Excel · CRM aktarımı (onaylı)
```

## 5. Güvenlik

- Tüm radar tablolarında RLS (yalnız sahip); anon yetkisiz. Veri yazma yalnız servis rolüyle
  çalışan `radar_ingest()` ve sahip RPC'leriyle.
- API anahtarları yalnız Edge Function gizli değerlerinde; istemciye ve depoya girmez.
- SSRF: yalnız https, IP-literal/özel ağ/yerel adres reddi, kayıtlı kaynak alan adı dışına
  yönlendirme reddi, boyut ve süre sınırı.
- Kaynak HTML'i düz metne çevrilir; arayüzde ham HTML gösterilmez.
- KVKK / ticari elektronik ileti: yalnız kurumsal iletişim (firmanın kendi alan adı), kişi adı
  içeren adresler saklanmaz, e-posta taslakları otomatik gönderilmez.

## 6. Maliyet

| Kalem | Maliyet |
| --- | --- |
| Edge Function + pg_cron + veritabanı | Mevcut Supabase planı içinde (ek ücret beklenmez; kullanım izlenir) |
| Kural motoru | Ücretsiz |
| Tavily | Ayda 1.000 krediye kadar ücretsiz; uygulama 900'de durur |
| LLM | Yok (onaylanırsa bütçe sınırıyla) |

## 7. PR planı

| PR | İçerik | Durum |
| --- | --- | --- |
| PR-A | Bu denetim | Bu PR |
| PR-B + C | Veri modeli (migration 015), tarayıcı, kaynak kayıtları, tekrar önleme, sınıflandırma, puanlama, kanıtlar | Geliştiriliyor |
| PR-D + E | Firma/iletişim araştırması, panel, rapor, asistan (kural tabanlı), CRM aktarımı, e-posta taslağı | Geliştiriliyor |
| PR-F | Günlük/haftalık özet, bildirim tercihleri, sessiz saatler | Sonra |
| PR-G | Yeni sürüm bildirimi (production'dan servis edilen sürüm kanıtıyla, sürüm başına bir kez) | Sonra |
| PR-H | Teklif taslağı ve iletişim takibi derinleştirme | Sonra |
| PR-I | Güvenlik/performans/gerçek cihaz doğrulaması | Sonra |

## 8. Bilinen sınırlar

- Gerçek kaynak taraması Supabase'e kurulumdan sonra başlar; bu ortamdan Türk sitelerine
  erişilemediği için akış adresleri canlıda test edilerek eklenecektir.
- Kamu ihale portalları için resmî bir veri servisi/izin bulunamadığından ihale kapsamı başlangıçta
  sınırlıdır; resmî kanal bulunursa eklenir.
- Kural motoru Türkçe anahtar kelime ve kalıplarla çalışır; anlamı yanlış yorumlayabilir. Bu
  yüzden potansiyel ihtiyaçlar hiçbir zaman "doğrulanmış iş" olarak sunulmaz.
