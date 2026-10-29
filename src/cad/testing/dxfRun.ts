/// <reference types="node" />
/**
 * Testler ve doğruluk ölçümü için: DXF'i uygulamadaki akışla aynı şekilde analiz eder
 * (analyzeDxfBytes → model + kâğıt uzayı sahneleri → detectDxf). Birim ($INSUNITS) yoksa ölçek
 * doğrulanmamış sayılır; uygulamadaki gibi kalibrasyon yapılmaz.
 */
import { analyzeDxfBytes } from '../analyze'
import { detectDxf } from '../dxfSemantic'

export function analyzeDxfFileBytes(bytes: Uint8Array) {
  const a = analyzeDxfBytes(bytes)
  const mm = a.report.units.mmPerUnit
  const r = detectDxf(a.scene, { mmPerUnit: mm, unitsVerified: mm != null, paper: a.paper })
  return { candidates: r.candidates, unitsKnown: mm != null, layouts: (a.paper ?? []).map((p) => p.name) }
}
