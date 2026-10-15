/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadPdfPages } from '../testing/pdfNode'
import { nodeOcrEngine } from '../testing/ocrNode'
import { analyzePdfFile } from '../testing/benchRun'
import type { OcrEngine } from './ocr'
import { dedupeWords, planOcrTiles, thickenStrokes } from './ocr'
import { canonCode, fixOcrText, parseDims, parseQty } from './labels'
import { extractAttributes, openingCodes, withMissing } from './attributes'
import { floorInfo, isRoomName } from './floors'
import { garbledRatio } from './pdfScene'
import { stackedFractions, type PdfPozCandidate, type TextRun } from './archAnalyze'
import { segmentIndex } from './segments'
import { candidateToInput } from '@/quantity/fromDetection'

const byCode = (c: PdfPozCandidate[], code: string) => c.find((x) => canonCode(x.code) === canonCode(code))!

describe('Faz 5.2 — ölçü ve kod yazımları', () => {
  it('metre, birim ekli, adlandırılmış ölçü yazımları', () => {
    expect(parseDims('1.20/1.50')).toMatchObject({ w_mm: 1200, h_mm: 1500, unit: 'm' })
    expect(parseDims('1,20 x 2,10')).toMatchObject({ w_mm: 1200, h_mm: 2100, unit: 'm' })
    expect(parseDims('120/150 cm')).toMatchObject({ w_mm: 1200, h_mm: 1500, unit: 'cm' })
    expect(parseDims('1200x1500 mm')).toMatchObject({ w_mm: 1200, h_mm: 1500, unit: 'mm' })
    expect(parseDims('EN:120 BOY:150')).toMatchObject({ w_mm: 1200, h_mm: 1500 })
    expect(parseDims('B=90 H=210')).toMatchObject({ w_mm: 900, h_mm: 2100 })
    expect(parseDims('EN/BOY: 100/220')).toMatchObject({ w_mm: 1000, h_mm: 2200 })
    // Anlamsızlar reddedilir: ölçek, tarih, kot, tek sayı
    expect(parseDims('1/50')).toBeNull()
    expect(parseDims('12/03')).toBeNull()
    expect(parseDims('3.00')).toBeNull()
    expect(parseDims('0.20/0.10')).toBeNull()
  })

  it('kod eşleştirme anahtarı: P-01 = P01 = P1, CP-01 = CP1', () => {
    expect(canonCode('P-01')).toBe('P1')
    expect(canonCode('P01')).toBe('P1')
    expect(canonCode('p.1')).toBe('P1')
    expect(canonCode('CP-01')).toBe('CP1')
    expect(canonCode('P10')).toBe('P10')
    expect(canonCode('K-2A')).toBe('K2A')
  })

  it('adet yazıları', () => {
    expect(parseQty('ADET: 8')).toBe(8)
    expect(parseQty('9 ADET')).toBe(9)
    expect(parseQty('MİKTAR: 4 AD.')).toBe(4)
    expect(parseQty('AD. 12')).toBe(12)
    expect(parseQty('ADET')).toBeNull()
    expect(parseQty('120/150')).toBeNull()
  })

  it('OCR düzeltmesi: ince yazıda 1 → T, I, L; 0 → O', () => {
    expect(fixOcrText('KT')).toBe('K1')
    expect(fixOcrText('P-OI')).toBe('P-01')
    expect(fixOcrText('1.2O/1.5O')).toBe('1.20/1.50')
    expect(fixOcrText('KAPI')).toBe('KAPI')
    expect(fixOcrText('SALON')).toBe('SALON')
  })

  it('kesirli etiket: üst üste iki sayı + kesir çizgisi → "180/150"; ölçü zinciri sayıları birleşmez', () => {
    const mk = (text: string, x: number, y: number): TextRun => ({ text, angle: 0, height: 8, ox: x, oy: y, width: 14, bbox: [x, y - 1, x + 14, y + 7], ids: [] })
    const top = mk('180', 100, 100)
    const bottom = mk('150', 100, 86)
    const chainA = mk('120', 300, 100)
    const chainB = mk('300', 300, 60)
    // Kesir çizgisi (yalnız ilk çiftte) — sahneyi taklit eden basit çizgi dizini
    const scene = {
      coords: Float64Array.from([98, 94, 116, 94]),
      entities: [{ id: 0, type: 'PDF_PATH', handle: null, layer: 'PDF çizgi', rgb: null, insert: -1, owner: -1, kind: 'path' as const, start: 0, count: 2, closed: false, bbox: [98, 94, 116, 94] as [number, number, number, number], length: 18, area: null, exact: true }],
      inserts: [],
      layers: [],
      bbox: [0, 0, 500, 500] as [number, number, number, number],
    }
    const out = stackedFractions([top, bottom, chainA, chainB], segmentIndex(scene), new Set())
    expect(out.map((f) => f.run.text)).toEqual(['180/150'])
  })
})

