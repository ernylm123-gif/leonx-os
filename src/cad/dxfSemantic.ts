/**
 * DXF anlamsal analizi (Faz 13): DXF model uzayını, PDF için geliştirilen mimari analiz motoruna
 * (pafta türü, doğrama çizelgesi, poz etiketi, ölçü etiketi, kat tekrarı, görünüş, çelişki)
 * "sanal kâğıt" olarak verir.
 *
 * DXF'te koordinatlar gerçek ölçüdür (birim $INSUNITS ile bilinir). Motor kâğıt üzerinde (pt) ve
 * ölçek paydasıyla çalışır; bu yüzden sahne, yazı yüksekliklerine göre seçilen standart bir ölçekle
 * (ör. 1/50) kâğıda indirgenir. Ölçek paydası birimden türetildiği için kullanıcı onaylı ölçek
 * gibi verilir: geometri doğrulaması gerçek milimetre üretir. Birim bilinmiyorsa ölçek
 * doğrulanmamış sayılır ve ölçüler kesin sunulmaz.
 *
 * Nesne kimlikleri değişmez; görüntüleyicideki vurgulama özgün DXF sahnesinde çalışır. Kutular
 * sonuçta yeniden çizim birimine çevrilir.
 */
import { categoryFor, type DetectionResult, type DetectOptions, detectPoz, inferType, type PozCandidate } from '@/quantity/detect'
import { aggregatePdf, analyzePage, canonCode, type PdfDiagnostics, type PdfPageAnalysis, type PdfPozCandidate } from './pdf/archAnalyze'
import { PT_TO_MM } from './pdf/pdfScene'
import type { BBox, Mat } from './geometry'
import type { Scene, SceneEntity } from './types'

/** Kâğıt üzerindeki hedef yazı yüksekliği (mm) — mimari paftalarda olağan 2–3 mm */
const PAPER_TEXT_MM = 2.5
const STANDARD_SCALES = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]

export interface DxfSemanticResult {
  candidates: PdfPozCandidate[]
  diagnostics: PdfDiagnostics
  analysis: PdfPageAnalysis
  /** Model + kâğıt uzayı sayfaları */
  pages: PdfPageAnalysis[]
  /** Sanal kâğıt ölçeği (1/denominator) ve doğrulanıp doğrulanmadığı */
  denominator: number
  unitsKnown: boolean
}

/** Yazı yüksekliklerinin medyanından standart ölçek (çizim mm cinsinden) */
export function chooseDenominator(scene: Scene, mmPerUnit: number): number {
  const hs: number[] = []
  for (const e of scene.entities) if (e.kind === 'text' && e.text && e.text.height > 0) hs.push(e.text.height * mmPerUnit)
  if (!hs.length) return 50
  hs.sort((a, b) => a - b)
  const med = hs[Math.floor(hs.length / 2)]
  const raw = med / PAPER_TEXT_MM
  let best = STANDARD_SCALES[0]
  for (const s of STANDARD_SCALES) if (Math.abs(Math.log(s / raw)) < Math.abs(Math.log(best / raw))) best = s
  return best
}

const scaleBox = (b: BBox, s: number): BBox => [b[0] * s, b[1] * s, b[2] * s, b[3] * s]
const scaleMat = (m: Mat, s: number): Mat => [m[0] * s, m[1] * s, m[2] * s, m[3] * s, m[4] * s, m[5] * s]

/** Sahnenin s katsayısıyla ölçeklenmiş kopyası (kimlikler ve yapı aynı) */
export function scaleScene(scene: Scene, s: number): Scene {
  const coords = new Float64Array(scene.coords.length)
  for (let i = 0; i < coords.length; i++) coords[i] = scene.coords[i] * s
  const entities: SceneEntity[] = scene.entities.map((e) => ({
    ...e,
    bbox: scaleBox(e.bbox, s),
    length: e.length == null ? null : e.length * s,
    area: e.area == null ? null : e.area * s * s,
    circle: e.circle ? [e.circle[0] * s, e.circle[1] * s, e.circle[2] * s] : undefined,
    rect: e.rect ? { ...e.rect, w: e.rect.w * s, h: e.rect.h * s } : undefined,
    text: e.text
      ? {
          ...e.text,
          // Yerel düzlem 1 birim = 1 çizim birimi; matris ölçeklenince yazı da ölçeklenir
          m: scaleMat(e.text.m, s),
          height: e.text.height * s,
          advance: e.text.advance == null ? undefined : e.text.advance * s,
        }
      : undefined,
    dim: e.dim
      ? {
          ...e.dim,
          p1: e.dim.p1 ? [e.dim.p1[0] * s, e.dim.p1[1] * s] : null,
          p2: e.dim.p2 ? [e.dim.p2[0] * s, e.dim.p2[1] * s] : null,
        }
      : undefined,
  }))
  return {
    coords,
    entities,
    inserts: scene.inserts.map((i) => ({ ...i, bbox: scaleBox(i.bbox, s), m: scaleMat(i.m, s) })),
    layers: scene.layers,
    bbox: scene.bbox ? scaleBox(scene.bbox, s) : null,
  }
}

