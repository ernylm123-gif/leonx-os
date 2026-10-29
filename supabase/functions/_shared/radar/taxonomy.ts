/**
 * LEONX Radar — iş kategorileri (LEONX METAL ürün/hizmet ağacı) ve proje türü → olası ihtiyaç tablosu.
 *
 * Anahtar sözcükler KATLANMIŞ GÖVDE biçimindedir (bkz. text.ts fold/stemMatches): "yangin kapi"
 * ifadesi "yangın kapısı", "YANGIN KAPILARI", "yangın kapılarının" metinleriyle eşleşir.
 * `weak` sözcükler (ör. tek başına "pencere", "kapı", "korkuluk") yalnız satın alma / ihale
 * ilanlarında sayılır; haber metninde yanlış pozitif üretmesin diye.
 * `negative` ifadeler (önek eşleşmesi) o konumdaki eşleşmeyi geçersiz kılar ("kapıya dayandı").
 *
 * Proje türü tablosu YALNIZ "potansiyel" ihtiyaç üretir; doğrulanmış ihtiyaç asla buradan gelmez.
 */

export type CategoryGroup = 'kapi' | 'aluminyum_pvc' | 'metal'

export interface CategoryDef {
  key: string
  name: string
  group: CategoryGroup
  keywords: string[]
  weak?: string[]
  negative?: string[]
}

export const GROUP_LABEL: Record<CategoryGroup, string> = {
  kapi: 'Kapı sistemleri',
  aluminyum_pvc: 'Alüminyum ve PVC',
  metal: 'Metal imalat',
}

const DOOR_IDIOMS = ['kapi kapi', 'kapiya dayan', 'kapilarini ac', 'kapisini ac', 'kapisini cal', 'kapi ac', 'kapi aralik', 'kapi arala', 'kapilari ac', 'kapidan don', 'kapisina kilit', 'kapilarini kapat', 'kapi disari', 'kapiyi gost', 'acik kapi', 'kapi gorevlis']

