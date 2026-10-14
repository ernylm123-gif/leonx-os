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
import { findScaleHints, type PdfKind, PT_TO_MM } from './pdfScene'
import { categoryFor, inferType, type Material, normalizeKey, parsePozLabel, type PozCandidate, type PozInstance, type TypeHint } from '@/quantity/detect'

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

export interface TextRun {
  text: string
  /** Yazı yönü (radyan, dünya) */
  angle: number
  height: number
  /** Taban çizgisi başlangıcı (dünya, PDF noktası) */
  ox: number
  oy: number
  /** Yazı yönündeki uzunluk */
  width: number
  bbox: BBox
  /** Kaynak metin nesneleri (vurgulama için) */
  ids: number[]
  /** OCR ile okunduysa tanıma güveni (0–1) */
  ocr?: number
}

export interface DimLabel {
  /** cm cinsinden okunmuşsa true; mm ise false */
  w_mm: number
  h_mm: number
  text: string
  /** Üçüncü değer (ör. parapet / denizlik yüksekliği), cm */
  extra: number | null
  unit: 'cm' | 'mm'
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
  unit: 'cm' | 'mm'
  text: string
  bbox: BBox
  ids: number[]
  ocr: boolean
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
}

export interface PdfPageAnalysis {
  page: number
  kind: PdfKind
  sheet: SheetType
  title: string | null
  textSource: 'vektor' | 'ocr' | 'yok'
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
}

/** PDF adayı: tespit motorunun ortak aday biçimi + PDF'e özgü bilgiler */
export interface PdfPozCandidate extends PozCandidate {
  pages: number[]
  sheets: string[]
  scheduleQty: number | null
  planQty: number | null
  dimsFrom: 'cizelge' | 'etiket' | null
  outOfScope: string | null
}

// ------------------------------------------------------------------ metin satırları

const deg = (r: number) => (r * 180) / Math.PI
const normAngle = (a: number) => {
  // [0, π) aralığına (ters yönlü yazı aynı doğrultudur)
  let x = a % Math.PI
  if (x < 0) x += Math.PI
  if (Math.PI - x < 1e-3) x = 0
  return x
}

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

const runCenter = (r: TextRun): [number, number] => [(r.bbox[0] + r.bbox[2]) / 2, (r.bbox[1] + r.bbox[3]) / 2]

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

// ------------------------------------------------------------------ etiket ayrıştırma

const NUM = '(\\d{2,5}(?:[.,]\\d{1,2})?)'
const DIM_RE = new RegExp(`^\\(?${NUM}\\s*([/xX×*])\\s*${NUM}(?:\\s*[/xX×*]\\s*(\\d{1,4}))?\\)?$`)
const num = (s: string) => Number(s.replace(',', '.'))

/** "120/150" (cm), "120x150", "1200x1500" (mm), "120/150/90" (üçüncü: parapet) */
export function parseDims(text: string): DimLabel | null {
  const s = text.trim().replace(/\s+/g, ' ')
  if (s.length > 24) return null
  const m = DIM_RE.exec(s)
  if (!m) return null
  const a = num(m[1])
  const b = num(m[3])
  const sep = m[2]
  if (!(a > 0 && b > 0)) return null
  // Türk mimari projelerinde "/" ayraçlı etiket santimetredir; 1000+ değerler ve "x" ile 400+ milimetredir
  const mm = (a >= 1000 || b >= 1000) || (sep !== '/' && a >= 400 && b >= 400)
  const unit: 'cm' | 'mm' = mm ? 'mm' : 'cm'
  const w = mm ? a : a * 10
  const h = mm ? b : b * 10
  // Doğrama için makul aralık: 25 cm – 20 m genişlik, 25 cm – 10 m yükseklik
  if (w < 250 || h < 250 || w > 20_000 || h > 10_000) return null
  return { w_mm: Math.round(w), h_mm: Math.round(h), text: s, extra: m[4] ? Number(m[4]) : null, unit }
}

