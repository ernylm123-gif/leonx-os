# LEONX OS — Malzeme Reçetesi (BOM) · PR-5

**Reçeteler** (Mühendislik → `/receteler`, kod M12) onaylı metrajdaki pozları kullanıcının tanımladığı ürün
sistemleriyle malzeme ihtiyacına, profil kesim listesine ve (katalogda fiyat varsa) maliyete dönüştürür.

## Temel kurallar

| Konu | Kural |
| --- | --- |
| Üretici verisi | Sistem kütüphanesi **boş başlar**. Profil kodu, ağırlık, fiyat, kesim düşümü uydurulmaz. "Boş şablon" yalnız satır yapısını (kasa/kanat/kayıt/cam/fitil/aksesuar) ekler; kod, kural, standart boy, kg/m ve fiyat boştur, fire 0'dır |
| Profil boyu | Kesimli profil (`mm_profil`) için kesim boyu ve parça formülü **zorunludur** (sistemin kendi üretim kuralı). Pencere çevresinden profil boyu türetilmez |
| Onay | Yalnız **onaylı metraj sürümünün onaylı (belirsiz olmayan) pozlarından** oluşan sürüm onaylanabilir (011 finans kuralıyla aynı). Bekleyen poz dahil edilirse veya metraj taslaksa sürüm "onaysız metrajdan — taslak" olarak kaydedilir ve onaylanamaz. `source_approved` sunucuda hesaplanır, istemci iddiası yok sayılır |
| Hata | Formül hatası, eksik kural, tanımsız değişken (ör. boy yok), negatif sonuç, tam olmayan parça/adet satır üretmez ve "hata" sayılır; hatalı sürüm onaylanamaz. Sonuç asla sessizce 0 sayılmaz |
| Sürüm | Her kayıt yeni `bom_versions` satırıdır; revizyon proje başına benzersiz, kilitle atanır. Onaylı sürüm ve satırları güncellenemez/silinemez (tetikleyici). Metraj revize edilince sürüm ekranında uyarı çıkar; "Yeniden hesapla" son metrajla yeni taslak hesaplar, sistem atamaları poz koduna göre aktarılır, eski onaylı sürüm aynen kalır |
| Maliyet | Yalnız bileşenin bağlandığı birim maliyet kataloğu kaydından (aynı kodun bugün geçerli en yeni fiyatı) ve birim uyumluysa. Yoksa "fiyat tanımlı değil" (boş). Para birimleri ayrı toplanır, çevrilmez. Fiyat reçetede yalnız anlık görüntü olarak saklanır |
| Para / miktar | İstemcide tamsayı: kuruş (`src/quote/money.ts`), 0,1 mm (dmm), milli (1/1000). Veritabanında para `numeric(14,2)`, miktar `numeric(14,3)`, kesim boyu `numeric(10,1)` |

## Veri modeli (migration `20261016001400_leonx_bom.sql`)

| Tablo | İçerik |
| --- | --- |
| `product_systems` | ad, üretici, seri, `system_type` (al_pencere, al_kapi, pvc_pencere, pvc_kapi, surme, cephe, korkuluk, metal_imalat, diger), renk, not, aktif |
| `system_components` | sistem, rol (kasa, kanat, kayit, orta_kayit, pervaz, cam, fitil, mentese, kol, kilit, baglanti, montaj, aksesuar, diger), kod (boş olabilir), ad, birim (`mm_profil`, m, m2, adet, kg, takim), standart boy (yalnız profil), fire %, kg/m (yalnız profil), `cost_rate_id` → `cost_rates` |
| `system_rules` | bileşen, `applies_to` (filtre), `basis` (birim / poz), miktar / kesim boyu / parça formülleri (≤500 karakter, karakter kümesi sunucuda denetlenir), açı (bilgi), not |
| `bom_versions` | proje, metraj sürümü + anlık görüntü (rev, ad, durum), revizyon, durum (taslak / onayli / iptal), `source_approved`, hata/uyarı sayısı, uyarılar (jsonb), `based_on`, onaylayan/zaman |
| `bom_assignments` | sürüm, metraj pozu, poz anlık görüntüsü (kod, iş grubu, en, boy, adet, doğrulama), kanat, açılım, sistem + sistem adı |
| `bom_lines` | sürüm, atama, bileşen/kural bağlantısı, `line_key`, bileşen anlık görüntüsü, kesim boyu, açı, parça, toplam boy, net/fire/toplam miktar, standart boy, ağırlık, maliyet anlık görüntüsü |
| `bom_material_totals` (görünüm) | sürüm × kod × birim toplamları ve tahmini boy adedi |
| `bom_cut_list` (görünüm) | sürüm × profil kodu × kesim boyu × açı → parça, pozlar (kesim optimizasyonu girdisi) |