describe('Faz 5.2 — kat, mahal, özellikler', () => {
  it('kat çarpanı yalnız başlıkta açıkça yazıyorsa', () => {
    expect(floorInfo('NORMAL KAT PLANI (1.-4. KATLAR)')).toMatchObject({ label: 'Normal kat', multiplier: 4 })
    expect(floorInfo('TİP KAT PLANI (4 KAT)').multiplier).toBe(4)
    expect(floorInfo('2. KAT PLANI')).toMatchObject({ label: '2. kat', multiplier: null })
    expect(floorInfo('ZEMİN KAT PLANI')).toMatchObject({ label: 'Zemin kat', multiplier: null })
    expect(floorInfo('1., 2. VE 3. KAT PLANI').multiplier).toBe(3)
    expect(floorInfo('NORMAL KAT PLANI').multiplier).toBeNull()
  })

  it('mahal adları', () => {
    expect(isRoomName('YATAK ODASI')).toBe(true)
    expect(isRoomName('Salon')).toBe(true)
    expect(isRoomName('32,50 m²')).toBe(false)
    expect(isRoomName('P1')).toBe(false)
  })

  it('özellikler: pozun kendi yazısı doğrulandı, genel not ve OCR aday, eksik belirsiz', () => {
    const a = extractAttributes([
      { text: 'PVC - RAL 9016', origin: 'kart P-01', direct: true },
      { text: 'CAM: 4+16+4 ISICAM', origin: 'kart P-01', direct: true },
      { text: 'AÇILIM: ÇİFT AÇILIM', origin: 'kart P-01', direct: true, ocr: true },
      { text: 'AKSİ BELİRTİLMEDİKÇE TÜM DOĞRAMALAR ALÜMİNYUM', origin: 'genel not', direct: false },
    ])
    expect(a.malzeme).toMatchObject({ value: 'PVC', status: 'dogrulandi' })
    expect(a.cam).toMatchObject({ value: '4+16+4 ısıcam', status: 'dogrulandi' })
    expect(a.renk).toMatchObject({ value: 'RAL 9016', status: 'dogrulandi' })
    expect(a.acilim).toMatchObject({ value: 'Çift açılım', status: 'aday' })
    const full = withMissing(a)
    expect(full.sistem?.status).toBe('belirsiz')
    // Genel not yalnız eksik özelliği doldurur ve aday kalır
    const b = extractAttributes([{ text: 'NOT: AKSİ BELİRTİLMEDİKÇE TÜM DOĞRAMALAR PVC, RAL 9016 BEYAZDIR.', origin: 'genel not', direct: false }])
    expect(b.malzeme).toMatchObject({ value: 'PVC', status: 'aday' })
    expect(b.renk?.status).toBe('aday')
  })

  it('sistem bilgisi uydurulmaz: yalnız yazıda varsa', () => {
    expect(extractAttributes([{ text: 'PVC PENCERE', origin: 'x', direct: true }]).sistem).toBeUndefined()
    expect(extractAttributes([{ text: 'PROFİL: 70 MM 5 ODACIKLI', origin: 'x', direct: true }]).sistem?.value).toBe('70 MM 5 ODACIKLI')
  })

  it('açılım yazısı kodları', () => {
    expect(openingCodes('AÇILIM: SABİT + AÇILIR')?.codes).toEqual(['sabit', 'acilir'])
    expect(openingCodes('ÇİFT AÇILIM')?.codes).toEqual(['cift_acilim'])
    expect(openingCodes('VASİSTAS')?.codes).toEqual(['vasistas'])
    expect(openingCodes('SÜRME KAPI')?.codes).toEqual(['surme'])
  })
})

