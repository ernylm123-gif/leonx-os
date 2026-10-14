/**
 * Analiz giriş noktası: bayt dizisi → dosya türü tespiti → (DXF) ayrıştırma → sahne → rapor.
 * Web Worker içinde çalışır (src/cad/worker/cad.worker.ts); testlerde doğrudan çağrılır.
 */
import { DxfSyntaxError, decodeDxf } from './dxf/tokenizer'
import { parseDxf } from './dxf/parser'
import { acadRelease, detectCadFile } from './fileType'
import { buildScene, DEFAULT_SCENE_LIMITS, type SceneLimits } from './scene'
import { supportOf, type CadReport, type DxfAnalysis, type ReportWarning, type TypeCount } from './types'
import { describeUnitCode, unitByCode } from './units'

export class CadAnalysisError extends Error {
  constructor(
    message: string,
    public readonly code: 'dwg' | 'dxf-binary' | 'pdf' | 'pdf-open' | 'pdf-pages' | 'unknown' | 'syntax' | 'empty' | 'too-large',
    public readonly detail?: string,
  ) {
    super(message)
    this.name = 'CadAnalysisError'
  }
}

/** Analiz edilebilecek en büyük dosya (Supabase Free dosya sınırıyla aynı) */
export const MAX_CAD_BYTES = 50 * 1024 * 1024

export interface AnalyzeOptions {
  limits?: SceneLimits
  onProgress?: (stage: 'okuma' | 'ayristirma' | 'sahne', fraction: number) => void
}

export function analyzeDxfBytes(bytes: Uint8Array, options: AnalyzeOptions = {}): DxfAnalysis {
  if (bytes.length === 0) throw new CadAnalysisError('Dosya boş.', 'empty')
  if (bytes.length > MAX_CAD_BYTES) throw new CadAnalysisError('Dosya 50 MB analiz sınırını aşıyor.', 'too-large')
  const kind = detectCadFile(bytes)
  if (kind.kind === 'dwg') {
    throw new CadAnalysisError(
      'DWG dosyası doğrudan okunamaz. Çizimi CAD programınızda DXF olarak kaydedip yükleyin.',
      'dwg',
      `${kind.version}${kind.release ? ` (${kind.release})` : ''}`,
    )
  }
  if (kind.kind === 'dxf-binary') {
    throw new CadAnalysisError('İkili (binary) DXF desteklenmiyor. Çizimi ASCII DXF olarak kaydedin.', 'dxf-binary')
  }
  if (kind.kind === 'pdf') throw new CadAnalysisError('Bu bir PDF dosyası; PDF çalışma alanında açılmalıdır.', 'pdf')
  if (kind.kind === 'unknown') throw new CadAnalysisError(kind.reason, 'unknown')

  const limits = options.limits ?? DEFAULT_SCENE_LIMITS
  const t0 = performance.now()
  options.onProgress?.('okuma', 0)
  const decoded = decodeDxf(bytes)
  options.onProgress?.('okuma', 1)
  let doc
  try {
    doc = parseDxf(decoded.text, { onProgress: (f) => options.onProgress?.('ayristirma', f) })
  } catch (e) {
    if (e instanceof DxfSyntaxError) throw new CadAnalysisError(`DXF dosyası bozuk veya eksik: ${e.message}`, 'syntax')
    throw e
  }
  const t1 = performance.now()
  const built = buildScene(doc, limits, (f) => options.onProgress?.('sahne', f))
  const t2 = performance.now()

  const warnings: ReportWarning[] = []
  for (const w of doc.warnings.slice(0, 50)) {
    warnings.push({ code: `parse:${w.code}`, severity: 'uyari', message: w.line ? `${w.message} (satır ${w.line})` : w.message })
  }
  if (doc.warnings.length > 50) {
    warnings.push({ code: 'parse:more', severity: 'uyari', message: `${doc.warnings.length - 50} ayrıştırma uyarısı daha var.` })
  }
  if (decoded.encoding.includes('hatalı')) {
    warnings.push({ code: 'encoding', severity: 'uyari', message: 'Dosyada geçersiz UTF-8 baytları var; bazı karakterler hatalı görünebilir.' })
  }
  if (decoded.corrected) {
    warnings.push({
      code: 'encoding-fixed',
      severity: 'uyari',
      message: `Dosya başlığında ${decoded.codepage ?? 'ANSI_1252'} yazıyor ancak metinler Türkçe (Windows-1254) kodlu; Türkçe karakterler buna göre okundu.`,
    })
  }
  warnings.push(...built.warnings)

  const unit = unitByCode(doc.insunits)
  if (!unit) {
    warnings.unshift({
      code: 'units-unknown',
      severity: 'hata',
      message: `Çizim birimi bilinmiyor — ${describeUnitCode(doc.insunits)}. Ölçüler doğrulanmadan kesin kabul edilmez; birimi seçip onaylayın.`,
    })
  }

  const counts: TypeCount[] = [...built.typeCounts.entries()]
    .map(([type, c]) => ({ type, total: c.total, drawn: c.drawn, level: supportOf(type).level }))
    .sort((a, b) => b.total - a.total)

  const report: CadReport = {
    format: 'dxf',
    acadver: doc.acadver,
    release: acadRelease(doc.acadver),
    encoding: decoded.encoding,
    units: { code: doc.insunits, label: unit ? `${unit.name} (${unit.short})` : describeUnitCode(doc.insunits), mmPerUnit: unit?.mm ?? null },
    counts,
    warnings,
    blocks: built.blocks,
    extents: built.scene.bbox,
    paperSpaceSkipped: built.paperSpaceSkipped,
    truncated: built.truncated,
    limits: { maxEntities: limits.maxEntities, maxPoints: limits.maxPoints },
    stats: {
      parseMs: Math.round(t1 - t0),
      buildMs: Math.round(t2 - t1),
      entities: built.scene.entities.length,
      points: built.scene.coords.length / 2,
      inserts: built.scene.inserts.length,
    },
  }
  return { scene: built.scene, report }
}
