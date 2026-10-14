import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { SHEET_LABEL } from '@/cad/pdf/archAnalyze'
import type { PdfPageEntry } from '@/cad/pdf/pdfLoader'

const KIND = { vektorel: 'vektörel', taranmis: 'taranmış', karma: 'karma', bos: 'boş' } as const

export function pageTitle(e: PdfPageEntry): string {
  if (e.error) return 'okunamadı'
  if (!e.kind) return 'analiz edilmedi'
  const a = e.analysis
  const name = a?.title ?? (a && a.sheet !== 'bilinmiyor' ? SHEET_LABEL[a.sheet] : null)
  return [name, KIND[e.kind]].filter(Boolean).join(' · ')
}

/** PDF sayfa seçici (araç çubuğu): önceki/sonraki ve sayfa listesi (pafta adı + tür) */
export function PageSelect({ pages, current, busy, onChange }: { pages: PdfPageEntry[]; current: number; busy: number | null; onChange: (page: number) => void }) {
  const n = pages.length
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-testid="pdf-page-select">
      <button
        type="button"
        onClick={() => onChange(current - 1)}
        disabled={current <= 1 || busy != null}
        className="grid h-9 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40"
        aria-label="Önceki sayfa"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <label className="sr-only" htmlFor="pdf-page">
        PDF sayfası
      </label>
      <select
        id="pdf-page"
        value={current}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={busy != null}
        className="h-9 max-w-[200px] rounded-lg border border-line bg-surface px-2 text-base text-ink sm:max-w-[260px] sm:text-[12.5px]"
        title="Görüntülenen sayfa"
      >
        {pages.map((p) => (
          <option key={p.page} value={p.page}>
            {p.page}/{n} · {pageTitle(p)}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onChange(current + 1)}
        disabled={current >= n || busy != null}
        className="grid h-9 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40"
        aria-label="Sonraki sayfa"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
      {busy != null && <Loader2 className="h-4 w-4 animate-spin text-muted" aria-label={`Sayfa ${busy} yükleniyor`} />}
    </div>
  )
}
