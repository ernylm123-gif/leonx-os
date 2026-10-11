export const COMPANY = {
  name: 'LEONX METAL',
  website: 'https://www.leonxmetal.com',
  websiteLabel: 'leonxmetal.com',
  /** Faaliyet alanları — metraj ve proje kategorileri için temel sınıflandırma */
  disciplines: ['Alüminyum', 'PVC', 'Kapı', 'Korkuluk', 'Cephe', 'Metal İmalat'] as const,
} as const

export const APP = {
  name: 'LEONX OS',
  version: '0.1.0',
  stage: 'Faz 1 · Arayüz ve altyapı',
} as const

/** Harici servislerin bağlantı durumu. Henüz hiçbiri entegre edilmedi. */
export const INTEGRATIONS = [
  { key: 'database', label: 'Veritabanı (Supabase)', connected: false, phase: 'Faz 2' },
  { key: 'cad', label: 'CAD analiz motoru (DWG/DXF)', connected: false, phase: 'Faz 3' },
  { key: 'pricing', label: 'Metraj ve fiyatlandırma', connected: false, phase: 'Faz 4' },
  { key: 'ai', label: 'LEONX AI', connected: false, phase: 'Faz 6' },
] as const

export const ROADMAP = [
  { phase: 'Faz 1', title: 'Arayüz ve yazılım altyapısı', done: true },
  { phase: 'Faz 2', title: 'Veritabanı, kimlik doğrulama ve kayıtlar', done: false },
  { phase: 'Faz 3', title: 'DWG / DXF analiz motoru', done: false },
  { phase: 'Faz 4', title: 'Otomatik metraj ve fiyatlandırma', done: false },
  { phase: 'Faz 5', title: 'Teklif hazırlama ve PDF çıktıları', done: false },
  { phase: 'Faz 6', title: 'LEONX AI entegrasyonu', done: false },
] as const
