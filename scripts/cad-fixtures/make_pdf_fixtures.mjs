#!/usr/bin/env node
/**
 * Mimari PDF test fikstürleri (Faz 5.1). Gerçek mimari paftaların özelliklerini taşır:
 * duvar çizgileri ve boşlukları, pencere/kapı sembolleri, poz kodu + "EN/BOY" (cm) etiketleri,
 * ölçü zincirleri, mahal adları, mobilya dikdörtgenleri, antet, ölçek yazısı, görünüş paftası
 * ve doğrama çizelgesi. Etiketlerin bir kısmı parçalı ("120/" + "150") veya 90° döndürülmüş
 * yazılır (CAD çıktılarında sık görülür).
 *
 * Çıktı: src/cad/__fixtures__/pdf/*.pdf — dosyalar depoya eklenir; CI bu betiği çalıştırmaz.
 * Taranmış fikstür için pdftoppm (poppler-utils) gerekir.
 *
 * Kullanım: node scripts/cad-fixtures/make_pdf_fixtures.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fontkit from '@pdf-lib/fontkit'
import { degrees, PDFDocument, rgb } from 'pdf-lib'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = path.join(ROOT, 'src', 'cad', '__fixtures__', 'pdf')
mkdirSync(OUT, { recursive: true })
const FONT = readFileSync(path.join(ROOT, 'src', 'assets', 'fonts', 'Inter-Regular.ttf'))

const A3 = [1190.55, 841.89]
const A2 = [1683.78, 1190.55]
const A4L = [841.89, 595.28]
const PT_PER_MM = 72 / 25.4
const BLACK = rgb(0, 0, 0)
const GREY = rgb(0.45, 0.45, 0.45)
const fixed = (d) => {
  // Kararlı çıktı: tarih ve üretici sabit
  d.setCreationDate(new Date('2026-01-01T00:00:00Z'))
  d.setModificationDate(new Date('2026-01-01T00:00:00Z'))
  d.setProducer('LEONX test fikstürü')
  d.setCreator('LEONX test fikstürü')
}

/** Ölçekli çizim yardımcısı: gerçek ölçü cm → kâğıt noktası */
function sheet(page, font, { scale, x0, y0 }) {
  const k = (10 / scale) * PT_PER_MM // 1 cm gerçek → pt
  const P = (x, y) => ({ x: x0 + x * k, y: y0 + y * k })
  const line = (x1, y1, x2, y2, t = 0.5, color = BLACK) => page.drawLine({ start: P(x1, y1), end: P(x2, y2), thickness: t, color })
  const rect = (x, y, w, h, t = 0.4, color = BLACK) => page.drawRectangle({ ...P(x, y), width: w * k, height: h * k, borderColor: color, borderWidth: t })
  const text = (s, x, y, size = 8, rot = 0, color = BLACK) => page.drawText(s, { ...P(x, y), size, font, rotate: degrees(rot), color })
  const textW = (s, size) => font.widthOfTextAtSize(s, size) / k // cm cinsinden
  const arc = (cx, cy, r, a0, a1, n = 12) => {
    for (let i = 0; i < n; i++) {
      const t0 = a0 + ((a1 - a0) * i) / n
      const t1 = a0 + ((a1 - a0) * (i + 1)) / n
      line(cx + r * Math.cos(t0), cy + r * Math.sin(t0), cx + r * Math.cos(t1), cy + r * Math.sin(t1), 0.3)
    }
  }
  return { k, P, line, rect, text, textW, arc }
}

/**
 * Yatay duvar bandı (y..y+t) üzerinde boşluklu duvar çizgileri; openings: [{from,to,kind}]
 * Pencere: cam çizgileri (açıklık genişliğinde 3 çizgi). Kapı: kanat + açılım yayı. Sürme: 2 kanat.
 */
