#!/usr/bin/env node
/**
 * Faz 5.2 mimari PDF fikstürleri — SENTETİK (gerçek proje değildir). Gerçek paftalarda
 * görülen ve Faz 5.1 motorunun boş/yanlış sonuç verdiği biçimleri taşır:
 *
 *  1. autocad_shx_plan.pdf     AutoCAD SHX çıktısı benzetimi: TÜM yazılar çizgi olarak çizilmiş,
 *                              metin katmanı yok (pafta "vektörel" görünür ama yazı okunamaz).
 *  2. dograma_listesi_kart.pdf Kart tipi doğrama listesi (her pozun görünüş çizimi, ölçü çizgileri,
 *                              ADET / malzeme / cam / renk / açılım yazıları) + normal kat planı
 *                              (metre yazımı "1.20/1.50", kesirli "180 / 150" etiketi, P1 ↔ P-01
 *                              kod farkı, 4 kat için tek plan, bilerek çelişkili P-03).
 *  3. karma_cizelge_raster.pdf Vektörel plan + doğrama çizelgesi GÖRÜNTÜ olarak (karma pafta).
 *
 * Her dosya için beklenen sonuçlar <ad>.expected.json içindedir ("sentetik": true).
 * Çıktı: src/cad/__fixtures__/pdf/ — dosyalar depoya eklenir; CI bu betiği çalıştırmaz.
 * Karma fikstür için pdftoppm (poppler-utils) gerekir.
 *
 * Kullanım: node scripts/cad-fixtures/make_pdf_fixtures_52.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument } from 'pdf-lib'
import { A2, A3, BLACK, fixed, GREY, hChain, hWall, makeWriter, PT_PER_MM, sheet, titleBlock, vWall } from './pdf_draw.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = path.join(ROOT, 'src', 'cad', '__fixtures__', 'pdf')
mkdirSync(OUT, { recursive: true })
const FONT = readFileSync(path.join(ROOT, 'src', 'assets', 'fonts', 'Inter-Regular.ttf'))

async function newDoc() {
  const doc = await PDFDocument.create()
  fixed(doc)
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(FONT, { subset: true })
  return { doc, font }
}

const writeJson = (name, obj) => writeFileSync(path.join(OUT, name), `${JSON.stringify(obj, null, 2)}\n`)

// ---------------------------------------------------------------------------------------------
// Ortak: küçük konut planı (1/100, A3) — SHX ve karma fikstürlerinde kullanılır
// ---------------------------------------------------------------------------------------------
function smallPlan(page, w, { title, scaleText = 'ÖLÇEK 1/100' }) {
  const s = sheet(page, w, { scale: 100, x0: 70, y0: 150 })
  const T = 25
  hWall(s, 0, 1600, 0, T, [
    { from: 100, to: 220, kind: 'pencere' },
    { from: 400, to: 520, kind: 'pencere' },
    { from: 650, to: 830, kind: 'pencere' },
    { from: 1200, to: 1500, kind: 'surme' },
  ])
  hWall(s, 0, 1600, 1000 - T, T, [{ from: 200, to: 320, kind: 'pencere' }])
  vWall(s, 0, 1000, 0, T, [])
  vWall(s, 0, 1000, 1600 - T, T, [])
  vWall(s, T, 1000 - T, 800, 10, [{ from: 200, to: 290, kind: 'kapi' }, { from: 650, to: 740, kind: 'kapi' }])
  const L = (code, dims, x, y) => {
    s.text(code, x, y, 9)
    s.text(dims, x, y - 45, 8)
  }
  L('P1', '120/150', 110, -90)
  L('P1', '120/150', 410, -90)
  L('P2', '180/150', 690, -90)
  L('S1', '300/220', 1290, -90)
  L('P1', '120/150', 210, 1110)
  L('K1', '90/210', 830, 320)
  L('K1', '90/210', 830, 770)
  s.text('SALON', 300, 300, 10)
  s.text('YATAK ODASI', 1050, 600, 10)
  s.text('MUTFAK', 300, 750, 10)
  hChain(s, -260, [0, 100, 220, 400, 520, 650, 830, 1200, 1500, 1600])
  titleBlock(page, w, [
    ['PROJE: ÖRNEK KONUT', 9],
    [`PAFTA: ${title}`, 11],
    [scaleText, 9],
    ['PAFTA NO: M-01', 8],
  ])
}

const SMALL_PLAN_TRUTH = [
  { code: 'P1', width_mm: 1200, height_mm: 1500, count: 3 },
  { code: 'P2', width_mm: 1800, height_mm: 1500, count: 1 },
  { code: 'K1', width_mm: 900, height_mm: 2100, count: 2 },
  { code: 'S1', width_mm: 3000, height_mm: 2200, count: 1 },
]

// ---------------------------------------------------------------------------------------------
// 1. SHX benzetimi: yazılar çizgi
// ---------------------------------------------------------------------------------------------
async function makeShx() {
  const { doc, font } = await newDoc()
  const page = doc.addPage(A3)
  const w = makeWriter(page, font, FONT, 'cizgi')
  smallPlan(page, w, { title: 'ZEMİN KAT PLANI' })
  writeFileSync(path.join(OUT, 'autocad_shx_plan.pdf'), await doc.save({ useObjectStreams: false }))
  writeJson('autocad_shx_plan.expected.json', {
    sentetik: true,
    aciklama: 'AutoCAD SHX benzetimi: tüm yazılar çizgi, metin katmanı yok. Pozlar yalnız OCR ile okunabilir.',
    sayfalar: { 1: { pafta: 'plan', yaziCizgi: true } },
    pozlar: SMALL_PLAN_TRUTH,
  })
}

// ---------------------------------------------------------------------------------------------
// 2. Kart tipi doğrama listesi + normal kat planı
// ---------------------------------------------------------------------------------------------

/** Doğrama görünüşü: kasa, kayıtlar ve açılım sembolleri (üçgenin tepesi menteşe tarafındadır) */
function drawWindow(page, x, y, wPt, hPt, panels, rows = 1) {
  const line = (x1, y1, x2, y2, t = 0.35) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t, color: BLACK })
  page.drawRectangle({ x, y, width: wPt, height: hPt, borderColor: BLACK, borderWidth: 0.8 })
  const f = 2.5 // kasa genişliği (kâğıtta)
  const ix0 = x + f
  const iy0 = y + f
  const ix1 = x + wPt - f
  const iy1 = y + hPt - f
  page.drawRectangle({ x: ix0, y: iy0, width: ix1 - ix0, height: iy1 - iy0, borderColor: BLACK, borderWidth: 0.35 })
  let px = ix0
  const rowH = (iy1 - iy0) / rows
  for (let r = 1; r < rows; r++) line(ix0, iy0 + r * rowH, ix1, iy0 + r * rowH, 0.5)
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i]
    const pw = (ix1 - ix0) * p.w
    const qx0 = px
    const qx1 = px + pw
    if (i < panels.length - 1) line(qx1, iy0, qx1, iy1, 0.5)
    for (let r = 0; r < rows; r++) {
      const qy0 = iy0 + r * rowH
      const qy1 = qy0 + rowH
      const my = (qy0 + qy1) / 2
      const mx = (qx0 + qx1) / 2
      const side = (hinge) => {
        if (hinge === 'sol') {
          line(qx1, qy1, qx0, my)
          line(qx1, qy0, qx0, my)
        } else {
          line(qx0, qy1, qx1, my)
          line(qx0, qy0, qx1, my)
        }
      }
      if (p.t === 'acilir-sol') side('sol')
      if (p.t === 'acilir-sag') side('sag')
      if (p.t === 'vasistas' || p.t === 'cift') {
        line(qx0, qy1, mx, qy0)
        line(qx1, qy1, mx, qy0)
      }
      if (p.t === 'cift') side('sol')
      if (p.t === 'surme-sag' || p.t === 'surme-sol') {
        const dir = p.t === 'surme-sag' ? 1 : -1
        const a = mx - (dir * pw) / 4
        const b = mx + (dir * pw) / 4
        line(a, my, b, my, 0.5)
        line(b, my, b - dir * 6, my + 4, 0.5)
        line(b, my, b - dir * 6, my - 4, 0.5)
      }
    }
    px = qx1
  }
}

