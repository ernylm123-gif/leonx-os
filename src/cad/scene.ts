/**
 * Sahne oluşturucu: ayrıştırılmış DXF belgesindeki nesneleri dünya koordinatlarına çevirir.
 *
 * - Bloklar (INSERT) konum, döndürme, ölçek, aynalama (negatif ölçek veya extrusion -Z),
 *   MINSERT dizileri ve iç içe bloklar dahil açılır. Döngüsel blok referansı ve aşırı
 *   derinlik tespit edilip raporlanır.
 * - Blok içindeki "0" katmanındaki nesneler referansın katmanını, BYBLOCK renkler
 *   referansın rengini alır (AutoCAD kuralı).
 * - Uzunluk ve alan mümkün olduğunda analitik hesaplanır (yay, daire, bulge); yaklaşık
 *   olanlar `exact: false` ile işaretlenir.
 * - Okunamayan / desteklenmeyen hiçbir nesne sessizce atlanmaz; raporda türü, adedi ve
 *   örnek tanıtıcılarıyla listelenir.
 */
import { aciToRgb } from './aci'
import {
  apply,
  arcPoints,
  axisScales,
  type BBox,
  bboxOf,
  bboxUnion,
  bboxValid,
  bulgeLength,
  bulgePoints,
  bulgeSegmentArea,
  ccwSweep,
  det,
  EMPTY_BBOX,
  IDENTITY,
  isSimilarity,
  isTilted,
  type Mat,
  minorAxis,
  mul,
  ocsToWcs,
  pointInPolygon,
  polylineLength,
  rectOf,
  rotate,
  scale,
  signedArea,
  translate,
} from './geometry'
import { type DxfDocument, type DxfEntity, type Tag, tagExtrusion, tagNum, tagPoint, tagStr } from './dxf/parser'
import { catmullRom, evaluateSpline } from './spline'
import { cleanMText, cleanTextCodes, parseNumberCandidates } from './text'
import type { DimInfo, ReportWarning, Scene, SceneBlock, SceneEntity, SceneInsert, SceneLayer, TextInfo } from './types'

export interface SceneLimits {
  /** Sahnedeki en fazla nesne */
  maxEntities: number
  /** Toplam en fazla nokta */
  maxPoints: number
  /** En fazla blok iç içe derinliği */
  maxDepth: number
}

export const DEFAULT_SCENE_LIMITS: SceneLimits = { maxEntities: 400_000, maxPoints: 8_000_000, maxDepth: 32 }

/** Çizilmeyen ama geometri de taşımayan nesneler (raporda bilgi olarak sayılır) */
const NON_GEOMETRY = new Set(['VIEWPORT', 'ATTDEF'])

interface Ctx {
  m: Mat
  /** "0" katmanındaki nesnelerin alacağı katman (blok içindeyken) */
  layer: string | null
  /** BYBLOCK renk */
  rgb: number | null
  insert: number
  owner: number
  depth: number
  stack: string[]
}

class LimitReached extends Error {}

interface BuildOutput {
  scene: Scene
  warnings: ReportWarning[]
  typeCounts: Map<string, { total: number; drawn: number }>
  blocks: SceneBlock[]
  paperSpaceSkipped: number
  truncated: boolean
}

export function buildScene(doc: DxfDocument, limits: SceneLimits = DEFAULT_SCENE_LIMITS, onProgress?: (f: number) => void): BuildOutput {
  return new SceneBuilder(doc, limits, onProgress).run()
}

class SceneBuilder {
  private coords = new Float64Array(1 << 16)
  private len = 0
  private entities: SceneEntity[] = []
  private inserts: SceneInsert[] = []
  private warnings = new Map<string, ReportWarning>()
  private typeCounts = new Map<string, { total: number; drawn: number }>()
  private insertCounts = new Map<string, number>()
  private layerCounts = new Map<string, number>()
  private paperSpaceSkipped = 0
  private truncated = false

  constructor(
    private readonly doc: DxfDocument,
    private readonly limits: SceneLimits,
    private readonly onProgress?: (f: number) => void,
  ) {}

  run(): BuildOutput {
    const top: Ctx = { m: IDENTITY, layer: null, rgb: null, insert: -1, owner: -1, depth: 0, stack: [] }
    const list = this.doc.entities
    try {
      for (let i = 0; i < list.length; i++) {
        const e = list[i]
        if (e.paperSpace) {
          this.paperSpaceSkipped++
          continue
        }
        this.emit(e, top)
        if (this.onProgress && (i & 2047) === 0) this.onProgress(i / list.length)
      }
    } catch (err) {
      if (!(err instanceof LimitReached)) throw err
      this.truncated = true
      this.warn('limit', 'hata', `Nesne veya nokta sınırı aşıldı (en fazla ${this.limits.maxEntities.toLocaleString('tr-TR')} nesne, ${this.limits.maxPoints.toLocaleString('tr-TR')} nokta). Çizimin bir kısmı GÖSTERİLMİYOR ve analiz eksiktir.`)
    }
    if (this.paperSpaceSkipped > 0) {
      this.warn('paper-space', 'bilgi', 'Kağıt alanı (layout) nesneleri model görünümüne dahil edilmedi.', this.paperSpaceSkipped)
    }

    const sceneLayers: SceneLayer[] = []
    const seen = new Set<string>()
    for (const l of this.doc.layers.values()) {
      seen.add(l.name)
      sceneLayers.push({
        name: l.name,
        aci: l.color,
        rgb: l.trueColor ?? aciToRgb(l.color),
        off: l.off,
        frozen: l.frozen,
        locked: l.locked,
        count: this.layerCounts.get(l.name) ?? 0,
      })
    }
    for (const [name, count] of this.layerCounts) {
      if (seen.has(name)) continue
      // Katman tablosunda tanımı olmayan katman (AutoCAD varsayılanları kullanılır)
      sceneLayers.push({ name, aci: 7, rgb: 0xffffff, off: false, frozen: false, locked: false, count })
    }
    sceneLayers.sort((a, b) => a.name.localeCompare(b.name, 'tr'))

    let bbox: BBox = EMPTY_BBOX()
    for (const e of this.entities) if (e.owner === -1 && bboxValid(e.bbox)) bbox = bboxUnion(bbox, e.bbox)

    const blocks: SceneBlock[] = []
    for (const b of this.doc.blocks.values()) {
      if (/^\*(Model|Paper)_Space/i.test(b.name)) continue
      blocks.push({
        name: b.name,
        anonymous: b.name.startsWith('*') || (b.flags & 1) === 1,
        xref: (b.flags & 4) === 4,
        entityCount: b.entities.length,
        insertCount: this.insertCounts.get(b.name) ?? 0,
      })
    }
    blocks.sort((a, b) => b.insertCount - a.insertCount || a.name.localeCompare(b.name, 'tr'))

    return {
      scene: {
        coords: this.coords.slice(0, this.len),
        entities: this.entities,
        inserts: this.inserts,
        layers: sceneLayers,
        bbox: bboxValid(bbox) ? bbox : null,
      },
      warnings: [...this.warnings.values()],
      typeCounts: this.typeCounts,
      blocks,
      paperSpaceSkipped: this.paperSpaceSkipped,
      truncated: this.truncated,
    }
  }

