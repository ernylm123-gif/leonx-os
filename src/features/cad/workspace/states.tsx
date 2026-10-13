import { AlertTriangle, FileUp, FileWarning, Loader2, ScanLine, X } from 'lucide-react'
import { type DragEvent, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { nf } from '../format'

export const CAD_ACCEPT = '.dxf,.dwg,.pdf'

/** Boş çalışma alanı: dosya seçme / sürükle-bırak ve desteklenen biçimlerin dürüst açıklaması */
export function DropZone({ onFile, compact }: { onFile: (f: File) => void; compact?: boolean }) {
  const [over, setOver] = useState(false)
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) onFile(f)
  }
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'blueprint-grid relative flex min-h-[300px] flex-1 flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center transition-colors',
        over ? 'border-titanium bg-surface-2' : 'border-line-strong',
      )}
    >
      <div className="relative grid h-14 w-14 place-items-center rounded-2xl border border-line bg-surface shadow-card">
        <ScanLine className="h-6 w-6 text-titanium" strokeWidth={1.6} aria-hidden="true" />
      </div>
      <h2 className="relative mt-4 text-base font-semibold text-ink">Çizim açın</h2>
      <p className="relative mt-1.5 max-w-md text-sm text-muted">
        DXF dosyası katman, blok ve ölçüleriyle analiz edilir. PDF çizimler görüntülenir ve kalibrasyonla ölçülür. DWG dosyaları için
        DXF'e dönüştürme gerekir.
      </p>
      <label className="relative mt-5 inline-flex">
        <input
          type="file"
          accept={CAD_ACCEPT}
          className="peer sr-only"
          data-testid="cad-file-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ''
          }}
        />
        <span className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-ink shadow-card peer-focus-visible:ring-2 peer-focus-visible:ring-titanium hover:bg-primary-hover">
          <FileUp className="h-4 w-4" aria-hidden="true" />
          Dosya seç
        </span>
      </label>
      {!compact && (
        <ul className="relative mt-5 flex flex-wrap justify-center gap-2 font-mono text-[11px] text-muted">
          <li className="rounded-md border border-line bg-surface px-2 py-0.5">DXF — tam analiz</li>
          <li className="rounded-md border border-line bg-surface px-2 py-0.5">PDF — görüntüleme + kalibrasyon</li>
          <li className="rounded-md border border-line bg-surface px-2 py-0.5">DWG — DXF'e dönüştürün</li>
          <li className="rounded-md border border-line bg-surface px-2 py-0.5">en fazla 50 MB</li>
        </ul>
      )}
    </div>
  )
}

export function LoadingView({ fileName, stage, fraction, onCancel }: { fileName: string; stage: string; fraction: number; onCancel: () => void }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center p-6 text-center" role="status" aria-live="polite">
      <Loader2 className="h-7 w-7 animate-spin text-titanium" aria-hidden="true" />
      <p className="mt-4 max-w-sm truncate text-sm font-semibold text-ink">{fileName}</p>
      <p className="mt-1 text-[13px] text-muted">{stage}</p>
      <div className="mt-4 h-1.5 w-64 max-w-full overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-titanium transition-[width] duration-200" style={{ width: `${Math.round(Math.min(1, Math.max(0.02, fraction)) * 100)}%` }} />
      </div>
      <p className="mt-1.5 font-mono text-[11px] text-subtle">%{nf(0).format(Math.round(fraction * 100))}</p>
      <Button variant="secondary" icon={X} className="mt-5 h-9" onClick={onCancel}>
        İptal et
      </Button>
    </div>
  )
}

/** DWG: dosya okunuyormuş gibi davranılmaz. Lisans koşullarına uygun dönüştürme yolları açıklanır. */
export function DwgGuide({ fileName, version, onReset }: { fileName: string; version?: string; onReset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-2xl p-3 sm:p-6" data-testid="dwg-guide">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-warn-line bg-warn-soft">
          <FileWarning className="h-5 w-5 text-warn" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">DWG dosyası doğrudan analiz edilemiyor</h2>
          <p className="mt-1 text-sm text-muted">
            <span className="font-mono text-ink-2">{fileName}</span>
            {version && <> · {version}</>}. DWG kapalı bir biçimdir; tarayıcıda güvenilir, ücretsiz ve ticari kullanıma uygun bir okuyucu bulunmadığı için
            LEONX OS DWG içeriğini okumaz ve okumuş gibi davranmaz.
          </p>
        </div>
      </div>
      <ol className="mt-5 space-y-3 text-sm">
        <li className="rounded-xl border border-line bg-surface p-3.5">
          <p className="font-semibold text-ink">1. Kullandığınız CAD programında DXF olarak kaydedin (önerilen)</p>
          <p className="mt-1 text-muted">
            AutoCAD, BricsCAD, ZWCAD, GstarCAD veya DraftSight: <span className="text-ink-2">Farklı Kaydet → Dosya türü: AutoCAD 2018 DXF (*.dxf)</span>. Dış referanslar
            (XREF) varsa önce <span className="text-ink-2">Bağla (Bind)</span> komutuyla çizime ekleyin.
          </p>
        </li>
        <li className="rounded-xl border border-line bg-surface p-3.5">
          <p className="font-semibold text-ink">2. Ücretsiz seçenek: LibreCAD (GPL, ticari kullanım serbest)</p>
          <p className="mt-1 text-muted">DWG'yi açıp DXF olarak kaydedebilir. Yeni sürüm DWG'lerin bir kısmını hatalı veya eksik açabilir; sonucu kontrol edin.</p>
        </li>
        <li className="rounded-xl border border-line bg-surface p-3.5">
          <p className="font-semibold text-ink">3. ODA File Converter hakkında</p>
          <p className="mt-1 text-muted">
            Ücretsiz indirilebilir ancak üreticisinin açıklamasına göre üyelik olmadan yalnızca ticari olmayan kullanım içindir. Ticari kullanım için ODA üyeliği
            gerekir.
          </p>
        </li>
      </ol>
      <div className="mt-5">
        <Button variant="primary" icon={FileUp} onClick={onReset}>
          DXF dosyası seç
        </Button>
      </div>
    </div>
  )
}

export function ErrorView({ fileName, message, onReset }: { fileName: string; message: string; onReset: () => void }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center p-6 text-center" role="alert">
      <AlertTriangle className="h-7 w-7 text-danger" aria-hidden="true" />
      <p className="mt-3 max-w-md truncate text-sm font-semibold text-ink">{fileName}</p>
      <p className="mt-1 max-w-md text-[13px] text-muted">{message}</p>
      <Button variant="secondary" icon={FileUp} className="mt-5" onClick={onReset}>
        Başka dosya seç
      </Button>
    </div>
  )
}