const CARDS = [
  {
    code: 'P-01', w: 120, h: 150, panels: [{ w: 1, t: 'cift' }], explicit: '120/150',
    lines: ['ADET: 8', 'PVC - RAL 9016', 'CAM: 4+16+4 ISICAM', 'AÇILIM: ÇİFT AÇILIM', 'PROFİL: 70 MM 5 ODACIKLI'],
  },
  {
    code: 'P-02', w: 180, h: 150, panels: [{ w: 0.5, t: 'sabit' }, { w: 0.5, t: 'acilir-sol' }],
    lines: ['ADET: 4', 'PVC - RAL 9016', 'CAM: 4+16+4 ISICAM', 'AÇILIM: SABİT + AÇILIR'],
  },
  { code: 'P-03', w: 60, h: 60, panels: [{ w: 1, t: 'vasistas' }], lines: ['9 ADET', 'PVC', 'CAM: 4+16+4 BUZLU', 'AÇILIM: VASİSTAS'] },
  {
    code: 'K-01', w: 90, h: 220, panels: [{ w: 1, t: 'cift' }], explicit: '90/220',
    lines: ['ADET: 4', 'BALKON KAPISI', 'PVC - RAL 9016', 'CAM: 4+16+4 TEMPERLİ'],
  },
  {
    code: 'S-01', w: 300, h: 220, panels: [{ w: 0.5, t: 'surme-sag' }, { w: 0.5, t: 'surme-sol' }],
    lines: ['MİKTAR: 4 AD.', 'SÜRME KAPI', 'ALÜMİNYUM - RAL 7016 ANTRASİT', 'SİSTEM: ISI YALITIMLI SÜRME SERİ', 'CAM: 6+16+6 TEMPERLİ'],
  },
  {
    code: 'CP-01', w: 240, h: 300, panels: [{ w: 0.5, t: 'sabit' }, { w: 0.5, t: 'sabit' }], rows: 2,
    lines: ['ADET: 2', 'GİYDİRME CEPHE - ZEMİN KAT', 'ALÜMİNYUM - RAL 7016', 'CAM: 6+16+6 LOW-E'],
  },
]