  // ---------------------------------------------------------------- yardımcılar

  private warn(code: string, severity: ReportWarning['severity'], message: string, count = 1, handle?: string | null) {
    const w = this.warnings.get(code)
    if (w) {
      w.count = (w.count ?? 1) + count
      if (handle && w.handles && w.handles.length < 20 && !w.handles.includes(handle)) w.handles.push(handle)
    } else {
      this.warnings.set(code, { code, severity, message, count, handles: handle ? [handle] : [] })
    }
  }

  private count(type: string, drawn: boolean) {
    const c = this.typeCounts.get(type) ?? { total: 0, drawn: 0 }
    c.total++
    if (drawn) c.drawn++
    this.typeCounts.set(type, c)
  }

  private layerOf(e: DxfEntity, ctx: Ctx): string {
    return e.layer === '0' && ctx.layer ? ctx.layer : e.layer
  }

  /** Renk çözümü: true color > ACI; BYLAYER katman rengini, BYBLOCK referans rengini alır. ACI 7 → null (tema rengi). */
  private colorOf(e: DxfEntity, layer: string, ctx: Ctx): number | null {
    if (e.trueColor != null) return e.trueColor
    const c = e.color
    if (c === 0) return ctx.rgb
    if (c == null || c === 256) {
      const l = this.doc.layers.get(layer)
      if (!l) return null
      if (l.trueColor != null) return l.trueColor
      return l.color === 7 ? null : aciToRgb(l.color)
    }
    const a = Math.abs(c)
    return a === 7 ? null : aciToRgb(a)
  }

  private pushPoints(pts: ArrayLike<number>): number {
    const n = pts.length
    if ((this.len + n) / 2 > this.limits.maxPoints) throw new LimitReached()
    if (this.len + n > this.coords.length) {
      let size = this.coords.length * 2
      while (size < this.len + n) size *= 2
      const next = new Float64Array(size)
      next.set(this.coords.subarray(0, this.len))
      this.coords = next
    }
    const start = this.len
    for (let i = 0; i < n; i++) this.coords[this.len++] = pts[i]
    return start
  }

  private addEntity(e: DxfEntity | null, type: string, ctx: Ctx, data: Omit<SceneEntity, 'id' | 'type' | 'handle' | 'layer' | 'rgb' | 'insert' | 'owner'> & { layer?: string; rgb?: number | null }): SceneEntity {
    if (this.entities.length >= this.limits.maxEntities) throw new LimitReached()
    const { layer: layerOverride, rgb: rgbOverride, ...rest } = data
    const layer = layerOverride ?? (e ? this.layerOf(e, ctx) : (ctx.layer ?? '0'))
    const ent: SceneEntity = {
      ...rest,
      id: this.entities.length,
      type,
      handle: e?.handle ?? null,
      layer,
      rgb: rgbOverride !== undefined ? rgbOverride : e ? this.colorOf(e, layer, ctx) : ctx.rgb,
      insert: ctx.insert,
      owner: ctx.owner,
    }
    this.entities.push(ent)
    this.layerCounts.set(layer, (this.layerCounts.get(layer) ?? 0) + 1)
    return ent
  }

  /** Dünya koordinatındaki noktalardan yol nesnesi ekler */
  private addPath(
    e: DxfEntity | null,
    type: string,
    ctx: Ctx,
    world: number[],
    closed: boolean,
    metrics: { length: number | null; area: number | null; exact: boolean },
    extra: Partial<SceneEntity> = {},
  ): SceneEntity | null {
    const count = world.length / 2
    if (count < 1) return null
    for (let i = 0; i < world.length; i++) {
      if (!Number.isFinite(world[i])) {
        this.warn('invalid-coord', 'uyari', 'Geçersiz (sonsuz/NaN) koordinat içeren nesneler atlandı.', 1, e?.handle)
        return null
      }
    }
    const start = this.pushPoints(world)
    return this.addEntity(e, type, ctx, {
      kind: 'path',
      start,
      count,
      closed,
      bbox: bboxOf(world),
      length: metrics.length,
      area: metrics.area,
      exact: metrics.exact,
      ...extra,
    })
  }

  private transformAll(m: Mat, local: number[]): number[] {
    const out = new Array<number>(local.length)
    for (let i = 0; i < local.length; i += 2) {
      const [x, y] = apply(m, local[i], local[i + 1])
      out[i] = x
      out[i + 1] = y
    }
    return out
  }

  // ---------------------------------------------------------------- nesneler

