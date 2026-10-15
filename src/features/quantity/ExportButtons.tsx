import { FileDown, FileSpreadsheet, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '@/context/toast'
import type { CadAnalysis, Company, Project, QuantityTakeoff } from '@/data/types'
import type { QuantityItem } from '@/quantity/types'
import { buildReport, type ReportMeta, reportFileName } from '@/export/report'
import { downloadBytes as download, loadPdfAssets } from '@/lib/download'

const SHEET_TR: Record<string, string> = { plan: 'Kat planı', gorunus: 'Görünüş', kesit: 'Kesit', cizelge: 'Doğrama çizelgesi', detay: 'Detay', vaziyet: 'Vaziyet', bilinmiyor: 'Belirlenemedi' }

/** Analiz kaydından rapor için kaynak çizim bilgisi (pafta listesi) */
export function analysisInfo(a: CadAnalysis | null | undefined): ReportMeta['analysis'] {
  if (!a) return null
  const pdf = (a.summary as { pdf?: { sayfalar?: { sayfa: number; baslik: string | null; pafta: string | null; olcek: number | null; olcek_dogrulandi?: boolean }[] } }).pdf
  return {
    fileName: a.file_name,
    fileHash: a.file_hash ?? null,
    analyzedAt: a.created_at,
    pages: (pdf?.sayfalar ?? []).map((p) => ({
      page: p.sayfa,
      title: p.baslik,
      sheet: p.pafta ? (SHEET_TR[p.pafta] ?? p.pafta) : null,
      scale: p.olcek ? `1/${p.olcek}${p.olcek_dogrulandi ? ' (doğrulandı)' : ''}` : null,
    })),
  }
}

export function reportMeta(takeoff: QuantityTakeoff, project: Project | null, company: Company | null, analysis: CadAnalysis | null = null): ReportMeta {
  return {
    analysis: analysisInfo(analysis),
    projectCode: project?.code ?? '—',
    projectName: project?.name ?? '—',
    projectLocation: project?.location ?? null,
    companyName: company?.name ?? null,
    companyPhone: company?.phone ?? null,
    companyEmail: company?.email ?? null,
    companyAddress: [company?.address, company?.city].filter(Boolean).join(', ') || null,
    takeoffName: takeoff.name,
    revision: takeoff.revision,
    status: takeoff.status,
    approvedAt: takeoff.approved_at,
    generatedAt: new Date(),
  }
}

/** Excel ve PDF dışa aktarma: ekrandakiyle aynı rapor modelinden üretilir */
export function ExportButtons({ takeoff, items, project, company, analysis = null }: { takeoff: QuantityTakeoff; items: QuantityItem[]; project: Project | null; company: Company | null; analysis?: CadAnalysis | null }) {
  const { notify } = useToast()
  const [busy, setBusy] = useState<null | 'xlsx' | 'pdf'>(null)
  const run = async (kind: 'xlsx' | 'pdf') => {
    setBusy(kind)
    try {
      const report = buildReport(items, reportMeta(takeoff, project, company, analysis))
      if (kind === 'xlsx') {
        const { reportToXlsx } = await import('@/export/quantityXlsx')
        download(reportToXlsx(report), reportFileName(report.meta, 'xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      } else {
        const [{ reportToPdf }, assets] = await Promise.all([import('@/export/quantityPdf'), loadPdfAssets()])
        download(await reportToPdf(report, assets), reportFileName(report.meta, 'pdf'), 'application/pdf')
      }
      if (report.totals.pending.items > 0) notify(`Raporda ${report.totals.pending.items} doğrulama bekleyen kalem ayrıca işaretlendi.`, 'info')
    } catch (e) {
      notify(`Dışa aktarma başarısız: ${e instanceof Error ? e.message : 'bilinmeyen hata'}`, 'error')
    } finally {
      setBusy(null)
    }
  }
  const cls = 'inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink shadow-card hover:bg-surface-2 disabled:opacity-50'
  return (
    <>
      <button type="button" className={cls} disabled={!!busy || items.length === 0} onClick={() => void run('xlsx')} data-testid="export-xlsx">
        {busy === 'xlsx' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />}
        Excel
      </button>
      <button type="button" className={cls} disabled={!!busy || items.length === 0} onClick={() => void run('pdf')} data-testid="export-pdf">
        {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileDown className="h-4 w-4" aria-hidden="true" />}
        PDF
      </button>
    </>
  )
}
