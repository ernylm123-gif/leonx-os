/**
 * Metraj doğruluk ölçümü (Faz 5.2). Uzman tarafından hazırlanmış referans poz listesi ile
 * motorun adaylarını karşılaştırır:
 *   - poz tespiti: precision / recall (kod eşleştirmesi P-01 = P01 = P1)
 *   - adet: tam doğru oranı, ortalama mutlak hata
 *   - ölçü: tam doğru oranı (en ve boy ±1 mm), ortalama mutlak hata (mm)
 *   - alan: toplam alanın yüzde hatası
 *   - KRİTİK HATA: yanlış (referansta olmayan) pozun veya yanlış ölçü/adedin "yüksek" güvenle
 *     sunulması — kullanıcıyı yanıltacağı için ayrıca sayılır.
 */
import { canonCode } from '../pdf/labels'

export interface ExpectedPoz {
  code: string
  width_mm?: number
  height_mm?: number
  count?: number
  category?: string
}

export interface ScoredCandidate {
  code: string
  width_mm: number | null
  height_mm: number | null
  count: number
  category: string
  level: 'yuksek' | 'orta' | 'dusuk'
  conflicts?: unknown[]
}

export interface BenchScore {
  tp: number
  fp: number
  fn: number
  precision: number
  recall: number
  /** Adedi tam doğru olan eşleşmiş poz oranı */
  countExact: number
  countMAE: number
  /** En ve boyu tam doğru olan eşleşmiş poz oranı (ölçüsü referansta olanlar) */
  dimsExact: number
  dimsMAE: number
  /** Toplam doğrama alanı (m²): referans / tespit / yüzde hata */
  areaRef: number
  areaGot: number
  areaAPE: number
  categoryExact: number
  falsePositives: string[]
  missed: string[]
  mismatches: string[]
  /** Yüksek güvenle sunulan yanlış poz / ölçü / adet */
  critical: string[]
}

const area = (w?: number | null, h?: number | null, n?: number | null) => (w && h && n ? (w * h * n) / 1e6 : 0)