describe('Faz 5.2 — kart tipi doğrama listesi + 4 kat için normal kat planı (SENTETİK fikstür)', () => {
  it('6 poz: ölçü, adet, iş kalemi; plan × kat çarpanı listeyle uyumlu; P-03 çelişkisi kullanıcıya bırakılır', async () => {
    const r = await analyzePdfFile('dograma_listesi_kart.pdf')
    expect(r.analyses.map((a) => [a.sheet, a.cardCount, a.floor.multiplier])).toEqual([
      ['cizelge', 6, null],
      ['plan', 0, 4],
    ])
    const got = r.candidates.map((c) => [c.code, c.width_mm, c.height_mm, c.count, c.category]).sort()
    expect(got).toEqual([
      ['CP-01', 2400, 3000, 2, 'cephe_dograma'],
      ['K-01', 900, 2200, 4, 'pvc_kapi'],
      ['P-01', 1200, 1500, 8, 'pvc_pencere'],
      ['P-02', 1800, 1500, 4, 'pvc_pencere'],
      ['P-03', 600, 600, 9, 'pvc_pencere'],
      ['S-01', 3000, 2200, 4, 'surme'],
    ])
    const p3 = byCode(r.candidates, 'P-03')
    expect(p3.conflicts.map((c) => c.message)).toEqual(['Poz P-03: Plan paftalarında 8 adet (S2 (NORMAL KAT PLANI (1.-4. KATLAR)): 2 × 4 kat = 8), doğrama listesinde 9 adet bulunuyor.'])
    expect(p3.level).not.toBe('yuksek')
    // Planda "P1" ve "1.20/1.50" (metre), listede "P-01": eşleşir
    const p1 = byCode(r.candidates, 'P1')
    expect(p1.codeVariants).toEqual(['P-01', 'P1'])
    expect([p1.planQty, p1.scheduleQty, p1.floorMultiplier, p1.level]).toEqual([8, 8, 4, 'yuksek'])
    // Kesirli etiket (180 / 150) okunur
    expect(byCode(r.candidates, 'P2').evidence.join(' ')).toContain('Plan etiketleri çizelge ölçüsüyle aynı')
  })

  it('teknik özellikler: kart yazısı doğrulandı, görünüş çizimi ve genel not aday', async () => {
    const r = await analyzePdfFile('dograma_listesi_kart.pdf')
    const p1 = byCode(r.candidates, 'P-01')
    expect(p1.attrs.malzeme).toMatchObject({ value: 'PVC', status: 'dogrulandi' })
    expect(p1.attrs.cam).toMatchObject({ value: '4+16+4 ısıcam', status: 'dogrulandi' })
    expect(p1.attrs.renk).toMatchObject({ value: 'RAL 9016', status: 'dogrulandi' })
    expect(p1.attrs.sistem).toMatchObject({ value: '70 MM 5 ODACIKLI', status: 'dogrulandi' })
    expect(p1.attrs.acilim).toMatchObject({ value: 'Çift açılım', status: 'dogrulandi' })
    expect(p1.evidence.join(' ')).toContain('Görünüş çizimindeki açılım sembolleri yazıyla uyumlu')
    expect(p1.evidence.join(' ')).toContain('Görünüş çizimi 1/50 ölçekte')
    const p2 = byCode(r.candidates, 'P-02')
    expect(p2.elevation?.panels.map((x) => x.opening)).toEqual(['sabit', 'acilir'])
    expect(p2.attrs.bolme?.status).toBe('aday')
    const p3 = byCode(r.candidates, 'P-03')
    expect(p3.elevation?.panels.map((x) => x.opening)).toEqual(['vasistas'])
    // P-03 kartında renk yok: genel nottan aday
    expect(p3.attrs.renk?.status).toBe('aday')
    expect(byCode(r.candidates, 'S-01').elevation?.panels.map((x) => x.opening)).toEqual(['surme', 'surme'])
    expect(byCode(r.candidates, 'K-01').elevation?.panels.map((x) => x.opening)).toEqual(['cift_acilim'])
    const cp = byCode(r.candidates, 'CP-01')
    expect([cp.elevation?.cols, cp.elevation?.rows]).toEqual([2, 2])
    expect(cp.reasons.join(' ')).toContain('Planlarda bu poza ait etiket bulunamadı')
    // Mahal ve kat
    expect(p1.attrs.kat?.value).toContain('Normal kat (×4)')
  })

  it('izlenebilirlik: özellikler, çelişkiler ve kaynak metraj kaydına taşınır', async () => {
    const r = await analyzePdfFile('dograma_listesi_kart.pdf')
    const input = candidateToInput(byCode(r.candidates, 'P-03'), { approve: false, fileName: 'x.pdf', analysisId: null })
    expect(input.detection?.attrs?.malzeme?.status).toBe('dogrulandi')
    expect(input.detection?.conflicts?.[0].kind).toBe('adet')
    expect(input.detection?.provenance).toMatchObject({ schedule_qty: 9, plan_qty: 8, floor_multiplier: 4 })
    expect(JSON.stringify(input.detection).length).toBeLessThan(16384)
  })
})

