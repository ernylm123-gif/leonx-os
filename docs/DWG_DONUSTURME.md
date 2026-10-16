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
- Gizlilik: dosyalar diske kalıcı yazılmaz ve günlüklenmez; yalnız kullanıcı onayıyla gönderilir.
- Bağımlılıklar sabit sürümlü; `pip-audit` CI'da çalışır (bu PR'da bilinen açık yok).

## Barındırma seçenekleri (onay gerekli)

Vercel fonksiyonları uygun değildir (yerel ikili, bellek ve süre sınırları). Kapsayıcı herhangi bir
Docker barındırmasında çalışır. Fiyatlar değişkendir; seçim öncesi sağlayıcının güncel fiyatı
doğrulanmalıdır.

| Seçenek | Not |
| --- | --- |
| Küçük bir VPS (1–2 vCPU, 2 GB RAM) + Docker + HTTPS ters vekil | En düşük sabit maliyet; bakım (güncelleme, sertifika) bizde |
| Google Cloud Run / benzeri kapsayıcı platformu | İstek başına ölçeklenir, boştayken maliyet çok düşük; soğuk başlatma gecikmesi |
| Fly.io / Render / Railway | Basit Docker dağıtımı; ücretsiz katmanlar değişken |

Gerekli ayarlar (gizli değerler yalnız barındırma ortamında tutulur, depoda değil):
`SUPABASE_URL` (veya `SUPABASE_JWT_SECRET`), `ALLOWED_USER_IDS`, `ALLOWED_ORIGINS`,
`CAD_WORKER_PARALLEL`.

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