/** Ölçü etiketi olmayan, yalnız poz kodu olan yazılar için bilinen doğrama önekleri */
const KNOWN_PREFIX = /^(P|PN|PE|PC|PK|W|WD|K|KP|KA|KD|D|DK|DP|S|SR|SK|SC|SB|SP|F|FK|FT|OK|KR|KK|KOR|C|CW|CP|CD|V|VT|KM|KC|KB|G|AK|AP)-?\d/

const PREFIX_TYPE: [RegExp, TypeHint][] = [
  [/^(FK|FT|OK|F)\d/, 'fotoselli'],
  [/^(SR|SK|S)\d/, 'surme'],
  [/^(SC|SB|SP)\d/, 'sabit'],
  [/^(KR|KK|KOR|G)\d/, 'korkuluk'],
  [/^(KM|KC|KB)\d/, 'kompozit'],
  [/^(CW|CP|CD|C|V|VT)\d/, 'cephe'],
  [/^(KP|KA|KD|K|D|DK|DP|AK|AP)\d/, 'kapi'],
  [/^(P|PN|PE|PC|PK|W|WD)\d/, 'pencere'],
]

export function typeFromCode(code: string): TypeHint | null {
  const c = code.replace('-', '')
  for (const [re, t] of PREFIX_TYPE) if (re.test(c)) return t
  return null
}

const OTHER_MATERIAL = /AHSAP|CELIK|DEMIR|MDF|LAMINAT|AMERIKAN|PANEL KAPI|YANGIN/

function splitCodeDims(text: string): { code: string | null; dims: DimLabel | null } {
  const t = text.replace(/[:;]/g, ' ').replace(/\s+/g, ' ').trim()
  const whole = parseDims(t)
  if (whole) return { code: null, dims: whole }
  const code = parsePozLabel(t)
  if (code) return { code, dims: null }
  const parts = t.split(' ')
  if (parts.length >= 2) {
    const c = parsePozLabel(parts[0]) ?? (parts.length >= 3 ? parsePozLabel(`${parts[0]} ${parts[1]}`) : null)
    if (c) {
      const rest = parts.slice(parsePozLabel(parts[0]) ? 1 : 2).join(' ')
      const d = parseDims(rest)
      if (d) return { code: c, dims: d }
    }
    // "120/150 P1"
    const c2 = parsePozLabel(parts[parts.length - 1])
    const d2 = parseDims(parts.slice(0, -1).join(' '))
    if (c2 && d2) return { code: c2, dims: d2 }
  }
  return { code: null, dims: null }
}

/**
 * OCR düzeltmesi: poz kodlarında 1 ↔ I/İ/l/|, 0 ↔ O karışıklığı ("KI" → "K1", "Pİ" → "P1"),
 * ölçü etiketlerinde rakam içindeki harfler ("12O/15O" → "120/150"). Yalnız OCR yazılarına uygulanır.
 */
