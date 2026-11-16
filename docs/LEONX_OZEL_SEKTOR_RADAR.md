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
| Gmail | `_shared/radar/gmail.ts`, `functions/radar-outreach` | OAuth 2.0 yenileme anahtarı; gönderici yalnız `info@erlinkapi.tr` (veritabanı kısıtı da var). Başlık enjeksiyonu reddedilir. |
| Durum | `discoveryStatus()` + `radar_discovery_runs` | başarılı-yeni / başarılı-yeni yok / eksik / başarısız / kaynak yok / kota bitti ayrı gösterilir; yapılandırma eksikse "başarılı" yazılmaz. |
| Panel | `src/features/radar/PrivateSectorPanel.tsx` | LEONX AI → **Özel Sektör**: Özel Sektör Projeleri, Yeni Başlayan İnşaatlar, Aktif Şantiyeler, Müteahhit Firmaları, Teklif Fırsatları, Kamu İhaleleri. 9 filtre + arama, kanıt, puan dökümü, e-posta inceleme kuyruğu, yanıt takibi, ilçe kapsamı, çalıştırma günlüğü, gerçek performans (yalnız kayıtlı gönderim/yanıt/eylemlerden). |

Potansiyel fırsat ile doğrulanmış satın alma talebi her yerde ayrı gösterilir (`procurement_status`).

## 3. Zamanlama ve kota

- `leonx-radar-kesif` her saat :47'de keşif (çalıştırma başına 1 sorgu, varsayılan). Ayda ≈720 sorgu; mevcut bütçe
  900/ay ve 30/gün (`radar_service_reserve_search`). Kota bitince durum "kota bitti" olur, sessiz geçilmez.
- `leonx-radar-eposta` hafta içi 09:52–18:52 TR: yalnız tüm denetimlerden geçen ve onaylı taslakları gönderir.

## 4. Gerçek e-posta neden kapalı?

Otomatik gönderim için hepsi gerekir: Gmail sırları, `RADAR_OUTREACH_SEND_ENABLED=true`, Gmail doğrulaması
(profil = info@erlinkapi.tr), yasal not + onay tarihi (veritabanı kısıtı), alıcının doğrulanmış kurumsal adres olması,
listeden çıkma ve bastırma listesi, günlük sınır, firma başına tekrar engeli, acil durdurma anahtarı. Biri eksikse taslak
"inceleme" kuyruğunda kalır; panelden onaylanıp elle gönderilebilir. Claude hesabı hiçbir zaman gönderici değildir.

## 5. Eren'in yapacakları (sıra önemli)

1. 020'yi üretime uygula (onayınla).
2. Edge Function'ları dağıt: `radar-scan` (keşif modu) ve yeni `radar-outreach`.
3. Tavily: kullanım koşullarını onayla, `TAVILY_API_KEY`'i **Edge Function sırrı** olarak ekle (repoya/notlara değil).
4. Panelde "Özel sektör keşfi — Arama API (Tavily)" kaynağını izinli + etkin yap; Ayarlar'da arama API'sini ve keşfi aç.
5. Gmail: Google Cloud'da OAuth istemcisi; info@erlinkapi.tr ile `gmail.send` (+ profil denetimi için `gmail.metadata`)
   kapsamında yenileme anahtarı al; `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` sırlarını ekle.
   Ardından `radar-outreach` işlevini cron sırrıyla `{"gmail_check": true}` gövdesiyle bir kez çağır; profil
   info@erlinkapi.tr ise `gmail_verified_at` yazılır ve panelde "Doğrulandı" görünür.
6. `leonx_private.radar_config.outreach_url` = `https://<proje>.supabase.co/functions/v1/radar-outreach`.
7. Yasal notu (ticari ileti onayı / İYS durumu) yaz ve onayla. Ancak bundan sonra `RADAR_OUTREACH_SEND_ENABLED=true`
   ve paneldeki otomatik gönderim açılabilir.

## 6. Testler

- `supabase/functions/_shared/radar/private.test.ts` (21 birim testi), `supabase/tests/radar_private.test.sql` (DB),
  `e2e/app.e2e.mjs` "LEONX AI Radar 020" (2 uçtan uca test, sentetik veri).
