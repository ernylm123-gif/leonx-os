/// <reference types="node" />
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPdfPages, PDF_FIXTURES } from '../testing/pdfNode'
import { aggregatePdf, analyzePage, classifySheet, fixOcrText, mergeRuns, parseDims, runsFromOcr, type PdfPozCandidate, type TextRun } from './archAnalyze'
import { wordsToPage } from './ocr'
import { candidateToInput, canApprove } from '@/quantity/fromDetection'
import { computeItem } from '@/quantity/engine'

/**
 * Gerçekçi mimari PDF fikstürleri (scripts/cad-fixtures/make_pdf_fixtures.mjs): çok sayfalı proje
 * (2 kat planı + görünüş + doğrama çizelgesi + boş sayfa), ölçeksiz/kodsuz plan, yazısız plan,
 * taranmış plan, boş ve bozuk dosya. pdf.js'in gerçek çıktısıyla çalışır.
 */
async function run(file: string, opts: { pages?: number[]; userDen?: Record<number, number> } = {}) {
  const { pageCount, pages } = await loadPdfPages(file, opts.pages)
  const an = pages.map((p) => analyzePage({ page: p.page, kind: p.kind, scene: p.scene, userDenominator: opts.userDen?.[p.page] ?? null }))
  return { pageCount, pages, an, ...aggregatePdf(an, { pageCount }) }
}
const byCode = (c: PdfPozCandidate[], code: string) => c.find((x) => x.code === code)!

describe('Mimari PDF — çok sayfalı proje', () => {
  it('tüm sayfalar okunur ve pafta türleri doğru sınıflandırılır', async () => {
    const r = await run('mimari_cok_sayfali.pdf')
    expect(r.pageCount).toBe(5)
    expect(r.diagnostics.pages.map((p) => [p.page, p.sheet, p.kind])).toEqual([
      [1, 'plan', 'vektorel'],
      [2, 'plan', 'vektorel'],
      [3, 'gorunus', 'vektorel'],
      [4, 'cizelge', 'vektorel'],
      [5, 'bilinmiyor', 'bos'],
    ])
    expect(r.diagnostics.pages[0].title).toBe('ZEMİN KAT PLANI')
    expect(r.diagnostics.pages[3].scheduleRows).toBe(6)
  })

  it('çizelge + plan: adet, ölçü, tür ve malzeme; görünüş tekrarları sayılmaz', async () => {
    const { candidates: c } = await run('mimari_cok_sayfali.pdf')
    expect(c.map((x) => x.code).sort()).toEqual(['K1', 'KP1', 'KR1', 'P1', 'P2', 'S1'])
    const p1 = byCode(c, 'P1')
    expect([p1.count, p1.width_mm, p1.height_mm, p1.category, p1.planQty, p1.scheduleQty]).toEqual([5, 1200, 1500, 'pvc_pencere', 5, 5])
    expect(p1.level).toBe('yuksek')
    expect(p1.evidence.join(' ')).toContain('Görünüşteki 2 etiket sayılmadı')
    // Parçalı "120/" + "150" ve döndürülmüş "K1 90/210" etiketleri okunur
    expect(byCode(c, 'K1').planQty).toBe(5)
    // "Sabit + açılır" açıklaması türü değiştirmez (CİNSİ: PENCERE)
    expect(byCode(c, 'P2').category).toBe('pvc_pencere')
    expect(byCode(c, 'KP1').category).toBe('al_kapi')
    expect(byCode(c, 'S1').category).toBe('surme')
    const kr = byCode(c, 'KR1')
    expect([kr.category, kr.width_mm, kr.count]).toEqual(['korkuluk', 6200, 1])
  })

  it('çizelge ile plan uyuşmazsa uyarır ve güveni düşürür (S1: çizelge 2, plan 1)', async () => {
    const { candidates: c } = await run('mimari_cok_sayfali.pdf')
    const s1 = byCode(c, 'S1')
    expect(s1.count).toBe(2)
    expect(s1.planQty).toBe(1)
    expect(s1.conflicts.map((c) => c.message).join(' ')).toContain('Poz S1: Plan paftalarında 1 adet, doğrama çizelgesinde 2 adet bulunuyor.')
    expect(s1.conflicts[0].kind).toBe('adet')
    expect(s1.level).not.toBe('yuksek')
  })

  it('malzeme yazılmamış/kapsam dışı (ahşap kapı) aday onaylanamaz; iş grubu seçilmeli', async () => {
    const { candidates: c } = await run('mimari_cok_sayfali.pdf')
    const k1 = byCode(c, 'K1')
    expect(k1.category).toBe('belirsiz')
    expect(k1.outOfScope).toContain('ahşap')
    expect(canApprove(candidateToInput(k1, { approve: false, fileName: null, analysisId: null }))).toBe(false)
  })

  it('ölçek: ölçü yazıları ile çizgi uzunlukları 1/50 ölçeğini doğrular; açıklık genişlikleri yazıyla uyumlu', async () => {
    const r = await run('mimari_cok_sayfali.pdf')
    const s = r.diagnostics.pages[0].scale
    expect(s.title).toBe(50)
    expect(s.inferred?.denominator).toBe(50)
    expect(s.inferred!.support).toBeGreaterThanOrEqual(10)
    expect(r.diagnostics.suggestedScale?.denominator).toBe(50)
    const p1 = byCode(r.candidates, 'P1')
    expect(p1.evidence.join(' ')).toContain('5 etikette çizimdeki açıklık genişliği yazıyla uyumlu')
    expect(p1.dims[0]).toMatchObject({ geometricMm: 1200, matches: true })
    // Her plan örneği vurgulanacak nesneleri ve sayfasını taşır
    const plan = p1.instances.filter((i) => i.role === 'plan')
    expect(plan).toHaveLength(5)
    expect(plan.every((i) => i.page && i.entityIds.length >= 2)).toBe(true)
    expect(p1.instances.some((i) => i.role === 'cizelge' && i.page === 4)).toBe(true)
  })

  it('yalnız seçilen sayfalar analiz edilir: yalnız görünüş → sayım plandan yapılmaz', async () => {
    const r = await run('mimari_cok_sayfali.pdf', { pages: [3] })
    const p1 = byCode(r.candidates, 'P1')
    expect(p1.count).toBe(2)
    expect(p1.reasons.join(' ')).toContain('Yalnız görünüş paftasında bulundu')
    expect(p1.level).not.toBe('yuksek')
  })

  it('metraja ve teklif ölçüsüne dönüşüm: alan ve mtül doğru', async () => {
    const { candidates: c } = await run('mimari_cok_sayfali.pdf')
    const p1 = computeItem({ ...candidateToInput(byCode(c, 'P1'), { approve: true, fileName: 'x.pdf', analysisId: null }), verification: 'onaylandi' })
    expect(p1.primary).toEqual({ unit: 'm2', centi: 900 }) // 1,2 × 1,5 × 5 = 9,00 m²
    const kr = computeItem({ ...candidateToInput(byCode(c, 'KR1'), { approve: true, fileName: 'x.pdf', analysisId: null }), verification: 'onaylandi' })
    expect(kr.primary).toEqual({ unit: 'mtul', centi: 620 })
    const ref = candidateToInput(byCode(c, 'P1'), { approve: false, fileName: 'x.pdf', analysisId: null }).drawing_ref!
    expect(ref.source).toBe('cizelge')
    expect(ref.box_pages).toHaveLength(ref.boxes!.length)
  })
})

