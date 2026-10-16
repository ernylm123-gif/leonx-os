/// <reference types="node" />
/**
 * Reçete Excel/PDF çıktıları. Test verisi SENTETİKTİR (gerçek üretici kodu, ölçüsü veya fiyatı değildir).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { calculateBom, type EngineSystem, fromStoredLine, toPayload } from '@/bom/engine'
import type { BomAssignment } from '@/bom/types'
import { bomToPdf } from './bomPdf'
import { type BomReportMeta, buildBomReport } from './bomReport'
import { bomToXlsx } from './bomXlsx'

const asset = (p: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(p, import.meta.url))))
const fonts = { regular: asset('../assets/fonts/Inter-Regular.ttf'), semibold: asset('../assets/fonts/Inter-SemiBold.ttf'), logo: asset('../../public/branding/leonx-logo.png') }

const SYS: EngineSystem = {
  id: 's',
  name: 'SENTETİK TEST SİSTEMİ',
  active: true,
  components: [
    {
      id: 'c1', role: 'kasa', code: 'SENT-KASA', name: 'Sentetik kasa profili', unit: 'mm_profil', standard_length_mm: 6000, waste_pct: 5, weight_kg_per_m: null, cost_rate_id: 'r1', sort_order: 1,
      rules: [
        { id: 'r-a', applies_to: null, basis: 'birim', quantity_formula: null, cut_length_formula: 'W', pieces_formula: '2', angle: '45', sort_order: 1 },
        { id: 'r-b', applies_to: null, basis: 'birim', quantity_formula: null, cut_length_formula: 'H', pieces_formula: '2', angle: '45', sort_order: 2 },
      ],
    },
    { id: 'c2', role: 'cam', code: null, name: 'Sentetik ısıcam', unit: 'm2', standard_length_mm: null, waste_pct: 0, weight_kg_per_m: null, cost_rate_id: null, sort_order: 2, rules: [{ id: 'r-c', applies_to: null, basis: 'birim', quantity_formula: '(W-120)*(H-120)/1000000', cut_length_formula: null, pieces_formula: null, angle: null, sort_order: 1 }] },
  ],
}
const item = { id: 'i1', poz_code: 'P1', category: 'al_pencere', width_mm: 1200, height_mm: 1500, quantity: 4, verification: 'onaylandi' as const }
const assignments = [{ item, system_id: 's', kanat: null, opening: null }]
const calc = calculateBom({ assignments, systems: [SYS], rates: [{ id: 'r1', code: 'SENT-KASA-M', unit: 'm', currency: 'TRY', unit_cost: 100, active: true, valid_from: '2026-01-01' }], today: '2026-10-16', takeoffApproved: true })
const payload = toPayload(calc, assignments)
const lines = payload.lines.map((l) => fromStoredLine({ ...l, assignment_id: 'a1', poz_code: 'P1' }))
const stored: BomAssignment[] = [{ id: 'a1', bom_version_id: 'v', quantity_item_id: 'i1', poz_code: 'P1', category: 'al_pencere', width_mm: 1200, height_mm: 1500, quantity: 4, verification: 'onaylandi', kanat: null, opening: 'Çift açılım', system_id: 's', system_name: 'SENTETİK TEST SİSTEMİ', sort_order: 0 }]
const meta = (p: Partial<BomReportMeta> = {}): BomReportMeta => ({
  projectCode: 'LX-2026-901',
  projectName: 'Çağlayan Şişli — Güneş Bloğu',
  companyName: 'Örnek İnşaat Ltd. Şti.',
  revision: 3,
  status: 'onayli',
  sourceApproved: true,
  takeoffRevision: 2,
  takeoffName: 'Uygulama metrajı',
  takeoffStatus: 'onaylandi',
  createdAt: '2026-10-16T08:00:00Z',
  approvedAt: '2026-10-16T09:00:00Z',
  notes: null,
  generatedAt: new Date('2026-10-16T10:00:00Z'),
  ...p,
})

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent()
    pages.push((tc.items as { str?: string }[]).map((x) => x.str ?? '').join(' '))
  }
  return pages.join('\n')
}

describe('reçete Excel', () => {
  it('5 sayfa; toplam, kesim listesi ve fiyatsız satır ekranla aynı', () => {
    const files = unzipSync(bomToXlsx(buildBomReport(meta(), stored, lines, calc.warnings)))
    const wb = strFromU8(files['xl/workbook.xml'])
    for (const n of ['Özet', 'Satırlar', 'Kesim listesi', 'Pozlar', 'Uyarılar']) expect(wb).toContain(`name="${n}"`)
    const sheets = Object.keys(files).filter((k) => k.startsWith('xl/worksheets/sheet')).sort()
    const summary = strFromU8(files[sheets[0]])
    expect(summary).toContain('MALZEME REÇETESİ')
    expect(summary).toContain('<v>22.68</v>') // kasa fire dahil 22,680 m
    expect(summary).toContain('<v>4</v>') // tahmini boy adedi
    expect(summary).toContain('fiyat tanımlı değil') // cam: fiyat yok, uydurulmaz
    const cut = strFromU8(files[sheets[2]])
    expect(cut).toContain('<v>1500</v>')
    expect(cut).toContain('<v>1200</v>')
    expect(cut).toContain('<v>8</v>')
  })
})

describe('reçete PDF', () => {
  it('onaylı: başlık, toplamlar, kesim listesi, Türkçe metin; TASLAK filigranı yok', async () => {
    const text = await pdfText(await bomToPdf(buildBomReport(meta(), stored, lines, calc.warnings), fonts))
    expect(text).toContain('MALZEME REÇETESİ')
    expect(text).toContain('Çağlayan Şişli — Güneş Bloğu')
    expect(text).toContain('Profil kesim listesi')
    expect(text).toContain('22,680')
    expect(text).toContain('2.268,00')
    expect(text).toContain('fiyat tanımlı değil')
    expect(text).toContain('Çift açılım')
    expect(text).not.toContain('TASLAK — ONAYLANMA')
  })
  it('onaysız metrajdan taslak: açık uyarı ve filigran', async () => {
    const text = await pdfText(await bomToPdf(buildBomReport(meta({ status: 'taslak', sourceApproved: false, approvedAt: null, takeoffStatus: 'taslak' }), stored, lines, calc.warnings), fonts))
    expect(text).toContain('TASLAK — onaysız metrajdan; onaylanamaz')
    expect(text).toContain('TASLAK — ONAYLANMA') // filigran (metin parçalı okunabilir)
  })
})
