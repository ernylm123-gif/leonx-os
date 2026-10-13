import { describe, expect, it } from 'vitest'
import { analyzeDxfBytes } from './analyze'
import { apply, bulgeArc, bulgeLength, bulgeSegmentArea, invert, isSimilarity, mul, ocsToWcs, rotate, scale, signedArea, translate } from './geometry'
import { rectOf } from './scene'
import { DxfWriter } from './testing/dxfWriter'
import { cleanMText, parseNumberCandidates } from './text'

describe('Afin dönüşümler', () => {
  it('bileşim sırası: önce sağdaki uygulanır', () => {
    const m = mul(translate(10, 0), rotate(Math.PI / 2))
    const [x, y] = apply(m, 1, 0)
    expect(x).toBeCloseTo(10, 12)
    expect(y).toBeCloseTo(1, 12)
  })
  it('ters dönüşüm', () => {
    const m = mul(translate(5, -3), mul(rotate(0.7), scale(2, 3)))
    const inv = invert(m)!
    const [x, y] = apply(m, 1.5, -2)
    const [bx, by] = apply(inv, x, y)
    expect(bx).toBeCloseTo(1.5, 12)
    expect(by).toBeCloseTo(-2, 12)
  })
  it('benzerlik dönüşümü tespiti', () => {
    expect(isSimilarity(mul(rotate(1), scale(2, 2)))).toBe(true)
    expect(isSimilarity(scale(2, 1))).toBe(false)
    expect(isSimilarity(scale(-1, 1))).toBe(true)
  })
})

describe('OCS (Arbitrary Axis Algorithm)', () => {
  it('extrusion (0,0,-1) X eksenini aynalar', () => {
    const m = ocsToWcs([0, 0, -1])
    const [x, y] = apply(m, 3, 4)
    expect(x).toBeCloseTo(-3, 12)
    expect(y).toBeCloseTo(4, 12)
  })
  it('varsayılan extrusion birim dönüşümdür', () => {
    expect(apply(ocsToWcs([0, 0, 1]), 3, 4)).toEqual([3, 4])
  })
})

describe('Bulge', () => {
  it('yarım daire (bulge = 1): merkez kiriş ortasında, yay yolun sağında', () => {
    const a = bulgeArc(0, 0, 2, 0, 1)
    expect(a.cx).toBeCloseTo(1, 12)
    expect(a.cy).toBeCloseTo(0, 12)
    expect(a.r).toBeCloseTo(1, 12)
    expect(bulgeLength(0, 0, 2, 0, 1)).toBeCloseTo(Math.PI, 12)
    expect(bulgeSegmentArea(0, 0, 2, 0, 1)).toBeCloseTo(Math.PI / 2, 12)
  })
  it('çeyrek daire: bulge = tan(22.5°)', () => {
    const b = Math.tan(Math.PI / 8)
    expect(bulgeLength(1, 0, 0, 1, b)).toBeCloseTo(Math.PI / 2, 12)
    const a = bulgeArc(1, 0, 0, 1, b)
    expect(a.cx).toBeCloseTo(0, 12)
    expect(a.cy).toBeCloseTo(0, 12)
  })
  it('negatif bulge saat yönünde yay: merkez diğer tarafta', () => {
    const b = -Math.tan(Math.PI / 8)
    const a = bulgeArc(0, 1, 1, 0, b)
    expect(a.cx).toBeCloseTo(0, 12)
    expect(a.cy).toBeCloseTo(0, 12)
  })
})

describe('Alan', () => {
  it('CCW pozitif, CW negatif', () => {
    expect(signedArea([0, 0, 2, 0, 2, 3, 0, 3])).toBe(6)
    expect(signedArea([0, 0, 0, 3, 2, 3, 2, 0])).toBe(-6)
  })
})