describe('Mimari PDF — zor durumlar', () => {
  it('ölçeksiz, kodsuz plan: tekrar eden ölçü etiketleri gruplanır; ölçek bilinmediği belirtilir', async () => {
    const r = await run('plan_olceksiz_tekrar.pdf')
    const got = r.candidates.map((c) => [c.code, c.count, c.width_mm, c.height_mm]).sort()
    expect(got).toEqual([
      ['120/150', 6, 1200, 1500],
      ['60/60', 2, 600, 600],
      ['90/210', 4, 900, 2100],
    ])
    expect(r.diagnostics.pages[0].scale.used).toBeNull()
    for (const c of r.candidates) {
      expect(c.category).toBe('belirsiz') // malzeme yazılmamış → onay için seçim gerekir
      expect(c.reasons.join(' ')).toContain('ölçeği bilinmediği')
      expect(c.level).not.toBe('yuksek')
    }
    expect(byCode(r.candidates, '90/210').typeHint).toBe('kapi')
  })

  it('yanlış ölçek girilirse açıklık bulunamaz ve güven düşer; doğru ölçekte uyumlu', async () => {
    const wrong = await run('plan_olceksiz_tekrar.pdf', { userDen: { 1: 50 } })
    const right = await run('plan_olceksiz_tekrar.pdf', { userDen: { 1: 100 } })
    const w = byCode(wrong.candidates, '120/150')
    const ok = byCode(right.candidates, '120/150')
    expect(w.reasons.join(' ')).toContain('açıklık çizgisi bulunamadı')
    expect(ok.evidence.join(' ')).toContain('yazıyla uyumlu (ölçek 1/100)')
    expect(ok.confidence).toBeGreaterThan(w.confidence)
  })

  it('yazısız plan: aday üretilmez, nedeni açıklanır', async () => {
    const r = await run('plan_etiketsiz.pdf')
    expect(r.candidates).toHaveLength(0)
    expect(r.diagnostics.pages[0].segments).toBeGreaterThan(10)
    expect(r.diagnostics.whyNone.join(' ')).toContain('Çizimde yazı yok')
  })

  it('taranmış PDF (OCR yok): görüntü olarak tanınır, nedeni açıklanır', async () => {
    const r = await run('taranmis_plan.pdf')
    expect(r.diagnostics.pages[0].kind).toBe('taranmis')
    expect(r.candidates).toHaveLength(0)
    expect(r.diagnostics.whyNone.join(' ')).toContain('OCR')
  })

  it('boş PDF: sayfa boş olarak bildirilir', async () => {
    const r = await run('bos.pdf')
    expect(r.diagnostics.pages[0].kind).toBe('bos')
    expect(r.diagnostics.whyNone.join(' ')).toContain('boş')
  })

  it('bozuk PDF: açılamaz (hata fırlatır, sessizce boş sonuç vermez)', async () => {
    await expect(loadPdfPages('bozuk.pdf')).rejects.toThrow()
  })
})

