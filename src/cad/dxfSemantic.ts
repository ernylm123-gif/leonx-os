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
import { type DetectionResult, type DetectOptions, detectPoz, type PozCandidate } from '@/quantity/detect'
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
export function analyzeDxfSemantic(scene: Scene, mmPerUnit: number | null, opts: { unitsVerified?: boolean } = {}): DxfSemanticResult {
  const unitsKnown = mmPerUnit != null && mmPerUnit > 0 && opts.unitsVerified !== false
  const k = mmPerUnit && mmPerUnit > 0 ? mmPerUnit : 1
  const den = chooseDenominator(scene, k)
  // çizim birimi → kâğıt pt: (birim × mm/birim) / (mm/pt × ölçek)
  const s = k / (PT_TO_MM * den)
  const paper = withAdvance(scaleScene(scene, s))
  const pb = paper.bbox ?? [0, 0, 1190, 842]
  const analysis = analyzePage({
    page: 1,
    kind: 'vektorel',
    scene: paper,
    userDenominator: unitsKnown ? den : null,
    pageSize: { w: Math.max(1, pb[2] - pb[0]), h: Math.max(1, pb[3] - pb[1]) },
  })
  if (unitsKnown) analysis.notes.push(`DXF: çizim birimi biliniyor; ölçüler gerçek ölçüden (sanal ölçek 1/${den}).`)
  else analysis.notes.push('DXF: çizim birimi bilinmiyor; ölçek kalibre edilmeden ölçüler kesin değildir.')
  const { candidates, diagnostics } = aggregatePdf([analysis], { pageCount: 1 })
  const back = 1 / s
  for (const c of candidates) for (const inst of c.instances) if (inst.bbox) inst.bbox = scaleBox(inst.bbox, back)
  return { candidates, diagnostics, analysis, denominator: den, unitsKnown }
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
export function detectDxf(scene: Scene, opts: DetectOptions): DetectionResult & { semantic: DxfSemanticResult } {
  const geo = detectPoz(scene, opts)
  const sem = analyzeDxfSemantic(scene, opts.mmPerUnit, { unitsVerified: opts.unitsVerified })
  if (!sem.candidates.length) return { ...geo, semantic: sem }
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
  return {
    candidates: out,
    skipped: geo.skipped,
    labelsFound: Math.max(geo.labelsFound, sem.diagnostics.totals.labels),
    unitsVerified: opts.unitsVerified,
    pdf: sem.diagnostics,
    semantic: sem,
  }
}
