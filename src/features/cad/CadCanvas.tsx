import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { BBox } from '@/cad/geometry'
import type { Scene } from '@/cad/types'
import { type BackgroundImage, type Measurement, type Pt, ViewerEngine, type ViewerFormat, type ViewerTheme, type ViewerTool } from '@/cad/viewer/engine'

export interface CadCanvasHandle {
  zoomExtents: () => void
  zoomBy: (factor: number) => void
  zoomToBox: (b: BBox) => void
  clearMeasurements: () => void
  removeMeasurement: (id: number) => void
  key: (key: string) => boolean
  keyUp: (key: string) => void
}

interface CadCanvasProps {
  scene: Scene | null
  background: BackgroundImage | null
  hiddenLayers: Set<string>
  selection: number[]
  highlights: { ids: number[]; color: string }[]
  tool: ViewerTool
  theme: ViewerTheme
  format: ViewerFormat
  onCursor?: (p: Pt | null, snapped: boolean) => void
  onSelect?: (id: number | null, additive: boolean) => void
  onMeasurements?: (list: Measurement[], active: Measurement | null) => void
  onCalibrate?: (points: [Pt, Pt]) => void
}

/** Görüntüleyici motorunu React yaşam döngüsüne bağlar; motor yalnızca değişen durumu alır. */
export const CadCanvas = forwardRef<CadCanvasHandle, CadCanvasProps>(function CadCanvas(props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<ViewerEngine | null>(null)
  const cbRef = useRef(props)
  cbRef.current = props

  useEffect(() => {
    const engine = new ViewerEngine(canvasRef.current!, {
      onCursor: (p, s) => cbRef.current.onCursor?.(p, s),
      onSelect: (id, add) => cbRef.current.onSelect?.(id, add),
      onMeasurements: (l, a) => cbRef.current.onMeasurements?.(l, a),
      onCalibrate: (pts) => cbRef.current.onCalibrate?.(pts),
    })
    engineRef.current = engine
    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  // Sahne değişince arka plan da birlikte verilir (arka planın tek başına değişimi aşağıda)
  const bgRef = useRef(props.background)
  bgRef.current = props.background
  useEffect(() => engineRef.current?.setScene(props.scene, bgRef.current), [props.scene])
  useEffect(() => engineRef.current?.setBackground(props.background), [props.background])
  useEffect(() => engineRef.current?.setHiddenLayers(props.hiddenLayers), [props.hiddenLayers])
  useEffect(() => engineRef.current?.setSelection(props.selection), [props.selection])
  useEffect(() => engineRef.current?.setHighlights(props.highlights), [props.highlights])
  useEffect(() => engineRef.current?.setTool(props.tool), [props.tool])
  useEffect(() => engineRef.current?.setTheme(props.theme), [props.theme])
  useEffect(() => engineRef.current?.setFormat(props.format), [props.format])

  useImperativeHandle(ref, () => ({
    zoomExtents: () => engineRef.current?.zoomExtents(),
    zoomBy: (f) => engineRef.current?.zoomBy(f),
    zoomToBox: (b) => engineRef.current?.zoomToBox(b),
    clearMeasurements: () => engineRef.current?.clearMeasurements(),
    removeMeasurement: (id) => engineRef.current?.removeMeasurement(id),
    key: (k) => engineRef.current?.key(k) ?? false,
    keyUp: (k) => engineRef.current?.keyUp(k),
  }))

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full touch-none select-none outline-none"
      aria-label="CAD çizim görüntüleyici. Fare tekerleği veya iki parmakla yakınlaştırın, sürükleyerek kaydırın."
      role="img"
      tabIndex={0}
      data-testid="cad-canvas"
    />
  )
})
