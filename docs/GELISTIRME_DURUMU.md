# LEONX OS — Geliştirme durumu

Son güncelleme: Faz 7 (proje yönetimi, görevler, bildirim merkezi ve push) · uygulama sürümü 0.7.0

Tek üretim adresi: <https://leonx-os.vercel.app> (yalnızca `main` dalından). Çalışan derlemenin kimliği
**Ayarlar → Sürüm bilgisi** ekranında ve `/version.json` adresinde görünür.

## Tamamlanan fazlar

| Faz | Kapsam |
| --- | --- |
| 1–3 | Arayüz altyapısı, Vercel dağıtımı, kurumsal tasarım ve tema |
| 4 | Giriş, Supabase, RLS, firmalar, projeler, dosyalar, Realtime |
| 5 | DXF/PDF analizi, CAD görüntüleyici, poz tespiti, metraj, Excel/PDF; tek sürüm ve güncelleme algılama |
| 5.1 | Mimari PDF: tüm sayfaların okunması ve sayfa seçimi, pafta sınıflandırma (plan/görünüş/kesit/çizelge), poz kodu + "EN/BOY" etiketleri, doğrama çizelgesi, plan sayımı (görünüş tekrarı sayılmaz), ölçü yazılarından ölçek çıkarımı ve açıklık geometrisiyle doğrulama, taranmış sayfalar için cihaz içi Türkçe OCR, sonuç tablosu (düzenleme, onay, çizimde gösterme), sonuç yoksa neden açıklaması, metrajdan teklife aktarma |
| 6 | Teklifler: numaralandırma, kalemler (elle / metrajdan), maliyet-kâr-indirim-KDV, revizyon, kopya, durum kilidi, proje bağlantısı, kurumsal PDF ve Excel, teklif ayarları |

