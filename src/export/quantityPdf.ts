/**
 * Metraj PDF raporu (pdf-lib). Türkçe karakterler için Inter (SIL OFL) TrueType alt kümesi
 * gömülür. Tablo satırları metne göre yüksekliği ayarlanır, sayfa sonunda başlık tekrarlanır;
 * metin kesilmez, taşmaz. Onaylanmamış sürümlerde "TASLAK" filigranı basılır.
 */
import fontkit from '@pdf-lib/fontkit'
import { degrees, PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb } from 'pdf-lib'
import { CATEGORY_INFO } from '@/quantity/types'
import { formatCenti, formatMilli } from '@/quantity/precision'
import { type Report, STATUS_LABEL } from './report'

export interface PdfAssets {
  regular: Uint8Array
  semibold: Uint8Array
  logo: Uint8Array | null
}

const PAGE: [number, number] = [841.89, 595.28] // A4 yatay
const M = 34
const INK = rgb(0.13, 0.15, 0.17)
const MUTED = rgb(0.41, 0.44, 0.49)
const LINE = rgb(0.82, 0.84, 0.86)
const HEAD = rgb(0.145, 0.165, 0.192)
const WARN_BG = rgb(1, 0.957, 0.84)
const WARN = rgb(0.56, 0.36, 0.06)
const DANGER = rgb(0.7, 0.22, 0.18)
const SOFT = rgb(0.94, 0.95, 0.96)

const dtf = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Metni verilen genişliğe sığacak satırlara böler; tek başına sığmayan sözcük harf harf bölünür. */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    let line = ''
    const push = (w: string) => {
      const cand = line ? `${line} ${w}` : w
      if (font.widthOfTextAtSize(cand, size) <= width) {
        line = cand
        return
      }
      if (line) out.push(line)
      line = ''
      if (font.widthOfTextAtSize(w, size) <= width) {
        line = w
        return
      }
      let chunk = ''
      for (const ch of w) {
        if (font.widthOfTextAtSize(chunk + ch, size) > width && chunk) {
          out.push(chunk)
          chunk = ''
        }
        chunk += ch
      }
      line = chunk
    }
    words.forEach(push)
    out.push(line)
  }
  return out.length ? out : ['']
}

interface Col {
  title: string
  width: number
  align?: 'left' | 'right'
}

class Writer {
  page!: PDFPage
  y = 0
  pages: PDFPage[] = []
  constructor(
    readonly doc: PDFDocument,
    readonly f: PDFFont,
    readonly fb: PDFFont,
    readonly draft: boolean,
  ) {}

  newPage() {
    this.page = this.doc.addPage(PAGE)
    this.pages.push(this.page)
    this.y = PAGE[1] - M
    if (this.draft) {
      this.page.drawText('TASLAK — ONAYLANMAMIŞ', { x: 170, y: 150, size: 64, font: this.fb, color: rgb(0.9, 0.3, 0.25), opacity: 0.07, rotate: degrees(25) })
    }
  }

  ensure(h: number, onNew?: () => void) {
    if (this.y - h < M + 22) {
      this.newPage()
      onNew?.()
    }
  }

  text(s: string, x: number, size = 9, bold = false, color = INK, y = this.y) {
    this.page.drawText(s, { x, y, size, font: bold ? this.fb : this.f, color })
  }

  /** Sarmalanan paragraf */
  para(s: string, size = 9, color = MUTED, width = PAGE[0] - 2 * M) {
    for (const line of wrapText(s, this.f, size, width)) {
      this.ensure(size + 4)
      this.y -= size + 3
      this.text(line, M, size, false, color)
    }
  }

  /** Başlık, ardından gelen içerikle aynı sayfada kalır (yetim başlık olmaz) */
  heading(s: string, keepWith = 70) {
    this.ensure(30 + keepWith)
    this.y -= 18
    this.text(s, M, 11.5, true)
    this.y -= 6
  }

