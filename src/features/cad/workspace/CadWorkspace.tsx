import {
  Crosshair,
  FileUp,
  Hand,
  Layers,
  ListChecks,
  Maximize,
  Minimize,
  Minus,
  MousePointer2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Plus,
  Ruler,
  Scan,
  ScrollText,
  SquareDashed,
  Sun,
  Moon,
  TriangleAlert,
  FileText,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type DisplayUnitId, DISPLAY_UNITS } from '@/cad/units'
import type { Measurement, Pt, ViewerTheme, ViewerTool } from '@/cad/viewer/engine'
import { cn } from '@/lib/cn'
import { CadCanvas, type CadCanvasHandle } from '../CadCanvas'
import { formatAreaWorld, formatCoord, formatLengthWorld, type UnitState } from '../format'
import { type CadSource, initialUnits, type LoadedCad, UNKNOWN_UNITS, unitsFromPdfScale, useCadDocument } from '../useCadDocument'
import { CalibrationDialog } from './CalibrationDialog'
import { FilePanel, HistoryPanel, LayersPanel, type LogEntry, MeasurementsPanel, PropertiesPanel, UnitsCard, WarningsPanel } from './panels'
import { CAD_ACCEPT, DropZone, DwgGuide, ErrorView, LoadingView } from './states'
import { PanelTabs, StatusChip, ToolButton, ToolDivider } from './ui'

const THEMES: Record<'koyu' | 'acik', ViewerTheme> = {
  koyu: { background: '#16191d', ink: '#e9edf1', accent: '#4aa3ff', measure: '#ffb02e', highlight: '#3ddc97', dark: true },
  acik: { background: '#ffffff', ink: '#1d2127', accent: '#0a6cdc', measure: '#c26a00', highlight: '#0f8a5a', dark: false },
}

type LeftTab = 'dosya' | 'katmanlar' | (string & {})
type BottomTab = 'uyarilar' | 'islemler' | (string & {})

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T | null) ?? fallback
  } catch {
    return fallback
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* depolama kapalı olabilir */
  }
}

export interface WorkspaceExtensions {
  /** Ek sol sekmeler (ör. Pozlar, Analiz geçmişi) */
  leftTabs?: { id: string; label: string; icon?: typeof Layers; badge?: number | null; render: () => ReactNode }[]
  bottomTabs?: { id: string; label: string; icon?: typeof Layers; badge?: number | null; render: () => ReactNode }[]
  /** Sağ panelin en üstüne eklenecek içerik (ör. poz doğrulama) */
  rightTop?: ReactNode
  /** Araç çubuğuna eklenecek düğmeler */
  toolbarExtra?: ReactNode
  /** Görüntüleyicide ek vurgular (ör. poz adayları) */
  highlights?: { ids: number[]; color: string }[]
  /** Ölçüm satırında ek işlem (ör. ölçümü metraja ekle) */
  measurementAction?: { label: string; run: (m: Measurement) => void }
}

export interface WorkspaceContext {
  doc: LoadedCad | null
  units: UnitState
  unit: DisplayUnitId
  selection: number[]
  setSelection: (ids: number[]) => void
  zoomTo: (bbox: [number, number, number, number]) => void
  log: (message: string) => void
  openFile: (name: string, bytes: ArrayBuffer, source?: CadSource) => Promise<LoadedCad | null>
}

/**
 * CAD çalışma alanı: solda dosya/katman (ve uzantı sekmeleri), ortada görüntüleyici,
 * sağda seçili nesne ve ölçümler, altta uyarılar ve işlem geçmişi.
 * Paneller açılıp kapatılabilir; tablet/telefonda paneller görüntüleyicinin üstünde açılır.
 */
