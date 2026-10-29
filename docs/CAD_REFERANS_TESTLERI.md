# CAD / PDF metraj doğruluk testleri

LEONX OS'nin CAD analiz motoru (PDF, DXF ve DWG→DXF) iki tür veriyle ölçülür:

| Tür | Nerede | Ne kanıtlar |
| --- | --- | --- |
| **Sentetik fikstürler** | `src/cad/__fixtures__/pdf/*.pdf`, `src/cad/__fixtures__/*.dxf` + `*.expected.json` | Bilinen çizim biçimlerinin (tablo/kart çizelge, metre yazımı, kesirli etiket, AutoCAD yazı-çizgi, görüntü çizelge, kat çarpanı) bozulmadığını. **Gerçek proje doğruluğu değildir.** |
| **Gerçek referans projeler** | Depo DIŞINDA, yerel bir klasörde | Gerçek mimari projelerde kullanılabilir doğruluk |

Sentetik fikstürler her `npm test` çalıştırmasında ölçülür ve eşik altına düşerse test başarısız olur.
Gerçek projeler gizli müşteri verisi olduğu için depoya eklenmez.

## Gerçek referans proje hazırlama

1. Bir klasör oluşturun (ör. `cad-referans/` — bu ad `.gitignore` içindedir).
2. Her proje için çizim(ler) ve bir referans metraj koyun:
   - `villa-a.pdf` — mimari proje (çok sayfalı olabilir) ve/veya
   - `villa-a.dxf` ve/veya `villa-a.dwg` — aynı projenin CAD dosyası
   - `villa-a.expected.json` — uzmanın hazırladığı metraj (tüm biçimler için ortak):

```json
{
  "aciklama": "Villa A — zemin + 1. kat, alüminyum doğrama",
  "pozlar": [
    { "code": "P-01", "width_mm": 1200, "height_mm": 1500, "count": 8, "category": "al_pencere" },
    { "code": "K-01", "width_mm": 900, "height_mm": 2200, "count": 4, "category": "al_kapi" }
  ]
}
```

- `code`: çizimdeki poz kodu (`P-01`, `P01` ve `P1` aynı sayılır).
- `width_mm`, `height_mm`: doğrama (kaba) ölçüsü, mm.
- `count`: projedeki toplam adet (tüm katlar).
- `category` (isteğe bağlı): `al_pencere`, `al_kapi`, `pvc_pencere`, `pvc_kapi`, `surme`, `sabit_cam`,
  `cephe_dograma`, `fotoselli_kapi`, `korkuluk`, `kompozit_cephe`, `metal_imalat`, `belirsiz`.

3. Çalıştırın:

```bash
CAD_REFERANS_DIR=./cad-referans npm run bench:cad
# İsteğe bağlı alt sınır (recall): CAD_REFERANS_ESIK=0.8
```

Sonuç ekrana yazılır ve klasöre `sonuc.json` olarak kaydedilir. PDF ve DXF analizi tamamen yerelde
yapılır (OCR dahil); dosyalar hiçbir servise gönderilmez.

### DWG dosyaları

DWG, uygulamanın kullandığı dönüştürme servisiyle (`services/cad-worker`) DXF'e çevrilip aynı DXF
akışıyla ölçülür. Gizli proje dosyalarını dışarı göndermemek için servis **yerelde** çalıştırılır:

```bash
cd services/cad-worker
CAD_WORKER_INSECURE_DEV=1 LIBREDWG_BIN=/yol/libredwg/bin uvicorn leonx_cad.app:create_app --factory --port 8090
# başka bir terminalde:
CAD_REFERANS_DIR=./cad-referans CAD_WORKER_URL=http://127.0.0.1:8090 npm run bench:cad
```

`CAD_WORKER_URL` verilmezse DWG dosyaları atlanır ve bu ekrana yazılır. Dönüştürülemeyen dosya
ölçümden düşmez; "ANALİZ EDİLEMEDİ" olarak kaydedilir (hiç poz bulunamamış sayılır).

### `sonuc.json` içeriği

- `toplam`: tüm dosyalarda precision, recall, kritik hata sayısı.
- `projeler[]`: dosya, biçim, süre, ölçüm değerleri ve **`pozlar`** — poz bazında metraj farkı tablosu
  (`dogru` / `farkli` / `eksik` / `fazla`, beklenen ve bulunan en × boy × adet, güven, çelişki, alan
  farkı m²). DWG için dönüşüm raporu (`donusum`: durum, kaybolan nesneler, notlar) da yazılır.
- `bicim_uyumu[]`: aynı projenin farklı biçimleri (ör. PDF ↔ DWG) birbiriyle karşılaştırılır — ortak
  pozlar, yalnız bir biçimde bulunanlar, adet/ölçü farkları ve uyum oranı. Biçimler birbirini
  tutmuyorsa en az biri yanlıştır; referanstan bağımsız bir kontroldür.

## Ölçülen değerler

- **Poz tespiti:** precision (bulunan pozların ne kadarı gerçek) ve recall (gerçek pozların ne kadarı bulundu).
- **Adet:** tam doğru oranı ve ortalama mutlak hata.
- **Ölçü:** en ve boyu ±1 mm içinde doğru olan pozların oranı, ortalama hata (mm).
- **Alan:** toplam doğrama alanının yüzde hatası.
- **İş kalemi:** doğru kategori oranı.
- **KRİTİK hata:** yanlış poz, yanlış ölçü veya yanlış adedin *yüksek güvenle* ve çelişki uyarısı
  olmadan sunulması. Kullanıcıyı yanıltacağı için öncelikli hatadır; sıfır olmalıdır.

## Bilinen sınırlar

- Yüzde yüz doğruluk garanti edilmez. Her aday kullanıcı onayına sunulur; çelişkiler (çizelge ↔ plan
  adedi, kart yazısı ↔ ölçü çizgisi, yazı ↔ görünüş açılımı) sessizce çözülmez.
- Etiketin üzerinden çizgi geçiyorsa (kapı yayı, duvar) OCR ölçüyü okuyamayabilir; ölçü uydurulmaz,
  "Ölçü bulunamadı" olarak bildirilir.
- DWG tarayıcıda okunmaz; dönüştürme servisiyle DXF'e çevrilir. Dönüşümde kaybolan nesneler (ör. bazı
  dinamik blok ekleri) metrajı etkileyebilir; dönüşüm raporu `sonuc.json`'da yer alır.
- Bu altyapı şu an yalnız sentetik fikstürler ve doğrama içermeyen AutoCAD örnekleriyle sınandı;
  **gerçek proje doğruluğu henüz ölçülmedi.**