| 7 | 12 aşamalı proje akışı (liste + pano), ilerleme, adres/harita, gerçek bitiş tarihi; görev ve termin (hatırlatma, gecikme); sunucu olaylarından işlem geçmişi; bildirim merkezi (zil, geçmiş, okundu eşitleme, tercihler); Web Push (VAPID, kendi service worker'ı); canlı yönetim paneli; teklif kabulünde aşama önerisi |

## Veritabanı

Migration'lar `supabase/migrations/` altında, sırasıyla 001–009. Hepsi gerçek Supabase projesine uygulandı; tümü
tekrar çalıştırılabilir ve DROP/veri silme içermez.

## Testler

| Komut | Kapsam |
| --- | --- |
| `npm run test` | Mimari PDF analizi (çok sayfalı proje, çizelge, ölçeksiz plan, yanlış ölçek, yazısız/taranmış/boş/bozuk PDF, OCR), hesap motorları (metraj, teklif), birim dönüşümleri, PDF/Excel içerik ve toplam eşitliği, sürüm, yeniden deneme |
| `npm run test:db` | Migration'lar iki kez + RLS, kilit, numara, revizyon, silme ilişkileri (yerel PostgreSQL) |
| `npm run test:e2e` | Tarayıcı akışları (sahte Supabase): giriş, CRUD, çoklu cihaz, çevrimdışı, sürüm, CAD/metraj, teklif akışları, 6 ekran × 2 tema |
| `supabase/tests/*.remote_safe.sql` | Gerçek Supabase'de silmesiz, geri alınan RLS/kural testleri |

CI (GitHub Actions) her PR'da kalite, veritabanı ve tarayıcı testlerini çalıştırır; Vercel build'i birim testleri ve
yayın kapısını (gizli anahtar taraması, sürüm dosyası) yeniden çalıştırır.

## Gerçek cihazda doğrulanması gerekenler

Otomatik testler Chromium cihaz öykünmesiyle yapılır; aşağıdakiler gerçek cihazda henüz doğrulanmadı:

- iPad / iPhone ana ekran uygulamasında "Yeni sürüm hazır" bildirimi ve güncelleme
- Windows, iPad ve telefon arasında teklif/proje/müşteri değişikliklerinin anlık görünmesi
- iPad'de teklif PDF'inin indirilmesi ve "Önizle" ile açılması
- iPad Safari'de büyük çok sayfalı PDF'lerin bellek/performansı ve OCR süresi (Chromium'da ~3 sn/sayfa)
- Uçak modu → kayıt → bağlantı geri gelince tek kayıt oluşması

## PDF analizi — ne çalışır, ne sınırlıdır

| PDF türü | Durum |
| --- | --- |
| CAD'den vektörel çıktı, poz kodu + "120/150" etiketli planlar | Çalışır: adet planlardan, ölçü yazıdan; ölçek bulunursa açıklık genişliği çizgiyle doğrulanır |
| Doğrama çizelgesi (POZ · CİNSİ · MALZEME · EN · BOY · ADET) | Çalışır: adet/ölçü/malzeme çizelgeden; plan sayımıyla karşılaştırılır, fark uyarılır |
| Kodsuz, yalnız "EN/BOY" yazılı plan | Çalışır: aynı ölçüler gruplanır; tür ölçüden tahmin edilir, iş grubu kullanıcı seçer |
| Taranmış (görüntü) PDF | Sınırlı: OCR ile yazılar okunur; güven düşük tutulur, rakam hataları olabilir, geometri doğrulaması yapılmaz |
| Yazısız (yalnız çizgi) PDF | Otomatik metraj üretilmez (tür/adet güvenilir çıkarılamaz); neden gösterilir, kalibrasyon + elle ölçüm önerilir |
| Yazıları eğri/yol olarak dışa aktarılmış PDF | Yazı okunamaz → yazısız PDF gibi davranır (OCR yalnız taranmış sayfalarda önerilir) |
| Normal/tip kat planları | Adet tek kat için sayılır; kat çarpanı uyarısı verilir, kullanıcı düzeltir |
| DWG | Desteklenmez (DXF'e dönüştürme rehberi) |

Testler gerçekçi üretilmiş fikstürlerle yapıldı (`scripts/cad-fixtures/make_pdf_fixtures.mjs`); kullanıcıya ait gerçek
proje PDF'i ile henüz doğrulanmadı.

## Push bildirimleri — durum

- Altyapı: `public/sw.js` (yalnız bildirim; önbellek ve istek yakalama yok, sürüm güncellemesini etkilemez),
  `push_subscriptions` (cihaz bazında), Edge Function `push-dispatch` (VAPID, RFC 8291 şifreleme), pg_cron.
- Otomatik test: şifreleme abonenin anahtarıyla çözülerek doğrulandı; geçersiz abonelik (404/410) kapatma,
  tekilleştirme ve tercihler test edildi.
- **Gerçek cihazda doğrulanmadı**: iPhone/iPad ana ekran PWA, Android ve Windows'ta push'un fiilen ulaşması
  ve bildirime dokununca doğru ekranın açılması. Ayarlar → Bildirimler → "Test bildirimi gönder" ile
  her cihazda denenmelidir.

## Bilinen sınırlar

- DWG dosyaları doğrudan okunmaz (DXF'e dönüştürme rehberi gösterilir).
- Push gönderimi dakikalık zamanlayıcıyla yapılır (en geç ~1–2 dk gecikme). iOS'ta push yalnız ana ekrana
  eklenmiş uygulamada çalışır.
- Normal/tip kat çarpanı otomatik uygulanmaz.
- Çevrimdışı düzenleme yok; açık formdaki bilgi korunur, kayıt bağlantı gelince yapılır.
- Teklif PDF'inde firma adresi, vergi ve banka bilgileri **Ayarlar → Teklif ayarları** doldurulunca görünür
  (sistem uydurma bilgi yazmaz).
- Kur çevrimi yapılmaz: teklif seçilen para biriminde hazırlanır, tutarlar o para biriminde girilir.
- Otomatik PR birleştirme GitHub ayarı (Allow auto-merge + zorunlu kontroller) depo sahibince açılmalıdır.
- LEONX AI henüz geliştirilmedi.