export function fixOcrText(raw: string): string {
  let s = raw.trim().toLocaleUpperCase('tr-TR').replace(/[‘’'`"“”]/g, '')
  const m = /^([A-ZÇĞŞÖÜ]{1,3}?)-?([0-9IİL|!ÎÍ]{1,2}[0-9OIİL|!]{0,2})$/.exec(s)
  if (m) {
    const digits = m[2].replace(/[IİL|!ÎÍ]/g, '1').replace(/O/g, '0')
    if (/^[1-9]\d{0,2}$/.test(digits) && KNOWN_PREFIX.test(`${m[1]}${digits}`)) return `${m[1]}${s.includes('-') ? '-' : ''}${digits}`
  }
  if (/^[0-9OIİL|]{2,4}\s*[\/xX×]\s*[0-9OIİL|]{2,4}$/.test(s) && /\d/.test(s)) s = s.replace(/O/g, '0').replace(/[IİL|]/g, '1')
  return s
}

const isNumeric = (s: string) => /^\d{1,5}(?:[.,]\d{1,2})?$/.test(s.trim())

// ------------------------------------------------------------------ çizelge

const HEADER: [string, RegExp][] = [
  ['poz', /^(POZ|POZ NO|POZ NO\.|NO|KOD|TIP|TIP NO|TIPI|ISARET)$/],
  ['cins', /^(CINSI|CINS|TANIM|TANIMI|TURU|TUR|ADI|ELEMAN)$/],
  ['malzeme', /^(MALZEME|MALZEMESI|MALZ\.?|SISTEM|PROFIL)$/],
  ['en', /^(EN|ENI|GENISLIK|G|W)(\s*\((CM|MM)\))?$/],
  ['boy', /^(BOY|BOYU|YUKSEKLIK|Y|H)(\s*\((CM|MM)\))?$/],
  ['olcu', /^(OLCU|OLCUSU|OLCULER|EBAT|EBATLAR|BOYUT|EN\/BOY|EN X BOY)(\s*\((CM|MM)\))?$/],
  ['adet', /^(ADET|ADEDI|MIKTAR|SAYI|AD\.?)$/],
  ['aciklama', /^(ACIKLAMA|ACIKLAMALAR|NOT|NOTLAR)$/],
]

function headerKey(text: string): string | null {
  const n = normalizeKey(text).replace(/\s+/g, ' ').trim()
  for (const [k, re] of HEADER) if (re.test(n)) return k
  return null
}

/**
 * Çizelge okuma: başlık satırında POZ + (EN & BOY | ÖLÇÜ) + ADET aranır; sütunlar başlık
 * yazılarının x konumundan belirlenir, alttaki satırlar sütunlara atanır.
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
    // Başlık hücreleri birleşmiş olabilir ("POZ NO CİNSİ") — kelimelere de bakılır
    const cols: { key: string; x: number; unit: 'cm' | 'mm' | null; run: TextRun }[] = []
    for (const r of lines[i]) {
      const k = headerKey(r.text)
      if (k && !cols.some((c) => c.key === k)) cols.push({ key: k, x: r.ox, unit: /\(MM\)/i.test(r.text) ? 'mm' : /\(CM\)/i.test(r.text) ? 'cm' : null, run: r })
    }
    const has = (k: string) => cols.some((c) => c.key === k)
    if (!(has('poz') && ((has('en') && has('boy')) || has('olcu')) && cols.length >= 3)) continue
    for (const c of cols) used.add(c.run)
    const headerUnit = cols.find((c) => c.unit)?.unit ?? null
    cols.sort((a, b) => a.x - b.x)
    const h0 = lines[i][0].height
    let lastY = lines[i][0].oy
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]
      const y = line[0].oy
      if (lastY - y > 4 * Math.max(h0, line[0].height) + 20) break // tablo bitti
      const cells = new Map<string, TextRun[]>()
      for (const r of line) {
        // Sütun: başlangıcı yazının solunda (küçük tolerans) kalan en sağdaki başlık
        let col = cols[0]
        for (const c of cols) if (c.x <= r.ox + 0.6 * r.height) col = c
        const arr = cells.get(col.key) ?? []
        arr.push(r)
        cells.set(col.key, arr)
      }
      const cell = (k: string) => (cells.get(k) ?? []).map((r) => r.text).join(' ').trim()
      const code = parsePozLabel(cell('poz'))
      if (!code) {
        // Kod içermeyen satır (not, alt toplam): tablo bitişi olabilir
        if (line.some((r) => headerKey(r.text))) break
        continue
      }
      lastY = y
      let w: number | null = null
      let hh: number | null = null
      let unit: 'cm' | 'mm' = headerUnit ?? 'cm'
      if (has('olcu') && cell('olcu')) {
        const d = parseDims(cell('olcu'))
        if (d) {
          w = d.w_mm
          hh = d.h_mm
          unit = d.unit
        }
      }
      if (w == null && has('en')) {
        const ev = num(cell('en'))
        const bv = num(cell('boy'))
        if (ev > 0 && bv > 0) {
          if (!headerUnit && (ev >= 1000 || bv >= 1000)) unit = 'mm'
          w = Math.round(unit === 'mm' ? ev : ev * 10)
          hh = Math.round(unit === 'mm' ? bv : bv * 10)
        }
      }
      const q = cell('adet')
      const qty = /^\d{1,4}$/.test(q) ? Number(q) : null
      const material = cell('malzeme') || null
      const desc = [cell('cins'), material, cell('aciklama')].filter(Boolean).join(' · ')
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
      })
    }
  }
  return { rows, used }
}

// ------------------------------------------------------------------ geometri dizini

interface Segs {
  x1: Float64Array
  y1: Float64Array
  x2: Float64Array
  y2: Float64Array
  len: Float64Array
  id: Int32Array
  n: number
  grid: Map<string, number[]>
  cell: number
}

const MAX_SEGS = 400_000

export function segmentIndex(scene: Scene | null): Segs {
  const xs1: number[] = []
  const ys1: number[] = []
  const xs2: number[] = []
  const ys2: number[] = []
  const ls: number[] = []
  const ids: number[] = []
  if (scene) {
    const c = scene.coords
    for (const e of scene.entities) {
      if (e.kind !== 'path' || e.type === 'PDF_FILL') continue
      const n = e.count + (e.closed ? 0 : -1)
      for (let i = 0; i < n && xs1.length < MAX_SEGS; i++) {
        const j = (i + 1) % e.count
        const x1 = c[e.start + 2 * i]
        const y1 = c[e.start + 2 * i + 1]
        const x2 = c[e.start + 2 * j]
        const y2 = c[e.start + 2 * j + 1]
        const l = Math.hypot(x2 - x1, y2 - y1)
        if (l < 1.5) continue
        xs1.push(x1)
        ys1.push(y1)
        xs2.push(x2)
        ys2.push(y2)
        ls.push(l)
        ids.push(e.id)
      }
    }
  }
  const cell = 40
  const grid = new Map<string, number[]>()
  for (let i = 0; i < xs1.length; i++) {
    const cx0 = Math.floor(Math.min(xs1[i], xs2[i]) / cell)
    const cx1 = Math.floor(Math.max(xs1[i], xs2[i]) / cell)
    const cy0 = Math.floor(Math.min(ys1[i], ys2[i]) / cell)
    const cy1 = Math.floor(Math.max(ys1[i], ys2[i]) / cell)
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 400) continue // çok uzun çizgiler (pafta çerçevesi) dizine girmez
    for (let gx = cx0; gx <= cx1; gx++)
      for (let gy = cy0; gy <= cy1; gy++) {
        const k = `${gx},${gy}`
        const arr = grid.get(k)
        if (arr) arr.push(i)
        else grid.set(k, [i])
      }
  }
  return {
    x1: Float64Array.from(xs1),
    y1: Float64Array.from(ys1),
    x2: Float64Array.from(xs2),
    y2: Float64Array.from(ys2),
    len: Float64Array.from(ls),
    id: Int32Array.from(ids),
    n: xs1.length,
    grid,
    cell,
  }
}

function segsNear(s: Segs, x: number, y: number, r: number): number[] {
  const out = new Set<number>()
  const c = s.cell
  for (let gx = Math.floor((x - r) / c); gx <= Math.floor((x + r) / c); gx++)
    for (let gy = Math.floor((y - r) / c); gy <= Math.floor((y + r) / c); gy++) {
      const arr = s.grid.get(`${gx},${gy}`)
      if (arr) for (const i of arr) out.add(i)
    }
  return [...out]
}

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
    if (!isNumeric(r.text) || r.ocr != null) continue
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
  /** OCR ile okunan satırlar (taranmış sayfa) — verilirse sahne metinleri yerine kullanılır */
  ocrRuns?: TextRun[]
  /** Kullanıcının bu sayfa için onayladığı ölçek paydası (kalibrasyon / ölçek onayı) */
  userDenominator?: number | null
}

const PAIR_DIST = 3.2 // etiket yüksekliği katı

export function analyzePage(input: PageInput): PdfPageAnalysis {
  const runs = input.ocrRuns ?? (input.scene ? extractRuns(input.scene) : [])
  const segs = segmentIndex(input.kind === 'taranmis' ? null : input.scene)
  const notes: string[] = []
  const { sheet: titleSheet, title } = classifySheet(runs)
  const { rows: schedule, used } = parseSchedules(input.page, runs)
  const sheet: SheetType = schedule.length && (titleSheet === 'bilinmiyor' || titleSheet === 'detay') ? 'cizelge' : titleSheet

  // Ölçek
  const hints = findScaleHints(runs.map((r) => r.text))
  const titleDen = hints.length === 1 ? hints[0].denominator : (hints.find((h) => /OLCEK|SCALE/.test(normalizeKey(h.text)))?.denominator ?? null)
  const inferred = segs.n ? inferScale(runs, segs) : null
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

  // Etiketler (çizelgede kullanılan yazılar hariç)
  type Tok = { run: TextRun; code: string | null; dims: DimLabel | null }
  const toks: Tok[] = []
  let numericCount = 0
  for (const r of runs) {
    if (used.has(r)) continue
    if (isNumeric(r.text)) numericCount++
    const { code, dims } = splitCodeDims(r.ocr != null ? fixOcrText(r.text) : r.text)
    if (code || dims) toks.push({ run: r, code, dims })
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

  const scheduleCodes = new Set(schedule.map((r) => r.code))
  const hits: LabelHit[] = []
  for (const p of pairs) {
    const code = p.code?.code ?? null
    const dims = p.dims?.dims ?? null
    // Ölçüsüz tek başına kod: yalnız bilinen doğrama önekiyse (oda/aks/pafta numaralarını ayıklamak için)
    if (code && !dims && !KNOWN_PREFIX.test(code) && !scheduleCodes.has(code)) continue
    const runsUsed = [p.code?.run, p.dims?.run].filter((r): r is TextRun => !!r)
    const bbox = runsUsed.reduce((b, r) => bboxUnion(b, r.bbox), EMPTY_BBOX())
    // Yakındaki tür/malzeme kelimeleri (ör. "PVC", "SÜRME")
    const [cx, cy] = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
    const hh = Math.max(...runsUsed.map((r) => r.height))
    const near = runs
      .filter((r) => !runsUsed.includes(r) && r.text.length <= 40 && Math.hypot(runCenter(r)[0] - cx, runCenter(r)[1] - cy) <= 3 * hh)
      .map((r) => r.text)
      .filter((t) => inferType([t]).type || inferType([t]).material || OTHER_MATERIAL.test(normalizeKey(t)))
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
    })
  }

  // Geometri doğrulaması (yalnız planda: genişlik plan görünüşünde açıklık olarak çizilir)
  for (const h of hits) if (sheet === 'plan' || sheet === 'bilinmiyor' || sheet === 'gorunus') h.geometry = segs.n ? checkGeometry(h, segs, used_) : null

  const samples = [...new Set(runs.map((r) => r.text))].slice(0, 40)
  return {
    page: input.page,
    kind: input.kind,
    sheet,
    title,
    textSource: input.ocrRuns ? 'ocr' : runs.length ? 'vektor' : 'yok',
    textCount: runs.length,
    numericCount,
    labelCount: hits.length,
    scheduleRows: schedule.length,
    segments: segs.n,
    scale: { title: titleDen, inferred, used: used_, usedFrom, conflict },
    samples,
    notes,
    hits,
    schedule,
  }
}

