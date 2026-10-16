/**
 * Malzeme reçetesi hesap motoru — saf TypeScript (ağ, tarih veya rastgelelik yok). Veritabanına yazılan
 * satırlar (create_bom_version yükü) birebir buradan üretilir; ekran, Excel ve PDF aynı sonucu kullanır.
 *
 * Kurallar
 *  • Her poz için atanmış sistemin her bileşeninin UYGULANAN kuralları değerlendirilir. Değişkenler:
 *    W en, H boy (mm), N poz adedi, K kanat (atama > poz özniteliği > 1), A alan m², P çevre m.
 *  • Kesimli profil (mm_profil): kesim boyu ve parça formülü ZORUNLUDUR (sistemin kendi üretim kuralı).
 *    Çevreden profil boyu türetilmez. Miktar = kesim boyu × toplam parça, METRE.
 *  • basis "birim": formül tek ürün içindir, sonuç N ile çarpılır. basis "poz": formül pozun toplamıdır.
 *  • Yuvarlama: kesim boyu 0,1 mm; miktar 3 ondalık (birim değer yuvarlanır, sonra × N); yarım yukarı.
 *    Tamsayı ara birimler: dmm (0,1 mm), milli (1/1000), kuruş. Kayan nokta birikimi olmaz.
 *  • Fire (waste_pct) miktara eklenir; adet/takım biriminde fire dahil toplam yukarı yuvarlanır.
 *  • Standart boy adedi = yukarı yuvarla(fire dahil toplam boy / standart boy) — YALNIZ TAHMİN; kesim
 *    optimizasyonu değildir.
 *  • Maliyet yalnız bileşenin bağlı olduğu katalog kaydından (aynı kodun bugün geçerli en yeni fiyatı) ve
 *    birim uyumluysa hesaplanır; aksi hâlde BOŞ ("fiyat tanımlı değil"). Fiyat uydurulmaz.
 *  • Hata (formül hatası, eksik kural, negatif sonuç, tam olmayan parça) satır üretmez ve uyarı listesinde
 *    "hata" olarak görünür; hatalı reçete onaylanamaz. Sonuç sessizce 0 sayılmaz.
 */
import { currentRates } from '@/finance/fromTakeoff'
import type { CostRate } from '@/finance/types'
import { mulDiv, toCents } from '@/quote/money'
import type { Currency } from '@/quote/types'
import { evaluate, FormulaError, type FormulaVars, norm, parseFormula } from './formula'
import { type BomWarningRow, type ComponentRole, type ComponentUnit, ROLE_LABEL, ROLE_ORDER, type RuleBasis } from './types'

export const ENGINE_VERSION = 'bom-1'

export interface EngineItem {
  id: string
  poz_code: string
  category: string
  width_mm: number | null
  height_mm: number | null
  quantity: number
  verification: 'bekliyor' | 'onaylandi' | 'reddedildi'
  uncertain?: boolean
  /** Pozun açılım metni (teknik özellik) */
  opening?: string | null
  /** Pozun kanat sayısı (öznitelikte varsa) */
  kanat?: number | null
}

export interface EngineAssignment {
  item: EngineItem
  system_id: string | null
  /** Kanat sayısı (kullanıcı girişi; boşsa poz özniteliği, o da yoksa 1) */
  kanat: number | null
  /** Açılım (kural filtresi için; boşsa pozun açılım metni) */
  opening: string | null
}

export interface EngineRule {
  id: string
  applies_to: string | null
  basis: RuleBasis
  quantity_formula: string | null
  cut_length_formula: string | null
  pieces_formula: string | null
  angle: string | null
  sort_order: number
}

export interface EngineComponent {
  id: string
  role: ComponentRole
  code: string | null
  name: string
  unit: ComponentUnit
  standard_length_mm: number | null
  waste_pct: number
  weight_kg_per_m: number | null
  cost_rate_id: string | null
  sort_order: number
  rules: EngineRule[]
}

export interface EngineSystem {
  id: string
  name: string
  active: boolean
  components: EngineComponent[]
}

export type EngineRate = Pick<CostRate, 'id' | 'code' | 'unit' | 'currency' | 'unit_cost' | 'active' | 'valid_from'>

