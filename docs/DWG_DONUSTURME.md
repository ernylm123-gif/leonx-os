# DWG → DXF → PDF dönüştürme (PR-2 prototipi)

**Durum:** çalışan prototip, **yayında değil**. Dönüştürme sunucusu (`services/cad-worker`) hiçbir
yerde barındırılmıyor; `VITE_CAD_WORKER_URL` production'da ayarlı değildir, bu yüzden canlı uygulama
DWG için önceki davranışı (DXF'e dönüştürme rehberi) gösterir. Barındırma kullanıcı onayı bekler.

> Dönüşüm sonuçları yalnız LibreDWG'nin kendi test paketindeki gerçek AutoCAD örnekleriyle
> doğrulandı (mimari proje değil). Gerçek LEONX proje DWG'leriyle doğrulanana kadar dönüşüm ve
> metraj sonuçları kesin mühendislik sonucu sayılmaz.

## Akış

```
Tarayıcı (CAD Analiz)                          cad-worker (ayrı sunucu, Docker)
─────────────────────                          ─────────────────────────────────
DWG seçilir → imza/sürüm okunur (yerel)
DWG tarayıcıda okunmaz; rehber + "Sunucuda
DXF'e dönüştür" (açık onay) gösterilir
onay → POST /v1/dwg/donustur?pdf=1  ───────▶  JWT doğrulama (Supabase) + izinli kullanıcı
        Authorization: Bearer <oturum>        imza/sürüm/boyut denetimi (≤50 MB, R13–2018)
                                              dwg2dxf (ayrı süreç, rlimit, zaman aşımı)
                                              metin satır sonu onarımı
                                              kalite denetimi: dwgread JSON ↔ ezdxf envanteri
                                              PDF önizleme (model + layout'lar)
DXF → mevcut CAD analiz worker'ı   ◀───────  { kalite, dxf, pdf, uyarılar }  (dosya saklanmaz)
dönüşüm çubuğu: durum, rapor, indirmeler
(özgün DWG / DXF / PDF)
```

Dönüştürülen DXF, elle yüklenen bir DXF ile **aynı** analiz yolundan geçer (`analyzeInWorker`);
mevcut DXF/PDF analiz, metraj ve teklif kodunda değişiklik yoktur.

## Teknoloji karşılaştırması

Lisans bilgileri üreticilerin depo/sitelerindeki açıklamalara göre özetlenmiştir; hukuki görüş
değildir. ODA'nın sitesine bu ortamdan erişilemediği için ODA koşulları bu PR'da yeniden
doğrulanamadı.

| Teknoloji | Ne yapar | Lisans / maliyet | Karar |
| --- | --- | --- | --- |
| **GNU LibreDWG 0.13.3** | DWG okuma, `dwg2dxf`, `dwgread -O JSON` | GPL-3.0, ücretsiz | **Seçildi.** Ayrı süreç olarak çağrılır (bağlanmaz/gömülmez); kaynak kodu değiştirilmeden kullanılır. Sunucuda çalıştırmak tarayıcıya dağıtım değildir |
| **ezdxf 1.4.4** | DXF okuma, denetim (audit), envanter, çizim | MIT | **Seçildi:** DXF geçerlilik denetimi, kayıp karşılaştırması, PDF çizimi |
| matplotlib 3.11 | ezdxf çizim arka ucu → PDF | PSF tabanlı (matplotlib lisansı) | **Seçildi** (PDF önizleme) |
| ODA File Converter / Drawings SDK | DWG ↔ DXF, en geniş sürüm desteği | Ücretsiz dönüştürücü üyeliksiz yalnız ticari olmayan kullanım; ticari kullanım ücretli üyelik | **Seçilmedi** (ücretli lisans onayı gerekir). LibreDWG yetersiz kalırsa yedek seçenek |
| Autodesk Platform Services (Model Derivative) | Bulutta DWG → çeşitli biçimler | Ücretli API | **Seçilmedi:** müşteri çizimleri üçüncü tarafa gider; ücretli |
| OpenCascade.js | B-rep/STEP/IGES geometri çekirdeği (WASM) | LGPL-2.1 | DWG okumaz; 2B mimari pafta için gereksiz ve ağır (WASM ~10+ MB). Gelecekte 3B üretim modeli gerekirse |
| IfcOpenShell | IFC (BIM) okuma/yazma | LGPL-3.0 | DWG ile ilgisiz; IFC desteği ayrı bir faz olarak değerlendirilebilir |
| PyMuPDF | PDF okuma/çizme | AGPL-3.0 veya ticari | **Seçilmedi:** ağ servisi olarak AGPL yükümlülüğü doğurur; PDF tarafında tarayıcıdaki PDF.js zaten kullanılıyor |
| PDF.js / Tesseract.js | Tarayıcıda PDF görüntüleme / OCR | Apache-2.0 | Zaten kullanımda (değişiklik yok) |
| Google OR-Tools | Kesim/çizelgeleme optimizasyonu | Apache-2.0 | PR-8 (kesim) için değerlendirilecek; mevcut TS kesim motoru 300/300 rastgele vakada kesin optimumu buldu |

### LibreDWG ölçümleri (bu ortamda, gerçek AutoCAD örnekleri)

- LibreDWG test paketindeki 139 DWG'nin 139'u DXF'e dönüştü; 131'i ilk denemede ezdxf denetiminden
  geçti. Kalan 8'in 6'sı R12 öncesi (desteklenmiyor, açıkça reddediliyor), 2'si uzun MTEXT satır
  sonu hatası → `repair.py` ile onarıldı.
- AutoCAD 2000/2004/2007/2010/2013/2018 örneklerinde nesne kaybı yok (INSERT, ATTDEF, DIMENSION,
  MTEXT, LWPOLYLINE, katman, blok, layout sayıları birebir).
- R2000+ örneklerde dönüşüm süresi ortalama 24 ms, en fazla 414 ms (küçük dosyalar; büyük mimari
  projelerde ölçülmedi).

### Bilinen sınırlar

- AutoCAD 2018 sonrası biçim kodu da `AC1032`'dir; daha yeni bir imza gelirse açıkça reddedilir.
- Özel (proxy) nesneler okunamaz; raporda sayıları gösterilir, analize girmez.
- XREF içerikleri dönüşüme girmez; raporda listelenir (çizim CAD'de "Bind" edilmelidir).
- PDF önizleme bir **kontrol çıktısıdır**: çizgi kalınlığı, yazı tipi (SHX) ve tarama görünümü
  AutoCAD çıktısıyla birebir değildir; ölçek layout kâğıt boyutuna göre, model A3'e sığdırılarak
  çizilir.

## Güvenlik

- Kimlik: Supabase oturum JWT'si (JWKS ES256/RS256 veya HS256 gizli anahtarı), `aud=authenticated`;
  `ALLOWED_USER_IDS` ile kullanıcı sınırlaması. Kimlik yapılandırılmadan servis **başlamaz**.
- Girdi: DWG imzası, desteklenen sürüm listesi, 50 MB sınırı; eşzamanlı iş sınırı (429).
- Süreç yalıtımı: kabuksuz `Popen`, ayrı süreç grubu, RLIMIT_AS/CPU/FSIZE/CORE, duvar saati zaman
  aşımında grubun öldürülmesi, temiz ortam değişkenleri, istek başına geçici dizin.
- Kapsayıcı: root olmayan kullanıcı (uid 10001), LibreDWG kaynağı sha256 + GNU anahtarlığıyla GPG
  doğrulamalı derlenir. Çalıştırırken önerilen: `--read-only --tmpfs /tmp --cap-drop ALL
  --security-opt no-new-privileges --memory 1g --pids-limit 64`.
- Yalıtım: ağır adımlar (dönüştürme, envanter, PDF) HTTP sunucusundan ayrı, bellek/süre sınırlı
  süreçlerde çalışır; sınır aşımı sunucuyu düşürmez.
- Gizlilik: dosyalar diske kalıcı yazılmaz ve günlüklenmez; yalnız kullanıcı onayıyla gönderilir.
- Bağımlılıklar sabit sürümlü; `pip-audit` CI'da çalışır (bu PR'da bilinen açık yok).

## Barındırma seçenekleri (karşılaştırma — Ekim 2026)

Vercel fonksiyonları uygun değildir (yerel ikili, bellek ve süre sınırları). Servis tek bir Docker
imajıdır; aşağıdakilerin hepsinde çalışır. Bilgiler sağlayıcıların belgelerinden ve güncel üçüncü taraf
özetlerinden derlendi; **fiyat/sınırlar değişebilir, hesap açmadan önce sağlayıcı sayfasında
doğrulanmalıdır.**

| | Render (Free) | Google Cloud Run | Fly.io | Koyeb (Free) | Oracle Cloud Always Free |
| --- | --- | --- | --- | --- | --- |
| Ücretsiz kullanım | 750 örnek-saat/ay (çalışma alanı başına) | Aylık ücretsiz kota (yaklaşık 180 bin vCPU-sn, 360 bin GiB-sn, 2 M istek) | Yeni hesaplara kalıcı ücretsiz katman yok; kısa deneme | 1 ücretsiz örnek | Ampere A1 sanal makine (4 OCPU/24 GB olarak belgelenmiş; bazı kaynaklar 2/12 diyor) |
| Kart / faturalandırma | Ücretsiz plan için gerekmez | **Faturalandırma hesabı (kart) zorunlu**, kota içinde ücret yok | Deneme sonrası kart gerekir | Ücretsiz örnek için gerekmeyebilir | Kart doğrulaması gerekir (ücret alınmaz) |
| Bellek / işlemci | 512 MB, paylaşımlı 0,1 CPU | Seçilebilir (ör. 1 GiB, 1 vCPU) | Seçilebilir | 512 MB, 0,1 vCPU | Büyük |
| Uyku | 15 dk trafik yoksa uyur, uyanma ~1 dk | Sıfıra ölçeklenir, soğuk başlatma birkaç saniye | Otomatik durdurma | 1 saat sonra uyur | Uyumaz (sürekli VM) |
| Dosya boyutu | Uygulama sınırı (50 MB) | HTTP/1 istek gövdesi **32 MiB** sınırı (HTTP/2 ile kalkar) | Sınır yok sayılır | — | Yok |
| İşlem süresi | Uzun isteklere izin verir | En fazla 60 dk | — | — | Sınırsız |
| Bakım | Yok (yönetilen) | Yok (yönetilen) | Az | Yok | **Sunucu bakımı bizde** (güncelleme, sertifika, güvenlik) |
| Bölge | Frankfurt | europe-west (Belçika/Frankfurt) | Avrupa | Frankfurt | Seçilen ev bölgesi |

### 512 MB sunucuda ölçüm (Render Free ayarlarıyla, bu ortamda)

Ağır adımlar ayrı süreçte sınırlı çalışır (`render.yaml`: iş 400 MB, dönüştürücü 320 MB, PDF 320 MB);
HTTP sunucusu ~50 MB kalır. DWG envanteri satır satır sayılır (tam JSON belleğe alınmaz; eski
yöntemle 139/139 örnekte aynı sonuç).

| Örnek | DWG | Dönüşüm + denetim | PDF önizleme |
| --- | --- | --- | --- |
| example_2018 (AutoCAD 2018) | 0,1 MB | tamam, ~2 sn | var |
| Dynblocks (2018, dinamik bloklar) | 2,1 MB | **eksik** — 7 INSERT DXF'e geçmedi (raporda gösterilir), ~12 sn | **üretilemedi** (bellek sınırı; not olarak bildirilir) |
| LibreDWG test paketinin tümü (R13–2018) | ≤2,1 MB | 128/128 dönüştü | — |

Sonuç: ücretsiz 512 MB sunucu küçük/orta çizimlerin dönüştürülmesi için yeterli; ağır blok içeren
çizimlerde PDF önizleme üretilemeyebilir. Gerçek proje DWG'leri (çoğu 5–30 MB) bu sınırları aşabilir —
gerçek dosyalarla ölçülmeden kesin bir şey söylenemez. Yetmezse 1–2 GB bellekli Cloud Run önerilir.

### Öneri

1. **Şimdi — ücretsiz test: Render Free (Frankfurt).** Kart gerekmez; depo kökündeki `render.yaml`
   ile tek tıkla kurulur. Sınırları: uyku sonrası ilk dönüşüm ~1 dk, 512 MB bellek (büyük DWG'lerde
   bellek yetersizliği olabilir — rapor açıkça "dönüştürülemedi" der), ayda 750 saat. Gerçek proje
   dosyalarıyla denemek için yeterlidir.
2. **Sürdürülebilir kullanım: Google Cloud Run.** Bu kullanım hacminde (günde birkaç dönüşüm) aylık
   ücretsiz kota içinde kalması beklenir; uyku gecikmesi kısa, bellek 1 GiB seçilebilir. Ancak
   faturalandırma hesabı (kart) gerektirdiği için **kullanıcı onayı olmadan açılmaz**; açılırsa
   `--max-instances 1`, bütçe uyarısı (ör. 1 USD) ve 32 MiB yükleme sınırı (uygulama sınırı 50 MB →
   Cloud Run'da 30 MB'a çekilmeli) ayarlanmalıdır.
3. Oracle Always Free güçlüdür ama sanal makine bakımını (güvenlik güncellemeleri, HTTPS) bizim
   üstlenmemizi gerektirir; ikinci seçenek olarak tutulur.

### Ücretsiz test ortamı (Render) — kurulum

Hesap açma ve gizli değer girme kullanıcı tarafından yapılır (bu oturumda Render hesabına erişim yok).

1. <https://render.com> → GitHub ile giriş (ücretsiz plan; kart istenmez).
2. **New → Blueprint** → `ernylm123-gif/leonx-os` deposu → `render.yaml` algılanır → servis
   `leonx-cad-worker` (plan: **Free**, bölge: Frankfurt).
3. İstenen değerler (panelde girilir, depoya yazılmaz):
   - `SUPABASE_URL`: Supabase proje adresi.
   - `SUPABASE_JWT_SECRET`: yalnız proje eski HS256 imzayı kullanıyorsa (Supabase → Project Settings
     → JWT Keys). Proje JWKS (asimetrik) anahtarlara geçmişse boş bırakılır.
   - `ALLOWED_USER_IDS`: LEONX OS'ta giriş yapan hesabın Supabase kullanıcı kimliği (Supabase →
     Authentication → Users).
