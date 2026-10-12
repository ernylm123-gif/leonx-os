import { describe, expect, it } from 'vitest'
import { computeItem, rectMilli, summarize } from './engine'
import { milliTimesQtyToCenti, parseDecimalInput, roundHalfUp, toMilli } from './precision'
import { computeShape } from './shapes'
import { emptyItem, type QuantityItemInput } from './types'

const item = (p: Partial<QuantityItemInput>) => emptyItem({ poz_code: 'P1', category: 'pvc_pencere', ...p })

describe('Yuvarlama kuralları', () => {
  it('yarım yukarı ve kayan nokta güvenliği', () => {
    expect(roundHalfUp(1.005, 2)).toBe(1.01)
    expect(roundHalfUp(2.675, 2)).toBe(2.68)
    expect(roundHalfUp(0.125, 2)).toBe(0.13)
    expect(roundHalfUp(-0.125, 2)).toBe(-0.13)
    expect(toMilli(1.0005)).toBe(1001)
    expect(milliTimesQtyToCenti(105, 1)).toBe(11) // 0,105 → 0,11
    expect(milliTimesQtyToCenti(104, 1)).toBe(10)
  })
  it('dikdörtgen alanı tamsayı aritmetiği ile', () => {
    expect(rectMilli(1200, 1500)).toBe(1800)
    expect(rectMilli(1235.5, 1499.5)).toBe(1853) // 1,85263225 m²
    expect(rectMilli(1000, 1000.5)).toBe(1001) // 1,0005 → 1,001
    expect(rectMilli(0.1, 0.1)).toBe(0)
  })
  it('kullanıcı ondalık girişi (Türkçe)', () => {
    expect(parseDecimalInput('1250,5').value).toBe(1250.5)
    expect(parseDecimalInput('1.250,5').value).toBe(1250.5)
    expect(parseDecimalInput('1250.5').value).toBe(1250.5)
    expect(parseDecimalInput('1.250')).toEqual({ value: 1250, ambiguous: true })
    expect(parseDecimalInput('abc').value).toBeNull()
    expect(parseDecimalInput('').value).toBeNull()
  })
})