  private emit(e: DxfEntity, ctx: Ctx): void {
    if (e.invisible) {
      this.count(e.type, false)
      this.warn('invisible', 'bilgi', 'Görünmez olarak işaretli (60=1) nesneler çizilmedi.', 1, e.handle)
      return
    }
    if (NON_GEOMETRY.has(e.type)) {
      this.count(e.type, false)
      return
    }
    const tiltedType = ['LWPOLYLINE', 'CIRCLE', 'ARC', 'INSERT', 'TEXT', 'HATCH', 'SOLID', 'TRACE', 'POLYLINE', 'ELLIPSE', 'DIMENSION'].includes(e.type)
    if (tiltedType && isTilted(tagExtrusion(e.tags))) {
      this.warn('tilted', 'uyari', 'Eğik düzlemde (3B) çizilmiş nesneler üstten görünüşe izdüşürüldü; bu nesnelerin ölçüleri gerçek uzunluk değildir.', 1, e.handle)
    }
    let drawn = false
    switch (e.type) {
      case 'LINE':
        drawn = this.line(e, ctx)
        break
      case 'LWPOLYLINE':
        drawn = this.lwpolyline(e, ctx)
        break
      case 'POLYLINE':
        drawn = this.polyline(e, ctx)
        break
      case 'CIRCLE':
      case 'ARC':
        drawn = this.circleArc(e, ctx)
        break
      case 'ELLIPSE':
        drawn = this.ellipse(e, ctx)
        break
      case 'SPLINE':
        drawn = this.spline(e, ctx)
        break
      case 'TEXT':
      case 'ATTRIB':
        drawn = this.text(e, ctx)
        break
      case 'MTEXT':
        drawn = this.mtext(e, ctx)
        break
      case 'POINT':
        drawn = this.point(e, ctx)
        break
      case 'INSERT':
        drawn = this.insert(e, ctx)
        break
      case 'DIMENSION':
        drawn = this.dimension(e, ctx)
        break
      case 'HATCH':
        drawn = this.hatch(e, ctx)
        break
      case 'SOLID':
      case 'TRACE':
      case '3DFACE':
        drawn = this.solid(e, ctx)
        break
      case 'LEADER':
        drawn = this.leader(e, ctx)
        break
      case 'ACAD_TABLE':
        drawn = this.blockGroup(e, ctx, tagStr(e.tags, 2)?.trim() ?? null, 'ACAD_TABLE')
        break
      default:
        this.warn(`unsupported:${e.type}`, 'uyari', `Desteklenmeyen nesne türü: ${e.type}`, 1, e.handle)
    }
    this.count(e.type, drawn)
  }

  private line(e: DxfEntity, ctx: Ctx): boolean {
    const p1 = tagPoint(e.tags, 10)
    const p2 = tagPoint(e.tags, 11)
    if (!p1 || !p2) return this.invalid(e)
    const w = this.transformAll(ctx.m, [p1[0], p1[1], p2[0], p2[1]])
    const length = Math.hypot(w[2] - w[0], w[3] - w[1])
    return !!this.addPath(e, 'LINE', ctx, w, false, { length, area: null, exact: true })
  }

  private invalid(e: DxfEntity): false {
    this.warn('invalid-entity', 'uyari', 'Gerekli geometri verisi eksik veya bozuk nesneler atlandı.', 1, e.handle)
    return false
  }

  /** Yerel (OCS) köşe + bulge listesinden nesne oluşturur; ölçüler analitik */
  private bulgePath(e: DxfEntity, type: string, ctx: Ctx, m: Mat, verts: { x: number; y: number; b: number }[], closed: boolean): boolean {
    // Ardışık yinelenen köşeleri ayıkla (kapalı şekilde son köşe = ilk köşe olabilir)
    const v = verts.filter((p, i) => i === 0 || p.x !== verts[i - 1].x || p.y !== verts[i - 1].y || p.b !== verts[i - 1].b)
    if (closed && v.length > 1 && v[0].x === v[v.length - 1].x && v[0].y === v[v.length - 1].y) v.pop()
    if (v.length === 0) return this.invalid(e)
    const local: number[] = [v[0].x, v[0].y]
    let len = 0
    let segArea = 0
    const segs = closed ? v.length : v.length - 1
    let hasBulge = false
    for (let i = 0; i < segs; i++) {
      const a = v[i]
      const b = v[(i + 1) % v.length]
      if (a.b) hasBulge = true
      const pts = bulgePoints(a.x, a.y, b.x, b.y, a.b)
      if (closed && i === segs - 1) pts.splice(pts.length - 2, 2) // kapanış noktası tekrar eklenmez
      local.push(...pts)
      len += bulgeLength(a.x, a.y, b.x, b.y, a.b)
      segArea += bulgeSegmentArea(a.x, a.y, b.x, b.y, a.b)
    }
    const world = this.transformAll(m, local)
    const sim = isSimilarity(m)
    const s = axisScales(m)[0]
    let area: number | null = null
    if (closed && v.length >= 3) {
      const vx: number[] = []
      for (const p of v) vx.push(p.x, p.y)
      // İşaretli toplam: pozitif bulge yolun sağına taşar; CCW çokgende alanı büyütür,
      // CW çokgende küçültür. İşaretli toplamın mutlak değeri her iki durumda doğrudur.
      area = Math.abs((signedArea(vx) + segArea) * det(m))
    } else if (closed && v.length === 2 && hasBulge) {
      area = Math.abs(segArea * det(m))
    }
    const length = sim ? len * s : polylineLength(world, closed)
    const extra: Partial<SceneEntity> = {}
    if (closed && v.length === 4 && !hasBulge) {
      const r = rectOf(world)
      if (r) extra.rect = r
    }
    return !!this.addPath(e, type, ctx, world, closed, { length, area, exact: sim || !hasBulge }, extra)
  }