function hWall(s, x0, x1, y, t, openings) {
  const ops = [...openings].sort((a, b) => a.from - b.from)
  let cur = x0
  for (const o of ops) {
    s.line(cur, y, o.from, y, 0.9)
    s.line(cur, y + t, o.from, y + t, 0.9)
    s.line(o.from, y, o.from, y + t, 0.9)
    s.line(o.to, y, o.to, y + t, 0.9)
    cur = o.to
    const w = o.to - o.from
    if (o.kind === 'pencere') {
      s.line(o.from, y, o.to, y, 0.3)
      s.line(o.from, y + t / 2, o.to, y + t / 2, 0.3)
      s.line(o.from, y + t, o.to, y + t, 0.3)
    } else if (o.kind === 'surme') {
      s.line(o.from, y + t / 2, o.to, y + t / 2, 0.3)
      s.line(o.from, y + t * 0.35, o.from + w * 0.55, y + t * 0.35, 0.3)
      s.line(o.to - w * 0.55, y + t * 0.65, o.to, y + t * 0.65, 0.3)
    } else if (o.kind === 'kapi') {
      const dir = o.inward === false ? -1 : 1
      const yy = dir > 0 ? y + t : y
      s.line(o.from, yy, o.from, yy + dir * w, 0.4)
      s.arc(o.from, yy, w, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0)
    }
  }
  s.line(cur, y, x1, y, 0.9)
  s.line(cur, y + t, x1, y + t, 0.9)
}

/** Düşey duvar bandı (x..x+t) */
function vWall(s, y0, y1, x, t, openings) {
  const ops = [...openings].sort((a, b) => a.from - b.from)
  let cur = y0
  for (const o of ops) {
    s.line(x, cur, x, o.from, 0.9)
    s.line(x + t, cur, x + t, o.from, 0.9)
    s.line(x, o.from, x + t, o.from, 0.9)
    s.line(x, o.to, x + t, o.to, 0.9)
    cur = o.to
    const w = o.to - o.from
    if (o.kind === 'pencere') {
      s.line(x, o.from, x, o.to, 0.3)
      s.line(x + t / 2, o.from, x + t / 2, o.to, 0.3)
      s.line(x + t, o.from, x + t, o.to, 0.3)
    } else if (o.kind === 'kapi') {
      s.line(x + t, o.from, x + t + w, o.from, 0.4)
      s.arc(x + t, o.from, w, 0, Math.PI / 2)
    }
  }
  s.line(x, cur, x, y1, 0.9)
  s.line(x + t, cur, x + t, y1, 0.9)
}

/** Ölçü zinciri: her parça ayrı ölçü çizgisi + değer yazısı (cm) */
function hChain(s, y, stops, size = 7) {
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    s.line(a, y, b, y, 0.25, GREY)
    s.line(a, y - 8, a, y + 8, 0.25, GREY)
    s.line(b, y - 8, b, y + 8, 0.25, GREY)
    const v = String(Math.round(b - a))
    s.text(v, (a + b) / 2 - s.textW(v, size) / 2, y + 6, size, 0, GREY)
  }
}

function titleBlock(s, page, font, lines) {
  const W = page.getWidth()
  const x = W - 300
  page.drawRectangle({ x, y: 20, width: 280, height: 90, borderColor: BLACK, borderWidth: 0.8 })
  page.drawLine({ start: { x, y: 65 }, end: { x: x + 280, y: 65 }, thickness: 0.4, color: BLACK })
  let yy = 92
  for (const [txt, size] of lines) {
    page.drawText(txt, { x: x + 8, y: yy, size, font, color: BLACK })
    yy -= size + 8
  }
}

/** Etiket: kod üstte, ölçü altta. split → "120/" ve "150" ayrı metin parçaları. rot=90 düşey yazı */
function label(s, code, dims, x, y, { split = false, rot = 0 } = {}) {
  if (rot === 90) {
    s.text(code, x, y, 9, 90)
    s.text(dims, x + 22, y, 8, 90)
    return
  }
  s.text(code, x, y, 9)
  if (split) {
    const [a, b] = dims.split('/')
    s.text(`${a}/`, x, y - 22, 8)
    s.text(b, x + s.textW(`${a}/`, 8), y - 22, 8)
  } else {
    s.text(dims, x, y - 22, 8)
  }
}

