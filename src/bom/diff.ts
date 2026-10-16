/**
 * İki reçete sürümünün karşılaştırması: eklenen / silinen / değişen satırlar ve bileşen toplamı farkı.
 * Satırlar line_key ile eşleşir (poz | kod | rol | birim | kural sırası); kesim boyu, parça veya miktar
 * farklıysa "değişen" sayılır. Tüm farklar tamsayı birimlerle (dmm, milli) hesaplanır.
 */
import type { BomCalcLine, MaterialTotal } from './engine'
import { materialTotals } from './engine'

export type DiffKind = 'eklenen' | 'silinen' | 'degisen'

export interface LineDiff {
  kind: DiffKind
  key: string
  poz: string
  label: string
  before: BomCalcLine | null
  after: BomCalcLine | null
  /** Değişen alanların okunur açıklaması */
  changes: string[]
}

export interface TotalDiff {
  key: string
  label: string
  unit: BomCalcLine['unit']
  beforeMilli: number
  afterMilli: number
  deltaMilli: number
}

const fmt = (v: number, d: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: d }).format(v)

function lineLabel(l: BomCalcLine): string {
  return `${l.code ? `${l.code} · ` : ''}${l.name}`
}

export function diffLines(before: readonly BomCalcLine[], after: readonly BomCalcLine[]): { lines: LineDiff[]; totals: TotalDiff[]; counts: Record<DiffKind, number> } {
  const a = new Map(before.map((l) => [l.lineKey, l]))
  const b = new Map(after.map((l) => [l.lineKey, l]))
  const out: LineDiff[] = []
  for (const [key, l] of b) {
    const o = a.get(key)
    if (!o) {
      out.push({ kind: 'eklenen', key, poz: l.poz, label: lineLabel(l), before: null, after: l, changes: [] })
      continue
    }
    const changes: string[] = []
    if (o.cutDmm !== l.cutDmm) changes.push(`Kesim ${o.cutDmm == null ? '—' : fmt(o.cutDmm / 10, 1)} → ${l.cutDmm == null ? '—' : fmt(l.cutDmm / 10, 1)} mm`)
    if (o.pieces !== l.pieces) changes.push(`Parça ${o.pieces ?? '—'} → ${l.pieces ?? '—'}`)
    if (o.totalMilli !== l.totalMilli) changes.push(`Miktar ${fmt(o.totalMilli / 1000, 3)} → ${fmt(l.totalMilli / 1000, 3)}`)
    if (o.lineCostCents !== l.lineCostCents || o.currency !== l.currency) changes.push('Maliyet değişti')
    if (changes.length) out.push({ kind: 'degisen', key, poz: l.poz, label: lineLabel(l), before: o, after: l, changes })
  }
  for (const [key, l] of a) if (!b.has(key)) out.push({ kind: 'silinen', key, poz: l.poz, label: lineLabel(l), before: l, after: null, changes: [] })
  const order: Record<DiffKind, number> = { degisen: 0, eklenen: 1, silinen: 2 }
  out.sort((x, y) => order[x.kind] - order[y.kind] || x.poz.localeCompare(y.poz, 'tr', { numeric: true }) || x.key.localeCompare(y.key, 'tr'))

  const ta = new Map<string, MaterialTotal>(materialTotals(before).map((t) => [t.key, t]))
  const tb = new Map<string, MaterialTotal>(materialTotals(after).map((t) => [t.key, t]))
  const totals: TotalDiff[] = []
  for (const key of new Set([...ta.keys(), ...tb.keys()])) {
    const x = ta.get(key)
    const y = tb.get(key)
    const ref = (y ?? x)!
    const bm = x?.totalMilli ?? 0
    const am = y?.totalMilli ?? 0
    if (bm !== am) totals.push({ key, label: `${ref.code ? `${ref.code} · ` : ''}${ref.name}`, unit: ref.unit, beforeMilli: bm, afterMilli: am, deltaMilli: am - bm })
  }
  const counts = { eklenen: 0, silinen: 0, degisen: 0 }
  for (const d of out) counts[d.kind]++
  return { lines: out, totals, counts }
}
