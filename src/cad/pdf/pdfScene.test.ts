/// <reference types="node" />
import { PDFDocument, rgb } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { buildPdfScene, findScaleHints, PT_TO_MM } from './pdfScene'

/**
 * pdf.js'in Node (legacy) derlemesiyle gerçek PDF işlem listesi üretilir; test PDF'leri
 * pdf-lib ile bilinen ölçülerle oluşturulur.
 */
async function sceneOf(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: false, disableFontFace: true }).promise
  const page = await doc.getPage(1)
  const vp = page.getViewport({ scale: 1 })
  const ops = await page.getOperatorList()
  const text = await page.getTextContent()
  return buildPdfScene(
    { fnArray: ops.fnArray, argsArray: ops.argsArray },
    text.items as { str?: string; transform?: number[] }[],
    vp.transform,
    vp.width,
    vp.height,
  )
}

describe('PDF analizi', () => {
  it('vektörel PDF: çizgiler gerçek geometri olarak okunur, ölçüler PDF noktasındadır', async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([842, 595]) // A4 yatay
    // 1:50 ölçekte 1200 × 1500 mm pencere → kâğıtta 24 × 30 mm
    const w = 1200 / 50 / PT_TO_MM
    const h = 1500 / 50 / PT_TO_MM
    page.drawRectangle({ x: 100, y: 100, width: w, height: h, borderColor: rgb(0, 0, 0), borderWidth: 0.5 })
    page.drawLine({ start: { x: 300, y: 100 }, end: { x: 400, y: 100 }, thickness: 0.5, color: rgb(1, 0, 0) })
    page.drawText('OLCEK 1/50', { x: 500, y: 50, size: 10 })
    const r = await sceneOf(await pdf.save())
    expect(r.kind).toBe('vektorel')
    const rect = r.scene.entities.find((e) => e.closed && e.area)!
    expect(rect).toBeTruthy()
    // Kâğıt ölçüsü → 1:50 gerçek ölçü
    expect((rect.area! * PT_TO_MM * PT_TO_MM * 50 * 50) / 1e6).toBeCloseTo(1.2 * 1.5, 6)
    const line = r.scene.entities.find((e) => !e.closed && e.kind === 'path')!
    expect(line.length).toBeCloseTo(100, 6)
    expect(line.rgb).toBe(0xff0000)
    // Dünya koordinatı: y yukarı, sayfa sol alt köşesi orijin
    expect(line.bbox[1]).toBeCloseTo(100, 6)
    const texts = r.scene.entities.filter((e) => e.kind === 'text').map((e) => e.text!.value)
    expect(texts).toContain('OLCEK 1/50')
    expect(findScaleHints(texts)).toEqual([{ denominator: 50, text: 'OLCEK 1/50' }])
  })

  it('taranmış PDF: tam sayfa görüntü raster olarak sınıflandırılır', async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([600, 400])
    // 2×2 piksel PNG (gri)
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAAAAABX3VL4AAAADklEQVR4nGNgYGBgYAAAAAUAAXpeqz8AAAAASUVORK5CYII=', 'base64'))
    const img = await pdf.embedPng(png)
    page.drawImage(img, { x: 0, y: 0, width: 600, height: 400 })
    const r = await sceneOf(await pdf.save())
    expect(r.kind).toBe('taranmis')
    expect(r.stats.imageCoverage).toBeCloseTo(1, 6)
    expect(r.stats.segments).toBe(0)
  })

  it('ölçek ifadeleri metinden bulunur; anlamsız oranlar yok sayılır', () => {
    expect(findScaleHints(['ÖLÇEK: 1/100', 'M 1:20', 'Tarih 1/3/2026', 'PAFTA 1/7']).map((h) => h.denominator)).toEqual([20, 100])
  })
})