export interface BomCalcLine {
  /** Atamanın anahtarı (= metraj poz kimliği) */
  assignmentKey: string
  poz: string
  componentId: string
  ruleId: string
  lineKey: string
  role: ComponentRole
  code: string | null
  name: string
  unit: ComponentUnit
  /** Kesim boyu (dmm = 0,1 mm), yalnız profil */
  cutDmm: number | null
  angle: string | null
  /** Toplam parça (yalnız profil) */
  pieces: number | null
  /** Net toplam boy (dmm), yalnız profil */
  totalDmm: number | null
  /** Miktarlar milli (×1000). Profilde metre */
  netMilli: number
  wasteMilli: number
  totalMilli: number
  wastePct: number
  standardLengthMm: number | null
  weightMilli: number | null
  costRateId: string | null
  unitCostCents: number | null
  currency: Currency | null
  costUnit: string | null
  lineCostCents: number | null
  /** Fiyat yoksa nedeni */
  costNote: string | null
}

export interface MaterialTotal {
  key: string
  role: ComponentRole
  code: string | null
  name: string
  unit: ComponentUnit
  lines: number
  pieces: number | null
  totalDmm: number | null
  netMilli: number
  wasteMilli: number
  totalMilli: number
  standardLengthMm: number | null
  /** Tahmini standart boy adedi (fire dahil toplam / standart boy, yukarı) */
  barEstimate: number | null
  weightMilli: number | null
  /** Para birimi bazında maliyet (kuruş); fiyatsız satırlar dahil değil */
  cost: Partial<Record<Currency, number>>
  unpriced: number
}

export interface CutListEntry {
  key: string
  code: string | null
  name: string
  role: ComponentRole
  cutDmm: number
  angle: string | null
  pieces: number
  standardLengthMm: number | null
  poz: string[]
}

export interface BomCalc {
  lines: BomCalcLine[]
  totals: MaterialTotal[]
  cutList: CutListEntry[]
  warnings: BomWarningRow[]
  errorCount: number
  warningCount: number
  /** Para birimi bazında toplam maliyet (kuruş) — yalnız fiyatı tanımlı satırlar */
  cost: Partial<Record<Currency, number>>
  unpricedLines: number
  /** Metraj onaylı ve tüm pozlar onaylı (belirsiz değil). false → "onaysız metrajdan — taslak" */
  sourceApproved: boolean
  pozCount: number
}

const COUNTED: ComponentUnit[] = ['adet', 'takim']

/** Türkçe küçük harf + boşluk/alt çizgi sadeleştirme (filtre karşılaştırması) */
function fold(s: string): string {
  return s.toLocaleLowerCase('tr').replace(/[\s_-]+/g, ' ').trim()
}

/** Kural filtresi: boşsa her poz; doluysa virgülle ayrılmış değerlerden biri iş grubuna eşit veya açılım metninde geçiyorsa */
export function ruleApplies(appliesTo: string | null, category: string, opening: string | null): boolean {
  if (!appliesTo || !appliesTo.trim()) return true
  const cat = fold(category)
  const open = opening ? fold(opening) : ''
  return appliesTo
    .split(',')
    .map((x) => fold(x))
    .filter(Boolean)
    .some((x) => x === cat || (open !== '' && open.includes(x)))
}

/** Bileşen birimi ile katalog birimi uyumu → maliyet miktarı türü */
function costBasis(unit: ComponentUnit, rateUnit: string): 'miktar' | 'agirlik' | null {
  switch (unit) {
    case 'mm_profil':
      return rateUnit === 'm' || rateUnit === 'mtul' ? 'miktar' : rateUnit === 'kg' ? 'agirlik' : null
    case 'm':
      return rateUnit === 'm' || rateUnit === 'mtul' ? 'miktar' : null
    case 'm2':
      return rateUnit === 'm2' ? 'miktar' : null
    case 'adet':
      return rateUnit === 'adet' ? 'miktar' : null
    case 'kg':
      return rateUnit === 'kg' ? 'miktar' : null
    case 'takim':
      return rateUnit === 'adet' || rateUnit === 'goturu' ? 'miktar' : null
  }
}