function cardPage(doc, font, mode) {
  const page = doc.addPage(A3)
  const w = makeWriter(page, font, FONT, mode)
  w.draw('DOĞRAMA LİSTESİ', 40, 800, 18)
  const k = (10 / 50) * PT_PER_MM // 1/50: cm → pt
  const cellW = 370
  const cellH = 350
  CARDS.forEach((c, i) => {
    const cx = 30 + (i % 3) * (cellW + 10)
    const top = 770 - Math.floor(i / 3) * (cellH + 10)
    page.drawRectangle({ x: cx, y: top - cellH, width: cellW, height: cellH, borderColor: BLACK, borderWidth: 0.6 })
    w.draw(c.code, cx + 12, top - 26, 16)
    if (c.explicit) w.draw(c.explicit, cx + 110, top - 24, 10)
    const fw = c.w * k
    const fh = c.h * k
    const fx = cx + 60
    const fy = top - 50 - fh
    drawWindow(page, fx, fy, fw, fh, c.panels, c.rows ?? 1)
    // Ölçü çizgileri (cm): genişlik altta, yükseklik solda (döndürülmüş yazı)
    const dimY = fy - 16
    page.drawLine({ start: { x: fx, y: dimY }, end: { x: fx + fw, y: dimY }, thickness: 0.25, color: GREY })
    page.drawLine({ start: { x: fx, y: dimY - 4 }, end: { x: fx, y: dimY + 4 }, thickness: 0.25, color: GREY })
    page.drawLine({ start: { x: fx + fw, y: dimY - 4 }, end: { x: fx + fw, y: dimY + 4 }, thickness: 0.25, color: GREY })
    const ws = String(c.w)
    w.draw(ws, fx + fw / 2 - w.width(ws, 7) / 2, dimY + 3, 7, 0, GREY)
    const dimX = fx - 16
    page.drawLine({ start: { x: dimX, y: fy }, end: { x: dimX, y: fy + fh }, thickness: 0.25, color: GREY })
    page.drawLine({ start: { x: dimX - 4, y: fy }, end: { x: dimX + 4, y: fy }, thickness: 0.25, color: GREY })
    page.drawLine({ start: { x: dimX - 4, y: fy + fh }, end: { x: dimX + 4, y: fy + fh }, thickness: 0.25, color: GREY })
    const hs = String(c.h)
    w.draw(hs, dimX - 3, fy + fh / 2 - w.width(hs, 7) / 2, 7, 90, GREY)
    let ly = top - cellH + 14 + (c.lines.length - 1) * 13
    for (const t of c.lines) {
      w.draw(t, cx + 12, ly, 8)
      ly -= 13
    }
  })
  // Antet bilgileri üst sağda (kartlar sayfanın altına kadar uzanır)
  w.draw('PROJE: ÖRNEK APARTMAN', 760, 812, 9)
  w.draw('PAFTA NO: M-10', 760, 798, 8)
  w.draw('ÖLÇEK 1/50', 900, 798, 9)
  return page
}

