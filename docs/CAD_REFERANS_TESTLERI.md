# CAD / PDF metraj doğruluk testleri

LEONX OS'nin PDF analiz motoru iki tür veriyle ölçülür:

| Tür | Nerede | Ne kanıtlar |
| --- | --- | --- |
| **Sentetik fikstürler** | `src/cad/__fixtures__/pdf/*.pdf` + `*.expected.json` | Bilinen çizim biçimlerinin (tablo/kart çizelge, metre yazımı, kesirli etiket, AutoCAD yazı-çizgi, görüntü çizelge, kat çarpanı) bozulmadığını. **Gerçek proje doğruluğu değildir.** |
| **Gerçek referans projeler** | Depo DIŞINDA, yerel bir klasörde | Gerçek mimari projelerde kullanılabilir doğruluk |

Sentetik fikstürler her `npm test` çalıştırmasında ölçülür ve eşik altına düşerse test başarısız olur.
Gerçek projeler gizli müşteri verisi olduğu için depoya eklenmez.

## Gerçek referans proje hazırlama

1. Bir klasör oluşturun (ör. `cad-referans/` — bu ad `.gitignore` içindedir).
2. Her proje için iki dosya koyun:
   - `villa-a.pdf` — mimari proje (çok sayfalı olabilir)
   - `villa-a.expected.json` — uzmanın hazırladığı metraj:

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

Sonuç ekrana yazılır ve klasöre `sonuc.json` olarak kaydedilir. Analiz tamamen yerelde yapılır
(OCR dahil); dosyalar hiçbir servise gönderilmez.

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
- DWG doğrudan okunmaz: DXF'e dönüştürülmelidir.
