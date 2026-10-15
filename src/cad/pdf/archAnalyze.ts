/**
 * Mimari PDF analizi (Faz 5.1) — PDF'ten doğrama metrajı ADAYI çıkarır.
 *
 * Türk mimari projelerinde doğramalar çoğunlukla YAZIYLA tanımlanır: poz kodu ("P1", "K-02")
 * ve "EN/BOY" santimetre etiketi ("120/150", "90/210"), ayrıca doğrama çizelgesi
 * (POZ · CİNSİ · EN · BOY · ADET). Bu modül:
 *  1. Sayfa metinlerini satırlara birleştirir ("120/" + "150" → "120/150", döndürülmüş yazı dahil),
 *  2. Paftayı sınıflandırır (plan / görünüş / kesit / çizelge / detay / vaziyet),
 *  3. Poz kodu + ölçü etiketlerini ve çizelge satırlarını okur,
 *  4. Adetleri YALNIZ plan paftalarında sayar (görünüş/kesit tekrarları sayılmaz),
 *  5. Ölçü yazılarını ölçü çizgileriyle karşılaştırarak ölçeği çıkarır ve etiket ölçülerini
 *     çizimdeki açıklık geometrisiyle doğrular,
 *  6. Sonuç yoksa NEDENİNİ açıklayan tanılama üretir.
 *
 * İlkeler: ölçü uydurulmaz (yalnız yazıdan veya doğrulanmış geometriden), malzeme yalnız metinden
 * okunur (geometri malzemeyi kanıtlamaz), her aday kullanıcı onayına sunulur, güven %100 olmaz.
 */
import { type BBox, bboxOf, bboxUnion, EMPTY_BBOX } from '../geometry'
import type { Scene } from '../types'
import { findScaleHints, GLYPH_LAYER, type PdfKind, PT_TO_MM, type TextGeometry } from './pdfScene'
import { categoryFor, inferType, type Material, normalizeKey, parsePozLabel, type PozCandidate, type PozInstance, type TypeHint } from '@/quantity/detect'
import { canonCode, deg, type DimLabel, fixOcrText, isNumeric, KNOWN_PREFIX, normAngle, num, parseDims, runCenter, splitCodeDims, type TextRun, typeFromCode, unitSuffix } from './labels'
import { segmentIndex, type Segs, segsNear } from './segments'
import { ATTR_LABEL, type AttrText, extractAttributes, openingCodes, type PozAttributes, suggestAttr, withMissing } from './attributes'
import { cardBox, parseCards } from './cards'
import { analyzeElevation, type ElevationInfo, PANEL_LABEL } from './elevation'
import { type FloorInfo, floorInfo, isRoomName, roomLabel } from './floors'

export { canonCode, type DimLabel, fixOcrText, parseDims, parseQty, type TextRun, typeFromCode } from './labels'
export { segmentIndex } from './segments'

const OTHER_MATERIAL = /AHSAP|CELIK|DEMIR|MDF|LAMINAT|AMERIKAN|PANEL KAPI|YANGIN/

// ------------------------------------------------------------------ türler

export type SheetType = 'plan' | 'gorunus' | 'kesit' | 'cizelge' | 'detay' | 'vaziyet' | 'bilinmiyor'

export const SHEET_LABEL: Record<SheetType, string> = {
  plan: 'Kat planı',
  gorunus: 'Görünüş',
  kesit: 'Kesit',
  cizelge: 'Doğrama çizelgesi',
  detay: 'Detay',
  vaziyet: 'Vaziyet planı',
  bilinmiyor: 'Belirlenemedi',
}

export interface LabelHit {
  page: number
  sheet: SheetType
  code: string | null
  dims: DimLabel | null
  text: string
  bbox: BBox
  ids: number[]
  /** Etiket yakınındaki tür/malzeme kelimeleri */
  near: string[]
  geometry: GeometryCheck | null
  ocr: boolean
  /** En yakın mahal adı (plan) */
  room: string | null
  /** Görünüş paftasında etiketin altındaki doğrama çizimi */
  elevation?: ElevationInfo | null
}

export interface GeometryCheck {
  status: 'uyumlu' | 'bulunamadi' | 'olcek_yok'
  /** Eşleşen açıklık çizgisinin gerçek uzunluğu (mm) */
  measured_mm: number | null
  segmentIds: number[]
  /** Eşleşen açıklık çizgilerinin sınır kutusu */
  bbox: BBox | null
  denominator: number | null
}

export interface ScheduleRow {
  page: number
  code: string
  description: string
  /** CİNSİ sütunu (tür bilgisi önce buradan okunur) */
  kind: string | null
  material: string | null
  w_mm: number | null
  h_mm: number | null
  quantity: number | null
  unit: 'cm' | 'mm' | 'm'
  text: string
  bbox: BBox
  ids: number[]
  ocr: boolean
  /** Satır tablodan mı, kart tipi listeden mi okundu */
  source?: 'tablo' | 'kart'
  /** Satırın/kartın tüm yazıları (özellik çıkarımı) */
  texts?: string[]
  /** Kat sütunları ("ZEMİN 2 · 1. KAT 3") */
  floors?: { label: string; qty: number }[]
  /** Kartın görünüş çizimi analizi */
  elevation?: ElevationInfo | null
  /** Kart ölçüsünün kaynağı ve ölçü çizgisi ile yazı çelişkisi */
  dimsFrom?: 'yazi' | 'olcu_cizgisi' | null
  drawingScale?: number | null
  dimsConflict?: string | null
}

export interface PageScale {
  /** Antet / metindeki ölçek (ör. "ÖLÇEK 1/50") */
  title: number | null
  /** Ölçü yazıları ile ölçü çizgilerinin karşılaştırılmasından çıkan ölçek */
  inferred: { denominator: number; support: number; total: number } | null
  /** Geometri doğrulamasında kullanılan ölçek ve kaynağı */
  used: number | null
  usedFrom: 'kullanici' | 'olcu' | 'antet' | null
  conflict: string | null
  /** Ölçek bağımsız olarak doğrulandı mı (ölçü yazıları ⇄ çizgi uzunlukları veya kullanıcı) */
  verified: boolean
}

export interface PdfPageAnalysis {
  page: number
  kind: PdfKind
  sheet: SheetType
  title: string | null
  textSource: 'vektor' | 'ocr' | 'vektor+ocr' | 'yok'
  textCount: number
  numericCount: number
  labelCount: number
  scheduleRows: number
  segments: number
  scale: PageScale
  samples: string[]
  notes: string[]
  hits: LabelHit[]
  schedule: ScheduleRow[]
  /** Kat adı ve "bu plan N kat için geçerli" çarpanı (başlıkta yazıyorsa) */
  floor: FloorInfo
  /** Tüm doğramalar için geçerli genel notlar ("AKSİ BELİRTİLMEDİKÇE TÜM DOĞRAMALAR PVC") */
  generalNotes: string[]
  /** Yazılar çizgi olarak gömülü (OCR gerekir) */
  textAsGeometry: boolean
  /** Yazı tipi eşlemesi bozuk metin oranı */
  garbledText: number
  /** Bu sayfa için OCR gerekli mi ve neden */
  ocrNeeded: string | null
  /** Kart tipi listede okunan kart sayısı */
  cardCount: number
}

export interface PdfDiagnostics {
  pageCount: number
  analyzedPages: number[]
  skippedPages: { page: number; reason: string }[]
  pages: Omit<PdfPageAnalysis, 'hits' | 'schedule'>[]
  totals: { texts: number; numeric: number; labels: number; scheduleRows: number; vectorPages: number; scannedPages: number; emptyPages: number }
  /** Aday çıkmadıysa (veya az çıktıysa) nedenleri — kullanıcıya gösterilir */
  whyNone: string[]
  /** Genel uyarılar (ör. ölçek çelişkisi, OCR kullanıldı) */
  warnings: string[]
  /** Önerilen ölçek (kullanıcı onayıyla uygulanır) */
  suggestedScale: { page: number; denominator: number; why: string } | null
  ocrUsed: boolean
  /** Tanı raporu (Faz 5.2): okunabilirlik, pafta sayıları, OCR, ölçek, başarısız sayfalar, eksikler */
  report: DiagnosticReport
}

export interface DiagnosticReport {
  readable: boolean
  pagesFound: number
  pagesAnalyzed: number
  texts: number
  candidates: number
  scaleVerifiedPages: number[]
  scaleUnverifiedPages: number[]
  ocrNeededPages: { page: number; reason: string; done: boolean }[]
  failedPages: { page: number; reason: string }[]
  /** Çıkarılamayan bilgiler (ör. "3 pozda malzeme yazılmamış") */
  missing: string[]
  /** Kullanıcıdan istenecek kritik girdiler */
  asks: { kind: 'referans_olcu' | 'pafta_secimi' | 'cizelge' | 'malzeme' | 'ocr'; message: string }[]
}

export interface PozConflict {
  kind: 'adet' | 'olcu' | 'malzeme' | 'acilim'
  message: string
}

/** PDF adayı: tespit motorunun ortak aday biçimi + PDF'e özgü bilgiler */
export interface PdfPozCandidate extends PozCandidate {
  pages: number[]
  sheets: string[]
  scheduleQty: number | null
  planQty: number | null
  dimsFrom: 'cizelge' | 'etiket' | 'kart' | null
  outOfScope: string | null
  /** Teknik özellikler ve doğrulama durumları */
  attrs: PozAttributes
  /** Kullanıcının karar vermesi gereken çelişkiler (sessizce seçilmez) */
  conflicts: PozConflict[]
  /** Plan sayımına uygulanan kat çarpanı (başlıkta yazıyorsa) */
  floorMultiplier: number | null
  /** Çizimde görünüşü bulunduysa (kart veya görünüş paftası) */
  elevation: ElevationInfo | null
  /** Eşleştirme anahtarı (P-01 = P01 = P1) */
  canon: string
  /** Pozun geçtiği kod yazımları (farklıysa) */
  codeVariants: string[]
}

