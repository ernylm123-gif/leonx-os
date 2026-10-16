/**
 * Reçete motoru testleri.
 *
 * DİKKAT: Aşağıdaki "SENTETİK" sistem YALNIZ TEST İÇİNDİR ve uygulamayla gönderilmez. Kodlar, ölçü
 * düşümleri, standart boylar ve fiyatlar gerçek bir üreticiye ait DEĞİLDİR; motorun aritmetiğini sınamak
 * için uydurulmuş yuvarlak sayılardır.
 */
import { describe, expect, it } from 'vitest'
import { diffLines } from './diff'
import { calculateBom, cutList, type EngineAssignment, type EngineComponent, type EngineItem, type EngineRate, type EngineSystem, fromStoredLine, ruleApplies, summarizeStored, toPayload } from './engine'

let seq = 0
const rule = (p: Partial<EngineComponent['rules'][number]>) => ({
  id: `r${++seq}`,
  applies_to: null,
  basis: 'birim' as const,
  quantity_formula: null,
  cut_length_formula: null,
  pieces_formula: null,
  angle: null,
  sort_order: seq,
  ...p,
})
const comp = (p: Partial<EngineComponent> & Pick<EngineComponent, 'role' | 'name' | 'unit'>): EngineComponent => ({
  id: `c${++seq}`,
  code: null,
  standard_length_mm: null,
  waste_pct: 0,
  weight_kg_per_m: null,
  cost_rate_id: null,
  sort_order: seq,
  rules: [],
  ...p,
})

// ------------------------------------------------------------------ SENTETİK test sistemi (gönderilmez)
const RATES: EngineRate[] = [
  { id: 'rate-kasa', code: 'SENT-KASA', unit: 'm', currency: 'TRY', unit_cost: 100, active: true, valid_from: '2026-01-01' },
  { id: 'rate-cam', code: 'SENT-CAM', unit: 'adet', currency: 'TRY', unit_cost: 50, active: true, valid_from: '2026-01-01' },
  { id: 'rate-fitil', code: 'SENT-FITIL', unit: 'mtul', currency: 'EUR', unit_cost: 1.25, active: true, valid_from: '2026-01-01' },
]
function syntheticSystem(): EngineSystem {
  return {
    id: 'sys-sentetik',
    name: 'SENTETİK TEST SİSTEMİ',
    active: true,
    components: [
      comp({
        role: 'kasa', code: 'SENT-KASA', name: 'Sentetik kasa', unit: 'mm_profil', standard_length_mm: 6000, waste_pct: 5, weight_kg_per_m: 1.2, cost_rate_id: 'rate-kasa',
        rules: [rule({ cut_length_formula: 'W', pieces_formula: '2', angle: '45' }), rule({ cut_length_formula: 'H', pieces_formula: '2', angle: '45' })],
      }),
      comp({
        role: 'kanat', code: 'SENT-KANAT', name: 'Sentetik kanat', unit: 'mm_profil', standard_length_mm: 6000,
        rules: [rule({ cut_length_formula: '(W-60)/K', pieces_formula: '2*K', angle: '45' }), rule({ cut_length_formula: 'H-60', pieces_formula: '2*K', angle: '45' })],
      }),
      comp({ role: 'kayit', code: 'SENT-KAYIT', name: 'Sentetik kayıt', unit: 'mm_profil', standard_length_mm: 6000, rules: [rule({ applies_to: 'çift kanat', cut_length_formula: 'H-80', pieces_formula: 'K-1', angle: '90' })] }),
      comp({ role: 'cam', name: 'Sentetik cam', unit: 'm2', cost_rate_id: 'rate-cam', rules: [rule({ quantity_formula: '(W-120)*(H-120)/1000000' })] }),
      comp({ role: 'fitil', code: 'SENT-FITIL', name: 'Sentetik fitil', unit: 'm', waste_pct: 10, cost_rate_id: 'rate-fitil', rules: [rule({ quantity_formula: 'P*2' })] }),
      comp({ role: 'mentese', code: 'SENT-MNT', name: 'Sentetik menteşe', unit: 'adet', rules: [rule({ quantity_formula: '2*K' })] }),
      comp({ role: 'aksesuar', code: 'SENT-AKS', name: 'Sentetik aksesuar takımı', unit: 'takim', rules: [rule({ basis: 'poz', quantity_formula: 'ceil(N/3)' })] }),
    ],
  }
}
const item = (p: Partial<EngineItem> = {}): EngineItem => ({ id: 'item-p1', poz_code: 'P1', category: 'al_pencere', width_mm: 1200, height_mm: 1500, quantity: 4, verification: 'onaylandi', ...p })
const assign = (it: EngineItem, p: Partial<EngineAssignment> = {}): EngineAssignment => ({ item: it, system_id: 'sys-sentetik', kanat: null, opening: null, ...p })
const run = (assignments: EngineAssignment[], systems = [syntheticSystem()], takeoffApproved = true) =>
  calculateBom({ assignments, systems, rates: RATES, today: '2026-10-16', takeoffApproved })