// ------------------------------------------------------------------ birleştirme

const COUNTED: SheetType[] = ['plan', 'bilinmiyor']

function level(conf: number): PozCandidate['level'] {
  return conf >= 0.75 ? 'yuksek' : conf >= 0.5 ? 'orta' : 'dusuk'
}

const fmtCm = (mm: number) => (mm % 10 === 0 ? String(mm / 10) : (mm / 10).toFixed(1))

export interface AggregateOptions {
  pageCount: number
  skippedPages?: { page: number; reason: string }[]
  ocrUsed?: boolean
}

export function aggregatePdf(pages: PdfPageAnalysis[], opts: AggregateOptions): { candidates: PdfPozCandidate[]; diagnostics: PdfDiagnostics } {
  type Group = { key: string; code: string | null; hits: LabelHit[]; rows: ScheduleRow[] }
  const groups = new Map<string, Group>()
  const g = (key: string, code: string | null) => {
    let x = groups.get(key)
    if (!x) {
      x = { key, code, hits: [], rows: [] }
      groups.set(key, x)
    }
    return x
  }
  for (const p of pages) {
    for (const r of p.schedule) g(`K:${r.code}`, r.code).rows.push(r)
    for (const h of p.hits) {
      if (h.code) g(`K:${h.code}`, h.code).hits.push(h)
      else if (h.dims) g(`O:${h.dims.w_mm}x${h.dims.h_mm}`, null).hits.push(h)
    }
  }

  const candidates: PdfPozCandidate[] = []
  for (const grp of groups.values()) {
    const reasons: string[] = []
    const evidence: string[] = []
    const row = grp.rows[0] ?? null
    if (grp.rows.length > 1) {
      const qs = new Set(grp.rows.map((r) => `${r.w_mm}x${r.h_mm}x${r.quantity}`))
      if (qs.size > 1) reasons.push(`Poz ${grp.code} çizelgede birden fazla farklı satırla geçiyor; ilk satır kullanıldı`)
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
    let planQty: number | null = instHits.length || null
    let fromElevation = false
    if (!planQty && elev.length && !row) {
      planQty = elev.length
      fromElevation = true
    }
    const scheduleQty = row?.quantity ?? null

    // Ölçüler: çizelge > etiket çoğunluğu
    const dimVotes = new Map<string, { d: DimLabel; n: number }>()
    for (const h of grp.hits) if (h.dims) {
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
      dimsFrom = 'cizelge'
      evidence.push(`Ölçü çizelgeden: ${fmtCm(w)}/${fmtCm(hgt)} cm (sayfa ${row.page})`)
      const disagree = dimList.filter((x) => x.d.w_mm !== w || x.d.h_mm !== hgt)
      if (disagree.length) reasons.push(`Plandaki etiket ölçüsü çizelgeyle farklı: ${disagree.map((x) => `${x.d.text} (${x.n})`).join(', ')}`)
      else if (dimList.length) evidence.push('Plan etiketleri çizelge ölçüsüyle aynı')
    } else if (dimList.length) {
      w = dimList[0].d.w_mm
      hgt = dimList[0].d.h_mm
      dimsFrom = 'etiket'
      evidence.push(`Ölçü etiketten: ${dimList[0].d.text}${dimList[0].d.unit === 'cm' ? ' (cm)' : ' (mm)'}`)
      if (dimList.length > 1) reasons.push(`Aynı poz farklı ölçülerle yazılmış: ${dimList.map((x) => `${x.d.text} ×${x.n}`).join(', ')} — en sık olan alındı`)
    } else {
      reasons.push('Ölçü bulunamadı: en ve boy elle girilmeli')
    }
    const extra = dimList.find((x) => x.d.extra != null)?.d.extra
    if (extra != null) evidence.push(`Etikette üçüncü değer ${extra} (parapet/denizlik yüksekliği olabilir; metraja katılmadı)`)

    // Adet
    let count: number
    if (scheduleQty != null) {
      count = scheduleQty
      evidence.push(`Adet çizelgeden: ${scheduleQty}`)
      if (planQty != null && planQty !== scheduleQty) reasons.push(`Çizelgede ${scheduleQty} adet, planlarda ${planQty} etiket sayıldı — adedi kontrol edin`)
      else if (planQty != null) evidence.push(`Planlarda ${planQty} etiket: çizelgeyle uyumlu`)
      else reasons.push('Planlarda bu poza ait etiket bulunamadı; adet yalnız çizelgeden')
    } else if (planQty != null) {
      count = planQty
      evidence.push(`${planQty} adet ${fromElevation ? 'görünüş' : 'plan'} etiketi sayıldı`)
      if (fromElevation) reasons.push('Yalnız görünüş paftasında bulundu; plan ile doğrulanmadı (aynı doğrama birden fazla görünüşte olabilir)')
    } else {
      count = 1
      reasons.push('Adet belirlenemedi (yalnız görünüş/kesit/detayda geçiyor); 1 varsayıldı — kontrol edin')
    }
    if (elev.length && !fromElevation) evidence.push(`Görünüşteki ${elev.length} etiket sayılmadı (çift sayım önlendi)`)
    if (otherNot.length) evidence.push(`Kesit/detaydaki ${otherNot.length} etiket sayılmadı`)
    const tipKat = counted.some((h) => /NORMAL KAT|TIP KAT/.test(normalizeKey(pages.find((p) => p.page === h.page)?.title ?? '')))
    if (tipKat) reasons.push('Normal/tip kat planı: adet kat sayısıyla çarpılmalı olabilir — kontrol edin')

    // Tür ve malzeme: çizelge açıklaması > etiket yanındaki yazı > kod öneki > ölçü
    // Tür önce CİNSİ sütunundan (açıklamadaki "sabit + açılır" gibi ifadeler türü değiştirmez)
    const texts = [row?.kind ?? '', row?.material ?? '', ...grp.hits.flatMap((h) => h.near), row?.description ?? '']
    const inf = inferType(texts.filter(Boolean))
    let type: TypeHint | null = inf.type
    let typeWhy = inf.type ? `metin: ${inf.sources[0]}` : ''
    if (!type && grp.code) {
      type = typeFromCode(grp.code)
      if (type) typeWhy = `kod öneki (${grp.code})`
    }
    if (!type && w && hgt) {
      type = hgt >= 1900 && w <= 4000 ? 'kapi' : 'pencere'
      typeWhy = 'ölçüden tahmin'
    }
    const material: Material | null = inf.material
    const other = texts.map((t) => normalizeKey(t)).find((t) => OTHER_MATERIAL.test(t))
    const outOfScope = !material && other ? `Malzeme ${other.match(OTHER_MATERIAL)![0].toLocaleLowerCase('tr-TR').replace('ahsap', 'ahşap').replace('celik', 'çelik')}: alüminyum/PVC kapsamı dışında olabilir` : null
    let category = categoryFor(type, material)
    if (outOfScope) {
      category = 'belirsiz'
      reasons.push(outOfScope)
    }
    if (type) evidence.push(`Tür: ${type} (${typeWhy})`)
    if (typeWhy === 'ölçüden tahmin' || typeWhy.startsWith('kod')) reasons.push('Doğrama türü yazıyla belirtilmemiş; tahmin edildi')
    if (material) reasons.push(`Malzeme (${material === 'pvc' ? 'PVC' : 'alüminyum'}) yazıdan okundu; onaylayın`)
    else if (!outOfScope && (type === 'pencere' || type === 'kapi')) reasons.push('Malzeme (PVC / alüminyum) yazılmamış: iş grubu seçilmeli')

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
    if (ocr) reasons.push('Yazılar taranmış görüntüden OCR ile okundu: rakamları çizimle karşılaştırın')

    // Güven
    let conf: number
    if (row && planQty != null) conf = planQty === scheduleQty ? 0.85 : 0.5
    else if (row) conf = 0.62
    else if (grp.code && dimsFrom) conf = 0.68
    else if (dimsFrom) conf = 0.55
    else conf = 0.3
    if (ok && !notFound) conf += 0.05
    if (notFound) conf -= 0.1 * Math.min(1, notFound / Math.max(1, geo.length)) + 0.05
    if (dimList.length > 1) conf -= 0.1
    if (ocr) conf -= 0.12
    if (fromElevation) conf -= 0.1
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
    if (row) instances.push({ entityIds: row.ids, insertId: null, bbox: row.bbox, handle: null, page: row.page, role: 'cizelge' })
    if (!instances.length) for (const h of grp.hits.slice(0, 20)) instances.push({ entityIds: h.ids, insertId: null, bbox: h.bbox, handle: null, page: h.page, role: h.sheet === 'gorunus' ? 'gorunus' : 'diger' })

    const code = grp.code ?? (w && hgt ? `${fmtCm(w)}/${fmtCm(hgt)}` : '?')
    const pageSet = [...new Set([...grp.hits.map((h) => h.page), ...grp.rows.map((r) => r.page)])].sort((a, b) => a - b)
    const sheets = [...new Set(pageSet.map((pn) => {
      const p = pages.find((x) => x.page === pn)
      return `S${pn} · ${p?.title ?? SHEET_LABEL[p?.sheet ?? 'bilinmiyor']}`
    }))]
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
    })
  }
  // Sıralama: kod (doğal), sonra ölçü
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
  const whyNone: string[] = []
  const warnings: string[] = []
  if (!candidates.length) {
    if (!pages.length) whyNone.push('Hiçbir sayfa analiz edilmedi.')
    else if (totals.emptyPages === pages.length) whyNone.push('Seçilen sayfalar boş: çizgi, yazı veya görüntü yok.')
    else if (totals.texts === 0 && totals.scannedPages > 0 && !opts.ocrUsed)
      whyNone.push('Sayfalar taranmış görüntü; yazı katmanı yok. Yazıları okumak için OCR çalıştırın veya ölçüyü kalibrasyonla elle alın.')
    else if (totals.texts === 0 && totals.scannedPages > 0) whyNone.push('OCR çalıştı ancak görüntüden poz/ölçü yazısı okunamadı (çözünürlük düşük veya yazılar el yazısı/eğik olabilir).')
    else if (totals.texts === 0) whyNone.push('Çizimde yazı yok (yalnız çizgi). Poz kodu ve ölçü yazısı olmadan doğrama türü ve adedi güvenilir biçimde çıkarılamaz.')
    else {
      whyNone.push(`${totals.texts} yazı okundu ancak hiçbiri poz kodu ("P1", "K-02") veya doğrama ölçüsü ("120/150", "90x210") biçiminde değil.`)
      if (totals.numeric) whyNone.push(`${totals.numeric} sayısal ölçü yazısı bulundu (ölçü zinciri vb.); bunlar tek başına doğrama tanımlamaz.`)
    }
    if (pages.length && pages.every((p) => !COUNTED.includes(p.sheet) && p.sheet !== 'cizelge')) whyNone.push('Seçilen sayfalar arasında kat planı veya doğrama çizelgesi yok.')
    whyNone.push('Çözüm: doğrama çizelgesi veya poz etiketli kat planı içeren sayfaları seçin; ya da ölçeği kalibre edip alan/mesafe ölçümüyle pozları elle ekleyin.')
  }
  for (const p of pages) if (p.scale.conflict) warnings.push(`Sayfa ${p.page}: ${p.scale.conflict}`)
  if (opts.ocrUsed) warnings.push('Taranmış sayfalarda yazılar OCR ile okundu; OCR rakam hatası yapabilir, sonuçları çizimle karşılaştırın.')
  const sugg = pages.find((p) => p.scale.inferred && (!p.scale.title || p.scale.title === p.scale.inferred.denominator))
  const suggestedScale = sugg
    ? {
        page: sugg.page,
        denominator: sugg.scale.inferred!.denominator,
        why: `${sugg.scale.inferred!.support}/${sugg.scale.inferred!.total} ölçü yazısı çizgi uzunluğuyla 1/${sugg.scale.inferred!.denominator} ölçeğinde uyumlu${sugg.scale.title ? '; antetteki ölçekle aynı' : ''}`,
      }
    : null
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

