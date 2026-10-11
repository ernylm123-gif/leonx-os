export const COMPANY = {
  name: 'LEONX METAL',
  website: 'https://www.leonxmetal.com',
  websiteLabel: 'leonxmetal.com',
  /** Faaliyet alanları — metraj ve proje kategorileri için temel sınıflandırma */
  disciplines: ['Alüminyum', 'PVC', 'Kapı', 'Korkuluk', 'Cephe', 'Metal İmalat'] as const,
} as const

export const APP = {
  name: 'LEONX OS',
  version: '0.3.0',
  stage: 'Faz 3 · Kurumsal arayüz',
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

/** Harici servislerin bağlantı durumu. Henüz hiçbiri entegre edilmedi. */
export const INTEGRATIONS = [
  { key: 'database', label: 'Veritabanı (Supabase)', connected: false, milestone: MILESTONE.data },
  { key: 'cad', label: 'CAD analiz motoru (DWG/DXF)', connected: false, milestone: MILESTONE.cad },
  { key: 'pricing', label: 'Metraj ve fiyatlandırma', connected: false, milestone: MILESTONE.pricing },
  { key: 'ai', label: 'LEONX AI', connected: false, milestone: MILESTONE.ai },
] as const

export const ROADMAP = [
  { phase: 'Faz 1', title: 'Arayüz ve yazılım altyapısı', done: true },
  { phase: 'Faz 2A', title: 'Güvenli web dağıtım hazırlığı', done: true },
  { phase: 'Faz 3', title: 'Kurumsal arayüz ve tema sistemi', done: true },
  { phase: 'Sıradaki', title: 'Veritabanı, kimlik doğrulama ve kayıtlar', done: false },
  { phase: 'Planlandı', title: 'DWG / DXF analiz motoru', done: false },
  { phase: 'Planlandı', title: 'Otomatik metraj ve fiyatlandırma', done: false },
  { phase: 'Planlandı', title: 'Teklif hazırlama ve PDF çıktıları', done: false },
  { phase: 'Planlandı', title: 'LEONX AI entegrasyonu', done: false },
] as const