/**
 * Yazı genişliği DXF'te bilinmez; motor satır birleştirmede genişliği kullanır. Tek satırlık
 * yazılarda bbox genişliği gerçek genişliğe en yakın değerdir.
 */
function withAdvance(scene: Scene): Scene {
  for (const e of scene.entities) {
    if (e.kind !== 'text' || !e.text || e.text.advance != null || e.text.lines.length !== 1) continue
    const a = Math.atan2(e.text.m[1], e.text.m[0])
    if (Math.abs(Math.sin(a)) < 1e-3) e.text.advance = e.bbox[2] - e.bbox[0]
    else if (Math.abs(Math.cos(a)) < 1e-3) e.text.advance = e.bbox[3] - e.bbox[1]
  }
  return scene
}

/**
 * DXF sahnesini mimari motorla analiz eder.
 * @param mmPerUnit 1 çizim biriminin mm karşılığı ($INSUNITS ya da kullanıcı kalibrasyonu); null → bilinmiyor
 */
export function analyzeDxfSemantic(
  scene: Scene,
  mmPerUnit: number | null,
  opts: { unitsVerified?: boolean; paper?: readonly { name: string; scene: Scene }[] } = {},
): DxfSemanticResult {
  const unitsKnown = mmPerUnit != null && mmPerUnit > 0 && opts.unitsVerified !== false
  const k = mmPerUnit && mmPerUnit > 0 ? mmPerUnit : 1
  // Sayfa 1: model uzayı; sayfa 2…: kâğıt uzayı layout'ları (antet, çizelge, pafta bilgisi)
  const sources = [{ name: 'Model', scene }, ...(opts.paper ?? [])]
  const analyses: PdfPageAnalysis[] = []
  const scales: number[] = []
  let den = 50
  sources.forEach((src, i) => {
    const d = chooseDenominator(src.scene, k)
    if (i === 0) den = d
    // çizim birimi → kâğıt pt: (birim × mm/birim) / (mm/pt × ölçek)
    const sc = k / (PT_TO_MM * d)
    scales.push(sc)
    const paper = withAdvance(scaleScene(src.scene, sc))
    const pb = paper.bbox ?? [0, 0, 1190, 842]
    const a = analyzePage({
      page: i + 1,
      kind: 'vektorel',
      scene: paper,
      userDenominator: unitsKnown ? d : null,
      pageSize: { w: Math.max(1, pb[2] - pb[0]), h: Math.max(1, pb[3] - pb[1]) },
    })
    if (i === 0) {
      if (unitsKnown) a.notes.push(`DXF: çizim birimi biliniyor; ölçüler gerçek ölçüden (sanal ölçek 1/${d}).`)
      else a.notes.push('DXF: çizim birimi bilinmiyor; ölçek kalibre edilmeden ölçüler kesin değildir.')
    } else {
      a.title = a.title ?? src.name
      a.notes.push(`DXF kâğıt uzayı (layout) "${src.name}" ayrı pafta olarak okundu.`)
    }
    analyses.push(a)
  })
  const { candidates, diagnostics } = aggregatePdf(analyses, { pageCount: sources.length })
  for (const c of candidates) {
    // Kâğıt uzayındaki örneklerin nesne kimlikleri o layout'un sahnesine aittir: görüntüleyicide
    // (model uzayı) yanlış nesneyi işaretlememek için çıkarılır, kaynak kanıt olarak yazılır.
    const fromPaper = c.instances.filter((inst) => (inst.page ?? 1) > 1)
    if (fromPaper.length) {
      for (const p of new Set(fromPaper.map((x) => x.page!))) c.evidence.push(`Kaynak: kâğıt uzayı "${sources[p - 1].name}"`)
      c.instances = c.instances.filter((inst) => (inst.page ?? 1) === 1)
    }
    for (const inst of c.instances) if (inst.bbox) inst.bbox = scaleBox(inst.bbox, 1 / scales[0])
  }
  return { candidates, diagnostics, analysis: analyses[0], pages: analyses, denominator: den, unitsKnown }
}