// ------------------------------------------------------------------ metin satırları

/** Sahnedeki PDF metin nesnelerinden satırlar: aynı doğrultu + aynı taban çizgisi + bitişik */
export function extractRuns(scene: Scene): TextRun[] {
  const items: TextRun[] = []
  for (const e of scene.entities) {
    if (e.kind !== 'text' || !e.text) continue
    const t = e.text
    const angle = Math.atan2(t.m[1], t.m[0])
    const h = t.height
    items.push({
      text: t.value,
      angle,
      height: h,
      ox: t.m[4],
      oy: t.m[5],
      width: t.advance ?? h * 0.55 * t.value.length,
      bbox: e.bbox,
      ids: [e.id],
    })
  }
  return mergeRuns(items)
}

export function mergeRuns(items: TextRun[]): TextRun[] {
  // Doğrultu kovası (0.5°)
  const buckets = new Map<number, TextRun[]>()
  for (const it of items) {
    const k = Math.round(deg(it.angle) * 2) / 2
    const arr = buckets.get(k) ?? []
    arr.push(it)
    buckets.set(k, arr)
  }
  const out: TextRun[] = []
  for (const [k, arr] of buckets) {
    const a = (k * Math.PI) / 180
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const loc = arr.map((r) => ({ r, u: r.ox * ca + r.oy * sa, v: -r.ox * sa + r.oy * ca }))
    loc.sort((p, q) => p.v - q.v || p.u - q.u)
    // Taban çizgisi kümeleri
    const lines: (typeof loc)[] = []
    for (const p of loc) {
      const last = lines[lines.length - 1]
      if (last && Math.abs(last[0].v - p.v) <= 0.35 * Math.max(last[0].r.height, p.r.height)) last.push(p)
      else lines.push([p])
    }
    for (const line of lines) {
      line.sort((p, q) => p.u - q.u)
      let cur: { r: TextRun; u: number; end: number } | null = null
      for (const p of line) {
        const h = p.r.height
        if (cur) {
          const gap = p.u - cur.end
          const ratio = Math.max(h, cur.r.height) / Math.max(1e-6, Math.min(h, cur.r.height))
          if (gap < 0.8 * Math.max(h, cur.r.height) && gap > -0.5 * h && ratio < 1.5) {
            const sep = gap > 0.12 * h ? ' ' : ''
            cur.r = {
              ...cur.r,
              text: `${cur.r.text}${sep}${p.r.text}`,
              width: p.u + p.r.width - cur.u,
              bbox: bboxUnion(cur.r.bbox, p.r.bbox),
              ids: [...cur.r.ids, ...p.r.ids],
              ocr: cur.r.ocr != null || p.r.ocr != null ? Math.min(cur.r.ocr ?? 1, p.r.ocr ?? 1) : undefined,
            }
            cur.end = Math.max(cur.end, p.u + p.r.width)
            continue
          }
          out.push(cur.r)
        }
        cur = { r: { ...p.r }, u: p.u, end: p.u + p.r.width }
      }
      if (cur) out.push(cur.r)
    }
  }
  return out.map((r) => ({ ...r, text: r.text.replace(/\s+/g, ' ').trim() })).filter((r) => r.text)
}


// ------------------------------------------------------------------ pafta sınıflandırma

const SHEET_PATTERNS: [SheetType, RegExp][] = [
  ['cizelge', /(DOGRAMA|PENCERE|KAPI|KAPILAR|PENCERELER|ALUMINYUM|PVC)\s*(CIZELGE|LISTE|TABLO|LEJANT)|(CIZELGE|LISTE)SI?\b.*(DOGRAMA|PENCERE|KAPI)|DOOR SCHEDULE|WINDOW SCHEDULE/],
  ['vaziyet', /VAZIYET|SITE PLAN|YERLESIM PLANI/],
  ['gorunus', /GORUNUS|ELEVATION|CEPHE GORUNUS/],
  ['kesit', /\bKESIT|SECTION\b/],
  ['detay', /\bDETAY|DETAIL\b/],
  ['plan', /KAT PLANI|ZEMIN KAT|BODRUM KAT|NORMAL KAT|TIP KAT|CATI KATI|ASMA KAT|\d+\s*\.?\s*KAT\b|KAT\s*PLAN|FLOOR PLAN|\bPLANI?\b/],
]

export function classifySheet(runs: TextRun[]): { sheet: SheetType; title: string | null } {
  let best: { sheet: SheetType; title: string; score: number } | null = null
  for (const r of runs) {
    if (r.text.length > 60) continue
    const n = normalizeKey(r.text)
    for (const [sheet, re] of SHEET_PATTERNS) {
      if (!re.test(n)) continue
      // Antet ("PAFTA:") ve büyük yazı başlık sayılır; kesit işaretleri ("A-A KESİTİ") küçük yazılır
      const score = r.height * (/PAFTA|PAFTA ADI|BASLIK|TITLE/.test(n) ? 3 : 1) * (sheet === 'plan' && !/KAT|FLOOR/.test(n) ? 0.5 : 1)
      if (!best || score > best.score) best = { sheet, title: r.text.replace(/^PAFTA( ADI)?\s*:\s*/i, ''), score }
      break
    }
  }
  return best ? { sheet: best.sheet, title: best.title } : { sheet: 'bilinmiyor', title: null }
}

// ------------------------------------------------------------------ çizelge (tablo)

const FLOOR_COL = /^(ZEMIN( KAT)?|BODRUM( KAT)?|\d{1,2}\s*\.?\s*KAT|NORMAL KAT|TIP KAT|CATI( KATI)?|ASMA KAT|\d{1,2}\s*\.\s*-\s*\d{1,2}\s*\.\s*KAT(LAR)?)$/

const HEADER: [string, RegExp][] = [
  ['poz', /^(POZ|POZ NO|POZ NO\.|NO|KOD|TIP|TIP NO|TIPI|ISARET|DOGRAMA NO)$/],
  ['cins', /^(CINSI|CINS|TANIM|TANIMI|TURU|TUR|ADI|ELEMAN|DOGRAMA TURU)$/],
  ['sistem', /^(SISTEM|PROFIL|PROFIL SISTEMI|SERI|PROFIL SERISI)$/],
  ['malzeme', /^(MALZEME|MALZEMESI|MALZ\.?)$/],
  ['en', /^(EN|ENI|GENISLIK|G|W|B)(\s*\((CM|MM)\))?$/],
  ['boy', /^(BOY|BOYU|YUKSEKLIK|Y|H)(\s*\((CM|MM)\))?$/],
  ['olcu', /^(OLCU|OLCUSU|OLCULER|EBAT|EBATLAR|BOYUT|EN\/BOY|EN X BOY|EN-BOY|EN\*BOY)(\s*\((CM|MM)\))?$/],
  // OCR kısaltmaları/kayıpları: "ADE", "ADT"
  ['adet', /^(ADET|ADEDI|MIKTAR|SAYI|AD\.?|ADE|ADT|ADETI)$/],
  ['toplam', /^(TOPLAM|TOPLAM ADET|GENEL TOPLAM|TOP\.?)$/],
  ['cam', /^(CAM|CAM TIPI|CAM CINSI)$/],
  ['renk', /^(RENK|RENGI|RAL)$/],
  ['acilim', /^(ACILIM|ACILIS|ACILIM TURU|ACILIM SEKLI)$/],
  ['mahal', /^(MAHAL|YERI|YER|KULLANIM YERI)$/],
  ['aciklama', /^(ACIKLAMA|ACIKLAMALAR|NOT|NOTLAR)$/],
]

function headerKey(text: string): string | null {
  const n = normalizeKey(text).replace(/\s+/g, ' ').trim()
  for (const [k, re] of HEADER) if (re.test(n)) return k
  if (FLOOR_COL.test(n)) return `kat:${text.trim()}`
  return null
}

/** Yazıyı kelimelere ayırır; kelime konumu karakter oranıyla tahmin edilir (OCR'da birleşen hücreler) */
function words(r: TextRun): TextRun[] {
  const parts = r.text.split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return [r]
  const out: TextRun[] = []
  let pos = 0
  for (const w of parts) {
    const i = r.text.indexOf(w, pos)
    pos = i + w.length
    const x = r.ox + (r.width * i) / Math.max(1, r.text.length)
    const wd = (r.width * w.length) / Math.max(1, r.text.length)
    out.push({ ...r, text: w, ox: x, width: wd, bbox: [x, r.bbox[1], x + wd, r.bbox[3]] })
  }
  return out
}

/**
 * Çizelge okuma: başlık satırında POZ + (EN & BOY | ÖLÇÜ) + (ADET | TOPLAM | kat sütunları)
 * aranır; sütunlar başlık yazılarının x konumundan belirlenir, alttaki satırlar sütunlara atanır.
 * Birleşmiş başlık/hücre yazıları ("POZ NO CİNSİ", OCR'da "120 150") kelimelere bölünür.
 */
