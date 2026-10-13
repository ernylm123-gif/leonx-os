import { describe, expect, it } from 'vitest'
import type { PozCandidate } from './detect'
import { computeItem } from './engine'
import { areaMeasurementToInput, candidateToInput, canApprove, distanceMeasurementToInput } from './fromDetection'

const cand = (p: Partial<PozCandidate>): PozCandidate => ({
  key: 'B|P1|1200|1500',
  code: 'P1',
  label: 'P1',
  source: 'blok',
  block: 'PVC_P1',
  layer: 'PENCERE',
  count: 3,
  instances: [{ entityIds: [1], insertId: 0, bbox: [0, 0, 1200, 1500], handle: 'A1' }],
  shape: 'dikdortgen',
  width_mm: 1200,
  height_mm: 1500,
  height2_mm: null,
  vertices: null,
  manual_area_m2: null,
  typeHint: 'pencere',
  material: 'pvc',
  category: 'pvc_pencere',
  confidence: 0.8,
  level: 'yuksek',
  reasons: [],
  evidence: [],
  duplicatesRemoved: 0,
  dims: [],
  ...p,
})

describe('Tespitten metraja aktarım', () => {
  it('aday adet ve ölçüleriyle aktarılır; referans ve güven bilgisi saklanır', () => {
    const i = candidateToInput(cand({}), { approve: false, fileName: 'a.dxf', analysisId: null })
    expect(i.quantity).toBe(3)
    expect(i.verification).toBe('bekliyor')
    expect(i.drawing_ref?.key).toBe('B|P1|1200|1500')
    expect(i.detection?.confidence).toBe(0.8)
    expect(computeItem(i).unit.frameArea).toBe(1800)
  })
  it('iş grubu belirsizse veya ölçü eksikse onaylanamaz', () => {
    expect(candidateToInput(cand({ category: 'belirsiz' }), { approve: true, fileName: null, analysisId: null }).verification).toBe('bekliyor')
    expect(candidateToInput(cand({ height_mm: null }), { approve: true, fileName: null, analysisId: null }).verification).toBe('bekliyor')
    expect(candidateToInput(cand({}), { approve: true, fileName: null, analysisId: null }).verification).toBe('onaylandi')
    expect(canApprove(candidateToInput(cand({ category: 'belirsiz' }), { approve: false, fileName: null, analysisId: null }))).toBe(false)
  })
  it('alan ölçümü: dik dörtgen → dikdörtgen poz; düzensiz → çokgen; birim doğrulanmadıysa onaysız', () => {
    const r = areaMeasurementToInput([[0, 0], [120, 0], [120, 150], [0, 150]], 10, true, null)
    expect([r.shape, r.width_mm, r.height_mm, r.verification]).toEqual(['dikdortgen', 1200, 1500, 'onaylandi'])
    const t = areaMeasurementToInput([[0, 0], [100, 0], [50, 80]], 10, false, null)
    expect(t.shape).toBe('cokgen')
    expect(t.verification).toBe('bekliyor')
    expect(computeItem({ ...t, poz_code: 'X' }).unit.frameArea).toBe(400) // 1000 × 800 / 2 = 0,4 m²
  })
  it('mesafe ölçümü → korkuluk metretül', () => {
    const r = distanceMeasurementToInput([0, 0], [300, 400], 10, true, null)
    expect(r.width_mm).toBe(5000)
    expect(computeItem({ ...r, poz_code: 'K' }).primary).toEqual({ unit: 'mtul', centi: 500 })
  })
})
