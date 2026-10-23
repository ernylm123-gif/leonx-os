import { buildXlsx, type CellInput, STYLE } from './xlsx'
import type { RadarReport } from './radarReport'

/** Radar fırsat raporu → Excel: "Rapor" (A–F) ve "Kaynaklar" sayfaları */
export function radarToXlsx(r: RadarReport): Uint8Array {
  const rows: CellInput[][] = [[{ v: `LEONX AI Radar — ${r.title}`, s: STYLE.title }], [{ v: r.subtitle, s: STYLE.muted }], []]
  for (const s of r.sections) {
    rows.push([{ v: s.title, s: STYLE.section }])
    if (s.note) rows.push([{ v: s.note, s: STYLE.warnText }])
    for (const row of s.rows) rows.push([{ v: row.label, s: STYLE.totalLabel }, { v: row.value, s: row.tone === 'warn' ? STYLE.warnText : row.tone === 'muted' ? STYLE.muted : STYLE.wrap }])
    rows.push([])
  }
  const src: CellInput[][] = [['İddia', 'Kaynak adresi', 'Yayın tarihi', 'Erişim zamanı'].map((h) => ({ v: h, s: STYLE.header }))]
  for (const s of r.sources) src.push([{ v: s.claim, s: STYLE.wrap }, { v: s.url, s: STYLE.text }, { v: s.published, s: STYLE.text }, { v: s.accessed, s: STYLE.text }])
  return buildXlsx(
    [
      { name: 'Rapor', rows, cols: [34, 110] },
      { name: 'Kaynaklar', rows: src, cols: [70, 60, 14, 18], freezeRows: 1 },
    ],
    { title: `LEONX AI Radar — ${r.title}`, creator: 'LEONX OS', created: r.generatedAt },
  )
}
