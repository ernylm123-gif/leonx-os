/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { summarize } from '@/quantity/engine'
import { formatCenti } from '@/quantity/precision'
import { emptyItem, type QuantityItem, type QuantityItemInput } from '@/quantity/types'
import { reportToPdf } from './quantityPdf'
import { reportToXlsx } from './quantityXlsx'
import { buildReport, type ReportMeta } from './report'
import { safeSheetName } from './xlsx'

const asset = (p: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(p, import.meta.url))))
const fonts = { regular: asset('../assets/fonts/Inter-Regular.ttf'), semibold: asset('../assets/fonts/Inter-SemiBold.ttf'), logo: asset('../../public/branding/leonx-logo.png') }

let n = 0
const it_ = (p: Partial<QuantityItemInput>): QuantityItem => ({
  ...emptyItem({ poz_code: `P${++n}`, category: 'pvc_pencere', width_mm: 1200, height_mm: 1500, quantity: 3, ...p }),
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  takeoff_id: 't',
  project_id: 'p',
  created_by: null,
  created_at: '2026-10-13T00:00:00Z',
  updated_at: '2026-10-13T00:00:00Z',
  version: 1,
})

const meta: ReportMeta = {
  projectCode: 'LX-2026-001',
  projectName: 'Çağlayan Şişli Konut — Güneş Bloğu',
  projectLocation: 'İstanbul / Şişli',
  companyName: 'Örnek İnşaat Ltd. Şti.',
  companyPhone: '0212 000 00 00',
  companyEmail: 'bilgi@ornek.test',
  companyAddress: 'Büyükdere Cad. No: 1, İstanbul',
  takeoffName: 'İhale metrajı',
  revision: 2,
  status: 'taslak',
  approvedAt: null,
  generatedAt: new Date('2026-10-13T10:00:00Z'),
}

const items = [
  it_({ poz_code: 'P1', quantity: 3 }),
  it_({ poz_code: 'P2', width_mm: 1235.5, height_mm: 1499.5, quantity: 7, floor: 'Zemin', space: 'Salon' }),
  it_({ poz_code: 'K1', category: 'al_kapi', width_mm: 900, height_mm: 2100, quantity: 2, description: 'Çift kanatlı, ışıklıklı giriş kapısı' }),
  it_({ poz_code: 'KR1', category: 'korkuluk', width_mm: 12345, quantity: 2 }),
  it_({ poz_code: 'D1', verification: 'bekliyor', detection: { confidence: 0.4, level: 'dusuk', reasons: ['Malzeme belirlenemedi'], evidence: [], suggested_category: 'belirsiz' } }),
  it_({ poz_code: 'BOZUK', width_mm: null, verification: 'bekliyor' }),
  it_({ poz_code: 'RED', verification: 'reddedildi' }),
]

function xlsxSheets(bytes: Uint8Array) {
  const files = unzipSync(bytes)
  const read = (p: string) => strFromU8(files[p])
  return { files, read }
}

/** Sayfa XML'inden "A1" → değer haritası */
function cellsOf(xml: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>/]*(?:\/>|>(.*?)<\/c>)/g)) {
    const inner = m[2] ?? ''
    const v = /<v>(.*?)<\/v>/.exec(inner)?.[1] ?? /<t[^>]*>(.*?)<\/t>/.exec(inner)?.[1]
    if (v !== undefined) map.set(m[1], v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
  }
  return map
}

