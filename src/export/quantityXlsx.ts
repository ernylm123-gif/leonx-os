import { CATEGORY_INFO } from '@/quantity/types'
import { type Report, STATUS_LABEL } from './report'
import { buildXlsx, type CellInput, colName, STYLE } from './xlsx'

const dtf = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Metraj raporu Excel çalışma kitabı: Özet, Pozlar, Doğrulanmamış */
export function reportToXlsx(report: Report): Uint8Array {
  const m = report.meta
  const t = report.totals
  const n2 = (v: number | null, warn = false): CellInput => (v == null ? { v: null, s: warn ? STYLE.warnText : STYLE.text } : { v, s: warn ? STYLE.warnNum2 : STYLE.num2 })
  const n3 = (v: number | null, warn = false): CellInput => (v == null ? { v: null, s: warn ? STYLE.warnText : STYLE.text } : { v, s: warn ? STYLE.warnNum3 : STYLE.num3 })
  const tx = (v: string | null, warn = false): CellInput => ({ v: v ?? '', s: warn ? STYLE.warnText : STYLE.text })

  // ---------------------------------------------------------------- Özet
  const summary: CellInput[][] = [
    [{ v: 'LEONX METAL — METRAJ RAPORU', s: STYLE.title }],
    [{ v: m.status === 'onaylandi' ? 'Onaylı metraj sürümü' : `DİKKAT: Bu sürüm ${STATUS_LABEL[m.status].toLocaleLowerCase('tr')} durumundadır; kesin değildir.`, s: m.status === 'onaylandi' ? STYLE.muted : STYLE.dangerText }],
    [],
    [{ v: 'Proje bilgileri', s: STYLE.section }],
    [{ v: 'Proje kodu', s: STYLE.totalLabel }, tx(m.projectCode)],
    [{ v: 'Proje adı', s: STYLE.totalLabel }, tx(m.projectName)],
    [{ v: 'Konum', s: STYLE.totalLabel }, tx(m.projectLocation)],
    [{ v: 'Metraj sürümü', s: STYLE.totalLabel }, tx(`Rev ${m.revision} · ${m.takeoffName}`)],
    [{ v: 'Durum', s: STYLE.totalLabel }, tx(STATUS_LABEL[m.status])],
    [{ v: 'Onay tarihi', s: STYLE.totalLabel }, tx(m.approvedAt ? dtf.format(new Date(m.approvedAt)) : '—')],
    [{ v: 'Rapor tarihi', s: STYLE.totalLabel }, tx(dtf.format(m.generatedAt))],
    [],
    [{ v: 'Firma bilgileri', s: STYLE.section }],
    [{ v: 'Firma', s: STYLE.totalLabel }, tx(m.companyName ?? '—')],
    [{ v: 'Telefon', s: STYLE.totalLabel }, tx(m.companyPhone ?? '—')],
    [{ v: 'E-posta', s: STYLE.totalLabel }, tx(m.companyEmail ?? '—')],
    [{ v: 'Adres', s: STYLE.totalLabel }, tx(m.companyAddress ?? '—')],
    [],
    [{ v: 'İş grubu toplamları (yalnızca onaylı pozlar)', s: STYLE.section }],
    ['İş grubu', 'Kalem', 'Adet', 'Doğrama m²', 'Doğrusal mtül', 'Cam m²', 'Bekleyen m² (dahil değil)'].map((h) => ({ v: h, s: STYLE.header })),
  ]
  for (const c of t.byCategory) {
    summary.push([
      tx(CATEGORY_INFO[c.category]?.label ?? c.category),
      { v: c.verified.items, s: STYLE.int },
      { v: c.verified.pieces, s: STYLE.int },
      n2(c.verified.frameArea || !c.verified.length ? c.verified.frameArea / 100 : null),
      n2(c.verified.length ? c.verified.length / 100 : null),
      n2(c.verified.glassArea ? c.verified.glassArea / 100 : null),
      n2(c.pending.items ? c.pending.frameArea / 100 : null, c.pending.items > 0),
    ])
  }
  summary.push([
    { v: 'ONAYLI TOPLAM', s: STYLE.totalLabel },
    { v: t.verified.items, s: STYLE.totalNum2 },
    { v: t.verified.pieces, s: STYLE.totalNum2 },
    { v: t.verified.frameArea / 100, s: STYLE.totalNum2 },
    { v: t.verified.length / 100, s: STYLE.totalNum2 },
    { v: t.verified.glassArea / 100, s: STYLE.totalNum2 },
    { v: t.pending.frameArea / 100, s: STYLE.totalNum2 },
  ])
  summary.push([])
  summary.push([{ v: 'Doğrulama durumu', s: STYLE.section }])
  summary.push([{ v: 'Onaylı kalem', s: STYLE.totalLabel }, { v: t.verified.items, s: STYLE.int }])
  summary.push([{ v: 'Doğrulama bekleyen kalem (toplama dahil değil)', s: STYLE.totalLabel }, { v: t.pending.items, s: t.pending.items ? STYLE.warnInt : STYLE.int }])
  summary.push([{ v: 'Hatalı kalem (toplama dahil değil)', s: STYLE.totalLabel }, { v: t.invalid, s: STYLE.int }])
  summary.push([{ v: 'Reddedilen kalem', s: STYLE.totalLabel }, { v: t.rejected, s: STYLE.int }])
  summary.push([])
  summary.push([{ v: 'Hesap kuralları', s: STYLE.section }])
  for (const r of report.rules) summary.push([{ v: `• ${r}`, s: STYLE.muted }])

  // ---------------------------------------------------------------- Pozlar
  const headers = [
    'Sıra',
    'Poz',
    'İş grubu',
    'Kat',
    'Mahal',
    'Şekil',
    'Ölçü (mm)',
    'Genişlik mm',
    'Yükseklik mm',
    'Adet',
    'Birim alan m²',
    'Doğrama m²',
    'Boşluk m²',
    'Çevre m',
    'Cam m²',
    'Metraj',
    'Birim',
    'Doğrulama',
    'Açıklama',
    'Notlar / belirsizlikler',
  ]
  const items: CellInput[][] = [headers.map((h) => ({ v: h, s: STYLE.header }))]
  report.rows.forEach((r, i) => {
    const warn = r.item.verification !== 'onaylandi' || !r.result.ok
    items.push([
      { v: i + 1, s: warn ? STYLE.warnInt : STYLE.int },
      tx(r.item.poz_code, warn),
      tx(r.category, warn),
      tx(r.item.floor, warn),
      tx(r.item.space, warn),
      tx(r.shape, warn),
      tx(r.dims, warn),
      r.item.width_mm == null ? tx(null, warn) : { v: r.item.width_mm, s: warn ? STYLE.warnText : STYLE.text },
      r.item.height_mm == null ? tx(null, warn) : { v: r.item.height_mm, s: warn ? STYLE.warnText : STYLE.text },
      { v: r.item.quantity, s: warn ? STYLE.warnInt : STYLE.int },
      n3(r.unitArea, warn),
      n2(r.totalArea, warn),
      n2(r.totalOpening, warn),
      n2(r.totalPerimeter, warn),
      n2(r.totalGlass, warn),
      n2(r.primary, warn),
      tx(r.primaryUnit, warn),
      tx(r.verification, warn),
      { v: r.item.description ?? '', s: warn ? STYLE.warnText : STYLE.wrap },
      { v: r.notes.join(' | '), s: warn ? STYLE.warnText : STYLE.wrap },
    ])
  })
  const lastRow = items.length
  items.push([
    { v: null, s: STYLE.totalLabel },
    { v: 'ONAYLI TOPLAM', s: STYLE.totalLabel },
    ...Array.from({ length: 7 }, () => ({ v: null, s: STYLE.totalLabel })),
    { v: t.verified.pieces, s: STYLE.totalNum2 },
    { v: null, s: STYLE.totalLabel },
    { v: t.verified.frameArea / 100, s: STYLE.totalNum2 },
    { v: t.verified.openingArea / 100, s: STYLE.totalNum2 },
    { v: t.verified.perimeter / 100, s: STYLE.totalNum2 },
    { v: t.verified.glassArea / 100, s: STYLE.totalNum2 },
    { v: null, s: STYLE.totalLabel },
    { v: null, s: STYLE.totalLabel },
    { v: null, s: STYLE.totalLabel },
    { v: null, s: STYLE.totalLabel },
    { v: 'Doğrulama bekleyen ve hatalı kalemler toplama dahil değildir.', s: STYLE.totalLabel },
  ])

  // ---------------------------------------------------------------- Doğrulanmamış
  const unverified: CellInput[][] = [
    [{ v: 'Doğrulama bekleyen, hatalı veya belirsiz pozlar — kesin metraja DAHİL DEĞİLDİR', s: STYLE.title }],
    [],
    ['Poz', 'İş grubu', 'Durum', 'Ölçü (mm)', 'Adet', 'Tahmini m²', 'Güven', 'Belirsizlik nedenleri'].map((h) => ({ v: h, s: STYLE.header })),
  ]
  const seen = new Set<string>()
  for (const r of [...report.pending, ...report.invalid]) {
    if (seen.has(r.item.id)) continue
    seen.add(r.item.id)
    unverified.push([
      tx(r.item.poz_code, true),
      tx(r.category, true),
      tx(!r.result.ok ? 'Hatalı' : r.verification, true),
      tx(r.dims, true),
      { v: r.item.quantity, s: STYLE.warnInt },
      n2(r.totalArea, true),
      tx(r.item.detection ? `%${Math.round(r.item.detection.confidence * 100)}` : '—', true),
      { v: r.notes.join(' | ') || '—', s: STYLE.warnText },
    ])
  }
  if (seen.size === 0) unverified.push([{ v: 'Doğrulama bekleyen veya hatalı poz yok.', s: STYLE.muted }])

  return buildXlsx(
    [
      { name: 'Özet', rows: summary, cols: [34, 14, 12, 14, 14, 12, 22] },
      { name: 'Pozlar', rows: items, cols: [6, 12, 20, 12, 14, 14, 20, 11, 11, 7, 12, 12, 12, 11, 11, 12, 8, 18, 30, 60], freezeRows: 1, autoFilter: `A1:${colName(headers.length - 1)}${lastRow}`, landscape: true },
      { name: 'Doğrulanmamış', rows: unverified, cols: [12, 20, 18, 20, 7, 12, 8, 90], landscape: true },
    ],
    { title: `${m.projectCode} metraj Rev ${m.revision}`, creator: 'LEONX OS', created: m.generatedAt },
  )
}
