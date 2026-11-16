# LEONX AI Radar — Özel sektör keşfi ve e-posta erişimi (0.17.0)

Migration: `supabase/migrations/20261116002000_leonx_radar_private.sql` (020, yalnız ekleme yapar; mevcut kayıt silinmez/değişmez).

## 1. Neden? (üretim denetimi, 16 Kasım 2026, salt okunur)

- 20 kaynaktan yalnız 4'ü etkin + izinli ve **hepsi kamu** (Ankara BB ihaleler/duyurular, Kahramanmaraş BB, Osmaniye).
- 4 fırsatın 4'ü kamu; 2 firma; arama API'si kapalı (`search_api_enabled = false`), hiç kullanılmamış.
- Son 30 günde 864 tarama, 435 öğe, 21.302 eleme: radar çalışıyordu ama özel sektör için bakacağı yer yoktu.
- Eski sorgu şablonları "{yer} {kategori} ihalesi" biçimindeydi (ihale odaklı).
- Puanlama ihaleye göre ayarlıydı: "Etimesgut 24 daireli kaba inşaat" 39 puan, bir cephe ihalesi 83 puan alıyordu;
  bildirim eşiği 60 olduğundan özel projeler hiç bildirilmiyordu. Firma sayfaları "bilinmiyor" sektörle, "devam eden
  projeler" sayfaları D sınıfıyla kayıt oluyordu; daire sayısı, firma keşfi ve ilçe kapsamı yoktu.

## 2. Mimari

| Katman | Dosya | Görev |
|---|---|---|
| Sorgu planı | `_shared/radar/discovery.ts` | Ankara + 25 ilçe (öncelikli), Hatay ve Kahramanmaraş ilçeleri (ikincil, her 6 çalıştırmada bir). 26 Türkçe kalıp: proje / firma / aşama / tedarik / site. En az aranmış ilçe önce, 7 gün bekleme, aynı ilçeye bir çalıştırmada tek sorgu. |
| Sayfa değerlendirme | `_shared/radar/company.ts` | Sayfa türü (firma sitesi, firma proje sayfası, haber, ilan portalı, kamu), firma adı (yalnız metinden; bulunamazsa alan adı ve bu açıkça işaretlenir), daire sayısı, ölçek (küçük ≤10 / yerel ≤30 / orta ≤100 / büyük). |
| Aşama ve puan | `_shared/radar/privateIntel.ts` | Aşama yalnız kanıtla (URL + yayın tarihi ≤180 gün) "aktif" sayılır; aksi halde **"Aşama doğrulanamadı"**. Şeffaf puan: ürün 22, aşama 20, güncellik 15, coğrafya 12, talep 12, iletişim 10, ölçek 5, geçmiş 4. Küçük/yerel/orta firmalar cezalandırılmaz. |
| Keşif çalıştırıcı | `_shared/radar/discoveryRunner.ts` | Arama API → güvenli getirme (SSRF koruması, robots.txt) → değerlendirme → `radar_ingest` → firma kaydı → firma izleme (ana sayfa + en çok 2 proje sayfası) → taslak hazırlama. |
| Ürün eşleme ve e-posta | `_shared/radar/outreach.ts` | LEONX METAL ve ERLİN KAPI hizmetleri; Türkçe kişiselleştirilmiş e-posta; proje bilgisi uydurulmaz, "teklif istediniz" denmez; "LİSTEDEN ÇIKAR" satırı; 14 engel nedeni. |
| Gmail | `_shared/radar/gmail.ts`, `functions/radar-outreach` | OAuth 2.0 yenileme anahtarı; gönderici yalnız `erlindoorkapi@gmail.com` (veritabanı kısıtı da var). Başlık enjeksiyonu reddedilir. |
| Durum | `discoveryStatus()` + `radar_discovery_runs` | başarılı-yeni / başarılı-yeni yok / eksik / başarısız / kaynak yok / kota bitti ayrı gösterilir; yapılandırma eksikse "başarılı" yazılmaz. |
| Panel | `src/features/radar/PrivateSectorPanel.tsx` | LEONX AI → **Özel Sektör**: Özel Sektör Projeleri, Yeni Başlayan İnşaatlar, Aktif Şantiyeler, Müteahhit Firmaları, Teklif Fırsatları, Kamu İhaleleri. 9 filtre + arama, kanıt, puan dökümü, e-posta inceleme kuyruğu, yanıt takibi, ilçe kapsamı, çalıştırma günlüğü, gerçek performans (yalnız kayıtlı gönderim/yanıt/eylemlerden). |

Potansiyel fırsat ile doğrulanmış satın alma talebi her yerde ayrı gösterilir (`procurement_status`).

## 3. Zamanlama ve kota

- `leonx-radar-kesif` her saat :47'de keşif (çalıştırma başına 1 sorgu, varsayılan). Ayda ≈720 sorgu; mevcut bütçe
  900/ay ve 30/gün (`radar_service_reserve_search`). Kota bitince durum "kota bitti" olur, sessiz geçilmez.
- `leonx-radar-eposta` hafta içi 09:52–18:52 TR: yalnız tüm denetimlerden geçen ve onaylı taslakları gönderir.

## 4. Gerçek e-posta neden kapalı?

Otomatik gönderim için hepsi gerekir: Gmail sırları, `RADAR_OUTREACH_SEND_ENABLED=true`, Gmail doğrulaması
(yetki veren hesap = erlindoorkapi@gmail.com), yasal not + onay tarihi (veritabanı kısıtı), alıcının doğrulanmış kurumsal adres olması,
listeden çıkma ve bastırma listesi, günlük sınır, firma başına tekrar engeli, acil durdurma anahtarı. Biri eksikse taslak
"inceleme" kuyruğunda kalır; panelden onaylanıp elle gönderilebilir. Claude hesabı hiçbir zaman gönderici değildir.