// ------------------------------------------------------------------ hibrit DXF tespiti

const OLCU_TOL = 0.02

/**
 * DXF için birleşik tespit: mimari motor (etiket, çizelge, kat tekrarı, özellik, çelişki) +
 * blok/geometri motoru (yazısız çizimler, blok ölçüsü). Aynı poz iki kaynakta da varsa mimari
 * sonuç esas alınır; blok ölçüsü farklıysa sessizce seçilmez, çelişki olarak eklenir. Yalnız
 * geometride bulunan pozlar, mimari motor bir şey bulduysa yalnızca blok referansından
 * geliyorsa eklenir (duvar gibi kapalı çizgilerin poz sanılmaması için).
 */
export function detectDxf(scene: Scene, opts: DetectOptions & { paper?: readonly { name: string; scene: Scene }[] }): DetectionResult & { semantic: DxfSemanticResult } {
  const geo = detectPoz(scene, opts)
  const sem = analyzeDxfSemantic(scene, opts.mmPerUnit, { unitsVerified: opts.unitsVerified, paper: opts.paper })
  if (!sem.candidates.length) {
    applyAttributes(geo.candidates, scene)
    return { ...geo, semantic: sem }
  }
  const byCanon = new Map(sem.candidates.map((c) => [c.canon, c]))
  const out: PozCandidate[] = [...sem.candidates]
  for (const g of geo.candidates) {
    const canon = canonCode(g.code.replace(/-[a-z]$/, ''))
    const s = byCanon.get(canon)
    if (!s) {
      if (g.source === 'blok') out.push(g)
      continue
    }
    if (g.width_mm == null || g.height_mm == null) continue
    // Etiket var ama yazılı ölçü/çizelge yok: ölçü ve adet çizimin geometrisinden gelir
    if (s.dimsFrom == null && s.scheduleQty == null) {
      s.width_mm = g.width_mm
      s.height_mm = g.height_mm
      s.shape = g.shape
      if (s.category === 'belirsiz') s.category = g.category
      if (!s.floorMultiplier && g.count > s.count) {
        s.evidence.push(`Adet çizimdeki ${g.count} örnekten (etiket ${s.count} kez yazılmış)`)
        s.count = g.count
      }
      s.instances.push(...g.instances)
      s.evidence.push(`Ölçü çizim geometrisinden: ${g.width_mm}×${g.height_mm} mm${g.block ? ` (${g.block})` : ''}`)
      continue
    }
    if (g.source !== 'blok' || s.width_mm == null || s.height_mm == null) continue
    const off = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b) > OLCU_TOL
    if (off(g.width_mm, s.width_mm) || off(g.height_mm, s.height_mm)) {
      if (!s.conflicts.some((x) => x.kind === 'olcu'))
        s.conflicts.push({
          kind: 'olcu',
          message: `Çizimdeki blok (${g.block ?? 'blok'}) ${g.width_mm}×${g.height_mm} mm; yazılı ölçü ${s.width_mm}×${s.height_mm} mm`,
        })
    } else if (!s.evidence.some((e) => e.startsWith('Blok ölçüsü'))) {
      s.evidence.push(`Blok ölçüsü yazılı ölçüyle uyumlu: ${g.block ?? ''} ${g.width_mm}×${g.height_mm} mm`)
    }
  }
  applyAttributes(out, scene)
  return {
    candidates: out,
    skipped: geo.skipped,
    labelsFound: Math.max(geo.labelsFound, sem.diagnostics.totals.labels),
    unitsVerified: opts.unitsVerified,
    pdf: sem.diagnostics,
    semantic: sem,
  }
}

// ------------------------------------------------------------------ blok öznitelikleri (ATTRIB)

type AttrField = 'code' | 'w' | 'h' | 'type' | 'malzeme' | 'sistem' | 'cam' | 'acilim' | 'renk'

