import type { BBox, Mat } from './geometry'

/**
 * Analiz sonucunda oluşan "sahne": tüm nesneler dünya koordinatlarında (çizim birimi),
 * bloklar açılmış hâldedir. Web Worker'dan ana iş parçacığına yapılandırılmış kopyalama
 * ile aktarılır; koordinatlar tek bir Float64Array içinde tutulur.
 */

export type SupportLevel = 'tam' | 'kismi' | 'desteklenmiyor'

/** Nesne türlerinin destek düzeyi — arayüzde ve analiz raporunda aynen gösterilir. */
export const ENTITY_SUPPORT: Record<string, { level: SupportLevel; note: string }> = {
  LINE: { level: 'tam', note: 'Uç noktaları ve uzunluğu okunur.' },
  LWPOLYLINE: { level: 'tam', note: 'Köşeler, yaylı (bulge) parçalar, kapalılık; uzunluk ve alan analitik hesaplanır.' },
  POLYLINE: { level: 'tam', note: '2B ve 3B polyline. Polyface/mesh türleri desteklenmez.' },
  ARC: { level: 'tam', note: 'Merkez, yarıçap, açılar; yay uzunluğu analitik.' },
  CIRCLE: { level: 'tam', note: 'Merkez ve yarıçap; çevre ve alan analitik.' },
  ELLIPSE: { level: 'tam', note: 'Tam ve kısmi elips; uzunluk sayısal (yaklaşık).' },
  INSERT: { level: 'tam', note: 'Blok referansı: konum, döndürme, ölçek, aynalama, iç içe bloklar ve MINSERT dizileri.' },
  TEXT: { level: 'tam', note: 'Metin, yükseklik, döndürme ve hizalama. Yazı tipi birebir değildir.' },
  MTEXT: { level: 'tam', note: 'Çok satırlı metin; biçim kodları temizlenir.' },
  POINT: { level: 'tam', note: 'Nokta konumu.' },
  ATTRIB: { level: 'tam', note: 'Blok özniteliği (etiket ve değer); poz tespitinde kullanılır.' },
  SPLINE: { level: 'kismi', note: 'Kontrol noktalarından değerlendirilir; yalnızca uydurma noktası olanlar yaklaşık çizilir. Uzunluk yaklaşıktır.' },
  DIMENSION: { level: 'kismi', note: 'Ölçü değeri (42) ve görünen metin okunur; çizimi ölçü bloğundan gelir. DIMLFAC gibi stil katsayıları uygulanmaz, metin ile geometri karşılaştırılır.' },
  HATCH: { level: 'kismi', note: 'Sınır döngüleri ve alanı okunur; tarama deseni çizilmez.' },
  SOLID: { level: 'kismi', note: 'Dış hattı çizilir; dolgu gösterilmez.' },
  TRACE: { level: 'kismi', note: 'Dış hattı çizilir.' },
  '3DFACE': { level: 'kismi', note: 'Üstten izdüşümü çizilir.' },
  LEADER: { level: 'kismi', note: 'Yalnızca çizgi; ok başı çizilmez.' },
  ACAD_TABLE: { level: 'kismi', note: 'Tablo, çizim bloğundan gösterilir; hücreler ayrıca okunmaz.' },
  ATTDEF: { level: 'kismi', note: 'Blok tanımındaki öznitelik şablonu; çizilmez, yalnızca sayılır.' },
}

export function supportOf(type: string): { level: SupportLevel; note: string } {
  return ENTITY_SUPPORT[type] ?? { level: 'desteklenmiyor', note: 'Bu nesne türü okunmuyor; raporda listelenir.' }
}

export interface TextInfo {
  value: string
  /** Satırlar (MTEXT çok satırlı olabilir) */
  lines: string[]
  /** Metin yerel düzlemi → dünya: (0,0) ilk satırın taban çizgisi başlangıcı, 1 birim = 1 çizim birimi */
  m: Mat
  height: number
  /** Yatay hizalama oranı (her satır için): 0 sol, 0.5 orta, 1 sağ */
  ax: number
  /** İlk satırın taban çizgisinin yerel y konumu */
  baseline: number
  /** Satır aralığı (yerel birim) */
  lineHeight: number
  /** Yazı yönündeki gerçek uzunluk (PDF metinlerinde pdf.js verir) */
  advance?: number
}