  private lwpolyline(e: DxfEntity, ctx: Ctx): boolean {
    const verts: { x: number; y: number; b: number }[] = []
    let cur: { x: number; y: number; b: number } | null = null
    for (const [code, value] of e.tags) {
      if (code === 10) {
        cur = { x: Number(value), y: 0, b: 0 }
        verts.push(cur)
      } else if (code === 20 && cur) cur.y = Number(value)
      else if (code === 42 && cur) cur.b = Number(value) || 0
    }
    if (verts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return this.invalid(e)
    const closed = (tagNum(e.tags, 70, 0) & 1) === 1
    const m = mul(ctx.m, ocsToWcs(tagExtrusion(e.tags), tagNum(e.tags, 38, 0)))
    return this.bulgePath(e, 'LWPOLYLINE', ctx, m, verts, closed)
  }

  private polyline(e: DxfEntity, ctx: Ctx): boolean {
    const flags = tagNum(e.tags, 70, 0)
    if (flags & 16 || flags & 64) {
      this.warn('polymesh', 'uyari', 'POLYLINE ağ (mesh / polyface) nesneleri desteklenmiyor ve çizilmedi.', 1, e.handle)
      return false
    }
    const closed = (flags & 1) === 1
    const is3d = (flags & 8) === 8
    const verts: { x: number; y: number; b: number }[] = []
    for (const v of e.vertices ?? []) {
      const vf = tagNum(v.tags, 70, 0)
      if (vf & 16) continue // spline çerçeve kontrol noktası: çizilmez
      const p = tagPoint(v.tags, 10)
      if (!p) continue
      verts.push({ x: p[0], y: p[1], b: is3d ? 0 : tagNum(v.tags, 42, 0) })
    }
    const elevation = tagPoint(e.tags, 10)?.[2] ?? 0
    const m = is3d ? ctx.m : mul(ctx.m, ocsToWcs(tagExtrusion(e.tags), elevation))
    return this.bulgePath(e, 'POLYLINE', ctx, m, verts, closed)
  }

  private circleArc(e: DxfEntity, ctx: Ctx): boolean {
    const c = tagPoint(e.tags, 10)
    const r = tagNum(e.tags, 40)
    if (!c || r == null || !(r > 0)) return this.invalid(e)
    const m = mul(ctx.m, ocsToWcs(tagExtrusion(e.tags), c[2]))
    const isArc = e.type === 'ARC'
    const a0 = isArc ? (tagNum(e.tags, 50, 0) * Math.PI) / 180 : 0
    const sweep = isArc ? ccwSweep(a0, (tagNum(e.tags, 51, 360) * Math.PI) / 180) : 2 * Math.PI
    const local = arcPoints(c[0], c[1], r, a0, sweep)
    if (!isArc) local.splice(local.length - 2, 2)
    const world = this.transformAll(m, local)
    const sim = isSimilarity(m)
    const s = axisScales(m)[0]
    const extra: Partial<SceneEntity> = {}
    if (sim) {
      const [cx, cy] = apply(m, c[0], c[1])
      extra.circle = [cx, cy, r * s]
    }
    return !!this.addPath(e, e.type, ctx, world, !isArc, {
      length: sim ? r * s * sweep : polylineLength(world, !isArc),
      area: isArc ? null : Math.PI * r * r * Math.abs(det(m)),
      // Alan her afin dönüşümde analitiktir; uzunluk yalnızca benzerlik dönüşümünde
      exact: sim,
    }, extra)
  }

  private ellipse(e: DxfEntity, ctx: Ctx): boolean {
    const c = tagPoint(e.tags, 10)
    const maj = tagPoint(e.tags, 11)
    const ratio = tagNum(e.tags, 40, 1)
    if (!c || !maj || !(ratio > 0)) return this.invalid(e)
    const [mnx, mny] = minorAxis(tagExtrusion(e.tags), maj, ratio)
    let p0 = tagNum(e.tags, 41, 0)
    let p1 = tagNum(e.tags, 42, 2 * Math.PI)
    const full = Math.abs(p1 - p0 - 2 * Math.PI) < 1e-9 || (Math.abs(p0) < 1e-12 && Math.abs(p1 - 2 * Math.PI) < 1e-9)
    if (full) {
      p0 = 0
      p1 = 2 * Math.PI
    }
    const sweep = full ? 2 * Math.PI : ccwSweep(p0, p1)
    const n = Math.max(64, Math.min(720, Math.ceil(sweep / ((1 * Math.PI) / 180))))
    const local: number[] = []
    for (let i = 0; i <= n; i++) {
      if (full && i === n) break
      const t = p0 + (sweep * i) / n
      local.push(c[0] + Math.cos(t) * maj[0] + Math.sin(t) * mnx, c[1] + Math.cos(t) * maj[1] + Math.sin(t) * mny)
    }
    const world = this.transformAll(ctx.m, local)
    const a = Math.hypot(maj[0], maj[1], maj[2])
    return !!this.addPath(e, 'ELLIPSE', ctx, world, full, {
      length: polylineLength(world, full),
      area: full ? Math.PI * a * a * ratio * Math.abs(det(ctx.m)) : null,
      exact: false,
    })
  }

  private spline(e: DxfEntity, ctx: Ctx): boolean {
    const degree = tagNum(e.tags, 71, 3)
    const flags = tagNum(e.tags, 70, 0)
    const knots: number[] = []
    const weights: number[] = []
    const control: number[] = []
    const fit: number[] = []
    let pendingX: number | null = null
    let pendingFitX: number | null = null
    for (const [code, value] of e.tags) {
      if (code === 40) knots.push(Number(value))
      else if (code === 41) weights.push(Number(value))
      else if (code === 10) pendingX = Number(value)
      else if (code === 20 && pendingX != null) {
        control.push(pendingX, Number(value))
        pendingX = null
      } else if (code === 11) pendingFitX = Number(value)
      else if (code === 21 && pendingFitX != null) {
        fit.push(pendingFitX, Number(value))
        pendingFitX = null
      }
    }
    let local: number[] | null = null
    if (control.length / 2 >= degree + 1) {
      local = evaluateSpline({ degree, knots, control, weights: flags & 4 ? weights : null }, Math.max(32, Math.min(2000, (control.length / 2) * 16)))
    }
    if (!local && fit.length >= 4) {
      local = catmullRom(fit)
      this.warn('spline-fit', 'uyari', 'Yalnızca uydurma noktası olan SPLINE nesneleri noktalardan geçen yaklaşık eğriyle gösterildi.', 1, e.handle)
    }
    if (!local) return this.invalid(e)
    const closed = (flags & 1) === 1
    const world = this.transformAll(ctx.m, local)
    return !!this.addPath(e, 'SPLINE', ctx, world, false, {
      length: polylineLength(world, false),
      area: closed ? Math.abs(signedArea(world)) : null,
      exact: false,
    })
  }

  private textEntity(e: DxfEntity, type: string, ctx: Ctx, value: string, lines: string[], m: Mat, height: number, ax: number, baseline: number, lineHeight: number) {
    const maxChars = Math.max(1, ...lines.map((l) => l.length))
    const w = height * 0.62 * maxChars
    const x0 = -ax * w
    const yTop = baseline + height
    const yBottom = baseline - (lines.length - 1) * lineHeight - height * 0.25
    const corners = this.transformAll(m, [x0, yBottom, x0 + w, yBottom, x0 + w, yTop, x0, yTop])
    const [px, py] = apply(m, 0, 0)
    const start = this.pushPoints([px, py])
    const text: TextInfo = { value, lines, m, height, ax, baseline, lineHeight }
    this.addEntity(e, type, ctx, { kind: 'text', start, count: 1, closed: false, bbox: bboxOf(corners), length: null, area: null, exact: true, text })
  }

  private text(e: DxfEntity, ctx: Ctx): boolean {
    const raw = tagStr(e.tags, 1)
    if (raw == null) return this.invalid(e)
    if (e.type === 'ATTRIB' && (tagNum(e.tags, 70, 0) & 1) === 1) return false // görünmez öznitelik
    const value = cleanTextCodes(raw)
    if (!value.trim()) return false
    const height = tagNum(e.tags, 40, 1) || 1
    const rot = (tagNum(e.tags, 50, 0) * Math.PI) / 180
    const wf = tagNum(e.tags, 41, 1) || 1
    const gen = tagNum(e.tags, 71, 0)
    // Yatay hizalama 72; dikey hizalama TEXT'te 73, ATTRIB'de 74
    const hj = tagNum(e.tags, 72, 0)
    const vj = tagNum(e.tags, e.type === 'ATTRIB' ? 74 : 73, 0)
    const p10 = tagPoint(e.tags, 10)
    const p11 = tagPoint(e.tags, 11)
    if (!p10) return this.invalid(e)
    let anchor = p10
    let angle = rot
    if ((hj !== 0 || vj !== 0) && p11 && hj !== 3 && hj !== 5) anchor = p11
    if ((hj === 3 || hj === 5) && p11) angle = Math.atan2(p11[1] - p10[1], p11[0] - p10[0])
    const ax = hj === 1 || hj === 4 ? 0.5 : hj === 2 ? 1 : 0
    const ay = hj === 4 ? 0.5 : vj === 2 ? 0.5 : vj === 3 ? 1 : 0
    const m = mul(
      mul(ctx.m, ocsToWcs(tagExtrusion(e.tags), anchor[2])),
      mul(translate(anchor[0], anchor[1]), mul(rotate(angle), scale(wf * (gen & 2 ? -1 : 1), gen & 4 ? -1 : 1))),
    )
    this.textEntity(e, e.type, ctx, value, [value], m, height, ax, -ay * height, height * 1.667)
    return true
  }

  private mtext(e: DxfEntity, ctx: Ctx): boolean {
    let raw = ''
    for (const [code, value] of e.tags) if (code === 3) raw += value
    raw += tagStr(e.tags, 1) ?? ''
    const value = cleanMText(raw)
    if (!value.trim()) return false
    const p = tagPoint(e.tags, 10)
    if (!p) return this.invalid(e)
    const height = tagNum(e.tags, 40, 1) || 1
    const dx = tagNum(e.tags, 11)
    const dy = tagNum(e.tags, 21)
    const angle = dx != null && dy != null && (dx !== 0 || dy !== 0) ? Math.atan2(dy, dx) : (tagNum(e.tags, 50, 0) * Math.PI) / 180
    const attach = tagNum(e.tags, 71, 1)
    const lines = value.split('\n')
    const lineHeight = height * (5 / 3) * (tagNum(e.tags, 44, 1) || 1)
    const total = height + (lines.length - 1) * lineHeight
    const col = (attach - 1) % 3
    const row = Math.floor((attach - 1) / 3)
    const baseline = row === 0 ? -height : row === 1 ? total / 2 - height : (lines.length - 1) * lineHeight
    // MTEXT ekleme noktası WCS'dedir; extrusion yalnızca yönü etkiler (üstten görünüşte aynalama)
    const ext = tagExtrusion(e.tags)
    const mir = ext && ext[2] < 0 ? scale(-1, 1) : IDENTITY
    const m = mul(ctx.m, mul(translate(p[0], p[1]), mul(mir, rotate(angle))))
    this.textEntity(e, 'MTEXT', ctx, value, lines, m, height, col * 0.5, baseline, lineHeight)
    return true
  }

  private point(e: DxfEntity, ctx: Ctx): boolean {
    const p = tagPoint(e.tags, 10)
    if (!p) return this.invalid(e)
    const w = this.transformAll(ctx.m, [p[0], p[1]])
    const start = this.pushPoints(w)
    this.addEntity(e, 'POINT', ctx, { kind: 'point', start, count: 1, closed: false, bbox: [w[0], w[1], w[0], w[1]], length: null, area: null, exact: true })
    return true
  }

  private insert(e: DxfEntity, ctx: Ctx): boolean {
    const name = tagStr(e.tags, 2)?.trim() ?? ''
    const block = this.doc.blocks.get(name)
    // Öznitelikler referansın bulunduğu koordinat sisteminde konumlanır
    const attribs: { tag: string; value: string }[] = []
    for (const a of e.attribs ?? []) {
      const tag = tagStr(a.tags, 2)?.trim() ?? ''
      const value = cleanTextCodes(tagStr(a.tags, 1) ?? '')
      if (tag) attribs.push({ tag, value })
    }
    if (!block) {
      this.warn('missing-block', 'hata', `Tanımı dosyada olmayan blok referansları çizilemedi.`, 1, e.handle)
      return false
    }
    if (block.flags & 4) {
      this.warn('xref', 'uyari', `Dış referans (XREF) içerikleri dosyada yok: ${block.xrefPath ?? name}. Ana çizimle birlikte DXF olarak kaydedin (Bind).`, 1, e.handle)
      return false
    }
    if (ctx.stack.includes(name)) {
      this.warn('block-cycle', 'hata', `Döngüsel blok referansı tespit edildi ("${name}"); döngü kırıldı.`, 1, e.handle)
      return false
    }
    if (ctx.depth >= this.limits.maxDepth) {
      this.warn('block-depth', 'hata', `Blok iç içe derinliği ${this.limits.maxDepth} sınırını aşıyor; daha derin bloklar çizilmedi.`, 1, e.handle)
      return false
    }
    const ins = tagPoint(e.tags, 10) ?? [0, 0, 0]
    const sx = tagNum(e.tags, 41, 1)
    const sy = tagNum(e.tags, 42, 1)
    if (sx === 0 || sy === 0) {
      this.warn('zero-scale', 'uyari', 'Ölçeği sıfır olan blok referansları çizilmedi.', 1, e.handle)
      return false
    }
    const rot = (tagNum(e.tags, 50, 0) * Math.PI) / 180
    const cols = Math.max(1, Math.min(10000, tagNum(e.tags, 70, 1)))
    const rows = Math.max(1, Math.min(10000, tagNum(e.tags, 71, 1)))
    const cs = tagNum(e.tags, 44, 0)
    const rs = tagNum(e.tags, 45, 0)
    const base = mul(ctx.m, mul(ocsToWcs(tagExtrusion(e.tags), ins[2]), mul(translate(ins[0], ins[1]), rotate(rot))))
    const blockLocal = mul(scale(sx, sy), translate(-block.baseX, -block.baseY))
    const layer = this.layerOf(e, ctx)
    const rgb = this.colorOf(e, layer, ctx)
    if (cols * rows > 1) this.warn('minsert', 'bilgi', 'MINSERT (dizi blok) referansları satır/sütun olarak açıldı.', 1, e.handle)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const m = mul(base, mul(translate(c * cs, r * rs), blockLocal))
        const id = this.inserts.length
        const [wsx, wsy] = axisScales(m)
        const ref: SceneInsert = {
          id,
          handle: e.handle,
          block: name,
          layer,
          parent: ctx.insert,
          depth: ctx.depth + 1,
          m,
          firstEntity: this.entities.length,
          endEntity: this.entities.length,
          bbox: EMPTY_BBOX(),
          attribs: r === 0 && c === 0 ? attribs : [],
          sx: wsx,
          sy: wsy,
          rotationDeg: (Math.atan2(m[1], m[0]) * 180) / Math.PI,
          mirrored: det(m) < 0,
          cell: cols * rows > 1 ? [r, c] : null,
        }
        this.inserts.push(ref)
        this.insertCounts.set(name, (this.insertCounts.get(name) ?? 0) + 1)
        const child: Ctx = { m, layer, rgb, insert: id, owner: ctx.owner, depth: ctx.depth + 1, stack: [...ctx.stack, name] }
        for (const be of block.entities) this.emit(be, child)
        ref.endEntity = this.entities.length
        let bb = EMPTY_BBOX()
        for (let i = ref.firstEntity; i < ref.endEntity; i++) bb = bboxUnion(bb, this.entities[i].bbox)
        ref.bbox = bb
      }
    }
    for (const a of e.attribs ?? []) {
      this.count('ATTRIB', this.text(a, { ...ctx, layer: ctx.layer, rgb: ctx.rgb }))
    }
    return true
  }

  /** Bloktan çizilen bileşik nesne (ölçü, tablo): üst grup nesnesi + blok içeriği */
  private blockGroup(e: DxfEntity, ctx: Ctx, blockName: string | null, type: string, dim?: DimInfo, fallback?: () => void): boolean {
    const layer = this.layerOf(e, ctx)
    const group = this.addEntity(e, type, ctx, {
      kind: 'group',
      start: 0,
      count: 0,
      closed: false,
      bbox: EMPTY_BBOX(),
      length: dim?.measurement ?? null,
      area: null,
      exact: true,
      dim,
    })
    const block = blockName ? this.doc.blocks.get(blockName) : undefined
    const first = this.entities.length
    const child: Ctx = {
      ...ctx,
      m: mul(ctx.m, ocsToWcs(tagExtrusion(e.tags))),
      layer,
      rgb: this.colorOf(e, layer, ctx),
      owner: group.id,
      stack: blockName ? [...ctx.stack, blockName] : ctx.stack,
    }
    if (block && !ctx.stack.includes(block.name)) {
      for (const be of block.entities) this.emit(be, child)
    } else if (fallback) {
      fallback()
    } else {
      this.warn('group-no-block', 'uyari', `${type} nesnesinin çizim bloğu bulunamadı.`, 1, e.handle)
    }
    let bb = EMPTY_BBOX()
    for (let i = first; i < this.entities.length; i++) bb = bboxUnion(bb, this.entities[i].bbox)
    if (!bboxValid(bb) && dim?.p1 && dim.p2) bb = bboxOf([...dim.p1, ...dim.p2])
    group.bbox = bb
    return true
  }

  private dimension(e: DxfEntity, ctx: Ctx): boolean {
    const flags = tagNum(e.tags, 70, 0)
    const kindCode = flags & 7
    const kinds: DimInfo['kind'][] = ['dogrusal', 'hizali', 'acisal', 'cap', 'yaricap', 'acisal', 'koordinat']
    const kind = kinds[kindCode] ?? 'bilinmiyor'
    const p10 = tagPoint(e.tags, 10)
    const p13 = tagPoint(e.tags, 13)
    const p14 = tagPoint(e.tags, 14)
    const p15 = tagPoint(e.tags, 15)
    let measurement = tagNum(e.tags, 42)
    let a: [number, number] | null = null
    let b: [number, number] | null = null
    let angle: number | null = null
    const W = (p: [number, number, number] | null) => (p ? apply(ctx.m, p[0], p[1]) : null)
    const s = axisScales(ctx.m)[0]
    if ((kind === 'dogrusal' || kind === 'hizali') && p13 && p14) {
      a = W(p13)
      b = W(p14)
      if (kind === 'dogrusal') {
        const rot = (tagNum(e.tags, 50, 0) * Math.PI) / 180
        if (measurement == null) measurement = Math.abs((p14[0] - p13[0]) * Math.cos(rot) + (p14[1] - p13[1]) * Math.sin(rot))
        const [ux, uy] = [Math.cos(rot), Math.sin(rot)]
        angle = Math.atan2(ctx.m[1] * ux + ctx.m[3] * uy, ctx.m[0] * ux + ctx.m[2] * uy)
      } else {
        if (measurement == null) measurement = Math.hypot(p14[0] - p13[0], p14[1] - p13[1])
        angle = a && b ? Math.atan2(b[1] - a[1], b[0] - a[0]) : null
      }
    } else if ((kind === 'cap' || kind === 'yaricap') && p10 && p15) {
      a = W(p10)
      b = W(p15)
      if (measurement == null) measurement = Math.hypot(p15[0] - p10[0], p15[1] - p10[1])
    }
    // Ölçüler dünya birimine (blok ölçeği) çevrilir; açısal ölçüler uzunluk değildir
    if (kind === 'acisal' || kind === 'koordinat') {
      measurement = kind === 'acisal' ? measurement : null
    } else if (measurement != null) {
      measurement *= s
    }
    const override = tagStr(e.tags, 1)
    const isOverride = override != null && override !== '' && override !== '<>' && !override.includes('<>')
    const blockName = tagStr(e.tags, 2)?.trim() ?? null
    const dim: DimInfo = { kind, measurement, displayed: null, displayedValues: [], override: isOverride, p1: a, p2: b, angle }
    const first = this.entities.length
    this.blockGroup(e, ctx, blockName, 'DIMENSION', dim, () => {
      // Ölçü bloğu yok (bazı programlar oluşturmaz): tanım noktaları arası çizgi ve metin gösterilir
      this.warn('dim-no-block', 'bilgi', 'Bazı ölçülerin çizim bloğu yok; ölçü çizgisi tanım noktalarından basitleştirilmiş gösterildi.', 1, e.handle)
      const groupCtx: Ctx = { ...ctx, owner: this.entities.length - 1 }
      if (a && b) this.addPath(e, 'DIMENSION', groupCtx, [a[0], a[1], b[0], b[1]], false, { length: null, area: null, exact: true })
      const tp = tagPoint(e.tags, 11)
      const shown = isOverride ? cleanMText(override!) : measurement != null ? formatDim(measurement) : null
      if (tp && shown) {
        const h = Math.max(1e-9, (measurement ?? 1) * 0.05)
        const m = mul(ctx.m, mul(translate(tp[0], tp[1]), rotate(((tagNum(e.tags, 53, 0) || 0) * Math.PI) / 180 + (angle ?? 0))))
        this.textEntity(e, 'DIMENSION', groupCtx, shown, [shown], m, h, 0.5, -0.5 * h, h)
      }
    })
    // Görünen metin: blok içindeki ilk metin
    for (let i = first; i < this.entities.length; i++) {
      const t = this.entities[i].text
      if (t) {
        dim.displayed = t.value
        break
      }
    }
    if (dim.displayed == null && isOverride) dim.displayed = cleanMText(override!)
    if (dim.displayed != null) dim.displayedValues = parseNumberCandidates(dim.displayed)
    return true
  }

  private hatch(e: DxfEntity, ctx: Ctx): boolean {
    const parsed = parseHatchLoops(e.tags)
    if (parsed.issue) this.warn('hatch-parse', 'uyari', `Bazı HATCH sınırları okunamadı: ${parsed.issue}`, 1, e.handle)
    if (parsed.loops.length === 0) return this.invalid(e)
    const elevation = tagPoint(e.tags, 10)?.[2] ?? 0
    const m = mul(ctx.m, ocsToWcs(tagExtrusion(e.tags), elevation))
    const solid = tagNum(e.tags, 70, 0) === 1
    const pattern = tagStr(e.tags, 2)?.trim() ?? ''
    const group = this.addEntity(e, 'HATCH', ctx, {
      kind: 'group',
      start: 0,
      count: 0,
      closed: true,
      bbox: EMPTY_BBOX(),
      length: null,
      area: null,
      exact: parsed.loops.every((l) => l.exact),
      hatch: { solid, pattern, loops: parsed.loops.length },
    })
    const worldLoops: number[][] = []
    const childCtx: Ctx = { ...ctx, owner: group.id }
    let bb = EMPTY_BBOX()
    for (const loop of parsed.loops) {
      const w = this.transformAll(m, loop.points)
      if (w.length < 6) continue
      worldLoops.push(w)
      const ent = this.addPath(e, 'HATCH', childCtx, w, true, { length: polylineLength(w, true), area: Math.abs(signedArea(w)), exact: loop.exact })
      if (ent) bb = bboxUnion(bb, ent.bbox)
    }
    group.bbox = bb
    // Çift-tek kuralı: bir döngü, kendisini içeren döngü sayısı tek ise deliktir
    let area = 0
    for (let i = 0; i < worldLoops.length; i++) {
      const L = worldLoops[i]
      let depth = 0
      for (let j = 0; j < worldLoops.length; j++) {
        if (i !== j && pointInPolygon(L[0], L[1], worldLoops[j])) depth++
      }
      area += (depth % 2 === 0 ? 1 : -1) * Math.abs(signedArea(L))
    }
    group.area = Math.abs(area)
    return true
  }

  private solid(e: DxfEntity, ctx: Ctx): boolean {
    const p = [tagPoint(e.tags, 10), tagPoint(e.tags, 11), tagPoint(e.tags, 12), tagPoint(e.tags, 13)]
    if (!p[0] || !p[1] || !p[2]) return this.invalid(e)
    const m = e.type === '3DFACE' ? ctx.m : mul(ctx.m, ocsToWcs(tagExtrusion(e.tags), p[0][2]))
    // SOLID köşe sırası 1-2-4-3 (DXF kuralı); 3DFACE 1-2-3-4
    const order = e.type === '3DFACE' ? [0, 1, 2, 3] : [0, 1, 3, 2]
    const local: number[] = []
    for (const i of order) {
      const q = p[i] ?? p[2]!
      if (local.length >= 2 && local[local.length - 2] === q[0] && local[local.length - 1] === q[1]) continue
      local.push(q[0], q[1])
    }
    const w = this.transformAll(m, local)
    return !!this.addPath(e, e.type, ctx, w, true, { length: polylineLength(w, true), area: Math.abs(signedArea(w)), exact: true })
  }

  private leader(e: DxfEntity, ctx: Ctx): boolean {
    const local: number[] = []
    let x: number | null = null
    for (const [code, value] of e.tags) {
      if (code === 10) x = Number(value)
      else if (code === 20 && x != null) {
        local.push(x, Number(value))
        x = null
      }
    }
    if (local.length < 4) return this.invalid(e)
    const w = this.transformAll(ctx.m, local)
    return !!this.addPath(e, 'LEADER', ctx, w, false, { length: polylineLength(w, false), area: null, exact: true })
  }
}

