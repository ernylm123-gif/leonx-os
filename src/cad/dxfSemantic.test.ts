import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { analyzeDxfBytes } from './analyze'
import { chooseDenominator, detectDxf, scaleScene } from './dxfSemantic'
import { detectPoz } from '@/quantity/detect'
import type { PdfPozCandidate } from './pdf/archAnalyze'

const load = (name: string) => analyzeDxfBytes(new Uint8Array(readFileSync(`src/cad/__fixtures__/${name}`)))
const run = (name: string) => {
  const a = load(name)
  const mm = a.report.units.mmPerUnit
  return { a, r: detectDxf(a.scene, { mmPerUnit: mm, unitsVerified: mm != null }) }
}
const byCode = <T extends { code: string }>(cs: T[]) => new Map(cs.map((c) => [c.code, c]))

describe('DXF anlamsal analiz (Faz 13)', () => {
  it('model uzayında plan + çizelge: kat tekrarı, çizelge eşleşmesi, malzeme ve ölçü', () => {
    const exp = JSON.parse(readFileSync('src/cad/__fixtures__/mimari_plan_cizelge.expected.json', 'utf8'))
    const { r } = run('mimari_plan_cizelge.dxf')
    expect(r.semantic.analysis.floor.multiplier).toBe(exp.floor_multiplier)
    expect(r.semantic.unitsKnown).toBe(true)
    const m = byCode(r.candidates) as Map<string, PdfPozCandidate>
    expect([...m.keys()].sort()).toEqual(Object.keys(exp.pozlar).sort())
    for (const [code, e] of Object.entries<Record<string, unknown>>(exp.pozlar)) {
      const c = m.get(code)!
      expect(c.width_mm, code).toBe(e.w)
      expect(c.height_mm, code).toBe(e.h)
      expect(c.attrs?.malzeme?.value?.toLocaleLowerCase('tr-TR').replace('ü', 'u'), code).toContain(String(e.malzeme).slice(0, 3))
      expect(c.scheduleQty, code).toBe(e.cizelge)
      if (e.celiski) expect(c.conflicts.map((x) => x.kind), code).toContain(e.celiski)
      else {
        expect(c.conflicts, code).toEqual([])
        expect(c.count, code).toBe(e.adet)
      }
    }
  })

  it('duvar gibi büyük kapalı çizgiler poz sayılmaz (eski geometri motorunun hatası)', () => {
    const { a, r } = run('mimari_plan_cizelge.dxf')
    const old = detectPoz(a.scene, { mmPerUnit: 1, unitsVerified: true })
    expect(old.candidates.some((c) => (c.width_mm ?? 0) >= 20000)).toBe(true)
    expect(r.candidates.some((c) => (c.width_mm ?? 0) >= 20000)).toBe(false)
  })

  it('kapı türü ve kategori: K1 alüminyum kapı (eski motor pencere sanıyordu)', () => {
    const { r } = run('mimari_plan_cizelge.dxf')
    expect(byCode(r.candidates).get('K1')).toMatchObject({ category: 'al_kapi' })
  })

  it('blok ölçüsü yazılı ölçüyle uyuşmazsa sessizce seçilmez: ölçü çelişkisi', () => {
    const { r } = run('mimari_plan_cizelge_rev2.dxf')
    // rev2: çizelge P1 130×150 ve blok 1300×1500 — uyumlu, çelişki yok
    const p1 = byCode(r.candidates).get('P1') as PdfPozCandidate
    expect(p1.width_mm).toBe(1300)
    expect(p1.conflicts).toEqual([])
    expect(p1.evidence.some((e) => e.startsWith('Blok ölçüsü yazılı ölçüyle uyumlu'))).toBe(true)
  })

  it('etiketli ama ölçüsüz çizimde ölçü ve adet blok geometrisinden alınır (gerileme yok)', () => {
    for (const f of ['window_schedule.dxf', 'plan_door.dxf', 'units_cm.dxf', 'blocks_transform.dxf', 'minsert.dxf', 'dim_mismatch.dxf', 'nested_blocks.dxf']) {
      const a = load(f)
      const mm = a.report.units.mmPerUnit
      const o = { mmPerUnit: mm, unitsVerified: mm != null }
      const old = detectPoz(a.scene, o).candidates
      const neu = byCode(detectDxf(a.scene, o).candidates)
      for (const c of old) {
        const n = neu.get(c.code)
        expect(n, `${f} ${c.code}`).toBeTruthy()
        expect([n!.count, n!.width_mm, n!.height_mm], `${f} ${c.code}`).toEqual([c.count, c.width_mm, c.height_mm])
      }
    }
  })

  it('birim bilinmiyorsa ölçek doğrulanmış sayılmaz', () => {
    const a = load('mimari_plan_cizelge.dxf')
    const r = detectDxf(a.scene, { mmPerUnit: null, unitsVerified: false })
    expect(r.semantic.unitsKnown).toBe(false)
    expect(r.semantic.analysis.notes.join(' ')).toMatch(/birimi bilinmiyor/)
  })

  it('sanal ölçek yazı yüksekliğinden standart ölçeğe oturur; ölçekleme kimlikleri korur', () => {
    const a = load('mimari_plan_cizelge.dxf')
    expect(chooseDenominator(a.scene, 1)).toBe(50)
    expect(chooseDenominator(a.scene, 10)).toBe(500)
    const s = scaleScene(a.scene, 0.5)
    expect(s.entities.length).toBe(a.scene.entities.length)
    expect(s.entities.every((e, i) => e.id === a.scene.entities[i].id)).toBe(true)
    expect(s.coords[0]).toBeCloseTo(a.scene.coords[0] * 0.5)
    // özgün sahne değişmez
    expect(load('mimari_plan_cizelge.dxf').scene.coords[0]).toBe(a.scene.coords[0])
  })

  it('aday kutuları özgün çizim biriminde döner (vurgulama için)', () => {
    const { a, r } = run('mimari_plan_cizelge.dxf')
    const sb = a.scene.bbox!
    for (const c of r.candidates)
      for (const i of c.instances) {
        expect(i.bbox[0]).toBeGreaterThanOrEqual(sb[0] - 1)
        expect(i.bbox[2]).toBeLessThanOrEqual(sb[2] + 1)
      }
  })
})
