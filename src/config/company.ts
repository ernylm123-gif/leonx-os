export const COMPANY = {
  name: 'LEONX METAL',
  website: 'https://www.leonxmetal.com',
  websiteLabel: 'leonxmetal.com',
  /** Faaliyet alanları — metraj ve proje kategorileri için temel sınıflandırma */
  disciplines: ['Alüminyum', 'PVC', 'Kapı', 'Korkuluk', 'Cephe', 'Metal İmalat'] as const,
} as const

export const APP = {
  name: 'LEONX OS',
  version: __LEONX_BUILD__.version,
  stage: 'Faz 7 · Proje yönetimi, görevler ve bildirimler',
  /** Tek kanonik üretim adresi — tüm cihazlar bu adresi kullanmalıdır */
  canonicalOrigin: 'https://leonx-os.vercel.app',
} as const

/**
 * Gelecek geliştirme aşamaları. Numara yerine adla anılır; faz numaraları
 * yalnızca tamamlanan aşamalar için kullanılır.
 */
export const MILESTONE = {
  data: 'Veritabanı aşaması',
  cad: 'CAD motoru aşaması',
  pricing: 'Metraj ve fiyat aşaması',
  quotes: 'Teklif aşaması',
  ai: 'LEONX AI aşaması',
} as const

/** Henüz entegre edilmemiş servisler. Veritabanı durumu çalışma anında gösterilir. */
export const INTEGRATIONS = [
  { key: 'cad', label: 'CAD analiz motoru (DXF, PDF; DWG dönüştürme ile)', connected: true, milestone: MILESTONE.cad },
  { key: 'quantity', label: 'Poz bazlı metraj ve Excel/PDF', connected: true, milestone: MILESTONE.pricing },
  { key: 'pricing', label: 'Teklif, maliyet ve fiyatlandırma (PDF/Excel)', connected: true, milestone: MILESTONE.quotes },
  { key: 'ai', label: 'LEONX AI', connected: false, milestone: MILESTONE.ai },
] as const

export const ROADMAP = [
  { phase: 'Faz 1', title: 'Arayüz ve yazılım altyapısı', done: true },
  { phase: 'Faz 2A', title: 'Güvenli web dağıtım hazırlığı', done: true },
  { phase: 'Faz 3', title: 'Kurumsal arayüz ve tema sistemi', done: true },
  { phase: 'Faz 4', title: 'Giriş, veritabanı, firmalar, projeler, dosyalar, senkronizasyon', done: true },
  { phase: 'Faz 5', title: 'DXF/PDF analiz, CAD görüntüleyici, poz tespiti ve metraj', done: true },
  { phase: 'Faz 6', title: 'Teklif, maliyet, fiyatlandırma, revizyon ve kurumsal PDF/Excel', done: true },
  { phase: 'Faz 7', title: 'Proje aşamaları, görev ve termin, bildirim merkezi ve push', done: true },
  { phase: 'Faz 5.2', title: 'Mimari PDF analizi: AutoCAD yazı-çizgi OCR, kart tipi liste, teknik özellikler', done: true },
  { phase: 'Sıradaki', title: 'LEONX AI entegrasyonu', done: false },
] as const