  table(cols: Col[], rows: { cells: string[]; tone?: 'warn' | 'total' | 'muted' }[], size = 8) {
    const pad = 3.5
    const lh = size + 2.6
    const drawHeader = () => {
      const h = lh + 2 * pad + 2
      this.ensure(h + 20)
      let x = M
      this.page.drawRectangle({ x: M, y: this.y - h, width: cols.reduce((s, c) => s + c.width, 0), height: h, color: HEAD })
      for (const c of cols) {
        const lines = wrapText(c.title, this.fb, size, c.width - 2 * pad)
        const t = lines[0]
        const w = this.fb.widthOfTextAtSize(t, size)
        this.page.drawText(t, { x: c.align === 'right' ? x + c.width - pad - w : x + pad, y: this.y - pad - size, size, font: this.fb, color: rgb(1, 1, 1) })
        x += c.width
      }
      this.y -= h
    }
    drawHeader()
    for (const r of rows) {
      const font = r.tone === 'total' ? this.fb : this.f
      const wrapped = r.cells.map((cell, i) => wrapText(cell ?? '', font, size, cols[i].width - 2 * pad))
      const n = Math.max(...wrapped.map((w) => w.length))
      const h = n * lh + 2 * pad
      this.ensure(h, drawHeader)
      const total = cols.reduce((s, c) => s + c.width, 0)
      if (r.tone === 'warn') this.page.drawRectangle({ x: M, y: this.y - h, width: total, height: h, color: WARN_BG })
      if (r.tone === 'total') this.page.drawRectangle({ x: M, y: this.y - h, width: total, height: h, color: SOFT })
      let x = M
      wrapped.forEach((lines, i) => {
        const c = cols[i]
        lines.forEach((line, li) => {
          const w = font.widthOfTextAtSize(line, size)
          this.page.drawText(line, {
            x: c.align === 'right' ? x + c.width - pad - w : x + pad,
            y: this.y - pad - size - li * lh + 1,
            size,
            font,
            color: r.tone === 'muted' ? MUTED : INK,
          })
        })
        x += c.width
      })
      this.page.drawLine({ start: { x: M, y: this.y - h }, end: { x: M + total, y: this.y - h }, thickness: 0.5, color: LINE })
      this.y -= h
    }
  }
}