export function parseSchedules(page: number, runs: TextRun[]): { rows: ScheduleRow[]; used: Set<TextRun> } {
  const used = new Set<TextRun>()
  const rows: ScheduleRow[] = []
  const flat = runs.filter((r) => Math.abs(normAngle(r.angle)) < 0.01)
  // Satırlar: taban çizgisine göre kümele (y aşağı doğru sırala)
  const sorted = [...flat].sort((a, b) => b.oy - a.oy || a.ox - b.ox)
  const lines: TextRun[][] = []
  for (const r of sorted) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(last[0].oy - r.oy) <= 0.4 * Math.max(last[0].height, r.height)) last.push(r)
    else lines.push([r])
  }
  for (const l of lines) l.sort((a, b) => a.ox - b.ox)
  for (let i = 0; i < lines.length; i++) {
    const cols: { key: string; x: number; unit: 'cm' | 'mm' | null; run: TextRun }[] = []
    const addCol = (k: string, x: number, text: string, run: TextRun) => {
      if (!cols.some((c) => c.key === k)) cols.push({ key: k, x, unit: /\(MM\)/i.test(text) ? 'mm' : /\(CM\)/i.test(text) ? 'cm' : null, run })
    }
    for (const r of lines[i]) {
      const k = headerKey(r.text)
      if (k) addCol(k, r.ox, r.text, r)
      else for (const w of words(r)) {
        const kw = headerKey(w.text)
        if (kw) addCol(kw, w.ox, w.text, r)
      }
    }
    const has = (k: string) => cols.some((c) => c.key === k)
    const floorCols = cols.filter((c) => c.key.startsWith('kat:'))
    if (!(has('poz') && ((has('en') && has('boy')) || has('olcu')) && cols.length >= 3)) continue
    for (const c of cols) used.add(c.run)
    let headerUnit = cols.find((c) => c.unit)?.unit ?? null
    cols.sort((a, b) => a.x - b.x)
    const h0 = lines[i][0].height
    let lastY = lines[i][0].oy
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]
      const y = line[0].oy
      if (lastY - y > 4 * Math.max(h0, line[0].height) + 20) break // tablo bitti
      // Birim satırı: "(cm)" / "(mm)"
      if (line.every((r) => /^\(?(CM|MM)\)?$/i.test(r.text.trim()))) {
        headerUnit = /MM/i.test(line[0].text) ? 'mm' : 'cm'
        for (const r of line) used.add(r)
        continue
      }
      const cells = new Map<string, TextRun[]>()
      for (const r0 of line) {
        for (const r of words(r0)) {
          // Sütun: başlangıcı yazının solunda (küçük tolerans) kalan en sağdaki başlık
          let col = cols[0]
          for (const c of cols) if (c.x <= r.ox + 0.6 * r.height) col = c
          const arr = cells.get(col.key) ?? []
          arr.push(r)
          cells.set(col.key, arr)
        }
      }
      const cell = (k: string) => (cells.get(k) ?? []).map((r) => r.text).join(' ').trim()
      const ocrRow = line.some((r) => r.ocr != null)
      const pozCell = ocrRow ? fixOcrText(cell('poz')) : cell('poz')
      const code = parsePozLabel(pozCell) ?? parsePozLabel(ocrRow ? fixOcrText(pozCell.split(' ')[0] ?? '') : (pozCell.split(' ')[0] ?? ''))
      if (!code) {
        // Kod içermeyen satır (not, alt toplam): tablo bitişi olabilir
        if (line.some((r) => headerKey(r.text))) break
        continue
      }
      lastY = y
      let w: number | null = null
      let hh: number | null = null
      let unit: 'cm' | 'mm' | 'm' = headerUnit ?? 'cm'
      if (has('olcu') && cell('olcu')) {
        const d = parseDims(cell('olcu'))
        if (d) {
          w = d.w_mm
          hh = d.h_mm
          unit = d.unit
        }
      }
      if (w == null && has('en')) {
        // Hücrede birden fazla sayı varsa (tanınmayan sütun) ilki alınır
        const ev = num(cell('en').split(' ')[0] ?? '')
        const bv = num(cell('boy').split(' ')[0] ?? '')
        if (ev > 0 && bv > 0) {
          if (!headerUnit && ev < 10 && bv < 10 && /[.,]/.test(cell('en'))) unit = 'm'
          else if (!headerUnit && (ev >= 1000 || bv >= 1000)) unit = 'mm'
          const f = unit === 'mm' ? 1 : unit === 'm' ? 1000 : 10
          w = Math.round(ev * f)
          hh = Math.round(bv * f)
        }
      }
      const intOf = (t: string) => (/^\d{1,4}$/.test(t) ? Number(t) : null)
      const floors = floorCols.map((c) => ({ label: c.key.slice(4), qty: intOf(cell(c.key)) ?? 0 })).filter((f) => f.qty > 0)
      let qty = intOf(cell('adet')) ?? intOf(cell('toplam'))
      if (qty == null && floors.length) qty = floors.reduce((a, f) => a + f.qty, 0)
      const material = cell('malzeme') || null
      const extras = ['sistem', 'cam', 'renk', 'acilim', 'mahal'].map((k) => (cell(k) ? `${HEADER_LABEL[k]}: ${cell(k)}` : '')).filter(Boolean)
      const desc = [cell('cins'), material, ...extras, cell('aciklama')].filter(Boolean).join(' · ')
      const all = line
      for (const r of all) used.add(r)
      rows.push({
        page,
        code,
        description: desc,
        kind: cell('cins') || null,
        material,
        w_mm: w,
        h_mm: hh,
        quantity: qty && qty > 0 ? qty : null,
        unit,
        text: all.map((r) => r.text).join(' | '),
        bbox: all.reduce((b, r) => bboxUnion(b, r.bbox), EMPTY_BBOX()),
        ids: all.flatMap((r) => r.ids),
        ocr: all.some((r) => r.ocr != null),
        source: 'tablo',
        texts: [cell('cins'), material ?? '', ...extras, cell('aciklama')].filter(Boolean),
        floors: floors.length ? floors : undefined,
      })
    }
  }
  return { rows, used }
}

const HEADER_LABEL: Record<string, string> = { sistem: 'Sistem', cam: 'Cam', renk: 'Renk', acilim: 'Açılım', mahal: 'Mahal' }

// ------------------------------------------------------------------ ölçek çıkarımı

const STD_SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 200, 250, 500, 1000, 2000, 5000]

function snapScale(d: number): number | null {
  for (const s of STD_SCALES) if (Math.abs(d - s) / s <= 0.025) return s
  return null
}

/**
 * Ölçü yazısı (ör. "120") ile hemen altındaki paralel ölçü çizgisinin kâğıt uzunluğu
 * karşılaştırılarak ölçek bulunur. Çoğunluk aynı standart ölçeği gösteriyorsa sonuç döner.
 */
export function inferScale(runs: TextRun[], segs: Segs): PageScale['inferred'] {
  const votes = new Map<number, number>()
  let total = 0
  for (const r of runs) {
    // OCR sayıları yalnız yüksek tanıma güveniyle (ölçek kanıtı olarak) kullanılır
    if (!isNumeric(r.text) || (r.ocr != null && r.ocr < 0.8)) continue
    const v = num(r.text)
    if (!(v > 0)) continue
    const dir: [number, number] = [Math.cos(r.angle), Math.sin(r.angle)]
    const nrm: [number, number] = [-dir[1], dir[0]]
    const [cx, cy] = runCenter(r)
    let best: { i: number; d: number } | null = null
    for (const i of segsNear(segs, cx, cy, Math.max(3 * r.height, 30))) {
      const dx = segs.x2[i] - segs.x1[i]
      const dy = segs.y2[i] - segs.y1[i]
      const L = segs.len[i]
      // Paralel mi?
      if (Math.abs(dx * nrm[0] + dy * nrm[1]) / L > 0.035) continue
      if (L < r.width * 0.9) continue
      // Yazı merkezinden çizgiye dik uzaklık ve çizgi boyunca konum
      const px = cx - segs.x1[i]
      const py = cy - segs.y1[i]
      const along = (px * dx + py * dy) / L
      const perp = Math.abs(px * nrm[0] + py * nrm[1])
      if (along < 0.15 * L || along > 0.85 * L) continue
      if (Math.abs(along - L / 2) > Math.max(0.6 * r.width, 0.12 * L)) continue
      if (perp < 0.2 * r.height || perp > 2.2 * r.height) continue
      if (!best || perp < best.d) best = { i, d: perp }
    }
    if (!best) continue
    total++
    const L = segs.len[best.i] * PT_TO_MM
    // cm (tam sayı) veya m (ondalıklı, ör. 3.65) yorumları
    const cands = r.text.match(/[.,]\d{2}$/) ? [v * 1000, v * 10] : [v * 10, v * 1000]
    for (const mm of cands) {
      const s = snapScale(mm / L)
      if (s) {
        votes.set(s, (votes.get(s) ?? 0) + 1)
        break
      }
    }
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!best || best[1] < 3 || best[1] / total < 0.6) return null
  return { denominator: best[0], support: best[1], total }
}

// ------------------------------------------------------------------ geometri doğrulama

/** Etiketteki genişliğe (ölçekte) eşit uzunlukta, etikete yakın çizgi = açıklık */
function checkGeometry(hit: { bbox: BBox; dims: DimLabel | null }, segs: Segs, den: number | null): GeometryCheck | null {
  if (!hit.dims) return null
  if (!den) return { status: 'olcek_yok', measured_mm: null, segmentIds: [], bbox: null, denominator: null }
  const expected = hit.dims.w_mm / den / PT_TO_MM
  const [cx, cy] = [(hit.bbox[0] + hit.bbox[2]) / 2, (hit.bbox[1] + hit.bbox[3]) / 2]
  const radius = Math.max(2.5 * expected, 60)
  let best: { i: number; d: number } | null = null
  for (const i of segsNear(segs, cx, cy, radius)) {
    const L = segs.len[i]
    if (Math.abs(L - expected) > Math.max(0.03 * expected, 0.6)) continue
    const mx = (segs.x1[i] + segs.x2[i]) / 2
    const my = (segs.y1[i] + segs.y2[i]) / 2
    const d = Math.hypot(mx - cx, my - cy)
    if (d > radius) continue
    if (!best || d < best.d) best = { i, d }
  }
  if (!best) return { status: 'bulunamadi', measured_mm: null, segmentIds: [], bbox: null, denominator: den }
  // Aynı açıklıktaki paralel eşit çizgiler (cam/kasa çizgileri) de vurgulanır
  const b = best.i
  const ids = new Set<number>([segs.id[b]])
  let box: BBox = bboxOf([segs.x1[b], segs.y1[b], segs.x2[b], segs.y2[b]])
  const bx = (segs.x1[b] + segs.x2[b]) / 2
  const by = (segs.y1[b] + segs.y2[b]) / 2
  for (const i of segsNear(segs, bx, by, 40)) {
    if (Math.abs(segs.len[i] - segs.len[b]) > 0.6) continue
    const mx = (segs.x1[i] + segs.x2[i]) / 2
    const my = (segs.y1[i] + segs.y2[i]) / 2
    if (Math.hypot(mx - bx, my - by) < 30) {
      ids.add(segs.id[i])
      box = bboxUnion(box, bboxOf([segs.x1[i], segs.y1[i], segs.x2[i], segs.y2[i]]))
    }
  }
  return { status: 'uyumlu', measured_mm: Math.round(segs.len[b] * PT_TO_MM * den), segmentIds: [...ids], bbox: box, denominator: den }
}