describe('Şekiller', () => {
  const area = (p: Partial<QuantityItemInput>) => computeShape({ ...emptyItem(), ...p }).result!
  it('dikdörtgen', () => {
    const r = area({ shape: 'dikdortgen', width_mm: 1200, height_mm: 1500 })
    expect(r.area).toBe(1_800_000)
    expect(r.perimeter).toBe(5400)
  })
  it('üçgen (tepe ortada)', () => {
    const r = area({ shape: 'ucgen', width_mm: 1000, height_mm: 1000, apex_mm: 500 })
    expect(r.area).toBe(500_000)
    expect(r.perimeter).toBeCloseTo(1000 + 2 * Math.hypot(500, 1000), 9)
  })
  it('yamuk (merdiven penceresi)', () => {
    const r = area({ shape: 'yamuk', width_mm: 1500, height_mm: 600, height2_mm: 1200 })
    expect(r.area).toBe(1_350_000)
    expect(r.perimeter).toBeCloseTo(1500 + 600 + 1200 + Math.hypot(1500, 600), 9)
  })
  it('kemerli: yarım daire üst', () => {
    const r = area({ shape: 'kemerli', width_mm: 1000, height_mm: 1700, rise_mm: 500 })
    expect(r.area).toBeCloseTo(1000 * 1200 + (Math.PI * 500 * 500) / 2, 6)
    expect(r.perimeter).toBeCloseTo(1000 + 2 * 1200 + Math.PI * 500, 6)
  })
  it('kemerli: basık kemer, çokgen yaklaşımıyla bağımsız kontrol', () => {
    const w = 1000
    const s = 200
    const h = 1500
    const r = area({ shape: 'kemerli', width_mm: w, height_mm: h, rise_mm: s })
    // Bağımsız: yay üzerindeki noktalarla çokgen alanı
    const R = (w * w / 4 + s * s) / (2 * s)
    const cy = h - R
    const pts: [number, number][] = [[0, 0], [w, 0]]
    const N = 20000
    const a0 = Math.atan2(h - s - cy, w / 2)
    const a1 = Math.PI - a0
    for (let i = 0; i <= N; i++) {
      const t = a0 + ((a1 - a0) * i) / N
      pts.push([w / 2 + R * Math.cos(t), cy + R * Math.sin(t)])
    }
    let A = 0
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i]
      const [x2, y2] = pts[(i + 1) % pts.length]
      A += x1 * y2 - x2 * y1
    }
    expect(r.area / (Math.abs(A) / 2)).toBeCloseTo(1, 6)
  })
  it('daire', () => {
    expect(area({ shape: 'daire', width_mm: 1000 }).area).toBeCloseTo((Math.PI * 1e6) / 4, 6)
  })
  it('düzensiz çokgen (L biçimi) ve kendini kesen çokgen reddi', () => {
    const L: [number, number][] = [[0, 0], [2000, 0], [2000, 1000], [1000, 1000], [1000, 2000], [0, 2000]]
    expect(area({ shape: 'cokgen', vertices: L }).area).toBe(3_000_000)
    const bow: [number, number][] = [[0, 0], [1000, 1000], [1000, 0], [0, 1000]]
    expect(computeShape({ ...emptyItem(), shape: 'cokgen', vertices: bow }).errors[0].message).toMatch(/kendini kesiyor/)
  })
  it('negatif, sıfır ve eksik ölçüler reddedilir', () => {
    expect(computeShape({ ...emptyItem(), shape: 'dikdortgen', width_mm: 0, height_mm: 1000 }).errors[0].message).toMatch(/sıfırdan büyük/)
    expect(computeShape({ ...emptyItem(), shape: 'dikdortgen', width_mm: -5, height_mm: 1000 }).errors[0].message).toMatch(/sıfırdan büyük/)
    expect(computeShape({ ...emptyItem(), shape: 'dikdortgen', width_mm: null, height_mm: 1000 }).errors[0].message).toMatch(/girilmelidir/)
    expect(computeShape({ ...emptyItem(), shape: 'dikdortgen', width_mm: 200_000, height_mm: 1000 }).errors[0].message).toMatch(/sınırını/)
    expect(computeShape({ ...emptyItem(), shape: 'kemerli', width_mm: 1000, height_mm: 1500, rise_mm: 600 }).errors[0].field).toBe('rise_mm')
    expect(computeShape({ ...emptyItem(), shape: 'ucgen', width_mm: 1000, height_mm: 1500, apex_mm: 1200 }).errors[0].field).toBe('apex_mm')
  })
})

describe('Kalem hesabı ve iş kuralları', () => {
  it('dikdörtgen pencere: birim alan 3, satır toplamı 2 ondalık', () => {
    const r = computeItem(item({ width_mm: 1200, height_mm: 1500, quantity: 3 }))
    expect(r.ok).toBe(true)
    expect(r.unit.frameArea).toBe(1800)
    expect(r.total.frameArea).toBe(540)
    expect(r.unit.perimeter).toBe(5400)
    expect(r.total.perimeter).toBe(1620)
    expect(r.primary).toEqual({ unit: 'm2', centi: 540 })
  })
  it('ondalık ölçü: 1235,5 × 1499,5 × 7', () => {
    const r = computeItem(item({ width_mm: 1235.5, height_mm: 1499.5, quantity: 7 }))
    expect(r.unit.frameArea).toBe(1853)
    expect(r.total.frameArea).toBe(1297) // 1,853 × 7 = 12,971 → 12,97
  })
  it('boşluk ölçüsü + montaj payı: doğrama ve boşluk alanı ayrı', () => {
    const r = computeItem(item({ width_mm: 1220, height_mm: 1520, measure_basis: 'bosluk', install_gap_mm: 10 }))
    expect(r.unit.frameArea).toBe(1800)
    expect(r.unit.openingArea).toBe(1854) // 1,8544
  })
  it('montaj payı girilmeyen boşluk ölçüsünde uyarı', () => {
    const r = computeItem(item({ width_mm: 1220, height_mm: 1520, measure_basis: 'bosluk' }))
    expect(r.warnings.join(' ')).toMatch(/montaj payı girilmediği/)
  })
  it('cam alanı doğrama alanından ayrı (düşüm)', () => {
    const r = computeItem(item({ width_mm: 1200, height_mm: 1500, glass_mode: 'dusum', glass_deduction_mm: 60 }))
    expect(r.unit.glassArea).toBe(1490) // 1080 × 1380 = 1,4904
    expect(r.unit.frameArea).toBe(1800)
  })
  it('korkuluk: metretül', () => {
    const r = computeItem(item({ category: 'korkuluk', width_mm: 12345, height_mm: 1100, quantity: 2 }))
    expect(r.primary).toEqual({ unit: 'mtul', centi: 2469 })
    expect(r.total.frameArea).toBe(0)
  })
  it('fotoselli kapı: adet, alan bilgi amaçlı', () => {
    const r = computeItem(item({ category: 'fotoselli_kapi', width_mm: 2000, height_mm: 2500, quantity: 2 }))
    expect(r.primary).toEqual({ unit: 'adet', centi: 200 })
    expect(r.total.frameArea).toBe(1000)
    const noDims = computeItem(item({ category: 'fotoselli_kapi', quantity: 1 }))
    expect(noDims.ok).toBe(true)
  })
  it('metal imalat: kg × adet', () => {
    const r = computeItem(item({ category: 'metal_imalat', unit: 'kg', manual_quantity: 12.5, quantity: 4 }))
    expect(r.primary).toEqual({ unit: 'kg', centi: 5000 })
  })
  it('geçersiz adet', () => {
    expect(computeItem(item({ width_mm: 1, height_mm: 1, quantity: 0 })).ok).toBe(false)
    expect(computeItem(item({ width_mm: 1, height_mm: 1, quantity: 1.5 })).ok).toBe(false)
  })
})