async function planPage(doc, font, { title, floor, openingsBottom, openingsTop, interiorV, interiorH, balcony, labels, rooms, furniture }) {
  const page = doc.addPage(A2)
  const s = sheet(page, font, { scale: 50, x0: 120, y0: 300 })
  const T = 25
  // Dış duvarlar 1600 × 1000 cm
  hWall(s, 0, 1600, 0, T, openingsBottom)
  hWall(s, 0, 1600, 1000 - T, T, openingsTop)
  vWall(s, 0, 1000, 0, T, [])
  vWall(s, 0, 1000, 1600 - T, T, [])
  // İç duvarlar (10 cm)
  vWall(s, T, 1000 - T, 800, 10, interiorV)
  hWall(s, T, 800, 500, 10, interiorH)
  if (balcony) {
    // Balkon döşemesi ve korkuluk çizgisi (620 cm)
    s.line(950, 0, 950, -150, 0.5)
    s.line(1570, 0, 1570, -150, 0.5)
    s.line(950, -150, 1570, -150, 1.2)
    s.line(950, -140, 1570, -140, 0.3)
  }
  for (const l of labels) label(s, l.code, l.dims, l.x, l.y, l)
  for (const r of rooms) {
    s.text(r.name, r.x, r.y, 10)
    if (r.area) s.text(r.area, r.x, r.y - 30, 7)
  }
  for (const f of furniture) s.rect(f.x, f.y, f.w, f.h, 0.25, GREY)
  // Ölçü zinciri (alt) ve toplam
  const stops = [0, ...openingsBottom.flatMap((o) => [o.from, o.to]), 1600]
  hChain(s, -260, stops)
  hChain(s, -330, [0, 1600])
  // Düşey toplam ölçü (döndürülmüş yazı)
  s.line(1700, 0, 1700, 1000, 0.25, GREY)
  s.line(1692, 0, 1708, 0, 0.25, GREY)
  s.line(1692, 1000, 1708, 1000, 0.25, GREY)
  s.text('1000', 1690, 500 - s.textW('1000', 7) / 2, 7, 90, GREY)
  // Kotlar ve kuzey oku
  s.text(floor === 0 ? '±0.00' : '+3.00', 420, 700, 7)
  s.line(1750, 900, 1750, 1000, 0.5)
  s.text('K', 1742, 1010, 9)
  titleBlock(s, page, font, [
    ['PROJE: ÖRNEK KONUT', 9],
    [`PAFTA: ${title}`, 11],
    ['ÖLÇEK 1/50', 9],
    [`PAFTA NO: M-0${floor + 1}`, 8],
  ])
  return page
}

