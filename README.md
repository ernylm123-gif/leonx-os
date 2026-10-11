# LEONX OS

LEONX Metal'in **iç kullanımına özel** proje, CAD analiz, metraj ve teklif yönetim sistemi.

> Firma: **LEONX METAL** · [leonxmetal.com](https://www.leonxmetal.com)

## Durum — Faz 1: Arayüz ve yazılım altyapısı

Bu sürüm yalnızca arayüzü ve uygulama iskeletini içerir. Veritabanı (Supabase), CAD analiz motoru ve
yapay zekâ entegrasyonu **henüz yoktur**. Uygulamada sahte müşteri, fiyat veya metraj verisi bulunmaz;
geliştirilmemiş eylemler devre dışıdır ve hangi aşamada geleceği belirtilir.

| Faz | Kapsam | Durum |
| --- | --- | --- |
| 1 | Arayüz ve yazılım altyapısı | ✅ |
| 2 | Veritabanı, kimlik doğrulama, kayıtlar | Planlandı |
| 3 | DWG / DXF analiz motoru | Planlandı |
| 4 | Otomatik metraj ve fiyatlandırma | Planlandı |
| 5 | Teklif hazırlama ve PDF çıktıları | Planlandı |
| 6 | LEONX AI entegrasyonu | Planlandı |

## Teknolojiler

React 19 · TypeScript · Vite · Tailwind CSS v4 · React Router · Framer Motion · Lucide React

## Komutlar

```bash
npm install        # bağımlılıkları kur
npm run dev        # geliştirme sunucusu (http://localhost:5173)
npm run typecheck  # TypeScript kontrolü
npm run build      # production build (dist/)
npm run preview    # build çıktısını önizle
```

## Klasör yapısı

```
src/
  App.tsx                  Rota tanımları (modüller ihtiyaç anında yüklenir)
  main.tsx                 Giriş noktası
  index.css                Tasarım belirteçleri (antrasit, titanyum, fırçalanmış gümüş)
  config/
    navigation.ts          Menü öğeleri, gruplar ve modül durumları
    company.ts             Firma bilgisi, sürüm, entegrasyon durumu, yol haritası
  context/preferences.tsx  Arayüz tercihleri (cihazda saklanır)
  layouts/AppLayout.tsx    Ana yerleşim ve sayfa geçişleri
  components/
    brand/                 LEONX amblemi ve logo
    layout/                Kenar çubuğu, üst çubuk, mobil çekmece, alt sekme çubuğu, komut paleti
    ui/                    Panel, PageHeader, EmptyState, Button, Toggle, StatusPill vb.
  pages/                   Dashboard, Projeler, CAD Analiz, Metraj, Teklifler,
                           Firmalar, LEONX AI, Raporlar, Ayarlar, 404
```

## Rotalar

| Yol | Sayfa |
| --- | --- |
| `/` | Dashboard |
| `/projeler` | Projeler |
| `/cad-analiz` | CAD Analiz |
| `/metraj` | Metraj |
| `/teklifler` | Teklifler |
| `/firmalar` | Firmalar |
| `/leonx-ai` | LEONX AI |
| `/raporlar` | Raporlar |
| `/ayarlar` | Ayarlar |

Uygulama tarayıcı geçmişi tabanlı yönlendirme kullanır; yayına alırken sunucunun bilinmeyen yolları
`index.html`'e yönlendirmesi gerekir.
