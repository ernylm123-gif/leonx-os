/**
 * Gelir-Gider / nakit defteri raporu — Excel ve PDF AYNI modelden üretilir. Tutarlar src/finance/ledger.ts
 * kayıtlarından gelir (tamsayı kuruş); para birimi bazında toplanır, birimler asla karıştırılmaz.
 */
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib'
import type { CashRecord, RecordStatus } from '@/finance/ledger'
import { RECORD_STATUS_LABEL } from '@/finance/ledger'
import { formatAmount } from '@/quote/money'
import type { Currency } from '@/quote/types'
import { wrapText } from './quantityPdf'
import { buildXlsx, type CellInput, STYLE } from './xlsx'

export interface LedgerReportRow {
  date: string
  kind: string
  source: string
  description: string
  category: string
  account: string
  project: string
  status: RecordStatus
  currency: Currency
  /** İşaretli kuruş: gelir +, gider −, virman çıkan tutar */
  signed: number
  vat: number
}

export interface LedgerReport {
  title: string
  filterText: string
  generatedAt: Date
  rows: LedgerReportRow[]
  totals: { currency: Currency; income: number; expense: number; net: number }[]
}

const KIND_TEXT = { gelir: 'Gelir', gider: 'Gider', transfer: 'Virman' } as const
const SOURCE_TEXT = { genel: 'Genel', proje_tahsilat: 'Proje tahsilatı', proje_gider: 'Proje gideri', transfer: 'Virman' } as const

export function buildLedgerReport(
  records: readonly CashRecord[],
  names: { account: (id: string | null) => string; category: (id: string | null) => string; project: (id: string | null) => string },
  filterText: string,
  totals: LedgerReport['totals'],
): LedgerReport {
  return {
    title: 'LEONX — Gelir-Gider Raporu',
    filterText,
    generatedAt: new Date(),
    totals,
    rows: records.map((r) => ({
      date: r.date,
      kind: KIND_TEXT[r.kind],
      source: SOURCE_TEXT[r.source],
      description: r.voidedReason ? `${r.description} (iptal: ${r.voidedReason})` : r.description,
      category: r.categoryId ? names.category(r.categoryId) : '',
      account: r.transfer ? `${names.account(r.transfer.fromAccountId)} → ${names.account(r.transfer.toAccountId)}` : names.account(r.accountId),
      project: r.projectId ? names.project(r.projectId) : '',
      status: r.status,
      currency: r.currency,
      signed: r.kind === 'gelir' ? r.amount : -r.amount,
      vat: r.vat,
    })),
  }
}

const dmy = (iso: string) => iso.split('-').reverse().join('.')
export const ledgerFileName = (ext: 'xlsx' | 'pdf', d = new Date()) => `LEONX-gelir-gider-${d.toISOString().slice(0, 10)}.${ext}`

export function ledgerToXlsx(r: LedgerReport): Uint8Array {
  const tx = (v: string, muted = false): CellInput => ({ v, s: muted ? STYLE.muted : STYLE.text })
  const rows: CellInput[][] = [[{ v: r.title, s: STYLE.title }], [{ v: r.filterText, s: STYLE.muted }], []]
  const headerRow = rows.length + 1
  rows.push(['Tarih', 'Tür', 'Kaynak', 'Açıklama', 'Kategori', 'Hesap', 'Proje', 'Durum', 'Para birimi', 'Tutar (KDV dahil)', 'KDV'].map((h) => ({ v: h, s: STYLE.header })))
  for (const x of r.rows) {
    const off = x.status !== 'gerceklesti'
    rows.push([
      tx(dmy(x.date), off),
      tx(x.kind, off),
      tx(x.source, off),
      tx(x.description, off),
      tx(x.category, off),
      tx(x.account || 'Hesapsız', off),
      tx(x.project, off),
      tx(RECORD_STATUS_LABEL[x.status], off),
      tx(x.currency, off),
      { v: x.signed / 100, s: off ? STYLE.warnNum2 : STYLE.num2 },
      { v: x.vat / 100, s: STYLE.num2 },
    ])
  }
  const last = rows.length
  rows.push([])
  rows.push([{ v: 'Toplamlar (yalnız gerçekleşen; iptal, bekleyen ve virman hariç)', s: STYLE.section }])
  rows.push(['Para birimi', 'Gelir', 'Gider', 'Net'].map((h) => ({ v: h, s: STYLE.header })))
  for (const t of r.totals) rows.push([{ v: t.currency, s: STYLE.totalLabel }, { v: t.income / 100, s: STYLE.num2 }, { v: t.expense / 100, s: STYLE.num2 }, { v: t.net / 100, s: STYLE.totalNum2 }])
  return buildXlsx(
    [{ name: 'Gelir-Gider', rows, cols: [11, 9, 15, 44, 16, 22, 18, 12, 10, 16, 12], freezeRows: headerRow, autoFilter: `A${headerRow}:K${Math.max(headerRow, last)}`, landscape: true }],
    { title: r.title, creator: 'LEONX OS', created: r.generatedAt },
  )
}

