/**
 * LEONX CAD görüntüleyici motoru (Canvas 2D).
 *
 * Neden Canvas 2D?
 * - SVG her nesne için DOM düğümü oluşturur; 100 binlerce nesnede bellek ve yeniden çizim
 *   maliyeti kabul edilemez.
 * - WebGL çok hızlıdır ancak çizgi kalınlığı, metin ve seçim için ayrı altyapı gerektirir;
 *   eski iPad'lerde bağlam kaybı da ayrıca yönetilmelidir.
 * - Canvas 2D'de nesneler katman+renk gruplarına göre önceden hazırlanmış Path2D
 *   yollarında tutulur; her karede yalnızca dönüşüm değişir. 300 bin nesnelik
 *   çizimlerde kaydırma/yakınlaştırma akıcı kalır, metin ve seçim yerel API ile çizilir.
 *
 * Motor React'ten bağımsızdır; arayüz yalnızca durum bildirir, olaylar geri çağrılarla döner.
 * Koordinatlar çizim merkezine göre kaydırılarak Path2D'ye yazılır (büyük koordinatlarda
 * kayan nokta hassasiyeti korunur).
 */
import { type BBox, distToSegment, signedArea } from '../geometry'
import type { Scene, SceneEntity } from '../types'
import { SpatialGrid } from './spatialIndex'

export type ViewerTool = 'select' | 'pan' | 'distance' | 'area' | 'calibrate'

export type Pt = [number, number]

export interface Measurement {
  id: number
  kind: 'distance' | 'area' | 'calibrate'
  points: Pt[]
  closed: boolean
}

export interface ViewerTheme {
  background: string
  ink: string
  accent: string
  measure: string
  highlight: string
  dark: boolean
}

export interface ViewerFormat {
  length: (worldLength: number) => string
  area: (worldArea: number) => string
}

export interface ViewerCallbacks {
  onCursor?: (p: Pt | null, snapped: boolean) => void
  onSelect?: (id: number | null, additive: boolean) => void
  onMeasurements?: (list: Measurement[], active: Measurement | null) => void
  onCalibrate?: (points: [Pt, Pt]) => void
  onViewChange?: (pxPerUnit: number) => void
}

export interface BackgroundImage {
  image: CanvasImageSource
  /** Görüntünün dünya koordinatlarındaki konumu [minx, miny, maxx, maxy] */
  rect: BBox
}

interface Batch {
  layer: string
  rgb: number | null
  stroke: Path2D
  fill: Path2D | null
}

const SNAP_PX = 10
const PICK_PX = 6
const MAX_TEXTS_PER_FRAME = 6000