describe('Etiket ve metin ayrıştırma', () => {
  it('ölçü etiketleri: cm, mm, parapet; anlamsızlar reddedilir', () => {
    expect(parseDims('120/150')).toMatchObject({ w_mm: 1200, h_mm: 1500, unit: 'cm' })
    expect(parseDims('90 / 210')).toMatchObject({ w_mm: 900, h_mm: 2100 })
    expect(parseDims('1200x1500')).toMatchObject({ w_mm: 1200, h_mm: 1500, unit: 'mm' })
    expect(parseDims('120/150/90')).toMatchObject({ w_mm: 1200, extra: 90 })
    expect(parseDims('(100/220)')).toMatchObject({ w_mm: 1000, h_mm: 2200 })
    expect(parseDims('1/50')).toBeNull()
    expect(parseDims('12/03')).toBeNull()
    expect(parseDims('3/4')).toBeNull()
  })

  it('pafta başlığı: antet yazısı küçük kesit işaretlerine üstün gelir', () => {
    const r = (text: string, height: number): TextRun => ({ text, angle: 0, height, ox: 0, oy: 0, width: 10, bbox: [0, 0, 1, 1], ids: [] })
    expect(classifySheet([r('A-A KESİTİ', 6), r('PAFTA: 2. KAT PLANI', 11)]).sheet).toBe('plan')
    expect(classifySheet([r('KAPI VE PENCERE LİSTESİ', 14)]).sheet).toBe('cizelge')
    expect(classifySheet([r('SALON', 10)]).sheet).toBe('bilinmiyor')
  })

  it('aynı taban çizgisindeki parçalar birleşir, uzaktakiler ayrı kalır', () => {
    const mk = (text: string, ox: number, w: number): TextRun => ({ text, angle: 0, height: 8, ox, oy: 100, width: w, bbox: [ox, 100, ox + w, 108], ids: [ox] })
    const out = mergeRuns([mk('120/', 10, 18), mk('150', 28, 13), mk('300', 200, 13)]).map((r) => r.text)
    expect(out.sort()).toEqual(['120/150', '300'])
  })

  it('OCR düzeltmesi: 1/I/l karışıklığı yalnız poz kodu ve ölçü biçiminde', () => {
    expect(fixOcrText('KI')).toBe('K1')
    expect(fixOcrText('Pİ')).toBe('P1')
    expect(fixOcrText('sı')).toBe('S1')
    expect(fixOcrText('KPI')).toBe('KP1')
    expect(fixOcrText('12O/15O')).toBe('120/150')
    expect(fixOcrText('KAPI')).toBe('KAPI')
    expect(fixOcrText('SALON')).toBe('SALON')
  })
})

describe('OCR (tesseract.js, yerel Türkçe dil verisi)', () => {
  it(
    'taranmış plan görüntüsünden poz ve ölçü etiketleri okunur',
    async () => {
      const { createWorker, PSM, OEM } = await import('tesseract.js')
      const langPath = path.resolve(__dirname, '../../../node_modules/@tesseract.js-data/tur/4.0.0_best_int')
      const worker = await createWorker('tur', OEM.LSTM_ONLY, { langPath, cachePath: mkdtempSync(path.join(tmpdir(), 'leonx-ocr-')), gzip: true })
      try {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
        const png = readFileSync(path.join(PDF_FIXTURES, 'taranmis_plan_150dpi.png'))
        const { data } = await worker.recognize(png, {}, { blocks: true, text: false })
        // 150 dpi → 150/72 piksel/pt; A2 yatay sayfa
        const words = wordsToPage(data as Parameters<typeof wordsToPage>[0], 150 / 72, 1190.55)
        const ocrRuns = runsFromOcr(words)
        const page = analyzePage({ page: 1, kind: 'taranmis', scene: null, ocrRuns })
        expect(page.textSource).toBe('ocr')
        expect(page.sheet).toBe('plan')
        expect(page.scale.title).toBe(50)
        const { candidates, diagnostics } = aggregatePdf([page], { pageCount: 1, ocrUsed: true })
        const p1 = candidates.find((c) => c.code === 'P1')
        expect(p1?.width_mm).toBe(1200)
        expect(p1?.height_mm).toBe(1500)
        expect(p1!.count).toBeGreaterThanOrEqual(2)
        expect(candidates.find((c) => c.code === 'KP1')?.width_mm).toBe(1000)
        // OCR sonuçları hiçbir zaman yüksek güvenle sunulmaz
        for (const c of candidates) {
          expect(c.reasons.join(' ')).toContain('OCR')
          expect(c.confidence).toBeLessThan(0.75)
        }
        expect(diagnostics.warnings.join(' ')).toContain('OCR')
      } finally {
        await worker.terminate()
      }
    },
    90_000,
  )
})
