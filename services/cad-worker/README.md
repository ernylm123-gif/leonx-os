# LEONX CAD dönüştürme servisi (DWG → DXF → PDF)

Tarayıcı DWG okuyamaz. Bu servis, kullanıcının kendi sunucusunda çalışan izole bir dönüştürücüdür:

1. DWG gelir. İmza ve sürüm (R13 – AutoCAD 2018) denetlenir; sınır 50 MB.
2. GNU LibreDWG `dwg2dxf` ayrı süreçte çalışır. Süre, bellek ve dosya boyutu sınırlıdır; geçici dizin kullanılır.
3. Uzun metinlerdeki kaçışsız satır sonları onarılır (`repair.py`) ve kaç değerin onarıldığı raporlanır.
4. **Kalite denetimi:** DWG'nin kendi nesne envanteri (`dwgread`) ile DXF envanteri (ezdxf) karşılaştırılır.
   - kaybolan nesne türü, katman ve blok
   - layout'lar
   - dış referanslar (XREF)
   - özel (proxy) nesneler
   - birim
   - ezdxf yapısal denetimi
5. İstenirse PDF önizleme üretilir: model uzayı ve her layout ayrı sayfa, layout'lar kendi kâğıt boyutunda. Bu bir önizlemedir; ölçü DXF'ten alınır.

DXF, uygulamadaki mevcut analiz motoruna (tarayıcıda) verilir. Servis dosya saklamaz.

## API

| Uç nokta | Açıklama |
| --- | --- |
| `POST /v1/dwg/donustur?pdf=1` | `Authorization: Bearer <Supabase oturum belirteci>`, çok parçalı `dosya` alanı |
| `GET /saglik` | Hazır olup olmadığını döner |

## Yapılandırma (ortam değişkenleri)

| Değişken | Anlamı |
| --- | --- |
| `SUPABASE_URL` | JWKS ile imza doğrulama (önerilen). |
| `SUPABASE_JWT_SECRET` | Eski HS256 doğrulama. Gizli anahtardır; depoya yazılmaz. |
| `ALLOWED_USER_IDS` | Servisi kullanabilecek kullanıcı kimlikleri (virgülle). |
| `ALLOWED_ORIGINS` | CORS izinli kökenler. Varsayılan: `https://leonx-os.vercel.app`. |
| `CAD_WORKER_PARALLEL` | Aynı anda çalışabilecek dönüştürme sayısı. Varsayılan: 2. |

`SUPABASE_URL` veya `SUPABASE_JWT_SECRET` tanımlı değilse servis başlamaz.

## Yerel test

```bash
pip install -r requirements-dev.txt
LIBREDWG_BIN=/opt/libredwg/bin LD_LIBRARY_PATH=/opt/libredwg/lib \
LIBREDWG_TESTDATA=/yol/libredwg-0.13.3/test/test-data python -m pytest -q
```

## Barındırma

**Henüz bir yere kurulmadı.** Seçenekler ve maliyet için `docs/DWG_DONUSTURME.md` belgesine bakın. Kurulum kullanıcı onayı gerektirir.

Uygulamada etkinleştirmek için:
1. Servis adresi `VITE_CAD_WORKER_URL` olarak verilir.
2. Adres `vercel.json` içindeki CSP `connect-src` listesine eklenir. Alternatif olarak Vercel yeniden yazma kuralıyla aynı kökenden sunulur.
