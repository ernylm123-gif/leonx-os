import { CheckCircle2, Download, FileWarning } from 'lucide-react'
import { useState } from 'react'
import { qualitySummary } from '@/cad/dwgService'
import { cn } from '@/lib/cn'
import type { LoadedCad } from '../useCadDocument'

function download(data: ArrayBuffer | Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * DWG'den dönüştürülen çizim: dönüşüm kalitesi (kaybolan nesneler, onarımlar, notlar) ve özgün DWG,
 * DXF ve PDF önizlemesini indirme. Sonuç "tamam" değilse uyarı rengiyle gösterilir.
 */
export function DwgConversionBar({ doc }: { doc: LoadedCad }) {
  const c = doc.conversion!
  const [open, setOpen] = useState(false)
  const { ok, lines } = qualitySummary(c.quality, c.repairedTexts)
  const base = c.originalName.replace(/\.dwg$/i, '')
  return (
    <div
      className={cn('absolute inset-x-2 top-2 z-10 rounded-lg border px-3 py-2 text-[12.5px] shadow-card', ok ? 'border-ok/30 bg-ok-soft text-ink' : 'border-warn-line bg-warn-soft text-ink')}
      data-testid="dwg-report"
      data-status={c.quality.status}
    >
      <div className="flex flex-wrap items-center gap-2">
        {ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" /> : <FileWarning className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />}
        <span className="min-w-0 flex-1">
          <b>{c.originalName}</b> ({c.release}) DXF'e dönüştürüldü — {ok ? 'kayıp tespit edilmedi' : 'dönüşüm raporunu kontrol edin'}
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)} className="rounded px-1.5 py-0.5 font-semibold underline-offset-2 hover:underline" aria-expanded={open}>
          {open ? 'Gizle' : 'Rapor'}
        </button>
        <button type="button" onClick={() => download(c.original, c.originalName, 'application/acad')} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface/60" data-testid="dwg-dl-original">
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          DWG
        </button>
        <button type="button" onClick={() => download(doc.bytes, doc.fileName, 'application/dxf')} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface/60" data-testid="dwg-dl-dxf">
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          DXF
        </button>
        {c.pdf && (
          <button type="button" onClick={() => download(c.pdf!, `${base}-onizleme.pdf`, 'application/pdf')} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface/60" data-testid="dwg-dl-pdf">
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            PDF
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-1 border-t border-current/10 pt-2" data-testid="dwg-report-detail">
          {lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
          <p className="text-muted">
            Katman {c.quality.layers.dxf}/{c.quality.layers.dwg} · blok {c.quality.blocks.dxf}/{c.quality.blocks.dwg} · layout: {c.quality.layouts.join(', ') || '—'} · birim: {c.quality.units ?? 'tanımsız'} ·
            süre {c.seconds.toLocaleString('tr-TR')} sn
          </p>
          {c.pdfPages.length > 0 && <p className="text-muted">PDF önizleme: {c.pdfPages.map((p) => `${p.name} (${p.width_mm}×${p.height_mm} mm)`).join(', ')} — ölçeksiz önizlemedir; ölçü DXF'ten alınır.</p>}
        </div>
      )}
    </div>
  )
}