/** Yüzde → milli-yüzde (1/1000 %), %2,125 = 2125 */
const toMilliPct = (pct: number) => Math.round(Number((pct * 1000).toPrecision(15)))
/** Değer → tamsayı milli, yarım yukarı (negatif olmayan) */
const milli = (x: number) => Math.floor(Number((x * 1000).toPrecision(15)) + 0.5)
const dmm = (x: number) => Math.floor(Number((x * 10).toPrecision(15)) + 0.5)

export interface CalculateInput {
  assignments: EngineAssignment[]
  systems: EngineSystem[]
  rates: readonly EngineRate[]
  /** Fiyat geçerlilik tarihi (YYYY-MM-DD) */
  today: string
  /** Metraj sürümü onaylı mı */
  takeoffApproved: boolean
}

export function calculateBom(input: CalculateInput): BomCalc {
  const warnings: BomWarningRow[] = []
  const lines: BomCalcLine[] = []
  const warnOnce = new Set<string>()
  const warn = (w: BomWarningRow, once?: string) => {
    if (once) {
      if (warnOnce.has(once)) return
      warnOnce.add(once)
    }
    warnings.push(w)
  }
  const systems = new Map(input.systems.map((s) => [s.id, s]))
  const catalog = currentRates(input.rates as CostRate[], input.today)
  const rateById = new Map(input.rates.map((r) => [r.id, r]))
  const currentByCode = new Map(catalog.map((r) => [r.code, r]))
  // Çözümlenmiş formül önbelleği (aynı kural yüzlerce pozda kullanılır)
  const parsed = new Map<string, ReturnType<typeof parseFormula> | FormulaError>()
  const getParsed = (src: string) => {
    let p = parsed.get(src)
    if (!p) {
      try {
        p = parseFormula(src)
      } catch (e) {
        if (!(e instanceof FormulaError)) throw e
        p = e
      }
      parsed.set(src, p)
    }
    return p
  }
  let sourceApproved = input.takeoffApproved
  let pozCount = 0

  for (const a of input.assignments) {
    const it = a.item
    if (it.verification === 'reddedildi') {
      warn({ level: 'bilgi', code: 'poz_reddedildi', message: `${it.poz_code}: metrajda reddedilmiş, reçeteye alınmadı`, poz: it.poz_code })
      continue
    }
    pozCount++
    if (it.verification !== 'onaylandi' || it.uncertain) {
      sourceApproved = false
      warn({ level: 'uyari', code: 'onaysiz_poz', message: `${it.poz_code}: metrajda ${it.uncertain ? 'belirsiz' : 'doğrulama bekliyor'} — reçete taslak kalır`, poz: it.poz_code })
    }
    if (!a.system_id) {
      warn({ level: 'hata', code: 'sistem_yok', message: `${it.poz_code}: ürün sistemi atanmamış`, poz: it.poz_code })
      continue
    }
    const sys = systems.get(a.system_id)
    if (!sys) {
      warn({ level: 'hata', code: 'sistem_bulunamadi', message: `${it.poz_code}: atanan sistem kütüphanede yok (silinmiş olabilir)`, poz: it.poz_code })
      continue
    }
    if (!sys.active) warn({ level: 'uyari', code: 'sistem_pasif', message: `${sys.name}: sistem pasif durumda`, component: null }, `pasif:${sys.id}`)
    if (sys.components.length === 0) {
      warn({ level: 'hata', code: 'bilesen_yok', message: `${sys.name}: sistemde bileşen tanımlı değil`, poz: it.poz_code })
      continue
    }
    const kanat = a.kanat ?? it.kanat ?? 1
    const vars: FormulaVars = { W: it.width_mm, H: it.height_mm, N: it.quantity, K: kanat }
    const opening = a.opening ?? it.opening ?? null
    const comps = [...sys.components].sort((x, y) => x.sort_order - y.sort_order || ROLE_ORDER[x.role] - ROLE_ORDER[y.role] || x.name.localeCompare(y.name, 'tr'))

    for (const c of comps) {
      const label = `${c.code ? `${c.code} ` : ''}${c.name}`
      if (c.rules.length === 0) {
        warn({ level: 'uyari', code: 'kural_yok', message: `${sys.name} · ${label}: üretim kuralı tanımlı değil, hesaba katılmadı`, component: label }, `kural:${c.id}`)
        continue
      }
      if (!c.code) warn({ level: 'uyari', code: 'kod_yok', message: `${sys.name} · ${c.name}: ürün/profil kodu girilmemiş`, component: c.name }, `kod:${c.id}`)
      const rules = [...c.rules].sort((x, y) => x.sort_order - y.sort_order).filter((r) => ruleApplies(r.applies_to, it.category, opening))
      let seq = 0
      for (const r of rules) {
        seq++
        const where = `${it.poz_code} · ${label}`
        const run = (src: string | null, what: string): number | null => {
          if (!src || !src.trim()) {
            warn({ level: 'hata', code: 'kural_eksik', message: `${where}: ${what} formülü girilmemiş`, poz: it.poz_code, component: label })
            return null
          }
          const p = getParsed(src)
          if (p instanceof FormulaError) {
            warn({ level: 'hata', code: 'formul_hatasi', message: `${where}: ${what} formülü hatalı — ${p.message}`, poz: it.poz_code, component: label })
            return null
          }
          try {
            return evaluate(p, vars)
          } catch (e) {
            if (!(e instanceof FormulaError)) throw e
            warn({ level: 'hata', code: 'formul_hatasi', message: `${where}: ${what} — ${e.message}`, poz: it.poz_code, component: label })
            return null
          }
        }
        const N = it.quantity
        let netMilli: number
        let cutDmm: number | null = null
        let pieces: number | null = null
        let totalDmm: number | null = null
        if (c.unit === 'mm_profil') {
          const cut = run(r.cut_length_formula, 'kesim boyu')
          const pcs = run(r.pieces_formula, 'parça sayısı')
          if (cut == null || pcs == null) continue
          if (pcs === 0) {
            warn({ level: 'bilgi', code: 'sifir', message: `${where}: parça sayısı 0 — satır üretilmedi`, poz: it.poz_code, component: label })
            continue
          }
          if (pcs < 0 || cut <= 0) {
            warn({ level: 'hata', code: 'negatif', message: `${where}: ${cut <= 0 ? `kesim boyu ${String(cut).replace('.', ',')} mm` : `parça sayısı ${pcs}`} — sıfırdan büyük olmalı`, poz: it.poz_code, component: label })
            continue
          }
          if (!Number.isInteger(norm(pcs))) {
            warn({ level: 'hata', code: 'parca_tam_degil', message: `${where}: parça sayısı tam sayı değil (${String(pcs).replace('.', ',')}); formülde ceil()/round() kullanın`, poz: it.poz_code, component: label })
            continue
          }
          cutDmm = dmm(cut)
          pieces = (r.basis === 'birim' ? norm(pcs) * N : norm(pcs))
          totalDmm = cutDmm * pieces
          // Net metre (milli = mm): toplam dmm / 10, yarım yukarı
          netMilli = Math.floor((totalDmm + 5) / 10)
          if (c.standard_length_mm && cutDmm > c.standard_length_mm * 10) {
            warn({ level: 'uyari', code: 'boy_asimi', message: `${where}: kesim boyu ${(cutDmm / 10).toLocaleString('tr-TR')} mm standart boydan (${c.standard_length_mm.toLocaleString('tr-TR')} mm) uzun`, poz: it.poz_code, component: label })
          }
        } else {
          const q = run(r.quantity_formula, 'miktar')
          if (q == null) continue
          if (q === 0) {
            warn({ level: 'bilgi', code: 'sifir', message: `${where}: miktar 0 — satır üretilmedi`, poz: it.poz_code, component: label })
            continue
          }
          if (q < 0) {
            warn({ level: 'hata', code: 'negatif', message: `${where}: miktar negatif (${String(q).replace('.', ',')})`, poz: it.poz_code, component: label })
            continue
          }
          const unitMilli = milli(q)
          if (unitMilli === 0) {
            warn({ level: 'hata', code: 'cok_kucuk', message: `${where}: miktar 0,001'den küçük (${q})`, poz: it.poz_code, component: label })
            continue
          }
          if (COUNTED.includes(c.unit) && unitMilli % 1000 !== 0) {
            warn({ level: 'hata', code: 'adet_tam_degil', message: `${where}: ${c.unit === 'adet' ? 'adet' : 'takım'} tam sayı değil (${String(q).replace('.', ',')}); formülde ceil()/round() kullanın`, poz: it.poz_code, component: label })
            continue
          }
          netMilli = r.basis === 'birim' ? unitMilli * N : unitMilli
        }

        // Fire
        const wmp = toMilliPct(Number(c.waste_pct) || 0)
        let totalMilli: number
        if (COUNTED.includes(c.unit)) {
          // Adet/takım: fire dahil toplam yukarı tam sayıya
          const raw = netMilli * (100_000 + wmp)
          totalMilli = Math.ceil(raw / (100_000 * 1000)) * 1000
        } else {
          totalMilli = netMilli + (wmp ? mulDiv(netMilli, wmp, 100_000) : 0)
        }
        const wasteMilli = totalMilli - netMilli
        const weightMilli = c.unit === 'mm_profil' && c.weight_kg_per_m ? mulDiv(totalMilli, milli(Number(c.weight_kg_per_m)), 1000) : null

        // Maliyet: bağlı katalog kaydının kodu için bugün geçerli fiyat
        let costRateId: string | null = null
        let unitCostCents: number | null = null
        let currency: Currency | null = null
        let costUnit: string | null = null
        let lineCostCents: number | null = null
        let costNote: string | null = 'fiyat tanımlı değil'
        if (c.cost_rate_id) {
          const linked = rateById.get(c.cost_rate_id)
          const rate = linked ? currentByCode.get(linked.code) : undefined
          if (!rate) costNote = linked ? 'katalog fiyatı geçerli değil' : 'fiyat tanımlı değil'
          else {
            const basis = costBasis(c.unit, rate.unit)
            const qty = basis === 'miktar' ? totalMilli : basis === 'agirlik' ? weightMilli : null
            if (basis == null) {
              costNote = `birim uyuşmuyor (katalog: ${rate.unit})`
              warn({ level: 'uyari', code: 'birim_uyusmuyor', message: `${sys.name} · ${label}: katalog birimi "${rate.unit}" bileşen birimiyle uyuşmuyor; maliyet hesaplanmadı`, component: label }, `birim:${c.id}`)
            } else if (qty == null) {
              costNote = 'kg/m tanımlı değil'
            } else {
              costRateId = rate.id
              unitCostCents = toCents(Number(rate.unit_cost))
              currency = rate.currency
              costUnit = rate.unit
              lineCostCents = mulDiv(qty, unitCostCents, 1000)
              costNote = null
            }
          }
        }

        lines.push({
          assignmentKey: it.id,
          poz: it.poz_code,
          componentId: c.id,
          ruleId: r.id,
          lineKey: `${it.poz_code}|${c.code ?? c.name}|${c.role}|${c.unit}|${seq}`,
          role: c.role,
          code: c.code,
          name: c.name,
          unit: c.unit,
          cutDmm,
          angle: r.angle,
          pieces,
          totalDmm,
          netMilli,
          wasteMilli,
          totalMilli,
          wastePct: Number(c.waste_pct) || 0,
          standardLengthMm: c.standard_length_mm,
          weightMilli,
          costRateId,
          unitCostCents,
          currency,
          costUnit,
          lineCostCents,
          costNote,
        })
      }
    }
  }

  const totals = materialTotals(lines)
  const cost: Partial<Record<Currency, number>> = {}
  let unpriced = 0
  for (const l of lines) {
    if (l.lineCostCents == null || !l.currency) unpriced++
    else cost[l.currency] = (cost[l.currency] ?? 0) + l.lineCostCents
  }
  const order = { hata: 0, uyari: 1, bilgi: 2 } as const
  warnings.sort((x, y) => order[x.level] - order[y.level])
  return {
    lines,
    totals,
    cutList: cutList(lines),
    warnings,
    errorCount: warnings.filter((w) => w.level === 'hata').length,
    warningCount: warnings.filter((w) => w.level === 'uyari').length,
    cost,
    unpricedLines: unpriced,
    sourceApproved: sourceApproved && pozCount > 0,
    pozCount,
  }
}

