import { FileWarning, ScanText } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SHEET_LABEL } from '@/cad/pdf/archAnalyze'
import type { OpenedPdf, PdfPageEntry } from '@/cad/pdf/pdfLoader'
import { cn } from '@/lib/cn'

const KIND = { vektorel: 'vektörel', taranmis: 'taranmış', karma: 'karma', bos: 'boş' } as const

/** Küçük sayfa önizlemesi: görünür olunca düşük çözünürlükte bir kez çizilir (iPad belleği için ~120 bin piksel) */
const thumbCache = new Map<string, string>()

function Thumb({ pdf, docId, page }: { pdf: OpenedPdf; docId: string; page: number }) {
  const key = `${docId}:${page}`
  const [src, setSrc] = useState<string | null>(thumbCache.get(key) ?? null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (src || !ref.current) return
    let cancelled = false
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      void import('@/cad/pdf/pdfLoader')
        .then(({ renderPdfThumb }) => renderPdfThumb(pdf, page, 120_000))
        .then((canvas) => {
          const url = canvas.toDataURL('image/png')
          canvas.width = 0
          canvas.height = 0
          thumbCache.set(key, url)
          if (!cancelled) setSrc(url)
        })
        .catch(() => undefined)
    })
    io.observe(ref.current)
    return () => {
      cancelled = true
      io.disconnect()
    }
  }, [pdf, page, key, src])
  return (
    <div ref={ref} className="grid h-[72px] w-[100px] shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-white">
      {src ? <img src={src} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-[10px] text-subtle">S{page}</span>}
    </div>
  )
}

/**
 * Pafta listesi (mühendislik incelemesi, sol panel): önizleme, pafta adı/türü, ölçek durumu,
 * OCR gereksinimi ve sayfadaki aday sayısı. Dokununca pafta açılır.
 */
export function SheetsPanel({
  pdf,
  docId,
  pages,
  current,
  candidatesByPage,
  onOpen,
}: {
  pdf: OpenedPdf
  docId: string
  pages: PdfPageEntry[]
  current: number
  candidatesByPage: Map<number, number>
  onOpen: (page: number) => void
}) {
  return (
    <ul className="divide-y divide-line" aria-label="Paftalar" data-testid="sheets-panel">
      {pages.map((p) => {
        const a = p.analysis
        const n = candidatesByPage.get(p.page) ?? 0
        return (
          <li key={p.page}>
            <button
              type="button"
              disabled={!!p.error}
              onClick={() => onOpen(p.page)}
              className={cn('flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-surface-2 disabled:opacity-60', p.page === current && 'bg-primary/5')}
              aria-current={p.page === current ? 'page' : undefined}
              data-testid="sheet-row"
              data-page={p.page}
            >
              {p.error ? (
                <div className="grid h-[72px] w-[100px] shrink-0 place-items-center rounded-md border border-danger/30 bg-danger-soft">
                  <FileWarning className="h-5 w-5 text-danger" aria-hidden="true" />
                </div>
              ) : (
                <Thumb pdf={pdf} docId={docId} page={p.page} />
              )}
              <span className="min-w-0 flex-1 text-[12px]">
                <span className="block truncate font-semibold text-ink">
                  S{p.page} · {a?.title ?? (a ? SHEET_LABEL[a.sheet] : p.error ? 'Okunamadı' : 'Analiz edilmedi')}
                </span>
                <span className="block text-[11px] text-muted">
                  {a ? SHEET_LABEL[a.sheet] : '—'}
                  {p.kind ? ` · ${KIND[p.kind]}` : ''}
                  {a?.floor.multiplier ? ` · ${a.floor.multiplier} kat` : ''}
                </span>
                <span className="block text-[11px] text-muted">
                  {a?.scale.used ? `1/${a.scale.used} ${a.scale.verified ? '(doğrulandı)' : '(doğrulanmadı)'}` : a && p.kind !== 'bos' ? 'ölçek yok' : ''}
                </span>
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {n > 0 && <span className="rounded bg-primary/10 px-1.5 text-[10.5px] font-semibold text-ink">{n} poz</span>}
                  {a?.cardCount ? <span className="rounded bg-surface-3 px-1.5 text-[10.5px] text-ink-2">{a.cardCount} kart</span> : null}
                  {a?.ocrNeeded && !p.ocr && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-warn-soft px-1.5 text-[10.5px] text-warn">
                      <ScanText className="h-3 w-3" aria-hidden="true" />
                      OCR gerekli
                    </span>
                  )}
                  {p.ocr && <span className="rounded bg-ok-soft px-1.5 text-[10.5px] text-ok">OCR %{Math.round(p.ocr.meanConfidence * 100)}</span>}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