export function scoreCandidates(cands: ScoredCandidate[], expected: ExpectedPoz[]): BenchScore {
  const exp = new Map(expected.map((e) => [canonCode(e.code), e]))
  const got = new Map<string, ScoredCandidate>()
  const fps: string[] = []
  for (const c of cands) {
    const k = canonCode(c.code)
    if (exp.has(k) && !got.has(k)) got.set(k, c)
    else fps.push(c.code)
  }
  const missed = [...exp.keys()].filter((k) => !got.has(k)).map((k) => exp.get(k)!.code)
  const mismatches: string[] = []
  const critical: string[] = []
  let countOk = 0
  let countN = 0
  let countErr = 0
  let dimsOk = 0
  let dimsN = 0
  let dimsErr = 0
  let catOk = 0
  let catN = 0
  let areaRef = 0
  let areaGot = 0
  for (const [k, e] of exp) {
    areaRef += area(e.width_mm, e.height_mm, e.count)
    const c = got.get(k)
    if (!c) continue
    areaGot += area(c.width_mm, c.height_mm, c.count)
    if (e.count != null) {
      countN++
      countErr += Math.abs(c.count - e.count)
      if (c.count === e.count) countOk++
      else {
        mismatches.push(`${e.code}: adet ${c.count} (beklenen ${e.count})`)
        // Çelişki gösterilmişse kullanıcı uyarılmıştır; gösterilmediyse ve güven yüksekse kritik
        if (c.level === 'yuksek' && !c.conflicts?.length) critical.push(`${e.code}: yanlış adet yüksek güvenle (${c.count} ≠ ${e.count})`)
      }
    }
    if (e.width_mm != null && e.height_mm != null) {
      dimsN++
      const ok = c.width_mm != null && c.height_mm != null && Math.abs(c.width_mm - e.width_mm) <= 1 && Math.abs(c.height_mm - e.height_mm) <= 1
      dimsErr += c.width_mm != null && c.height_mm != null ? (Math.abs(c.width_mm - e.width_mm) + Math.abs(c.height_mm - e.height_mm)) / 2 : Math.max(e.width_mm, e.height_mm)
      if (ok) dimsOk++
      else {
        mismatches.push(`${e.code}: ölçü ${c.width_mm ?? '—'}×${c.height_mm ?? '—'} (beklenen ${e.width_mm}×${e.height_mm})`)
        if (c.level === 'yuksek' && c.width_mm != null && !c.conflicts?.length) critical.push(`${e.code}: yanlış ölçü yüksek güvenle`)
      }
    }
    if (e.category) {
      catN++
      if (c.category === e.category) catOk++
      else mismatches.push(`${e.code}: iş kalemi ${c.category} (beklenen ${e.category})`)
    }
  }
  for (const code of fps) {
    const c = cands.find((x) => x.code === code)
    if (c?.level === 'yuksek') critical.push(`${code}: referansta olmayan poz yüksek güvenle`)
  }
  const tp = got.size
  return {
    tp,
    fp: fps.length,
    fn: missed.length,
    precision: tp + fps.length ? tp / (tp + fps.length) : 1,
    recall: exp.size ? tp / exp.size : 1,
    countExact: countN ? countOk / countN : 1,
    countMAE: countN ? countErr / countN : 0,
    dimsExact: dimsN ? dimsOk / dimsN : 1,
    dimsMAE: dimsN ? dimsErr / dimsN : 0,
    areaRef: Math.round(areaRef * 100) / 100,
    areaGot: Math.round(areaGot * 100) / 100,
    areaAPE: areaRef ? Math.abs(areaGot - areaRef) / areaRef : 0,
    categoryExact: catN ? catOk / catN : 1,
    falsePositives: fps,
    missed,
    mismatches,
    critical,
  }
}

const pct = (x: number) => `%${Math.round(x * 1000) / 10}`

export function formatScore(name: string, s: BenchScore, synthetic: boolean): string {
  return [
    `${synthetic ? '[SENTETİK] ' : '[GERÇEK] '}${name}`,
    `  poz: precision ${pct(s.precision)} · recall ${pct(s.recall)} (doğru ${s.tp}, fazla ${s.fp}, eksik ${s.fn})`,
    `  adet: tam doğru ${pct(s.countExact)} · ort. hata ${s.countMAE.toFixed(2)}`,
    `  ölçü: tam doğru ${pct(s.dimsExact)} · ort. hata ${s.dimsMAE.toFixed(1)} mm`,
    `  alan: referans ${s.areaRef} m² · tespit ${s.areaGot} m² · hata ${pct(s.areaAPE)}`,
    `  iş kalemi: tam doğru ${pct(s.categoryExact)}`,
    s.falsePositives.length ? `  fazla pozlar: ${s.falsePositives.join(', ')}` : '',
    s.missed.length ? `  bulunamayanlar: ${s.missed.join(', ')}` : '',
    ...s.mismatches.map((m) => `  fark: ${m}`),
    ...s.critical.map((m) => `  KRİTİK: ${m}`),
  ]
    .filter(Boolean)
    .join('\n')
}

/** Poz bazında metraj farkı satırı (rapor için): referans ↔ motor */
export interface PozDiffRow {
  kod: string
  durum: 'dogru' | 'farkli' | 'eksik' | 'fazla'
  beklenen: { en: number | null; boy: number | null; adet: number | null } | null
  bulunan: { en: number | null; boy: number | null; adet: number; guven: ScoredCandidate['level']; celiski: boolean } | null
  /** Bulunan − beklenen alan (m²); iki taraf da tamsa */
  alanFarkM2: number | null
  notlar: string[]
}