/** Bileşen kodu + birim bazında toplamlar (rol sırasıyla) */
export function materialTotals(lines: readonly BomCalcLine[]): MaterialTotal[] {
  const map = new Map<string, MaterialTotal>()
  for (const l of lines) {
    const key = `${l.role}|${l.code ?? ''}|${l.name}|${l.unit}`
    let t = map.get(key)
    if (!t) {
      t = { key, role: l.role, code: l.code, name: l.name, unit: l.unit, lines: 0, pieces: null, totalDmm: null, netMilli: 0, wasteMilli: 0, totalMilli: 0, standardLengthMm: null, barEstimate: null, weightMilli: null, cost: {}, unpriced: 0 }
      map.set(key, t)
    }
    t.lines++
    if (l.pieces != null) t.pieces = (t.pieces ?? 0) + l.pieces
    if (l.totalDmm != null) t.totalDmm = (t.totalDmm ?? 0) + l.totalDmm
    t.netMilli += l.netMilli
    t.wasteMilli += l.wasteMilli
    t.totalMilli += l.totalMilli
    if (l.standardLengthMm) t.standardLengthMm = Math.max(t.standardLengthMm ?? 0, l.standardLengthMm)
    if (l.weightMilli != null) t.weightMilli = (t.weightMilli ?? 0) + l.weightMilli
    if (l.lineCostCents != null && l.currency) t.cost[l.currency] = (t.cost[l.currency] ?? 0) + l.lineCostCents
    else t.unpriced++
  }
  for (const t of map.values()) {
    // Profil miktarı metre (milli = mm): boy adedi = yukarı(toplam mm / standart boy mm)
    if (t.unit === 'mm_profil' && t.standardLengthMm) t.barEstimate = Math.ceil(t.totalMilli / t.standardLengthMm)
  }
  return [...map.values()].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || (a.code ?? a.name).localeCompare(b.code ?? b.name, 'tr', { numeric: true }))
}

