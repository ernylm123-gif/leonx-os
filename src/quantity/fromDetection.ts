import { computeItem } from './engine'
import type { PozCandidate } from './detect'
import { CATEGORY_INFO, type DetectionInfo, emptyItem, type QuantityItemInput } from './types'
import type { PdfPozCandidate } from '@/cad/pdf/archAnalyze'

const MAX_HANDLES = 50
const MAX_BOXES = 200

/** Tespit adayından metraj kalemi. Onay ancak iş grubu belli ve hesap hatasızsa mümkündür. */
export function candidateToInput(
  c: PozCandidate,
  opts: { approve: boolean; fileName: string | null; analysisId: string | null; category?: PozCandidate['category']; detected?: PozCandidate | null },
): QuantityItemInput {
  const category = opts.category ?? c.category
  const handles = c.instances.map((i) => i.handle).filter((h): h is string => !!h)
  const info = CATEGORY_INFO[category]
  const boxes = c.instances.slice(0, MAX_BOXES)
  const pdf = boxes.some((i) => i.page != null)
  const input = emptyItem({
    poz_code: c.code,
    category,
    shape: c.shape,
    width_mm: c.width_mm,
    height_mm: c.height_mm,
    height2_mm: c.height2_mm,
    vertices: c.vertices,
    manual_area_m2: c.manual_area_m2,
    quantity: c.count,
    // Doğrusal işler (korkuluk) mtül, diğerleri iş grubunun birimiyle
    unit: info.unit === 'serbest' ? 'm2' : info.unit,
    verification: 'bekliyor',
    description: c.block ? `Blok: ${c.block}` : c.label ? c.label.slice(0, 200) : null,
    drawing_ref: {
      key: c.key,
      analysis_id: opts.analysisId,
      file_name: opts.fileName,
      source: c.source,
      handles: handles.slice(0, MAX_HANDLES),
      layer: c.layer,
      block: c.block,
      boxes: boxes.map((i) => i.bbox),
      ...(pdf ? { box_pages: boxes.map((i) => i.page ?? 1) } : {}),
    },
    detection: {
      confidence: c.confidence,
      level: c.level,
      reasons: c.reasons.slice(0, 20),
      evidence: c.evidence.slice(0, 20),
      suggested_category: c.category,
      ...pdfExtras(c),
      // Ham tespit (kullanıcı düzeltmesinden önce): sunucu "ilk değer" olarak saklar
      ...(opts.detected ? { detected: { poz_code: opts.detected.code, category: opts.detected.category, width_mm: opts.detected.width_mm, height_mm: opts.detected.height_mm, quantity: opts.detected.count } } : {}),
    },
  })
  if (opts.approve && canApprove(input)) input.verification = 'onaylandi'
  return input
}

/** PDF adayının özellikleri, çelişkileri ve kaynak bilgisi (izlenebilirlik; ≤16 KB) */
function pdfExtras(c: PozCandidate): Partial<DetectionInfo> {
  if (!('attrs' in c)) return {}
  const p = c as PdfPozCandidate
  const attrs: NonNullable<DetectionInfo['attrs']> = {}
  for (const [k, v] of Object.entries(p.attrs)) if (v) attrs[k] = { value: v.value.slice(0, 200), status: v.status, source: v.source.slice(0, 240) }
  return {
    attrs,
    conflicts: p.conflicts.slice(0, 10).map((x) => ({ kind: x.kind, message: x.message.slice(0, 300) })),
    provenance: {
      pages: p.pages.slice(0, 40),
      sheets: p.sheets.slice(0, 20).map((s) => s.slice(0, 120)),
      dims_from: p.dimsFrom,
      schedule_qty: p.scheduleQty,
      plan_qty: p.planQty,
      floor_multiplier: p.floorMultiplier,
      code_variants: p.codeVariants.slice(0, 6),
      ocr: p.reasons.some((r) => r.includes('OCR')),
    },
  }
}

export function canApprove(input: QuantityItemInput): boolean {
  return input.category !== 'belirsiz' && computeItem({ ...input, verification: 'onaylandi' }).ok
}

/** Ölçüm aracıyla çizilen alan → düzensiz çokgen poz (mm). Birim doğrulanmadıysa onaysız eklenir. */
export function areaMeasurementToInput(points: [number, number][], mmPerUnit: number, verified: boolean, fileName: string | null): QuantityItemInput {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const mx = Math.min(...xs)
  const my = Math.min(...ys)
  const vertices = points.map(([x, y]) => [Math.round((x - mx) * mmPerUnit * 10) / 10, Math.round((y - my) * mmPerUnit * 10) / 10] as [number, number])
  // Dört köşeli ve dik açılı ölçüm dikdörtgen olarak kaydedilir
  const rect = asAxisRect(vertices)
  return emptyItem({
    poz_code: '',
    shape: rect ? 'dikdortgen' : 'cokgen',
    width_mm: rect ? rect[0] : null,
    height_mm: rect ? rect[1] : null,
    vertices: rect ? null : vertices,
    verification: verified ? 'onaylandi' : 'bekliyor',
    drawing_ref: { source: 'olcum', file_name: fileName, boxes: [[mx, my, Math.max(...xs), Math.max(...ys)]] },
  })
}

export function distanceMeasurementToInput(a: [number, number], b: [number, number], mmPerUnit: number, verified: boolean, fileName: string | null): QuantityItemInput {
  const len = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * mmPerUnit * 10) / 10
  return emptyItem({
    poz_code: '',
    category: 'korkuluk',
    unit: 'mtul',
    width_mm: len,
    verification: verified ? 'onaylandi' : 'bekliyor',
    drawing_ref: { source: 'olcum', file_name: fileName, boxes: [[Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]] },
  })
}

function asAxisRect(v: [number, number][]): [number, number] | null {
  if (v.length !== 4) return null
  const xs = [...new Set(v.map((p) => p[0]))]
  const ys = [...new Set(v.map((p) => p[1]))]
  if (xs.length !== 2 || ys.length !== 2) return null
  return [Math.abs(xs[1] - xs[0]), Math.abs(ys[1] - ys[0])]
}