// ------------------------------------------------------------------ yardımcılar (dışa açık: test edilir)

export { rectOf }

export function formatDim(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '')
}

interface HatchLoop {
  points: number[]
  exact: boolean
}

/**
 * HATCH sınır döngülerini okur. Grup kodları bağlama göre tekrar ettiği için etiketler
 * sırayla ve beklenen yapıya göre okunur; yapı bozuksa okunabilen döngüler döner.
 */
export function parseHatchLoops(tags: Tag[]): { loops: HatchLoop[]; issue: string | null } {
  const loops: HatchLoop[] = []
  let i = tags.findIndex((t) => t[0] === 91)
  if (i === -1) return { loops, issue: 'sınır sayısı (91) yok' }
  const total = Number(tags[i][1])
  i++
  const at = (code: number): number | null => {
    if (i < tags.length && tags[i][0] === code) {
      const v = Number(tags[i][1])
      i++
      return Number.isFinite(v) ? v : null
    }
    return null
  }
  const need = (code: number): number => {
    const v = at(code)
    if (v == null) throw new Error(`grup kodu ${code} bekleniyordu`)
    return v
  }
  try {
    for (let p = 0; p < total; p++) {
      const flags = need(92)
      const pts: number[] = []
      let exact = true
      const add = (x: number, y: number) => {
        const n = pts.length
        if (n >= 2 && Math.abs(pts[n - 2] - x) < 1e-12 && Math.abs(pts[n - 1] - y) < 1e-12) return
        pts.push(x, y)
      }
      if (flags & 2) {
        const hasBulge = need(72)
        need(73) // kapalı bayrağı (döngü her zaman kapalı kabul edilir)
        const nv = need(93)
        const verts: { x: number; y: number; b: number }[] = []
        for (let k = 0; k < nv; k++) {
          const x = need(10)
          const y = need(20)
          const b = hasBulge ? (at(42) ?? 0) : 0
          verts.push({ x, y, b })
        }
        for (let k = 0; k < verts.length; k++) {
          const a = verts[k]
          const b = verts[(k + 1) % verts.length]
          if (k === 0) add(a.x, a.y)
          const seg = bulgePoints(a.x, a.y, b.x, b.y, a.b)
          for (let q = 0; q < seg.length; q += 2) add(seg[q], seg[q + 1])
        }
      } else {
        const ne = need(93)
        for (let k = 0; k < ne; k++) {
          const type = need(72)
          if (type === 1) {
            const x1 = need(10)
            const y1 = need(20)
            const x2 = need(11)
            const y2 = need(21)
            add(x1, y1)
            add(x2, y2)
          } else if (type === 2 || type === 3) {
            const cx = need(10)
            const cy = need(20)
            let mx = 0
            let my = 0
            if (type === 3) {
              mx = need(11)
              my = need(21)
            }
            const r = need(40)
            const s = need(50)
            const eAng = need(51)
            const ccw = (at(73) ?? 1) === 1
            // Saat yönündeki yaylarda açılar 360-açı olarak saklanır (ezdxf ile aynı yorum)
            const a0 = ((ccw ? s : 360 - eAng) * Math.PI) / 180
            const a1 = ((ccw ? eAng : 360 - s) * Math.PI) / 180
            let seg: number[]
            if (type === 2) {
              const sweep = Math.abs(a1 - a0 - 2 * Math.PI) < 1e-9 ? 2 * Math.PI : ccwSweep(a0, a1)
              seg = arcPoints(cx, cy, r, a0, sweep)
            } else {
              const ratio = r
              const toParam = (a: number) => Math.atan2(Math.sin(a) / ratio, Math.cos(a))
              const t0 = toParam(a0)
              const sweep = ccwSweep(t0, toParam(a1))
              const nx = -my * ratio
              const ny = mx * ratio
              seg = []
              const n = Math.max(16, Math.ceil(sweep / (Math.PI / 90)))
              for (let q = 0; q <= n; q++) {
                const t = t0 + (sweep * q) / n
                seg.push(cx + Math.cos(t) * mx + Math.sin(t) * nx, cy + Math.cos(t) * my + Math.sin(t) * ny)
              }
              exact = false
            }
            if (!ccw) {
              const rev: number[] = []
              for (let q = seg.length - 2; q >= 0; q -= 2) rev.push(seg[q], seg[q + 1])
              seg = rev
            }
            for (let q = 0; q < seg.length; q += 2) add(seg[q], seg[q + 1])
            exact = false
          } else if (type === 4) {
            const degree = need(94)
            const rational = need(73)
            need(74)
            const nk = need(95)
            const nc = need(96)
            const knots: number[] = []
            for (let q = 0; q < nk; q++) knots.push(need(40))
            const control: number[] = []
            const weights: number[] = []
            for (let q = 0; q < nc; q++) {
              control.push(need(10), need(20))
              const w = at(42)
              if (w != null) weights.push(w)
            }
            const nf = at(97)
            if (nf != null) {
              for (let q = 0; q < nf; q++) {
                need(11)
                need(21)
              }
              if (at(12) != null) need(22)
              if (at(13) != null) need(23)
            }
            const seg = evaluateSpline({ degree, knots, control, weights: rational ? weights : null }, Math.max(32, nc * 8))
            if (!seg) throw new Error('geçersiz spline kenarı')
            for (let q = 0; q < seg.length; q += 2) add(seg[q], seg[q + 1])
            exact = false
          } else {
            throw new Error(`bilinmeyen kenar türü ${type}`)
          }
        }
      }
      // Kaynak sınır nesneleri
      const ns = at(97)
      if (ns != null) for (let q = 0; q < ns; q++) at(330)
      // Kapanış noktası tekrarını kaldır
      if (pts.length >= 4 && Math.abs(pts[0] - pts[pts.length - 2]) < 1e-12 && Math.abs(pts[1] - pts[pts.length - 1]) < 1e-12) pts.splice(pts.length - 2, 2)
      if (pts.length >= 6) loops.push({ points: pts, exact })
    }
  } catch (err) {
    return { loops, issue: err instanceof Error ? err.message : 'bilinmeyen hata' }
  }
  return { loops, issue: null }
}