export function CadWorkspace({
  extensions,
  onContext,
  initialFile,
  headerExtra,
}: {
  extensions?: (ctx: WorkspaceContext) => WorkspaceExtensions
  onContext?: (ctx: WorkspaceContext) => void
  initialFile?: { load: () => Promise<{ name: string; bytes: ArrayBuffer }>; source: CadSource } | null
  headerExtra?: ReactNode
}) {
  const { state, load, cancel, reset, fail, pending } = useCadDocument()
  const doc = state.status === 'ready' ? state.doc : null
  const canvasRef = useRef<CadCanvasHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  const [leftOpen, setLeftOpen] = useState(isDesktop)
  const [rightOpen, setRightOpen] = useState(isDesktop)
  const [bottomOpen, setBottomOpen] = useState(isDesktop)
  const [leftTab, setLeftTab] = useState<LeftTab>('dosya')
  const [bottomTab, setBottomTab] = useState<BottomTab>('uyarilar')
  const [maximized, setMaximized] = useState(false)
  const [tool, setTool] = useState<ViewerTool>('select')
  const [unit, setUnit] = useState<DisplayUnitId>(() => readPref<DisplayUnitId>('leonx-cad-unit', 'mm'))
  const [bg, setBg] = useState<'koyu' | 'acik'>(() => readPref<'koyu' | 'acik'>('leonx-cad-bg', 'koyu'))
  const [units, setUnits] = useState<UnitState>(UNKNOWN_UNITS)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [selection, setSelection] = useState<number[]>([])
  const [measures, setMeasures] = useState<{ list: Measurement[]; active: Measurement | null }>({ list: [], active: null })
  const [cursor, setCursor] = useState<{ p: Pt; snapped: boolean } | null>(null)
  const [calib, setCalib] = useState<{ open: boolean; dist: number }>({ open: false, dist: 0 })
  const [log, setLog] = useState<LogEntry[]>([])
  const [bottomH, setBottomH] = useState<number>(() => Number(readPref('leonx-cad-bottom-h', '300')) || 300)
  const centerRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const addLog = useCallback((message: string) => setLog((l) => [...l.slice(-199), { at: new Date(), message }]), [])

  const openFile = useCallback(
    async (name: string, bytes: ArrayBuffer, source: CadSource = { type: 'local' }) => {
      addLog(`"${name}" açılıyor`)
      const d = await load(name, bytes, source)
      if (d) {
        const u = initialUnits(d)
        setUnits(u)
        setHidden(new Set(d.scene.layers.filter((l) => l.off || l.frozen).map((l) => l.name)))
        setSelection([])
        setTool('select')
        addLog(
          d.kind === 'dxf'
            ? `DXF analiz edildi: ${d.report?.stats.entities.toLocaleString('tr-TR')} nesne, ${d.scene.layers.length} katman`
            : `PDF açıldı: ${d.pdf?.kind === 'taranmis' ? 'taranmış' : d.pdf?.kind === 'karma' ? 'karma' : 'vektörel'} sayfa`,
        )
      }
      return d
    },
    [load, addLog],
  )

  const onPickFile = useCallback(
    async (f: File) => {
      const buf = await f.arrayBuffer()
      await openFile(f.name, buf)
    },
    [openFile],
  )

  // Başlangıç dosyası (ör. proje dosyasından açma)
  const initialRef = useRef(initialFile)
  useEffect(() => {
    const f = initialRef.current
    if (!f) return
    let cancelled = false
    void (async () => {
      try {
        pending('Proje dosyası', 'Dosya projeden indiriliyor')
        const { name, bytes } = await f.load()
        if (!cancelled) await openFile(name, bytes, f.source)
      } catch (e) {
        const msg = e instanceof Error && e.message ? e.message : 'Dosya indirilemedi.'
        addLog(`Dosya indirilemedi: ${msg}`)
        if (!cancelled) fail('Proje dosyası', `Dosya indirilemedi: ${msg}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [openFile, addLog, fail, pending])

  const zoomTo = useCallback((b: [number, number, number, number]) => canvasRef.current?.zoomToBox(b), [])

  const ctx: WorkspaceContext = useMemo(
    () => ({ doc, units, unit, selection, setSelection, zoomTo, log: addLog, openFile }),
    [doc, units, unit, selection, zoomTo, addLog, openFile],
  )
  useEffect(() => onContext?.(ctx), [ctx, onContext])
  const ext = extensions?.(ctx) ?? {}

  const format = useMemo(
    () => ({ length: (v: number) => formatLengthWorld(v, units, unit), area: (v: number) => formatAreaWorld(v, units) }),
    [units, unit],
  )

  // Klavye kısayolları (metin alanı odaktayken devre dışı)
  useEffect(() => {
    if (!doc) return
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
    const onDown = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey || calib.open) return
      if (canvasRef.current?.key(e.key)) {
        e.preventDefault()
        return
      }
      const map: Record<string, () => void> = {
        v: () => setTool('select'),
        h: () => setTool('pan'),
        d: () => setTool('distance'),
        a: () => setTool('area'),
        k: () => setTool('calibrate'),
        f: () => canvasRef.current?.zoomExtents(),
        '+': () => canvasRef.current?.zoomBy(1.4),
        '=': () => canvasRef.current?.zoomBy(1.4),
        '-': () => canvasRef.current?.zoomBy(1 / 1.4),
        Escape: () => setSelection([]),
      }
      const fn = map[e.key] ?? map[e.key.toLowerCase()]
      if (fn) {
        e.preventDefault()
        fn()
      }
    }
    const onUp = (e: KeyboardEvent) => canvasRef.current?.keyUp(e.key)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [doc, calib.open])

  // Tam ekran: Fullscreen API desteklenirse kullanılır, değilse alan sayfayı kaplar
  const toggleMax = () => {
    const el = containerRef.current
    if (!maximized) {
      setMaximized(true)
      el?.requestFullscreen?.().catch(() => undefined)
    } else {
      setMaximized(false)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    }
  }
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) setMaximized(false)
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])
  useEffect(() => {
    if (!maximized) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.fullscreenElement && setMaximized(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maximized])

  const chooseUnits = (mm: number, label: string) => {
    setUnits({ mmPerUnit: mm, source: 'kullanici', verified: true, note: `Kullanıcı seçimi: ${label}` })
    addLog(`Çizim birimi ${label} olarak onaylandı`)
  }
  const applyScale = (den: number) => {
    setUnits(unitsFromPdfScale(den, false))
    addLog(`PDF ölçeği 1/${den} olarak girildi (kalibrasyonla doğrulanmadı)`)
  }
  const onCalibrate = (pts: [Pt, Pt]) => {
    const dist = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])
    setCalib({ open: true, dist })
  }
  const applyCalibration = (mmPerUnit: number, knownMm: number) => {
    setUnits({ mmPerUnit, source: 'kalibrasyon', verified: true, note: `Kalibrasyon: ${knownMm.toLocaleString('tr-TR')} mm bilinen ölçüye göre` })
    setCalib({ open: false, dist: 0 })
    setTool('select')
    addLog(`Ölçek kalibre edildi (${knownMm.toLocaleString('tr-TR')} mm)`)
  }

  const onSelect = useCallback(
    (id: number | null, additive: boolean) => {
      setSelection((cur) => {
        if (id == null) return additive ? cur : []
        if (additive) return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
        return [id]
      })
      if (id != null && !rightOpen && window.matchMedia('(min-width: 1024px)').matches) setRightOpen(true)
    },
    [rightOpen],
  )

  const selectHandle = (h: string) => {
    if (!doc) return
    const e = doc.scene.entities.find((x) => x.handle === h && x.owner === -1) ?? doc.scene.entities.find((x) => x.handle === h)
    if (!e) {
      addLog(`${h} tanıtıcılı nesne çizimde gösterilmiyor (çizilemeyen nesne)`)
      return
    }
    setSelection([e.id])
    if (Number.isFinite(e.bbox[0])) zoomTo(e.bbox)
  }

  const selectInsert = (insertId: number) => {
    if (!doc || insertId < 0) return
    const ins = doc.scene.inserts[insertId]
    const ids: number[] = []
    for (let i = ins.firstEntity; i < ins.endEntity; i++) ids.push(i)
    setSelection(ids)
  }

  const leftTabs = [
    { id: 'dosya', label: 'Dosya', icon: FileText },
    { id: 'katmanlar', label: 'Katmanlar', icon: Layers, badge: doc ? doc.scene.layers.length : null },
    ...(ext.leftTabs ?? []).map(({ id, label, icon, badge }) => ({ id, label, icon, badge })),
  ]
  const warnings = doc?.report?.warnings ?? []
  const bottomTabs = [
    ...(ext.bottomTabs ?? []).map(({ id, label, icon, badge }) => ({ id, label, icon, badge })),
    { id: 'uyarilar', label: 'Uyarılar', icon: TriangleAlert, badge: warnings.length || null },
    { id: 'islemler', label: 'İşlem geçmişi', icon: ScrollText, badge: null },
  ]
  // Uzantı sekmesi eklenince ilk alt sekme varsayılan olur
  const firstBottom = ext.bottomTabs?.[0]?.id
  const firstBottomRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (firstBottom && firstBottomRef.current !== firstBottom) {
      firstBottomRef.current = firstBottom
      setBottomTab(firstBottom)
    }
  }, [firstBottom])

  const unitsChip =
    !doc ? null : units.mmPerUnit == null ? (
      <StatusChip tone="danger" title={units.note}>
        {doc.kind === 'pdf' ? 'Ölçek yok' : 'Birim bilinmiyor'}
      </StatusChip>
    ) : units.verified ? (
      <StatusChip tone="ok" title={units.note}>
        {units.source === 'kalibrasyon' ? 'Kalibre' : 'Birim'} ✓
      </StatusChip>
    ) : (
      <StatusChip tone="warn" title={units.note}>
        Doğrulanmadı
      </StatusChip>
    )

  const panelBase = 'flex min-h-0 flex-col bg-surface'
  const overlayMobile = 'max-lg:absolute max-lg:inset-y-0 max-lg:z-20 max-lg:w-[min(320px,88%)] max-lg:shadow-raised'

  return (
    <div
      ref={containerRef}
      data-testid="cad-workspace"
      className={cn(
        'flex flex-col overflow-hidden border border-line bg-surface',
        maximized
          ? 'fixed inset-0 z-[60] rounded-none'
          : 'h-[calc(100dvh-15.5rem)] min-h-[340px] rounded-2xl shadow-card md:h-[calc(100dvh-10.5rem)] md:min-h-[520px]',
      )}
    >
      {/* Araç çubuğu */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1.5" role="toolbar" aria-label="CAD araçları">
        <ToolButton icon={PanelLeft} label="Sol panel" active={leftOpen} onClick={() => setLeftOpen((v) => !v)} />
        <label className="relative inline-flex">
          <input
            ref={fileInput}
            type="file"
            accept={CAD_ACCEPT}
            className="peer sr-only"
            data-testid="cad-toolbar-file-input"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onPickFile(f)
              e.target.value = ''
            }}
          />
          <span
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold text-ink peer-focus-visible:ring-2 peer-focus-visible:ring-titanium hover:bg-surface-2"
            title="Dosya aç (DXF, DWG, PDF)"
          >
            <FileUp className="h-[17px] w-[17px]" aria-hidden="true" />
            <span className="hidden sm:inline">Aç</span>
          </span>
        </label>
        {ext.toolbarExtra}
        <ToolDivider />
        <ToolButton icon={MousePointer2} label="Seç" shortcut="V" active={tool === 'select'} disabled={!doc} onClick={() => setTool('select')} testId="tool-select" />
        <ToolButton icon={Hand} label="Kaydır" shortcut="H" active={tool === 'pan'} disabled={!doc} onClick={() => setTool('pan')} />
        <ToolButton icon={Ruler} label="Mesafe ölç" shortcut="D" active={tool === 'distance'} disabled={!doc} onClick={() => setTool('distance')} testId="tool-distance" />
        <ToolButton icon={SquareDashed} label="Alan ölç" shortcut="A" active={tool === 'area'} disabled={!doc} onClick={() => setTool('area')} testId="tool-area" />
        <ToolButton icon={Crosshair} label="Ölçek kalibrasyonu" shortcut="K" active={tool === 'calibrate'} disabled={!doc} onClick={() => setTool('calibrate')} testId="tool-calibrate" />
        <ToolDivider />
        <ToolButton icon={Scan} label="Tümünü sığdır" shortcut="F" disabled={!doc} onClick={() => canvasRef.current?.zoomExtents()} testId="zoom-extents" />
        <ToolButton icon={Plus} label="Yakınlaştır" shortcut="+" disabled={!doc} onClick={() => canvasRef.current?.zoomBy(1.4)} />
        <ToolButton icon={Minus} label="Uzaklaştır" shortcut="−" disabled={!doc} onClick={() => canvasRef.current?.zoomBy(1 / 1.4)} />
        <ToolButton
          icon={bg === 'koyu' ? Sun : Moon}
          label={bg === 'koyu' ? 'Açık çizim zemini' : 'Koyu çizim zemini'}
          onClick={() => {
            const next = bg === 'koyu' ? 'acik' : 'koyu'
            setBg(next)
            writePref('leonx-cad-bg', next)
          }}
        />
        <ToolDivider />
        <label className="sr-only" htmlFor="cad-unit">
          Gösterim birimi
        </label>
        <select
          id="cad-unit"
          value={unit}
          onChange={(e) => {
            const v = e.target.value as DisplayUnitId
            setUnit(v)
            writePref('leonx-cad-unit', v)
          }}
          className="h-9 shrink-0 rounded-lg border border-line bg-surface px-2 text-base text-ink sm:text-[12.5px]"
          title="Ölçülerin gösterim birimi"
        >
          {DISPLAY_UNITS.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        {headerExtra}
        <ToolButton icon={PanelBottom} label="Alt panel" active={bottomOpen} onClick={() => setBottomOpen((v) => !v)} />
        <ToolButton icon={PanelRight} label="Sağ panel" active={rightOpen} onClick={() => setRightOpen((v) => !v)} />
        <ToolButton icon={maximized ? Minimize : Maximize} label={maximized ? 'Tam ekrandan çık' : 'Tam ekran'} onClick={toggleMax} testId="fullscreen" />
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* Sol panel */}
        {leftOpen && (
          <aside className={cn(panelBase, overlayMobile, 'w-[300px] shrink-0 border-r border-line max-lg:left-0')} aria-label="Dosya ve katmanlar">
            <PanelTabs tabs={leftTabs} value={leftTab} onChange={setLeftTab} label="Sol panel sekmeleri" />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {!doc ? (
                <p className="px-4 py-6 text-center text-[12.5px] text-muted">Dosya açıldığında bilgiler burada görünür.</p>
              ) : leftTab === 'dosya' ? (
                <FilePanel doc={doc} units={units} unit={unit}>
                  <UnitsCard doc={doc} units={units} onChoose={chooseUnits} onCalibrate={() => setTool('calibrate')} onScale={applyScale} />
                </FilePanel>
              ) : leftTab === 'katmanlar' ? (
                <LayersPanel scene={doc.scene} hidden={hidden} onChange={setHidden} />
              ) : (
                ext.leftTabs?.find((t) => t.id === leftTab)?.render()
              )}
            </div>
          </aside>
        )}

        {/* Orta: görüntüleyici */}
        <div ref={centerRef} className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1" style={{ background: doc ? THEMES[bg].background : undefined }}>
            {!doc && (
              <div className="absolute inset-0 overflow-y-auto overscroll-contain">
                <div className="flex min-h-full flex-col justify-center p-3">
                  {state.status === 'empty' && <DropZone onFile={(f) => void onPickFile(f)} />}
                  {state.status === 'loading' && <LoadingView fileName={state.fileName} stage={state.stage} fraction={state.fraction} onCancel={cancel} />}
                  {state.status === 'error' &&
                    (state.code === 'dwg' ? (
                      <DwgGuide fileName={state.fileName} version={state.detail} onReset={() => fileInput.current?.click()} />
                    ) : (
                      <ErrorView fileName={state.fileName} message={state.message} onReset={reset} />
                    ))}
                </div>
              </div>
            )}
            {doc && (
              <>
                <CadCanvas
                  ref={canvasRef}
                  scene={doc.scene}
                  background={doc.pdf?.background ? { image: doc.pdf.background, rect: [0, 0, doc.pdf.widthPt, doc.pdf.heightPt] } : null}
                  hiddenLayers={hidden}
                  selection={selection}
                  highlights={ext.highlights ?? []}
                  tool={tool}
                  theme={THEMES[bg]}
                  format={format}
                  onCursor={(p, snapped) => setCursor(p ? { p, snapped } : null)}
                  onSelect={onSelect}
                  onMeasurements={(list, active) => setMeasures({ list, active })}
                  onCalibrate={onCalibrate}
                />
                {/* Uyarı şeritleri */}
                <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-col items-start gap-1.5">
                  {units.mmPerUnit == null && (
                    <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-surface/95 px-3 py-1.5 text-[12px] text-danger shadow-card" data-testid="units-banner">
                      <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {doc.kind === 'pdf' ? 'PDF ölçeği belirsiz: ölçüler doğrulanmamıştır.' : 'Çizim birimi bilinmiyor: ölçüler doğrulanmamıştır.'}
                      {doc.kind === 'dxf' ? (
                        <span className="flex gap-1">
                          {(['mm', 'cm', 'm'] as const).map((u) => (
                            <button
                              key={u}
                              type="button"
                              className="rounded-md border border-line bg-surface px-2 py-0.5 font-semibold text-ink hover:bg-surface-2"
                              onClick={() => chooseUnits(DISPLAY_UNITS.find((d) => d.id === u)!.mm, { mm: 'Milimetre', cm: 'Santimetre', m: 'Metre' }[u])}
                              data-testid={`banner-unit-${u}`}
                            >
                              {u}
                            </button>
                          ))}
                        </span>
                      ) : (
                        <button type="button" className="rounded-md border border-line bg-surface px-2 py-0.5 font-semibold text-ink hover:bg-surface-2" onClick={() => setTool('calibrate')}>
                          Kalibre et
                        </button>
                      )}
                    </div>
                  )}
                  {doc.report?.truncated && (
                    <div className="pointer-events-auto rounded-lg border border-danger/30 bg-surface/95 px-3 py-1.5 text-[12px] text-danger shadow-card">
                      Nesne sınırı aşıldı: çizimin bir kısmı gösterilmiyor.
                    </div>
                  )}
                  {tool === 'calibrate' && (
                    <div className="pointer-events-auto rounded-lg border border-line bg-surface/95 px-3 py-1.5 text-[12px] text-ink shadow-card">
                      Kalibrasyon: uzunluğunu bildiğiniz bir ölçünün iki ucunu seçin.
                    </div>
                  )}
                </div>
                {/* Durum çubuğu */}
                <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between gap-2">
                  <div className="rounded-md bg-surface/90 px-2 py-1 font-mono text-[11px] text-ink-2 shadow-card" data-testid="cursor-coords">
                    {cursor ? (
                      <>
                        X {formatCoord(cursor.p[0], units, unit)} · Y {formatCoord(cursor.p[1], units, unit)}
                        {units.mmPerUnit != null && ` ${unit}`}
                        {cursor.snapped && <span className="ml-1.5 text-ok">yakalandı</span>}
                      </>
                    ) : (
                      'X — · Y —'
                    )}
                  </div>
                  <div className="pointer-events-auto">{unitsChip}</div>
                </div>
              </>
            )}
          </div>

          {/* Alt panel (masaüstünde üst kenarından sürüklenerek boyutlandırılır) */}
          {bottomOpen && (
            <section
              className={cn(panelBase, 'relative shrink-0 border-t border-line max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:!h-[60%] max-lg:shadow-raised')}
              style={{ height: bottomH }}
              aria-label="Alt panel"
            >
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Alt panel yüksekliği (sürükleyin, çift tıklayınca büyüt/küçült)"
                tabIndex={0}
                className="absolute inset-x-0 -top-1.5 z-10 hidden h-3 cursor-row-resize lg:block"
                onPointerDown={(e) => {
                  const startY = e.clientY
                  const startH = bottomH
                  const max = (centerRef.current?.clientHeight ?? 800) - 120
                  const el = e.currentTarget
                  el.setPointerCapture(e.pointerId)
                  const move = (ev: PointerEvent) => setBottomH(Math.max(140, Math.min(max, startH + (startY - ev.clientY))))
                  const up = () => {
                    el.removeEventListener('pointermove', move)
                    el.removeEventListener('pointerup', up)
                    setBottomH((h) => {
                      writePref('leonx-cad-bottom-h', String(Math.round(h)))
                      return h
                    })
                  }
                  el.addEventListener('pointermove', move)
                  el.addEventListener('pointerup', up)
                }}
                onDoubleClick={() => {
                  const max = (centerRef.current?.clientHeight ?? 800) - 120
                  setBottomH((h) => (h > max * 0.6 ? 300 : max))
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp') setBottomH((h) => h + 40)
                  if (e.key === 'ArrowDown') setBottomH((h) => Math.max(140, h - 40))
                }}
              >
                <span className="mx-auto mt-1 block h-1 w-12 rounded-full bg-line-strong" aria-hidden="true" />
              </div>
              <PanelTabs tabs={bottomTabs} value={bottomTab} onChange={setBottomTab} label="Alt panel sekmeleri" />
              <div className="min-h-0 flex-1 overflow-auto">
                {bottomTab === 'uyarilar' ? (
                  <WarningsPanel warnings={warnings} onSelectHandle={selectHandle} />
                ) : bottomTab === 'islemler' ? (
                  <HistoryPanel log={log} />
                ) : (
                  ext.bottomTabs?.find((t) => t.id === bottomTab)?.render()
                )}
              </div>
            </section>
          )}
        </div>

        {/* Sağ panel */}
        {rightOpen && (
          <aside className={cn(panelBase, overlayMobile, 'w-[300px] shrink-0 overflow-y-auto border-l border-line max-lg:right-0')} aria-label="Özellikler ve ölçümler">
            {ext.rightTop}
            <div className="border-b border-line px-4 pt-3 pb-1">
              <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                <ListChecks className="h-4 w-4 text-titanium" aria-hidden="true" />
                Seçili nesne
              </h2>
            </div>
            {doc ? (
              <PropertiesPanel scene={doc.scene} selection={selection} units={units} unit={unit} onSelectInsert={selectInsert} />
            ) : (
              <p className="px-4 py-6 text-center text-[12.5px] text-muted">Çizim açılmadı.</p>
            )}
            {doc && (
              <MeasurementsPanel
                list={measures.list}
                active={measures.active}
                units={units}
                unit={unit}
                onRemove={(id) => canvasRef.current?.removeMeasurement(id)}
                onClear={() => canvasRef.current?.clearMeasurements()}
                action={ext.measurementAction}
              />
            )}
          </aside>
        )}
      </div>

      <CalibrationDialog open={calib.open} worldDistance={calib.dist} onClose={() => setCalib({ open: false, dist: 0 })} onApply={applyCalibration} />
    </div>
  )
}
