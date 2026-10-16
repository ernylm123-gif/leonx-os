/**
 * Malzeme reçetesi PDF raporu (pdf-lib). Metraj raporunun yazı tipi, tablo ve sayfa yazıcısı kullanılır
 * (quantityPdf.Writer): Türkçe karakterler için Inter gömülür, satırlar sarmalanır, sayfa sonunda başlık
 * tekrarlanır. Onaylanmamış sürümde "TASLAK" filigranı basılır.
 */
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, type PDFImage } from 'pdf-lib'
import { ROLE_LABEL } from '@/bom/types'
import { type BomReport, categoryLabel, fmtCost, fmtInt, fmtMm, fmtQty, qtyUnit, statusLabel } from './bomReport'
import { DANGER, HEAD, INK, LINE, M, MUTED, PAGE, type PdfAssets, SOFT, WARN, WARN_BG, Writer, wrapText } from './quantityPdf'

const dtf = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const W = PAGE[0] - 2 * M

export async function bomToPdf(r: BomReport, assets: PdfAssets): Promise<Uint8Array> {
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
  const m = r.meta
  doc.setTitle(`${m.projectCode} — Malzeme reçetesi Rev ${m.revision}`)
  doc.setAuthor('LEONX METAL')
  doc.setCreator('LEONX OS')
  doc.setProducer('LEONX OS')
  doc.setCreationDate(m.generatedAt)
  const w = new Writer(doc, f, fb, !r.final)
  w.newPage()

  // ---------------------------------------------------------------- başlık
  let x = M
  if (logo) {
    const h = 40
    const lw = (logo.width / logo.height) * h
    w.page.drawImage(logo, { x: M, y: w.y - h + 4, width: lw, height: h })
    x = M + lw + 14
  }
  w.text('MALZEME REÇETESİ', x, 17, true, INK, w.y - 14)
  w.text(`${m.projectCode} · ${m.projectName}`, x, 10.5, false, INK, w.y - 30)
  const right = `Rev ${m.revision} · ${statusLabel(m.status)}`
  w.text(right, PAGE[0] - M - fb.widthOfTextAtSize(right, 11), 11, true, r.final ? INK : DANGER, w.y - 14)
  const date = `Rapor tarihi: ${dtf.format(m.generatedAt)}`
  w.text(date, PAGE[0] - M - f.widthOfTextAtSize(date, 8.5), 8.5, false, MUTED, w.y - 29)
  w.y -= 50
  w.page.drawLine({ start: { x: M, y: w.y }, end: { x: PAGE[0] - M, y: w.y }, thickness: 1, color: HEAD })
  w.y -= 4

  const info: [string, string][] = [
    ['Durum', r.banner],
    ['Kaynak metraj', `Rev ${m.takeoffRevision} · ${m.takeoffName} · ${m.takeoffStatus === 'onaylandi' ? 'onaylı' : 'onaysız'}`],
    ['Firma', m.companyName ?? '—'],
    ['Onay', m.approvedAt ? dtf.format(new Date(m.approvedAt)) : '—'],
    ['Oluşturma', dtf.format(new Date(m.createdAt))],
    ['Not', m.notes ?? '—'],
  ]
  const colW = W / 2
  for (let i = 0; i < info.length; i += 2) {
    w.y -= 13
    for (let j = 0; j < 2 && i + j < info.length; j++) {
      const [k, v] = info[i + j]
      const bx = M + j * colW
      w.text(k, bx, 8.5, false, MUTED)
      w.text(wrapText(v, f, 8.5, colW - 95)[0], bx + 88, 8.5, k === 'Durum', k === 'Durum' && !r.final ? DANGER : INK)
    }
  }
  w.y -= 8

  // ---------------------------------------------------------------- özet kutuları
  const profiles = r.totals.filter((t) => t.unit === 'mm_profil')
  const boxes: [string, string, boolean][] = [
    ['Poz', `${r.assignments.length} poz · ${r.assignments.reduce((s, a) => s + a.quantity, 0).toLocaleString('tr-TR')} adet`, false],
    ['Profil (fire dahil)', `${fmtQty(profiles.reduce((s, t) => s + t.totalMilli, 0))} m`, false],
    ['Maliyet (fiyatlı satırlar)', fmtCost(r.cost), false],
    ['Uyarı / fiyatsız satır', `${r.warnings.filter((x) => x.level !== 'bilgi').length} uyarı · ${r.unpricedLines} fiyatsız`, r.warnings.some((x) => x.level === 'hata') || r.unpricedLines > 0],
  ]
  const bw = (W - 3 * 10) / 4
  w.ensure(56)
  w.y -= 50
  boxes.forEach(([k, v, warn], i) => {
    const bx = M + i * (bw + 10)
    w.page.drawRectangle({ x: bx, y: w.y, width: bw, height: 44, color: warn ? WARN_BG : SOFT, borderColor: LINE, borderWidth: 0.6 })
    w.text(k, bx + 9, 8, false, warn ? WARN : MUTED, w.y + 29)
    w.text(wrapText(v, fb, 11, bw - 18)[0], bx + 9, 11, true, warn ? WARN : INK, w.y + 11)
  })

  // ---------------------------------------------------------------- malzeme toplamları
  w.heading('Malzeme toplamları')
  w.table(
    [
      { title: 'Rol', width: 70 },
      { title: 'Kod', width: 80 },
      { title: 'Malzeme', width: 168 },
      { title: 'Birim', width: 38 },
      { title: 'Parça', width: 46, align: 'right' },
      { title: 'Net', width: 64, align: 'right' },
      { title: 'Fire', width: 56, align: 'right' },
      { title: 'Toplam', width: 66, align: 'right' },
      { title: 'Std. boy', width: 52, align: 'right' },
      { title: 'Tah. boy', width: 46, align: 'right' },
      { title: 'Maliyet', width: W - 686 },
    ],
    r.totals.map((t) => ({
      tone: (!t.code ? 'warn' : undefined) as 'warn' | undefined,
      cells: [
        ROLE_LABEL[t.role],
        t.code ?? 'kod yok',
        t.name,
        qtyUnit(t.unit),
        fmtInt(t.pieces),
        fmtQty(t.netMilli),
        fmtQty(t.wasteMilli),
        fmtQty(t.totalMilli),
        fmtInt(t.standardLengthMm),
        fmtInt(t.barEstimate),
        Object.keys(t.cost).length ? fmtCost(t.cost) + (t.unpriced ? ` (+${t.unpriced} fiyatsız)` : '') : 'fiyat tanımlı değil',
      ],
    })),
    8,
  )
  w.para('Tahmini boy adedi = yukarı yuvarla(fire dahil toplam boy / standart boy). Kesim optimizasyonu değildir.', 7.5, MUTED)

  // ---------------------------------------------------------------- kesim listesi
  w.heading('Profil kesim listesi')
  if (r.cutList.length === 0) w.para('Kesimli profil satırı yok.', 9, MUTED)
  else
    w.table(
      [
        { title: 'Kod', width: 90 },
        { title: 'Profil', width: 180 },
        { title: 'Rol', width: 80 },
        { title: 'Kesim boyu mm', width: 84, align: 'right' },
        { title: 'Açı', width: 50 },
        { title: 'Parça', width: 60, align: 'right' },
        { title: 'Std. boy mm', width: 70, align: 'right' },
        { title: 'Pozlar', width: W - 614 },
      ],
      r.cutList.map((c) => ({ cells: [c.code ?? 'kod yok', c.name, ROLE_LABEL[c.role], fmtMm(c.cutDmm), c.angle ?? '', fmtInt(c.pieces), fmtInt(c.standardLengthMm), c.poz.join(', ')] })),
      8,
    )

  // ---------------------------------------------------------------- satırlar (rol bazında)
  for (const g of r.groups) {
    w.heading(`${g.label} — satırlar`)
    w.table(
      [
        { title: 'Poz', width: 60 },
        { title: 'Kod', width: 80 },
        { title: 'Malzeme', width: 170 },
        { title: 'Kesim mm', width: 60, align: 'right' },
        { title: 'Açı', width: 36 },
        { title: 'Parça', width: 46, align: 'right' },
        { title: 'Net', width: 64, align: 'right' },
        { title: 'Toplam', width: 70, align: 'right' },
        { title: 'Birim', width: 40 },
        { title: 'Tutar', width: W - 626, align: 'right' },
      ],
      g.lines.map((l) => ({
        cells: [
          l.poz,
          l.code ?? 'kod yok',
          l.name,
          fmtMm(l.cutDmm),
          l.angle ?? '',
          fmtInt(l.pieces),
          fmtQty(l.netMilli),
          fmtQty(l.totalMilli),
          qtyUnit(l.unit),
          l.lineCostCents == null || !l.currency ? 'fiyat tanımlı değil' : fmtCost({ [l.currency]: l.lineCostCents }),
        ],
      })),
      7.5,
    )
  }

  // ---------------------------------------------------------------- pozlar
  w.heading('Pozlar ve sistem atamaları')
  w.table(
    [
      { title: 'Poz', width: 60 },
      { title: 'İş grubu', width: 120 },
      { title: 'En × Boy mm', width: 100 },
      { title: 'Adet', width: 44, align: 'right' },
      { title: 'Kanat', width: 44, align: 'right' },
      { title: 'Açılım', width: 120 },
      { title: 'Sistem', width: 180 },
      { title: 'Metraj', width: W - 668 },
    ],
    r.assignments.map((a) => ({
      tone: (a.verification !== 'onaylandi' || !a.system_name ? 'warn' : undefined) as 'warn' | undefined,
      cells: [
        a.poz_code,
        categoryLabel(a.category),
        `${a.width_mm == null ? '—' : Number(a.width_mm).toLocaleString('tr-TR')} × ${a.height_mm == null ? '—' : Number(a.height_mm).toLocaleString('tr-TR')}`,
        String(a.quantity),
        a.kanat == null ? '—' : String(a.kanat),
        a.opening ?? '—',
        a.system_name ?? 'atanmamış',
        a.verification === 'onaylandi' ? 'Onaylı' : a.verification === 'bekliyor' ? 'Doğrulama bekliyor' : 'Reddedildi',
      ],
    })),
    8,
  )

  // ---------------------------------------------------------------- uyarılar ve kurallar
  if (r.warnings.length) {
    w.heading('Uyarılar')
    w.table(
      [
        { title: 'Düzey', width: 60 },
        { title: 'Açıklama', width: W - 60 },
      ],
      r.warnings.map((x) => ({ tone: (x.level === 'bilgi' ? 'muted' : 'warn') as 'warn' | 'muted', cells: [x.level === 'hata' ? 'Hata' : x.level === 'uyari' ? 'Uyarı' : 'Bilgi', x.message] })),
      8,
    )
  }
  w.heading('Hesap kuralları')
  for (const rule of r.rules) w.para(`• ${rule}`, 8.5, MUTED)

  const total = w.pages.length
  w.pages.forEach((p, i) => {
    const left = `LEONX OS · ${m.projectCode} · Malzeme reçetesi Rev ${m.revision} · ${statusLabel(m.status)}`
    p.drawLine({ start: { x: M, y: M - 2 }, end: { x: PAGE[0] - M, y: M - 2 }, thickness: 0.5, color: LINE })
    p.drawText(left, { x: M, y: M - 13, size: 7.5, font: f, color: MUTED })
    const pg = `Sayfa ${i + 1} / ${total}`
    p.drawText(pg, { x: PAGE[0] - M - f.widthOfTextAtSize(pg, 7.5), y: M - 13, size: 7.5, font: f, color: MUTED })
  })
  return doc.save({ useObjectStreams: true })
}