## 5. Eren'in yapacakları (sıra önemli)

1. 020'yi üretime uygula (onayınla).
2. Edge Function'ları dağıt: `radar-scan` (keşif modu) ve yeni `radar-outreach`.
3. Tavily: kullanım koşullarını onayla, `TAVILY_API_KEY`'i **Edge Function sırrı** olarak ekle (repoya/notlara değil).
4. Panelde "Özel sektör keşfi — Arama API (Tavily)" kaynağını izinli + etkin yap; Ayarlar'da arama API'sini ve keşfi aç.
5. Gmail OAuth: aşağıdaki 7. bölüm (sırlar, doğrulama, kontrollü test gönderimi).
6. `leonx_private.radar_config.outreach_url` = `https://<proje>.supabase.co/functions/v1/radar-outreach`.
7. Yasal notu (ticari ileti onayı / İYS durumu) yaz ve onayla. Ancak bundan sonra ve kontrollü test gönderimi
   başarılı olduktan sonra `RADAR_OUTREACH_SEND_ENABLED=true` ve paneldeki otomatik gönderim açılabilir.

## 6. Testler

- `supabase/functions/_shared/radar/private.test.ts` (24 birim testi), `supabase/tests/radar_private.test.sql` (DB),
  `e2e/app.e2e.mjs` "LEONX AI Radar 020" (2 uçtan uca test, sentetik veri).

## 7. Gmail OAuth kurulumu — tek gönderici: erlindoorkapi@gmail.com

Tüm müşteri e-postaları YALNIZ `erlindoorkapi@gmail.com` hesabından gider. Bu adres kodda (`SENDER_EMAIL`), veritabanında
(`radar_settings.gmail_sender` ve `radar_outreach_sends.sender` kısıtları) ve doğrulamada sabittir; başka hesabın
belirteciyle doğrulama da gönderim de reddedilir.

**A. Google Cloud (`leonx-os-mail` projesi, mevcut yönetici hesabıyla)**

1. APIs & Services → Library → **Gmail API**'yi etkinleştir.
2. OAuth consent screen (Google Auth Platform → Branding / Audience): User type **External**; uygulama adı örn.
   "LEONX OS Radar"; destek ve geliştirici e-postası. Audience → Test users'a `erlindoorkapi@gmail.com` ekle.
3. Data access (Scopes): yalnız şu üçü —
   `https://www.googleapis.com/auth/gmail.send`, `openid`, `https://www.googleapis.com/auth/userinfo.email`.
   Gmail okuma kapsamları (`gmail.readonly`, `gmail.metadata`) GEREKMEZ; hesap kimliği id_token'dan okunur.
4. **Önemli:** Uygulama "Testing" durumundayken Google yenileme belirteçlerini **7 günde** geçersiz kılar. Kalıcı
   çalışma için Audience → **Publish app** (In production). Yalnız kendi hesabınız kullanacağından doğrulama
   başvurusu şart değildir; yetki ekranında "Google bu uygulamayı doğrulamadı" uyarısı çıkar → Gelişmiş → devam.
5. Clients → Create client → **Web application**. Authorized redirect URIs:
   `https://developers.google.com/oauthplayground` (yalnız bu; başka URI eklemeyin).
   Client ID ve Client secret'ı kopyalayın (hiçbir dosyaya/sohbete yazmayın).

**B. Yenileme belirteci (refresh token) üretimi**

1. https://developers.google.com/oauthplayground → sağ üstte ⚙ → "Use your own OAuth credentials" → Client ID/secret.
   "Access type: Offline", "Force prompt: Consent Screen" seçili olsun.
2. Step 1'de kutuya üç kapsamı boşlukla yazın:
   `https://www.googleapis.com/auth/gmail.send openid https://www.googleapis.com/auth/userinfo.email` → Authorize APIs.
3. Google oturum ekranında **erlindoorkapi@gmail.com** ile giriş yapın (başka hesap seçmeyin) → izin verin.
4. Step 2 → "Exchange authorization code for tokens" → **Refresh token** değerini kopyalayın.
5. Playground'da ⚙ altından kimlik bilgilerini silin; isterseniz https://myaccount.google.com/permissions'dan
   yalnız bu uygulamanın erişimini görebilir/iptal edebilirsiniz (iptal → belirteç geçersiz olur).

**C. Supabase Secrets (Dashboard → Edge Functions → Secrets)**

`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`. `RADAR_OUTREACH_SEND_ENABLED` **eklemeyin**
(yoksa ya da `true` değilse müşteri gönderimi kesin kapalıdır). Sırlar repoda, veritabanında, istemcide ve loglarda yoktur.

**D. Doğrulama ve kontrollü test (radar-outreach dağıtıldıktan sonra)**

Her iki çağrı da `x-leonx-cron` başlığında zamanlayıcı sırrı ister (`leonx_private.push_config.cron_secret`).

1. `POST /functions/v1/radar-outreach` gövde `{"gmail_check": true}` → yenileme belirteci alınır, id_token'daki
   doğrulanmış e-posta `erlindoorkapi@gmail.com` ise `gmail_verified_at` yazılır; değilse doğrulama silinir ve otomatik
   gönderim kapanır. Panelde "Gmail (erlindoorkapi@gmail.com): Doğrulandı" görünür.
2. `{"test_send": true}` → yalnız `erlindoorkapi@gmail.com`'un **kendisine** tek bir test iletisi gider (müşteriye
   gitmez, kuyruğa dokunmaz). Gelen kutusunda "LEONX Radar test gönderimi" iletisini kontrol edin.
3. Müşteri gönderimi bu adımlardan sonra bile kapalıdır; açmak için 5. bölüm 7. adım.