export const CATEGORIES: CategoryDef[] = [
  // ------------------------------------------------------------ Kapı sistemleri
  { key: 'celik_kapi', name: 'Çelik kapı', group: 'kapi', keywords: ['celik kapi', 'daire giris kapi', 'zirhli kapi', 'celik daire kapi'], negative: DOOR_IDIOMS },
  { key: 'yangin_kapisi', name: 'Yangın kapısı', group: 'kapi', keywords: ['yangin kapi', 'yangina dayanikli kapi', 'yangin cikis kapi', 'acil cikis kapi', 'yangin merdiven kapi', 'ei60', 'ei90', 'ei120', 'panik barli kapi'], negative: DOOR_IDIOMS },
  { key: 'oda_kapisi', name: 'Oda kapısı', group: 'kapi', keywords: ['oda kapi', 'ic kapi', 'ic mekan kapi'], negative: DOOR_IDIOMS },
  { key: 'ahsap_melamin_kapi', name: 'Ahşap / melamin kapı', group: 'kapi', keywords: ['ahsap kapi', 'melamin kapi', 'mdf kapi', 'laminat kapi', 'masif kapi', 'amerikan kapi', 'amerikan panel kapi'], negative: DOOR_IDIOMS },
  { key: 'lake_kapi', name: 'Lake kapı', group: 'kapi', keywords: ['lake kapi', 'lake boyali kapi'], negative: DOOR_IDIOMS },
  { key: 'bina_giris_kapisi', name: 'Bina giriş kapısı', group: 'kapi', keywords: ['bina giris kapi', 'apartman giris kapi', 'apartman kapi', 'fotoselli kapi', 'otomatik kapi', 'blok giris kapi'], negative: DOOR_IDIOMS },
  { key: 'villa_giris_kapisi', name: 'Villa giriş kapısı', group: 'kapi', keywords: ['villa kapi', 'villa giris kapi', 'mustakil ev kapi', 'dekoratif giris kapi'], negative: DOOR_IDIOMS },
  { key: 'pivot_kapi', name: 'Pivot kapı', group: 'kapi', keywords: ['pivot kapi', 'pivot menteseli kapi', 'pivot giris kapi'], negative: DOOR_IDIOMS },
  { key: 'teknik_kapi', name: 'Teknik kapı', group: 'kapi', keywords: ['teknik kapi', 'hijyenik kapi', 'kursun kapi', 'kursunlu kapi', 'radyasyon kapi', 'akustik kapi', 'ses yalitimli kapi', 'seksiyonel kapi', 'endustriyel kapi', 'hizli kapi', 'hangar kapi', 'soguk oda kapi', 'kepenk'], negative: DOOR_IDIOMS },
  { key: 'toplu_konut_kapi', name: 'Toplu konut kapı işleri', group: 'kapi', keywords: ['toplu konut kapi', 'konut kapi isleri', 'toki kapi'], negative: DOOR_IDIOMS },
  { key: 'kurumsal_bina_kapi', name: 'Otel / hastane / okul / ticari bina kapı işleri', group: 'kapi', keywords: ['otel kapi', 'hastane kapi', 'okul kapi', 'ticari bina kapi', 'ofis kapi'], weak: ['kapi isleri', 'kapi imalat', 'kapi alim', 'kapi temin', 'kapi yapim', 'kapi'], negative: DOOR_IDIOMS },

  // ------------------------------------------------------------ Alüminyum ve PVC
  { key: 'aluminyum_dograma', name: 'Alüminyum doğrama', group: 'aluminyum_pvc', keywords: ['aluminyum dograma', 'aluminyum pencere', 'aluminyum kapi', 'isi yalitimli aluminyum', 'aluminyum dogramali', 'aluminyum profil'] },
  { key: 'pvc_dograma', name: 'PVC doğrama', group: 'aluminyum_pvc', keywords: ['pvc dograma', 'pvc pencere', 'pvc kapi', 'plastik dograma', 'pvc dogramali'] },
  { key: 'pencere_kapi_sistemleri', name: 'Pencere ve kapı sistemleri', group: 'aluminyum_pvc', keywords: ['pencere sistem', 'pencere ve kapi', 'kapi ve pencere', 'pencere dograma', 'pencere degisim', 'pencere yenileme', 'dograma isleri', 'dograma imalat', 'dograma yapim', 'dograma alim'], weak: ['dograma', 'pencere'], negative: ['pencereden', 'pencere ac'] },
  { key: 'giydirme_cephe', name: 'Giydirme cephe', group: 'aluminyum_pvc', keywords: ['giydirme cephe', 'perde duvar', 'curtain wall', 'silikon cephe', 'kapakli cephe', 'unitize cephe', 'yarim kapakli cephe'] },
  { key: 'cam_cephe', name: 'Cam cephe', group: 'aluminyum_pvc', keywords: ['cam cephe', 'camli cephe', 'strukturel cephe', 'spider cam', 'spider sistem', 'cam giydirme', 'cam kaplama cephe'] },
  { key: 'kompozit_cephe', name: 'Kompozit cephe', group: 'aluminyum_pvc', keywords: ['kompozit cephe', 'kompozit panel', 'aluminyum kompozit', 'kompozit kaplama', 'alucobond'] },
  { key: 'aluminyum_korkuluk', name: 'Alüminyum korkuluk', group: 'aluminyum_pvc', keywords: ['aluminyum korkuluk', 'aluminyum korkulug', 'cam korkuluk', 'cam korkulug'] },
  { key: 'kupeste', name: 'Küpeşte', group: 'aluminyum_pvc', keywords: ['kupeste', 'tirabzan'] },
  { key: 'surme_sistemleri', name: 'Sürme sistemleri', group: 'aluminyum_pvc', keywords: ['surme sistem', 'surme kapi', 'surme pencere', 'surmeli', 'kaldir surme', 'katlanir cam', 'giyotin cam', 'cam balkon'] },
  { key: 'cam_bolme', name: 'Cam bölme', group: 'aluminyum_pvc', keywords: ['cam bolme', 'cam seperator', 'cam separator', 'cam ofis bolme'] },
  { key: 'ofis_bolme', name: 'Ofis bölme', group: 'aluminyum_pvc', keywords: ['ofis bolme', 'ofis ici bolme', 'tam boy bolme', 'bolme sistem'] },
  { key: 'cephe_yenileme', name: 'Cephe yenileme / tadilat', group: 'aluminyum_pvc', keywords: ['cephe yenileme', 'cephe tadilat', 'cephe restorasyon', 'cephe iyilestirme', 'cephe rehabilitasyon', 'dis cephe yenileme', 'cephe onarim'] },

  // ------------------------------------------------------------ Metal imalat
  { key: 'lazer_kesim', name: 'Lazer kesim', group: 'metal', keywords: ['lazer kesim', 'fiber lazer', 'sac lazer', 'lazerle kesim'] },
  { key: 'plazma_kesim', name: 'Plazma kesim', group: 'metal', keywords: ['plazma kesim', 'cnc plazma'] },
  { key: 'boru_profil_lazer', name: 'Boru-profil lazer', group: 'metal', keywords: ['boru lazer', 'profil lazer', 'tup lazer', 'boru profil lazer'] },
  { key: 'cnc_abkant', name: 'CNC abkant', group: 'metal', keywords: ['abkant', 'cnc abkant', 'sac bukum'] },
  { key: 'delikli_sac', name: 'Delikli sac', group: 'metal', keywords: ['delikli sac', 'perfore sac', 'perfore panel', 'delikli metal'] },
  { key: 'dekoratif_metal_cephe', name: 'Dekoratif metal cephe', group: 'metal', keywords: ['metal cephe', 'dekoratif metal', 'corten cephe', 'paslanmaz cephe', 'metal panel cephe', 'metal cephe kaplama'] },
  { key: 'metal_korkuluk', name: 'Metal korkuluk', group: 'metal', keywords: ['metal korkuluk', 'metal korkulug', 'demir korkuluk', 'demir korkulug', 'celik korkuluk', 'celik korkulug', 'paslanmaz korkuluk', 'paslanmaz korkulug', 'ferforje korkuluk', 'balkon korkulug', 'balkon korkuluk', 'merdiven korkulug', 'merdiven korkuluk'], weak: ['korkuluk', 'korkulug'], negative: ['yol korkulu', 'otoyol', 'refuj', 'bariyer', 'trafik'] },
  { key: 'ozel_metal_imalat', name: 'Özel metal imalat', group: 'metal', keywords: ['metal imalat', 'celik imalat', 'ozel imalat', 'celik konstruksiyon', 'metal konstruksiyon', 'kaynakli imalat', 'demir dograma', 'celik yapi imalat'] },
  { key: 'bahce_villa_metal', name: 'Bahçe ve villa metal ürünleri', group: 'metal', keywords: ['bahce kapi', 'bahce korkulug', 'bahce korkuluk', 'ferforje', 'pergola', 'metal sundurma', 'villa korkulug', 'villa korkuluk', 'otomatik bahce kapi'] },
]