// ------------------------------------------------------------------ sayfa analizi

export interface PageInput {
  page: number
  kind: PdfKind
  scene: Scene | null
  /**
   * OCR ile okunan satırlar (taranmış sayfa, çizgi olarak gömülü yazı, görüntü bölgesi).
   * Vektör yazılarla birleştirilir; vektör yazıyla çakışan OCR yazısı atılır.
   */
  ocrRuns?: TextRun[]
  /** Kullanıcının bu sayfa için onayladığı ölçek paydası (kalibrasyon / ölçek onayı) */
  userDenominator?: number | null
  /** Sayfada çizgi olarak gömülü yazı bölgeleri (pdfScene) */
  textGeometry?: TextGeometry | null
  /** Yazı tipi eşlemesi bozuk metin oranı (pdfScene) */
  garbledText?: number
  /** Gömülü görüntü bölgeleri (pdfScene) */
  imageBoxes?: BBox[]
  /** Sayfa boyutu (pt) — görüntü bölgesinin önemini değerlendirmek için */
  pageSize?: { w: number; h: number }
}

const PAIR_DIST = 3.2 // etiket yüksekliği katı
const GENERAL_NOTE = /AKSI BELIRTILMEDIK|TUM DOGRAMA|BUTUN DOGRAMA|DOGRAMALAR(IN)? (TAMAMI|HEPSI)|GENEL NOT|PENCERE(LER)? .*(PVC|ALUMINYUM)/

const bboxOverlap = (a: BBox, b: BBox) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const ar = Math.max(1e-6, Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])))
  return (ix * iy) / ar
}

const isGarbled = (t: string) => /[\u0000-\u0008\u000e-\u001f\ue000-\uf8ff\ufffd]/.test(t) || (t.length >= 3 && (t.match(/[\p{L}\p{N}]/gu) ?? []).length / t.length < 0.3)

/** OCR yazılarına, altındaki çizgi-harf nesnelerini bağlar (görüntüleyicide vurgulama için) */
function attachGlyphIds(runs: TextRun[], scene: Scene): void {
  const C = 20
  const grid = new Map<string, number[]>()
  for (const e of scene.entities) {
    if (e.layer !== GLYPH_LAYER) continue
    const cx = (e.bbox[0] + e.bbox[2]) / 2
    const cy = (e.bbox[1] + e.bbox[3]) / 2
    const k = `${Math.floor(cx / C)},${Math.floor(cy / C)}`
    const arr = grid.get(k)
    if (arr) arr.push(e.id)
    else grid.set(k, [e.id])
  }
  if (!grid.size) return
  for (const r of runs) {
    if (r.ocr == null || r.ids.length) continue
    const b = r.bbox
    const ids: number[] = []
    for (let gx = Math.floor((b[0] - 1) / C); gx <= Math.floor((b[2] + 1) / C); gx++)
      for (let gy = Math.floor((b[1] - 1) / C); gy <= Math.floor((b[3] + 1) / C); gy++)
        for (const id of grid.get(`${gx},${gy}`) ?? []) {
          const e = scene.entities[id]
          const cx = (e.bbox[0] + e.bbox[2]) / 2
          const cy = (e.bbox[1] + e.bbox[3]) / 2
          if (cx >= b[0] - 1 && cx <= b[2] + 1 && cy >= b[1] - 1 && cy <= b[3] + 1) ids.push(id)
        }
    r.ids = ids
  }
}

const fracValue = (t: string) => {
  const s = t.trim()
  if (/^\d{2,4}$/.test(s)) {
    const v = Number(s)
    return v >= 25 && v <= 2000 ? s : null
  }
  return /^\d[.,]\d{2}$/.test(s) ? s : null
}

/**
 * Kesirli (üst üste) ölçü etiketi: "180" üstte, kesir çizgisi, "150" altta → "180/150".
 * Ölçü zincirlerindeki sayılarla karışmaması için kesir çizgisi aranır; çizgisi olmayan
 * (taranmış) sayfalarda yakında bir poz kodu bulunmalıdır.
 */
export function stackedFractions(runs: TextRun[], segs: Segs, used: Set<TextRun>): { run: TextRun; parts: [TextRun, TextRun] }[] {
  const flat = runs.filter((r) => !used.has(r) && Math.abs(normAngle(r.angle)) < 0.02 && fracValue(r.text))
  if (flat.length < 2) return []
  const codes = runs.filter((r) => parsePozLabel(r.ocr != null ? fixOcrText(r.text) : r.text))
  const cand: { a: TextRun; b: TextRun; d: number }[] = []
  for (const a of flat)
    for (const b of flat) {
      if (a === b) continue
      const h = Math.max(a.height, b.height)
      const [ax, ay] = runCenter(a)
      const [bx, by] = runCenter(b)
      const dy = ay - by
      if (dy < 1.05 * h || dy > 3.4 * h || Math.abs(ax - bx) > 0.8 * h + 0.25 * Math.max(a.width, b.width)) continue
      let bar = false
      if (segs.n) {
        for (const i of segsNear(segs, (ax + bx) / 2, (ay + by) / 2, 3 * h)) {
          if (Math.abs(segs.y2[i] - segs.y1[i]) > 0.05 * segs.len[i]) continue
          const y = (segs.y1[i] + segs.y2[i]) / 2
          if (y > a.bbox[1] + 0.6 || y < b.bbox[3] - 0.6) continue
          const x0 = Math.min(segs.x1[i], segs.x2[i])
          const x1 = Math.max(segs.x1[i], segs.x2[i])
          const ov = Math.min(x1, Math.max(a.bbox[2], b.bbox[2])) - Math.max(x0, Math.min(a.bbox[0], b.bbox[0]))
          if (ov >= 0.5 * Math.min(a.width, b.width) && segs.len[i] <= 4 * Math.max(a.width, b.width) + 10) {
            bar = true
            break
          }
        }
      } else {
        bar = codes.some((c) => Math.hypot(runCenter(c)[0] - ax, runCenter(c)[1] - ay) <= 4 * h + c.width)
      }
      if (bar) cand.push({ a, b, d: dy })
    }
  cand.sort((p, q) => p.d - q.d)
  const taken = new Set<TextRun>()
  const out: { run: TextRun; parts: [TextRun, TextRun] }[] = []
  for (const { a, b } of cand) {
    if (taken.has(a) || taken.has(b)) continue
    taken.add(a)
    taken.add(b)
    out.push({
      parts: [a, b],
      run: {
        text: `${a.text.trim()}/${b.text.trim()}`,
        angle: 0,
        height: Math.max(a.height, b.height),
        ox: Math.min(a.ox, b.ox),
        oy: b.oy,
        width: Math.max(a.width, b.width),
        bbox: bboxUnion(a.bbox, b.bbox),
        ids: [...a.ids, ...b.ids],
        ocr: a.ocr != null || b.ocr != null ? Math.min(a.ocr ?? 1, b.ocr ?? 1) : undefined,
      },
    })
  }
  return out
}

