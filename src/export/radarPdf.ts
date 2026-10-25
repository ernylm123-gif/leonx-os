/**
 * Radar fırsat raporu → PDF (pdf-lib, Inter gömülü; Türkçe karakterler korunur). A4 dikey,
 * metin satırlara bölünür, sayfa sonunda devam eder.
 */
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib'
import { type PdfAssets, wrapText } from './quantityPdf'
import type { RadarReport } from './radarReport'

const W = 595.28
const H = 841.89
const M = 40
const INK = rgb(0.13, 0.15, 0.17)
const MUTED = rgb(0.41, 0.44, 0.49)
const WARN = rgb(0.56, 0.36, 0.06)
const OK = rgb(0.13, 0.45, 0.27)
const LINE = rgb(0.82, 0.84, 0.86)

export async function radarToPdf(r: RadarReport, assets: PdfAssets): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const f = await pdf.embedFont(assets.regular, { subset: true })
  const fb = await pdf.embedFont(assets.semibold, { subset: true })
  pdf.setTitle(`LEONX AI Radar — ${r.title}`)
  pdf.setAuthor('LEONX OS')
  pdf.setCreator('LEONX OS')
  pdf.setProducer('LEONX OS')
  pdf.setCreationDate(r.generatedAt)
  let page: PDFPage = pdf.addPage([W, H])
  let y = H - M
  const need = (h: number) => {
    if (y - h < M) {
      page = pdf.addPage([W, H])
      y = H - M
    }
  }
  const para = (text: string, x: number, width: number, size: number, font: PDFFont, color = INK) => {
    for (const line of wrapText(text, font, size, width)) {
      need(size + 4)
      y -= size + 3
      page.drawText(line, { x, y, size, font, color })
    }
  }
  para('LEONX AI — Proje ve İş Fırsatı Radarı', M, W - 2 * M, 9, f, MUTED)
  para(r.title, M, W - 2 * M, 15, fb)
  para(r.subtitle, M, W - 2 * M, 9, f, MUTED)
  para(`Rapor tarihi: ${new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' }).format(r.generatedAt)}`, M, W - 2 * M, 8, f, MUTED)
  y -= 6
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: LINE })
  const LW = 150
  for (const s of r.sections) {
    y -= 10
    need(30)
    para(s.title, M, W - 2 * M, 11.5, fb)
    if (s.note) para(s.note, M, W - 2 * M, 8, f, WARN)
    for (const row of s.rows) {
      const lines = wrapText(row.value, f, 8.6, W - 2 * M - LW)
      const labelLines = wrapText(row.label, fb, 8.2, LW - 8)
      const h = Math.max(lines.length, labelLines.length) * 11.6 + 2
      need(h)
      const top = y
      labelLines.forEach((l, i) => page.drawText(l, { x: M, y: top - 9 - i * 11.6, size: 8.2, font: fb, color: MUTED }))
      lines.forEach((l, i) => page.drawText(l, { x: M + LW, y: top - 9 - i * 11.6, size: 8.6, font: f, color: row.tone === 'warn' ? WARN : row.tone === 'ok' ? OK : row.tone === 'muted' ? MUTED : INK }))
      y = top - h
    }
  }
  y -= 10
  if (!r.noSourceSection) {
    need(30)
    para('F. Kaynaklar', M, W - 2 * M, 11.5, fb)
    if (!r.sources.length) para('Kaynak kaydı yok.', M, W - 2 * M, 8.6, f, MUTED)
    r.sources.forEach((s, i) => {
      need(36)
      para(`${i + 1}. ${s.claim}`, M, W - 2 * M, 8.6, f)
      para(`${s.url} · yayın: ${s.published} · erişim: ${s.accessed}`, M + 10, W - 2 * M - 10, 7.8, f, MUTED)
    })
    y -= 12
  }
  para('Not: Doğrulanmış ve potansiyel bilgiler ayrı gösterilmiştir. Kaynaklardaki içerik dış veridir; miktar ve fiyat bilgisi uydurulmamıştır.', M, W - 2 * M, 7.5, f, MUTED)
  return pdf.save()
}