describe('Dikdörtgen tanıma', () => {
  it('eksenlere paralel ve döndürülmüş dikdörtgen', () => {
    expect(rectOf([0, 0, 1200, 0, 1200, 1500, 0, 1500])).toMatchObject({ w: 1200, h: 1500 })
    const c = Math.cos(0.3)
    const s = Math.sin(0.3)
    const pts = [[0, 0], [1200, 0], [1200, 1500], [0, 1500]].flatMap(([x, y]) => [x * c - y * s, x * s + y * c])
    const r = rectOf(pts)!
    expect(r.w).toBeCloseTo(1200, 9)
    expect(r.h).toBeCloseTo(1500, 9)
  })
  it('dik açılı olmayan dörtgen dikdörtgen değildir', () => {
    expect(rectOf([0, 0, 1500, 0, 1500, 1200, 0, 600])).toBeNull()
  })
  it('dikey uzun kenar: genişlik yatay kenardır', () => {
    const r = rectOf([0, 0, 0, 1500, -1200, 1500, -1200, 0])!
    expect(r.w).toBeCloseTo(1200, 9)
    expect(r.h).toBeCloseTo(1500, 9)
  })
})

describe('Metin temizleme', () => {
  it('MTEXT biçim kodları', () => {
    expect(cleanMText('{\\fArial|b1;Kalın}\\PSatır \\S3/4; %%d')).toBe('Kalın\nSatır 3/4 °')
    expect(cleanMText('\\A1;\\H2.5x;1200')).toBe('1200')
    expect(cleanMText('a\\\\b \\{x\\}')).toBe('a\\b {x}')
  })
  it('ölçü metninde sayı yorumları (Türkçe ondalık)', () => {
    expect(parseNumberCandidates('1200')).toEqual([1200])
    expect(parseNumberCandidates('1,25')).toEqual([1.25])
    expect(parseNumberCandidates('1.250')).toEqual([1.25, 1250])
    expect(parseNumberCandidates('1.250,5')).toEqual([1250.5])
    expect(parseNumberCandidates('Ø50')).toEqual([50])
    expect(parseNumberCandidates('yok')).toEqual([])
  })
})

describe('Büyük çizim performansı ve sınırlar', () => {
  it('300 bin nesneli çizim makul sürede analiz edilir', () => {
    const w = new DxfWriter()
    w.block('PENCERE', (t) => {
      w.rect(0, 0, 1200, 1500, '0', t)
      for (let i = 0; i < 9; i++) w.line(i * 100, 0, i * 100, 1500, '0', t)
    })
    for (let i = 0; i < 100_000; i++) w.line(i, 0, i, 1000, 'CIZGI')
    for (let i = 0; i < 20_000; i++) w.insert('PENCERE', (i % 200) * 1500, Math.floor(i / 200) * 2000, { layer: 'DOGRAMA' })
    const bytes = w.toBytes()
    const t0 = performance.now()
    const a = analyzeDxfBytes(bytes)
    const ms = performance.now() - t0
    expect(a.scene.entities.length).toBe(300_000)
    expect(a.scene.inserts.length).toBe(20_000)
    expect(a.report.truncated).toBe(false)
    // CI makinelerinde de geçmesi için geniş sınır; tipik süre raporda görünür
    expect(ms).toBeLessThan(15_000)
    console.info(`Performans: ${(bytes.length / 1048576).toFixed(1)} MB, ${a.scene.entities.length} nesne → ${Math.round(ms)} ms`)
  })

  it('nesne sınırı aşılınca analiz eksik olarak işaretlenir (sessiz kırpma yok)', () => {
    const w = new DxfWriter()
    for (let i = 0; i < 1000; i++) w.line(0, i, 10, i)
    const a = analyzeDxfBytes(w.toBytes(), { limits: { maxEntities: 100, maxPoints: 1_000_000, maxDepth: 32 } })
    expect(a.report.truncated).toBe(true)
    expect(a.scene.entities.length).toBe(100)
    expect(a.report.warnings.find((x) => x.code === 'limit')?.severity).toBe('hata')
  })

  it('tanımı olmayan blok referansı raporlanır', () => {
    const w = new DxfWriter()
    w.insert('YOK', 0, 0)
    const a = analyzeDxfBytes(w.toBytes())
    expect(a.report.warnings.some((x) => x.code === 'missing-block')).toBe(true)
  })
})
