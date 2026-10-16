import { ROLE_LABEL } from '@/bom/types'
import { type BomReport, categoryLabel, fmtCost, qtyUnit, statusLabel } from './bomReport'
import { buildXlsx, type CellInput, STYLE } from './xlsx'

const dtf = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const LEVEL = { hata: 'Hata', uyari: 'Uyarı', bilgi: 'Bilgi' } as const

/** Malzeme reçetesi Excel çalışma kitabı: Özet, Satırlar, Kesim listesi, Pozlar, Uyarılar */
export function bomToXlsx(r: BomReport): Uint8Array {
  const m = r.meta
  const tx = (v: string | null | undefined, warn = false): CellInput => ({ v: v ?? '', s: warn ? STYLE.warnText : STYLE.text })
  const n3 = (milli: number | null): CellInput => (milli == null ? { v: null, s: STYLE.text } : { v: milli / 1000, s: STYLE.num3 })
  const n1 = (dmm: number | null): CellInput => (dmm == null ? { v: null, s: STYLE.text } : { v: dmm / 10, s: STYLE.num3 })
  const n2 = (cents: number | null, warn = false): CellInput => (cents == null ? { v: 'fiyat tanımlı değil', s: warn ? STYLE.warnText : STYLE.muted } : { v: cents / 100, s: STYLE.num2 })
  const int = (v: number | null): CellInput => (v == null ? { v: null, s: STYLE.text } : { v, s: STYLE.int })

  // ---------------------------------------------------------------- Özet
  const summary: CellInput[][] = [
    [{ v: 'LEONX METAL — MALZEME REÇETESİ', s: STYLE.title }],
    [{ v: r.banner, s: r.final ? STYLE.muted : STYLE.dangerText }],
    [],
    [{ v: 'Proje', s: STYLE.totalLabel }, tx(`${m.projectCode} · ${m.projectName}`)],
    [{ v: 'Firma', s: STYLE.totalLabel }, tx(m.companyName ?? '—')],
    [{ v: 'Reçete sürümü', s: STYLE.totalLabel }, tx(`Rev ${m.revision} · ${statusLabel(m.status)}`)],
    [{ v: 'Kaynak metraj', s: STYLE.totalLabel }, tx(`Rev ${m.takeoffRevision} · ${m.takeoffName} · ${m.takeoffStatus === 'onaylandi' ? 'onaylı' : 'onaysız'}`, !m.sourceApproved)],
    [{ v: 'Oluşturma', s: STYLE.totalLabel }, tx(dtf.format(new Date(m.createdAt)))],
    [{ v: 'Onay', s: STYLE.totalLabel }, tx(m.approvedAt ? dtf.format(new Date(m.approvedAt)) : '—')],
    [{ v: 'Rapor tarihi', s: STYLE.totalLabel }, tx(dtf.format(m.generatedAt))],
    [{ v: 'Not', s: STYLE.totalLabel }, tx(m.notes ?? '—')],
    [],
    [{ v: 'Malzeme toplamları', s: STYLE.section }],
    ['Rol', 'Kod', 'Malzeme', 'Birim', 'Parça', 'Net miktar', 'Fire', 'Toplam (fire dahil)', 'Standart boy mm', 'Tahmini boy adedi', 'Ağırlık kg', 'Maliyet'].map((h) => ({ v: h, s: STYLE.header })),
  ]
  for (const t of r.totals) {
    summary.push([
      tx(ROLE_LABEL[t.role]),
      tx(t.code ?? '—', !t.code),
      tx(t.name),
      tx(qtyUnit(t.unit)),
      int(t.pieces),
      n3(t.netMilli),
      n3(t.wasteMilli),
      n3(t.totalMilli),
      int(t.standardLengthMm),
      int(t.barEstimate),
      n3(t.weightMilli),
      Object.keys(t.cost).length ? tx(fmtCost(t.cost)) : { v: 'fiyat tanımlı değil', s: STYLE.muted },
    ])
  }
  summary.push([])
  summary.push([{ v: 'Toplam maliyet (fiyatı tanımlı satırlar)', s: STYLE.totalLabel }, tx(fmtCost(r.cost))])
  summary.push([{ v: 'Fiyatı tanımlı olmayan satır', s: STYLE.totalLabel }, { v: r.unpricedLines, s: r.unpricedLines ? STYLE.warnInt : STYLE.int }])
  summary.push([])
  summary.push([{ v: 'Hesap kuralları', s: STYLE.section }])
  for (const rule of r.rules) summary.push([{ v: `• ${rule}`, s: STYLE.muted }])

  // ---------------------------------------------------------------- Satırlar
  const lineRows: CellInput[][] = [
    ['Poz', 'Rol', 'Kod', 'Malzeme', 'Birim', 'Kesim boyu mm', 'Açı', 'Parça', 'Net miktar', 'Fire %', 'Fire', 'Toplam', 'Ağırlık kg', 'Birim maliyet', 'Para birimi', 'Tutar'].map((h) => ({ v: h, s: STYLE.header })),
  ]
  for (const g of r.groups) {
    for (const l of g.lines) {
      lineRows.push([
        tx(l.poz),
        tx(ROLE_LABEL[l.role]),
        tx(l.code ?? '—', !l.code),
        tx(l.name),
        tx(qtyUnit(l.unit)),
        n1(l.cutDmm),
        tx(l.angle ?? ''),
        int(l.pieces),
        n3(l.netMilli),
        { v: l.wastePct, s: STYLE.num3 },
        n3(l.wasteMilli),
        n3(l.totalMilli),
        n3(l.weightMilli),
        l.unitCostCents == null ? { v: null, s: STYLE.text } : { v: l.unitCostCents / 100, s: STYLE.num2 },
        tx(l.currency ?? ''),
        n2(l.lineCostCents),
      ])
    }
  }

  // ---------------------------------------------------------------- Kesim listesi
  const cut: CellInput[][] = [
    [{ v: 'Profil kesim listesi (kesim optimizasyonu girdisi; standart boy adedi yalnız tahmindir)', s: STYLE.muted }],
    ['Kod', 'Profil', 'Rol', 'Kesim boyu mm', 'Açı', 'Parça', 'Standart boy mm', 'Pozlar'].map((h) => ({ v: h, s: STYLE.header })),
  ]
  for (const c of r.cutList) {
    cut.push([tx(c.code ?? '—', !c.code), tx(c.name), tx(ROLE_LABEL[c.role]), n1(c.cutDmm), tx(c.angle ?? ''), int(c.pieces), int(c.standardLengthMm), tx(c.poz.join(', '))])
  }

  // ---------------------------------------------------------------- Pozlar
  const poz: CellInput[][] = [['Poz', 'İş grubu', 'En mm', 'Boy mm', 'Adet', 'Kanat', 'Açılım', 'Sistem', 'Metraj doğrulama'].map((h) => ({ v: h, s: STYLE.header }))]
  for (const a of r.assignments) {
    poz.push([
      tx(a.poz_code),
      tx(categoryLabel(a.category)),
      a.width_mm == null ? tx('—') : { v: Number(a.width_mm), s: STYLE.num3 },
      a.height_mm == null ? tx('—') : { v: Number(a.height_mm), s: STYLE.num3 },
      int(a.quantity),
      int(a.kanat),
      tx(a.opening ?? ''),
      tx(a.system_name ?? 'atanmamış', !a.system_name),
      tx(a.verification === 'onaylandi' ? 'Onaylı' : a.verification === 'bekliyor' ? 'Doğrulama bekliyor' : 'Reddedildi', a.verification !== 'onaylandi'),
    ])
  }

  // ---------------------------------------------------------------- Uyarılar
  const warn: CellInput[][] = [['Düzey', 'Kod', 'Açıklama'].map((h) => ({ v: h, s: STYLE.header }))]
  for (const w of r.warnings) warn.push([tx(LEVEL[w.level], w.level !== 'bilgi'), tx(w.code), { v: w.message, s: STYLE.wrap }])
  if (r.warnings.length === 0) warn.push([tx('—'), tx(''), tx('Uyarı yok')])

  return buildXlsx(
    [
      { name: 'Özet', rows: summary, cols: [22, 16, 34, 10, 10, 14, 12, 18, 16, 16, 12, 24] },
      { name: 'Satırlar', rows: lineRows, cols: [10, 14, 16, 30, 8, 14, 8, 8, 12, 8, 10, 12, 12, 14, 10, 14], freezeRows: 1, autoFilter: `A1:P${lineRows.length}`, landscape: true },
      { name: 'Kesim listesi', rows: cut, cols: [16, 30, 14, 14, 8, 10, 16, 30], freezeRows: 2 },
      { name: 'Pozlar', rows: poz, cols: [10, 22, 10, 10, 8, 8, 24, 30, 18], freezeRows: 1 },
      { name: 'Uyarılar', rows: warn, cols: [10, 18, 100], freezeRows: 1 },
    ],
    { title: `${m.projectCode} — Malzeme reçetesi Rev ${m.revision}`, creator: 'LEONX OS', created: m.generatedAt },
  )
}