function normalFloorPlan(doc, font, mode) {
  const page = doc.addPage(A2)
  const w = makeWriter(page, font, FONT, mode)
  const s = sheet(page, w, { scale: 50, x0: 120, y0: 300 })
  const T = 25
  const bottom = [
    { from: 100, to: 220, kind: 'pencere' },
    { from: 400, to: 520, kind: 'pencere' },
    { from: 650, to: 830, kind: 'pencere' },
    { from: 1000, to: 1090, kind: 'kapi' },
    { from: 1200, to: 1500, kind: 'surme' },
  ]
  const top = [
    { from: 200, to: 260, kind: 'pencere' },
    { from: 1000, to: 1060, kind: 'pencere' },
  ]
  hWall(s, 0, 1600, 0, T, bottom)
  hWall(s, 0, 1600, 1000 - T, T, top)
  vWall(s, 0, 1000, 0, T, [])
  vWall(s, 0, 1000, 1600 - T, T, [])
  vWall(s, T, 1000 - T, 800, 10, [])
  // Etiketler: metre yazımı, kesirli yazım, farklı kod yazımları
  s.text('P1', 120, -60, 9)
  s.text('1.20/1.50', 120, -85, 8)
  s.text('P1', 420, -60, 9)
  s.text('1,20/1,50', 420, -85, 8)
  // P2: kesir — 180 üstte, çizgi, 150 altta
  s.text('P2', 700, -60, 9)
  s.text('180', 705, -82, 8)
  s.line(700, -86, 745, -86, 0.4)
  s.text('150', 705, -104, 8)
  s.text('K-01', 1010, -60, 9)
  s.text('90/220', 1010, -85, 8)
  s.text('S-01', 1300, -60, 9)
  s.text('300/220', 1300, -85, 8)
  s.text('P-03', 205, 1040, 9)
  s.text('60/60', 205, 1015, 8)
  s.text('P-03', 1005, 1040, 9)
  s.text('60/60', 1005, 1015, 8)
  s.text('SALON', 300, 250, 10)
  s.text('MUTFAK', 300, 750, 10)
  s.text('YATAK ODASI', 1050, 700, 10)
  s.text('ODA', 1050, 300, 10)
  hChain(s, -260, [0, 100, 220, 400, 520, 650, 830, 1000, 1090, 1200, 1500, 1600])
  hChain(s, -330, [0, 1600])
  s.text('NOT: AKSİ BELİRTİLMEDİKÇE TÜM DOĞRAMALAR PVC, RAL 9016 BEYAZDIR.', 0, -420, 8)
  titleBlock(page, w, [
    ['PROJE: ÖRNEK APARTMAN', 9],
    ['PAFTA: NORMAL KAT PLANI (1.-4. KATLAR)', 10],
    ['ÖLÇEK 1/50', 9],
    ['PAFTA NO: M-02', 8],
  ])
  return page
}

async function makeCards() {
  const { doc, font } = await newDoc()
  cardPage(doc, font, 'metin')
  normalFloorPlan(doc, font, 'metin')
  writeFileSync(path.join(OUT, 'dograma_listesi_kart.pdf'), await doc.save({ useObjectStreams: false }))
  writeJson('dograma_listesi_kart.expected.json', {
    sentetik: true,
    aciklama: 'Kart tipi doğrama listesi + 4 kat için geçerli tek normal kat planı. P-03 bilerek çelişkili (liste 9, plan 2×4=8).',
    sayfalar: { 1: { pafta: 'cizelge' }, 2: { pafta: 'plan', katCarpani: 4 } },
    pozlar: [
      { code: 'P-01', width_mm: 1200, height_mm: 1500, count: 8, category: 'pvc_pencere', acilim: 'cift_acilim', cam: '4+16+4', renk: 'RAL 9016' },
      { code: 'P-02', width_mm: 1800, height_mm: 1500, count: 4, category: 'pvc_pencere', bolme: 2 },
      { code: 'P-03', width_mm: 600, height_mm: 600, count: 9, category: 'pvc_pencere', acilim: 'vasistas', celiski: true },
      { code: 'K-01', width_mm: 900, height_mm: 2200, count: 4, category: 'pvc_kapi', acilim: 'cift_acilim' },
      { code: 'S-01', width_mm: 3000, height_mm: 2200, count: 4, category: 'surme', renk: 'RAL 7016' },
      { code: 'CP-01', width_mm: 2400, height_mm: 3000, count: 2, category: 'cephe_dograma' },
    ],
  })
}

