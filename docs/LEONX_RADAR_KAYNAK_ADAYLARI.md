# LEONX AI Radar — kaynak aday listesi (sahip onayı için)

Durum: **TASLAK — hiçbir kaynak "İzinli" yapılmadı.** Bu liste 25 Ekim 2026'da hazırlandı. Hazırlandığı ortamdan bu
sitelere ağ erişimi YOKTU (bağlantı reddedildi); bu yüzden aşağıdaki robots.txt, kullanım koşulları ve RSS/API varlığı
**doğrulanmamıştır**. Her satır, sahip veya yetkili bir kişi tarafından tek tek kontrol edilmeden kullanılmamalıdır.

Uygulamadaki kural değişmez: bir kaynak yalnız **izin durumu "İzinli" ve "Etkin"** ise otomatik indirilir. CAPTCHA, oturum,
ücretli duvar veya erişim denetimi aşılmaz; robots.txt, hız sınırları ve KVKK uygulanır (`docs/LEONX_AI_RADAR.md` §3, §7).

## Kontrol adımları (her kaynak için)

1. Sitenin **kullanım koşulları / telif / KVKK** sayfasını okuyun: otomatik erişim, yeniden kullanım veya ticari kullanım yasak mı?
2. `https://<alan>/robots.txt` dosyasını açın: ilgili yol `Disallow` mu?
3. Resmî **RSS/Atom** veya **API** var mı? Varsa yalnız onu kullanın (sayfa kazıma yerine).
4. Uygulamada kaynağı ekleyin (izin: *İnceleniyor*), **Kaynağı test et** ile gerçek yanıtı görün, izin notunu yazın.
5. Ancak bundan sonra *İzinli + Etkin* yapın. Şüphe varsa *İzinsiz* bırakın ve bağlantıları **elle** ekleyin.

## Adaylar

| # | Kaynak | Tür | Ne sağlar | Önerilen başlangıç izni | Not / risk |
| --- | --- | --- | --- | --- | --- |
| 1 | EKAP — Elektronik Kamu Alımları Platformu (ekap.kik.gov.tr) | Resmî ihale sistemi | Kamu ihale ilanları, İKN, son teklif tarihi | **İzinsiz — yalnız elle** | İhale dokümanı oturum ve doğrulama gerektirir; otomatik erişim aşılmaz. Uygulama EKAP alan adını otomatik kaynak olarak zaten reddeder. İlan bağlantıları "Elle bağlantı" ile eklenir. |
| 2 | Basın İlan Kurumu — ilan.gov.tr | Resmî ilan portalı | Kamu ihale ve satış ilanları (il/kategori bazlı) | İnceleniyor | RSS/API ve koşullar doğrulanmalı. Varsa yalnız resmî akış kullanılmalı. |
| 3 | Resmî Gazete — ilan bölümü (resmigazete.gov.tr) | Resmî yayın | Günlük ihale ilanları | İnceleniyor | Günde bir kez yeterli; RSS varlığı doğrulanmalı. |
| 4 | TOKİ — ihale duyuruları (toki.gov.tr) | Kamu kurumu | Toplu konut, okul, hastane, kamu binası ihaleleri | İnceleniyor | Kapı, PVC/alüminyum doğrama ve korkuluk için yüksek ilgi. Akış/robots doğrulanmalı. |
| 5 | Ankara Büyükşehir Belediyesi — ihale duyuruları | Belediye | Ankara kamu yapım ve alım ilanları | İnceleniyor | Ankara önceliği nedeniyle ilk sıradaki aday. |
| 6 | Ankara ilçe belediyeleri (Çankaya, Yenimahalle, Etimesgut, Sincan, Keçiören, Gölbaşı, Mamak, Pursaklar…) — ihale/duyuru sayfaları | Belediye | İlçe ölçeğinde hizmet binası, okul, kentsel dönüşüm | İnceleniyor | Her site ayrı kontrol edilir; çoğunda RSS olmayabilir ("site" türü yalnız liste sayfasındaki başlıkları okur). |
| 7 | Ankara Valiliği / Yatırım İzleme ve Koordinasyon Başkanlığı | Kamu | İl genelindeki kamu yatırımları, okul/sağlık tesisleri | İnceleniyor | Duyuru sayfası/akış doğrulanmalı. |
| 8 | Sağlık Bakanlığı — Sağlık Yatırımları Genel Müdürlüğü | Bakanlık | Hastane ve sağlık tesisi yatırımları | İnceleniyor | Yangın kapısı, teknik kapı, alüminyum doğrama için ilgili. |
| 9 | MEB — İnşaat ve Emlak Dairesi Başkanlığı | Bakanlık | Okul yapım ihaleleri ve yatırım programları | İnceleniyor | — |
| 10 | Ankara OSB'leri (ör. Sincan, İvedik, Başkent, ASO 1. OSB) — duyurular | OSB yönetimleri | Fabrika/depo yatırımları, parsel tahsisleri | İnceleniyor | Özel sektör ön-ihale sinyali; ihtiyaç genelde "potansiyel" kalır. |
| 11 | Komşu iller (Bolu, Çankırı, Kırıkkale, Kırşehir, Aksaray, Konya, Eskişehir) büyükşehir/il belediyeleri ve il özel idareleri | Belediye / il | Bölge kamu ilanları | İnceleniyor | Ankara'dan sonra ikinci öncelik. |
| 12 | Müteahhit ve geliştirici firmaların **kendi** basın/duyuru sayfaları | Özel | Yeni konut, ticari, otel projeleri; ana yüklenici bilgisi | İnceleniyor (firma başına) | Yalnız firmanın kendi sitesi; kişi verisi toplanmaz. Firma adları bu listede uydurulmaz; sahip izlemek istediği firmaları ekler. |
| 13 | Sektör haber siteleri (yapı/inşaat haberleri) | Ticari yayın | Proje haberleri (ön-ihale sinyali) | **İzinsiz** (varsayılan) | Çoğunda telif ve ticari kullanım kısıtı olabilir; yalnız açıkça izin veren RSS ile ve "potansiyel" etiketiyle. |
| 14 | Tavily arama API | Ücretli API | Web araması özetleri (yalnız işaretçi) | **Kapalı** | Ücretli; ticari kullanım koşulları sahip onayı bekliyor. `search_api_enabled = false`, `TAVILY_API_KEY` tanımlı değil. |
| 15 | Elle eklenen bağlantılar | Sahip | Herhangi bir kamuya açık ilan/haber | Her zaman açık | `radar_add_manual_item`; içerik yine kurallarla sınıflandırılır, kaynak bağlantısı saklanır. |

## Sahip kararı

Her satır için **İzinli / İnceleniyor / İzinsiz** kararını ve kontrol notunu uygulamadaki **LEONX AI › Kaynaklar** ekranına
yazın. Bu belge kararın kendisi değildir; yalnız başlangıç önerisidir.
