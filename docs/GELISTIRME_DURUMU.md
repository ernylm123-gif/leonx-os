# LEONX OS — Geliştirme durumu

Son güncelleme: Faz 13 (DXF mimari analiz, revizyon karşılaştırma, malzeme bazlı metraj) · uygulama sürümü 0.9.1

0.8.2 (denetim düzeltmeleri): diyalog formları açılışta render sırasında sıfırlanır (hızlı yazılan değer/hata kaybı ve kararsız e2e giderildi);
büyük listeler 1000 satırlık sayfalarla okunur (sessiz kesilme yok, 50 sayfa sınırında açık hata); bütçe formunda teklif kalemleri
tek sorguda; finans panelinde gerçekleşen gider yalnız aktif projeler; Raporlar ve Dashboard metinleri güncellendi.

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

| 5.2 | Mimari PDF kök neden düzeltmeleri: AutoCAD SHX/eğriye çevrilmiş yazı tespiti ve bölgesel karo OCR (yüksek çözünürlük, iPad'de sabit bellek), görüntü olarak gömülü çizelge (karma pafta) OCR'ı, bozuk yazı tipi tespiti; metre ("1.20/1.50"), kesirli, adlandırılmış ölçü yazımları; kod eşleştirme (P-01 = P01 = P1); kart tipi doğrama listesi (kasa, ölçü çizgileri, ADET/malzeme/cam/renk/açılım); görünüş çiziminden açılım ve bölme analizi; teknik özellikler (doğrulandı / aday / belirsiz); "1.-4. KATLAR" kat çarpanı; mahal; çelişkilerin kullanıcıya bırakılması; tanı raporu ve kritik girdi soruları; doğruluk ölçüm altyapısı (precision/recall). **Mühendislik incelemesi**: pafta listesi (önizlemeli), çizimde konum, poz incelemesi (ölçü, hesap yöntemi, kaynak paftalar, teknik özellik durumları, çelişki kararı), Onayla / Düzelt / Belirsiz / Reddet; onaylayan ve onay zamanı, değiştirilemez ilk tespit değerleri ve düzeltme geçmişi; raporlarda özellik, kaynak pafta, düzeltme ve onay sütunları; teklife varsayılan olarak yalnız onaylı pozlar |
| 8 | Finans: birim maliyet kataloğu, kullanıcı kurları, proje bütçesi (kabul edilen teklif anlık görüntüsü), tahmini maliyet (elle / onaylı metrajdan), gerçekleşen gider (KDV ayrı), ödeme planı ve tahsilat (FIFO), tahmini/beklenen/gerçekleşen kâr, bütçe aşımı ve tahsilat bildirimleri, /finans paneli (nakit akışı, geciken ödemeler) |
| 7 | 12 aşamalı proje akışı (liste + pano), ilerleme, adres/harita, gerçek bitiş tarihi; görev ve termin (hatırlatma, gecikme); sunucu olaylarından işlem geçmişi; bildirim merkezi (zil, geçmiş, okundu eşitleme, tercihler); Web Push (VAPID, kendi service worker'ı); canlı yönetim paneli; teklif kabulünde aşama önerisi |
| 13 | CAD/BIM: **DXF mimari analiz** — model uzayı mimari motora (PDF ile aynı) sanal kâğıt olarak verilir: pafta türü, doğrama çizelgesi (metin tablosu), poz etiketi, kat tekrarı, teknik özellik, çelişki; blok geometrisiyle birleşik (yazılı ölçü yoksa ölçü bloktan, uyuşmazsa ölçü çelişkisi; duvarlar poz sayılmaz). **Metraj revizyon karşılaştırması** — eklenen/silinen/değişen pozlar, metraj farkı, katalog maliyet farkı ve teklif tutarı etkisi (fiyat yoksa tutar yok, para birimleri ayrı). Metraj özetinde brüt (boşluk) alan, çevre ve **malzeme/seri bazlı** tablo. DWG değerlendirmesi (`docs/DWG_DEGERLENDIRME.md`) |

## Veritabanı

Migration'lar `supabase/migrations/` altında, sırasıyla 001–009, 011 (Faz 8 finans) ve 012 (Faz 5.2 inceleme); 010 numarası kullanılmadı.
Hepsi gerçek Supabase projesine uygulandı (011 uzak test 14/14; 012 uzakta katalog doğrulaması: 5 sütun, tetikleyici, 3 kısıt, anon erişimi kapalı, mevcut satırlara dokunulmadı). Tümü
tekrar çalıştırılabilir ve DROP/veri silme içermez.

## Testler

| Komut | Kapsam |
| --- | --- |
| `npm run test` | Doğruluk ölçümü (sentetik fikstürler: precision/recall, adet/ölçü/alan hatası), AutoCAD yazı-çizgi ve karma pafta için uçtan uca karo OCR, kart tipi liste, mimari PDF analizi (çok sayfalı proje, çizelge, ölçeksiz plan, yanlış ölçek, yazısız/taranmış/boş/bozuk PDF, OCR), hesap motorları (metraj, teklif), birim dönüşümleri, PDF/Excel içerik ve toplam eşitliği, sürüm, yeniden deneme |
| `npm run bench:cad` | Doğruluk ölçümü; `CAD_REFERANS_DIR` ile gerçek referans projeler (depo dışında) |
| `npm run test:db` | Migration'lar iki kez + RLS, kilit, numara, revizyon, silme ilişkileri; Faz 8: finans RLS, metraj çift aktarım engeli, kur seçimi, FIFO tahsilat, bütçe aşımı ve hatırlatma tekilleştirme; Faz 5.2: onay bilgisinin sunucuda yazılması, değiştirilemez ilk değer, belirsiz işareti, çelişki/doğrulama bildirimleri (yerel PostgreSQL) |
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
| CAD'den vektörel çıktı, poz kodu + "120/150", "1.20/1.50", kesirli veya "EN:120 BOY:150" etiketli planlar | Çalışır: adet planlardan, ölçü yazıdan; ölçek bulunursa açıklık genişliği çizgiyle doğrulanır |
| Tablo çizelge (POZ · CİNSİ · MALZEME · EN · BOY · ADET / TOPLAM / kat sütunları) | Çalışır: adet/ölçü/malzeme çizelgeden; plan sayımıyla karşılaştırılır, fark çelişki olarak gösterilir |
| Kart tipi doğrama listesi (görünüş çizimi + ölçü çizgileri + ADET/malzeme/cam/renk/açılım yazıları) | Çalışır: ölçü yazıdan veya ölçü çizgisinden (çizim ölçeği kasa boyutuyla doğrulanır), açılım/bölme görünüş çiziminden aday |
| Yazıları çizgi olarak gömülü (AutoCAD SHX) veya eğriye çevrilmiş PDF | Çalışır (OCR açıkken): yalnız yazı bölgeleri yüksek çözünürlükte okunur; OCR kapalıysa neden açıkça söylenir |
| Çizelgesi görüntü olarak gömülü karma pafta | Çalışır (OCR açıkken): görüntü bölgesi tablo kipinde okunur |
| Taranmış (görüntü) PDF | Sınırlı: tüm sayfa karolar hâlinde OCR; güven düşük tutulur, rakam hataları olabilir, geometri doğrulaması yapılmaz |
| Yazısız (yalnız çizgi) PDF | Otomatik metraj üretilmez; neden gösterilir, kalibrasyon + elle ölçüm önerilir |
| Normal/tip kat planları | Başlıkta kat aralığı/sayısı yazıyorsa ("1.-4. KATLAR") sayım çarpılır ve çizelgeyle karşılaştırılır; yazmıyorsa uyarı |
| DWG | Desteklenmez (DXF'e dönüştürme rehberi; seçenekler ve lisanslar: `docs/DWG_DEGERLENDIRME.md`) |

Testler sentetik fikstürlerle yapıldı (`scripts/cad-fixtures/make_pdf_fixtures*.mjs`, beklenen sonuçlar
`*.expected.json`). **Kullanıcıya ait gerçek proje PDF'i ile henüz doğrulanmadı**; gerçek referans projelerle
ölçüm için `docs/CAD_REFERANS_TESTLERI.md`.

## DXF analizi — ne çalışır, ne sınırlıdır (Faz 13)

| DXF içeriği | Durum |
| --- | --- |
| Model uzayında plan + metin tablosu doğrama çizelgesi + "1.-3. KATLAR" başlığı | Çalışır: çizelge adet/ölçü/malzeme, plan sayımı × kat, fark çelişki olarak gösterilir |
| Doğrama blokları (adında veya geometrisinde ölçü) + poz etiketi | Çalışır: ölçü bloktan; yazılı ölçüyle uyuşmazsa ölçü çelişkisi |
| Etiketsiz bloklar / kapalı çizgiler | Eski geometri motoruyla çalışır (yazı yoksa) |
| Birim ($INSUNITS) yok | Ölçek doğrulanmamış sayılır; kalibrasyon gerekir, ölçü kesin sunulmaz |
| Kâğıt uzayı (layout) | Her layout ayrı pafta olarak analiz edilir (antet, çizelge); görüntüleyicide gösterilmez |
| Blok öznitelikleri (POZ/EN/BOY/TIP/MALZEME/SERİ…) | Poz, ölçü, iş grubu ve teknik özellik öznitelikten; geometriyle uyuşmazsa çelişki |
| Çok büyük model uzayı (yüz binlerce nesne) | Analiz ana iş parçacığında çalışır; çok büyük dosyalarda tarayıcı bir süre yanıt vermeyebilir |

Test: `src/cad/dxfSemantic.test.ts` (yeni fikstür `mimari_plan_cizelge*.dxf` + eski 7 DXF fikstüründe gerileme yok)
ve tarayıcı testi; öznitelik ve kâğıt uzayı: `src/cad/dxfAttributes.test.ts`. Tam denetim: `docs/CAD_MOTOR_DENETIMI.md`. **Gerçek ofis DXF'i ile henüz doğrulanmadı.**

## Push bildirimleri — durum

- Altyapı: `public/sw.js` (yalnız bildirim; önbellek ve istek yakalama yok, sürüm güncellemesini etkilemez),
  `push_subscriptions` (cihaz bazında), Edge Function `push-dispatch` (VAPID, RFC 8291 şifreleme), pg_cron.
- Otomatik test: şifreleme abonenin anahtarıyla çözülerek doğrulandı; geçersiz abonelik (404/410) kapatma,
  tekilleştirme ve tercihler test edildi.
- **Gerçek cihazda doğrulanmadı**: iPhone/iPad ana ekran PWA, Android ve Windows'ta push'un fiilen ulaşması
  ve bildirime dokununca doğru ekranın açılması. Ayarlar → Bildirimler → "Test bildirimi gönder" ile
  her cihazda denenmelidir.

## Bilinen sınırlar

- DWG dosyaları doğrudan okunmaz (DXF'e dönüştürme rehberi gösterilir; seçenekler `docs/DWG_DEGERLENDIRME.md`).
- Revizyon karşılaştırmasında maliyet farkı yalnız katalogda fiyatı tanımlı iş grupları, teklif farkı yalnız teklifte aynı poz kodlu kalem için hesaplanır.
- Push gönderimi dakikalık zamanlayıcıyla yapılır (en geç ~1–2 dk gecikme). iOS'ta push yalnız ana ekrana
  eklenmiş uygulamada çalışır.
- Kat çarpanı yalnız pafta başlığında açıkça yazıyorsa uygulanır.
- Etiketin üzerinden çizgi geçiyorsa (kapı yayı, duvar) OCR ölçüyü okuyamayabilir; ölçü uydurulmaz.
- Çevrimdışı düzenleme yok; açık formdaki bilgi korunur, kayıt bağlantı gelince yapılır.
- Teklif PDF'inde firma adresi, vergi ve banka bilgileri **Ayarlar → Teklif ayarları** doldurulunca görünür
  (sistem uydurma bilgi yazmaz).
- Teklifte kur çevrimi yapılmaz: teklif seçilen para biriminde hazırlanır. Finans modülünde çevrim yalnız
  kullanıcının girdiği kurla yapılır (otomatik TCMB çekimi yok); kur yoksa para birimi bazında gösterilir.
- Otomatik PR birleştirme GitHub ayarı (Allow auto-merge + zorunlu kontroller) depo sahibince açılmalıdır.
- LEONX AI henüz geliştirilmedi.

## Faz 8 — finans kuralları

| Konu | Kural |
| --- | --- |
| Para hesabı | Tamsayı kuruş (`src/quote/money.ts`), yüzde 3 ondalık, kur 6 ondalık; satır = yuvarla(miktar × birim), çevrim = yuvarla(tutar × kur). İstemci (`src/finance/*`) ve veritabanı aynı yuvarlamayı kullanır |
| Para birimi | Farklı birimler yalnız kullanıcının girdiği kurla (projeye özel > genel, kur tarihi ≤ işlem tarihi, ters yön hesaplanmaz) çevrilir; kur yoksa "kur girilmemiş" uyarısı ve para birimi bazında ara toplam |
| Fiyat | Sistem fiyat uydurmaz. Katalogda olmayan iş "fiyat tanımlanmamış" (boş) kalır, toplama katılmaz, tahmin "eksik" sayılır |
| KDV ve kâr | Kâr KDV hariç tutarlardan. Kâr marjı = kâr / net satış; maliyet üzerinden kâr = kâr / maliyet (ayrı gösterilir) |
| Tahmini / gerçekleşen | Tamamlanmamış projede kâr "tahmini"; gerçekleşen kâr yalnız "tamamlandı / teslim edildi" aşamasında, kayıtlı giderlerden |
| Metraj → maliyet | Yalnız onaylı sürümün onaylı pozları; aynı poz aynı gruba bir kez (benzersiz indeks); projeye ikinci metraj revizyonu aktarılamaz; çevre bazlı satırlar "çevre bazlı tahmini" (profil kesim boyu değildir); fire yalnız bütçedeki orandan |
| Tekrarlanabilirlik | Gider, tahsilat, taksit, kur ve maliyet satırları istemcide üretilen kimlikle eklenir (yeniden denemede çift kayıt yok); aynı tedarikçi belge no bir kez |
| Bildirim | Bütçe aşımı (tahmin tam ve çevrilebilirse) her %10 eşikte bir kez (`proje`); tahsilat yaklaşıyor/gecikti (`termin`) hatırlatma taramasında, tekilleştirilmiş |
| Nakit akışı | Giriş: tahsilat; çıkış: "ödendi" işaretli giderler (KDV dahil); para birimi bazında, çevrimsiz |

Bilinen sınırlar (Faz 8): kur otomatik çekilmez; gider/tahsilat için ayrı belge (fatura PDF) eki yok; ödeme planı
tutarları sözleşmeye göre KDV dahil girilir ve satış bedeliyle otomatik karşılaştırılmaz; nakit akışı son 6 ay.