describe('Faz 5.2 — yazı tespiti ve OCR planı', () => {
  it('AutoCAD SHX benzetimi: yazı çizgi olarak algılanır; OCR olmadan nedeni söylenir', async () => {
    const { pages } = await loadPdfPages('autocad_shx_plan.pdf')
    expect(pages[0].kind).toBe('vektorel')
    expect(pages[0].textGeometry?.regions.length).toBeGreaterThan(5)
    expect(pages[0].stats.textItems).toBe(0)
    const r = await analyzePdfFile('autocad_shx_plan.pdf')
    expect(r.candidates).toHaveLength(0)
    expect(r.diagnostics.whyNone[0]).toContain('çizgi olarak gömülü')
    expect(r.diagnostics.report.asks.map((a) => a.kind)).toContain('ocr')
    expect(r.diagnostics.report.ocrNeededPages).toEqual([{ page: 1, reason: expect.stringContaining('SHX'), done: false }])
  })

  it('normal vektör paftada yazı-çizgi alarmı yok; görüntü bölgesi bulunur', async () => {
    const kart = await loadPdfPages('dograma_listesi_kart.pdf')
    expect(kart.pages.every((p) => p.textGeometry == null)).toBe(true)
    const karma = await loadPdfPages('karma_cizelge_raster.pdf')
    expect(karma.pages[0].imageBoxes).toHaveLength(1)
    const r = await analyzePdfFile('karma_cizelge_raster.pdf')
    expect(r.analyses[0].ocrNeeded).toContain('görüntü olarak gömülü')
  })

  it('bozuk yazı tipi eşlemesi oranı', () => {
    expect(garbledRatio(['P1', '120/150', 'SALON'])).toBe(0)
    expect(garbledRatio(['', '!"#$', 'P1', '\u0003\u0004x'])).toBeCloseTo(0.75)
  })

  it('karo planı: büyük bölge sınırlı karolara bölünür, örtüşür ve bölgeyi kaplar', () => {
    const tiles = planOcrTiles('sayfa', { widthPt: 2384, heightPt: 1684 }, 300, 2048)
    const tilePt = 2048 / (300 / 72)
    expect(tiles.length).toBeGreaterThan(4)
    for (const t of tiles) {
      expect(t.box[2] - t.box[0]).toBeLessThanOrEqual(tilePt + 0.01)
      expect(t.box[3] - t.box[1]).toBeLessThanOrEqual(tilePt + 0.01)
    }
    // Her nokta bir karoda
    for (const [x, y] of [[0, 0], [2384, 1684], [1192, 842], [2000, 100]])
      expect(tiles.some((t) => x >= t.box[0] - 0.01 && x <= t.box[2] + 0.01 && y >= t.box[1] - 0.01 && y <= t.box[3] + 0.01)).toBe(true)
    // Yakın küçük bölgeler birleşir, farklı kipler birleşmez
    const small = planOcrTiles(
      [
        { bbox: [10, 10, 40, 20] },
        { bbox: [45, 10, 80, 20] },
        { bbox: [45, 10, 80, 20], mode: 'blok' },
      ],
      { widthPt: 500, heightPt: 500 },
      300,
    )
    expect(small).toHaveLength(2)
  })

  it('örtüşen karolardaki aynı kelime bir kez; kalınlaştırma ince çizgiyi genişletir', () => {
    const w = dedupeWords([
      { text: 'P1', bbox: [0, 0, 10, 8], confidence: 80 },
      { text: 'P1', bbox: [0.5, 0, 10.5, 8], confidence: 92 },
      { text: 'K1', bbox: [50, 0, 60, 8], confidence: 70 },
    ])
    expect(w.map((x) => [x.text, x.confidence])).toEqual([
      ['P1', 92],
      ['K1', 70],
    ])
    const W = 5
    const data = new Uint8ClampedArray(W * W * 4).fill(255)
    const set = (x: number, y: number) => data.set([0, 0, 0, 255], (y * W + x) * 4)
    set(2, 2)
    thickenStrokes(data, W, W)
    const dark = [...Array(W * W).keys()].filter((i) => data[i * 4] === 0).length
    expect(dark).toBe(9)
  })
})