describe('Toplamlar', () => {
  const items: QuantityItemInput[] = [
    item({ poz_code: 'P1', width_mm: 1200, height_mm: 1500, quantity: 3 }),
    item({ poz_code: 'P2', width_mm: 1235.5, height_mm: 1499.5, quantity: 7 }),
    item({ poz_code: 'K1', category: 'al_kapi', width_mm: 900, height_mm: 2100, quantity: 2 }),
    item({ poz_code: 'D1', width_mm: 1000, height_mm: 1000, quantity: 5, verification: 'bekliyor' }),
    item({ poz_code: 'X', width_mm: 1000, height_mm: 1000, quantity: 5, verification: 'reddedildi' }),
    item({ poz_code: 'BOZUK', width_mm: 0, height_mm: 1000 }),
  ]
  it('onaylı ve bekleyen ayrı; reddedilen ve hatalı dahil değil', () => {
    const t = summarize(items)
    expect(t.verified.frameArea).toBe(540 + 1297 + 378)
    expect(t.pending.frameArea).toBe(500)
    expect(t.rejected).toBe(1)
    expect(t.invalid).toBe(1)
  })
  it('genel toplam = satır toplamlarının toplamı = kategori toplamlarının toplamı', () => {
    const t = summarize(items)
    const rows = items.map(computeItem).filter((r) => r.counted).reduce((s, r) => s + r.total.frameArea, 0)
    expect(t.verified.frameArea).toBe(rows)
    expect(t.byCategory.reduce((s, c) => s + c.verified.frameArea, 0)).toBe(t.verified.frameArea)
  })
  it('deterministik: sıra değişse de toplam aynı', () => {
    const a = summarize(items).verified
    const b = summarize([...items].reverse()).verified
    expect(b).toEqual(a)
  })
  it('rastgele 2000 kalemde sütun toplamı = genel toplam (kayan nokta birikimi yok)', () => {
    let seed = 42
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const many = Array.from({ length: 2000 }, (_, i) =>
      item({ poz_code: `P${i}`, width_mm: Math.round(rnd() * 30000) / 10 + 100, height_mm: Math.round(rnd() * 30000) / 10 + 100, quantity: 1 + Math.floor(rnd() * 50) }),
    )
    const t = summarize(many)
    const col = many.map(computeItem).reduce((s, r) => s + r.total.frameArea, 0)
    expect(t.verified.frameArea).toBe(col)
    expect(Number.isInteger(t.verified.frameArea)).toBe(true)
  })
})