export function pozDiffTable(cands: ScoredCandidate[], expected: ExpectedPoz[]): PozDiffRow[] {
  const got = new Map<string, ScoredCandidate>()
  for (const c of cands) if (!got.has(canonCode(c.code))) got.set(canonCode(c.code), c)
  const rows: PozDiffRow[] = []
  const seen = new Set<string>()
  for (const e of expected) {
    const k = canonCode(e.code)
    seen.add(k)
    const c = got.get(k)
    const beklenen = { en: e.width_mm ?? null, boy: e.height_mm ?? null, adet: e.count ?? null }
    if (!c) {
      rows.push({ kod: e.code, durum: 'eksik', beklenen, bulunan: null, alanFarkM2: null, notlar: ['motor bu pozu bulamadı'] })
      continue
    }
    const notlar: string[] = []
    if (e.count != null && c.count !== e.count) notlar.push(`adet ${c.count} (beklenen ${e.count})`)
    if (e.width_mm != null && e.height_mm != null) {
      const ok = c.width_mm != null && c.height_mm != null && Math.abs(c.width_mm - e.width_mm) <= 1 && Math.abs(c.height_mm - e.height_mm) <= 1
      if (!ok) notlar.push(`ölçü ${c.width_mm ?? '—'}×${c.height_mm ?? '—'} (beklenen ${e.width_mm}×${e.height_mm})`)
    }
    if (e.category && c.category !== e.category) notlar.push(`iş kalemi ${c.category} (beklenen ${e.category})`)
    const a1 = area(c.width_mm, c.height_mm, c.count)
    const a0 = area(e.width_mm, e.height_mm, e.count)
    rows.push({
      kod: e.code,
      durum: notlar.length ? 'farkli' : 'dogru',
      beklenen,
      bulunan: { en: c.width_mm, boy: c.height_mm, adet: c.count, guven: c.level, celiski: !!c.conflicts?.length },
      alanFarkM2: a0 && a1 ? Math.round((a1 - a0) * 100) / 100 : null,
      notlar,
    })
  }
  for (const [k, c] of got) {
    if (seen.has(k)) continue
    rows.push({ kod: c.code, durum: 'fazla', beklenen: null, bulunan: { en: c.width_mm, boy: c.height_mm, adet: c.count, guven: c.level, celiski: !!c.conflicts?.length }, alanFarkM2: null, notlar: ['referansta yok'] })
  }
  return rows
}

/**
 * Aynı projenin iki biçimdeki (ör. PDF ve DWG→DXF) sonuçlarının uyumu. Referanstan bağımsızdır:
 * biçimler birbirini tutmuyorsa en az biri yanlıştır.
 */
export function compareFormats(a: ScoredCandidate[], b: ScoredCandidate[]) {
  const ma = new Map(a.map((c) => [canonCode(c.code), c]))
  const mb = new Map(b.map((c) => [canonCode(c.code), c]))
  const yalnizA = [...ma.keys()].filter((k) => !mb.has(k)).map((k) => ma.get(k)!.code)
  const yalnizB = [...mb.keys()].filter((k) => !ma.has(k)).map((k) => mb.get(k)!.code)
  const farklar: string[] = []
  let ortak = 0
  for (const [k, x] of ma) {
    const y = mb.get(k)
    if (!y) continue
    ortak++
    if (x.count !== y.count) farklar.push(`${x.code}: adet ${x.count} ↔ ${y.count}`)
    if (x.width_mm !== y.width_mm || x.height_mm !== y.height_mm) farklar.push(`${x.code}: ölçü ${x.width_mm ?? '—'}×${x.height_mm ?? '—'} ↔ ${y.width_mm ?? '—'}×${y.height_mm ?? '—'}`)
  }
  const union = new Set([...ma.keys(), ...mb.keys()]).size
  return { ortak, yalnizA, yalnizB, farklar, uyum: union ? (ortak - new Set(farklar.map((f) => f.split(':')[0])).size) / union : 1 }
}
