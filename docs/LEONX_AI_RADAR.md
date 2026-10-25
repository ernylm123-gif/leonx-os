# LEONX AI — Proje ve İş Fırsatı Radarı (0.12.0 + 016 zamanlanmış istihbarat, 0.13.0 + 017 yayın hazırlığı, 0.14.0)

LEONX METAL'in ürün ve hizmetlerine (kapı sistemleri; alüminyum/PVC doğrama ve cephe; korkuluk; metal imalat)
uygun proje ve iş fırsatlarını **izinli** kaynaklardan toplayan, **kaynağa bağlı kanıtla** sınıflandıran ve puanlayan,
Ankara öncelikli bir radar. Bu sürümdeki "yapay zekâ", **ücretsiz, deterministik ve açıklanabilir Türkçe kural
motorudur**; dış yapay zekâ / dil modeli API'si çağrılmaz.

> Durum: kod, veritabanı ve testler hazır. **Edge Function'lar dağıtılmadı ve zamanlayıcı yapılandırılmadı**; tarama,
> sahip onayıyla dağıtım yapılıp kaynaklar "İzinli" olarak işaretlendikten sonra başlar. Depoda kaynak listesi,
> örnek fırsat veya sahte veri YOKTUR.

## 1. Temel ilkeler

| İlke | Uygulama |
| --- | --- |
| Veri uydurulmaz | Bilinmeyen proje, firma, e-posta, telefon, miktar, fiyat **boş** kalır ve "bilinmiyor" gösterilir. E-posta adresi asla tahmin edilmez (ör. `satinalma@firma.com` üretilmez). |
| Doğrulanmış ≠ potansiyel | `dogrulanmis` yalnız öğe bir **satın alma / ihale / tedarik ilanı** olup ürünü **açıkça adlandırıyorsa**. Haberde ürün geçmesi veya proje türünden çıkarım yalnız `potansiyel`. Doğrulanmış ihtiyaç yoksa hiçbir puan "Doğrulanmış iş fırsatı" etiketi vermez (veritabanı kısıtı `radar_opportunities_label_rule`). |
| Her iddia kanıtlı | `radar_evidence`: alan, iddia, ≤500 karakter alıntı, kaynak adresi, yayın tarihi (varsa), erişim zamanı. İletişim kanalları `source_url` + `verified_at` olmadan kaydedilemez (NOT NULL). |
| Kaynak içeriği güvenilmez veridir | HTML düz metne indirgenir (script/style/yorum silinir); içerikteki talimatlar ("önceki talimatları yok say", "tüm kayıtları sil") yalnız metin olarak sınıflandırılır, hiçbir işlem tetiklemez (test: `classify.test.ts` prompt injection). Arayüzde ham HTML gösterilmez; dış bağlantılar `noopener noreferrer nofollow`. |
| Yalnız izinli kaynak | Otomatik tarama yalnız `permission_status = 'izinli'` **ve** `active` kaynaklarda. Giriş yapma, CAPTCHA aşma, kullanım koşullarını ihlal eden kazıma yok; site sayfalarında önce robots.txt. |
| Otomatik gönderim yok | E-posta taslakları yalnız saklanır; kopyala / `mailto:` ile kullanıcı kendi istemcisinden gönderir. Sistemde gönderim işlevi yoktur. |

## 2. Mimari ve veri akışı

```
pg_cron (saatte bir, :17) ─► leonx_private.dispatch_radar() ─► POST /functions/v1/radar-scan  (x-leonx-cron gizli başlığı)
                                                                     │
  radar_service_claim_sources (yalnız etkin + izinli, 15 dk kira)  ◄─┤
  urlGuard (SSRF) → robots.txt (site) → koşullu GET (ETag/Last-Modified) → feed.ts / sayfa başlıkları
  sanitize → classify (kural motoru) → score + reliability → dedupe/cluster → pipeline (kanıt satırları)
  radar_ingest (service_role)  ─► radar_items / radar_opportunities / kategoriler / kanıt / firmalar / çalıştırma kaydı
                               ─► radar_notify_pending() ─► public.leonx_notify('firsat', …) ─► notifications (+ mevcut push-dispatch)
Arayüz (/leonx-ai) ◄─ RLS (yalnız sahip) + Realtime
```

