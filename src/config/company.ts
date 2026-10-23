export const COMPANY = {
  name: 'LEONX METAL',
  website: 'https://www.leonxmetal.com',
  websiteLabel: 'leonxmetal.com',
  /** Faaliyet alanları — metraj ve proje kategorileri için temel sınıflandırma */
  disciplines: ['Alüminyum', 'PVC', 'Kapı', 'Korkuluk', 'Cephe', 'Metal İmalat'] as const,
  /**
   * Tanıtım e-postası taslaklarında kullanılan GENEL yetkinlik ifadeleri (LEONX AI Radar). Referans,
   * sertifika veya tamamlanmış proje iddiası İÇERMEZ; radar ayarlarından değiştirilebilir.
   */
  capabilities: [
    'Çelik kapı, yangın kapısı, oda ve bina giriş kapıları',
    'Alüminyum ve PVC doğrama, sürme sistemleri',
    'Giydirme cephe, cam cephe ve kompozit cephe uygulamaları',
    'Alüminyum ve metal korkuluk, küpeşte',
    'Metal imalat: lazer kesim, CNC abkant, özel imalat',
  ] as const,
} as const

export const APP = {
  name: 'LEONX OS',
  version: __LEONX_BUILD__.version,
  stage: 'LEONX AI · Proje ve iş fırsatı radarı',
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
  { key: 'cad', label: 'CAD analiz motoru (DXF, PDF; DWG için DXF dönüştürmesi gerekir)', connected: true, milestone: MILESTONE.cad },
  { key: 'quantity', label: 'Poz bazlı metraj ve Excel/PDF', connected: true, milestone: MILESTONE.pricing },
  { key: 'pricing', label: 'Teklif, maliyet ve fiyatlandırma (PDF/Excel)', connected: true, milestone: MILESTONE.quotes },
  { key: 'ai', label: 'LEONX AI Radar (kural motoru; tarama sunucu işlevi dağıtımı sahip onayıyla)', connected: true, milestone: MILESTONE.ai },
] as const

export const ROADMAP = [
  { phase: 'Faz 1', title: 'Arayüz ve yazılım altyapısı', done: true },
  { phase: 'Faz 2A', title: 'Güvenli web dağıtım hazırlığı', done: true },
  { phase: 'Faz 3', title: 'Kurumsal arayüz ve tema sistemi', done: true },
  { phase: 'Faz 4', title: 'Giriş, veritabanı, firmalar, projeler, dosyalar, senkronizasyon', done: true },
  { phase: 'Faz 5', title: 'DXF/PDF analiz, CAD görüntüleyici, poz tespiti ve metraj', done: true },
  { phase: 'Faz 6', title: 'Teklif, maliyet, fiyatlandırma, revizyon ve kurumsal PDF/Excel', done: true },
  { phase: 'Faz 7', title: 'Proje aşamaları, görev ve termin, bildirim merkezi ve push', done: true },
  { phase: 'Faz 5.2', title: 'Mimari PDF analizi, mühendislik incelemesi ve metraj izlenebilirliği', done: true },
  { phase: 'Faz 8', title: 'Finans: maliyet, gider, tahsilat, kur ve kârlılık', done: true },
  { phase: 'LEONX AI', title: 'Proje ve iş fırsatı radarı (kural motoru, kaynaklı kanıt, CRM aktarımı)', done: true },
  { phase: 'Sıradaki', title: 'Radar sunucu işlevlerinin dağıtımı ve izinli kaynakların canlı doğrulaması', done: false },
] as const