export interface DimInfo {
  kind: 'dogrusal' | 'hizali' | 'acisal' | 'cap' | 'yaricap' | 'koordinat' | 'bilinmiyor'
  /** Geometriden ölçülen değer (çizim birimi) — dosyadaki 42 kodu veya tanım noktalarından */
  measurement: number | null
  /** Çizimde görünen metin */
  displayed: string | null
  /** Görünen metindeki sayı (olası yorumlar) */
  displayedValues: number[]
  /** Metin elle değiştirilmiş mi (ölçüyle bağlantısız) */
  override: boolean
  p1: [number, number] | null
  p2: [number, number] | null
  /** Ölçü çizgisinin yönü (radyan, dünya) */
  angle: number | null
}

export interface SceneEntity {
  id: number
  /** Kaynak DXF nesne türü */
  type: string
  handle: string | null
  /** Etkin katman (blok içindeki "0" katmanı, referansın katmanını alır) */
  layer: string
  /** Çözümlenmiş renk (0xRRGGBB); null → katman/arka plan rengi (ACI 7) */
  rgb: number | null
  /** Bağlı olduğu INSERT zinciri (en içteki referansın indeksi), yoksa -1 */
  insert: number
  /** Bağlı olduğu üst nesne (ölçü, tarama, tablo) — seçimde üst nesne seçilir */
  owner: number
  kind: 'path' | 'text' | 'point' | 'group'
  /** coords dizisindeki başlangıç (sayı indeksi) */
  start: number
  /** Nokta sayısı */
  count: number
  closed: boolean
  bbox: BBox
  /** Dünya birimi cinsinden uzunluk (çevre) */
  length: number | null
  /** Dünya birimi² cinsinden alan (yalnızca kapalı şekiller) */
  area: number | null
  /** Uzunluk/alan analitik mi (true) yoksa parçalı yaklaşım mı (false) */
  exact: boolean
  circle?: [number, number, number]
  text?: TextInfo
  dim?: DimInfo
  hatch?: { solid: boolean; pattern: string; loops: number }
  /** Dikdörtgen tanıma için: kapalı, 4 köşeli, dik açılı (dünya koordinatında) */
  rect?: { w: number; h: number; angle: number }
}

export interface SceneInsert {
  id: number
  handle: string | null
  block: string
  layer: string
  parent: number
  depth: number
  /** Blok yerel koordinatı → dünya */
  m: Mat
  firstEntity: number
  /** Hariç (son nesneden sonraki indeks) */
  endEntity: number
  bbox: BBox
  attribs: { tag: string; value: string }[]
  /** Dünyadaki ölçek ve döndürme (gösterim için) */
  sx: number
  sy: number
  rotationDeg: number
  mirrored: boolean
  /** MINSERT dizisinde konum */
  cell: [number, number] | null
}

export interface SceneLayer {
  name: string
  rgb: number
  aci: number
  off: boolean
  frozen: boolean
  locked: boolean
  count: number
}

export interface SceneBlock {
  name: string
  anonymous: boolean
  xref: boolean
  entityCount: number
  insertCount: number
}

export interface ReportWarning {
  code: string
  severity: 'bilgi' | 'uyari' | 'hata'
  message: string
  count?: number
  handles?: string[]
}

export interface TypeCount {
  type: string
  total: number
  drawn: number
  level: SupportLevel
}

export interface CadReport {
  format: 'dxf'
  acadver: string | null
  release: string | null
  encoding: string
  units: {
    code: number | null
    label: string
    /** 1 çizim biriminin mm karşılığı; bilinmiyorsa null */
    mmPerUnit: number | null
  }
  counts: TypeCount[]
  warnings: ReportWarning[]
  blocks: SceneBlock[]
  extents: BBox | null
  paperSpaceSkipped: number
  truncated: boolean
  limits: { maxEntities: number; maxPoints: number }
  stats: { parseMs: number; buildMs: number; entities: number; points: number; inserts: number }
}

export interface Scene {
  coords: Float64Array
  entities: SceneEntity[]
  inserts: SceneInsert[]
  layers: SceneLayer[]
  bbox: BBox | null
}

export interface DxfAnalysis {
  scene: Scene
  report: CadReport
  /** Kâğıt uzayı (layout) sayfaları: antet ve çizelgeler çoğunlukla buradadır; analizde ayrı pafta olarak okunur */
  paper?: { name: string; scene: Scene }[]
}
