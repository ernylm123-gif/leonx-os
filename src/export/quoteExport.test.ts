/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { Company, Contact, Project } from '@/data/types'
import { computeQuote, emptyQuoteItem } from '@/quote/engine'
import { formatMoney } from '@/quote/money'
import { DEFAULT_QUOTE_SETTINGS, type Quote, type QuoteItem, type QuoteItemInput } from '@/quote/types'
import { quoteToPdf } from './quotePdf'
import { buildQuoteReport, quoteFileName } from './quoteReport'
import { quoteToXlsx } from './quoteXlsx'

const asset = (p: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(p, import.meta.url))))
const fonts = { regular: asset('../assets/fonts/Inter-Regular.ttf'), semibold: asset('../assets/fonts/Inter-SemiBold.ttf'), logo: asset('../../public/branding/leonx-logo.png') }

const quote: Quote = {
  id: 'q1',
  root_id: 'q1',
  quote_no: 'TKL-2026-0007',
  revision: 2,
  superseded: false,
  company_id: 'c1',
  contact_id: 'k1',
  project_id: 'p1',
  title: 'Çağlayan Şişli Konutları — Güneş Bloğu alüminyum doğrama',
  scope: 'Projeye ait ısı yalıtımlı alüminyum doğramaların imalatı, camlarının takılması ve yerinde montajı.',
  status: 'gonderildi',
  quote_date: '2026-10-13',
  valid_until: '2026-10-28',
  currency: 'TRY',
  pricing_mode: 'detayli',
  lump_sum: null,
  lump_cost: null,
  waste_pct: 5,
  overhead_pct: 10,
  profit_pct: 20,
  shipping_amount: 7500,
  other_amount: 0,
  other_label: null,
  discount_kind: 'yuzde',
  discount_value: 5,
  vat_pct: 20,
  hide_unit_prices: false,
  payment_terms: '%50 sipariş ile peşin, %50 teslimde.',
  delivery_terms: 'Sipariş ve ölçü onayından itibaren 30 iş günü.',
  notes: 'Fiyatlara montaj dahildir; iskele ve vinç hariçtir.',
  internal_notes: 'İÇ NOT — PDFE YAZILMAMALI',
  sent_at: null,
  decided_at: null,
  created_by: null,
  created_at: '2026-10-13T08:00:00Z',
  updated_at: '2026-10-13T08:00:00Z',
  version: 3,
}
let n = 0
const item = (o: Partial<QuoteItemInput>): QuoteItem => ({
  ...emptyQuoteItem(n),
  description: 'Isı yalıtımlı alüminyum pencere',
  id: `i${++n}`,
  quote_id: 'q1',
  created_by: null,
  created_at: `2026-10-13T08:00:${String(n % 60).padStart(2, '0')}Z`,
  updated_at: '',
  version: 1,
  ...o,
})
const items = [
  item({ poz_code: 'P1', unit: 'm2', width_mm: 1500, height_mm: 2000, quantity: 4, material_cost: 2400, labor_cost: 300, install_cost: 250 }),
  item({ poz_code: 'P2', unit: 'm2', width_mm: 900, height_mm: 1200, quantity: 6, unit_price: 3950.5, measure_verified: false, source: 'metraj', source_label: 'Metraj Rev 1 · P2' }),
  item({ poz_code: 'K1', unit: 'mtul', width_mm: 12_400, quantity: 1, description: 'Temperli cam korkuluk, ğüşiöç İĞÜŞÖÇ', unit_price: 2100 }),
  item({ poz_code: 'M1', unit: 'goturu', quantity: 1, description: 'Söküm ve moloz toplama', unit_price: 12_000 }),
]
const ctx = {
  customer: { id: 'c1', name: 'Örnek İnşaat Ltd. Şti.', phone: '+90 212 000 00 00', email: 'bilgi@ornek.example', address: 'Büyükdere Cad. No: 1', city: 'İstanbul', tax_office: 'Şişli', tax_number: '1234567890', notes: null, created_by: null, created_at: '', updated_at: '', version: 1 } as Company,
  contact: { id: 'k1', company_id: 'c1', full_name: 'Ayşe Gül Öztürk', title: 'Satın alma', phone: null, email: null, is_primary: true, notes: null, created_by: null, created_at: '', updated_at: '', version: 1 } as Contact,
  project: { id: 'p1', code: 'LX-2026-014', name: 'Güneş Bloğu', location: 'Şişli, İstanbul' } as Project,
  settings: { ...DEFAULT_QUOTE_SETTINGS, legal_name: 'LEONX METAL', address: 'Test adresi', iban: 'TR000000000000000000000000', bank_name: 'Örnek Banka', closing_text: 'Saygılarımızla.' },
  generatedAt: new Date('2026-10-13T10:00:00Z'),
}