describe('kullanıcı örneği: CAD 1200 × 1500 mm, 4 adet pencere, sentetik sistem', () => {
  const calc = run([assign(item())])
  const byName = (n: string) => calc.lines.filter((l) => l.name === n)

  it('kasa: sistemin kendi kuralından kesim boyu (W ve H, 45°), 2 parça × 4 adet', () => {
    const kasa = byName('Sentetik kasa')
    expect(kasa.map((l) => [l.cutDmm, l.pieces, l.angle])).toEqual([
      [12000, 8, '45'],
      [15000, 8, '45'],
    ])
    // Net boy: 8×1200 + 8×1500 = 21.600 mm; %5 fire 1.080 → 22.680 m
    const t = calc.totals.find((x) => x.code === 'SENT-KASA')!
    expect(t.totalDmm).toBe(216000)
    expect(t.netMilli).toBe(21600)
    expect(t.wasteMilli).toBe(1080)
    expect(t.totalMilli).toBe(22680)
    // Standart boy tahmini: yukarı(22.680 / 6.000) = 4 boy (optimizasyon değil)
    expect(t.barEstimate).toBe(4)
    // kg/m 1,2 × 22,680 m = 27,216 kg
    expect(t.weightMilli).toBe(27216)
    // Maliyet: 22,680 m × 100,00 ₺ = 2.268,00 ₺ (fire dahil)
    expect(t.cost.TRY).toBe(226800)
  })

  it('kanat: K=1 → (W-60) ve (H-60), 2×K parça', () => {
    expect(byName('Sentetik kanat').map((l) => [l.cutDmm, l.pieces])).toEqual([
      [11400, 8],
      [14400, 8],
    ])
    const t = calc.totals.find((x) => x.code === 'SENT-KANAT')!
    expect(t.totalMilli).toBe(20640)
    expect(t.wasteMilli).toBe(0)
    expect(t.barEstimate).toBe(4)
  })

  it('kural filtresi: "çift kanat" açılımına özel kayıt bu pozda uygulanmaz', () => {
    expect(byName('Sentetik kayıt')).toHaveLength(0)
  })

  it('cam alanı: (W-120)(H-120) = 1,4904 → birim 1,490 m² (yarım yukarı) × 4 = 5,960 m²', () => {
    const [cam] = byName('Sentetik cam')
    expect(cam.netMilli).toBe(5960)
    expect(cam.cutDmm).toBeNull()
    // Katalog birimi "adet" ≠ m² → maliyet yok, uyarı
    expect(cam.lineCostCents).toBeNull()
    expect(cam.costNote).toMatch(/birim uyuşmuyor/)
    expect(calc.warnings.some((w) => w.code === 'birim_uyusmuyor')).toBe(true)
  })

  it('fitil: P×2 = 10,8 m × 4 = 43,2 m; %10 fire → 47,52 m; EUR maliyet ayrı para biriminde', () => {
    const [f] = byName('Sentetik fitil')
    expect([f.netMilli, f.wasteMilli, f.totalMilli]).toEqual([43200, 4320, 47520])
    expect(f.currency).toBe('EUR')
    expect(f.lineCostCents).toBe(5940) // 47,52 × 1,25 = 59,40 €
    expect(calc.cost).toEqual({ TRY: 226800, EUR: 5940 })
  })

  it('adet ve poz bazlı takım', () => {
    expect(byName('Sentetik menteşe')[0].totalMilli).toBe(8000)
    // basis "poz": ceil(4/3) = 2 takım (N ile tekrar çarpılmaz)
    expect(byName('Sentetik aksesuar takımı')[0].totalMilli).toBe(2000)
  })

  it('kesim listesi: kod × kesim boyu × açı', () => {
    expect(calc.cutList.map((c) => [c.code, c.cutDmm / 10, c.angle, c.pieces])).toEqual([
      ['SENT-KASA', 1500, '45', 8],
      ['SENT-KASA', 1200, '45', 8],
      ['SENT-KANAT', 1440, '45', 8],
      ['SENT-KANAT', 1140, '45', 8],
    ])
  })

  it('onaylı metraj + onaylı poz → onaylı kaynak; hata yok', () => {
    expect(calc.sourceApproved).toBe(true)
    expect(calc.errorCount).toBe(0)
    expect(calc.unpricedLines).toBe(byName('Sentetik kanat').length + 1 + 1 + 1) // kanat×2, cam, menteşe, aksesuar
  })
})

