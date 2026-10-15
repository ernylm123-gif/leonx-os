/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { emptyItem, type QuantityItem } from '@/quantity/types'
import { computeItem } from '@/quantity/engine'
import { explainCalc } from '@/quantity/explain'
import { reportToPdf } from './quantityPdf'
import { reportToXlsx } from './quantityXlsx'
import { buildReport, type ReportMeta } from './report'

const asset = (p: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(p, import.meta.url))))
const fonts = { regular: asset('../assets/fonts/Inter-Regular.ttf'), semibold: asset('../assets/fonts/Inter-SemiBold.ttf'), logo: null }

const base = (p: Partial<QuantityItem>): QuantityItem => ({
  ...emptyItem({ poz_code: 'P-01', category: 'pvc_pencere', width_mm: 1200, height_mm: 1500, quantity: 9 }),
  id: '00000000-0000-4000-8000-000000000001',
  takeoff_id: 't',
  project_id: 'p',
  created_by: null,
  created_at: '2026-10-15T00:00:00Z',
  updated_at: '2026-10-15T00:00:00Z',
  version: 2,
  ...p,
})

const detected = base({
  verification: 'onaylandi',
  approved_at: '2026-10-15T09:00:00Z',
  original: { poz_code: 'P-01', category: 'pvc_pencere', shape: 'dikdortgen', width_mm: 1200, height_mm: 1500, quantity: 8, unit: 'm2', verification: 'bekliyor' },
  review_note: 'Liste adedi esas alındı',
  detection: {
    confidence: 0.6,
    level: 'orta',
    reasons: [],
    evidence: [],
    suggested_category: 'pvc_pencere',
    attrs: {
      malzeme: { value: 'PVC', status: 'dogrulandi', source: 'S1 · kart P-01' },
      cam: { value: '4+16+4 ısıcam', status: 'dogrulandi', source: 'S1 · kart P-01' },
      renk: { value: 'RAL 9016', status: 'aday', source: 'genel not' },
      sistem: { value: '', status: 'belirsiz', source: 'Çizimde bulunamadı' },
    },
    conflicts: [{ kind: 'adet', message: 'Poz P-01: Plan paftalarında 8 adet, doğrama listesinde 9 adet bulunuyor.' }],
    provenance: { pages: [1, 2], sheets: ['S1 · DOĞRAMA LİSTESİ', 'S2 · NORMAL KAT PLANI'], schedule_qty: 9, plan_qty: 8 },
  },
  drawing_ref: { source: 'cizelge', file_name: 'proje.pdf', box_pages: [1, 2] },
})
const uncertain = base({ id: '00000000-0000-4000-8000-000000000002', poz_code: 'K-01', verification: 'bekliyor', uncertain: true, review_note: 'Malzeme belirsiz' })

const meta: ReportMeta = {
  projectCode: 'LX-1',
  projectName: 'İzlenebilirlik',
  projectLocation: null,
  companyName: null,
  companyPhone: null,
  companyEmail: null,
  companyAddress: null,
  takeoffName: 'Metraj',
  revision: 1,
  status: 'taslak',
  approvedAt: null,
  generatedAt: new Date('2026-10-15T10:00:00Z'),
  analysis: { fileName: 'proje.pdf', fileHash: 'a'.repeat(64), analyzedAt: '2026-10-15T08:00:00Z', pages: [{ page: 1, title: 'DOĞRAMA LİSTESİ', sheet: 'Doğrama çizelgesi', scale: '1/50 (doğrulandı)' }] },
}

describe('Metraj izlenebilirliği — rapor', () => {
  it('özellik durumu, kaynak pafta, kullanıcı düzeltmesi, onay zamanı ve belirsiz durumu raporlanır', () => {
    const r = buildReport([detected, uncertain], meta)
    const p1 = r.rows.find((x) => x.item.poz_code === 'P-01')!
    expect(p1.specs.find((s) => s.label === 'Malzeme')).toEqual({ label: 'Malzeme', value: 'PVC', status: 'dogrulandi' })
    expect(p1.specs.find((s) => s.label === 'Renk')?.status).toBe('aday')
    expect(p1.source).toContain('S2 · NORMAL KAT PLANI')
    expect(p1.corrected).toEqual(['adet 8 → 9'])
    expect(p1.approvedAt).toBe('2026-10-15T09:00:00Z')
    expect(p1.notes[0]).toBe('İnceleme notu: Liste adedi esas alındı')
    const k1 = r.rows.find((x) => x.item.poz_code === 'K-01')!
    expect(k1.verification).toBe('Belirsiz')
    // Belirsiz poz kesin toplama girmez
    expect(r.totals.verified.items).toBe(1)
    expect(r.pending.map((x) => x.item.poz_code)).toEqual(['K-01'])
  })

  it('Excel: "Özellik ve kaynak" sayfası; PDF: teknik özellikler ve kaynak çizim bölümü üretilir', async () => {
    const r = buildReport([detected, uncertain], meta)
    const files = unzipSync(reportToXlsx(r))
    const wb = strFromU8(files['xl/workbook.xml'])
    expect(wb).toContain('Özellik ve kaynak')
    const all = Object.keys(files).filter((k) => k.startsWith('xl/worksheets/')).map((k) => strFromU8(files[k])).join('') + strFromU8(files['xl/sharedStrings.xml'] ?? new Uint8Array())
    expect(all).toContain('✓ PVC')
    expect(all).toContain('? RAL 9016')
    expect(all).toContain('adet 8 → 9')
    const pdf = await reportToPdf(r, fonts)
    expect(pdf.length).toBeGreaterThan(5000)
  })

  it('hesap açıklaması: tekil/toplam alan, çevre ve profil uyarısı', () => {
    const r = computeItem(detected)
    const e = explainCalc(detected, r)
    expect(e.lines.map((l) => [l.label, l.value])).toEqual([
      ['Tekil doğrama alanı', '1,800 m²'],
      ['Toplam doğrama alanı', '16,20 m²'],
      ['Tekil çevre', '5,400 m'],
      ['Toplam çevre', '48,60 mtül'],
      ['Metraj miktarı', '16,20 m²'],
    ])
    expect(e.lines[0].formula).toBe('1,200 m × 1,500 m')
    expect(e.notes.join(' ')).toContain('profil boyu DEĞİLDİR')
  })
})