async function makeMain() {
  const doc = await PDFDocument.create()
  fixed(doc)
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(FONT, { subset: true })

  // ---------------- Sayfa 1: ZEMİN KAT PLANI — P1×3, P2×1, K1×3, KP1×1, S1×1
  await planPage(doc, font, {
    title: 'ZEMİN KAT PLANI',
    floor: 0,
    openingsBottom: [
      { from: 100, to: 220, kind: 'pencere' },
      { from: 400, to: 520, kind: 'pencere' },
      { from: 650, to: 830, kind: 'pencere' },
      { from: 1000, to: 1100, kind: 'kapi' },
      { from: 1200, to: 1500, kind: 'surme' },
    ],
    openingsTop: [{ from: 200, to: 320, kind: 'pencere' }],
    interiorV: [
      { from: 200, to: 290, kind: 'kapi' },
      { from: 650, to: 740, kind: 'kapi' },
    ],
    interiorH: [{ from: 300, to: 390, kind: 'kapi' }],
    labels: [
      { code: 'P1', dims: '120/150', x: 120, y: -70 },
      { code: 'P1', dims: '120/150', x: 420, y: -70, split: true },
      { code: 'P2', dims: '180/150', x: 700, y: -70 },
      { code: 'KP1', dims: '100/220', x: 1010, y: -70 },
      { code: 'S1', dims: '300/220', x: 1300, y: -70 },
      { code: 'P1', dims: '120/150', x: 220, y: 1060 },
      { code: 'K1', dims: '90/210', x: 830, y: 330 },
      { code: 'K1', dims: '90/210', x: 760, y: 640, rot: 90 },
      { code: 'K1', dims: '90/210', x: 310, y: 470 },
    ],
    rooms: [
      { name: 'SALON', area: '32,50 m²', x: 300, y: 250 },
      { name: 'MUTFAK', area: '14,20 m²', x: 300, y: 750 },
      { name: 'YATAK ODASI', area: '16,80 m²', x: 1050, y: 700 },
      { name: 'ANTRE', area: '8,40 m²', x: 1050, y: 300 },
    ],
    furniture: [
      { x: 1100, y: 750, w: 160, h: 200 },
      { x: 150, y: 150, w: 90, h: 90 },
      { x: 450, y: 600, w: 60, h: 60 },
    ],
  })

  // ---------------- Sayfa 2: 1. KAT PLANI — P1×2, P2×1, K1×2, KR1×1 (balkon)
  await planPage(doc, font, {
    title: '1. KAT PLANI',
    floor: 1,
    balcony: true,
    openingsBottom: [
      { from: 100, to: 220, kind: 'pencere' },
      { from: 650, to: 830, kind: 'pencere' },
    ],
    openingsTop: [{ from: 200, to: 320, kind: 'pencere' }],
    interiorV: [{ from: 200, to: 290, kind: 'kapi' }],
    interiorH: [{ from: 300, to: 390, kind: 'kapi' }],
    labels: [
      { code: 'P1', dims: '120/150', x: 120, y: -70 },
      { code: 'P2', dims: '180/150', x: 700, y: -70 },
      { code: 'P1', dims: '120/150', x: 220, y: 1060 },
      { code: 'K1', dims: '90/210', x: 830, y: 330 },
      { code: 'K1', dims: '90/210', x: 310, y: 470 },
    ],
    rooms: [
      { name: 'YATAK ODASI', area: '18,10 m²', x: 300, y: 250 },
      { name: 'BANYO', area: '6,30 m²', x: 300, y: 750 },
      { name: 'ÇALIŞMA ODASI', area: '15,40 m²', x: 1050, y: 700 },
      { name: 'BALKON', area: '9,30 m²', x: 1180, y: -100 },
    ],
    furniture: [{ x: 150, y: 150, w: 160, h: 200 }],
  })
  // KR1 etiketi balkonda (ölçüsü çizelgede)
  {
    const page = doc.getPages()[1]
    const s = sheet(page, font, { scale: 50, x0: 120, y0: 300 })
    s.text('KR1', 1600, -170, 9)
  }

  // ---------------- Sayfa 3: ÖN GÖRÜNÜŞ — etiketler tekrar eder, SAYILMAMALI
  {
    const page = doc.addPage(A3)
    const s = sheet(page, font, { scale: 50, x0: 120, y0: 200 })
    s.rect(0, 0, 1600, 650, 1)
    s.line(0, 320, 1600, 320, 0.4)
    const wins = [
      [100, 90, 120, 150, 'P1', '120/150'],
      [650, 90, 180, 150, 'P2', '180/150'],
      [1000, 0, 100, 220, 'KP1', '100/220'],
      [1200, 0, 300, 220, 'S1', '300/220'],
      [100, 410, 120, 150, 'P1', '120/150'],
      [650, 410, 180, 150, 'P2', '180/150'],
    ]
    for (const [x, y, w, h, code, dims] of wins) {
      s.rect(x, y, w, h, 0.6)
      s.rect(x + 5, y + 5, w - 10, h - 10, 0.3)
      s.text(code, x + 10, y + h + 25, 9)
      s.text(dims, x + 10, y + h + 5, 7)
    }
    s.text('±0.00', -80, 0, 7)
    s.text('+3.00', -80, 320, 7)
    titleBlock(s, page, font, [
      ['PROJE: ÖRNEK KONUT', 9],
      ['PAFTA: ÖN GÖRÜNÜŞ', 11],
      ['ÖLÇEK 1/50', 9],
      ['PAFTA NO: M-03', 8],
    ])
  }

  // ---------------- Sayfa 4: DOĞRAMA ÇİZELGESİ (S1 bilerek planla uyuşmaz: çizelge 2, plan 1)
  {
    const page = doc.addPage(A3)
    const cols = [
      ['POZ NO', 60],
      ['CİNSİ', 150],
      ['MALZEME', 290],
      ['EN (cm)', 420],
      ['BOY (cm)', 500],
      ['ADET', 590],
      ['AÇIKLAMA', 660],
    ]
    const rows = [
      ['P1', 'PENCERE', 'PVC', '120', '150', '5', 'Çift açılım, ısıcam'],
      ['P2', 'PENCERE', 'PVC', '180', '150', '2', 'Sabit + açılır'],
      ['K1', 'İÇ KAPI', 'AHŞAP', '90', '210', '5', 'Laminat kaplama'],
      ['KP1', 'DIŞ KAPI', 'ALÜMİNYUM', '100', '220', '1', 'Bina giriş kapısı'],
      ['S1', 'SÜRME KAPI', 'ALÜMİNYUM', '300', '220', '2', 'Balkon'],
      ['KR1', 'KORKULUK', 'ALÜMİNYUM', '620', '110', '1', 'Cam dolgulu, balkon'],
    ]
    page.drawText('DOĞRAMA ÇİZELGESİ', { x: 60, y: 760, size: 16, font, color: BLACK })
    const top = 720
    const rowH = 26
    const x0 = 50
    const x1 = 900
    for (let i = 0; i <= rows.length + 1; i++) page.drawLine({ start: { x: x0, y: top - i * rowH }, end: { x: x1, y: top - i * rowH }, thickness: i <= 1 ? 1 : 0.4, color: BLACK })
    for (const xx of [x0, ...cols.slice(1).map((c) => c[1] - 10), x1])
      page.drawLine({ start: { x: xx, y: top }, end: { x: xx, y: top - (rows.length + 1) * rowH }, thickness: 0.4, color: BLACK })
    for (const [name, x] of cols) page.drawText(name, { x, y: top - 18, size: 9, font, color: BLACK })
    rows.forEach((r, i) => r.forEach((cell, j) => page.drawText(cell, { x: cols[j][1], y: top - (i + 2) * rowH + 8, size: 9, font, color: BLACK })))
    page.drawText('Tüm ölçüler kaba inşaat (duvar boşluğu) ölçüsüdür; imalat öncesi yerinde kontrol edilecektir.', { x: 60, y: top - (rows.length + 2) * rowH - 10, size: 8, font, color: GREY })
    page.drawRectangle({ x: 890, y: 20, width: 280, height: 90, borderColor: BLACK, borderWidth: 0.8 })
    page.drawText('PROJE: ÖRNEK KONUT', { x: 898, y: 92, size: 9, font })
    page.drawText('PAFTA: DOĞRAMA ÇİZELGESİ', { x: 898, y: 75, size: 11, font })
    page.drawText('ÖLÇEKSİZ', { x: 898, y: 58, size: 9, font })
  }

  // ---------------- Sayfa 5: boş sayfa
  doc.addPage(A3)
  const bytes = await doc.save({ useObjectStreams: false })
  writeFileSync(path.join(OUT, 'mimari_cok_sayfali.pdf'), bytes)
  return bytes
}