function hex(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, '0')}`
}

/** Arka plana göre çok düşük kontrastlı renkleri (ör. beyaz zeminde sarı) görünür yapar. */
export function adjustColor(rgb: number, darkBackground: boolean): string {
  const r = (rgb >> 16) & 255
  const g = (rgb >> 8) & 255
  const b = rgb & 255
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  if (darkBackground && lum < 0.12) {
    const k = 0.45
    return `rgb(${Math.round(r + (255 - r) * k)} ${Math.round(g + (255 - g) * k)} ${Math.round(b + (255 - b) * k)})`
  }
  if (!darkBackground && lum > 0.72) {
    const k = 0.55
    return `rgb(${Math.round(r * k)} ${Math.round(g * k)} ${Math.round(b * k)})`
  }
  return hex(rgb)
}

export class ViewerEngine {
  private ctx: CanvasRenderingContext2D
  private dpr = 1
  private width = 0
  private height = 0
  private scene: Scene | null = null
  private background: BackgroundImage | null = null
  private origin: Pt = [0, 0]
  private batches: Batch[] = []
  private points: number[] = []
  private texts: number[] = []
  private children = new Map<number, number[]>()
  private grid: SpatialGrid | null = null
  private hidden = new Set<string>()
  private selection = new Set<number>()
  private highlights: { ids: number[]; color: string }[] = []
  private theme: ViewerTheme = { background: '#1b1f24', ink: '#e8ebee', accent: '#4aa3ff', measure: '#ffb02e', highlight: '#3ddc97', dark: true }
  private colorCache = new Map<number, string>()
  private format: ViewerFormat = { length: (v) => v.toFixed(2), area: (v) => v.toFixed(2) }
  private tool: ViewerTool = 'select'
  private measurements: Measurement[] = []
  private active: Measurement | null = null
  private measureSeq = 1
  // Kamera: s = ekran pikseli / dünya birimi; (cx, cy) = görünüm merkezi (merkeze göre)
  private s = 1
  private cx = 0
  private cy = 0
  private fitScale = 1
  private cursor: { screen: Pt; world: Pt; snapped: boolean } | null = null
  private pointers = new Map<number, Pt>()
  private gesture:
    | { kind: 'none' }
    | { kind: 'press'; start: Pt; button: number; moved: boolean; time: number }
    | { kind: 'pan'; last: Pt }
    | { kind: 'pinch'; startDist: number; startScale: number; anchorWorld: Pt; lastMid: Pt } = { kind: 'none' }
  private spaceDown = false
  private raf = 0
  private lastClick = { time: 0, x: 0, y: 0 }
  private readonly listeners: [string, EventListener, AddEventListenerOptions?][] = []
  private resizeObs: ResizeObserver | null = null

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private callbacks: ViewerCallbacks = {},
  ) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Canvas 2D desteklenmiyor')
    this.ctx = ctx
    this.listen('pointerdown', (e) => this.onPointerDown(e as PointerEvent))
    this.listen('pointermove', (e) => this.onPointerMove(e as PointerEvent))
    this.listen('pointerup', (e) => this.onPointerUp(e as PointerEvent))
    this.listen('pointercancel', (e) => this.onPointerUp(e as PointerEvent, true))
    this.listen('pointerleave', () => {
      if (this.pointers.size === 0) {
        this.cursor = null
        this.callbacks.onCursor?.(null, false)
        this.requestRender()
      }
    })
    this.listen('wheel', (e) => this.onWheel(e as WheelEvent), { passive: false })
    this.listen('contextmenu', (e) => e.preventDefault())
    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(canvas)
    this.resize()
  }

  private listen(type: string, fn: EventListener, opts?: AddEventListenerOptions) {
    this.canvas.addEventListener(type, fn, opts)
    this.listeners.push([type, fn, opts])
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    for (const [t, fn, o] of this.listeners) this.canvas.removeEventListener(t, fn, o)
    this.resizeObs?.disconnect()
    this.scene = null
    this.batches = []
    this.grid = null
  }

  setCallbacks(cb: ViewerCallbacks): void {
    this.callbacks = cb
  }

  // ---------------------------------------------------------------- durum

  setScene(scene: Scene | null, background: BackgroundImage | null = null): void {
    this.scene = scene
    this.background = background
    this.selection.clear()
    this.highlights = []
    this.measurements = []
    this.active = null
    this.batches = []
    this.points = []
    this.texts = []
    this.children = new Map()
    this.grid = null
    const bounds = scene?.bbox ?? background?.rect ?? null
    if (bounds) this.origin = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
    if (scene) this.buildBatches(scene)
    this.zoomExtents()
    this.emitMeasurements()
  }

  setBackground(bg: BackgroundImage | null): void {
    this.background = bg
    this.requestRender()
  }

  private buildBatches(scene: Scene): void {
    const [ox, oy] = this.origin
    const byKey = new Map<string, Batch>()
    const c = scene.coords
    const boxes: (BBox | null)[] = new Array(scene.entities.length)
    const solidOwners = new Set<number>()
    for (const e of scene.entities) if (e.hatch?.solid) solidOwners.add(e.id)
    for (const e of scene.entities) {
      boxes[e.id] = e.kind === 'group' ? null : e.bbox
      if (e.owner >= 0) {
        const list = this.children.get(e.owner)
        if (list) list.push(e.id)
        else this.children.set(e.owner, [e.id])
      }
      if (e.kind === 'text') {
        this.texts.push(e.id)
        continue
      }
      if (e.kind === 'point') {
        this.points.push(e.id)
        continue
      }
      if (e.kind !== 'path' || e.count < 1) continue
      const key = `${e.layer}\u0000${e.rgb ?? -1}`
      let b = byKey.get(key)
      if (!b) {
        b = { layer: e.layer, rgb: e.rgb, stroke: new Path2D(), fill: null }
        byKey.set(key, b)
      }
      const add = (p: Path2D) => {
        p.moveTo(c[e.start] - ox, c[e.start + 1] - oy)
        if (e.count === 1) p.lineTo(c[e.start] - ox, c[e.start + 1] - oy)
        for (let i = 1; i < e.count; i++) p.lineTo(c[e.start + 2 * i] - ox, c[e.start + 2 * i + 1] - oy)
        if (e.closed) p.closePath()
      }
      add(b.stroke)
      if (e.owner >= 0 && solidOwners.has(e.owner)) {
        b.fill ??= new Path2D()
        add(b.fill)
      }
    }
    this.batches = [...byKey.values()]
    if (scene.bbox) this.grid = new SpatialGrid(scene.bbox, boxes)
  }

  setHiddenLayers(hidden: Set<string>): void {
    this.hidden = new Set(hidden)
    this.requestRender()
  }

  setSelection(ids: Iterable<number>): void {
    this.selection = new Set(ids)
    this.requestRender()
  }

  setHighlights(groups: { ids: number[]; color: string }[]): void {
    this.highlights = groups
    this.requestRender()
  }

  setTheme(theme: ViewerTheme): void {
    this.theme = theme
    this.colorCache.clear()
    this.requestRender()
  }

  setFormat(format: ViewerFormat): void {
    this.format = format
    this.requestRender()
  }

  setTool(tool: ViewerTool): void {
    if (tool === this.tool) return
    this.tool = tool
    this.active = null
    this.canvas.style.cursor = tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair'
    this.emitMeasurements()
    this.requestRender()
  }

  get currentTool(): ViewerTool {
    return this.tool
  }

  clearMeasurements(): void {
    this.measurements = []
    this.active = null
    this.emitMeasurements()
    this.requestRender()
  }

  removeMeasurement(id: number): void {
    this.measurements = this.measurements.filter((m) => m.id !== id)
    this.emitMeasurements()
    this.requestRender()
  }

  /** Klavye: Escape etkin ölçümü iptal eder, Enter alanı kapatır, Backspace son noktayı siler */
  key(key: string): boolean {
    if (key === 'Escape') {
      if (this.active) {
        this.active = null
        this.emitMeasurements()
        this.requestRender()
        return true
      }
      return false
    }
    if (key === 'Enter' && this.active?.kind === 'area') {
      this.finishArea()
      return true
    }
    if (key === 'Backspace' && this.active) {
      this.active.points.pop()
      if (this.active.points.length === 0) this.active = null
      this.emitMeasurements()
      this.requestRender()
      return true
    }
    if (key === ' ') {
      this.spaceDown = true
      return false
    }
    return false
  }

  keyUp(key: string): void {
    if (key === ' ') this.spaceDown = false
  }

  // ---------------------------------------------------------------- kamera

  resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    if (w === this.width && h === this.height && dpr === this.dpr) return
    const first = this.width === 0
    this.width = w
    this.height = h
    this.dpr = dpr
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    if (first) this.zoomExtents()
    else this.requestRender()
  }

  private contentBounds(): BBox | null {
    return this.scene?.bbox ?? this.background?.rect ?? null
  }

  zoomExtents(): void {
    const b = this.contentBounds()
    if (!b || this.width === 0) {
      this.requestRender()
      return
    }
    this.zoomToBox(b, 0.06)
    this.fitScale = this.s
  }

  zoomToBox(b: BBox, margin = 0.15): void {
    const w = Math.max(b[2] - b[0], 1e-9)
    const h = Math.max(b[3] - b[1], 1e-9)
    this.s = Math.min((this.width * (1 - 2 * margin)) / w, (this.height * (1 - 2 * margin)) / h)
    if (!Number.isFinite(this.s) || this.s <= 0) this.s = 1
    this.cx = (b[0] + b[2]) / 2 - this.origin[0]
    this.cy = (b[1] + b[3]) / 2 - this.origin[1]
    this.callbacks.onViewChange?.(this.s)
    this.requestRender()
  }

  zoomBy(factor: number, at?: Pt): void {
    const p = at ?? [this.width / 2, this.height / 2]
    const before = this.toWorldRel(p)
    const min = this.fitScale * 1e-3
    const max = this.fitScale * 1e7
    this.s = Math.max(min, Math.min(max, this.s * factor))
    const after = this.toWorldRel(p)
    this.cx += before[0] - after[0]
    this.cy += before[1] - after[1]
    this.callbacks.onViewChange?.(this.s)
    this.requestRender()
  }

  /** Ekran (CSS piksel) → merkeze göre dünya */
  private toWorldRel(p: Pt): Pt {
    return [(p[0] - this.width / 2) / this.s + this.cx, -(p[1] - this.height / 2) / this.s + this.cy]
  }

  toWorld(p: Pt): Pt {
    const r = this.toWorldRel(p)
    return [r[0] + this.origin[0], r[1] + this.origin[1]]
  }

  toScreen(w: Pt): Pt {
    return [(w[0] - this.origin[0] - this.cx) * this.s + this.width / 2, this.height / 2 - (w[1] - this.origin[1] - this.cy) * this.s]
  }

  get pxPerUnit(): number {
    return this.s
  }

  // ---------------------------------------------------------------- seçim ve yakalama

  private visibleEntity(e: SceneEntity): boolean {
    return !this.hidden.has(e.layer)
  }

  /** Ekran noktasındaki en yakın nesne (grup üyeleri için üst nesne döner) */
  pick(screen: Pt): number | null {
    if (!this.scene || !this.grid) return null
    const [wx, wy] = this.toWorld(screen)
    const tol = PICK_PX / this.s
    const cands = this.grid.query([wx - tol, wy - tol, wx + tol, wy + tol], 5000)
    const c = this.scene.coords
    let best: number | null = null
    let bestD = tol
    for (const id of cands) {
      const e = this.scene.entities[id]
      if (!this.visibleEntity(e)) continue
      let d = Infinity
      if (e.kind === 'text') {
        const b = e.bbox
        if (wx >= b[0] && wx <= b[2] && wy >= b[1] && wy <= b[3]) d = 0
      } else if (e.kind === 'point') {
        d = Math.hypot(c[e.start] - wx, c[e.start + 1] - wy)
      } else if (e.kind === 'path') {
        const n = e.count
        for (let i = 0; i < n - 1; i++) {
          const k = e.start + 2 * i
          d = Math.min(d, distToSegment(wx, wy, c[k], c[k + 1], c[k + 2], c[k + 3]))
        }
        if (e.closed && n > 2) {
          const k = e.start + 2 * (n - 1)
          d = Math.min(d, distToSegment(wx, wy, c[k], c[k + 1], c[e.start], c[e.start + 1]))
        }
        if (n === 1) d = Math.hypot(c[e.start] - wx, c[e.start + 1] - wy)
      }
      if (d <= bestD) {
        bestD = d
        best = e.owner >= 0 ? e.owner : e.id
      }
    }
    return best
  }

  /** Köşe, orta nokta ve daire merkezine yakalama */
  snap(screen: Pt): { world: Pt; snapped: boolean } {
    const world = this.toWorld(screen)
    if (!this.scene || !this.grid) return { world, snapped: false }
    const tol = SNAP_PX / this.s
    const [wx, wy] = world
    const cands = this.grid.query([wx - tol, wy - tol, wx + tol, wy + tol], 3000)
    const c = this.scene.coords
    let best: Pt | null = null
    let bestD = tol
    const test = (x: number, y: number) => {
      const d = Math.hypot(x - wx, y - wy)
      if (d < bestD) {
        bestD = d
        best = [x, y]
      }
    }
    for (const id of cands) {
      const e = this.scene.entities[id]
      if (!this.visibleEntity(e)) continue
      if (e.kind === 'path' || e.kind === 'point') {
        // Çok noktalı yaylarda tüm parça noktaları yerine yalnızca uçlar anlamlıdır
        const step = e.count > 64 && e.circle === undefined ? Math.ceil(e.count / 64) : 1
        for (let i = 0; i < e.count; i += step) test(c[e.start + 2 * i], c[e.start + 2 * i + 1])
        if (e.count > 1) test(c[e.start + 2 * (e.count - 1)], c[e.start + 2 * (e.count - 1) + 1])
        if (e.type === 'LINE' && e.count === 2) test((c[e.start] + c[e.start + 2]) / 2, (c[e.start + 1] + c[e.start + 3]) / 2)
        if (e.circle) test(e.circle[0], e.circle[1])
      }
    }
    return best ? { world: best, snapped: true } : { world, snapped: false }
  }

  // ---------------------------------------------------------------- olaylar

  private eventPoint(e: PointerEvent | WheelEvent): Pt {
    const r = this.canvas.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  private onPointerDown(e: PointerEvent): void {
    this.canvas.setPointerCapture?.(e.pointerId)
    const p = this.eventPoint(e)
    this.pointers.set(e.pointerId, p)
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      this.gesture = { kind: 'pinch', startDist: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), startScale: this.s, anchorWorld: this.toWorldRel(mid), lastMid: mid }
      return
    }
    if (this.pointers.size > 2) return
    if (e.button === 1 || e.button === 2 || this.tool === 'pan' || this.spaceDown) {
      this.gesture = { kind: 'pan', last: p }
      this.canvas.style.cursor = 'grabbing'
      e.preventDefault()
      return
    }
    this.gesture = { kind: 'press', start: p, button: e.button, moved: false, time: performance.now() }
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.eventPoint(e)
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p)
    const g = this.gesture
    if (g.kind === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()]
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const dist = Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1]))
      const min = this.fitScale * 1e-3
      const max = this.fitScale * 1e7
      this.s = Math.max(min, Math.min(max, (g.startScale * dist) / g.startDist))
      // Parmakların ortasındaki dünya noktası sabit kalır
      const now = this.toWorldRel(mid)
      this.cx += g.anchorWorld[0] - now[0]
      this.cy += g.anchorWorld[1] - now[1]
      g.lastMid = mid
      this.callbacks.onViewChange?.(this.s)
      this.requestRender()
      return
    }
    if (g.kind === 'pan') {
      this.cx -= (p[0] - g.last[0]) / this.s
      this.cy += (p[1] - g.last[1]) / this.s
      g.last = p
      this.requestRender()
      return
    }
    if (g.kind === 'press') {
      const moved = Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) > (e.pointerType === 'touch' ? 8 : 4)
      if (moved) {
        // Sol tuşla sürükleme veya tek parmak: kaydırma
        this.gesture = { kind: 'pan', last: g.start }
        this.onPointerMove(e)
        return
      }
    }
    const measuring = this.tool === 'distance' || this.tool === 'area' || this.tool === 'calibrate'
    const sn = measuring ? this.snap(p) : { world: this.toWorld(p), snapped: false }
    this.cursor = { screen: p, world: sn.world, snapped: sn.snapped }
    this.callbacks.onCursor?.(sn.world, sn.snapped)
    if (measuring || this.cursor) this.requestRender()
  }

  private onPointerUp(e: PointerEvent, cancelled = false): void {
    const g = this.gesture
    this.pointers.delete(e.pointerId)
    if (this.pointers.size === 1 && g.kind === 'pinch') {
      // İki parmaktan birine dönüldü: kalan parmakla kaydırmaya devam
      this.gesture = { kind: 'pan', last: [...this.pointers.values()][0] }
      return
    }
    if (this.pointers.size > 0) return
    this.gesture = { kind: 'none' }
    if (this.tool === 'pan') this.canvas.style.cursor = 'grab'
    else if (this.tool === 'select') this.canvas.style.cursor = 'default'
    else this.canvas.style.cursor = 'crosshair'
    if (cancelled || g.kind !== 'press' || g.button !== 0) return
    const p = this.eventPoint(e)
    const now = performance.now()
    const dbl = now - this.lastClick.time < 350 && Math.hypot(p[0] - this.lastClick.x, p[1] - this.lastClick.y) < 8
    this.lastClick = { time: now, x: p[0], y: p[1] }
    this.click(p, e.shiftKey || e.ctrlKey || e.metaKey, dbl)
  }

  private click(p: Pt, additive: boolean, dbl: boolean): void {
    if (this.tool === 'select' || this.tool === 'pan') {
      this.callbacks.onSelect?.(this.pick(p), additive)
      return
    }
    const { world } = this.snap(p)
    if (this.tool === 'distance' || this.tool === 'calibrate') {
      if (!this.active) {
        this.active = { id: this.measureSeq++, kind: this.tool, points: [world], closed: false }
      } else {
        this.active.points.push(world)
        const done = this.active
        this.active = null
        if (done.kind === 'calibrate') {
          this.callbacks.onCalibrate?.([done.points[0], done.points[1]])
        } else {
          this.measurements.push(done)
        }
      }
    } else if (this.tool === 'area') {
      if (!this.active) {
        this.active = { id: this.measureSeq++, kind: 'area', points: [world], closed: false }
      } else {
        const first = this.toScreen(this.active.points[0])
        const nearFirst = Math.hypot(first[0] - p[0], first[1] - p[1]) < SNAP_PX
        if ((nearFirst || dbl) && this.active.points.length >= 3) {
          this.finishArea()
          return
        }
        if (!dbl) this.active.points.push(world)
      }
    }
    this.emitMeasurements()
    this.requestRender()
  }

  private finishArea(): void {
    if (!this.active || this.active.kind !== 'area') return
    if (this.active.points.length >= 3) {
      this.active.closed = true
      this.measurements.push(this.active)
    }
    this.active = null
    this.emitMeasurements()
    this.requestRender()
  }

  private emitMeasurements(): void {
    this.callbacks.onMeasurements?.(
      this.measurements.map((m) => ({ ...m, points: m.points.slice() })),
      this.active ? { ...this.active, points: this.active.points.slice() } : null,
    )
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault()
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? this.height : 1
    // Trackpad yakınlaştırma hareketi ctrlKey ile gelir (daha hassas)
    const k = e.ctrlKey ? 0.01 : 0.0015
    this.zoomBy(Math.exp(-e.deltaY * unit * k), this.eventPoint(e))
  }

  // ---------------------------------------------------------------- çizim

  requestRender(): void {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.render()
    })
  }

  private colorFor(rgb: number | null): string {
    if (rgb == null) return this.theme.ink
    let c = this.colorCache.get(rgb)
    if (!c) {
      c = adjustColor(rgb, this.theme.dark)
      this.colorCache.set(rgb, c)
    }
    return c
  }

  /** Merkeze göre dünya → cihaz pikseli dönüşümü */
  private baseTransform(): [number, number, number, number, number, number] {
    const d = this.dpr
    return [d * this.s, 0, 0, -d * this.s, d * (this.width / 2 - this.cx * this.s), d * (this.height / 2 + this.cy * this.s)]
  }

  render(): void {
    const ctx = this.ctx
    const d = this.dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = this.theme.background
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    const T = this.baseTransform()

    if (this.background) {
      const [x0, y0, x1, y1] = this.background.rect
      ctx.setTransform(T[0], T[1], T[2], T[3], T[4], T[5])
      ctx.translate(x0 - this.origin[0], y1 - this.origin[1])
      ctx.scale(1, -1)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(this.background.image, 0, 0, x1 - x0, y1 - y0)
    }

    if (this.scene) {
      ctx.setTransform(T[0], T[1], T[2], T[3], T[4], T[5])
      ctx.lineWidth = 1 / this.s
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      for (const b of this.batches) {
        if (this.hidden.has(b.layer)) continue
        const col = this.colorFor(b.rgb)
        if (b.fill) {
          ctx.globalAlpha = 0.22
          ctx.fillStyle = col
          ctx.fill(b.fill, 'evenodd')
          ctx.globalAlpha = 1
        }
        ctx.strokeStyle = col
        ctx.stroke(b.stroke)
      }
      this.renderPoints(T)
      this.renderTexts(T)
      for (const h of this.highlights) this.renderEntities(h.ids, h.color, 2.2, T, 0.9)
      if (this.selection.size) this.renderEntities([...this.selection], this.theme.accent, 2.8, T, 1)
    }
    ctx.setTransform(d, 0, 0, d, 0, 0)
    this.renderMeasurements()
    this.renderCursor()
  }

  private viewBox(): BBox {
    const a = this.toWorld([0, this.height])
    const b = this.toWorld([this.width, 0])
    return [a[0], a[1], b[0], b[1]]
  }

  private renderPoints(T: number[]): void {
    if (!this.scene || this.points.length === 0) return
    const ctx = this.ctx
    const c = this.scene.coords
    const r = 3 / this.s
    ctx.setTransform(T[0], T[1], T[2], T[3], T[4], T[5])
    ctx.lineWidth = 1 / this.s
    for (const id of this.points) {
      const e = this.scene.entities[id]
      if (this.hidden.has(e.layer)) continue
      const x = c[e.start] - this.origin[0]
      const y = c[e.start + 1] - this.origin[1]
      ctx.strokeStyle = this.colorFor(e.rgb)
      ctx.beginPath()
      ctx.moveTo(x - r, y)
      ctx.lineTo(x + r, y)
      ctx.moveTo(x, y - r)
      ctx.lineTo(x, y + r)
      ctx.stroke()
    }
  }

  private renderTexts(T: number[]): void {
    if (!this.scene || !this.grid || this.texts.length === 0) return
    const ctx = this.ctx
    const ids = this.grid.query(this.viewBox(), MAX_TEXTS_PER_FRAME * 4)
    let drawn = 0
    const [ox, oy] = this.origin
    for (const id of ids) {
      const e = this.scene.entities[id]
      if (e.kind !== 'text' || !e.text || this.hidden.has(e.layer)) continue
      const t = e.text
      const m = t.m
      // Ekrandaki yükseklik: yerel y ekseninin ölçeği × yükseklik × ölçek
      const hy = Math.hypot(m[2], m[3]) * t.height * this.s
      if (hy < 2.5 || hy > 4000) continue
      if (++drawn > MAX_TEXTS_PER_FRAME) break
      ctx.setTransform(T[0], T[1], T[2], T[3], T[4], T[5])
      ctx.transform(m[0], m[1], m[2], m[3], m[4] - ox, m[5] - oy)
      // Metin 100 px yazı tipiyle çizilip yerel ölçeğe indirgenir (küçük yazı tipi boyutu sorunlarını önler)
      const k = t.height / 100
      ctx.scale(k, -k)
      ctx.font = '100px "Inter Variable", Inter, system-ui, sans-serif'
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = t.ax === 0.5 ? 'center' : t.ax === 1 ? 'right' : 'left'
      ctx.fillStyle = this.colorFor(e.rgb)
      const lh = t.lineHeight / k
      for (let i = 0; i < t.lines.length; i++) {
        ctx.fillText(t.lines[i], 0, -t.baseline / k + i * lh)
      }
    }
  }

  private renderEntities(ids: number[], color: string, widthPx: number, T: number[], alpha: number): void {
    if (!this.scene) return
    const ctx = this.ctx
    const c = this.scene.coords
    const [ox, oy] = this.origin
    ctx.setTransform(T[0], T[1], T[2], T[3], T[4], T[5])
    ctx.lineWidth = widthPx / this.s
    ctx.strokeStyle = color
    ctx.globalAlpha = alpha
    ctx.beginPath()
    const visit = (id: number, depth: number) => {
      const e = this.scene!.entities[id]
      if (!e || depth > 4) return
      if (e.kind === 'group') {
        for (const ch of this.children.get(id) ?? []) visit(ch, depth + 1)
        return
      }
      if (e.kind === 'text') {
        const b = e.bbox
        ctx.rect(b[0] - ox, b[1] - oy, b[2] - b[0], b[3] - b[1])
        return
      }
      ctx.moveTo(c[e.start] - ox, c[e.start + 1] - oy)
      for (let i = 1; i < e.count; i++) ctx.lineTo(c[e.start + 2 * i] - ox, c[e.start + 2 * i + 1] - oy)
      if (e.closed) ctx.closePath()
    }
    for (const id of ids) visit(id, 0)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  private label(text: string, x: number, y: number, color: string): void {
    const ctx = this.ctx
    ctx.font = '600 12px "Inter Variable", Inter, system-ui, sans-serif'
    const w = ctx.measureText(text).width + 10
    ctx.fillStyle = this.theme.dark ? 'rgba(10,12,15,0.85)' : 'rgba(255,255,255,0.92)'
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(x - w / 2, y - 11, w, 22, 6)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x, y + 0.5)
  }

  private renderMeasurements(): void {
    const ctx = this.ctx
    const draw = (m: Measurement, live: Pt | null) => {
      const pts = m.points.map((p) => this.toScreen(p))
      if (live) pts.push(this.toScreen(live))
      const color = m.kind === 'calibrate' ? this.theme.highlight : this.theme.measure
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = 1.6
      ctx.setLineDash(live ? [6, 4] : [])
      ctx.beginPath()
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
      if (m.closed) ctx.closePath()
      ctx.stroke()
      if (m.kind === 'area' && (m.closed || pts.length > 2)) {
        ctx.globalAlpha = 0.12
        ctx.fill()
        ctx.globalAlpha = 1
      }
      ctx.setLineDash([])
      for (const p of pts) {
        ctx.beginPath()
        ctx.arc(p[0], p[1], 3, 0, Math.PI * 2)
        ctx.fill()
      }
      const world = live ? [...m.points, live] : m.points
      if (m.kind === 'distance' || m.kind === 'calibrate') {
        if (world.length >= 2) {
          const [a, b] = [world[0], world[1]]
          const len = Math.hypot(b[0] - a[0], b[1] - a[1])
          const [sa, sb] = [pts[0], pts[1]]
          this.label(m.kind === 'calibrate' ? `Kalibrasyon: ${this.format.length(len)}` : this.format.length(len), (sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2 - 14, color)
        }
      } else if (world.length >= 3) {
        const flat = world.flat()
        const area = Math.abs(signedArea(flat))
        let cxs = 0
        let cys = 0
        for (const p of pts) {
          cxs += p[0]
          cys += p[1]
        }
        this.label(this.format.area(area), cxs / pts.length, cys / pts.length, this.theme.measure)
      } else if (world.length === 2) {
        const len = Math.hypot(world[1][0] - world[0][0], world[1][1] - world[0][1])
        this.label(this.format.length(len), (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2 - 14, this.theme.measure)
      }
    }
    for (const m of this.measurements) draw(m, null)
    if (this.active) draw(this.active, this.cursor?.world ?? null)
  }

  private renderCursor(): void {
    if (!this.cursor) return
    const ctx = this.ctx
    const measuring = this.tool === 'distance' || this.tool === 'area' || this.tool === 'calibrate'
    if (!measuring) return
    const [x, y] = this.cursor.snapped ? this.toScreen(this.cursor.world) : this.cursor.screen
    ctx.strokeStyle = this.cursor.snapped ? this.theme.highlight : this.theme.measure
    ctx.lineWidth = 1.5
    if (this.cursor.snapped) {
      ctx.strokeRect(x - 6, y - 6, 12, 12)
    } else {
      ctx.beginPath()
      ctx.moveTo(x - 9, y)
      ctx.lineTo(x + 9, y)
      ctx.moveTo(x, y - 9)
      ctx.lineTo(x, y + 9)
      ctx.stroke()
    }
  }
}
