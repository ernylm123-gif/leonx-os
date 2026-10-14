import { CheckCircle2, ChevronDown, Crosshair, X } from 'lucide-react'
import { Fragment, useState } from 'react'
import type { PdfPozCandidate } from '@/cad/pdf/archAnalyze'
import { cn } from '@/lib/cn'
import type { PozCandidate } from '@/quantity/detect'
import { computeItem } from '@/quantity/engine'
import { candidateToInput, canApprove } from '@/quantity/fromDetection'
import { formatCenti } from '@/quantity/precision'
import { QUANTITY_CATEGORIES, type QuantityCategory, type QuantityItem } from '@/quantity/types'
import { MiniButton } from '../workspace/ui'

export interface CandidateEdit {
  width_mm?: number | null
  height_mm?: number | null
  count?: number
  category?: QuantityCategory
}

const LEVEL = {
  yuksek: { label: 'Yüksek', cls: 'border-ok/30 bg-ok-soft text-ok' },
  orta: { label: 'Orta', cls: 'border-warn-line bg-warn-soft text-warn' },
  dusuk: { label: 'Düşük', cls: 'border-danger/30 bg-danger-soft text-danger' },
} as const
const VER = { onaylandi: 'Onaylı', bekliyor: 'Doğrulama bekliyor', reddedildi: 'Reddedildi' } as const
const UNIT = { m2: 'm²', mtul: 'mtül', adet: 'adet', kg: 'kg' } as const

const isPdf = (c: PozCandidate): c is PdfPozCandidate => 'pages' in c

function NumCell({ value, onChange, label, testId, int }: { value: number | null; onChange: (v: number | null) => void; label: string; testId?: string; int?: boolean }) {
  const [text, setText] = useState<string | null>(null)
  return (
    <input
      inputMode={int ? 'numeric' : 'decimal'}
      aria-label={label}
      data-testid={testId}
      value={text ?? (value == null ? '' : String(value))}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text == null) return
        const t = text.trim().replace(',', '.')
        const n = t === '' ? null : Number(t)
        if (n == null || (Number.isFinite(n) && n > 0 && (!int || Number.isInteger(n)))) onChange(n == null ? null : int ? n : Math.round(n))
        setText(null)
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      onClick={(e) => e.stopPropagation()}
      className="h-8 w-[72px] rounded-md border border-line bg-surface px-1.5 text-right font-mono text-base text-ink tabular-nums sm:text-[12px]"
    />
  )
}

/**
 * Tespit sonuçları tablosu: poz, iş kalemi, kaynak pafta, ölçü, adet, birim, toplam, güven,
 * doğrulama durumu. Ölçü/adet/iş grubu düzenlenebilir; satıra dokununca çizimde gösterilir.
 */