export function analyzePage(input: PageInput): PdfPageAnalysis {
  const vector = input.scene ? extractRuns(input.scene) : []
  const garbled = input.garbledText ?? 0
  let runs: TextRun[] = vector
  let keptVector = vector.length
  if (input.ocrRuns) {
    // Bozuk eşlemeli yazılar atılır; vektör yazıyla aynı yerdeki OCR yazısı tekrar sayılmaz
    const keep = garbled > 0.4 ? vector.filter((r) => !isGarbled(r.text)) : vector
    keptVector = keep.length
    const extra = input.ocrRuns.filter((o) => !keep.some((v) => bboxOverlap(v.bbox, o.bbox) > 0.4))
    runs = [...keep, ...extra]
    if (input.scene && input.textGeometry) attachGlyphIds(runs, input.scene)
  }
  const segs = segmentIndex(input.kind === 'taranmis' ? null : input.scene)
  const notes: string[] = []
  const rects: BBox[] = input.scene
    ? input.scene.entities.filter((e) => e.rect && e.layer !== GLYPH_LAYER && Math.abs(Math.sin(2 * e.rect.angle)) < 0.01).map((e) => e.bbox)
    : []
  const { sheet: titleSheet, title } = classifySheet(runs)
  const { rows: schedule, used } = parseSchedules(input.page, runs)
  const sb = input.scene?.bbox ?? null
  const extent = input.pageSize ?? (sb ? { w: sb[2] - sb[0], h: sb[3] - sb[1] } : { w: 1200, h: 850 })
  const cards = parseCards(runs, segs, rects, used, Math.max(extent.w, extent.h))
  for (const c of cards) {
    schedule.push({
      page: input.page,
      code: c.code,
      description: c.texts.join(' · '),
      kind: c.typeText,
      material: c.materialText,
      w_mm: c.dims?.w_mm ?? null,
      h_mm: c.dims?.h_mm ?? null,
      quantity: c.quantity,
      unit: c.dims?.unit ?? 'cm',
      text: [c.anchor.text, ...c.runs.map((r) => r.text)].join(' | '),
      bbox: cardBox(c),
      ids: [...c.anchor.ids, ...c.runs.flatMap((r) => r.ids), ...(c.elevation?.segmentIds ?? [])],
      ocr: c.ocr,
      source: 'kart',
      texts: c.texts,
      elevation: c.elevation,
      dimsFrom: c.dimsFrom,
      drawingScale: c.drawingScale,
      dimsConflict: c.dimsConflict,
    })
  }
  if (cards.length) notes.push(`Kart tipi doğrama listesi: ${cards.length} kart okundu`)
  const sheet: SheetType = schedule.length && (titleSheet === 'bilinmiyor' || titleSheet === 'detay') ? 'cizelge' : titleSheet

  // Ölçek
  const hints = findScaleHints(runs.map((r) => r.text))
  const titleDen = hints.length === 1 ? hints[0].denominator : (hints.find((h) => /OLCEK|SCALE/.test(normalizeKey(h.text)))?.denominator ?? null)
  const inferred = segs.n ? inferScale(runs.filter((r) => !used.has(r)), segs) : null
  let used_: number | null = null
  let usedFrom: PageScale['usedFrom'] = null
  if (input.userDenominator) {
    used_ = input.userDenominator
    usedFrom = 'kullanici'
  } else if (inferred) {
    used_ = inferred.denominator
    usedFrom = 'olcu'
  } else if (titleDen) {
    used_ = titleDen
    usedFrom = 'antet'
  }
  let conflict: string | null = null
  if (titleDen && inferred && titleDen !== inferred.denominator)
    conflict = `Antette ölçek 1/${titleDen} yazıyor, ölçü yazıları ise 1/${inferred.denominator} ile uyumlu (${inferred.support}/${inferred.total}). Pafta ölçeklenerek basılmış olabilir.`
  if (hints.length > 1 && !titleDen) notes.push(`Sayfada birden fazla ölçek yazısı var: ${hints.map((h) => `1/${h.denominator}`).join(', ')}`)
  const verified = usedFrom === 'kullanici' || (usedFrom === 'olcu' && !conflict)

  // Kesirli etiketler ("180" / "150")
  const fractions = stackedFractions(runs, segs, used)
  const fracParts = new Set(fractions.flatMap((f) => f.parts))

  // Etiketler (çizelgede/kartta kullanılan yazılar hariç)
  type Tok = { run: TextRun; code: string | null; dims: DimLabel | null }
  const toks: Tok[] = []
  let numericCount = 0
  for (const r of [...runs.filter((x) => !fracParts.has(x)), ...fractions.map((f) => f.run)]) {
    if (used.has(r)) continue
    if (isNumeric(r.text)) numericCount++
    const { code, dims } = splitCodeDims(r.ocr != null ? fixOcrText(r.text) : r.text)
    if (code || dims) toks.push({ run: r, code, dims: dims && fractions.some((f) => f.run === r) ? { ...dims, stacked: true } : dims })
  }
  // Kod + ölçü eşleştirme (en yakın, her biri bir kez)
  const codesOnly = toks.filter((t) => t.code && !t.dims)
  const dimsOnly = toks.filter((t) => t.dims && !t.code)
  const pairs: { code: Tok | null; dims: Tok | null }[] = toks.filter((t) => t.code && t.dims).map((t) => ({ code: t, dims: t }))
  const cand: { c: Tok; d: Tok; dist: number }[] = []
  for (const c of codesOnly)
    for (const d of dimsOnly) {
      const [x1, y1] = runCenter(c.run)
      const [x2, y2] = runCenter(d.run)
      const dist = Math.hypot(x2 - x1, y2 - y1)
      if (dist <= PAIR_DIST * Math.max(c.run.height, d.run.height) + 0.5 * Math.max(c.run.width, d.run.width)) cand.push({ c, d, dist })
    }
  cand.sort((a, b) => a.dist - b.dist)
  const takenC = new Set<Tok>()
  const takenD = new Set<Tok>()
  for (const p of cand) {
    if (takenC.has(p.c) || takenD.has(p.d)) continue
    takenC.add(p.c)
    takenD.add(p.d)
    pairs.push({ code: p.c, dims: p.d })
  }
  for (const c of codesOnly) if (!takenC.has(c)) pairs.push({ code: c, dims: null })
  for (const d of dimsOnly) if (!takenD.has(d)) pairs.push({ code: null, dims: d })

  const scheduleCodes = new Set(schedule.map((r) => canonCode(r.code)))
  const rooms = sheet === 'plan' || sheet === 'bilinmiyor' ? runs.filter((r) => isRoomName(r.text)) : []
  const hits: LabelHit[] = []
  for (const p of pairs) {
    const code = p.code?.code ?? null
    const dims = p.dims?.dims ?? null
    // Ölçüsüz tek başına kod: yalnız bilinen doğrama önekiyse (oda/aks/pafta numaralarını ayıklamak için)
    if (code && !dims && !KNOWN_PREFIX.test(code) && !scheduleCodes.has(canonCode(code))) continue
    const runsUsed = [p.code?.run, p.dims?.run].filter((r): r is TextRun => !!r)
    const bbox = runsUsed.reduce((b, r) => bboxUnion(b, r.bbox), EMPTY_BBOX())
    // Yakındaki tür/malzeme kelimeleri (ör. "PVC", "SÜRME")
    const [cx, cy] = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
    const hh = Math.max(...runsUsed.map((r) => r.height))
    const near = runs
      .filter((r) => !runsUsed.includes(r) && !used.has(r) && r.text.length <= 40 && Math.hypot(runCenter(r)[0] - cx, runCenter(r)[1] - cy) <= 3 * hh)
      .map((r) => r.text)
      .filter((t) => inferType([t]).type || inferType([t]).material || OTHER_MATERIAL.test(normalizeKey(t)))
    let room: string | null = null
    let best = 320
    for (const r of rooms) {
      const d = Math.hypot(runCenter(r)[0] - cx, runCenter(r)[1] - cy)
      if (d < best) {
        best = d
        room = roomLabel(r.text)
      }
    }
    hits.push({
      page: input.page,
      sheet,
      code,
      dims,
      text: runsUsed.map((r) => r.text).join(' '),
      bbox,
      ids: runsUsed.flatMap((r) => r.ids),
      near,
      geometry: null,
      ocr: runsUsed.some((r) => r.ocr != null),
      room,
    })
  }

  // Geometri doğrulaması (yalnız planda: genişlik plan görünüşünde açıklık olarak çizilir)
  for (const h of hits) if (sheet === 'plan' || sheet === 'bilinmiyor' || sheet === 'gorunus') h.geometry = segs.n ? checkGeometry(h, segs, used_) : null
  // Görünüş paftası: etiketin hemen altındaki doğrama çizimi (açılım sembolleri)
  if (sheet === 'gorunus' && segs.n)
    for (const h of hits) {
      const hh = h.bbox[3] - h.bbox[1]
      const cx = (h.bbox[0] + h.bbox[2]) / 2
      let frame: BBox | null = null
      for (const r of rects) {
        if (r[3] > h.bbox[1] + 1 || h.bbox[1] - r[3] > 2.5 * hh + 6 || cx < r[0] || cx > r[2]) continue
        if (!frame || r[2] - r[0] > frame[2] - frame[0]) frame = r
      }
      if (frame) h.elevation = analyzeElevation(segs, frame)
    }

  // Genel notlar (tüm doğramalar için)
  const generalNotes = runs.filter((r) => !used.has(r) && r.text.length >= 12 && r.text.length <= 240 && GENERAL_NOTE.test(normalizeKey(r.text))).map((r) => r.text)

  // OCR gereksinimi
  const pageArea = extent.w * extent.h
  const bigImages = (input.imageBoxes ?? []).filter((b) => b[2] - b[0] >= 80 && b[3] - b[1] >= 40 && ((b[2] - b[0]) * (b[3] - b[1])) / Math.max(1, pageArea) >= 0.03)
  let ocrNeeded: string | null = null
  if (input.kind === 'taranmis') ocrNeeded = 'Sayfa taranmış görüntü; yazılar yalnız OCR ile okunabilir'
  else if (input.textGeometry) ocrNeeded = `Yazılar metin değil çizgi olarak gömülü (AutoCAD SHX yazı tipi vb., ${input.textGeometry.paths.toLocaleString('tr-TR')} harf parçası)`
  else if (garbled > 0.4) ocrNeeded = `Yazı tipi eşlemesi bozuk: yazıların %${Math.round(garbled * 100)}'i okunamıyor`
  else if (bigImages.length) ocrNeeded = `Sayfada görüntü olarak gömülü ${bigImages.length} bölüm var (çizelge veya taranmış pafta olabilir)`
  if (ocrNeeded && !input.ocrRuns) notes.push(`OCR gerekli: ${ocrNeeded}`)

  const textSource: PdfPageAnalysis['textSource'] = input.ocrRuns ? (keptVector ? 'vektor+ocr' : 'ocr') : runs.length ? 'vektor' : 'yok'
  const samples = [...new Set(runs.map((r) => r.text))].slice(0, 40)
  return {
    page: input.page,
    kind: input.kind,
    sheet,
    title,
    textSource,
    textCount: runs.length,
    numericCount,
    labelCount: hits.length,
    scheduleRows: schedule.length,
    segments: segs.n,
    scale: { title: titleDen, inferred, used: used_, usedFrom, conflict, verified },
    samples,
    notes,
    hits,
    schedule,
    floor: floorInfo(title),
    generalNotes,
    textAsGeometry: !!input.textGeometry,
    garbledText: garbled,
    ocrNeeded,
    cardCount: cards.length,
  }
}

// ------------------------------------------------------------------ birleştirme

const COUNTED: SheetType[] = ['plan', 'bilinmiyor']

function level(conf: number): PozCandidate['level'] {
  return conf >= 0.75 ? 'yuksek' : conf >= 0.5 ? 'orta' : 'dusuk'
}

const fmtCm = (mm: number) => (mm % 10 === 0 ? String(mm / 10) : (mm / 10).toFixed(1))
const fmtDims = (w: number, h: number) => `${fmtCm(w)}/${fmtCm(h)}`

export interface AggregateOptions {
  pageCount: number
  skippedPages?: { page: number; reason: string }[]
  ocrUsed?: boolean
}

const MATERIAL_OF: Record<string, Material> = { PVC: 'pvc', Alüminyum: 'aluminyum' }