/** Profil kesim listesi: kod × kesim boyu × açı → toplam parça (gelecekteki kesim optimizasyonunun girdisi) */
export function cutList(lines: readonly BomCalcLine[]): CutListEntry[] {
  const map = new Map<string, CutListEntry>()
  for (const l of lines) {
    if (l.unit !== 'mm_profil' || l.cutDmm == null || l.pieces == null) continue
    const key = `${l.code ?? l.name}|${l.cutDmm}|${l.angle ?? ''}`
    let e = map.get(key)
    if (!e) {
      e = { key, code: l.code, name: l.name, role: l.role, cutDmm: l.cutDmm, angle: l.angle, pieces: 0, standardLengthMm: l.standardLengthMm, poz: [] }
      map.set(key, e)
    }
    e.pieces += l.pieces
    if (!e.poz.includes(l.poz)) e.poz.push(l.poz)
  }
  return [...map.values()].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || (a.code ?? a.name).localeCompare(b.code ?? b.name, 'tr', { numeric: true }) || b.cutDmm - a.cutDmm)
}

/** Rol başlığıyla gruplanmış satırlar (ekran ve PDF) */
export function groupByRole<T extends { role: ComponentRole }>(lines: readonly T[]): { role: ComponentRole; label: string; lines: T[] }[] {
  const map = new Map<ComponentRole, T[]>()
  for (const l of lines) map.set(l.role, [...(map.get(l.role) ?? []), l])
  return [...map.entries()].sort((a, b) => ROLE_ORDER[a[0]] - ROLE_ORDER[b[0]]).map(([role, ls]) => ({ role, label: ROLE_LABEL[role], lines: ls }))
}