4. Derleme ~5–10 dk sürer (LibreDWG kaynaktan, imza doğrulamalı). Bittiğinde
   `https://leonx-cad-worker-xxxx.onrender.com/saglik` → `{"durum":"hazir", …}`.
5. Servis adresi bana iletilince uygulama tarafı (aşağıda) ayrı bir PR'da bağlanır; production'a
   alınması yine onayınızla yapılır.

### Uygulama tarafı (yayın sırasında)

1. Vercel ortamına `VITE_CAD_WORKER_URL` eklenir.
2. CSP: ya `vercel.json` `connect-src`'ye worker adresi eklenir, ya da aynı kökenden çalışmak için
   `vercel.json`'a `/cad-worker/(.*)` → worker adresi yönlendirmesi (rewrite) eklenir ve
   `VITE_CAD_WORKER_URL=/cad-worker` kullanılır. Bu PR'da `vercel.json` **değiştirilmedi**.

## Geri alma

- Uygulama: `VITE_CAD_WORKER_URL` kaldırılıp yeniden derlenince DWG ekranı eski rehbere döner; kod
  geri alınmadan özellik kapanır. Tam geri alma için PR'ın birleştirme commit'i geri alınır.
- Veritabanı: migration yok.
- Servis: kapsayıcı durdurulur; uygulama "Dönüştürme servisine ulaşılamadı" hatası gösterir, diğer
  modüller etkilenmez.

## Doğrulanmamış / sonraki adımlar

- Gerçek LEONX mimari DWG projeleri (referans metrajlı) ile doğruluk ölçümü — **dosyalar gerekli**.
- Büyük dosyalarda (10–50 MB) süre ve bellek ölçümü.
- Supabase Storage + iş kuyruğu + Realtime ilerleme (şu an istek–yanıt; büyük dosyalarda kuyruk
  gerekecek) — barındırma kararından sonra.
- Docker imajı yerelde derlenemedi (ortamda Docker yok); CI'daki `cad_servis_imaj` işi doğrular.
