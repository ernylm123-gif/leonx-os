/// <reference types="node" />
/**
 * Metraj doğruluk ölçümü.
 *
 *  1. SENTETİK fikstürler (depoda): her çalıştırmada ölçülür; eşik altına düşerse test başarısız
 *     olur. Bunlar gerçek proje doğrulaması DEĞİLDİR — yalnız bilinen biçimlerin regresyonunu korur.
 *  2. GERÇEK referans projeler: depoya EKLENMEZ (özel proje verisi). CAD_REFERANS_DIR ortam
 *     değişkeni bir klasörü gösteriyorsa, içindeki her "<ad>.pdf", "<ad>.dxf" ve "<ad>.dwg" için
 *     "<ad>.expected.json" (uzman metrajı) ile karşılaştırılır. DWG, CAD_WORKER_URL'deki dönüştürme
 *     servisiyle DXF'e çevrilir. Aynı projenin birden çok biçimi varsa biçimler ayrıca birbiriyle
 *     karşılaştırılır. Sonuçlar ekrana ve klasöre "sonuc.json" olarak yazılır.
 *     Ayrıntı: docs/CAD_REFERANS_TESTLERI.md
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { OcrEngine } from '../pdf/ocr'
import { analyzePdfFile } from '../testing/benchRun'
import { DWG_SERVICE, analyzeDwgFileBytes } from '../testing/dwgRun'
import { analyzeDxfFileBytes } from '../testing/dxfRun'
import { nodeOcrEngine } from '../testing/ocrNode'
import { PDF_FIXTURES } from '../testing/pdfNode'
import { type ExpectedPoz, type ScoredCandidate, compareFormats, formatScore, pozDiffTable, scoreCandidates } from './metrics'

interface Expected {
  sentetik?: boolean
  aciklama?: string
  pozlar: ExpectedPoz[]
}

/**
 * Beklenen metraj: belge biçimi (pozlar dizisi) veya DXF fikstür biçimi (koda göre nesne:
 * { w, h, adet, kategori, celiski }). Çelişkili alan (celiski: 'adet' | 'olcu') karşılaştırmaya
 * alınmaz — motorun o alanı kesin sunmaması beklenir.
 */
