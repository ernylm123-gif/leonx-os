# CAD analiz motoru — teknik denetim (DXF / PDF / DWG)

Tarih: 2026-10-15 · Kapsam: `src/cad/**`, `src/quantity/detect.ts`, `src/cad/dxfSemantic.ts`.

Her satırın durumu üç türden biridir:

- **Test edildi:** fikstür + otomatik test var.
- **Kod incelemesi:** yalnız kod okunarak belirlendi.
- **Doğrulanmadı:** test edilemedi.

Hiçbir yetenek gerçek ofis çizimiyle doğrulanmadı; bütün testler bilinen sonuçlu sentetik fikstürlerle yapıldı.

## DXF

| Yetenek | Durum | Kanıt |
| --- | --- | --- |
| ASCII DXF R12–R2018 ayrıştırma, birim (`$INSUNITS`), Türkçe kod sayfası | Çalışır | Test edildi (`analyze.test.ts`, birim/kodlama fikstürleri) |
| LINE, LWPOLYLINE, POLYLINE, ARC, CIRCLE, ELLIPSE, TEXT, MTEXT, POINT | Tam | Test edildi |
| INSERT (iç içe, aynalı, MINSERT) | Tam | Test edildi (`blocks_transform`, `nested_blocks`, `minsert`) |
| **ATTRIB → poz, ölçü, tip, malzeme, seri, cam, açılım, renk** | **Bu PR'da eklendi.** Öznitelik, blok adındaki genel tahminin önüne geçer. Ölçü birimi etiketten ya da geometriden alınır; ikisi de yoksa "varsayım" olarak işaretlenir. Geometriyle uyuşmazsa çelişki gösterilir. | Test edildi (`cad_oznitelik_bloklar`). Önceden blok adı `PENCERE_GENEL` olan `TIP=KAPI` bloğu "alüminyum pencere" sayılıyordu. |
| **Kâğıt uzayı (layout): antet, doğrama çizelgesi** | **Bu PR'da eklendi.** Her layout ayrı pafta olarak analiz edilir; çizelge adet/malzeme bilgisi plana bağlanır. | Test edildi (`cad_kagit_uzayi_cizelge`). Önceden layout nesneleri tamamen atlanıyordu (fikstürde 14 nesne). |
| Model uzayında plan + metin tablosu çizelge, kat tekrarı | Çalışır (Faz 13) | Test edildi (`mimari_plan_cizelge`) |
| DIMENSION | Kısmi: ölçü değeri ve görünen metin okunur, DIMLFAC uygulanmaz | Kod incelemesi |
| ACAD_TABLE (AutoCAD tablo nesnesi) | Kısmi: tablo bloğundaki yazılar sahneye gelir, hücre yapısı ayrıca okunmaz | Kod incelemesi; ezdxf ile tablo fikstürü üretilemediği için **doğrulanmadı** |
| Dinamik bloklar (`*U…` anonim blok, etkin ad XDATA'da) | Etkin blok adı okunmuyor; poz kodu/öznitelik varsa yine bulunur | Kod incelemesi; **doğrulanmadı** |
| İkili (binary) DXF | Desteklenmez; açık hata verir | Kod incelemesi |
| Görüntüleyicide kâğıt uzayı | Gösterilmez (analizde okunur) | Kod incelemesi |

## PDF

| Yetenek | Durum | Kanıt |
| --- | --- | --- |
| Çok sayfalı vektörel PDF: metin, çizgi, pafta türü, ölçek çıkarımı ve doğrulaması | Çalışır | Test edildi (Faz 5.1/5.2 fikstürleri) |
| Poz + ölçü etiketi biçimleri (120/150, 1.20/1.50, kesirli, EN/BOY) | Çalışır | Test edildi |
| Tablo ve kart tipi çizelge | Çalışır | Test edildi |
| AutoCAD SHX (çizgi yazı) ve görüntü çizelge: karo OCR (cihaz içi, Türkçe) | Çalışır (OCR açıkken) | Test edildi (`autocad_shx_plan`, `karma_cizelge_raster`). Etiket üstünden çizgi geçen ölçü okunamayabilir. |
| Taranmış PDF | Sınırlı: OCR, güven düşük tutulur, geometri doğrulaması yok | Test edildi |
| Ölçek bilinmiyorsa | Kesin ölçü verilmez; kalibrasyon istenir | Test edildi |

## DWG

Uygulama DWG okumaz ve okuyormuş gibi davranmaz; DXF'e dönüştürme rehberi gösterilir. Ayrıntı: `docs/DWG_DEGERLENDIRME.md`.

## Harici kütüphane değerlendirmesi

| Kütüphane | Lisans (birincil kaynak) | Uygunluk |
| --- | --- | --- |
| [ezdxf](https://github.com/mozman/ezdxf) | MIT | Uygun. DXF okuma, yazma ve ikili DXF desteği var. DWG'yi yalnız ODA File Converter üzerinden okur. Bu depoda test fikstürü üretmek için zaten kullanılıyor. Sunucu tarafı analiz gerekirse ilk seçenek. |
| [PyMuPDF](https://github.com/pymupdf/PyMuPDF) | GNU AGPL v3 veya Artifex ticari lisans | **Ticari lisans olmadan önerilmez.** AGPL, ağ üzerinden sunulan hizmetin kaynak kodunun açılmasını gerektirebilir. Mevcut pdf.js (Apache 2.0) tarayıcıda aynı işi görüyor. |
| [Google OR-Tools](https://github.com/google/or-tools) | Apache 2.0 | Lisans uygun. JavaScript/WASM bağlaması yok; yalnız Python, C++, C# ve Java. Kesim optimizasyonu için mevcut TypeScript motoru küçük gruplarda kesin optimumu kanıtlıyor (bağımsız kesin çözümle 300/300). OR-Tools, büyük ve çok boylu gruplar için ileride Python servisinde kullanılabilir. |
| ODA File Converter | **Doğrulanamadı:** bu ortamdan opendesign.com'a erişilemiyor. ODA'nın SSS'sine göre ticari olmayan üyelikle geliştirilen ürün ticarileştirilemez; dönüştürücünün kendi kullanım koşulları okunamadı. | Lisans koşulları yazılı olarak doğrulanmadan kullanılmamalı |

## Python FastAPI CAD servisi — karar

**Şimdilik kurulmadı.** Gerekçeler:

- **Gizlilik:** mevcut motor tarayıcıda (Web Worker) çalışıyor; çizimler cihazdan çıkmıyor.
- **Maliyet:** barındırma maliyeti yok.
- **Kapsam:** denetimde bulunan gerçek eksikler (öznitelik, kâğıt uzayı) TypeScript tarafında giderildi.

Servis şu durumlarda anlam kazanır:

1. DWG'nin doğrudan okunması (ODA veya LibreDWG lisansı ve sunucu gerekir; kullanıcı kararı).
2. Çok büyük dosyaların arka planda işlenmesi (Aşama 7 iş kuyruğu).
3. OR-Tools ile büyük kesim planları.

Kurulursa ezdxf (MIT) ve OR-Tools (Apache 2.0) kullanılmalı. Dosyalar Supabase özel deposundan imzalı bağlantıyla alınmalı, sonuç aynı veri modeline yazılmalı, servis kullanıcı onayı olmadan dış hizmete dosya göndermemeli.

## Kalan eksikler (öncelik sırasıyla)

1. **Gerçek proje doğrulaması:** kullanıcı onaylı referans metrajlarla karşılaştırma (`docs/CAD_REFERANS_TESTLERI.md`). Ölçüm altyapısı hazır; gerçek dosya yok.
2. Dinamik blokların etkin adı (XDATA / AcDbBlockRepresentation).
3. ACAD_TABLE hücrelerinin doğrudan okunması.
4. İkili DXF.
5. Proje adı / antet alanlarının yapılandırılmış çıkarılması.
6. Kâğıt uzayının görüntüleyicide gösterilmesi.
