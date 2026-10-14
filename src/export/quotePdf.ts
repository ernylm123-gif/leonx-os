/**
 * Kurumsal teklif PDF'i (A4 dikey, pdf-lib). Türkçe karakterler için Inter (SIL OFL) alt kümesi
 * gömülür. Uzun açıklamalar sarılır, tablo satırları metne göre uzar, sayfa sonunda tablo başlığı
 * tekrarlanır; hiçbir metin kesilmez veya üst üste binmez. Eski revizyonlarda filigran basılır.
 */
import fontkit from '@pdf-lib/fontkit'
import { degrees, PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb } from 'pdf-lib'
import { wrapText } from './quantityPdf'
import { formatQuoteDate, type QuoteReport } from './quoteReport'

export interface QuotePdfAssets {
  regular: Uint8Array
  semibold: Uint8Array
  logo: Uint8Array | null
}

const W = 595.28
const H = 841.89
const M = 40
const CW = W - 2 * M
const INK = rgb(0.13, 0.15, 0.17)
const MUTED = rgb(0.41, 0.44, 0.49)
const LINE = rgb(0.84, 0.86, 0.88)
const HEAD = rgb(0.145, 0.165, 0.192)
const SOFT = rgb(0.955, 0.96, 0.968)
const WARN_BG = rgb(1, 0.957, 0.84)
const WARN = rgb(0.56, 0.36, 0.06)

interface Col {
  title: string
  width: number
  align?: 'left' | 'right'
}

class Doc {
  page!: PDFPage
  y = 0
  pages: PDFPage[] = []
  constructor(
    readonly doc: PDFDocument,
    readonly f: PDFFont,
    readonly fb: PDFFont,
    readonly watermark: string | null,
  ) {}

  newPage() {
    this.page = this.doc.addPage([W, H])
    this.pages.push(this.page)
    this.y = H - M
    if (this.watermark) this.page.drawText(this.watermark, { x: 95, y: 260, size: 54, font: this.fb, color: rgb(0.75, 0.2, 0.2), opacity: 0.08, rotate: degrees(35) })
  }

  /** Yeterli yer yoksa yeni sayfa (alt bilgi için 30 pt ayrılır) */
  ensure(h: number, onNew?: () => void) {
    if (this.y - h < M + 30) {
      this.newPage()
      onNew?.()
    }
  }

  text(s: string, x: number, y: number, size = 9, bold = false, color = INK) {
    this.page.drawText(s, { x, y, size, font: bold ? this.fb : this.f, color })
  }

  right(s: string, xRight: number, y: number, size = 9, bold = false, color = INK) {
    const font = bold ? this.fb : this.f
    this.text(s, xRight - font.widthOfTextAtSize(s, size), y, size, bold, color)
  }

  para(s: string, size = 9, color = INK, x = M, width = CW) {
    for (const line of wrapText(s, this.f, size, width)) {
      this.ensure(size + 4)
      this.y -= size + 3.4
      this.text(line, x, this.y, size, false, color)
    }
  }