// ---------------------------------------------------------------------------------------------
// 3. Karma: vektörel plan + görüntü olarak çizelge
// ---------------------------------------------------------------------------------------------
async function scheduleImage() {
  const { doc, font } = await newDoc()
  const W = 560
  const H = 230
  const page = doc.addPage([W, H])
  const cols = [['POZ NO', 12], ['CİNSİ', 80], ['MALZEME', 200], ['EN', 330], ['BOY', 390], ['ADET', 460]]
  const rows = [
    ['P1', 'PENCERE', 'PVC', '120', '150', '3'],
    ['P2', 'PENCERE', 'PVC', '180', '150', '1'],
    ['K1', 'İÇ KAPI', 'AHŞAP', '90', '210', '2'],
    ['S1', 'SÜRME KAPI', 'ALÜMİNYUM', '300', '220', '1'],
  ]
  page.drawText('DOĞRAMA ÇİZELGESİ', { x: 12, y: H - 26, size: 14, font, color: BLACK })
  const top = H - 40
  const rh = 30
  for (let i = 0; i <= rows.length + 1; i++) page.drawLine({ start: { x: 6, y: top - i * rh }, end: { x: W - 6, y: top - i * rh }, thickness: 0.6, color: BLACK })
  for (const [name, x] of cols) page.drawText(name, { x, y: top - 20, size: 11, font, color: BLACK })
  rows.forEach((r, i) => r.forEach((cell, j) => page.drawText(cell, { x: cols[j][1], y: top - (i + 2) * rh + 10, size: 11, font, color: BLACK })))
  const dir = mkdtempSync(path.join(tmpdir(), 'leonx-karma-'))
  const src = path.join(dir, 't.pdf')
  writeFileSync(src, await doc.save({ useObjectStreams: false }))
  execFileSync('pdftoppm', ['-r', '200', '-gray', '-png', src, path.join(dir, 't')])
  return { png: readFileSync(path.join(dir, 't-1.png')), W, H }
}

async function makeKarma() {
  const { doc, font } = await newDoc()
  const page = doc.addPage(A3)
  const w = makeWriter(page, font, FONT, 'metin')
  // Plan yazılarında malzeme yok: malzeme yalnız görüntüdeki çizelgede
  smallPlan(page, w, { title: 'ZEMİN KAT PLANI' })
  const { png, W, H } = await scheduleImage()
  const img = await doc.embedPng(png)
  page.drawImage(img, { x: 600, y: 560, width: W, height: H })
  writeFileSync(path.join(OUT, 'karma_cizelge_raster.pdf'), await doc.save({ useObjectStreams: false }))
  writeJson('karma_cizelge_raster.expected.json', {
    sentetik: true,
    aciklama: 'Vektörel plan + görüntü olarak gömülü doğrama çizelgesi (karma pafta). Malzeme ve çizelge adetleri yalnız OCR ile okunabilir.',
    sayfalar: { 1: { pafta: 'plan', karma: true } },
    pozlar: [
      { code: 'P1', width_mm: 1200, height_mm: 1500, count: 3, category: 'pvc_pencere' },
      { code: 'P2', width_mm: 1800, height_mm: 1500, count: 1, category: 'pvc_pencere' },
      { code: 'K1', width_mm: 900, height_mm: 2100, count: 2, category: 'belirsiz' },
      { code: 'S1', width_mm: 3000, height_mm: 2200, count: 1, category: 'surme' },
    ],
  })
}

await makeShx()
await makeCards()
await makeKarma()
console.log('Faz 5.2 PDF fikstürleri yazıldı:', OUT)