/** Öznitelik etiketi → alan. Etiketler büyük harfe ve ASCII'ye çevrilerek eşleştirilir. */
const TAG_FIELDS: [AttrField, RegExp][] = [
  ['code', /^(POZ|POZ_?NO|POZNO|POZ_?KODU|KOD|MARK|ETIKET)$/],
  ['w', /^(EN|GENISLIK|WIDTH|W|GEN)(_?\(?(MM|CM|M)\)?)?$/],
  ['h', /^(BOY|YUKSEKLIK|HEIGHT|H|YUK)(_?\(?(MM|CM|M)\)?)?$/],
  ['type', /^(TIP|TIPI|TYPE|CINS|CINSI|TUR|TURU)$/],
  ['malzeme', /^(MALZEME|MATERIAL|MAL)$/],
  ['sistem', /^(SISTEM|SERI|SERIES|PROFIL|PROFIL_?SERISI)$/],
  ['cam', /^(CAM|GLASS|CAM_?TIPI)$/],
  ['acilim', /^(ACILIM|OPENING|ACILIS)$/],
  ['renk', /^(RENK|COLOR|COLOUR)$/],
]

const tagKey = (t: string) =>
  t
    .trim()
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/\s+/g, '_')

interface AttrGroup {
  code: string
  inserts: number[]
  values: Partial<Record<AttrField, Set<string>>>
  /** Etiketteki açık birim (EN_CM, BOY (MM)) */
  unit: 'mm' | 'cm' | 'm' | null
}

/** Sahnedeki blok referanslarının özniteliklerini poz koduna göre toplar */
export function collectAttributes(scene: Scene): Map<string, AttrGroup> {
  const out = new Map<string, AttrGroup>()
  for (const ins of scene.inserts) {
    if (!ins.attribs.length) continue
    const vals: Partial<Record<AttrField, string>> = {}
    let unit: AttrGroup['unit'] = null
    for (const a of ins.attribs) {
      const k = tagKey(a.tag)
      const v = a.value.trim()
      if (!v) continue
      for (const [f, re] of TAG_FIELDS)
        if (re.test(k)) {
          vals[f] = v
          const u = /(MM|CM|M)\)?$/.exec(k)
          if ((f === 'w' || f === 'h') && u && k !== 'W' && k !== 'H' && k !== 'GEN' && k !== 'YUK') unit = u[1].toLowerCase() as AttrGroup['unit']
          break
        }
    }
    if (!vals.code) continue
    const canon = canonCode(vals.code)
    let g = out.get(canon)
    if (!g) {
      g = { code: vals.code, inserts: [], values: {}, unit }
      out.set(canon, g)
    }
    g.inserts.push(ins.id)
    if (unit) g.unit = unit
    for (const [f, v] of Object.entries(vals) as [AttrField, string][]) (g.values[f] ??= new Set()).add(v)
  }
  return out
}

