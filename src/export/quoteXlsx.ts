import { buildXlsx, type CellInput, colName, STYLE } from './xlsx'
import { formatQuoteDate, type QuoteReport, statusText } from './quoteReport'

/**
 * Teklif Excel çalışma kitabı: "Teklif" sayfası (bilgiler, kalemler, toplamlar). Sayılar sayı
 * olarak yazılır; tutarlar ekran ve PDF ile aynı yuvarlanmış değerlerdir. Birim fiyat gizleme
 * seçeneği Excel'de de uygulanır.
 */
export function quoteToXlsx(r: QuoteReport): Uint8Array {
  const q = r.quote
  const tx = (v: string | null, warn = false): CellInput => ({ v: v ?? '', s: warn ? STYLE.warnText : STYLE.text })
  const money = (c: number, warn = false): CellInput => ({ v: c / 100, s: warn ? STYLE.warnNum2 : STYLE.num2 })
  const rows: CellInput[][] = [
    [{ v: `${r.issuer.name} — FİYAT TEKLİFİ`, s: STYLE.title }],
    [{ v: `${q.quote_no}${q.revision > 1 ? ` Rev ${q.revision}` : ''} · ${statusText(q)}`, s: q.superseded ? STYLE.dangerText : STYLE.muted }],
    [],
    [{ v: 'Müşteri', s: STYLE.totalLabel }, tx(r.customer.name)],
    [{ v: 'Proje', s: STYLE.totalLabel }, tx(r.project ? `${r.project.code} · ${r.project.name}` : '—')],
    [{ v: 'Başlık', s: STYLE.totalLabel }, tx(q.title)],
    [{ v: 'Teklif tarihi', s: STYLE.totalLabel }, tx(formatQuoteDate(q.quote_date))],
    [{ v: 'Geçerlilik', s: STYLE.totalLabel }, tx(formatQuoteDate(q.valid_until))],
    [{ v: 'Para birimi', s: STYLE.totalLabel }, tx(q.currency)],
    [],
  ]
  const priced = r.showPrices
  const headers = ['#', 'Poz', 'Açıklama', 'Sistem', 'Ölçü', 'Adet', 'Miktar', 'Birim', ...(priced ? ['Birim fiyat', 'Tutar'] : []), 'Ölçü durumu', 'Kaynak', 'Not']
  const headerRow = rows.length + 1
  rows.push(headers.map((h) => ({ v: h, s: STYLE.header })))
  for (const row of r.rows) {
    const warn = !row.verified || !row.ok
    rows.push([
      { v: row.no, s: STYLE.int },
      tx(row.poz, warn),
      tx(row.description, warn),
      tx(row.system, warn),
      tx(row.dims, warn),
      { v: row.pieces, s: warn ? STYLE.warnNum3 : STYLE.num3 },
      { v: row.qtyMilli / 1000, s: warn ? STYLE.warnNum3 : STYLE.num3 },
      tx(row.unit, warn),
      ...(priced ? [money(row.unitPrice, warn), money(row.lineTotal, warn)] : []),
      tx(!row.ok ? 'Hatalı — toplama dahil değil' : row.verified ? 'Doğrulandı' : 'Doğrulanmadı', warn),
      tx(row.source ?? 'Elle', warn),
      tx(row.notes, warn),
    ])
  }
  const lastItemRow = rows.length
  rows.push([])
  const t = r.totals
  const lines: [string, number, boolean?][] = [[q.pricing_mode === 'detayli' ? 'Kalemler toplamı' : 'Teklif bedeli', t.itemsTotal]]
  if (t.shipping) lines.push(['Nakliye', t.shipping])
  if (t.other) lines.push([q.other_label || 'Diğer giderler', t.other])
  lines.push(['Ara toplam', t.subtotal])
  if (t.discount) lines.push(['İndirim', -t.discount], ['İndirimli toplam', t.net])
  lines.push([`KDV (%${String(q.vat_pct).replace('.', ',')})`, t.vat], ['GENEL TOPLAM', t.grandTotal, true])
  const labelCol = priced ? 8 : 6
  for (const [label, cents, strong] of lines) {
    const row: CellInput[] = Array.from({ length: labelCol }, () => null)
    row.push({ v: label, s: STYLE.totalLabel }, { v: cents / 100, s: strong ? STYLE.totalNum2 : STYLE.num2 })
    rows.push(row)
  }
  if (t.unverified.items) {
    rows.push([])
    rows.push([{ v: `${t.unverified.items} kalemin ölçüsü doğrulanmadı; miktarlar kesin ölçüyle güncellenecektir.`, s: STYLE.warnText }])
  }
  for (const [title, body] of [
    ['Ödeme şartları', q.payment_terms],
    ['Teslim ve montaj', q.delivery_terms],
    ['Açıklamalar ve koşullar', q.notes],
  ] as const) {
    if (!body) continue
    rows.push([])
    rows.push([{ v: title, s: STYLE.section }])
    rows.push([{ v: body, s: STYLE.wrap }])
  }
  return buildXlsx(
    [
      {
        name: 'Teklif',
        rows,
        cols: priced ? [5, 10, 48, 18, 16, 8, 11, 8, 14, 15, 16, 30, 30] : [5, 10, 52, 18, 16, 8, 11, 8, 16, 30, 30],
        freezeRows: headerRow,
        autoFilter: r.rows.length ? `A${headerRow}:${colName(headers.length - 1)}${lastItemRow}` : undefined,
      },
    ],
    { title: `${q.quote_no} Rev ${q.revision} — ${q.title}`, creator: r.issuer.name, created: r.generatedAt },
  )
}
