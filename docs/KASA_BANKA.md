# LEONX OS — Kasa, banka ve manuel gelir-gider (0.10.0)

Sahip, istediği an manuel gelir/gider girer; kasa, banka ve kredi kartı hesaplarını yönetir; hesaplar arasında virman yapar
ve doğru bakiye ile raporları görür. Bu modül Faz 8 finansının (bütçe, gider, ödeme planı, tahsilat) **yanına ikinci bir
finans sistemi kurmaz**: projeye bağlı hareketler mevcut tablolarda kalır.

Migration: `supabase/migrations/20261016001300_leonx_cash.sql` (013). İstemci: `src/finance/cash.ts` (tipler),
`src/finance/ledger.ts` (defter ve bakiye kuralları), `src/data/cashApi.ts`, `src/features/cash/*`, `/finans` sayfası.

## Veri modeli

| Tablo / görünüm | İçerik |
| --- | --- |
| `finance_accounts` | Kasa / banka / kredi kartı; para birimi (TRY, EUR, USD), açılış bakiyesi ve tarihi, banka, IBAN (boşluksuz büyük harf, biçim denetimi), etkin/pasif |
| `finance_categories` | Gelir ve gider kategorileri. Sistem kategorileri (gider: malzeme, personel, kira, elektrik, yakıt, nakliye, yemek, bakım, vergi, diğer · gelir: satış, hizmet, faiz, iade, diğer) silinemez, türü/anahtarı değişmez; adı değiştirilebilir, pasifleştirilebilir. Kullanıcı kategorisi eklenir; kullanılan kategori silinemez |
| `finance_entries` | **Projesiz** genel işletme gelir/gideri: tutar (KDV hariç) + KDV, kategori (tür uyumlu), hesap, durum (`gerceklesti` / `bekliyor`), vade, ödeme yöntemi, firma, belge no, iptal bilgisi, düzenli şablon bağlantısı |
| `finance_transfers` | Hesaplar arası virman: çıkan ve giren tutar (aynı para biriminde eşit; farklı birimde ikisi de elle girilir, kur uydurulmaz) |
| `finance_recurring` | Düzenli gelir/gider şablonu (haftalık, aylık, üç aylık, yıllık; başlangıç, bitiş, sıradaki tarih) |
| `finance_documents` | Fiş / fatura eki meta verisi (genel kayıt, proje gideri veya proje tahsilatına bağlı); dosya özel `finance-documents` deposunda (PDF, JPEG, PNG, WEBP, HEIC; en fazla 15 MB) |
| `finance_audit_log` | Değişiklik geçmişi (ekleme, güncelleme, iptal, silme; eski ve yeni satır). Yalnız sunucu tetikleyicisi yazar; sahip yalnız okur |
| `project_expenses` + `account_id`, `category_id`, `payment_method` | Projeye bağlı gider (mevcut tablo; yeni sütunlar boş bırakılabilir) |
| `project_collections` + `account_id`, `category_id` | Projeye bağlı tahsilat (mevcut tablo) |
| `finance_ledger` (görünüm) | **Tek nakit hareketi tanımı** (aşağıda) |
| `finance_account_balances` (görünüm) | Hesap başına açılış, toplam giriş/çıkış, bakiye, hareket sayısı |

Görünümler `security_invoker = true` ile tanımlıdır: RLS çağıranın yetkisiyle uygulanır. Tüm yeni tablolarda RLS açıktır,
erişim yalnız `public.is_owner()`; `anon` hiçbir yetkiye sahip değildir. Yeni tablolar Realtime yayınındadır (çoklu cihaz).

## Çift sayım engeli

1. Projeye bağlı **gelir** = `project_collections` satırı; projeye bağlı **gider** = `project_expenses` satırı.
   Hızlı ekleme penceresinde proje seçilirse kayıt bu tablolara yazılır; `finance_entries`'e yazılmaz.
2. Projesiz gelir/gider = `finance_entries` satırı. Aynı hareket iki tabloda tutulmaz.
3. Virman yalnız `finance_transfers`'tadır; gelir veya gider raporlarına **girmez**, yalnız iki hesabın bakiyesini taşır.
4. Alacak (ödeme planı) ve borç (ödenmemiş gider, "bekliyor" kayıt) bakiyeye **girmez**; panelde "bekleyen tahsilat" ve
   "ödenecek borç" olarak ayrı gösterilir.

## Bakiye tanımı

`finance_ledger` yalnız **gerçekleşen** hareketleri içerir:

| Kaynak | Koşul | Yön | Tutar |
| --- | --- | --- | --- |
| `genel` (finance_entries) | `status = 'gerceklesti'` ve iptal edilmemiş | gelir → giriş, gider → çıkış | tutar + KDV |
| `proje_tahsilat` (project_collections) | her zaman | giriş | tahsil edilen tutar |
| `proje_gider` (project_expenses) | `paid = true` | çıkış | tutar + KDV |
| `transfer_cikis` / `transfer_giris` | iptal edilmemiş | çıkış / giriş | çıkan / giren tutar |

