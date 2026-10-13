import { FileDown, FileSpreadsheet, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '@/context/toast'
import type { Company, Project, QuantityTakeoff } from '@/data/types'
import type { QuantityItem } from '@/quantity/types'
import { buildReport, type ReportMeta, reportFileName } from '@/export/report'

export function reportMeta(takeoff: QuantityTakeoff, project: Project | null, company: Company | null): ReportMeta {
  return {
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

function download(bytes: Uint8Array, name: string, type: string) {
  const blob = new Blob([bytes as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} yüklenemedi`)
  return new Uint8Array(await res.arrayBuffer())
}

/** Excel ve PDF dışa aktarma: ekrandakiyle aynı rapor modelinden üretilir */
export function ExportButtons({ takeoff, items, project, company }: { takeoff: QuantityTakeoff; items: QuantityItem[]; project: Project | null; company: Company | null }) {
  const { notify } = useToast()
  const [busy, setBusy] = useState<null | 'xlsx' | 'pdf'>(null)
  const run = async (kind: 'xlsx' | 'pdf') => {
    setBusy(kind)
    try {
      const report = buildReport(items, reportMeta(takeoff, project, company))
      if (kind === 'xlsx') {
        const { reportToXlsx } = await import('@/export/quantityXlsx')
        download(reportToXlsx(report), reportFileName(report.meta, 'xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      } else {
        const [{ reportToPdf }, reg, semi] = await Promise.all([
          import('@/export/quantityPdf'),
          import('@/assets/fonts/Inter-Regular.ttf?url'),
          import('@/assets/fonts/Inter-SemiBold.ttf?url'),
        ])
        const [regular, semibold, logo] = await Promise.all([fetchBytes(reg.default), fetchBytes(semi.default), fetchBytes('/branding/leonx-logo.png').catch(() => null)])
        download(await reportToPdf(report, { regular, semibold, logo }), reportFileName(report.meta, 'pdf'), 'application/pdf')
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