function loadExpected(file: string): Expected {
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  if (Array.isArray(raw.pozlar)) return raw as Expected
  const pozlar: ExpectedPoz[] = Object.entries<Record<string, unknown>>(raw.pozlar).map(([code, e]) => ({
    code,
    ...(e.celiski === 'olcu' ? {} : { width_mm: e.w as number, height_mm: e.h as number }),
    ...(e.celiski === 'adet' || e.adet == null ? {} : { count: e.adet as number }),
    ...(e.kategori ? { category: e.kategori as string } : {}),
  }))
  return { sentetik: true, aciklama: raw.aciklama, pozlar }
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

// DXF fikstürleri depodaki uygulama akışıyla (analyzeDxfBytes → detectDxf) ölçülür
const DXF_SYNTHETIC = ['mimari_plan_cizelge.dxf', 'cad_kagit_uzayi_cizelge.dxf', 'cad_oznitelik_bloklar.dxf']
const DXF_DIR = path.resolve('src/cad/__fixtures__')

describe('Doğruluk ölçümü — SENTETİK DXF fikstürleri (gerçek proje doğrulaması değildir)', () => {
  for (const f of DXF_SYNTHETIC) {
    it(f, () => {
      const exp = loadExpected(path.join(DXF_DIR, f.replace(/\.dxf$/i, '.expected.json')))
      const r = analyzeDxfFileBytes(new Uint8Array(readFileSync(path.join(DXF_DIR, f))))
      const score = scoreCandidates(r.candidates as ScoredCandidate[], exp.pozlar)
      console.log(formatScore(f, score, true))
      expect(score.critical).toEqual([])
      expect(score.precision).toBe(1)
      expect(score.recall).toBe(1)
      expect(score.countExact).toBe(1)
      expect(score.dimsExact).toBe(1)
      expect(pozDiffTable(r.candidates as ScoredCandidate[], exp.pozlar).every((x) => x.durum === 'dogru')).toBe(true)
    })
  }
})

type Format = 'pdf' | 'dxf' | 'dwg'
const FORMAT_RE = /\.(pdf|dxf|dwg)$/i

/** Bir referans dosyasını biçimine göre analiz eder; DWG için dönüştürme servisi gerekir */
async function analyzeAny(file: string): Promise<{ candidates: ScoredCandidate[]; ms: number; ek: Record<string, unknown> }> {
  const fmt = file.match(FORMAT_RE)![1].toLowerCase() as Format
  const t0 = Date.now()
  if (fmt === 'pdf') {
    const r = await analyzePdfFile(file, { engine })
    return { candidates: r.candidates as ScoredCandidate[], ms: Date.now() - t0, ek: { ocr: r.ocrUsed } }
  }
  const bytes = new Uint8Array(readFileSync(file))
  if (fmt === 'dxf') {
    const r = analyzeDxfFileBytes(bytes)
    return { candidates: r.candidates as ScoredCandidate[], ms: Date.now() - t0, ek: { birim: r.unitsKnown, layout: r.layouts } }
  }
  const r = await analyzeDwgFileBytes(bytes, path.basename(file))
  return { candidates: r.candidates as ScoredCandidate[], ms: Date.now() - t0, ek: { birim: r.unitsKnown, layout: r.layouts, donusum: r.conversion } }
}

const REAL = process.env.CAD_REFERANS_DIR
describe.skipIf(!REAL)('Doğruluk ölçümü — GERÇEK referans projeler (CAD_REFERANS_DIR)', () => {
  it(
    'referans klasöründeki tüm projeler',
    async () => {
      const dir = path.resolve(REAL!)
      const all = readdirSync(dir).filter((f) => FORMAT_RE.test(f))
      const pairs = all.filter((f) => existsSync(path.join(dir, f.replace(FORMAT_RE, '.expected.json'))))
      const dwgSkipped = !DWG_SERVICE ? pairs.filter((f) => /\.dwg$/i.test(f)) : []
      const files = pairs.filter((f) => !dwgSkipped.includes(f))
      if (dwgSkipped.length) console.log(`DWG atlandı (CAD_WORKER_URL yok): ${dwgSkipped.join(', ')}`)
      expect(files.length, 'Klasörde .pdf/.dxf/.dwg + .expected.json çifti yok').toBeGreaterThan(0)
      const results: (ReturnType<typeof scoreCandidates> & { dosya: string; bicim: string; sure_ms: number; ek: Record<string, unknown>; pozlar: ReturnType<typeof pozDiffTable> })[] = []
      const byProject = new Map<string, { bicim: string; candidates: ScoredCandidate[] }[]>()
      for (const f of files) {
        const exp = loadExpected(path.join(dir, f.replace(FORMAT_RE, '.expected.json')))
        const bicim = f.match(FORMAT_RE)![1].toLowerCase()
        let a: Awaited<ReturnType<typeof analyzeAny>>
        try {
          a = await analyzeAny(path.join(dir, f))
        } catch (e) {
          // Dönüştürülemeyen / okunamayan dosya ölçümden düşmez: hata olarak kaydedilir
          console.log(`[GERÇEK] ${f}: ANALİZ EDİLEMEDİ — ${(e as Error).message}`)
          a = { candidates: [], ms: 0, ek: { hata: (e as Error).message } }
        }
        const score = scoreCandidates(a.candidates, exp.pozlar)
        console.log(`${formatScore(f, score, false)}\n  süre: ${a.ms} ms · ${JSON.stringify(a.ek)}`)
        results.push({ dosya: f, bicim, sure_ms: a.ms, ek: a.ek, pozlar: pozDiffTable(a.candidates, exp.pozlar), ...score })
        const key = f.replace(FORMAT_RE, '')
        byProject.set(key, [...(byProject.get(key) ?? []), { bicim, candidates: a.candidates }])
      }
      // Aynı proje farklı biçimlerde: biçimler birbirini tutuyor mu?
      const bicimUyumu: Record<string, unknown>[] = []
      for (const [proje, list] of byProject) {
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++) {
            const c = compareFormats(list[i].candidates, list[j].candidates)
            console.log(`[BİÇİM UYUMU] ${proje}: ${list[i].bicim} ↔ ${list[j].bicim} — ortak ${c.ortak}, uyum %${(c.uyum * 100).toFixed(1)}${c.farklar.length ? ' · ' + c.farklar.join('; ') : ''}`)
            bicimUyumu.push({ proje, a: list[i].bicim, b: list[j].bicim, ...c })
          }
      }
      const sum = (k: 'tp' | 'fp' | 'fn') => results.reduce((a, x) => a + x[k], 0)
      const tp = sum('tp')
      const total = { precision: tp / Math.max(1, tp + sum('fp')), recall: tp / Math.max(1, tp + sum('fn')), kritik: results.reduce((a, x) => a + x.critical.length, 0) }
      console.log(`TOPLAM (${results.length} dosya): precision %${(total.precision * 100).toFixed(1)} · recall %${(total.recall * 100).toFixed(1)} · kritik hata ${total.kritik}`)
      writeFileSync(path.join(dir, 'sonuc.json'), JSON.stringify({ tarih: new Date().toISOString(), toplam: total, projeler: results, bicim_uyumu: bicimUyumu, dwg_atlanan: dwgSkipped }, null, 2))
      const esik = process.env.CAD_REFERANS_ESIK ? Number(process.env.CAD_REFERANS_ESIK) : null
      if (esik != null) expect(total.recall).toBeGreaterThanOrEqual(esik)
    },
    30 * 60_000,
  )
})