describe('Excel raporu', () => {
  const report = buildReport(items, meta)
  const bytes = reportToXlsx(report)
  const { files, read } = xlsxSheets(bytes)

  it('geçerli paket: içerik türleri, çalışma kitabı, 3 sayfa', () => {
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml']))
    expect(read('xl/workbook.xml')).toContain('name="Özet"')
    expect(read('xl/workbook.xml')).toContain('name="Doğrulanmamış"')
  })

  it('poz satırlarının sayısal toplamı = onaylı toplam satırı = ekrandaki toplam', () => {
    const cells = cellsOf(read('xl/worksheets/sheet2.xml'))
    const totals = summarize(items)
    // L sütunu: doğrama m² (satırlar 2..n+1), toplam satırı n+2
    let sumVerified = 0
    report.rows.forEach((r, i) => {
      const v = cells.get(`L${i + 2}`)
      // Doğrusal (mtül) kalemlerde doğrama alanı hücresi boştur
      if (r.result.counted) sumVerified += Math.round(Number(v ?? 0) * 100)
    })
    expect(sumVerified).toBe(totals.verified.frameArea)
    expect(Math.round(Number(cells.get(`L${report.rows.length + 2}`)) * 100)).toBe(totals.verified.frameArea)
    expect(cells.get(`B${report.rows.length + 2}`)).toBe('ONAYLI TOPLAM')
  })

  it('Türkçe metin ve doğrulama durumları korunur', () => {
    const summaryCells = cellsOf(read('xl/worksheets/sheet1.xml'))
    expect([...summaryCells.values()]).toContain('Çağlayan Şişli Konut — Güneş Bloğu')
    expect([...summaryCells.values()].some((v) => v.includes('taslak durumundadır'))).toBe(true)
    const unv = [...cellsOf(read('xl/worksheets/sheet3.xml')).values()]
    expect(unv).toContain('D1')
    expect(unv).toContain('BOZUK')
    expect(unv).not.toContain('P1')
  })

  it('sayfa adı kuralları', () => {
    const used = new Set<string>()
    expect(safeSheetName('A/B:C*?', used)).toBe('A B C')
    expect(safeSheetName('a b c', used)).toBe('a b c (2)')
    expect(safeSheetName('x'.repeat(40), used).length).toBe(31)
  })

  it('openpyxl ile bağımsız okuma (Python varsa)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'leonx-xlsx-'))
    const path = join(dir, 'r.xlsx')
    writeFileSync(path, bytes)
    let out: string
    try {
      out = execFileSync('python3', ['-c', `import openpyxl,sys\nwb=openpyxl.load_workbook(sys.argv[1])\nws=wb['Pozlar']\nprint(ws.cell(row=ws.max_row,column=12).value)\nprint(wb.sheetnames)`, path], { encoding: 'utf-8' })
    } catch {
      console.info('openpyxl bulunamadı; bağımsız Excel okuma testi atlandı')
      return
    }
    const [total, names] = out.trim().split('\n')
    expect(Math.round(Number(total) * 100)).toBe(summarize(items).verified.frameArea)
    expect(names).toContain('Doğrulanmamış')
  })
})

describe('PDF raporu', () => {
  async function pdfText(bytes: Uint8Array): Promise<{ pages: string[] }> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent()
      pages.push((tc.items as { str?: string }[]).map((x) => x.str ?? '').join(' '))
    }
    return { pages }
  }

  it('toplamlar ekranla aynı, Türkçe karakterler doğru, doğrulanmamışlar işaretli', async () => {
    const report = buildReport(items, meta)
    const bytes = await reportToPdf(report, fonts)
    const { pages } = await pdfText(bytes)
    const all = pages.join('\n')
    const t = summarize(items)
    expect(all).toContain(`${formatCenti(t.verified.frameArea)} m²`)
    expect(all).toContain('Çağlayan Şişli Konut — Güneş Bloğu')
    expect(all).toContain('Örnek İnşaat Ltd. Şti.')
    expect(all).toContain('Doğrulanmamış pozlar')
    expect(all).toContain('DAHİL EDİLMEMİŞTİR')
    expect(all).toContain('BOZUK')
    expect(all).toMatch(/Sayfa 1 \/ \d+/)
  })

  it('300 poz: tablo sayfalara bölünür, başlık her sayfada tekrar eder, metin kesilmez', async () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      it_({ poz_code: `P${i + 1}`, description: i % 7 === 0 ? 'Çok uzun açıklama: ısıcamlı, low-e kaplamalı, temperli güvenlik camı ile üretilecek sürme doğrama sistemi' : null }),
    )
    const report = buildReport(many, { ...meta, status: 'onaylandi', approvedAt: '2026-10-13T09:00:00Z' })
    const bytes = await reportToPdf(report, fonts)
    const { pages } = await pdfText(bytes)
    expect(pages.length).toBeGreaterThan(5)
    const tablePages = pages.filter((p) => p.includes('P150') || p.includes('P299'))
    expect(tablePages.every((p) => p.includes('Şekil · Ölçü (mm)'))).toBe(true)
    // Son poz ve toplam satırı mevcut
    expect(pages.join(' ')).toContain('P300')
    expect(pages.join(' ')).toContain(`${formatCenti(summarize(many).verified.frameArea)} m²`)
    // Sayfa numarası her sayfada
    pages.forEach((p, i) => expect(p).toContain(`Sayfa ${i + 1} / ${pages.length}`))
    // Onaylı sürümde TASLAK filigranı yok
    expect(pages.join(' ')).not.toContain('TASLAK — ONAYLANMAMIŞ')
  })

  it('pypdf ile bağımsız okuma (Python varsa)', async () => {
    const bytes = await reportToPdf(buildReport(items, meta), fonts)
    const dir = mkdtempSync(join(tmpdir(), 'leonx-pdf-'))
    const path = join(dir, 'r.pdf')
    writeFileSync(path, bytes)
    let out: string
    try {
      out = execFileSync('python3', ['-c', `import pypdf,sys\nr=pypdf.PdfReader(sys.argv[1])\nprint(len(r.pages))\nprint(r.pages[0].extract_text())`, path], { encoding: 'utf-8' })
    } catch {
      console.info('pypdf bulunamadı; bağımsız PDF okuma testi atlandı')
      return
    }
    expect(out).toContain('METRAJ RAPORU')
    expect(out).toContain('Şişli')
  })
})