Saf TypeScript modülleri (`supabase/functions/_shared/radar/`, Deno/npm API'si kullanmaz; hem Edge Function hem Vitest hem arayüz kullanır):

| Modül | Görev |
| --- | --- |
| `text.ts` | Türkçe katlama (İ/ı, ş/ç/ğ/ö/ü), gövde + çekim eki eşleşmesi ("kapı" → "kapısı/kapıların", "kapital" değil) |
| `feed.ts` | Elle yazılmış RSS 2.0 / Atom ayrıştırıcı (CDATA, varlıklar, ad alanları; özel varlık genişletme yok; bozuk öğe atlanır; öğe sınırı) |
| `sanitize.ts` | HTML → düz metin, adres kanonikleştirme (utm_* vb. atılır), SHA-256 (WebCrypto) |
| `urlGuard.ts` | SSRF koruması + güvenli indirme (aşağıda) |
| `robots.ts` | robots.txt (LEONX-Radar ve `*` grubu, en uzun eşleşme, `*` / `$`) |
| `taxonomy.ts` | 32 kategori (3 grup) + Türkçe anahtar sözcük/eş anlamlı/olumsuz ifadeler; proje türü → olası ihtiyaç tablosu (yalnız potansiyel) |
| `geo.ts` | 81 il + Ankara'nın 25 ilçesi; çekim eki toleransı; çok anlamlı adlar (Ordu, Ağrı, Van, Bala, Evren…) yalnız büyük harfle; "Ankara Caddesi" gibi sokak adları konum sayılmaz |
| `classify.ts` | Proje türü, kamu/özel, aşama, ihale işaretleri, İKN (2026/123456), son teklif tarihi (Türkçe ay adları, gg.aa.yyyy), kategoriler, kurum adayları (rol tahmini doğrulanmamış), riskler, açıklama |
| `score.ts` | Fırsat puanı ve ayrı güvenilirlik puanı |
| `dedupe.ts` | url_hash / content_hash; başlık sözcükleri + şehir ile Jaccard kümeleme |
| `pipeline.ts` | Öğe → `radar_ingest` yükü (kanıt satırlarıyla) |
| `contacts.ts`, `research.ts` | Firmanın kendi sitesinden kurumsal iletişim kanalları |
| `assistant.ts` | Deterministik Türkçe soru ayrıştırıcı |
| `tavily.ts` | Tavily arama bağlayıcısı |
| `analyzer.ts` | `Analyzer` arayüzü (bkz. §9) |
| `runner.ts` | Tarama düzenleyicisi + "Kaynağı test et" |

## 3. Kaynak izin politikası

| Kaynak | Durum | Gerekçe |
| --- | --- | --- |
| EKAP (ekap.kik.gov.tr) | **Otomatik taranmaz.** Yalnız `manual` kaynak, izinsiz/inceleniyor (DB kısıtı `radar_sources_no_scrape`) | Resmî otomatik erişim API'si / izni yok; oturum ve CAPTCHA korumalı |
| ilan.gov.tr | **Otomatik taranmaz.** Yalnız elle bağlantı | Otomatik erişim için yayımlanmış koşul/API yok |
| Google News RSS | **Eklenmedi** | Google haber sonuçlarının otomatik toplanması kullanım koşullarıyla uyumlu değil; içerik üçüncü taraf yayıncılara ait |
| Belediye / kurum / firma RSS akışları | Sahip tek tek ekler; "Kaynağı test et" ile canlı doğrular; koşulları ve robots.txt'yi kontrol edip izin notunu ve tarihini yazar; ancak sonra **İzinli** yapar | Bu sandbox'tan Türk sitelerine ağ erişimi yok; adaylar dağıtım sonrası canlı doğrulanmalı |
| Tavily (search_api) | Varsayılan kapalı; bkz. §8 | Ücretli/kotalı dış hizmet; ticari kullanım koşulu sahip onayı gerektirir |

**Kaynak ekleme**: LEONX AI → Kaynaklar → *Kaynak ekle* (tür, https adresi, izin durumu, izin notu, kontrol tarihi, kamu/özel
ipucu, aralık ≥ 30 dk, en çok öğe, ek izinli ana makineler) → *Kaynağı test et* (sahip oturumu; kaynak başına 5 dakikada bir;
HTTP durumu, içerik türü, öğe sayısı, ilk 5 başlık/bağlantı, ayrıştırma uyarıları, robots kararı; **hiçbir kayıt yazılmaz**) →
koşullar uygunsa *İzinli* + *Etkin*. **Elle bağlantı**: adres + başlık + metin; metin sunucuda (`radar_add_manual_item`)
temizlenir, öğe "bekliyor" olarak kaydedilir ve sonraki taramada sınıflandırılır; adres indirilmez.

## 4. Güvenli indirme (urlGuard)

Yalnız https · adreste kullanıcı/şifre yok · varsayılan dışı port yok · IP biçimli ana makine yok (ondalık/onaltılık/IPv6
dahil) · localhost/.local/.internal/tek etiketli ad yok · DNS çözümlemesi özel/ayrılmış aralığa (10/8, 172.16/12, 192.168/16,
127/8, 169.254/16, 100.64/10, ::1, fc00::/7, fe80::/10, ::ffff:özel…) düşerse ret · indirilen ana makine = kaynağın kayıtlı
ana makinesi (veya kaynağın açık izin listesi) · yönlendirmeler elle, en çok 3, her adımda yeniden denetim · yanıt ≤ 2 MB ·
süre 15 sn · içerik türü izin listesi. Tavily ana makinesi (`api.tavily.com`) yalnız search_api bağlayıcısında izinlidir.
Kullanıcı aracısı: `LEONX-Radar/1.0`.

## 5. Puanlama

**Fırsat puanı (0–100)** = Σ ağırlık × etken (etken 0–1; ağırlıklar toplamı 100'e normalleştirilir; Ayarlar'dan değişir, canlı önizleme):

| Ölçüt | Varsayılan | Etken |
| --- | --- | --- |
| Kategori uygunluğu | 25 | ilan ürünü adlandırıyor 1 · haberde geçiyor 0,6 · yalnız proje türünden 0,35 · yok 0 |
| İhtiyacın kaynakla doğrulanması | 25 | doğrulanmış ihtiyaç 1, yoksa 0 |
| Proje aşaması ve zaman | 15 | ihale açık (≥3 gün) 1 · <3 gün 0,7 · son tarih yok 0,8 · geçti 0 · planlama 0,8 · yapım 0,6 · tamamlandı 0,05 · bilinmiyor 0,3; × güncellik (≤30 gün 1, ≤90 0,8, ≤180 0,5, eski 0,2, tarih yok 0,7) |
| Ankara yakınlığı | 15 | Ankara (il/ilçe) 1 · komşu il (Bolu, Çankırı, Kırıkkale, Kırşehir, Aksaray, Konya, Eskişehir) 0,6 · diğer il 0,2 · bilinmiyor 0,3 |
| İletişim / teklif yolu | 10 | doğrulanmış tedarikçi portalı/satın alma kanalı 1 · genel kanal 0,7 · İKN/son tarih 0,6 · kurum adı 0,3 · yok 0 |
| Ticari potansiyel | 10 | proje türü büyüklüğü (hastane/otel/toplu konut/AVM/iş merkezi 1; okul/fabrika/kamu binası/spor 0,7; konut 0,6; villa 0,5) + metinde ≥2–3 iş kalemi |

**Güvenilirlik (0–100, ayrı gösterilir)** = kaynak türü (resmî/kamu akışı 30, site 25, akış 22, elle 15, arama özeti 10)
+ izin (izinli 20, inceleniyor 5) + güncellik (≤30 g 20, ≤90 g 12, ≤1 yıl 5) + tarih varlığı 5 + **farklı kaynak teyidi**
(2 kaynak +15, ≥3 +25; `radar_ingest` her birleştirmede yeniden hesaplar).

Yeni öğe aynı kümedeki fırsatla birleşince puan en yüksek değeri alır, doğrulanmış ihtiyaç bir kez kazanılınca düşmez,
farklı şehir veya "tamamlandı ↔ ihale" çelişkisi `kaynak_celiskisi` riski olarak işaretlenir. Bilinen sınır: sonradan eklenen
iletişim kanalları puanın "iletişim" bileşenini ancak sonraki öğe birleşmesinde etkiler (rapor yine güncel kanalları gösterir).

## 6. Bildirimler

Mevcut `public.notifications` ve `leonx_notify` kullanılır; yeni kategori **`firsat`** (`notification_prefs.cat_firsat`,
Ayarlar › Bildirimler › "İş fırsatı bildirimleri"). Radar süzgeçleri `leonx_notify`'dan **önce** uygulanır: en düşük puan
(varsayılan 60), şehir/ilçe ve kategori listeleri, sessiz saatler, günlük özet saati. Metinler ayrışır: "Doğrulanmış iş: …",
"Potansiyel ihtiyaç (doğrulanmadı): …"; doğrulanmış + son tarih ≤ 14 gün → **"Öncelikli Teklif Fırsatı: …"** (sessiz saatte de,
ayar açıksa). Tekilleştirme anahtarı `radar:<fırsat kimliği>` (aynı fırsat ikinci kez bildirilmez); özet `radar:ozet:<tarih>`.
Push, mevcut push-dispatch zamanlayıcısıyla gider.

## 7. KVKK ve ticari ileti

- Yalnız **kurumsal** kanallar: firmanın kendi alan adındaki (veya alt alan adındaki) e-postalar; başka alan adları atlanır.
- Kişi adına benzeyen (ad.soyad, a.soyad) ve kurumsal rol sözcüğü (info, satinalma, teknik, iletisim, ihale…) içermeyen
  e-postalar **saklanmaz**, yalnız sayılır. İK, muhasebe, KVKK, kariyer adresleri alınmaz.
- Her kanal `source_url` + `verified_at` ile saklanır; adres üretilmez veya tahmin edilmez.
- Firma web sitesi yalnız kanıttan gelir veya sahip girer (firma adından türetilmez).
- Tanıtım e-postası taslağı: proje adı, kategori, ayarlardaki genel yetkinlik ifadeleri, teknik doküman talebi; geçmiş proje,
  referans veya sertifika iddiası içermez. Ticari elektronik ileti mevzuatı gereği gönderim kararı ve izin yükümlülüğü
  kullanıcıdadır; sistem **göndermez**.

## 8. Maliyet ve arama API (Tavily)

- Kural motoru, tarama ve depolama: **ücretsiz** (Supabase ücretsiz plan; saatlik tarama, kaynak başına ≥ 30 dk).
- **Tavily** (`search_api` türü, tam uygulandı, varsayılan kapalı): `POST https://api.tavily.com/search`,
  `Authorization: Bearer <anahtar>`, asgari gövde `{query, max_results ≤ 10, search_depth: "basic", topic: "general",
  country: "turkey"}`. Anahtar **yalnız** Edge Function gizli değişkeni `TAVILY_API_KEY`; depoda/istemcide yok.
  Çalışması için üç koşul: (1) kaynak listesinde etkin + izinli bir "Arama API" kaynağı, (2) Ayarlar'da
  `search_api_enabled`, (3) gizli değişken. Eksikse çalıştırma `atlandi` ve nedeni yazılır.
- Bütçe: her çağrıdan **önce** `radar_service_reserve_search()` atomik olarak aylık sayacı (`radar_search_usage`) artırır;
  `search_monthly_limit` (varsayılan **900**, ücretsiz 1.000 kredinin altında) veya `search_daily_limit` (varsayılan 30)
  dolarsa çağrı yapılmaz (`atlandi`, "aylık arama bütçesi doldu"). Tarama başına `search_queries_per_run` (varsayılan 2) sorgu;
  sorgular etkin kategoriler × öncelikli yerler (Ankara, Ankara ilçeleri, sonra büyük iller) Türkçe şablonlarından döngüsel seçilir
  (ör. "Ankara yangın kapısı ihalesi", "Etimesgut hastane projesi alüminyum doğrama").
- Sonuçlar yalnız **arama özeti** kanıt işaretçisidir (adres + özet + varsa tarih); sonuç adresleri indirilmez; güvenilirlik
  düşüktür; özet kendi başına ürünü adlandıran bir ilan değilse ihtiyaç doğrulanmaz.
- **Önemli**: Tavily ücretsiz planı "keşfeden bireyler" için tanımlanıyor; **ticari kullanım koşulları sahip tarafından Tavily
  kullanım koşulları sayfasında onaylanmadan** etkinleştirmeyin.

## 9. Dil modeli (gelecek; bu sürümde YOK)

`Analyzer` arayüzü (`analyzer.ts`) ileride bir dil modeli çözümleyicisinin eklenmesine izin verir; `selectAnalyzer` yalnız
özellik bayrağı açık **ve** bütçe kalmışsa ve aday verilmişse onu seçer, aksi hâlde daima kural motoru. Depoda dil modeli
çağrısı, anahtar veya bağımlılık yoktur; eklenmesi ayrı sahip onayı ve bütçe sınırı gerektirir. Kaynak metni ona da yalnız veri
olarak verilmeli, "doğrulanmış ihtiyaç" kuralı kural motorunca yeniden denetlenmelidir.

## 10. Veritabanı (015)

`supabase/migrations/20261022001500_leonx_radar.sql` — 14 tablo (RLS açık, yalnız `is_owner()`, anon yetkisiz; istemci
yalnız iş akışı/ayar/kaynak/taslak sütunlarını değiştirebilir), `radar_ingest` ve `radar_service_*` (yalnız service_role),
sahip RPC'leri `radar_import_to_crm` (tekrarlanabilir; yalnız radar firma verisi + kaynaklı kanallar), `radar_add_manual_item`,
`radar_claim_source_test`; durum değişikliği → `radar_actions` (tetikleyici); `notifications_category_check` kısıtına
`'firsat'` eklendi (kısıt yeniden tanımlandı; veri silinmez) ve `leonx_notify` aynı imza/gövdeyle `firsat` dalı aldı.
Tekrar çalıştırılabilir; tablo veya veri silme yok; sahte fırsat tohumlanmaz (yalnız ayar satırı ve 32 kategori).

## 11. Dağıtım (sahip onayından sonra; bu dalda YAPILMADI)

1. Migration'ları sırayla uygulayın (015, 016, ardından 017). Uzak veritabanında önce yedek alın ve geri yüklemeyi üretim dışı bir hedefte deneyin.
   013/014 (kasa/BOM dalları) ile uygulama sırası sahip kararıdır (§15).
2. Edge Function'ları yayımlayın:
   - `supabase functions deploy owner-login --no-verify-jwt` (yalnız şifre ile giriş; **arayüzden önce** dağıtılmalı, yoksa giriş ekranı
     "Giriş hizmeti henüz kurulmamış" der). Gizli değer: `OWNER_EMAIL` (sahip hesabının e-postası; istemci paketinde yer almaz),
     isteğe bağlı `OWNER_LOGIN_SALT`. Kaba kuvvet sayaçları 017'deki `owner_login_check/record` (yalnız service_role).
   - `supabase functions deploy radar-scan --no-verify-jwt` (zamanlayıcı JWT taşımaz; istek `x-leonx-cron` ile, test modu sahip JWT + `is_owner()` ile doğrulanır)
   - `supabase functions deploy radar-contacts` (sahip JWT; service_role kullanmaz)
3. Gizli değişkenler: `RADAR_ALLOWED_ORIGINS=https://leonx-os.vercel.app` (CORS); isteğe bağlı `TAVILY_API_KEY` (koşullar onaylandıktan sonra).
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` platform tarafından sağlanır.
4. Zamanlayıcıyı bağlayın (SQL Editor):
   `update leonx_private.radar_config set scan_url = 'https://<proje-ref>.supabase.co/functions/v1/radar-scan' where singleton;`
   (`leonx-radar` her saat :17'de, `leonx-radar-bildirim` :05'te çalışır; adres boşken hiçbir istek yapılmaz.)
5. Kaynakları ekleyin, "Kaynağı test et" ile canlı doğrulayın, izin notunu yazın, ancak sonra "İzinli + Etkin" yapın.
6. (İsteğe bağlı, 016) Cihazlar kapalıyken de yeni sürüm bildirimi için:
   `update leonx_private.release_watch set version_url = 'https://leonx-os.vercel.app/version.json' where singleton;`

**Geri alma**: `update leonx_private.radar_config set scan_url = null where singleton;` (tarama durur) ·
017: `drop trigger if exists radar_opportunity_rescore on public.radar_opportunities; drop trigger if exists radar_contacts_rescore on public.radar_contacts;
drop trigger if exists radar_opportunity_companies_rescore on public.radar_opportunity_companies;` (puanlar son değerinde kalır) ·
yalnız şifre girişini geri almak için önceki arayüz sürümüne dönülür (Vercel → önceki dağıtımı Promote); `owner-login` kaldırılabilir ·
016 işleri: `select cron.unschedule(j) from unnest(array['leonx-radar-gunluk','leonx-radar-haftalik','leonx-radar-guncelleme','leonx-radar-saglik','leonx-surum']) j;`,
`update leonx_private.release_watch set version_url = null where singleton;` · kaynakları pasif yapın ·
`select cron.unschedule('leonx-radar'); select cron.unschedule('leonx-radar-bildirim');` · Edge Function'ları kaldırın ·
`radar_settings.search_api_enabled = false` · `TAVILY_API_KEY`'i silin. Tablolar veri kaybı olmadan kalır; arayüz boş durumu gösterir.

## 12. Testler

- Vitest (`supabase/functions/_shared/radar/*.test.ts`, `src/radar/view.test.ts`, `src/export/radarExport.test.ts`): akış
  ayrıştırıcı, temizleme, kanonikleştirme, SSRF (özel IP, IPv6 geri döngü, başka makineye yönlendirme, kimlik, port, boyut,
  zaman aşımı), robots, il/ilçe, sınıflandırma (Etimesgut yangın kapısı ihalesi → doğrulanmış; hastane haberi → potansiyel;
  tamamlanmış → risk; prompt injection), puan/güvenilirlik, kümeleme, iletişim (alan adı, kişisel ad, üretim yok), asistan,
  Tavily (kayıtlı sentetik yanıt, bütçe, Bearer başlığı), tarayıcı (izinsiz kaynak indirilmez, 304, robots, test modu).
  Tüm fikstürler `__fixtures__/` altında ve **SENTETİK** olarak işaretlidir.
- Veritabanı: `supabase/tests/radar.test.sql` (RLS, yalnız service_role ingest, tekrar ingest, küme birleşmesi, bildirim
  tekilleştirme, CRM aktarımı tekrarlanabilir ve yalnız sahip, iletişim zorunlu alanları, arama bütçesi, geri çekilme).
- Tarayıcı: `e2e/app.e2e.mjs` "LEONX AI Radar" testleri (sahte Supabase; Edge Function'lar dağıtılmış/dağıtılmamış).

## 13. Bilinen sınırlar

- Gerçek kaynak akışları bu ortamdan doğrulanamadı (ağ yok); dağıtımdan sonra her kaynak "Kaynağı test et" ile denenmeli.
- Edge Function'lar Deno ile yerelde çalıştırılmadı (ortamda Deno yok); çekirdek mantık aynı modüllerle Vitest'te sınandı.
- `site` türü yalnız kayıtlı liste sayfasındaki aynı makine başlık bağlantılarını öğe sayar (bağlantılar indirilmez; özet boş).
- İl/ilçe sözlüğü 81 ilin 922 ilçesini içerir ("Merkez" ilçeler hariç). İl adı geçmeden yalnız ayırt edici ilçe adından il çıkarılır
  (düşük güven); aynı adlı ilçeler (Ereğli, Yenişehir…) ve gündelik sözcük/kulüp adları (Pazar, Kale, Beşiktaş…) il geçmedikçe konum sayılmaz.
  Ankara semti olan adlar (Bahçelievler, Maltepe, Kavaklıdere) başka ile kaydırılmaz. Mahalle düzeyi yoktur.
- 0.14.0'dan önce puanın iletişim bileşeni sonradan bulunan kanallarla yeniden hesaplanmıyordu; 017 ile düzeltildi (§15).

## 14. Zamanlanmış istihbarat (016, `20261023001600_leonx_radar_intel.sql`)

Tümü sunucuda (pg_cron) çalışır; hiçbir cihazın açık olması gerekmez. Saatler Türkiye saati.

| İş | Zaman | Ne yapar | Tekilleştirme |
| --- | --- | --- | --- |
| `leonx-radar` (015) | her saat :17 | keşif/güncelleme taraması | `radar:<id>` |
| `leonx-radar-guncelleme` | her saat :35 | son tarih hatırlatması (7/3/1/0 gün; yalnız takip edilen veya doğrulanmış açık fırsatlar) + önemli değişiklik bildirimi | `radar:son:<id>:<gün>`, `radar:degisim:<id>:<zaman>` |
| `leonx-radar-saglik` | her saat :50 | ≥3 ardışık hata veren kaynak; tarama bağlı + izinli kaynak varken 3 saattir çalıştırma yok | `radar:saglik:…:<gün>` (günde bir) |
| `leonx-radar-gunluk` | 07:30 | günlük öncelikli rapor (`radar_reports`) | `radar:rapor:gunluk:<tarih>` |
| `leonx-radar-haftalik` | Pazartesi 08:00 | haftalık hat, 7 gündür hareketsiz takipler, yaklaşan son tarihler | `radar:rapor:haftalik:<tarih>` |
| `leonx-surum` | 10 dakikada bir | `version.json` yoklaması; yeni **production** derlemesi → `surum_yeni` | `surum_yeni:<buildId>` (açık uygulamanın `notify_client_event` çağrısıyla aynı anahtar → tek bildirim) |

- **Önemli değişiklik**: daha önce bildirilmiş bir fırsatta aşama, son tarih, doğrulanmış ihtiyaç veya etiket değişirse `radar_changes`
  satırı yazılır (tetikleyici; bu sütunları yalnız sunucu değiştirebilir). Fırsat başına tek birleşik bildirim; puan eşiği ve sessiz saat uygulanır.
- **Raporlar**: LEONX AI › Raporlar. PDF/Excel aynı çiziciyle; potansiyel kayıtlar "doğrulanmış ihale değildir" notuyla.
- **Sağlık**: Raporlar bölümünde `radar_health()` özeti (yalnız sahip). Hata bildirimleri `sistem` kategorisinde.
- **Sürüm izleme** varsayılan **kapalı** (`release_watch.version_url` boş); yalnız `https://…/version.json` kabul edilir. İki adımlı pg_net
  yoklaması: önceki isteğin yanıtı okunur, yeni istek atılır; ilk okuma yalnız temel alınır, preview derlemeleri ve HTTP hataları bildirilmez.
- **CRM**: "Görev oluştur" (`radar_create_task`; proje adayı yoksa tekrarsız oluşturulur, son tarih ≤7 gün → acil) ve "Teklif taslağı"
  (CRM firması gerekir; mevcut teklif modülünde **taslak**, kalem/fiyat girilmez, aynı proje+firma için ikinci taslak açılmaz).
- Tablolar `radar_reports`, `radar_changes`: RLS (yalnız sahip okur), istemci yazamaz, Realtime yayınında.

## 15. Yayın hazırlığı (0.14.0, 017 `20261025001700_leonx_radar_release.sql`)

**Yalnız şifre ile giriş.** Giriş ekranında yalnız *Şifre* alanı ve *Giriş Yap* düğmesi vardır. İstemci şifreyi `owner-login` Edge
Function'ına gönderir; işlev sahip e-postasını `OWNER_EMAIL` gizli değerinden okur, Supabase Auth girişini sunucuda yapar ve oturum
belirteçlerini döner (istemci `supabase.auth.setSession`). Yetki modeli değişmez: RLS + `is_owner()`; anon rolüne veri yetkisi yoktur.
Kaba kuvvet koruması: IP adresinin SHA-256 özetiyle (IP açık metin saklanmaz) 15 dakikalık pencerede 5 hatadan sonra 30 sn × 2^(hata−5)
kilit (en çok 1 saat), genel sınır 15 dakikada 50 hata → 5 dakika; hatalı denemede 0,8 sn sabit gecikme, genel ileti ("Şifre hatalı.").
Supabase Auth'un kendi hız sınırları da geçerlidir. CORS: `RADAR_ALLOWED_ORIGINS`; listede olmayan `Origin` 403. Şifre ve e-posta loglanmaz.
Bilinen ödünleşimler: IP, vekilin ilettiği `x-forwarded-for` başlığından okunur; başlığı değiştiren bir saldırgan IP sınırını aşsa da genel
sınıra takılır. Genel sınır, kasıtlı hatalı denemelerle sahibin yeni girişini en çok 5 dakika geciktirebilir; açık oturumlar etkilenmez.
Şifre tek etken olduğundan uzun ve benzersiz olması zorunludur.
**Şifre**: `123456` kamuya açıklanmış bir şifredir, kullanılmaz. Sahip Supabase panelinde (Authentication → Users) en az 16 karakterli güçlü
bir şifre belirler; yayın bu onaya bağlıdır. Şifre hiçbir yerde saklanmaz, Claude tarafından seçilmez.

**İletişim etkeninin yeniden hesaplanması.** `score_breakdown` içindeki `iletisim` parçası artık sınıflandırmadan gelen taban değeri
(`base_factor`, `base_reason`) taşır. Fırsatın bağlı firmalarına kaynaklı kanal eklenince/silinince veya firma bağlantısı değişince
tetikleyici aynı kuralla (portal / ihale adresi / satın alma e-postası → 1; diğer kanal → 0,7; yoksa taban) etkeni ve toplam puanı yeniden
hesaplar. Tarama dökümü yeniden yazsa da kayıtlı kanal korunur. 017 mevcut kayıtları bir kez yeniden puanlar.

**Fırsattan teklif.** `quotes.radar_opportunity_id` (benzersiz): fırsat başına tek teklif taslağı; iki cihaz aynı anda bassa da ikinci taslak
açılmaz, mevcut olan açılır. Revizyon ve kopyalar bu bağı taşımaz. Taslakta kalem ve fiyat üretilmez ("fiyat tanımlanmamış").

**CRM hattı.** Panelde *Liste / CRM hattı* görünümü. Sütunlar mevcut durum değerleridir: Keşfedildi (yeni) → Araştırılıyor (inceleniyor) →
Nitelikli (firma_dogrulandi) → İletişime hazır (iletisim_planlandi) → İletişime geçildi → Teklif istendi → **Teklif hazırlandı** (bağlı
taslaktan türetilir; yeni durum değeri eklenmedi) → Teklif verildi → Görüşme → Kazanıldı / Kaybedildi (ilgisiz gösterilmez).

**Öneri (tavsiye).** Her kartta ve fırsat sayfasında `advice.ts` kuralıyla beş öneriden biri: Hemen iletişime geç · Teklif hazırla ·
Araştırmaya devam et · Sonra takip et · Düşük öncelik — gerekçesiyle ve "tavsiyedir, doğrulanmış bilgi değildir" etiketiyle.

**Asistan.** Yeni soru türleri: "henüz ihaleye çıkmamış", "son N günde değişenler" (son güncelleme tarihine göre), "öncelikli N işim"
(açık kayıtlar + öneri), "hangi firmalara teklif göndermeliyim" (yalnız kaynaklı kanalı olan firmalar; öneri etiketli), "bu proje için hangi
bilgiler eksik" ve "bu firmaya teklif talep mesajı hazırla" (fırsat sayfasındaki asistan odaktaki kaydı kullanır). Odak veya ad yoksa
asistan hangi kaydı kastettiğinizi sorar; uydurmaz.

**Kategori eşlemesi** (yeni kategori gerekmedi): alüminyum → `aluminyum_dograma`; PVC → `pvc_dograma`; giydirme/cam cephe → `giydirme_cephe`,
`cam_cephe`; kompozit → `kompozit_cephe`; cam balkon → `surme_sistemleri`, cam korkuluk → `aluminyum_korkuluk`; çelik kapı → `celik_kapi`;
yangın kapısı → `yangin_kapisi`; iç kapı → `oda_kapisi`, `ahsap_melamin_kapi`, `lake_kapi`; giriş/pivot → `bina_giris_kapisi`,
`villa_giris_kapisi`, `pivot_kapi`; korkuluk/metal → `metal_korkuluk`, `kupeste`, `dekoratif_metal_cephe`; çelik yapı → `ozel_metal_imalat`;
lazer/delikli sac → `lazer_kesim`, `boru_profil_lazer`, `delikli_sac`, `cnc_abkant`.

**Kaynak adayları**: `docs/LEONX_RADAR_KAYNAK_ADAYLARI.md` — sahip onayı için; hiçbiri "İzinli" yapılmadı.

**Testler**: `supabase/tests/radar_release.test.sql` (giriş koruması, yeniden puanlama, tekil teklif), `_shared/auth/ownerLogin.test.ts`,
`_shared/radar/release.test.ts` (8 örnek soru, öneri, taban etken), il/ilçe testleri (`classify.test.ts`), tarayıcıda yalnız şifre girişi,
kilit iletisi, hizmet kurulmamış iletisi, CRM hattı, Android (Pixel 7) ekranı.