// ------------------------------------------------------------------ veritabanı yükü
const n3 = (m: number) => m / 1000
const n1 = (d: number) => d / 10
const n2 = (c: number) => c / 100

/** create_bom_version yükü — satırlar motor sonucundan BİREBİR */
export function toPayload(calc: BomCalc, assignments: readonly EngineAssignment[], opts: { notes?: string | null; basedOn?: string | null } = {}) {
  return {
    engine_version: ENGINE_VERSION,
    notes: opts.notes ?? null,
    based_on: opts.basedOn ?? null,
    error_count: calc.errorCount,
    warning_count: calc.warningCount,
    warnings: calc.warnings.slice(0, 500),
    assignments: assignments
      .filter((a) => a.item.verification !== 'reddedildi')
      .map((a, i) => ({ key: a.item.id, quantity_item_id: a.item.id, system_id: a.system_id, kanat: a.kanat, opening: a.opening, sort_order: i })),
    lines: calc.lines.map((l, i) => ({
      assignment_key: l.assignmentKey,
      component_id: l.componentId,
      rule_id: l.ruleId,
      line_key: l.lineKey,
      role: l.role,
      code: l.code,
      name: l.name,
      unit: l.unit,
      cut_length_mm: l.cutDmm == null ? null : n1(l.cutDmm),
      angle: l.angle,
      pieces: l.pieces,
      total_length_mm: l.totalDmm == null ? null : n1(l.totalDmm),
      net_quantity: n3(l.netMilli),
      waste_pct: l.wastePct,
      waste_qty: n3(l.wasteMilli),
      quantity: n3(l.totalMilli),
      standard_length_mm: l.standardLengthMm,
      weight_kg: l.weightMilli == null ? null : n3(l.weightMilli),
      cost_rate_id: l.costRateId,
      unit_cost: l.unitCostCents == null ? null : n2(l.unitCostCents),
      currency: l.currency,
      cost_unit: l.costUnit,
      line_cost: l.lineCostCents == null ? null : n2(l.lineCostCents),
      sort_order: i,
    })),
  }
}

