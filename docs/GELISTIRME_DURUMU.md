# LEONX OS — Geliştirme durumu

Son güncelleme: Faz 6 (teklif, maliyet ve poz yönetimi) · uygulama sürümü 0.6.0

Tek üretim adresi: <https://leonx-os.vercel.app> (yalnızca `main` dalından). Çalışan derlemenin kimliği
**Ayarlar → Sürüm bilgisi** ekranında ve `/version.json` adresinde görünür.

## Tamamlanan fazlar

| Faz | Kapsam |
| --- | --- |
| 1–3 | Arayüz altyapısı, Vercel dağıtımı, kurumsal tasarım ve tema |
| 4 | Giriş, Supabase, RLS, firmalar, projeler, dosyalar, Realtime |
| 5 | DXF/PDF analizi, CAD görüntüleyici, poz tespiti, metraj, Excel/PDF; tek sürüm ve güncelleme algılama |
| 6 | Teklifler: numaralandırma, kalemler (elle / metrajdan), maliyet-kâr-indirim-KDV, revizyon, kopya, durum kilidi, proje bağlantısı, kurumsal PDF ve Excel, teklif ayarları |

## Veritabanı

Migration'lar `supabase/migrations/` altında, sırasıyla 001–006. Hepsi gerçek Supabase projesine uygulandı; tümü
tekrar çalıştırılabilir ve DROP/veri silme içermez.

## Testler

| Komut | Kapsam |
| --- | --- |
| `npm run test` | Hesap motorları (metraj, teklif), birim dönüşümleri, PDF/Excel içerik ve toplam eşitliği, sürüm, yeniden deneme |
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
- Uçak modu → kayıt → bağlantı geri gelince tek kayıt oluşması

## Bilinen sınırlar

- DWG dosyaları doğrudan okunmaz (DXF'e dönüştürme rehberi gösterilir).
- Çevrimdışı düzenleme yok; açık formdaki bilgi korunur, kayıt bağlantı gelince yapılır.
- Teklif PDF'inde firma adresi, vergi ve banka bilgileri **Ayarlar → Teklif ayarları** doldurulunca görünür
  (sistem uydurma bilgi yazmaz).
- Kur çevrimi yapılmaz: teklif seçilen para biriminde hazırlanır, tutarlar o para biriminde girilir.
- Otomatik PR birleştirme GitHub ayarı (Allow auto-merge + zorunlu kontroller) depo sahibince açılmalıdır.
- LEONX AI henüz geliştirilmedi.