  section(title: string, keepWith = 40) {
    this.ensure(26 + keepWith)
    this.y -= 18
    this.text(title, M, this.y, 10.5, true)
    this.y -= 5
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: M + CW, y: this.y }, thickness: 0.6, color: LINE })
  }

  table(cols: Col[], rows: { cells: string[]; warn?: boolean }[], size = 8.5) {
    const pad = 4
    const lh = size + 2.8
    const total = cols.reduce((s, c) => s + c.width, 0)
    const header = () => {
      const h = lh + 2 * pad + 1
      this.ensure(h + 24)
      this.page.drawRectangle({ x: M, y: this.y - h, width: total, height: h, color: HEAD })
      let x = M
      for (const c of cols) {
        const t = wrapText(c.title, this.fb, size, c.width - 2 * pad)[0]
        const w = this.fb.widthOfTextAtSize(t, size)
        this.page.drawText(t, { x: c.align === 'right' ? x + c.width - pad - w : x + pad, y: this.y - pad - size, size, font: this.fb, color: rgb(1, 1, 1) })
        x += c.width
      }
      this.y -= h
    }
    header()
    rows.forEach((r, ri) => {
      const wrapped = r.cells.map((cell, i) => wrapText(cell ?? '', this.f, size, cols[i].width - 2 * pad))
      const n = Math.max(...wrapped.map((w) => w.length))
      const h = n * lh + 2 * pad
      this.ensure(h, header)
      if (r.warn) this.page.drawRectangle({ x: M, y: this.y - h, width: total, height: h, color: WARN_BG })
      else if (ri % 2 === 1) this.page.drawRectangle({ x: M, y: this.y - h, width: total, height: h, color: SOFT })
      let x = M
      wrapped.forEach((lines, i) => {
        const c = cols[i]
        lines.forEach((line, li) => {
          const w = this.f.widthOfTextAtSize(line, size)
          this.page.drawText(line, { x: c.align === 'right' ? x + c.width - pad - w : x + pad, y: this.y - pad - size - li * lh + 1, size, font: this.f, color: INK })
        })
        x += c.width
      })
      this.page.drawLine({ start: { x: M, y: this.y - h }, end: { x: M + total, y: this.y - h }, thickness: 0.4, color: LINE })
      this.y -= h
    })
  }
}