async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent()
    pages.push((tc.items as { str?: string }[]).map((x) => x.str ?? '').join(' '))
  }
  return pages
}
const norm = (s: string) => s.replace(/[  ]/g, ' ')

describe('teklif rapor modeli', () => {
  it('toplamlar ekran motoruyla aynı; satır sırası korunur', () => {
    const r = buildQuoteReport(quote, [...items].reverse(), ctx)
    const t = computeQuote(quote, items)
    expect(r.totals.grandTotal).toBe(t.grandTotal)
    expect(r.rows.map((x) => x.poz)).toEqual(['P1', 'P2', 'K1', 'M1'])
    expect(r.rows.reduce((s, x) => s + x.lineTotal, 0)).toBe(t.itemsTotal)
    expect(r.totalLines.at(-1)).toMatchObject({ label: 'GENEL TOPLAM', value: formatMoney(t.grandTotal, 'TRY'), strong: true })
    expect(quoteFileName(quote, 'pdf')).toMatch(/^TKL-2026-0007-Rev2-Caglayan-Sisli-Konutlari/)
  })
})

describe('teklif PDF', () => {
  it('kurumsal içerik, Türkçe karakterler, toplamlar, şartlar; iç not yazılmaz', async () => {
    const r = buildQuoteReport(quote, items, ctx)
    const pages = await pdfPages(await quoteToPdf(r, fonts))
    const all = norm(pages.join('\n'))
    expect(all).toContain('FİYAT TEKLİFİ')
    expect(all).toContain('TKL-2026-0007 · Rev 2')
    expect(all).toContain('Örnek İnşaat Ltd. Şti.')
    expect(all).toContain('Ayşe Gül Öztürk')
    expect(all).toContain('ğüşiöç İĞÜŞÖÇ')
    expect(all).toContain(norm(formatMoney(r.totals.grandTotal, 'TRY')))
    expect(all).toContain(norm(formatMoney(r.totals.vat, 'TRY')))
    expect(all).toContain(norm(formatMoney(r.totals.discount, 'TRY')))
    expect(all).toContain('Ödeme şartları')
    expect(all).toContain('%50 sipariş ile peşin')
    expect(all).toContain('IBAN: TR00')
    expect(all).toContain('Ölçü doğrulanmadı')
    expect(all).toContain('Müşteri onayı')
    expect(all).toContain('Saygılarımızla.')
    expect(all).not.toContain('İÇ NOT')
    expect(all).not.toContain('ESKİ REVİZYON')
    expect(all).toMatch(/Sayfa 1 \/ \d+/)
  })

  it('birim fiyat gizlenince fiyat sütunları yok, genel toplam var', async () => {
    const r = buildQuoteReport({ ...quote, hide_unit_prices: true }, items, ctx)
    const all = norm((await pdfPages(await quoteToPdf(r, fonts))).join('\n'))
    expect(all).not.toContain('Birim fiyat')
    expect(all).not.toContain(norm(formatMoney(r.rows[3].unitPrice, 'TRY')))
    expect(all).toContain(norm(formatMoney(r.totals.grandTotal, 'TRY')))
  })

  it('120 kalem: sayfalara bölünür, başlık tekrar eder, uzun açıklama kesilmez; EUR', async () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      item({
        poz_code: `P${i + 1}`,
        unit: 'm2',
        width_mm: 1000 + i,
        height_mm: 1500,
        quantity: 2,
        unit_price: 410.25,
        description: i % 9 === 0 ? 'Çok uzun açıklama: ısıcamlı, low-e kaplamalı, temperli güvenlik camı ile üretilecek, ısı yalıtımlı sürme doğrama sistemi ve tüm aksesuarları SONKELIME' : 'Pencere',
      }),
    )
    const r = buildQuoteReport({ ...quote, currency: 'EUR', superseded: true }, many, ctx)
    const pages = (await pdfPages(await quoteToPdf(r, fonts))).map(norm)
    expect(pages.length).toBeGreaterThan(2)
    const tablePages = pages.filter((p) => p.includes('P60') || p.includes('P119'))
    expect(tablePages.every((p) => p.includes('Açıklama') && p.includes('Tutar'))).toBe(true)
    expect(pages.join(' ')).toContain('P120')
    expect(pages.join(' ')).toContain('SONKELIME')
    expect(pages.join(' ')).toContain(norm(formatMoney(r.totals.grandTotal, 'EUR')))
    expect(pages.join(' ')).toContain('ESKİ REVİZYON')
    pages.forEach((p, i) => expect(p).toContain(`Sayfa ${i + 1} / ${pages.length}`))
  })

  it('toplam bedelli teklif: kalemler fiyatsız, bedel toplamda', async () => {
    const r = buildQuoteReport({ ...quote, pricing_mode: 'toplam', lump_sum: 250_000, discount_kind: 'yok' }, items, ctx)
    const all = norm((await pdfPages(await quoteToPdf(r, fonts))).join('\n'))
    expect(all).toContain('Teklif bedeli')
    expect(all).toContain(norm(formatMoney(25_000_000, 'TRY')))
    expect(all).not.toContain('Birim fiyat')
  })
})