/** Ölçeksiz, kodsuz plan: yalnız "EN/BOY" etiketleri tekrar eder (120/150 ×6, 90/210 ×4, 60/60 ×2) */
async function makeUnscaled() {
  const doc = await PDFDocument.create()
  fixed(doc)
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(FONT, { subset: true })
  const page = doc.addPage(A4L)
  const s = sheet(page, font, { scale: 100, x0: 60, y0: 120 })
  const T = 20
  const bottom = [
    { from: 80, to: 200, kind: 'pencere' },
    { from: 380, to: 500, kind: 'pencere' },
    { from: 700, to: 820, kind: 'pencere' },
    { from: 1100, to: 1160, kind: 'pencere' },
  ]
  const top = [
    { from: 80, to: 200, kind: 'pencere' },
    { from: 380, to: 500, kind: 'pencere' },
    { from: 700, to: 820, kind: 'pencere' },
    { from: 1100, to: 1160, kind: 'pencere' },
  ]
  hWall(s, 0, 1800, 0, T, bottom)
  hWall(s, 0, 1800, 1000 - T, T, top)
  vWall(s, 0, 1000, 0, T, [])
  vWall(s, 0, 1000, 1800 - T, T, [])
  vWall(s, T, 1000 - T, 600, 10, [{ from: 200, to: 290, kind: 'kapi' }, { from: 600, to: 690, kind: 'kapi' }])
  vWall(s, T, 1000 - T, 1200, 10, [{ from: 200, to: 290, kind: 'kapi' }, { from: 600, to: 690, kind: 'kapi' }])
  for (const o of bottom) s.text(`${o.to - o.from === 60 ? '60/60' : '120/150'}`, o.from + 10, -60, 8)
  for (const o of top) s.text(`${o.to - o.from === 60 ? '60/60' : '120/150'}`, o.from + 10, 1040, 8)
  for (const x of [600, 1200]) for (const y of [200, 600]) s.text('90/210', x + 30, y + 40, 8)
  s.text('SALON', 250, 500, 10)
  s.text('YATAK ODASI', 850, 500, 10)
  s.text('BANYO', 1450, 500, 10)
  const bytes = await doc.save({ useObjectStreams: false })
  writeFileSync(path.join(OUT, 'plan_olceksiz_tekrar.pdf'), bytes)
}