**Bakiye = açılış bakiyesi + Σ giriş − Σ çıkış** (hesap başına, hesabın para biriminde). Hesabı olmayan satırlar
(ör. 0.10 öncesi proje gider/tahsilatları) defterde "hesapsız" görünür, gelir/gider raporlarına girer ama **hiçbir hesap
bakiyesini etkilemez**; Gelir-Gider listesinden düzenlenerek hesap atanabilir. Açılış tarihi bilgi amaçlıdır: açılış
bakiyesini, kayıt tutmaya başladığınız günkü bakiye olarak girin.

İstemci aynı kuralları `src/finance/ledger.ts` içinde uygular (`buildRecords` → `ledgerFromRecords` → `accountBalances`);
e2e sahte arka ucu da görünümleri aynı kurallarla hesaplar ve testler ekran bakiyesini sunucu görünümüyle karşılaştırır.
Dashboard kartı bakiyeyi doğrudan `finance_account_balances` görünümünden okur.

## Veritabanında uygulanan kurallar (istemciye güvenilmez)

- Hesabı olan her kayıtta (genel kayıt, proje gideri, proje tahsilatı, düzenli şablon) hesap para birimi = kayıt para birimi.
- Kategori türü kayıt türüyle aynı (gelir ↔ gelir, gider ↔ gider; proje gideri yalnız gider, tahsilat yalnız gelir kategorisi).
- Gerçekleşen genel kayıt bir hesaba yazılmalı; proje giderine hesap yalnız ödenmişse bağlanabilir.
- Pasif hesaba yeni gerçekleşen hareket yazılamaz; bakiyesi ve geçmişi korunur. Hareketi olan hesap silinemez (yabancı anahtar
  `ON DELETE RESTRICT`) ve para birimi değiştirilemez.
- **Genel kayıt ve virman silinemez** ("Kayıt silinemez; iptal edin"). Arayüzde "silme" = iptal: sebep zorunlu; iptal zamanı ve
  kullanıcısı sunucuda yazılır; iptal edilen kayıt değiştirilemez, saklanır ve hiçbir toplama girmez.
- Değişiklik geçmişi `finance_entries`, `finance_transfers`, `finance_accounts`, `finance_recurring`, `finance_categories` ile
  mevcut `project_expenses` ve `project_collections` üzerindeki her ekleme/güncelleme/iptal/silmeyi kaydeder.
- Düzenli kayıtlar `public.leonx_finance_generate_recurring(p_until)` ile üretilir (yalnız sahip; `/finans` açılışında çağrılır):
  her tarih için bir "bekliyor" kayıt, benzersiz indeks `(recurring_id, occurrence_date)` sayesinde tekrar çağrıda çift kayıt
  oluşmaz; aylık tarihler başlangıçtan hesaplanır (31 Oca → 28/29 Şub → 31 Mar). Sunucu zamanlayıcısına (pg_cron) iş eklenmedi.

## Para ve kur

Veritabanında `numeric(14,2)`; istemcide tamsayı kuruş (`src/quote/money.ts` `toCents`). Farklı para birimleri hiçbir zaman
kendiliğinden toplanmaz; panelde para birimi bazında gösterilir. Birleşik TRY toplamı yalnız tüm kurlar girilmişse, girilen
kurla üretilir ve "girdiğiniz kurla" diye etiketlenir (`src/finance/fx.ts`).

## Ekranlar (`/finans`)

| Bölüm (`?bolum=`) | İçerik |
| --- | --- |
| (varsayılan) Proje özeti | Faz 8 proje finans paneli (değişmedi) |
| `panel` | Bugünkü / aylık gelir-gider (proje ve genel ayrı), kasa / banka / toplam bakiye, net nakit akışı, bekleyen tahsilat, ödenecek borç, genel işletme giderleri, proje kârlılığı, aylık gelir-gider grafiği (satır içi SVG) |
| `gelir-gider` | Tüm kayıtlar tek listede; süzgeç (tarih, tür, durum, kapsam, hesap, kategori, proje, metin), düzenleme, iptal, geçmiş, belge eki, Excel ve PDF |
| `kasa-banka` | Hesap kartları (bakiye, giriş/çıkış, yürüyen bakiyeli hareketler), hesap ekleme/düzenleme/pasifleştirme, virman |
| `kategoriler` | Gelir ve gider kategorileri |
| `duzenli` | Düzenli şablonlar, "Şimdi üret", bekleyen düzenli kayıtları "Ödendi / Tahsil edildi" işaretleme |
| `birim-maliyetler`, `kurlar` | Faz 8 (değişmedi) |

Her bölümde sağ altta **Gelir/Gider ekle** düğmesi vardır (telefonda alt sekme çubuğunun üstünde). Zorunlu alanlar: tür, tutar,
tarih (bugün), hesap (gerçekleşen kayıtta), kategori (genel kayıtta), açıklama.

## Geri alma

Migration yalnız ekleme yapar (yeni tablolar, görünümler, fonksiyonlar, tetikleyiciler; mevcut iki tabloya boş bırakılabilir
sütunlar) ve mevcut satırları değiştirmez; tekrar çalıştırılabilir. Uygulamayı geri almak için ilgili commit'i geri alın
(`git revert`); yeni tablolar veritabanında kullanılmadan kalabilir, eski istemci onları okumaz. Yeni tetikleyiciler mevcut
proje gider/tahsilat işlemlerini yalnız hesap/kategori dolu olduğunda denetler ve geçmiş satırı yazar; eski istemcinin
gönderdiği kayıtları engellemez.