describe('Faz 5.2 — uçtan uca OCR (tesseract.js, Node; SENTETİK fikstür)', () => {
  let engine: OcrEngine
  let terminate: () => Promise<void>
  beforeAll(async () => {
    ;({ engine, terminate } = await nodeOcrEngine())
  }, 60_000)
  afterAll(async () => {
    await terminate?.()
  })

  it('AutoCAD SHX benzetimi: karo OCR ile pozlar ve ölçüler okunur, ölçek OCR sayılarıyla doğrulanır', async () => {
    const r = await analyzePdfFile('autocad_shx_plan.pdf', { engine })
    expect(r.analyses[0].textSource).toBe('ocr')
    expect(r.analyses[0].sheet).toBe('plan')
    expect(r.analyses[0].scale.inferred?.denominator).toBe(100)
    const got = Object.fromEntries(r.candidates.map((c) => [c.code, [c.width_mm, c.height_mm, c.count]]))
    expect(got.P1).toEqual([1200, 1500, 3])
    expect(got.P2).toEqual([1800, 1500, 1])
    expect(got.S1).toEqual([3000, 2200, 1])
    // K1 etiketi kapı yayıyla kesişiyor: kod okunur, ölçü okunamazsa uydurulmaz
    const k1 = r.candidates.find((c) => c.code === 'K1')
    expect(k1?.count).toBe(2)
    if (k1?.width_mm == null) expect(k1?.reasons.join(' ')).toContain('Ölçü bulunamadı')
    for (const c of r.candidates) expect(c.reasons.join(' ')).toContain('OCR')
  }, 120_000)

  it('karma pafta: görüntüdeki çizelge blok kipinde okunur; adet ve malzeme çizelgeden', async () => {
    const r = await analyzePdfFile('karma_cizelge_raster.pdf', { engine })
    expect(r.analyses[0].textSource).toBe('vektor+ocr')
    expect(r.analyses[0].scheduleRows).toBe(4)
    const got = r.candidates.map((c) => [c.code, c.width_mm, c.height_mm, c.count, c.category, c.scheduleQty, c.planQty]).sort()
    expect(got).toEqual([
      ['K1', 900, 2100, 2, 'belirsiz', 2, 2],
      ['P1', 1200, 1500, 3, 'pvc_pencere', 3, 3],
      ['P2', 1800, 1500, 1, 'pvc_pencere', 1, 1],
      ['S1', 3000, 2200, 1, 'surme', 1, 1],
    ])
    expect(byCode(r.candidates, 'K1').outOfScope).toContain('ahşap')
  }, 120_000)
})