/** Kaydedilmiş satırı (veritabanı) motor satırı biçimine çevirir — kayıtlı sürümün ekranı/raporu için */
export function fromStoredLine(l: {
  assignment_id: string | null
  poz_code: string | null
  component_id: string | null
  rule_id: string | null
  line_key: string
  role: ComponentRole
  code: string | null
  name: string
  unit: ComponentUnit
  cut_length_mm: number | null
  angle: string | null
  pieces: number | null
  total_length_mm: number | null
  net_quantity: number
  waste_pct: number
  waste_qty: number
  quantity: number
  standard_length_mm: number | null
  weight_kg: number | null
  cost_rate_id: string | null
  unit_cost: number | null
  currency: Currency | null
  cost_unit: string | null
  line_cost: number | null
}): BomCalcLine {
  return {
    assignmentKey: l.assignment_id ?? '',
    poz: l.poz_code ?? '—',
    componentId: l.component_id ?? '',
    ruleId: l.rule_id ?? '',
    lineKey: l.line_key,
    role: l.role,
    code: l.code,
    name: l.name,
    unit: l.unit,
    cutDmm: l.cut_length_mm == null ? null : dmm(Number(l.cut_length_mm)),
    angle: l.angle,
    pieces: l.pieces == null ? null : Number(l.pieces),
    totalDmm: l.total_length_mm == null ? null : dmm(Number(l.total_length_mm)),
    netMilli: milli(Number(l.net_quantity)),
    wasteMilli: milli(Number(l.waste_qty)),
    totalMilli: milli(Number(l.quantity)),
    wastePct: Number(l.waste_pct),
    standardLengthMm: l.standard_length_mm,
    weightMilli: l.weight_kg == null ? null : milli(Number(l.weight_kg)),
    costRateId: l.cost_rate_id,
    unitCostCents: l.unit_cost == null ? null : toCents(Number(l.unit_cost)),
    currency: l.currency,
    costUnit: l.cost_unit,
    lineCostCents: l.line_cost == null ? null : toCents(Number(l.line_cost)),
    costNote: l.line_cost == null ? 'fiyat tanımlı değil' : null,
  }
}

/** Kayıtlı satırlardan toplamlar ve kesim listesi (motorla aynı fonksiyonlar) */
export function summarizeStored(lines: readonly BomCalcLine[]) {
  const cost: Partial<Record<Currency, number>> = {}
  let unpriced = 0
  for (const l of lines) {
    if (l.lineCostCents == null || !l.currency) unpriced++
    else cost[l.currency] = (cost[l.currency] ?? 0) + l.lineCostCents
  }
  return { totals: materialTotals(lines), cutList: cutList(lines), cost, unpricedLines: unpriced }
}
