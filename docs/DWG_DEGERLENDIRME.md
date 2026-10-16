# DWG desteği — teknik ve lisans değerlendirmesi (Faz 13)

> **Güncelleme (PR-2):** B seçeneğinin (LibreDWG, kendi sunucumuzda) çalışan prototipi
> `services/cad-worker` altında hazırlandı; ayrıntılar `docs/DWG_DONUSTURME.md`. Servis henüz
> barındırılmıyor; aşağıdaki durum production için geçerlidir.

**Durum: LEONX OS DWG dosyalarını tarayıcıda okumaz ve okumuş gibi davranmaz.** DWG yüklendiğinde ekran bunu açıkça
söyler ve DXF'e dönüştürme yollarını gösterir (`src/features/cad/workspace/states.tsx`, `DwgGuide`).
Proje dosyalarında DWG saklanabilir; analiz için DXF veya vektörel PDF gerekir.

Bu belge, DWG'yi uygulama içinde desteklemenin seçeneklerini ve her birinin bedelini özetler. Karar
kullanıcıya aittir; aşağıdaki seçeneklerin hiçbiri kullanıcı onayı olmadan etkinleştirilmemiştir.

> Lisans ve fiyat bilgileri değişebilir. Bir seçenek seçilmeden önce üreticinin güncel lisans
> metni doğrulanmalıdır; bu belge hukuki görüş değildir.

## Seçenekler

| Seçenek | Nerede çalışır | Lisans / maliyet | Riskler |
| --- | --- | --- | --- |
| **A. Kullanıcı DXF/PDF dışa aktarır** (mevcut) | Kullanıcının CAD programı | Ek maliyet yok | Bir adım fazladan; XREF'ler "Bind" ile çizime eklenmeli |
| **B. LibreDWG ile kendi sunucumuzda dönüştürme** | Ayrı bir dönüştürme sunucusu (Linux) | GPL-3.0. Tarayıcıya (WASM) gömmek uygulamanın dağıtımını GPL yükümlülüğüne sokar; yalnız sunucuda çalıştırmak dağıtım sayılmaz | Yeni DWG sürümlerinde eksik/hatalı okuma; sunucu bakımı; dosyalar sunucuya gider (kendi altyapımız) |
| **C. ODA (Open Design Alliance) SDK / File Converter** | Ayrı sunucu (Windows/Linux) | Ticari kullanım ODA üyeliği gerektirir (ücretli); ücretsiz File Converter üyeliksiz yalnız ticari olmayan kullanım içindir | Lisans maliyeti; masaüstü aracının sunucuda otomasyonu lisansa tabidir |
| **D. Autodesk Platform Services (Model Derivative)** | Autodesk bulutu | Ücretli bulut API'si | **Gizli müşteri çizimleri üçüncü tarafa gider** — açık onay ve sözleşme gerekir; ücretli hizmet etkinleştirme onayı gerekir |

Vercel sunucusuz fonksiyonları bu dönüştürücüler için uygun değildir (ikili dosya boyutu, çalışma
süresi ve bellek sınırları). B ve C ayrı bir dönüştürme sunucusu (iş kuyruğu + kimlik doğrulama +
özel depolama) gerektirir.

## Öneri

1. **Şimdilik A** (mevcut durum): ofiste çizim AutoCAD/BricsCAD'den *AutoCAD 2018 DXF* olarak
   kaydedilir. DXF analizi Faz 13 ile mimari motora bağlandı (çizelge, poz etiketi, kat tekrarı,
   çelişki, blok geometrisi), yani DXF yolu artık PDF kadar ayrıntılı analiz verir.
2. DWG'nin doğrudan yüklenmesi iş akışında sık bir engel olursa **B** değerlendirilebilir:
   - Kendi sunucumuzda, Supabase özel deposundan imzalı bağlantıyla dosya alan, DXF üretip geri
     yazan bir dönüştürme işçisi.
   - Kullanıcıya "dönüştürüldü — eksik nesne olabilir" uyarısı, dönüştürme raporu ve özgün DWG'nin
     saklanması.
   - Bunun için sunucu (aylık maliyet) ve kullanıcı onayı gerekir.
3. **D** yalnız müşterinin çizimlerini Autodesk'e göndermeye yazılı onay vermesi ve ücretli hizmetin
   onaylanması hâlinde düşünülmelidir.

## Doğrulanmamış

- Seçeneklerin hiçbiri gerçek ofis DWG dosyalarıyla denenmedi.
- Lisans koşulları bu belge yazılırken üreticilerin genel açıklamalarına göre özetlendi; seçim
  öncesinde yeniden doğrulanmalıdır.