function sameSet(a: string[], b: string[]): boolean {
  const A = new Set(a)
  const B = new Set(b)
  return A.size === B.size && [...A].every((x) => B.has(x))
}

export function aggregatePdf(pages: PdfPageAnalysis[], opts: AggregateOptions): { candidates: PdfPozCandidate[]; diagnostics: PdfDiagnostics } {
  type Group = { key: string; canon: string | null; codes: Map<string, number>; hits: LabelHit[]; rows: ScheduleRow[] }
  const groups = new Map<string, Group>()
  const g = (key: string, canon: string | null) => {
    let x = groups.get(key)
    if (!x) {
      x = { key, canon, codes: new Map(), hits: [], rows: [] }
      groups.set(key, x)
    }
    return x
  }
  const pageOf = new Map(pages.map((p) => [p.page, p]))
  for (const p of pages) {
    for (const r of p.schedule) {
      const c = canonCode(r.code)
      const grp = g(`K:${c}`, c)
      grp.rows.push(r)
      grp.codes.set(r.code, (grp.codes.get(r.code) ?? 0) + 100)
    }
    for (const h of p.hits) {
      if (h.code) {
        const c = canonCode(h.code)
        const grp = g(`K:${c}`, c)
        grp.hits.push(h)
        grp.codes.set(h.code, (grp.codes.get(h.code) ?? 0) + 1)
      } else if (h.dims) g(`O:${h.dims.w_mm}x${h.dims.h_mm}`, null).hits.push(h)
    }
  }
  const generalNotes: AttrText[] = pages.flatMap((p) => p.generalNotes.map((t) => ({ text: t, origin: `S${p.page} · genel not`, direct: false, ocr: p.textSource !== 'vektor' })))

  const candidates: PdfPozCandidate[] = []
  for (const grp of groups.values()) {
    const reasons: string[] = []
    const evidence: string[] = []
    const conflicts: PozConflict[] = []
    // Gösterilen kod: çizelgedeki yazım, yoksa en sık yazım
    const variants = [...grp.codes.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
    const displayCode = variants[0] ?? null
    const label = displayCode ? `Poz ${displayCode}` : 'Poz'
    if (variants.length > 1) evidence.push(`Aynı poz farklı yazılmış: ${variants.join(', ')} (eşleştirildi)`)
    const rows = [...grp.rows].sort((a, b) => (a.source === b.source ? a.page - b.page : a.source === 'tablo' ? -1 : 1))
    const row = rows[0] ?? null
    const listName = row?.source === 'kart' ? 'doğrama listesinde' : 'doğrama çizelgesinde'
    if (rows.length > 1) {
      const qs = new Set(rows.map((r) => r.quantity))
      const ds = new Set(rows.map((r) => `${r.w_mm}x${r.h_mm}`))
      if (qs.size > 1) conflicts.push({ kind: 'adet', message: `${label}: çizelgelerde farklı adetler var (${rows.map((r) => `S${r.page}: ${r.quantity ?? '—'}`).join(', ')}).` })
      if (ds.size > 1) conflicts.push({ kind: 'olcu', message: `${label}: çizelgelerde farklı ölçüler var (${rows.map((r) => `S${r.page}: ${r.w_mm && r.h_mm ? fmtDims(r.w_mm, r.h_mm) : '—'}`).join(', ')}).` })
    }
    // Sayım: plan paftaları; görünüş/kesit/detay sayılmaz
    const counted = grp.hits.filter((h) => COUNTED.includes(h.sheet))
    const elev = grp.hits.filter((h) => h.sheet === 'gorunus')
    const otherNot = grp.hits.filter((h) => !COUNTED.includes(h.sheet) && h.sheet !== 'gorunus')
    // Aynı açıklığa bağlanan iki etiket bir kez sayılır
    const seenGeom = new Map<string, LabelHit>()
    const instHits: LabelHit[] = []
    let geomDupes = 0
    for (const h of counted) {
      const gid = h.geometry?.status === 'uyumlu' ? `${h.page}:${h.geometry.segmentIds.slice().sort((a, b) => a - b).join(',')}` : null
      if (gid && seenGeom.has(gid)) {
        geomDupes++
        continue
      }
      if (gid) seenGeom.set(gid, h)
      instHits.push(h)
    }
    if (geomDupes) evidence.push(`${geomDupes} etiket aynı açıklığı gösterdiği için bir kez sayıldı`)
    // Kat çarpanı: "NORMAL KAT PLANI (1.-4. KATLAR)" → o paftadaki sayım × 4
    const perPage = new Map<number, number>()
    for (const h of instHits) perPage.set(h.page, (perPage.get(h.page) ?? 0) + 1)
    let planRaw = 0
    let planMult = 0
    const multParts: string[] = []
    let floorMultiplier: number | null = null
    for (const [pn, n] of perPage) {
      const m = pageOf.get(pn)?.floor.multiplier ?? null
      planRaw += n
      planMult += n * (m ?? 1)
      if (m) {
        floorMultiplier = m
        multParts.push(`S${pn} (${pageOf.get(pn)?.title ?? 'plan'}): ${n} × ${m} kat = ${n * m}`)
      }
    }
    let planQty: number | null = instHits.length ? planMult : null
    const multText = multParts.length ? ` (${multParts.join('; ')})` : ''
    let fromElevation = false
    if (!planQty && elev.length && !row) {
      planQty = elev.length
      fromElevation = true
    }
    const scheduleQty = row?.quantity ?? null

    // Ölçüler: çizelge/kart > etiket çoğunluğu
    const dimVotes = new Map<string, { d: DimLabel; n: number }>()
    for (const h of grp.hits)
      if (h.dims) {
        const k = `${h.dims.w_mm}x${h.dims.h_mm}`
        const v = dimVotes.get(k) ?? { d: h.dims, n: 0 }
        v.n++
        dimVotes.set(k, v)
      }
    const dimList = [...dimVotes.values()].sort((a, b) => b.n - a.n)
    let w: number | null = null
    let hgt: number | null = null
    let dimsFrom: PdfPozCandidate['dimsFrom'] = null
    if (row?.w_mm && row.h_mm) {
      w = row.w_mm
      hgt = row.h_mm
      dimsFrom = row.source === 'kart' ? 'kart' : 'cizelge'
      const how = row.source === 'kart' ? (row.dimsFrom === 'olcu_cizgisi' ? 'kartın ölçü çizgilerinden' : 'kart yazısından') : 'çizelgeden'
      evidence.push(`Ölçü ${how}: ${fmtDims(w, hgt)} cm (sayfa ${row.page})`)
      if (row.drawingScale) evidence.push(`Görünüş çizimi 1/${row.drawingScale} ölçekte; ölçü yazıları kasa boyutuyla uyumlu`)
      if (row.dimsConflict) conflicts.push({ kind: 'olcu', message: `${label}: ${row.dimsConflict}.` })
      const disagree = dimList.filter((x) => x.d.w_mm !== w || x.d.h_mm !== hgt)
      if (disagree.length)
        conflicts.push({ kind: 'olcu', message: `${label}: ${listName} ${fmtDims(w, hgt)}, plan etiketinde ${disagree.map((x) => `${x.d.text} (${x.n})`).join(', ')} yazıyor.` })
      else if (dimList.length) evidence.push('Plan etiketleri çizelge ölçüsüyle aynı')
    } else if (dimList.length) {
      w = dimList[0].d.w_mm
      hgt = dimList[0].d.h_mm
      dimsFrom = 'etiket'
      evidence.push(`Ölçü etiketten: ${dimList[0].d.text}${unitSuffix(dimList[0].d.unit)}${dimList[0].d.stacked ? ', kesirli yazım' : ''}`)
      if (dimList.length > 1) conflicts.push({ kind: 'olcu', message: `${label}: aynı poz farklı ölçülerle yazılmış: ${dimList.map((x) => `${x.d.text} ×${x.n}`).join(', ')} — en sık olan gösterildi.` })
    } else {
      reasons.push('Ölçü bulunamadı: en ve boy elle girilmeli')
    }
    const extra = dimList.find((x) => x.d.extra != null)?.d.extra
    if (extra != null) evidence.push(`Etikette üçüncü değer ${extra} (parapet/denizlik yüksekliği olabilir; metraja katılmadı)`)

    // Adet
    let count: number
    if (scheduleQty != null) {
      count = scheduleQty
      evidence.push(`Adet ${row?.source === 'kart' ? 'doğrama listesinden' : 'çizelgeden'}: ${scheduleQty}${row?.floors ? ` (${row.floors.map((f) => `${f.label}: ${f.qty}`).join(', ')})` : ''}`)
      if (planQty != null && planQty !== scheduleQty) {
        conflicts.push({ kind: 'adet', message: `${label}: Plan paftalarında ${planQty} adet${multText}, ${listName} ${scheduleQty} adet bulunuyor.` })
        if (floorMultiplier && planRaw === scheduleQty) reasons.push(`Kat çarpanı uygulanmadan plan sayımı (${planRaw}) çizelgeyle aynı; çarpanın geçerli olup olmadığını kontrol edin`)
      } else if (planQty != null) evidence.push(`Planlarda ${planQty} etiket${multText}: çizelgeyle uyumlu`)
      else reasons.push('Planlarda bu poza ait etiket bulunamadı; adet yalnız çizelgeden')
    } else if (planQty != null) {
      count = planQty
      evidence.push(`${planQty} adet ${fromElevation ? 'görünüş' : 'plan'} etiketi sayıldı${multText}`)
      if (floorMultiplier) reasons.push(`Pafta başlığına göre plan ${floorMultiplier} kat için geçerli; sayım kat sayısıyla çarpıldı (${planRaw} × ${floorMultiplier}) — çizelge olmadığından doğrulanamadı`)
      if (fromElevation) reasons.push('Yalnız görünüş paftasında bulundu; plan ile doğrulanmadı (aynı doğrama birden fazla görünüşte olabilir)')
    } else {
      count = 1
      reasons.push('Adet belirlenemedi (yalnız görünüş/kesit/detayda geçiyor); 1 varsayıldı — kontrol edin')
    }
    if (elev.length && !fromElevation) evidence.push(`Görünüşteki ${elev.length} etiket sayılmadı (çift sayım önlendi)`)
    if (otherNot.length) evidence.push(`Kesit/detaydaki ${otherNot.length} etiket sayılmadı`)
    const tipKat = counted.some((h) => !pageOf.get(h.page)?.floor.multiplier && /NORMAL KAT|TIP KAT/.test(normalizeKey(pageOf.get(h.page)?.title ?? '')))
    if (tipKat) reasons.push('Normal/tip kat planı: kaç kat için geçerli olduğu yazmıyor; adet kat sayısıyla çarpılmalı olabilir — kontrol edin')

    // Teknik özellikler
    const texts: AttrText[] = []
    for (const r of rows) {
      const origin = `S${r.page} · ${r.source === 'kart' ? 'kart' : 'çizelge satırı'} ${r.code}`
      for (const t of r.texts?.length ? r.texts : [r.kind ?? '', r.material ?? '', r.description].filter(Boolean)) texts.push({ text: t, origin, direct: true, ocr: r.ocr })
    }
    for (const h of grp.hits) for (const t of h.near) texts.push({ text: t, origin: `S${h.page} · ${h.code ?? h.text} etiketi yanında`, direct: false, ocr: h.ocr })
    texts.push(...generalNotes)
    const attrs = extractAttributes(texts)
    const elevation = row?.elevation ?? grp.hits.find((h) => h.elevation)?.elevation ?? null
    if (elevation) {
      const src = `S${row?.elevation ? row.page : grp.hits.find((h) => h.elevation)!.page} · görünüş çizimi`
      const codes = [...new Set(elevation.panels.map((p) => p.opening))]
      const textual = attrs.acilim?.status === 'dogrulandi' ? openingCodes(attrs.acilim.value)?.codes ?? null : null
      if (textual && !sameSet(textual, codes)) conflicts.push({ kind: 'acilim', message: `${label}: yazıda "${attrs.acilim!.value}", görünüş çiziminde "${elevation.summary}" görünüyor.` })
      else if (textual) evidence.push(`Görünüş çizimindeki açılım sembolleri yazıyla uyumlu (${elevation.summary})`)
      suggestAttr(attrs, 'acilim', elevation.summary, `${src} (açılım sembolleri)`)
      attrs.bolme = { value: `${elevation.cols} × ${elevation.rows} bölme: ${elevation.panels.map((p) => PANEL_LABEL[p.opening]).join(', ')}`, status: 'aday', source: `${src} (kayıtlar ve semboller)` }
      if (elevation.sashCount) suggestAttr(attrs, 'kanat', String(elevation.sashCount), `${src} (açılır/sürme bölmeler)`)
    }
    // Kat ve mahal
    const floorCounts = new Map<string, number>()
    for (const h of instHits) {
      const p = pageOf.get(h.page)
      const f = p?.floor.label ?? null
      if (!f) continue
      const k = p?.floor.multiplier ? `${f} (×${p.floor.multiplier})` : f
      floorCounts.set(k, (floorCounts.get(k) ?? 0) + 1)
    }
    if (row?.floors?.length) attrs.kat = { value: row.floors.map((f) => `${f.label}: ${f.qty}`).join(' · '), status: row.ocr ? 'aday' : 'dogrulandi', source: `S${row.page} · çizelge kat sütunları` }
    else if (floorCounts.size) attrs.kat = { value: [...floorCounts].map(([k, n]) => `${k}: ${n}`).join(' · '), status: 'dogrulandi', source: 'Pafta başlıkları' }
    const roomCounts = new Map<string, number>()
    for (const h of instHits) if (h.room) roomCounts.set(h.room, (roomCounts.get(h.room) ?? 0) + 1)
    if (roomCounts.size) attrs.mahal = { value: [...roomCounts].map(([k, n]) => (n > 1 ? `${k} (${n})` : k)).join(', '), status: 'aday', source: 'En yakın mahal yazısı (planda)' }

    // Tür ve malzeme: çizelge/kart açıklaması > etiket yanındaki yazı > kod öneki > ölçü
    // Açılım yazıları ("AÇILIM: SABİT + AÇILIR") türü belirlemez
    const notOpening = (t: string) => !/^\s*(AÇILIM|ACILIM|AÇILIŞ|ACILIS)(\s+(TÜRÜ|TURU))?\s*[:=]/i.test(t)
    const inf = inferType([row?.kind ?? '', ...rows.flatMap((r) => r.texts ?? []), row?.material ?? '', ...grp.hits.flatMap((h) => h.near), row?.source === 'kart' ? '' : (row?.description ?? '')].filter(Boolean).filter(notOpening))
    let type: TypeHint | null = inf.type
    let typeWhy = inf.type ? `metin: ${inf.sources[0]}` : ''
    if (!type && grp.canon) {
      type = typeFromCode(displayCode ?? grp.canon)
      if (type) typeWhy = `kod öneki (${displayCode})`
    }
    if (!type && w && hgt) {
      type = hgt >= 1900 && w <= 4000 ? 'kapi' : 'pencere'
      typeWhy = 'ölçüden tahmin'
    }
    const matAttr = attrs.malzeme ?? null
    const material: Material | null = matAttr ? (MATERIAL_OF[matAttr.value] ?? null) : null
    const outOfScope = matAttr && !material ? `Malzeme ${matAttr.value.toLocaleLowerCase('tr-TR')}: alüminyum/PVC kapsamı dışında olabilir` : null
    let category = categoryFor(type, material)
    if (outOfScope) {
      category = 'belirsiz'
      reasons.push(outOfScope)
    }
    if (type) evidence.push(`Tür: ${type} (${typeWhy})`)
    if (typeWhy === 'ölçüden tahmin' || typeWhy.startsWith('kod')) reasons.push('Doğrama türü yazıyla belirtilmemiş; tahmin edildi')
    if (material && matAttr) {
      if (matAttr.status === 'dogrulandi') evidence.push(`Malzeme (${matAttr.value}) pozun kendi yazısından okundu`)
      else reasons.push(`Malzeme (${matAttr.value}) ${/genel not/.test(matAttr.source) ? 'genel nottan' : 'yakındaki yazıdan/OCR ile'} alındı; onaylayın`)
    } else if (!outOfScope && (type === 'pencere' || type === 'kapi')) reasons.push('Malzeme (PVC / alüminyum) yazılmamış: iş grubu seçilmeli')

    // Geometri
    const geo = counted.map((h) => h.geometry).filter((x): x is GeometryCheck => !!x)
    const ok = geo.filter((x) => x.status === 'uyumlu').length
    const notFound = geo.filter((x) => x.status === 'bulunamadi').length
    const noScale = geo.filter((x) => x.status === 'olcek_yok').length
    if (ok) evidence.push(`${ok} etikette çizimdeki açıklık genişliği yazıyla uyumlu (ölçek 1/${geo.find((x) => x.status === 'uyumlu')!.denominator})`)
    if (notFound) reasons.push(`${notFound} etiketin yanında yazılan genişlikte açıklık çizgisi bulunamadı`)
    if (noScale && !ok) reasons.push('Çizim ölçeği bilinmediği için yazılan ölçü geometriyle karşılaştırılamadı')
    if (dimsFrom === 'etiket' && hgt) reasons.push('Yükseklik plandan ölçülemez; yalnız etiket yazısından alındı')

    // OCR
    const ocr = grp.hits.some((h) => h.ocr) || grp.rows.some((r) => r.ocr)
    if (ocr) reasons.push('Yazılar görüntüden OCR ile okundu: rakamları çizimle karşılaştırın')

    // Güven
    let conf: number
    if (row && planQty != null) conf = planQty === scheduleQty ? 0.85 : 0.5
    else if (row) conf = 0.62
    else if (grp.canon && dimsFrom) conf = 0.68
    else if (dimsFrom) conf = 0.55
    else conf = 0.3
    if (ok && !notFound) conf += 0.05
    if (notFound) conf -= 0.1 * Math.min(1, notFound / Math.max(1, geo.length)) + 0.05
    if (dimList.length > 1) conf -= 0.1
    if (conflicts.length) conf -= 0.08 * Math.min(3, conflicts.length)
    if (ocr) conf -= 0.12
    if (fromElevation) conf -= 0.1
    if (floorMultiplier && scheduleQty == null) conf -= 0.08
    if (category === 'belirsiz') conf = Math.min(conf, 0.7)
    conf = Math.max(0.05, Math.min(0.95, conf))

    // Örnekler (vurgulama / konum)
    const instances: PozInstance[] = instHits.map((h) => ({
      entityIds: [...h.ids, ...(h.geometry?.segmentIds ?? [])],
      insertId: null,
      bbox: h.geometry?.bbox ? bboxUnion(h.bbox, h.geometry.bbox) : h.bbox,
      handle: null,
      page: h.page,
      role: 'plan',
    }))
    if (fromElevation) for (const h of elev) instances.push({ entityIds: h.ids, insertId: null, bbox: h.bbox, handle: null, page: h.page, role: 'gorunus' })
    for (const r of rows) instances.push({ entityIds: r.ids, insertId: null, bbox: r.bbox, handle: null, page: r.page, role: 'cizelge' })
    if (!instances.length) for (const h of grp.hits.slice(0, 20)) instances.push({ entityIds: h.ids, insertId: null, bbox: h.bbox, handle: null, page: h.page, role: h.sheet === 'gorunus' ? 'gorunus' : 'diger' })

    const code = displayCode ?? (w && hgt ? fmtDims(w, hgt) : '?')
    const pageSet = [...new Set([...grp.hits.map((h) => h.page), ...grp.rows.map((r) => r.page)])].sort((a, b) => a - b)
    const sheets = [
      ...new Set(
        pageSet.map((pn) => {
          const p = pageOf.get(pn)
          return `S${pn} · ${p?.title ?? SHEET_LABEL[p?.sheet ?? 'bilinmiyor']}`
        }),
      ),
    ]
    candidates.push({
      key: `pdf:${grp.key}`,
      code,
      label: row?.description || null,
      source: row ? 'cizelge' : 'etiket',
      block: null,
      layer: sheets[0] ?? '',
      count,
      instances,
      shape: 'dikdortgen',
      width_mm: w,
      height_mm: hgt,
      height2_mm: null,
      vertices: null,
      manual_area_m2: null,
      typeHint: type,
      material,
      category,
      confidence: Math.round(conf * 100) / 100,
      level: level(conf),
      reasons: [...new Set(reasons)],
      evidence: [...new Set(evidence)],
      duplicatesRemoved: elev.length + otherNot.length + geomDupes,
      dims: geo
        .filter((x) => x.status === 'uyumlu' && x.measured_mm != null)
        .slice(0, 1)
        .map((x) => ({ value: w ? fmtCm(w) : '', geometricMm: x.measured_mm!, axis: 'w' as const, matches: w != null && Math.abs(x.measured_mm! - w) <= Math.max(15, 0.03 * w) })),
      pages: pageSet,
      sheets,
      scheduleQty,
      planQty,
      dimsFrom,
      outOfScope,
      attrs: withMissing(attrs),
      conflicts,
      floorMultiplier,
      elevation,
      canon: grp.canon ?? grp.key,
      codeVariants: variants,
    })
  }
  // Sıralama: çizelgedekiler önce, sonra kod (doğal)
  candidates.sort((a, b) => (a.source === b.source ? 0 : a.source === 'cizelge' ? -1 : 1) || a.code.localeCompare(b.code, 'tr', { numeric: true }))

  // ---------------------------------------------------------------- tanılama
  const totals = {
    texts: pages.reduce((s, p) => s + p.textCount, 0),
    numeric: pages.reduce((s, p) => s + p.numericCount, 0),
    labels: pages.reduce((s, p) => s + p.labelCount, 0),
    scheduleRows: pages.reduce((s, p) => s + p.scheduleRows, 0),
    vectorPages: pages.filter((p) => p.kind === 'vektorel' || p.kind === 'karma').length,
    scannedPages: pages.filter((p) => p.kind === 'taranmis').length,
    emptyPages: pages.filter((p) => p.kind === 'bos').length,
  }
  const pendingOcr = pages.filter((p) => p.ocrNeeded && p.textSource !== 'ocr' && p.textSource !== 'vektor+ocr')
  const whyNone: string[] = []
  const warnings: string[] = []
  if (!candidates.length) {
    if (!pages.length) whyNone.push('Hiçbir sayfa analiz edilmedi.')
    else if (totals.emptyPages === pages.length) whyNone.push('Seçilen sayfalar boş: çizgi, yazı veya görüntü yok.')
    else if (pendingOcr.length)
      for (const p of pendingOcr) whyNone.push(`Sayfa ${p.page}: ${p.ocrNeeded}. Yazıları okumak için OCR'ı açıp analizi yeniden çalıştırın.`)
    else if (totals.texts === 0 && totals.scannedPages > 0) whyNone.push('OCR çalıştı ancak görüntüden poz/ölçü yazısı okunamadı (çözünürlük düşük veya yazılar el yazısı/eğik olabilir).')
    else if (totals.texts === 0) whyNone.push('Çizimde yazı yok (yalnız çizgi). Poz kodu ve ölçü yazısı olmadan doğrama türü ve adedi güvenilir biçimde çıkarılamaz.')
    else {
      whyNone.push(`${totals.texts} yazı okundu ancak hiçbiri poz kodu ("P1", "K-02") veya doğrama ölçüsü ("120/150", "1.20/1.50", "90x210") biçiminde değil.`)
      if (totals.numeric) whyNone.push(`${totals.numeric} sayısal ölçü yazısı bulundu (ölçü zinciri vb.); bunlar tek başına doğrama tanımlamaz.`)
    }
    if (pages.length && pages.every((p) => !COUNTED.includes(p.sheet) && p.sheet !== 'cizelge')) whyNone.push('Seçilen sayfalar arasında kat planı veya doğrama çizelgesi yok.')
    whyNone.push('Çözüm: doğrama çizelgesi veya poz etiketli kat planı içeren sayfaları seçin; ya da ölçeği kalibre edip alan/mesafe ölçümüyle pozları elle ekleyin.')
  } else if (pendingOcr.length) {
    for (const p of pendingOcr) warnings.push(`Sayfa ${p.page}: ${p.ocrNeeded}. Bu sayfadaki yazılar OCR olmadan okunmadı; sonuçlar eksik olabilir.`)
  }
  for (const p of pages) if (p.scale.conflict) warnings.push(`Sayfa ${p.page}: ${p.scale.conflict}`)
  if (opts.ocrUsed) warnings.push('Bazı yazılar OCR ile okundu; OCR rakam hatası yapabilir, sonuçları çizimle karşılaştırın.')
  const conflictCount = candidates.filter((c) => c.conflicts.length).length
  if (conflictCount) warnings.push(`${conflictCount} pozda çelişki var (adet/ölçü/açılım); kullanıcı kararı gerekiyor.`)
  const sugg = pages.find((p) => p.scale.inferred && (!p.scale.title || p.scale.title === p.scale.inferred.denominator))
  const suggestedScale = sugg
    ? {
        page: sugg.page,
        denominator: sugg.scale.inferred!.denominator,
        why: `${sugg.scale.inferred!.support}/${sugg.scale.inferred!.total} ölçü yazısı çizgi uzunluğuyla 1/${sugg.scale.inferred!.denominator} ölçeğinde uyumlu${sugg.scale.title ? '; antetteki ölçekle aynı' : ''}`,
      }
    : null

  // Tanı raporu
  const drawingPages = pages.filter((p) => (COUNTED.includes(p.sheet) || p.sheet === 'gorunus') && p.segments > 0)
  const missing: string[] = []
  const noDims = candidates.filter((c) => !c.width_mm || !c.height_mm).length
  if (noDims) missing.push(`${noDims} pozda ölçü okunamadı`)
  const noMat = candidates.filter((c) => c.category === 'belirsiz').length
  if (noMat) missing.push(`${noMat} pozda malzeme/iş grubu belirlenemedi`)
  for (const k of ['sistem', 'cam', 'renk', 'acilim'] as const) {
    const n = candidates.filter((c) => c.attrs[k]?.status === 'belirsiz').length
    if (n) missing.push(`${n} pozda ${ATTR_LABEL[k].toLocaleLowerCase('tr-TR')} çizimde yok`)
  }
  const asks: DiagnosticReport['asks'] = []
  const unverified = drawingPages.filter((p) => !p.scale.verified && p.hits.length)
  if (unverified.length)
    asks.push({ kind: 'referans_olcu', message: `Ölçek doğrulanamadı (sayfa ${unverified.map((p) => p.page).join(', ')}): bilinen bir ölçüyü (ör. kapı genişliği) iki noktayla kalibre edin veya ölçeği onaylayın.` })
  if (pages.length && !pages.some((p) => COUNTED.includes(p.sheet) || p.sheet === 'cizelge') && opts.pageCount > pages.length)
    asks.push({ kind: 'pafta_secimi', message: 'Seçilen sayfalarda kat planı veya doğrama çizelgesi yok: analiz için ilgili paftaları seçin.' })
  if (candidates.length && !totals.scheduleRows)
    asks.push({ kind: 'cizelge', message: 'Doğrama çizelgesi/listesi bulunamadı: adet ve malzeme yalnız plandan çıkarıldı. Varsa çizelge paftasını da seçin.' })
  if (noMat) asks.push({ kind: 'malzeme', message: `${noMat} poz için malzeme sınıfı (PVC / alüminyum) seçilmeli.` })
  if (pendingOcr.length) asks.push({ kind: 'ocr', message: `Sayfa ${pendingOcr.map((p) => p.page).join(', ')} için OCR çalıştırılmalı.` })
  const report: DiagnosticReport = {
    readable: pages.length > 0 || (opts.skippedPages?.length ?? 0) < opts.pageCount,
    pagesFound: opts.pageCount,
    pagesAnalyzed: pages.length,
    texts: totals.texts,
    candidates: candidates.length,
    scaleVerifiedPages: drawingPages.filter((p) => p.scale.verified).map((p) => p.page),
    scaleUnverifiedPages: drawingPages.filter((p) => !p.scale.verified).map((p) => p.page),
    ocrNeededPages: pages.filter((p) => p.ocrNeeded).map((p) => ({ page: p.page, reason: p.ocrNeeded!, done: p.textSource === 'ocr' || p.textSource === 'vektor+ocr' })),
    failedPages: opts.skippedPages ?? [],
    missing,
    asks,
  }
  return {
    candidates,
    diagnostics: {
      pageCount: opts.pageCount,
      analyzedPages: pages.map((p) => p.page),
      skippedPages: opts.skippedPages ?? [],
      pages: pages.map(({ hits: _h, schedule: _s, ...rest }) => rest),
      totals,
      whyNone,
      warnings,
      suggestedScale,
      ocrUsed: !!opts.ocrUsed,
      report,
    },
  }
}

/** OCR kelime kutularından metin satırları (sayfa noktası, y yukarı) */
export function runsFromOcr(words: { text: string; bbox: BBox; confidence: number }[]): TextRun[] {
  const items: TextRun[] = words
    .filter((w) => w.text.trim())
    .map((w) => ({
      text: w.text.trim(),
      angle: 0,
      height: Math.max(1, w.bbox[3] - w.bbox[1]) * 0.8,
      ox: w.bbox[0],
      oy: w.bbox[1] + (w.bbox[3] - w.bbox[1]) * 0.15,
      width: w.bbox[2] - w.bbox[0],
      bbox: w.bbox,
      ids: [],
      ocr: Math.max(0, Math.min(1, w.confidence / 100)),
    }))
  return mergeRuns(items)
}