describe('kanat sayısı, açılım filtresi ve çoklu poz', () => {
  it('K ataması kanat ve kayıt kurallarını değiştirir; açılım filtresi uygulanır', () => {
    const calc = run([assign(item(), { kanat: 2, opening: 'Çift kanat, içe açılım' })])
    const kanat = calc.lines.filter((l) => l.code === 'SENT-KANAT')
    expect(kanat.map((l) => [l.cutDmm, l.pieces])).toEqual([
      [5700, 16],
      [14400, 16],
    ])
    const kayit = calc.lines.filter((l) => l.code === 'SENT-KAYIT')
    expect(kayit.map((l) => [l.cutDmm, l.pieces, l.angle])).toEqual([[14200, 4, '90']])
  })
  it('aynı profil kodu ve kesim boyu farklı pozlardan birleşir', () => {
    const calc = run([assign(item()), assign(item({ id: 'item-p2', poz_code: 'P2', width_mm: 1200, height_mm: 1000, quantity: 2 }))])
    const k1200 = calc.cutList.find((c) => c.code === 'SENT-KASA' && c.cutDmm === 12000)!
    expect(k1200.pieces).toBe(12)
    expect(k1200.poz).toEqual(['P1', 'P2'])
  })
  it('ruleApplies: virgüllü liste, iş grubu veya açılım metni (Türkçe büyük/küçük)', () => {
    expect(ruleApplies(null, 'al_pencere', null)).toBe(true)
    expect(ruleApplies('al_pencere, surme', 'surme', null)).toBe(true)
    expect(ruleApplies('ÇİFT KANAT', 'al_pencere', 'çift kanat')).toBe(true)
    expect(ruleApplies('vasistas', 'al_pencere', 'çift kanat')).toBe(false)
    expect(ruleApplies('vasistas', 'al_pencere', null)).toBe(false)
  })
})

describe('uyarılar ve hatalar (sessizce 0 yok)', () => {
  it('sistem atanmamış poz hata; reddedilen poz atlanır', () => {
    const calc = run([assign(item(), { system_id: null }), assign(item({ id: 'x', poz_code: 'R1', verification: 'reddedildi' }))])
    expect(calc.lines).toHaveLength(0)
    expect(calc.warnings.map((w) => w.code)).toEqual(['sistem_yok', 'poz_reddedildi'])
    expect(calc.errorCount).toBe(1)
  })
  it('kural eksik, formül hatası, tanımsız boy, negatif ve tam olmayan parça', () => {
    const sys: EngineSystem = {
      id: 's2', name: 'Hatalı sentetik', active: true,
      components: [
        comp({ role: 'kasa', name: 'Eksik', unit: 'mm_profil', rules: [rule({ cut_length_formula: 'W' })] }),
        comp({ role: 'kanat', name: 'Sözdizimi', unit: 'mm_profil', rules: [rule({ cut_length_formula: 'W-', pieces_formula: '2' })] }),
        comp({ role: 'kayit', name: 'Negatif', unit: 'mm_profil', rules: [rule({ cut_length_formula: 'W-5000', pieces_formula: '1' })] }),
        comp({ role: 'orta_kayit', name: 'Kesirli', unit: 'mm_profil', rules: [rule({ cut_length_formula: 'W', pieces_formula: 'K/2' })] }),
        comp({ role: 'cam', name: 'Boy yok', unit: 'm2', rules: [rule({ quantity_formula: 'W*H/1000000' })] }),
        comp({ role: 'mentese', name: 'Yarım adet', unit: 'adet', rules: [rule({ quantity_formula: '1.5' })] }),
        comp({ role: 'aksesuar', name: 'Kuralsız', unit: 'takim' }),
        comp({ role: 'fitil', name: 'Sıfır', unit: 'm', rules: [rule({ quantity_formula: 'K-1' })] }),
      ],
    }
    const calc = run([assign(item({ height_mm: null }), { system_id: 's2' })], [sys])
    expect(calc.lines).toHaveLength(0)
    const msgs = calc.warnings.map((w) => `${w.level}:${w.code}:${w.message}`)
    expect(msgs.some((m) => /hata:kural_eksik:.*parça sayısı formülü girilmemiş/.test(m))).toBe(true)
    expect(msgs.some((m) => /hata:formul_hatasi:.*Sözdizimi: kesim boyu formülü hatalı — Formül eksik bitiyor/.test(m))).toBe(true)
    expect(msgs.some((m) => /hata:negatif:.*kesim boyu -3800 mm/.test(m))).toBe(true)
    expect(msgs.some((m) => /hata:parca_tam_degil:.*0,5/.test(m))).toBe(true)
    expect(msgs.some((m) => /hata:formul_hatasi:.*H \(boy \(mm\)\) bu pozda tanımlı değil/.test(m))).toBe(true)
    expect(msgs.some((m) => /hata:adet_tam_degil/.test(m))).toBe(true)
    expect(msgs.some((m) => /uyari:kural_yok:.*Kuralsız/.test(m))).toBe(true)
    expect(msgs.some((m) => /bilgi:sifir:.*Sıfır: miktar 0/.test(m))).toBe(true)
    expect(calc.errorCount).toBe(6)
    // hatalar önce sıralanır
    expect(calc.warnings[0].level).toBe('hata')
  })
  it('standart boydan uzun kesim uyarısı', () => {
    const calc = run([assign(item({ width_mm: 6500 }))])
    expect(calc.warnings.some((w) => w.code === 'boy_asimi' && /6\.500 mm standart boydan \(6\.000 mm\)/.test(w.message))).toBe(true)
  })
  it('onaysız poz veya taslak metraj → onaylı kaynak değil', () => {
    expect(run([assign(item({ verification: 'bekliyor' }))]).sourceApproved).toBe(false)
    expect(run([assign(item({ uncertain: true }))]).sourceApproved).toBe(false)
    expect(run([assign(item())], [syntheticSystem()], false).sourceApproved).toBe(false)
    expect(run([]).sourceApproved).toBe(false)
  })
})