- RPC `create_bom_version(p_project, p_takeoff, p_payload)` (SECURITY DEFINER, sahip kontrolü): pozları metraj tablosundan doğrular, revizyonu kilitle atar, sürüm + atama + satırları **tek işlemde** yazar. Doğrudan INSERT yetkisi yoktur (yarım sürüm olmaz).
- RPC `approve_bom_version(p_id)`: taslak + `source_approved` + hata yok koşuluyla onaylar.
- RLS tüm tablolarda, yalnız `public.is_owner()`; anon'a hiçbir yetki yok; tetikleyici fonksiyonları istemciye kapalı; tablolar Realtime yayınında.
- Sistem/bileşen silinse de kaydedilmiş sürümler anlık görüntülerle aynen kalır (bağlantı `set null`).

## Formül dili

Güvenli ifade değerlendirici (`src/bom/formula.ts`) — `eval`/`Function` yok, adlar sabit listeden çözülür.

| Öğe | Açıklama |
| --- | --- |
| Sayılar | `12`, `1.5`, `.5` — ondalık ayırıcı **nokta** (`1,5` açık hatayla reddedilir) |
| İşleçler | `+ - * /`, parantez, tekli eksi/artı. Üs, karşılaştırma, koşul yok |
| İşlevler | `min(a, b, …)`, `max(…)`, `ceil(x)`, `floor(x)`, `round(x)` (yarımda sıfırdan uzağa). Ayırıcı `,` veya `;` |
| Değişkenler | `W` en (mm), `H` boy (mm), `N` poz adedi, `K` kanat sayısı (atama > poz özniteliği > 1), `A` alan m² = W×H/1e6, `P` çevre m = 2×(W+H)/1000 |
| Büyük/küçük harf | duyarsız |
| Kapsam | `birim`: formül tek ürün içindir, sonuç × N. `poz`: formül pozun toplamıdır (ör. `ceil(N/3)` takım) |
| Filtre | `applies_to` boşsa tüm pozlar; doluysa virgüllü değerlerden biri iş grubuna eşit veya açılım metninde geçiyorsa |

Örnek (yalnız biçim; değerler üretici kataloğundan girilir): kasa kesimi `W` ve `H`, parça `2`; kanat kesimi
`(W-düşüm)/K`, parça `2*K`; cam `(W-düşüm)*(H-düşüm)/1000000`; fitil `P*2`; menteşe `2*K`.

Yuvarlama: kesim boyu 0,1 mm; birim miktar 3 ondalık (sonra × N); fire eklenir (adet/takımda yukarı tam sayı);
ceil/floor/round öncesi 12 anlamlı basamağa normalleştirme (`ceil(0.1*3*10) = 3`).
Tahmini boy adedi = yukarı(fire dahil toplam boy / standart boy) — **optimizasyon değildir** (sonraki PR).

## Ekranlar

- **Sistem kütüphanesi**: sistem listesi/formu, bileşenler ve kurallar (yazarken formül doğrulaması), boş şablon, önizleme hesaplayıcı (W/H/N/K/açılım → satırlar).
- **Proje reçetesi**: proje + metraj seçimi, toplu (iş grubuna göre) ve poz bazında sistem/kanat/açılım ataması, canlı hesap (uyarılar, malzeme toplamları, kesim listesi, rol bazında satırlar), sürüm olarak kaydet, sürüm geçmişi, onay/iptal/silme, karşılaştırma (eklenen/silinen/değişen satır ve toplam farkı), Excel ve PDF. Metraj ekranında "Malzeme reçetesi" bağlantısı.

## Testler

- `src/bom/formula.test.ts`, `src/bom/engine.test.ts` (kullanıcı örneği 1200 × 1500 × 4 — **test içi sentetik sistem**), `src/export/bomExport.test.ts`.
- `supabase/tests/bom.test.sql`: RLS (anon/yetkisiz), değişmezlik, revizyon, RPC kuralları, anlık görüntü, zincirleme silme.
- `e2e/app.e2e.mjs`: tanım → hesap → kayıt → onay → metraj revizyonu → yeniden hesap → karşılaştırma → onaysız metraj; iPhone SE ve iPad yerleşimi.

## Geri alma

Migration yalnız ekleme yapar (yeni tablo/görünüm/fonksiyon; mevcut tablo ve veriye dokunmaz). Geri almak için
uygulama commit'i geri alınır (`git revert`); tablolar veritabanında kalabilir ve kullanılmaz. Gerekirse
tabloların kaldırılması ayrı, bilinçli bir işlemle yapılmalıdır (migration'a DROP eklenmez).

## Bilinen sınırlar

- Kesim optimizasyonu (boy yerleşimi, fire hesabı) yok; boy adedi yalnız tahmindir.
- Cam için ölçü bazında cam listesi yok (yalnız m²).
- Sunucu satırları yeniden hesaplamaz; satırlar istemci motorundan gelir, sunucu poz kaynağını, onay durumunu ve kısıtları doğrular.
- Gerçek üretici sistemiyle ve gerçek proje metrajıyla henüz doğrulanmadı.
