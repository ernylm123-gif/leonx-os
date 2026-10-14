import { AlertTriangle, CheckCircle2, ChevronDown, Eye, Info, Loader2, ScanText, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { SHEET_LABEL } from '@/cad/pdf/archAnalyze'
import type { PdfPageEntry } from '@/cad/pdf/pdfLoader'
import { cn } from '@/lib/cn'
import type { DetectionResult } from '@/quantity/detect'
import { pageTitle } from '../workspace/PageSelect'
import { MiniButton } from '../workspace/ui'

const KIND = { vektorel: 'Vektörel', taranmis: 'Taranmış', karma: 'Karma', bos: 'Boş' } as const

export interface PdfRunProgress {
  stage: string
  fraction: number
}

/**
 * PDF analiz denetimleri: dosya okuma özeti, sayfa seçimi, OCR, çalıştır/iptal ve tanılama.
 * Sonuç çıkmazsa nedenleri, okunan yazıları ve elle ölçüm seçeneklerini gösterir — boş ekran yok.
 */
export function PdfAnalysisControls({
  pages,
  currentPage,
  selected,
  onSelectedChange,
  ocr,
  onOcrChange,
  detection,
  analyzedAt,
  running,
  progress,
  onRun,
  onCancel,
  onGoPage,
  onCalibrate,
  onConfirmScale,
}: {
  pages: PdfPageEntry[]
  currentPage: number
  selected: Set<number>
  onSelectedChange: (s: Set<number>) => void
  ocr: boolean
  onOcrChange: (v: boolean) => void
  detection: DetectionResult | null
  analyzedAt: Date | null
  running: boolean
  progress: PdfRunProgress | null
  onRun: () => void
  onCancel: () => void
  onGoPage: (page: number) => void
  onCalibrate: () => void
  onConfirmScale: (page: number, denominator: number) => void
}) {
  const [showPages, setShowPages] = useState(true)
  const [showTexts, setShowTexts] = useState(false)
  const diag = detection?.pdf ?? null
  const counts = {
    vec: pages.filter((p) => p.kind === 'vektorel' || p.kind === 'karma').length,
    scan: pages.filter((p) => p.kind === 'taranmis').length,
    empty: pages.filter((p) => p.kind === 'bos').length,
    err: pages.filter((p) => p.error).length,
    skipped: pages.filter((p) => !p.kind && !p.error).length,
  }
  const scannedSelected = pages.filter((p) => selected.has(p.page) && (p.kind === 'taranmis' || (p.kind === 'karma' && (p.analysis?.textCount ?? 0) < 5)))
  const toggle = (n: number) => {
    const s = new Set(selected)
    if (s.has(n)) s.delete(n)
    else s.add(n)
    onSelectedChange(s)
  }
  const none = !!detection && detection.candidates.length === 0

  return (
    <div className="space-y-3 border-b border-line p-3 text-[12px]" data-testid="pdf-controls">
      {/* Dosya okuma özeti */}
      <div className="rounded-lg border border-line bg-surface-2 px-2.5 py-2" data-testid="pdf-read-summary">
        <div className="flex items-center gap-1.5 font-semibold text-ink">
          <CheckCircle2 className="h-3.5 w-3.5 text-ok" aria-hidden="true" />
          Dosya okundu · {pages.length} sayfa
        </div>
        <div className="mt-0.5 text-muted">
          {counts.vec} vektörel · {counts.scan} taranmış · {counts.empty} boş
          {counts.err ? <span className="text-danger"> · {counts.err} okunamadı</span> : null}
          {counts.skipped ? ` · ${counts.skipped} henüz analiz edilmedi` : null}
        </div>
      </div>

      {/* Analiz durumu */}
      <div
        className={cn('rounded-lg border px-2.5 py-2', running ? 'border-line' : detection ? (none ? 'border-warn-line bg-warn-soft' : 'border-ok/30 bg-ok-soft') : 'border-line')}
        data-testid="pdf-analysis-status"
        aria-live="polite"
      >
        {running ? (
          <>
            <div className="flex items-center gap-1.5 font-semibold text-ink">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Analiz sürüyor
            </div>
            <div className="mt-0.5 text-muted">{progress?.stage}</div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round((progress?.fraction ?? 0) * 100)}%` }} />
            </div>
            <MiniButton className="mt-2" onClick={onCancel}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              İptal
            </MiniButton>
          </>
        ) : detection && diag ? (
          <>
            <div className="font-semibold text-ink">
              Analiz yapıldı · {diag.analyzedPages.length} sayfa · {detection.candidates.length} aday
            </div>
            <div className="mt-0.5 text-muted">
              {diag.totals.texts} yazı, {diag.totals.labels} poz/ölçü etiketi, {diag.totals.scheduleRows} çizelge satırı
              {analyzedAt ? ` · ${analyzedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </div>
          </>
        ) : (
          <div className="text-muted">Analiz henüz başlatılmadı.</div>
        )}
      </div>

      {/* Sayfa seçimi */}
      <div>
        <button type="button" onClick={() => setShowPages((v) => !v)} className="flex w-full items-center gap-1 font-semibold text-ink" aria-expanded={showPages}>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showPages && 'rotate-180')} aria-hidden="true" />
          Analiz edilecek sayfalar ({selected.size}/{pages.length})
        </button>
        {showPages && (
          <>
            <div className="mt-1.5 flex gap-1.5">
              <MiniButton onClick={() => onSelectedChange(new Set(pages.filter((p) => !p.error && p.kind !== 'bos').map((p) => p.page)))}>Dolu sayfalar</MiniButton>
              <MiniButton onClick={() => onSelectedChange(new Set(pages.filter((p) => !p.error).map((p) => p.page)))}>Tümü</MiniButton>
              <MiniButton onClick={() => onSelectedChange(new Set())}>Hiçbiri</MiniButton>
            </div>
            <ul className="mt-1.5 max-h-[260px] space-y-1 overflow-y-auto" aria-label="PDF sayfaları">
              {pages.map((p) => {
                const a = p.analysis
                return (
                  <li key={p.page} className={cn('flex items-start gap-2 rounded-md px-1.5 py-1', p.page === currentPage && 'bg-surface-2')} data-testid="pdf-page-row">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0"
                      checked={selected.has(p.page)}
                      disabled={!!p.error}
                      onChange={() => toggle(p.page)}
                      aria-label={`Sayfa ${p.page} analize dahil`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-ink" title={pageTitle(p)}>
                        S{p.page} · {a?.title ?? (a ? SHEET_LABEL[a.sheet] : p.error ? 'Okunamadı' : 'Analiz edilmedi')}
                      </div>
                      <div className="text-[11px] text-muted">
                        {p.error ? (
                          <span className="text-danger">{p.error}</span>
                        ) : (
                          <>
                            {p.kind ? KIND[p.kind] : '—'}
                            {a ? ` · ${a.textSource === 'ocr' ? 'OCR ' : ''}${a.textCount} yazı · ${a.labelCount} etiket${a.scheduleRows ? ` · ${a.scheduleRows} çizelge satırı` : ''}` : ''}
                            {a?.scale.used ? ` · 1/${a.scale.used}${a.scale.usedFrom === 'olcu' ? ' (ölçü yazılarından)' : a.scale.usedFrom === 'antet' ? ' (antet)' : ' (onaylı)'}` : a && p.kind !== 'bos' ? ' · ölçek yok' : ''}
                          </>
                        )}
                      </div>
                    </div>
                    {p.page !== currentPage && !p.error && (
                      <button type="button" onClick={() => onGoPage(p.page)} className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted hover:bg-surface-3 hover:text-ink" aria-label={`Sayfa ${p.page} görüntüle`} title="Görüntüle">
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>

      {scannedSelected.length > 0 && (
        <label className="flex items-start gap-2 rounded-lg border border-line px-2.5 py-2 text-ink">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={ocr} onChange={(e) => onOcrChange(e.target.checked)} data-testid="pdf-ocr-toggle" />
          <span>
            <span className="inline-flex items-center gap-1 font-semibold">
              <ScanText className="h-3.5 w-3.5" aria-hidden="true" />
              {scannedSelected.length} taranmış sayfada OCR ile yazı oku
            </span>
            <span className="mt-0.5 block text-[11px] text-muted">Türkçe tanıma cihazınızda çalışır (dosya dışarı gönderilmez). İlk kullanımda ~6 MB indirilir; sayfa başına birkaç saniye sürebilir.</span>
          </span>
        </label>
      )}

      <button
        type="button"
        onClick={onRun}
        disabled={running || selected.size === 0}
        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[12.5px] font-semibold text-primary-ink hover:bg-primary-hover disabled:opacity-60"
        data-testid="poz-detect"
      >
        {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
        {detection ? 'Seçili sayfaları yeniden analiz et' : 'Seçili sayfaları analiz et'}
      </button>

      {/* Tanılama */}
      {diag && (
        <div className="space-y-2" data-testid="pdf-diagnostics">
          {diag.whyNone.length > 0 && (
            <div className="rounded-lg border border-warn-line bg-warn-soft px-2.5 py-2 text-ink" data-testid="pdf-why-none">
              <div className="mb-1 flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5 text-warn" aria-hidden="true" />
                Doğrama pozu bulunamadı — neden?
              </div>
              <ul className="space-y-1">
                {diag.whyNone.map((w) => (
                  <li key={w}>• {w}</li>
                ))}
              </ul>
            </div>
          )}
          {diag.warnings.map((w) => (
            <p key={w} className="flex gap-1.5 text-warn">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {w}
            </p>
          ))}
          {diag.suggestedScale && (
            <div className="rounded-lg border border-line px-2.5 py-2">
              <div className="flex items-center gap-1.5 font-semibold text-ink">
                <Info className="h-3.5 w-3.5 text-titanium" aria-hidden="true" />
                Ölçek önerisi: 1/{diag.suggestedScale.denominator} (sayfa {diag.suggestedScale.page})
              </div>
              <p className="mt-0.5 text-muted">{diag.suggestedScale.why}. Onaylarsanız çizim üzerinde ölçüm yapabilirsiniz.</p>
              <MiniButton className="mt-1.5" onClick={() => onConfirmScale(diag.suggestedScale!.page, diag.suggestedScale!.denominator)} testId="pdf-scale-apply">
                Sayfa {diag.suggestedScale.page} için 1/{diag.suggestedScale.denominator} ölçeğini onayla
              </MiniButton>
            </div>
          )}
          <button type="button" onClick={() => setShowTexts((v) => !v)} className="flex items-center gap-1 font-semibold text-muted hover:text-ink" aria-expanded={showTexts}>
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showTexts && 'rotate-180')} aria-hidden="true" />
            Algılanan yazılar ve ölçüler
          </button>
          {showTexts && (
            <div className="space-y-2" data-testid="pdf-texts">
              {diag.pages.map((p) => (
                <div key={p.page}>
                  <div className="font-semibold text-ink">
                    S{p.page} · {p.title ?? SHEET_LABEL[p.sheet]} — {p.textCount} yazı, {p.numericCount} sayısal ölçü, {p.labelCount} etiket
                  </div>
                  {p.samples.length ? (
                    <p className="mt-0.5 font-mono text-[11px] break-words text-muted">{p.samples.join(' · ')}</p>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-muted">Yazı yok.</p>
                  )}
                  {p.notes.map((n) => (
                    <p key={n} className="text-[11px] text-warn">
                      {n}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Elle ölçüm */}
      <div className="rounded-lg border border-dashed border-line-strong px-2.5 py-2 text-muted">
        <div className="font-semibold text-ink">Elle ölçüm</div>
        <p className="mt-0.5">Ölçeği kalibre edin, ardından araç çubuğundaki <strong>Alan ölç (A)</strong> veya <strong>Mesafe ölç (D)</strong> ile ölçüp sağ paneldeki "Metraja ekle" ile poz oluşturun.</p>
        <MiniButton className="mt-1.5" onClick={onCalibrate} testId="pdf-manual-calibrate">
          İki noktayla kalibre et
        </MiniButton>
      </div>
    </div>
  )
}