export const CATEGORY_BY_KEY: Record<string, CategoryDef> = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]))

export function categoryName(key: string): string {
  return CATEGORY_BY_KEY[key]?.name ?? key
}

// ------------------------------------------------------------------ Proje türleri
export interface ProjectTypeDef {
  key: string
  label: string
  keywords: string[]
  negative?: string[]
  /** Olası (potansiyel) ihtiyaçlar — asla doğrulanmış sayılmaz */
  needs: string[]
  /** Ticari büyüklük tahmini (0–1) — puanlamada "ticari potansiyel" */
  size: number
}

/** Sıra önemlidir: daha özgül tür önce (toplu konut, konuttan önce) */
export const PROJECT_TYPES: ProjectTypeDef[] = [
  { key: 'hastane', label: 'Hastane / sağlık tesisi', keywords: ['sehir hastane', 'hastane', 'saglik kampus', 'tip merkez', 'saglik merkez', 'poliklinik', 'aile sagligi merkez'], needs: ['yangin_kapisi', 'teknik_kapi', 'aluminyum_dograma', 'kurumsal_bina_kapi'], size: 1 },
  { key: 'otel', label: 'Otel / konaklama', keywords: ['otel', 'tatil koy', 'resort', 'butik otel', 'apart otel'], negative: ['otelcilik'], needs: ['oda_kapisi', 'cam_cephe', 'aluminyum_korkuluk', 'kurumsal_bina_kapi'], size: 1 },
  { key: 'toplu_konut', label: 'Toplu konut / kentsel dönüşüm', keywords: ['toplu konut', 'toki', 'sosyal konut', 'kentsel donusum', 'deprem konut', 'afet konut'], needs: ['celik_kapi', 'pvc_dograma', 'toplu_konut_kapi', 'oda_kapisi', 'metal_korkuluk'], size: 1 },
  { key: 'avm', label: 'AVM / alışveriş merkezi', keywords: ['avm', 'alisveris merkez', 'outlet'], needs: ['giydirme_cephe', 'cam_bolme', 'cam_cephe', 'kompozit_cephe'], size: 1 },
  { key: 'is_merkezi', label: 'İş merkezi / ofis', keywords: ['is merkez', 'plaza', 'ofis bina', 'ofis kule', 'ofis projesi', 'ticaret merkez', 'genel mudurluk bina'], needs: ['giydirme_cephe', 'cam_bolme', 'ofis_bolme', 'cam_cephe'], size: 1 },
  { key: 'okul', label: 'Okul / eğitim / yurt', keywords: ['okul', 'ilkokul', 'ortaokul', 'lise', 'anaokul', 'egitim kampus', 'universite kampus', 'ogrenci yurt', 'derslik'], negative: ['yurt disi', 'yurt ici'], needs: ['kurumsal_bina_kapi', 'yangin_kapisi', 'aluminyum_dograma', 'pvc_dograma'], size: 0.7 },
  { key: 'fabrika', label: 'Fabrika / OSB / depo', keywords: ['fabrika', 'osb', 'organize sanayi', 'sanayi tesis', 'uretim tesis', 'lojistik merkez', 'depo', 'antrepo'], negative: ['su depo', 'yakit depo', 'akaryakit depo'], needs: ['ozel_metal_imalat', 'teknik_kapi', 'surme_sistemleri'], size: 0.7 },
  { key: 'kamu_binasi', label: 'Kamu / hizmet binası', keywords: ['hizmet bina', 'belediye bina', 'adliye', 'hukumet konag', 'kultur merkez', 'kongre merkez', 'kutuphane', 'muze', 'idari bina', 'karakol'], needs: ['aluminyum_dograma', 'yangin_kapisi', 'cam_cephe', 'kurumsal_bina_kapi'], size: 0.7 },
  { key: 'spor', label: 'Spor tesisi', keywords: ['spor salon', 'stadyum', 'spor kompleks', 'yuzme havuz', 'kapali spor', 'spor tesis'], needs: ['aluminyum_dograma', 'metal_korkuluk', 'yangin_kapisi'], size: 0.7 },
  { key: 'villa', label: 'Villa / müstakil konut', keywords: ['villa', 'mustakil'], negative: ['villa kapi'], needs: ['villa_giris_kapisi', 'pivot_kapi', 'bahce_villa_metal', 'surme_sistemleri', 'aluminyum_dograma'], size: 0.5 },
  { key: 'konut', label: 'Konut / rezidans', keywords: ['rezidans', 'konut projesi', 'konut', 'apartman', 'konut sitesi', 'daireli'], needs: ['celik_kapi', 'oda_kapisi', 'aluminyum_dograma', 'pvc_dograma', 'aluminyum_korkuluk'], size: 0.6 },
  { key: 'cami', label: 'Cami / ibadethane', keywords: ['cami', 'camii'], negative: ['camia'], needs: ['aluminyum_dograma', 'ozel_metal_imalat'], size: 0.4 },
  { key: 'otopark', label: 'Otopark', keywords: ['otopark', 'katli otopark'], needs: ['metal_korkuluk', 'yangin_kapisi'], size: 0.4 },
]

export const PROJECT_TYPE_BY_KEY: Record<string, ProjectTypeDef> = Object.fromEntries(PROJECT_TYPES.map((p) => [p.key, p]))
