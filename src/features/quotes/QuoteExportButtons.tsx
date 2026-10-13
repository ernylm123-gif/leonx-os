import { Eye, FileDown, FileSpreadsheet, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '@/context/toast'
import type { Company, Contact, Project } from '@/data/types'
import { downloadBytes, loadPdfAssets } from '@/lib/download'
import type { Quote, QuoteItem, QuoteSettingsInput } from '@/quote/types'

interface Props {
  quote: Quote
  items: QuoteItem[]
  customer: Company | null
  contact: Contact | null
  project: Project | null
  settings: QuoteSettingsInput
  /** Kaydedilmemiş değişiklik varsa çıktı kayıtlı hâlden üretilir; kullanıcı uyarılır */
  dirty: boolean
}

/** PDF ve Excel: kayıtlı teklif verisinden, ekrandaki hesap motoruyla üretilir */
export function QuoteExportButtons({ quote, items, customer, contact, project, settings, dirty }: Props) {
  const { notify } = useToast()
  const [busy, setBusy] = useState<null | 'pdf' | 'view' | 'xlsx'>(null)

  const run = async (kind: 'pdf' | 'view' | 'xlsx') => {
    // Önizleme penceresi kullanıcı tıklamasıyla hemen açılır (açılır pencere engelini önler)
    const win = kind === 'view' ? window.open('', '_blank') : null
    setBusy(kind)
    try {
      if (dirty) notify('Kaydedilmemiş değişiklikler çıktıya dahil değil; önce kaydedin.', 'info')
      const { buildQuoteReport, quoteFileName } = await import('@/export/quoteReport')
      const report = buildQuoteReport(quote, items, { customer, contact, project, settings })
      if (kind === 'xlsx') {
        const { quoteToXlsx } = await import('@/export/quoteXlsx')
        downloadBytes(quoteToXlsx(report), quoteFileName(quote, 'xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      } else {
        const [{ quoteToPdf }, assets] = await Promise.all([import('@/export/quotePdf'), loadPdfAssets()])
        const bytes = await quoteToPdf(report, assets)
        if (kind === 'view' && win) {
          const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
          win.location.href = url
          window.setTimeout(() => URL.revokeObjectURL(url), 120_000)
        } else {
          downloadBytes(bytes, quoteFileName(quote, 'pdf'), 'application/pdf')
        }
      }
      if (report.totals.invalidItems > 0) notify(`${report.totals.invalidItems} hatalı kalem toplama dahil edilmedi.`, 'error')
    } catch (e) {
      win?.close()
      notify(`Çıktı oluşturulamadı: ${e instanceof Error ? e.message : 'bilinmeyen hata'}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const cls = 'inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink shadow-card hover:bg-surface-2 disabled:opacity-50'
  const icon = (k: typeof busy, I: typeof FileDown) => (busy === k ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <I className="h-4 w-4" aria-hidden="true" />)
  return (
    <>
      <button type="button" className={cls} disabled={!!busy} onClick={() => void run('pdf')} data-testid="quote-pdf">
        {icon('pdf', FileDown)}
        PDF
      </button>
      <button type="button" className={cls} disabled={!!busy} onClick={() => void run('view')} data-testid="quote-pdf-view">
        {icon('view', Eye)}
        Önizle
      </button>
      <button type="button" className={cls} disabled={!!busy} onClick={() => void run('xlsx')} data-testid="quote-xlsx">
        {icon('xlsx', FileSpreadsheet)}
        Excel
      </button>
    </>
  )
}