/** Yalnız çizgi: yazı yok (etiketsiz plan) */
async function makeUnlabeled() {
  const doc = await PDFDocument.create()
  fixed(doc)
  const page = doc.addPage(A4L)
  const s = sheet(page, null, { scale: 100, x0: 60, y0: 120 })
  hWall(s, 0, 1500, 0, 20, [{ from: 100, to: 220, kind: 'pencere' }, { from: 600, to: 690, kind: 'kapi' }])
  hWall(s, 0, 1500, 980, 20, [{ from: 300, to: 420, kind: 'pencere' }])
  vWall(s, 0, 1000, 0, 20, [])
  vWall(s, 0, 1000, 1480, 20, [])
  const bytes = await doc.save({ useObjectStreams: false })
  writeFileSync(path.join(OUT, 'plan_etiketsiz.pdf'), bytes)
}

/** Taranmış: ana dosyanın 1. sayfası 150 dpi gri görüntü olarak */
async function makeScanned(mainBytes) {
  const dir = mkdtempSync(path.join(tmpdir(), 'leonx-scan-'))
  const src = path.join(dir, 'src.pdf')
  writeFileSync(src, mainBytes)
  execFileSync('pdftoppm', ['-r', '150', '-f', '1', '-l', '1', '-gray', '-png', src, path.join(dir, 'p')])
  const png = readFileSync(path.join(dir, 'p-1.png'))
  // Aynı görüntü OCR testinde doğrudan kullanılır (Node'da PDF görüntüsünü çözmeden)
  writeFileSync(path.join(OUT, 'taranmis_plan_150dpi.png'), png)
  const doc = await PDFDocument.create()
  fixed(doc)
  const img = await doc.embedPng(png)
  const page = doc.addPage(A2)
  page.drawImage(img, { x: 0, y: 0, width: A2[0], height: A2[1] })
  writeFileSync(path.join(OUT, 'taranmis_plan.pdf'), await doc.save({ useObjectStreams: false }))
}

async function makeEmptyAndCorrupt(mainBytes) {
  const doc = await PDFDocument.create()
  fixed(doc)
  doc.addPage(A4L)
  writeFileSync(path.join(OUT, 'bos.pdf'), await doc.save({ useObjectStreams: false }))
  // Bozuk: geçerli başlık + yarıda kesilmiş gövde + çöp
  const cut = mainBytes.slice(0, 1200)
  const junk = Buffer.from('\n%%% bozuk veri %%%\n'.repeat(20))
  writeFileSync(path.join(OUT, 'bozuk.pdf'), Buffer.concat([Buffer.from(cut), junk]))
}

const main = await makeMain()
await makeUnscaled()
await makeUnlabeled()
await makeScanned(main)
await makeEmptyAndCorrupt(main)
console.log('PDF fikstürleri yazıldı:', OUT)
