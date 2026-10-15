/// <reference types="node" />
/**
 * Metraj doğruluk ölçümü.
 *
 *  1. SENTETİK fikstürler (depoda): her çalıştırmada ölçülür; eşik altına düşerse test başarısız
 *     olur. Bunlar gerçek proje doğrulaması DEĞİLDİR — yalnız bilinen biçimlerin regresyonunu korur.
 *  2. GERÇEK referans projeler: depoya EKLENMEZ (özel proje verisi). CAD_REFERANS_DIR ortam
 *     değişkeni bir klasörü gösteriyorsa, içindeki her "<ad>.pdf" için "<ad>.expected.json"
 *     (uzman metrajı) ile karşılaştırılır; sonuçlar ekrana ve klasöre "sonuc.json" olarak yazılır.
 *     Ayrıntı: docs/CAD_REFERANS_TESTLERI.md
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { OcrEngine } from '../pdf/ocr'
import { analyzePdfFile } from '../testing/benchRun'
import { nodeOcrEngine } from '../testing/ocrNode'
import { PDF_FIXTURES } from '../testing/pdfNode'
import { type ExpectedPoz, formatScore, scoreCandidates } from './metrics'

interface Expected {
  sentetik?: boolean
  aciklama?: string
  pozlar: ExpectedPoz[]
}

let engine: OcrEngine
let terminate: () => Promise<void>
beforeAll(async () => {
  ;({ engine, terminate } = await nodeOcrEngine())
}, 60_000)
afterAll(async () => {
  await terminate?.()
})

async function measure(file: string) {
  const exp = JSON.parse(readFileSync(file.replace(/\.pdf$/i, '.expected.json'), 'utf8')) as Expected
  const t0 = Date.now()
  const r = await analyzePdfFile(file, { engine })
  const score = scoreCandidates(r.candidates, exp.pozlar)
  return { exp, score, ms: Date.now() - t0, r }
}

const SYNTHETIC: { file: string; min: { precision: number; recall: number; countExact: number; dimsExact: number } }[] = [
  { file: 'mimari_cok_sayfali.pdf', min: { precision: 1, recall: 1, countExact: 1, dimsExact: 1 } },
  { file: 'plan_olceksiz_tekrar.pdf', min: { precision: 1, recall: 1, countExact: 1, dimsExact: 1 } },
  { file: 'dograma_listesi_kart.pdf', min: { precision: 1, recall: 1, countExact: 1, dimsExact: 1 } },
  { file: 'karma_cizelge_raster.pdf', min: { precision: 1, recall: 1, countExact: 1, dimsExact: 1 } },
  // K1 etiketi kapı yayıyla kesişiyor (OCR ölçüyü okuyamaz) — bilinen sınır
  { file: 'autocad_shx_plan.pdf', min: { precision: 1, recall: 1, countExact: 1, dimsExact: 0.75 } },
]

describe('Doğruluk ölçümü — SENTETİK fikstürler (gerçek proje doğrulaması değildir)', () => {
  for (const s of SYNTHETIC) {
    it(
      s.file,
      async () => {
        const { exp, score, ms } = await measure(path.join(PDF_FIXTURES, s.file))
        expect(exp.sentetik).toBe(true)
        console.log(`${formatScore(s.file, score, true)}\n  süre: ${ms} ms`)
        expect(score.critical).toEqual([])
        expect(score.precision).toBeGreaterThanOrEqual(s.min.precision)
        expect(score.recall).toBeGreaterThanOrEqual(s.min.recall)
        expect(score.countExact).toBeGreaterThanOrEqual(s.min.countExact)
        expect(score.dimsExact).toBeGreaterThanOrEqual(s.min.dimsExact)
      },
      120_000,
    )
  }
})

const REAL = process.env.CAD_REFERANS_DIR
describe.skipIf(!REAL)('Doğruluk ölçümü — GERÇEK referans projeler (CAD_REFERANS_DIR)', () => {
  it(
    'referans klasöründeki tüm projeler',
    async () => {
      const dir = path.resolve(REAL!)
      const files = readdirSync(dir).filter((f) => /\.pdf$/i.test(f) && existsSync(path.join(dir, f.replace(/\.pdf$/i, '.expected.json'))))
      expect(files.length, 'Klasörde .pdf + .expected.json çifti yok').toBeGreaterThan(0)
      const results: (ReturnType<typeof scoreCandidates> & { dosya: string; sure_ms: number; ocr: boolean })[] = []
      for (const f of files) {
        const { score, ms, r } = await measure(path.join(dir, f))
        console.log(`${formatScore(f, score, false)}\n  süre: ${ms} ms · OCR: ${r.ocrUsed ? 'evet' : 'hayır'}`)
        results.push({ dosya: f, sure_ms: ms, ocr: r.ocrUsed, ...score })
      }
      const sum = (k: 'tp' | 'fp' | 'fn') => results.reduce((a, x) => a + x[k], 0)
      const tp = sum('tp')
      const total = { precision: tp / Math.max(1, tp + sum('fp')), recall: tp / Math.max(1, tp + sum('fn')), kritik: results.reduce((a, x) => a + x.critical.length, 0) }
      console.log(`TOPLAM (${results.length} proje): precision %${(total.precision * 100).toFixed(1)} · recall %${(total.recall * 100).toFixed(1)} · kritik hata ${total.kritik}`)
      writeFileSync(path.join(dir, 'sonuc.json'), JSON.stringify({ tarih: new Date().toISOString(), toplam: total, projeler: results }, null, 2))
      const esik = process.env.CAD_REFERANS_ESIK ? Number(process.env.CAD_REFERANS_ESIK) : null
      if (esik != null) expect(total.recall).toBeGreaterThanOrEqual(esik)
    },
    30 * 60_000,
  )
})
