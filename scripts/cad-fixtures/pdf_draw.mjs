/**
 * Mimari PDF fikstürleri için ortak çizim yardımcıları (Faz 5.2).
 *
 * İki yazı kipi vardır:
 *  - 'metin' : gerçek PDF yazısı (gömülü yazı tipi; pdf.js metin katmanı olarak okur)
 *  - 'cizgi' : AutoCAD SHX çıktısı benzetimi — harfler yazı değil, ÇİZGİ olarak çizilir
 *              (metin katmanı boştur; yalnız görüntüden/OCR ile okunabilir)
 */
import fontkit from '@pdf-lib/fontkit'
import { degrees, rgb } from 'pdf-lib'

export const A3 = [1190.55, 841.89]
export const A2 = [1683.78, 1190.55]
export const A4L = [841.89, 595.28]
export const PT_PER_MM = 72 / 25.4
export const BLACK = rgb(0, 0, 0)
export const GREY = rgb(0.45, 0.45, 0.45)

export function fixed(d) {
  // Kararlı çıktı: tarih ve üretici sabit
  d.setCreationDate(new Date('2026-01-01T00:00:00Z'))
  d.setModificationDate(new Date('2026-01-01T00:00:00Z'))
  d.setProducer('LEONX test fikstürü')
  d.setCreator('LEONX test fikstürü')
}

/**
 * Yazı çizici: mode 'metin' → drawText; 'cizgi' → harf dış hatları ince çizgiyle (dolgusuz)
 * çizilir. Konum ve boyut her iki kipte aynıdır.
 */
export function makeWriter(page, font, fontBytes, mode) {
  const fk = mode === 'cizgi' ? fontkit.create(fontBytes) : null
  const width = (s, size) => font.widthOfTextAtSize(s, size)
  const draw = (s, x, y, size, rot = 0, color = BLACK) => {
    if (mode !== 'cizgi') {
      page.drawText(s, { x, y, size, font, rotate: degrees(rot), color })
      return
    }
    const run = fk.layout(s)
    const k = size / fk.unitsPerEm
    const rad = (rot * Math.PI) / 180
    const c = Math.cos(rad)
    const sn = Math.sin(rad)
    let pen = 0
    run.glyphs.forEach((g, i) => {
      const pos = run.positions[i]
      const gx = (pen + pos.xOffset) * k
      const gy = pos.yOffset * k
      const svg = g.path.scale(1, -1).toSVG()
      if (svg) page.drawSvgPath(svg, { x: x + gx * c - gy * sn, y: y + gx * sn + gy * c, scale: k, rotate: degrees(rot), borderColor: color, borderWidth: 0.22 / k })
      pen += pos.xAdvance
    })
  }
  return { draw, width }
}

/** Ölçekli çizim yardımcısı: gerçek ölçü cm → kâğıt noktası */
export function sheet(page, writer, { scale, x0, y0 }) {
  const k = (10 / scale) * PT_PER_MM // 1 cm gerçek → pt
  const P = (x, y) => ({ x: x0 + x * k, y: y0 + y * k })
  const line = (x1, y1, x2, y2, t = 0.5, color = BLACK) => page.drawLine({ start: P(x1, y1), end: P(x2, y2), thickness: t, color })
  const rect = (x, y, w, h, t = 0.4, color = BLACK) => page.drawRectangle({ ...P(x, y), width: w * k, height: h * k, borderColor: color, borderWidth: t })
  const text = (s, x, y, size = 8, rot = 0, color = BLACK) => {
    const p = P(x, y)
    writer.draw(s, p.x, p.y, size, rot, color)
  }
  const textW = (s, size) => writer.width(s, size) / k // cm cinsinden
  const arc = (cx, cy, r, a0, a1, n = 12) => {
    for (let i = 0; i < n; i++) {
      const t0 = a0 + ((a1 - a0) * i) / n
      const t1 = a0 + ((a1 - a0) * (i + 1)) / n
      line(cx + r * Math.cos(t0), cy + r * Math.sin(t0), cx + r * Math.cos(t1), cy + r * Math.sin(t1), 0.3)
    }
  }
  return { k, P, line, rect, text, textW, arc }
}

/** Yatay duvar bandı (y..y+t) üzerinde boşluklu duvar çizgileri */
export function hWall(s, x0, x1, y, t, openings) {
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
export function vWall(s, y0, y1, x, t, openings) {
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
export function hChain(s, y, stops, size = 7) {
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

/** Antet: sağ altta çerçeve ve satırlar */
export function titleBlock(page, writer, lines) {
  const W = page.getWidth()
  const x = W - 300
  page.drawRectangle({ x, y: 20, width: 280, height: 90, borderColor: BLACK, borderWidth: 0.8 })
  page.drawLine({ start: { x, y: 65 }, end: { x: x + 280, y: 65 }, thickness: 0.4, color: BLACK })
  let yy = 92
  for (const [txt, size] of lines) {
    writer.draw(txt, x + 8, yy, size)
    yy -= size + 8
  }
}