const num = (v: string) => {
  const n = Number(v.replace(',', '.').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Öznitelik ölçüsünü mm'ye çevirir. Etikette birim yazıyorsa o; yoksa çizimdeki geometrik ölçüyle
 * karşılaştırılarak mm/cm/m'den uyanı seçilir. Geometri yoksa büyüklükten varsayılır ve
 * "varsayım" olarak işaretlenir (kesin sayılmaz).
 */
export function attrDimMm(value: number, unit: AttrGroup['unit'], geomMm: number | null): { mm: number; how: 'etiket' | 'geometri' | 'varsayim' } {
  const f = { mm: 1, cm: 10, m: 1000 } as const
  if (unit) return { mm: Math.round(value * f[unit]), how: 'etiket' }
  if (geomMm) for (const u of ['mm', 'cm', 'm'] as const) if (Math.abs(value * f[u] - geomMm) / geomMm <= OLCU_TOL) return { mm: Math.round(value * f[u]), how: 'geometri' }
  const u = value >= 300 ? 'mm' : value >= 30 ? 'cm' : 'm'
  return { mm: Math.round(value * f[u]), how: 'varsayim' }
}

const one = (s: Set<string> | undefined) => (s && s.size === 1 ? [...s][0] : null)

/**
 * Blok özniteliklerini adaylara işler. Öznitelik, nesnenin üzerinde açıkça yazılı veridir:
 *  - iş grubu (TIP/MALZEME) blok adından gelen genel tahminin önüne geçer,
 *  - teknik özellikler "çizimden doğrulandı" olarak yazılır,
 *  - ölçü yoksa öznitelikten alınır; varsa karşılaştırılır, farklıysa çelişki eklenir,
 *  - aynı poz kodlu bloklarda farklı değerler varsa çelişki olarak gösterilir.
 */
export function applyAttributes(candidates: PozCandidate[], scene: Scene): void {
  const groups = collectAttributes(scene)
  if (!groups.size) return
  for (const c of candidates) {
    const g = groups.get('canon' in c ? (c as PdfPozCandidate).canon : canonCode(c.code.replace(/-[a-z]$/, '')))
    if (!g) continue
    const pdf = 'pages' in c ? (c as PdfPozCandidate) : null
    const conflict = (kind: 'olcu' | 'malzeme' | 'adet' | 'acilim', message: string) => {
      if (pdf && !pdf.conflicts.some((x) => x.message === message)) pdf.conflicts.push({ kind, message })
      else if (!pdf) c.reasons.push(`Çelişki: ${message}`)
    }
    for (const [f, set] of Object.entries(g.values) as [AttrField, Set<string>][])
      if (set.size > 1 && f !== 'code') conflict(f === 'w' || f === 'h' ? 'olcu' : f === 'acilim' ? 'acilim' : 'malzeme', `${c.code} bloklarında "${f}" özniteliği farklı: ${[...set].join(' / ')}`)

    // İş grubu: öznitelikteki tip/malzeme
    const tipText = one(g.values.type)
    const malText = one(g.values.malzeme)
    if (tipText || malText) {
      const t = tipText ? inferType([tipText]).type : null
      const m = malText ? inferType([malText]).material : null
      const type = t ?? c.typeHint
      const material = m ?? c.material
      const cat = categoryFor(type, material)
      if (cat !== 'belirsiz' && cat !== c.category) {
        c.evidence.push(`İş grubu blok özniteliğinden: ${[tipText, malText].filter(Boolean).join(', ')} (önceki tahmin: ${c.category})`)
        c.category = cat
      }
      c.typeHint = type
      c.material = material
    }

    // Ölçü
    for (const axis of ['w', 'h'] as const) {
      const raw = one(g.values[axis])
      const v = raw ? num(raw) : null
      if (v == null) continue
      const cur = axis === 'w' ? c.width_mm : c.height_mm
      const d = attrDimMm(v, g.unit, cur)
      const label = axis === 'w' ? 'EN' : 'BOY'
      if (cur == null) {
        if (axis === 'w') c.width_mm = d.mm
        else c.height_mm = d.mm
        c.evidence.push(`${label} blok özniteliğinden: ${raw} → ${d.mm} mm${d.how === 'varsayim' ? ' (birim yazılmamış; büyüklükten varsayıldı — doğrulayın)' : ''}`)
      } else if (Math.abs(d.mm - cur) / Math.max(d.mm, cur) > OLCU_TOL) {
        conflict('olcu', `${c.code}: blok özniteliği ${label}=${raw} (${d.mm} mm), çizim/yazı ${cur} mm`)
      } else {
        c.evidence.push(`${label} blok özniteliğiyle uyumlu: ${raw}`)
      }
    }

    // Teknik özellikler
    if (pdf) {
      for (const k of ['malzeme', 'sistem', 'cam', 'acilim', 'renk'] as const) {
        const v = one(g.values[k])
        if (!v) continue
        const prev = pdf.attrs[k]
        if (prev?.status === 'dogrulandi' && prev.value && prev.value.toLocaleUpperCase('tr-TR') !== v.toLocaleUpperCase('tr-TR')) {
          conflict(k === 'acilim' ? 'acilim' : 'malzeme', `${c.code}: ${k} çizelgede "${prev.value}", blok özniteliğinde "${v}"`)
          continue
        }
        pdf.attrs[k] = { value: v, status: 'dogrulandi', source: `Blok özniteliği (${g.inserts.length} blok)` }
      }
    }
    // Öznitelik bloklarını örnek olarak ekle (çizimde gösterme)
    const have = new Set(c.instances.map((i) => i.insertId).filter((x): x is number => x != null))
    for (const id of g.inserts)
      if (!have.has(id)) {
        const ins = scene.inserts[id]
        c.instances.push({ entityIds: [], insertId: id, bbox: ins.bbox, handle: ins.handle, mirrored: ins.mirrored, page: 1, role: 'diger' })
      }
  }
}