export async function quoteToPdf(r: QuoteReport, assets: QuotePdfAssets): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const f = await pdf.embedFont(assets.regular, { subset: true })
  const fb = await pdf.embedFont(assets.semibold, { subset: true })
  let logo: PDFImage | null = null
  if (assets.logo) {
    try {
      logo = await pdf.embedPng(assets.logo)
    } catch {
      logo = null
    }
  }
  const q = r.quote
  pdf.setTitle(`${q.quote_no} Rev ${q.revision} — ${q.title}`)
  pdf.setAuthor(r.issuer.name)
  pdf.setSubject('Fiyat teklifi')
  pdf.setCreator('LEONX OS')
  pdf.setProducer('LEONX OS')
  pdf.setCreationDate(r.generatedAt)

  const d = new Doc(pdf, f, fb, q.superseded ? 'ESKİ REVİZYON' : null)
  d.newPage()

  // ---------------------------------------------------------------- başlık
  const top = d.y
  const issuerX = M
  if (logo) {
    const ratio = logo.width / logo.height
    let lh = 38
    let lw = ratio * lh
    if (lw > 150) {
      lw = 150
      lh = lw / ratio
    }
    d.page.drawImage(logo, { x: M, y: top - lh, width: lw, height: lh })
    d.y = top - lh - 8
  } else {
    d.text(r.issuer.name, M, top - 16, 16, true)
    d.y = top - 26
  }
  d.text(r.issuer.name, issuerX, d.y - 2, 9, true)
  d.y -= 4
  for (const line of r.issuer.lines) {
    for (const l of wrapText(line, f, 7.8, 270)) {
      d.y -= 10
      d.text(l, issuerX, d.y, 7.8, false, MUTED)
    }
  }
  const leftBottom = d.y
  // sağ blok
  const rx = W - M
  d.right('FİYAT TEKLİFİ', rx, top - 18, 18, true)
  const meta: [string, string][] = [
    ['Teklif no', `${q.quote_no}${q.revision > 1 ? ` · Rev ${q.revision}` : ''}`],
    ['Tarih', formatQuoteDate(q.quote_date)],
    ['Geçerlilik', q.valid_until ? `${formatQuoteDate(q.valid_until)} tarihine kadar` : '—'],
    ['Para birimi', q.currency],
  ]
  let my = top - 36
  for (const [k, v] of meta) {
    my -= 12
    d.right(v, rx, my, 8.8, true)
    d.right(k, rx - fb.widthOfTextAtSize(v, 8.8) - 10, my, 8.3, false, MUTED)
  }
  d.y = Math.min(leftBottom, my) - 14
  d.page.drawLine({ start: { x: M, y: d.y }, end: { x: W - M, y: d.y }, thickness: 1.2, color: HEAD })

  // ---------------------------------------------------------------- müşteri / proje
  const boxW = (CW - 12) / 2
  const custLines = r.customer.lines.flatMap((l) => wrapText(l, f, 8.2, boxW - 20))
  const projLines = r.project ? [`${r.project.code} · ${r.project.name}`, ...(r.project.location ? [r.project.location] : [])].flatMap((l) => wrapText(l, f, 8.2, boxW - 20)) : ['Projeye bağlı değil']
  const custName = wrapText(r.customer.name, fb, 10, boxW - 20)
  const boxH = 30 + Math.max(custName.length * 13 + custLines.length * 11, projLines.length * 11 + 2)
  d.y -= 12
  d.ensure(boxH + 10)
  const by = d.y - boxH
  d.page.drawRectangle({ x: M, y: by, width: boxW, height: boxH, color: SOFT, borderColor: LINE, borderWidth: 0.6 })
  d.page.drawRectangle({ x: M + boxW + 12, y: by, width: boxW, height: boxH, color: SOFT, borderColor: LINE, borderWidth: 0.6 })
  d.text('SAYIN', M + 10, d.y - 14, 7.5, true, MUTED)
  let cy = d.y - 14
  for (const l of custName) {
    cy -= 13
    d.text(l, M + 10, cy, 10, true)
  }
  for (const l of custLines) {
    cy -= 11
    d.text(l, M + 10, cy, 8.2, false, INK)
  }
  d.text('PROJE', M + boxW + 22, d.y - 14, 7.5, true, MUTED)
  let py = d.y - 14
  projLines.forEach((l, i) => {
    py -= i === 0 ? 13 : 11
    d.text(l, M + boxW + 22, py, i === 0 ? 9.2 : 8.2, i === 0, INK)
  })
  d.y = by - 4

  // ---------------------------------------------------------------- başlık ve kapsam
  d.y -= 14
  for (const l of wrapText(q.title, fb, 12, CW)) {
    d.ensure(16)
    d.y -= 15
    d.text(l, M, d.y, 12, true)
  }
  if (q.scope) {
    d.y -= 2
    d.para(q.scope, 9, INK)
  }

  // ---------------------------------------------------------------- kalemler
  d.section('Teklif kalemleri', 60)
  d.y -= 6
  const priced = r.showPrices
  const cols: Col[] = priced
    ? [
        { title: '#', width: 20 },
        { title: 'Poz', width: 44 },
        { title: 'Açıklama', width: 165.28 },
        { title: 'Ölçü', width: 64 },
        { title: 'Adet', width: 32, align: 'right' },
        { title: 'Miktar', width: 62, align: 'right' },
        { title: 'Birim fiyat', width: 64, align: 'right' },
        { title: 'Tutar', width: 64, align: 'right' },
      ]
    : [
        { title: '#', width: 22 },
        { title: 'Poz', width: 50 },
        { title: 'Açıklama', width: 255.28 },
        { title: 'Ölçü', width: 80 },
        { title: 'Adet', width: 36, align: 'right' },
        { title: 'Miktar', width: 72, align: 'right' },
      ]
  const rows = r.rows.map((row) => {
    const desc = [row.description, row.system ? `Sistem: ${row.system}` : null, row.notes, !row.verified ? 'DİKKAT: Ölçü doğrulanmadı — kesin ölçü yerinde alınacaktır' : null, !row.ok ? 'Hatalı kalem: toplama dahil değil' : null]
      .filter(Boolean)
      .join('\n')
    const base = [String(row.no), row.poz || '—', desc, row.dims, String(row.pieces).replace('.', ','), `${row.qtyText} ${row.unit}`]
    return { warn: !row.verified || !row.ok, cells: priced ? [...base, r.money(row.unitPrice), r.money(row.lineTotal)] : base }
  })
  if (rows.length) d.table(cols, rows)
  else d.para('Kalem yok.', 9, MUTED)

  // ---------------------------------------------------------------- toplamlar
  const tw = 250
  const tx = W - M - tw
  const lineH = 15
  d.ensure(r.totalLines.length * lineH + 34)
  d.y -= 10
  for (const t of r.totalLines) {
    if (t.strong) {
      d.y -= 8
      d.page.drawRectangle({ x: tx, y: d.y - lineH - 5, width: tw, height: lineH + 6, color: HEAD })
      d.y -= lineH
      d.text(t.label, tx + 8, d.y - 1, 10, true, rgb(1, 1, 1))
      d.right(t.value, W - M - 8, d.y - 1, 10.5, true, rgb(1, 1, 1))
      d.y -= 6
    } else {
      d.y -= lineH
      d.text(t.label, tx + 8, d.y, 9, false, MUTED)
      d.right(t.value, W - M - 8, d.y, 9, false, INK)
      d.page.drawLine({ start: { x: tx, y: d.y - 4 }, end: { x: W - M, y: d.y - 4 }, thickness: 0.4, color: LINE })
    }
  }
  if (r.totals.unverified.items > 0) {
    d.y -= 8
    d.para(
      `Not: ${r.totals.unverified.items} kalemin ölçüsü henüz doğrulanmamıştır (tabloda işaretli). Bu kalemlerin miktarları yerinde kesin ölçü alındıktan sonra birim fiyatlar üzerinden güncellenecektir.`,
      8.3,
      WARN,
    )
  }

  // ---------------------------------------------------------------- şartlar
  const blocks: [string, string | null][] = [
    ['Ödeme şartları', q.payment_terms],
    ['Teslim ve montaj', q.delivery_terms],
    ['Açıklamalar ve koşullar', q.notes],
    ['Banka bilgileri', r.issuer.bank],
  ]
  for (const [title, body] of blocks) {
    if (!body) continue
    d.section(title, 24)
    d.y -= 2
    d.para(body, 8.8, INK)
  }
  if (q.valid_until) {
    d.y -= 6
    d.para(`Bu teklif ${formatQuoteDate(q.valid_until)} tarihine kadar geçerlidir. Fiyatlara KDV ayrıca belirtilmiştir.`, 8.5, MUTED)
  }

  // ---------------------------------------------------------------- kapanış ve imza
  d.ensure(110)
  d.y -= 16
  d.para(r.issuer.closing, 9, INK)
  d.y -= 18
  const sw = (CW - 30) / 2
  const sy = d.y
  d.text(r.issuer.name, M, sy, 9, true)
  d.text('Kaşe / İmza', M, sy - 12, 8, false, MUTED)
  d.page.drawLine({ start: { x: M, y: sy - 58 }, end: { x: M + sw, y: sy - 58 }, thickness: 0.6, color: LINE })
  d.text('Müşteri onayı', M + sw + 30, sy, 9, true)
  d.text('Ad soyad · Tarih · İmza', M + sw + 30, sy - 12, 8, false, MUTED)
  d.page.drawLine({ start: { x: M + sw + 30, y: sy - 58 }, end: { x: W - M, y: sy - 58 }, thickness: 0.6, color: LINE })
  d.y = sy - 64

  // ---------------------------------------------------------------- alt bilgi
  const n = d.pages.length
  d.pages.forEach((p, i) => {
    const left = `${r.issuer.name} · ${q.quote_no}${q.revision > 1 ? ` Rev ${q.revision}` : ''} · ${q.title}`
    const pg = `Sayfa ${i + 1} / ${n}`
    const maxLeft = CW - f.widthOfTextAtSize(pg, 7.5) - 20
    const l = wrapText(left, f, 7.5, maxLeft)[0]
    p.drawLine({ start: { x: M, y: M - 6 }, end: { x: W - M, y: M - 6 }, thickness: 0.5, color: LINE })
    p.drawText(l, { x: M, y: M - 17, size: 7.5, font: f, color: MUTED })
    p.drawText(pg, { x: W - M - f.widthOfTextAtSize(pg, 7.5), y: M - 17, size: 7.5, font: f, color: MUTED })
  })
  return pdf.save({ useObjectStreams: true })
}