export function PdfResultsTable({
  candidates,
  items,
  ignored,
  selectedKey,
  readOnly,
  onSelect,
  onEdit,
  onAdd,
  onIgnore,
}: {
  candidates: PozCandidate[]
  items: QuantityItem[]
  ignored: Set<string>
  selectedKey: string | null
  readOnly?: boolean
  onSelect: (c: PozCandidate) => void
  onEdit: (key: string, patch: CandidateEdit) => void
  onAdd: (c: PozCandidate[], opts: { approve: boolean }) => void
  onIgnore: (key: string) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const list = candidates.filter((c) => !ignored.has(c.key))
  const byKey = new Map(items.map((i) => [i.drawing_ref?.key ?? '', i]))
  const rows = list.map((c) => {
    const input = candidateToInput(c, { approve: false, fileName: null, analysisId: null })
    const calc = computeItem({ ...input, verification: 'onaylandi' })
    return { c, input, calc, item: byKey.get(c.key) ?? null, approvable: canApprove(input) }
  })
  const sum = { m2: 0, mtul: 0 }
  for (const r of rows) if (r.calc.primary && (r.calc.primary.unit === 'm2' || r.calc.primary.unit === 'mtul')) sum[r.calc.primary.unit] += r.calc.primary.centi
  const addable = rows.filter((r) => !r.item)

  if (!list.length) return <p className="px-4 py-6 text-center text-[12.5px] text-muted">Tespit sonucu yok. Sol paneldeki "Pozlar" sekmesinden analizi başlatın; sonuç çıkmazsa nedeni orada açıklanır.</p>
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pdf-results">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5 text-[12px] text-muted">
        <span>
          <strong className="text-ink">{list.length}</strong> aday · toplam <strong className="text-ink">{formatCenti(sum.m2)} m²</strong>
          {sum.mtul ? (
            <>
              {' '}
              · <strong className="text-ink">{formatCenti(sum.mtul)} mtül</strong>
            </>
          ) : null}
        </span>
        <span className="hidden sm:inline">Öneridir: ölçü ve adetleri kontrol edip onaylayın.</span>
        <div className="flex-1" />
        {!readOnly && addable.length > 0 && (
          <MiniButton onClick={() => onAdd(addable.map((r) => r.c), { approve: false })} testId="results-add-all">
            Tümünü metraja ekle ({addable.length})
          </MiniButton>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[1040px] border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-[1] bg-surface-2 text-left text-[11px] font-semibold tracking-wide text-muted uppercase">
            <tr>
              <th className="px-2 py-1.5">Poz</th>
              <th className="px-2 py-1.5">İş kalemi</th>
              <th className="px-2 py-1.5">Kaynak pafta</th>
              <th className="px-2 py-1.5 text-right">En (mm)</th>
              <th className="px-2 py-1.5 text-right">Boy (mm)</th>
              <th className="px-2 py-1.5 text-right">Adet</th>
              <th className="px-2 py-1.5 text-right">Toplam</th>
              <th className="px-2 py-1.5">Güven</th>
              <th className="px-2 py-1.5">Durum</th>
              <th className="px-2 py-1.5 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ c, calc, item, approvable }) => {
              const lv = LEVEL[c.level]
              const pdf = isPdf(c) ? c : null
              const expanded = open === c.key
              const locked = !!item || readOnly
              return (
                <Fragment key={c.key}>
                  <tr
                    onClick={() => onSelect(c)}
                    className={cn('cursor-pointer align-middle hover:bg-surface-2', selectedKey === c.key && 'bg-primary/5 outline-1 -outline-offset-1 outline-primary/40')}
                    data-testid="result-row"
                    data-poz={c.code}
                  >
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpen(expanded ? null : c.key)
                          }}
                          className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-surface-3"
                          aria-label={`${c.code} ayrıntıları`}
                          aria-expanded={expanded}
                        >
                          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
                        </button>
                        <span className="font-mono font-semibold text-ink">{c.code}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      {locked ? (
                        <span className="text-ink">{QUANTITY_CATEGORIES.find((q) => q.value === (item?.category ?? c.category))?.label}</span>
                      ) : (
                        <select
                          value={c.category}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => onEdit(c.key, { category: e.target.value as QuantityCategory })}
                          className={cn('h-8 max-w-[170px] rounded-md border bg-surface px-1 text-base text-ink sm:text-[12px]', c.category === 'belirsiz' ? 'border-warn-line' : 'border-line')}
                          aria-label={`${c.code} iş kalemi`}
                          data-testid="result-category"
                        >
                          {QUANTITY_CATEGORIES.map((q) => (
                            <option key={q.value} value={q.value}>
                              {q.label}
                            </option>
                          ))}
                        </select>
                      )}
                      {c.label && <div className="max-w-[220px] truncate text-[11px] text-muted" title={c.label}>{c.label}</div>}
                    </td>
                    <td className="max-w-[200px] px-2 py-1.5 text-[11.5px] text-muted">
                      <div className="truncate" title={pdf?.sheets.join('\n') ?? c.layer}>
                        {pdf ? pdf.sheets.join(', ') : c.layer}
                      </div>
                      <div className="text-[10.5px]">{c.source === 'cizelge' ? 'Çizelge + plan' : c.source === 'etiket' ? 'Plan etiketi' : c.source}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right">{locked ? <span className="font-mono">{c.width_mm ?? '—'}</span> : <NumCell value={c.width_mm} label={`${c.code} en`} onChange={(v) => onEdit(c.key, { width_mm: v })} testId="result-width" />}</td>
                    <td className="px-2 py-1.5 text-right">{locked ? <span className="font-mono">{c.height_mm ?? '—'}</span> : <NumCell value={c.height_mm} label={`${c.code} boy`} onChange={(v) => onEdit(c.key, { height_mm: v })} testId="result-height" />}</td>
                    <td className="px-2 py-1.5 text-right">
                      {locked ? <span className="font-mono">{c.count}</span> : <NumCell int value={c.count} label={`${c.code} adet`} onChange={(v) => v && onEdit(c.key, { count: v })} testId="result-count" />}
                      {pdf && pdf.scheduleQty != null && pdf.planQty != null && pdf.scheduleQty !== pdf.planQty && (
                        <div className="text-[10.5px] text-warn" title="Çizelge ve plan sayımı farklı">
                          çizelge {pdf.scheduleQty} / plan {pdf.planQty}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap text-ink" data-testid="result-total">
                      {calc.primary ? `${formatCenti(calc.primary.centi)} ${UNIT[calc.primary.unit]}` : <span className="text-danger" title={calc.errors.map((e) => e.message).join('\n')}>eksik</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={cn('rounded-md border px-1.5 py-px text-[10.5px] font-semibold whitespace-nowrap', lv.cls)}>
                        {lv.label} %{Math.round(c.confidence * 100)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-[11.5px] whitespace-nowrap">
                      {item ? (
                        <span className={cn('inline-flex items-center gap-1 font-semibold', item.verification === 'onaylandi' ? 'text-ok' : 'text-warn')}>
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Metrajda · {VER[item.verification]}
                        </span>
                      ) : (
                        <span className="text-muted">Öneri (onaysız)</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => onSelect(c)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-ink" aria-label={`${c.code} çizimde göster`} title="Çizimde göster">
                          <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        {!locked && (
                          <>
                            <MiniButton onClick={() => onAdd([c], { approve: false })} testId="result-add">
                              Ekle
                            </MiniButton>
                            <MiniButton tone="primary" disabled={!approvable} onClick={() => onAdd([c], { approve: true })} title={approvable ? 'Ölçü, adet ve iş kalemini onaylayarak metraja ekle' : 'Onay için iş kalemi seçilmeli ve ölçüler tamamlanmalı'} testId="result-approve">
                              Onayla
                            </MiniButton>
                            <button type="button" onClick={() => onIgnore(c.key)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-danger" aria-label={`${c.code} adayını yok say`} title="Yok say">
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="bg-surface-2/60">
                      <td colSpan={10} className="px-4 py-2 text-[12px]">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <div className="mb-1 font-semibold text-warn">Belirsizlikler ({c.reasons.length})</div>
                            <ul className="space-y-0.5 text-warn">
                              {c.reasons.map((r) => (
                                <li key={r}>• {r}</li>
                              ))}
                              {!c.reasons.length && <li className="text-muted">—</li>}
                            </ul>
                          </div>
                          <div>
                            <div className="mb-1 font-semibold text-ink">Kanıtlar ({c.evidence.length})</div>
                            <ul className="space-y-0.5 text-muted">
                              {c.evidence.map((r) => (
                                <li key={r}>✓ {r}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
