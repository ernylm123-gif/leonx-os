import { CheckCircle2, ChevronDown, Crosshair, Loader2, Plus, Sparkles, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { cn } from '@/lib/cn'
import type { DetectionResult, PozCandidate } from '@/quantity/detect'
import { candidateToInput, canApprove } from '@/quantity/fromDetection'
import { QUANTITY_CATEGORIES, type QuantityCategory, SHAPE_LABEL } from '@/quantity/types'
import { MiniButton } from '../workspace/ui'

const LEVEL = {
  yuksek: { label: 'Yüksek', cls: 'border-ok/30 bg-ok-soft text-ok' },
  orta: { label: 'Orta', cls: 'border-warn-line bg-warn-soft text-warn' },
  dusuk: { label: 'Düşük', cls: 'border-danger/30 bg-danger-soft text-danger' },
} as const

const SOURCE = { blok: 'Blok', kapali_cizgi: 'Kapalı çizgi', cizgi_dortgen: '4 çizgi', cokgen: 'Çokgen', elle: 'Elle', olcum: 'Ölçüm', etiket: 'PDF etiketi', cizelge: 'Çizelge' } as const

export function PozPanel({
  available,
  unavailableReason,
  detection,
  running,
  onDetect,
  addedKeys,
  ignored,
  onIgnore,
  onAdd,
  onShow,
  selectedKey,
  controls,
}: {
  available: boolean
  unavailableReason?: string
  detection: DetectionResult | null
  running: boolean
  onDetect: () => void
  addedKeys: Set<string>
  ignored: Set<string>
  onIgnore: (key: string) => void
  onAdd: (c: PozCandidate[], opts: { approve: boolean; category?: QuantityCategory }) => void
  onShow: (c: PozCandidate) => void
  selectedKey: string | null
  /** Varsayılan "Pozları tespit et" düğmesi yerine özel denetimler (PDF: sayfa seçimi, OCR, tanılama) */
  controls?: ReactNode
}) {
  const [cats, setCats] = useState<Record<string, QuantityCategory>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [showSkipped, setShowSkipped] = useState(false)
  if (!available) return <p className="px-4 py-6 text-center text-[12.5px] text-muted">{unavailableReason}</p>
  const list = (detection?.candidates ?? []).filter((c) => !ignored.has(c.key))
  const addable = list.filter((c) => !addedKeys.has(c.key))
  return (
    <div className="flex min-h-full flex-col" data-testid="poz-panel">
      {controls}
      <div className={cn('space-y-2 border-b border-line p-3', !!controls && !detection && 'hidden')}>
        {!controls && (
          <button
            type="button"
            onClick={onDetect}
            disabled={running}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[12.5px] font-semibold text-primary-ink hover:bg-primary-hover disabled:opacity-60"
            data-testid="poz-detect"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
            {detection ? 'Yeniden tespit et' : 'Pozları tespit et'}
          </button>
        )}
        {detection && (
          <>
            <p className="text-[11.5px] text-muted">
              {detection.candidates.length} aday · {detection.labelsFound} poz etiketi. Tespitler <strong className="text-ink">öneridir</strong>; malzeme ve ölçüler onaylanmadan kesin metraja girmez.
            </p>
            {!detection.unitsVerified && !detection.pdf && <p className="text-[11.5px] text-danger">Çizim birimi doğrulanmadı: önce Dosya sekmesinden birimi onaylayın.</p>}
            {detection.skipped.length > 0 && (
              <button type="button" onClick={() => setShowSkipped((v) => !v)} className="flex items-center gap-1 text-[11.5px] font-semibold text-muted hover:text-ink">
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showSkipped && 'rotate-180')} aria-hidden="true" />
                Elenen geometriler ({detection.skipped.reduce((s, x) => s + x.count, 0)})
              </button>
            )}
            {showSkipped && (
              <ul className="space-y-0.5 text-[11.5px] text-muted">
                {detection.skipped.map((s) => (
                  <li key={s.reason}>
                    {s.reason}: <span className="font-mono">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
            {addable.length > 1 && (
              <MiniButton onClick={() => onAdd(addable, { approve: false })} testId="poz-add-all">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Tümünü doğrulanmamış ekle ({addable.length})
              </MiniButton>
            )}
          </>
        )}
      </div>
      <ul className="flex-1 divide-y divide-line" aria-label="Poz adayları">
        {list.map((c) => {
          const added = addedKeys.has(c.key)
          const cat = cats[c.key] ?? c.category
          const approvable = canApprove(candidateToInput(c, { approve: false, fileName: null, analysisId: null, category: cat }))
          const lv = LEVEL[c.level]
          const expanded = open === c.key
          return (
            <li key={c.key} className={cn('px-3 py-2.5', selectedKey === c.key && 'bg-surface-2')} data-testid="poz-candidate">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[13px] font-semibold text-ink">{c.code}</span>
                    <span className="font-mono text-[11.5px] text-muted">×{c.count}</span>
                    <span className={cn('rounded-md border px-1.5 py-px text-[10px] font-semibold', lv.cls)} title={`Güven: %${Math.round(c.confidence * 100)}`}>
                      {lv.label} %{Math.round(c.confidence * 100)}
                    </span>
                    {added && (
                      <span className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold text-ok">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        Metrajda
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-muted">
                    {SHAPE_LABEL[c.shape]} · {c.width_mm ?? '—'} × {c.height_mm ?? '—'} mm · {SOURCE[c.source]}
                  </div>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <button type="button" onClick={() => onShow(c)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-ink" aria-label={`${c.code} çizimde göster`} title="Çizimde göster">
                    <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  {!added && (
                    <button type="button" onClick={() => onIgnore(c.key)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-danger" aria-label={`${c.code} adayını yok say`} title="Yok say">
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
              {!added && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <select
                    value={cat}
                    onChange={(e) => setCats((m) => ({ ...m, [c.key]: e.target.value as QuantityCategory }))}
                    className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-1.5 text-base text-ink sm:text-[12px]"
                    aria-label={`${c.code} iş grubu`}
                  >
                    {QUANTITY_CATEGORIES.map((q) => (
                      <option key={q.value} value={q.value}>
                        {q.label}
                      </option>
                    ))}
                  </select>
                  <MiniButton onClick={() => onAdd([c], { approve: false, category: cat })} testId="poz-add">
                    Ekle
                  </MiniButton>
                  <MiniButton
                    tone="primary"
                    disabled={!approvable}
                    onClick={() => onAdd([c], { approve: true, category: cat })}
                    title={approvable ? 'Ölçü ve iş grubunu onaylayarak ekle' : 'Onay için iş grubu seçilmeli ve ölçüler tamamlanmalı'}
                    testId="poz-approve"
                  >
                    Onayla
                  </MiniButton>
                </div>
              )}
              {(c.reasons.length > 0 || c.evidence.length > 0) && (
                <button type="button" onClick={() => setOpen(expanded ? null : c.key)} className="mt-1.5 flex items-center gap-1 text-[11.5px] font-semibold text-muted hover:text-ink" aria-expanded={expanded}>
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
                  {c.reasons.length} belirsizlik · {c.evidence.length} kanıt
                </button>
              )}
              {expanded && (
                <div className="mt-1.5 space-y-1.5 text-[11.5px]">
                  {c.reasons.length > 0 && (
                    <ul className="space-y-0.5 text-warn">
                      {c.reasons.map((r) => (
                        <li key={r}>• {r}</li>
                      ))}
                    </ul>
                  )}
                  {c.evidence.length > 0 && (
                    <ul className="space-y-0.5 text-muted">
                      {c.evidence.map((r) => (
                        <li key={r}>✓ {r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          )
        })}
        {detection && list.length === 0 && !controls && <li className="px-4 py-6 text-center text-[12.5px] text-muted">Doğrama pozu adayı bulunamadı. Pozları elle ekleyebilirsiniz.</li>}
      </ul>
    </div>
  )
}