describe('fire ve fiyat', () => {
  const sys = (waste: number, unit: EngineComponent['unit'], f = '7'): EngineSystem => ({
    id: 'sf', name: 'Fire', active: true, components: [comp({ role: 'aksesuar', code: 'F', name: 'F', unit, waste_pct: waste, rules: [rule({ quantity_formula: f })] })],
  })
  it('sürekli birimde fire yarım yukarı, adette yukarı tam sayı', () => {
    // 7 × 3 = 21 adet, %5 fire = 22,05 → 23 adet
    let c = run([assign(item({ quantity: 3 }), { system_id: 'sf' })], [sys(5, 'adet')])
    expect([c.lines[0].netMilli, c.lines[0].totalMilli, c.lines[0].wasteMilli]).toEqual([21000, 23000, 2000])
    // 0,333 m × 3 = 0,999 m, %2,125 → 0,999 × 0,02125 = 0,02123 → 0,021
    c = run([assign(item({ quantity: 3 }), { system_id: 'sf' })], [sys(2.125, 'm', '1/3')])
    expect([c.lines[0].netMilli, c.lines[0].wasteMilli, c.lines[0].totalMilli]).toEqual([999, 21, 1020])
  })
  it('katalog fiyatı: aynı kodun bugün geçerli en yeni kaydı; geçerli kayıt yoksa boş', () => {
    const s: EngineSystem = { id: 'sp', name: 'Fiyat', active: true, components: [comp({ role: 'fitil', code: 'X', name: 'X', unit: 'm', cost_rate_id: 'old', rules: [rule({ quantity_formula: '10' })] })] }
    const rates: EngineRate[] = [
      { id: 'old', code: 'X-M', unit: 'm', currency: 'TRY', unit_cost: 2, active: true, valid_from: '2026-01-01' },
      { id: 'new', code: 'X-M', unit: 'm', currency: 'TRY', unit_cost: 3, active: true, valid_from: '2026-06-01' },
      { id: 'future', code: 'X-M', unit: 'm', currency: 'TRY', unit_cost: 9, active: true, valid_from: '2027-01-01' },
    ]
    const c = calculateBom({ assignments: [assign(item({ quantity: 1 }), { system_id: 'sp' })], systems: [s], rates, today: '2026-10-16', takeoffApproved: true })
    expect([c.lines[0].costRateId, c.lines[0].unitCostCents, c.lines[0].lineCostCents]).toEqual(['new', 300, 3000])
    const none = calculateBom({ assignments: [assign(item({ quantity: 1 }), { system_id: 'sp' })], systems: [s], rates: [{ ...rates[0], active: false }], today: '2026-10-16', takeoffApproved: true })
    expect(none.lines[0].lineCostCents).toBeNull()
    expect(none.lines[0].costNote).toBe('katalog fiyatı geçerli değil')
    expect(none.cost).toEqual({})
  })
  it('profil kg fiyatı ağırlıktan; kg/m yoksa fiyat yok', () => {
    const mk = (kgm: number | null): EngineSystem => ({ id: 'sk', name: 'Kg', active: true, components: [comp({ role: 'kasa', code: 'K', name: 'K', unit: 'mm_profil', weight_kg_per_m: kgm, cost_rate_id: 'kg', rules: [rule({ cut_length_formula: '1000', pieces_formula: '1' })] })] })
    const rates: EngineRate[] = [{ id: 'kg', code: 'KG', unit: 'kg', currency: 'USD', unit_cost: 4, active: true, valid_from: '2026-01-01' }]
    const a = calculateBom({ assignments: [assign(item({ quantity: 5 }), { system_id: 'sk' })], systems: [mk(1.5)], rates, today: '2026-10-16', takeoffApproved: true })
    expect([a.lines[0].weightMilli, a.lines[0].lineCostCents, a.lines[0].currency]).toEqual([7500, 3000, 'USD'])
    const b = calculateBom({ assignments: [assign(item({ quantity: 5 }), { system_id: 'sk' })], systems: [mk(null)], rates, today: '2026-10-16', takeoffApproved: true })
    expect(b.lines[0].lineCostCents).toBeNull()
    expect(b.lines[0].costNote).toBe('kg/m tanımlı değil')
  })
})

