/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { analyzeDxfBytes } from '@/cad/analyze'
import { DxfWriter } from '@/cad/testing/dxfWriter'
import { categoryFor, detectPoz, inferType, parsePozLabel } from './detect'
import { computeItem } from './engine'
import { emptyItem } from './types'

const fx = (n: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../cad/__fixtures__/${n}`, import.meta.url))))
const expected = JSON.parse(readFileSync(fileURLToPath(new URL('../cad/__fixtures__/expected.json', import.meta.url)), 'utf-8'))

describe('Poz etiketi ve tür çıkarımı', () => {
  it('poz kodu biçimleri', () => {
    expect(parsePozLabel('P1')).toBe('P1')
    expect(parsePozLabel('k-01')).toBe('K-01')
    expect(parsePozLabel('POZ: D12')).toBe('D12')
    expect(parsePozLabel('PENCERE')).toBeNull()
    expect(parsePozLabel('1200')).toBeNull()
  })
  it('malzeme yalnızca metinden tahmin edilir', () => {
    expect(inferType(['PVC_P1_1200x1500', 'PENCERE'])).toMatchObject({ type: 'pencere', material: 'pvc' })
    expect(inferType(['ALU_K1', 'KAPI'])).toMatchObject({ type: 'kapi', material: 'aluminyum' })
    expect(inferType(['DOGRAMA'])).toMatchObject({ type: 'pencere', material: null })
    expect(categoryFor('pencere', null)).toBe('belirsiz')
    expect(categoryFor('kapi', 'pvc')).toBe('pvc_kapi')
  })
})

describe('Doğrama görünüş paftasında poz tespiti', () => {
  const a = analyzeDxfBytes(fx('window_schedule.dxf'))
  const det = detectPoz(a.scene, { mmPerUnit: a.report.units.mmPerUnit, unitsVerified: true })
  const exp = expected['window_schedule.dxf']
  const byLabel = (l: string) => det.candidates.find((c) => c.label === l)!

  it('beklenen tüm pozlar bulunur, fazladan aday yok', () => {
    expect(det.candidates.map((c) => c.label).sort()).toEqual(exp.groups.map((g: { label: string }) => g.label).sort())
  })

  it('P1: 3 blok referansı, 1200 × 1500, PVC pencere önerisi, ölçü yazısı doğruluyor', () => {
    const p1 = byLabel('P1')
    expect(p1.source).toBe('blok')
    expect(p1.count).toBe(3)
    expect([p1.width_mm, p1.height_mm]).toEqual([1200, 1500])
    expect(p1.category).toBe('pvc_pencere')
    expect(p1.dims.some((d) => d.matches)).toBe(true)
    expect(p1.reasons.join(' ')).toMatch(/Malzeme yalnızca ad\/katman/)
    expect(p1.confidence).toBeLessThan(1)
  })

  it('K1: 2 adet alüminyum kapı 900 × 2100', () => {
    const k1 = byLabel('K1')
    expect(k1.count).toBe(2)
    expect([k1.width_mm, k1.height_mm]).toEqual([900, 2100])
    expect(k1.category).toBe('al_kapi')
  })

  it('S1: üst üste çizilmiş kopya bir kez sayılır (çift sayım yok)', () => {
    const s1 = byLabel('S1')
    expect(s1.count).toBe(1)
    expect(s1.duplicatesRemoved).toBe(1)
    expect([s1.width_mm, s1.height_mm]).toEqual([2000, 800])
  })

  it('P2: dört ayrı çizgiden dikdörtgen', () => {
    const p2 = byLabel('P2')
    expect(p2.source).toBe('cizgi_dortgen')
    expect([p2.width_mm, p2.height_mm]).toEqual([1000, 1000])
  })

  it('P3: yamuk pencere, alan yamuk formülüyle', () => {
    const p3 = byLabel('P3')
    expect(p3.shape).toBe('yamuk')
    const r = computeItem(emptyItem({ poz_code: 'P3', category: 'pvc_pencere', shape: p3.shape, width_mm: p3.width_mm, height_mm: p3.height_mm, height2_mm: p3.height2_mm }))
    expect(r.unit.frameArea).toBe(Math.round(exp.groups[4].area / 1000))
  })

  it('blok içindeki iç kasa çizgileri ayrı poz olarak sayılmaz', () => {
    // Tüm aday örneklerindeki toplam adet = 3 + 2 + 1 + 1 + 1
    expect(det.candidates.reduce((s, c) => s + c.count, 0)).toBe(8)
  })

  it('birim doğrulanmadıysa güven düşük tutulur', () => {
    const d2 = detectPoz(a.scene, { mmPerUnit: null, unitsVerified: false })
    expect(d2.candidates.every((c) => c.confidence <= 0.4)).toBe(true)
    expect(d2.candidates[0].reasons[0]).toMatch(/birimi doğrulanmadı/)
  })
})

describe('Ölçü yazısı ve plan görünüşü', () => {
  it('elle değiştirilmiş ölçü yazısı geometriyle uyuşmazsa belirsizlik nedeni eklenir ve güven düşer', () => {
    const a = analyzeDxfBytes(fx('dim_mismatch.dxf'))
    const det = detectPoz(a.scene, { mmPerUnit: 1, unitsVerified: true })
    const p9 = det.candidates.find((c) => c.label === expected['dim_mismatch.dxf'].label)!
    expect(p9.width_mm).toBe(expected['dim_mismatch.dxf'].geometry_w)
    expect(p9.dims.some((d) => !d.matches && d.value === '1250')).toBe(true)
    expect(p9.reasons.join(' ')).toMatch(/Ölçü yazısı "1250", çizim 1200 mm/)
    expect(p9.level).not.toBe('yuksek')
  })

  it('kapı açılım yayı olan plan bloğu: yükseklik okunamaz, elle girilmeli', () => {
    const a = analyzeDxfBytes(fx('plan_door.dxf'))
    const det = detectPoz(a.scene, { mmPerUnit: 1, unitsVerified: true })
    expect(det.candidates.length).toBe(1)
    const c = det.candidates[0]
    expect(c.count).toBe(expected['plan_door.dxf'].count)
    expect(c.width_mm).toBe(900)
    expect(c.height_mm).toBeNull()
    expect(c.reasons.join(' ')).toMatch(/Plan görünüşü/)
  })
})

describe('Sınırlar', () => {
  it('pafta çerçevesi ve ölçü katmanı dışlanır', () => {
    const w = new DxfWriter()
    w.rect(0, 0, 84100, 59400, 'PAFTA')
    w.rect(1000, 1000, 1200, 1500, 'PENCERE')
    w.rect(5000, 1000, 1200, 1500, 'OLCU')
    const a = analyzeDxfBytes(w.toBytes())
    const det = detectPoz(a.scene, { mmPerUnit: 1, unitsVerified: true })
    expect(det.candidates.length).toBe(1)
    expect(det.candidates[0].width_mm).toBe(1200)
  })

  it('katman adından bağımsız: pozları çevreleyen çerçeve elenir, içerideki pencereler korunur', () => {
    const w = new DxfWriter()
    w.rect(0, 0, 20000, 14000, '0')
    w.rect(1000, 1000, 1200, 1500, '0')
    w.rect(4000, 1000, 1200, 1500, '0')
    w.rect(7000, 1000, 900, 2100, '0')
    // Pencerenin iç kanat çizgisi: iç parça
    w.rect(1060, 1060, 1080, 1380, '0')
    const a = analyzeDxfBytes(w.toBytes())
    const det = detectPoz(a.scene, { mmPerUnit: 1, unitsVerified: true })
    const sizes = det.candidates.map((c) => `${c.width_mm}x${c.height_mm}x${c.count}`).sort()
    expect(sizes).toEqual(['1200x1500x2', '900x2100x1'])
  })
})