const INK = rgb(0.13, 0.15, 0.17)
const MUTED = rgb(0.41, 0.44, 0.49)
const HEAD = rgb(0.145, 0.165, 0.192)
const LINE = rgb(0.82, 0.84, 0.86)
const OK = rgb(0.18, 0.49, 0.31)
const DANGER = rgb(0.7, 0.22, 0.18)
const PAGE: [number, number] = [841.89, 595.28]
const M = 32

export async function ledgerToPdf(r: LedgerReport, assets: { regular: Uint8Array; semibold: Uint8Array }): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const f = await doc.embedFont(assets.regular, { subset: true })
  const fb = await doc.embedFont(assets.semibold, { subset: true })
  doc.setTitle(r.title)
  doc.setCreator('LEONX OS')
  const cols = [
    { t: 'Tarih', w: 54 },
    { t: 'Tür', w: 42 },
    { t: 'Kaynak', w: 70 },
    { t: 'Açıklama', w: 196 },
    { t: 'Kategori', w: 72 },
    { t: 'Hesap', w: 104 },
    { t: 'Proje', w: 70 },
    { t: 'Durum', w: 56 },
    { t: 'Tutar', w: 113.89, right: true },
  ]
  let page: PDFPage = doc.addPage(PAGE)
  let y = PAGE[1] - M
  const size = 7.8
  const pad = 3
  const lh = size + 2.4
  const text = (s: string, x: number, yy: number, font: PDFFont = f, sz = size, color = INK) => page.drawText(s, { x, y: yy, size: sz, font, color })
  const header = () => {
    const h = lh + 2 * pad
    page.drawRectangle({ x: M, y: y - h, width: PAGE[0] - 2 * M, height: h, color: HEAD })
    let x = M
    for (const c of cols) {
      const w = fb.widthOfTextAtSize(c.t, size)
      text(c.t, c.right ? x + c.w - pad - w : x + pad, y - pad - size + 1, fb, size, rgb(1, 1, 1))
      x += c.w
    }
    y -= h
  }
  const newPage = () => {
    page = doc.addPage(PAGE)
    y = PAGE[1] - M
    header()
  }
  text(r.title, M, y - 14, fb, 14)
  y -= 22
  for (const line of wrapText(r.filterText, f, 8.5, PAGE[0] - 2 * M)) {
    y -= 11
    text(line, M, y, f, 8.5, MUTED)
  }
  y -= 10
  header()
  for (const row of r.rows) {
    const cells = [dmy(row.date), row.kind, row.source, row.description, row.category, row.account || 'Hesapsız', row.project, RECORD_STATUS_LABEL[row.status], `${row.signed < 0 ? '−' : ''}${formatAmount(Math.abs(row.signed))} ${row.currency}`]
    const wrapped = cells.map((c, i) => wrapText(c, f, size, cols[i].w - 2 * pad).slice(0, 4))
    const h = Math.max(...wrapped.map((w) => w.length)) * lh + 2 * pad
    if (y - h < M + 16) newPage()
    let x = M
    const off = row.status !== 'gerceklesti'
    wrapped.forEach((lines, i) => {
      const c = cols[i]
      lines.forEach((line, j) => {
        const color = off ? MUTED : i === 8 ? (row.signed < 0 ? DANGER : OK) : INK
        const w = f.widthOfTextAtSize(line, size)
        text(line, c.right ? x + c.w - pad - w : x + pad, y - pad - size - j * lh + 1, i === 8 ? fb : f, size, color)
      })
      x += c.w
    })
    y -= h
    page.drawLine({ start: { x: M, y }, end: { x: PAGE[0] - M, y }, thickness: 0.4, color: LINE })
  }
  if (y - 30 - r.totals.length * 13 < M) newPage()
  y -= 20
  text('Toplamlar (yalnız gerçekleşen; iptal, bekleyen ve virman hariç; para birimleri ayrı)', M, y, fb, 9)
  for (const t of r.totals) {
    y -= 13
    text(`${t.currency}: gelir ${formatAmount(t.income)} · gider ${formatAmount(t.expense)} · net ${t.net < 0 ? '−' : ''}${formatAmount(Math.abs(t.net))}`, M, y, f, 9)
  }
  const pages = doc.getPages()
  const stamp = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' }).format(r.generatedAt)
  pages.forEach((p, i) => p.drawText(`LEONX OS · ${stamp} · ${i + 1}/${pages.length}`, { x: M, y: 16, size: 7, font: f, color: MUTED }))
  return doc.save()
}