describe('teklif Excel', () => {
  const sheet = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml'])

  it('kalemler sayısal, satır toplamları ve genel toplam ekranla aynı', () => {
    const r = buildQuoteReport(quote, items, ctx)
    const xml = sheet(quoteToXlsx(r))
    expect(xml).toContain('Örnek İnşaat Ltd. Şti.')
    expect(xml).toContain('Birim fiyat')
    expect(xml).toContain(`<v>${r.totals.grandTotal / 100}</v>`)
    for (const row of r.rows) expect(xml).toContain(`<v>${row.lineTotal / 100}</v>`)
    expect(xml).toContain('Doğrulanmadı')
    expect(xml).not.toContain('İÇ NOT')
  })

  it('birim fiyat gizleme Excel’de de uygulanır', () => {
    const xml = sheet(quoteToXlsx(buildQuoteReport({ ...quote, hide_unit_prices: true }, items, ctx)))
    expect(xml).not.toContain('Birim fiyat')
  })

  it.skipIf(!!process.env.VERCEL)('openpyxl ile bağımsız okuma (Python varsa)', () => {
    const r = buildQuoteReport(quote, items, ctx)
    const dir = mkdtempSync(join(tmpdir(), 'leonx-quote-'))
    const path = join(dir, 't.xlsx')
    writeFileSync(path, quoteToXlsx(r))
    let out: string
    try {
      out = execFileSync(
        'python3',
        ['-c', `import openpyxl,sys\nws=openpyxl.load_workbook(sys.argv[1])['Teklif']\nvals=[c.value for row in ws.iter_rows() for c in row]\ni=vals.index('GENEL TOPLAM')\nprint(vals[i+1])\nprint(sum(v for v in [ws.cell(row=r,column=10).value for r in range(12, 12+${r.rows.length})] if isinstance(v,(int,float))))`, path],
        { encoding: 'utf-8' },
      )
    } catch {
      console.info('openpyxl bulunamadı; bağımsız Excel okuma testi atlandı')
      return
    }
    const [grand, linesSum] = out.trim().split('\n').map(Number)
    expect(Math.round(grand * 100)).toBe(r.totals.grandTotal)
    expect(Math.round(linesSum * 100)).toBe(r.totals.itemsTotal)
  }, 30_000)
})