export async function reportToPdf(report: Report, assets: PdfAssets): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const f = await doc.embedFont(assets.regular, { subset: true })
  const fb = await doc.embedFont(assets.semibold, { subset: true })
  let logo: PDFImage | null = null
  if (assets.logo) {
    try {
      logo = await doc.embedPng(assets.logo)
    } catch {
      logo = null
    }
  }
  const m = report.meta
  const t = report.totals
  doc.setTitle(`${m.projectCode} — Metraj Rev ${m.revision}`)
  doc.setAuthor('LEONX METAL')
  doc.setCreator('LEONX OS')
  doc.setProducer('LEONX OS')
  doc.setCreationDate(m.generatedAt)
  const w = new Writer(doc, f, fb, m.status !== 'onaylandi')
  w.newPage()

  // ---------------------------------------------------------------- başlık
  let x = M
  if (logo) {
    const h = 40
    const lw = (logo.width / logo.height) * h
    w.page.drawImage(logo, { x: M, y: w.y - h + 4, width: lw, height: h })
    x = M + lw + 14
  }
  w.text('METRAJ RAPORU', x, 17, true, INK, w.y - 14)
  w.text(`${m.projectCode} · ${m.projectName}`, x, 10.5, false, INK, w.y - 30)
  const right = `Rev ${m.revision} · ${STATUS_LABEL[m.status]}`
  w.text(right, PAGE[0] - M - fb.widthOfTextAtSize(right, 11), 11, true, m.status === 'onaylandi' ? INK : DANGER, w.y - 14)
  const date = `Rapor tarihi: ${dtf.format(m.generatedAt)}`
  w.text(date, PAGE[0] - M - f.widthOfTextAtSize(date, 8.5), 8.5, false, MUTED, w.y - 29)
  w.y -= 50
  w.page.drawLine({ start: { x: M, y: w.y }, end: { x: PAGE[0] - M, y: w.y }, thickness: 1, color: HEAD })
  w.y -= 4

  // Proje / firma bilgisi (iki sütun)
  const info: [string, string][] = [
    ['Metraj sürümü', `Rev ${m.revision} · ${m.takeoffName}`],
    ['Durum', STATUS_LABEL[m.status] + (m.approvedAt ? ` (onay ${dtf.format(new Date(m.approvedAt))})` : '')],
    ['Konum', m.projectLocation ?? '—'],
    ['Firma', m.companyName ?? '—'],
    ['İletişim', [m.companyPhone, m.companyEmail].filter(Boolean).join(' · ') || '—'],
    ['Adres', m.companyAddress ?? '—'],
  ]
  const colW = (PAGE[0] - 2 * M) / 2
  for (let i = 0; i < info.length; i += 2) {
    w.y -= 13
    for (let j = 0; j < 2 && i + j < info.length; j++) {
      const [k, v] = info[i + j]
      const bx = M + j * colW
      w.text(k, bx, 8.5, false, MUTED)
      const lines = wrapText(v, f, 8.5, colW - 95)
      w.text(lines[0], bx + 88, 8.5, false, INK)
    }
  }
  w.y -= 8

  // ---------------------------------------------------------------- özet kutuları
  const boxes: [string, string, boolean][] = [
    ['Onaylı doğrama alanı', `${formatCenti(t.verified.frameArea)} m²`, false],
    ['Onaylı adet', t.verified.pieces.toLocaleString('tr-TR'), false],
    ['Doğrusal metraj', `${formatCenti(t.verified.length)} mtül`, false],
    ['Doğrulama bekleyen', `${t.pending.items} kalem · ${formatCenti(t.pending.frameArea)} m²`, t.pending.items > 0],
  ]
  const bw = (PAGE[0] - 2 * M - 3 * 10) / 4
  w.ensure(56)
  w.y -= 50
  boxes.forEach(([k, v, warn], i) => {
    const bx = M + i * (bw + 10)
    w.page.drawRectangle({ x: bx, y: w.y, width: bw, height: 44, color: warn ? WARN_BG : SOFT, borderColor: LINE, borderWidth: 0.6 })
    w.text(k, bx + 9, 8, false, warn ? WARN : MUTED, w.y + 29)
    w.text(v, bx + 9, 12.5, true, warn ? WARN : INK, w.y + 11)
  })
  if (t.pending.items > 0 || t.invalid > 0) {
    w.y -= 4
    w.para(
      `Uyarı: ${t.pending.items} doğrulama bekleyen${t.invalid ? ` ve ${t.invalid} hatalı` : ''} kalem kesin metraj toplamlarına DAHİL EDİLMEMİŞTİR. Ayrıntılar "Doğrulanmamış pozlar" bölümündedir.`,
      8.5,
      WARN,
    )
  }

  // ---------------------------------------------------------------- iş grubu toplamları
  w.heading('İş grubu toplamları (yalnızca onaylı pozlar)')
  w.table(
    [
      { title: 'İş grubu', width: 210 },
      { title: 'Kalem', width: 60, align: 'right' },
      { title: 'Adet', width: 70, align: 'right' },
      { title: 'Doğrama m²', width: 100, align: 'right' },
      { title: 'Doğrusal mtül', width: 100, align: 'right' },
      { title: 'Cam m²', width: 90, align: 'right' },
      { title: 'Bekleyen m² (dahil değil)', width: 143.89, align: 'right' },
    ],
    [
      ...t.byCategory.map((c) => ({
        cells: [
          CATEGORY_INFO[c.category]?.label ?? c.category,
          String(c.verified.items),
          c.verified.pieces.toLocaleString('tr-TR'),
          c.verified.frameArea || !c.verified.length ? formatCenti(c.verified.frameArea) : '—',
          c.verified.length ? formatCenti(c.verified.length) : '—',
          c.verified.glassArea ? formatCenti(c.verified.glassArea) : '—',
          c.pending.items ? formatCenti(c.pending.frameArea) : '—',
        ],
      })),
      {
        tone: 'total' as const,
        cells: [
          'ONAYLI TOPLAM',
          String(t.verified.items),
          t.verified.pieces.toLocaleString('tr-TR'),
          formatCenti(t.verified.frameArea),
          formatCenti(t.verified.length),
          formatCenti(t.verified.glassArea),
          formatCenti(t.pending.frameArea),
        ],
      },
    ],
    8.5,
  )

  // ---------------------------------------------------------------- pozlar
  w.heading('Poz listesi')
  w.table(
    [
      { title: 'Poz', width: 58 },
      { title: 'İş grubu', width: 96 },
      { title: 'Kat / Mahal', width: 82 },
      { title: 'Şekil · Ölçü (mm)', width: 132 },
      { title: 'Adet', width: 38, align: 'right' },
      { title: 'Birim m²', width: 56, align: 'right' },
      { title: 'Metraj', width: 82, align: 'right' },
      { title: 'Çevre m', width: 56, align: 'right' },
      { title: 'Cam m²', width: 52, align: 'right' },
      { title: 'Doğrulama', width: 74 },
      { title: 'Açıklama', width: 47.89 + 0 + 0 },
    ],
    [
      ...report.rows.map((r) => ({
        tone: (r.item.verification === 'reddedildi' ? 'muted' : r.item.verification !== 'onaylandi' || !r.result.ok ? 'warn' : undefined) as 'warn' | 'muted' | undefined,
        cells: [
          r.item.poz_code,
          r.category,
          [r.item.floor, r.item.space].filter(Boolean).join(' / ') || '—',
          `${r.shape} · ${r.dims}`,
          String(r.item.quantity),
          r.result.ok && r.result.unit.frameArea != null ? formatMilli(r.result.unit.frameArea) : '—',
          r.result.ok && r.result.primary ? `${formatCenti(r.result.primary.centi)} ${r.primaryUnit}` : r.result.ok ? '—' : 'HATALI',
          r.result.ok && r.result.total.perimeter ? formatCenti(r.result.total.perimeter) : '—',
          r.result.ok && r.result.total.glassArea ? formatCenti(r.result.total.glassArea) : '—',
          r.verification,
          r.item.description ?? '',
        ],
      })),
      {
        tone: 'total' as const,
        cells: ['TOPLAM', 'Onaylı', '', '', t.verified.pieces.toLocaleString('tr-TR'), '', `${formatCenti(t.verified.frameArea)} m²`, formatCenti(t.verified.perimeter), formatCenti(t.verified.glassArea), '', ''],
      },
    ],
  )

  // ---------------------------------------------------------------- doğrulanmamış
  const unv = [...report.pending, ...report.invalid.filter((r) => r.item.verification !== 'bekliyor')]
  w.heading('Doğrulanmamış pozlar ve belirsiz ölçü uyarıları')
  if (unv.length === 0) {
    w.para('Doğrulama bekleyen veya hatalı poz yok.', 9, MUTED)
  } else {
    w.table(
      [
        { title: 'Poz', width: 60 },
        { title: 'Durum', width: 80 },
        { title: 'Ölçü (mm)', width: 110 },
        { title: 'Adet', width: 40, align: 'right' },
        { title: 'Tahmini m²', width: 70, align: 'right' },
        { title: 'Belirsizlik nedenleri / hatalar', width: 413.89 },
      ],
      unv.map((r) => ({
        tone: 'warn' as const,
        cells: [
          r.item.poz_code,
          !r.result.ok ? 'Hatalı' : r.verification,
          r.dims,
          String(r.item.quantity),
          r.totalArea != null ? formatCenti(Math.round(r.totalArea * 100)) : '—',
          r.notes.join(' • ') || '—',
        ],
      })),
    )
  }

  // ---------------------------------------------------------------- kurallar
  w.heading('Hesap kuralları ve açıklamalar')
  for (const rule of report.rules) w.para(`• ${rule}`, 8.5, MUTED)

  // ---------------------------------------------------------------- alt bilgi
  const total = w.pages.length
  w.pages.forEach((p, i) => {
    const left = `LEONX OS · ${m.projectCode} · Metraj Rev ${m.revision} · ${STATUS_LABEL[m.status]}`
    p.drawLine({ start: { x: M, y: M - 2 }, end: { x: PAGE[0] - M, y: M - 2 }, thickness: 0.5, color: LINE })
    p.drawText(left, { x: M, y: M - 13, size: 7.5, font: f, color: MUTED })
    const pg = `Sayfa ${i + 1} / ${total}`
    p.drawText(pg, { x: PAGE[0] - M - f.widthOfTextAtSize(pg, 7.5), y: M - 13, size: 7.5, font: f, color: MUTED })
  })
  return doc.save({ useObjectStreams: true })
}