describe('kayıt yükü, kayıtlı satırlar ve sürüm karşılaştırması', () => {
  it('yük motor satırlarıyla birebir; kayıttan geri okunan toplamlar aynı', () => {
    const calc = run([assign(item())])
    const p = toPayload(calc, [assign(item())])
    expect(p.lines).toHaveLength(calc.lines.length)
    const kasa = p.lines[0]
    expect(kasa).toMatchObject({ assignment_key: 'item-p1', cut_length_mm: 1200, pieces: 8, total_length_mm: 9600, net_quantity: 9.6, waste_qty: 0.48, quantity: 10.08, unit_cost: 100, line_cost: 1008 })
    const stored = p.lines.map((l) => fromStoredLine({ ...l, assignment_id: l.assignment_key, poz_code: 'P1', currency: l.currency ?? null } as never))
    const s = summarizeStored(stored)
    expect(s.cost).toEqual(calc.cost)
    expect(s.totals.map((t) => [t.key, t.totalMilli, t.barEstimate])).toEqual(calc.totals.map((t) => [t.key, t.totalMilli, t.barEstimate]))
    expect(cutList(stored)).toEqual(calc.cutList)
  })
  it('metraj revizyonu: değişen ölçü → değişen satırlar, yeni poz → eklenen, silinen poz → silinen', () => {
    const v1 = run([assign(item()), assign(item({ id: 'p2', poz_code: 'P2', width_mm: 800, height_mm: 800, quantity: 1 }))])
    const v2 = run([assign(item({ width_mm: 1300 })), assign(item({ id: 'p3', poz_code: 'P3', width_mm: 700, height_mm: 600, quantity: 1 }))])
    const d = diffLines(v1.lines, v2.lines)
    const kasaW = d.lines.find((x) => x.kind === 'degisen' && x.poz === 'P1' && x.label.startsWith('SENT-KASA') && x.key.endsWith('|1'))!
    expect(kasaW.changes).toContain('Kesim 1.200 → 1.300 mm')
    expect(d.counts.eklenen).toBe(v2.lines.filter((l) => l.poz === 'P3').length)
    expect(d.counts.silinen).toBe(v1.lines.filter((l) => l.poz === 'P2').length)
    // Kasa toplamı farkı: P1 +2×100×4 = +800 mm (fire dahil +840); P2 −3.200 (fire dahil −3.360); P3 +2.600 (fire dahil +2.730)
    const kasa = d.totals.find((t) => t.label.startsWith('SENT-KASA'))!
    expect(kasa.deltaMilli).toBe(840 - 3360 + 2730)
    expect(diffLines(v1.lines, v1.lines).lines).toHaveLength(0)
  })
})
