import { CheckCircle2, CircleHelp, CircleSlash, Crosshair, PencilLine, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { PdfPozCandidate } from '@/cad/pdf/archAnalyze'
import { ATTR_LABEL, ATTR_STATUS_LABEL, type AttrKey } from '@/cad/pdf/attributes'
import { cn } from '@/lib/cn'
import type { PozCandidate } from '@/quantity/detect'
import { computeItem } from '@/quantity/engine'
import { explainCalc } from '@/quantity/explain'
import { candidateToInput, canApprove } from '@/quantity/fromDetection'
import { CATEGORY_INFO, correctedFields, QUANTITY_CATEGORIES, type QuantityCategory, type QuantityItem, type QuantityItemInput } from '@/quantity/types'
import { ItemHistory } from '@/features/quantity/ItemDetail'
import type { ItemsStore } from '@/features/quantity/useItemsStore'
import type { CandidateEdit } from '../quantity/PdfResultsTable'

const isPdf = (c: PozCandidate | null): c is PdfPozCandidate => !!c && 'attrs' in c
const dtf = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const STATUS_CLS = { dogrulandi: 'text-ok', aday: 'text-warn', belirsiz: 'text-muted' } as const
const FIELD: Record<string, string> = { poz_code: 'Poz', category: 'İş grubu', width_mm: 'En', height_mm: 'Boy', quantity: 'Adet' }

type Status = { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' }

function statusOf(item: QuantityItem | null): Status {
  if (!item) return { label: 'Öneri — metraja eklenmedi', tone: 'muted' }
  if (item.verification === 'onaylandi') return { label: 'Onaylandı', tone: 'ok' }
  if (item.verification === 'reddedildi') return { label: 'Reddedildi', tone: 'danger' }
  if (item.uncertain) return { label: 'Belirsiz', tone: 'warn' }
  return { label: 'Doğrulama bekliyor', tone: 'warn' }
}
const TONE = { ok: 'border-ok/30 bg-ok-soft text-ok', warn: 'border-warn-line bg-warn-soft text-warn', danger: 'border-danger/30 bg-danger-soft text-danger', muted: 'border-line bg-surface-2 text-muted' }

function Num({ label, value, onChange, int, testId }: { label: string; value: number | null; onChange: (v: number | null) => void; int?: boolean; testId?: string }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => setText(value == null ? '' : String(value)), [value])
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-muted">
      {label}
      <input
        inputMode={int ? 'numeric' : 'decimal'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const t = text.trim().replace(',', '.')
          const n = t === '' ? null : Number(t)
          if (n == null || (Number.isFinite(n) && n > 0 && (!int || Number.isInteger(n)))) onChange(n)
          else setText(value == null ? '' : String(value))
        }}
        className="h-10 rounded-md border border-line bg-surface px-2 text-right font-mono text-base text-ink sm:h-9 sm:text-[13px]"
        data-testid={testId}
      />
    </label>
  )
}

/**
 * Mühendislik incelemesi — seçili pozun ayrıntısı: ölçüler, adet, hesap yöntemi, kaynak paftalar,
 * teknik özellikler (doğrulandı / aday / belirsiz), çelişkiler ve Onayla / Düzelt / Reddet / Belirsiz.
 * Aday henüz metraja eklenmemişse işlem onu ekler; eklenmişse metraj kaydını günceller.
 */
export function ReviewPanel({
  candidate,
  item,
  store,
  onEditCandidate,
  onAddCandidate,
  onIgnore,
  onShow,
  onClose,
}: {
  candidate: PozCandidate | null
  item: QuantityItem | null
  store: ItemsStore
  onEditCandidate: (key: string, patch: CandidateEdit) => void
  onAddCandidate: (c: PozCandidate, opts: { approve: boolean; uncertain?: boolean; note?: string | null }) => Promise<void>
  onIgnore: (key: string) => void
  onShow: (page: number | null) => void
  onClose: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState(item?.review_note ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setEditing(false)
    setNote(item?.review_note ?? '')
  }, [candidate?.key, item?.id, item?.review_note])

  const pdf = isPdf(candidate) ? candidate : null
  // Değerler: metraj kaydı varsa o (kullanıcı düzeltmeleri dahil), yoksa aday
  const input: QuantityItemInput | null = item ?? (candidate ? candidateToInput(candidate, { approve: false, fileName: null, analysisId: null }) : null)
  if (!input) return null
  const calc = computeItem({ ...input, verification: 'onaylandi' })
  const exp = explainCalc(input, calc)
  const approvable = canApprove(input)
  const st = statusOf(item)
  const readOnly = store.readOnly
  const attrs = pdf?.attrs ?? (item?.detection?.attrs as PdfPozCandidate['attrs'] | undefined) ?? null
  const conflicts = pdf?.conflicts ?? item?.detection?.conflicts ?? []
  const corrected = item ? correctedFields(item) : []
  const prov = item?.detection?.provenance
  const pages = pdf?.pages ?? prov?.pages ?? item?.drawing_ref?.box_pages?.filter((v, i, a) => a.indexOf(v) === i) ?? []

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  const setValue = (patch: { width_mm?: number | null; height_mm?: number | null; quantity?: number; category?: QuantityCategory }) => {
    if (item) void run(() => store.update(item, patch))
    else if (candidate) onEditCandidate(candidate.key, { ...(patch.width_mm !== undefined ? { width_mm: patch.width_mm } : {}), ...(patch.height_mm !== undefined ? { height_mm: patch.height_mm } : {}), ...(patch.quantity !== undefined ? { count: patch.quantity } : {}), ...(patch.category ? { category: patch.category } : {}) })
  }
  const approve = () => run(async () => (item ? store.update(item, { verification: 'onaylandi', uncertain: false, review_note: note.trim() || null }) : candidate && onAddCandidate(candidate, { approve: true, note: note.trim() || null })))
  const uncertain = () =>
    run(async () => (item ? store.update(item, { verification: 'bekliyor', uncertain: true, review_note: note.trim() || 'Belirsiz olarak işaretlendi' }) : candidate && onAddCandidate(candidate, { approve: false, uncertain: true, note: note.trim() || 'Belirsiz olarak işaretlendi' })))
  const reject = () =>
    run(async () => {
      if (item) await store.update(item, { verification: 'reddedildi', uncertain: false, review_note: note.trim() || 'Reddedildi' })
      else if (candidate) onIgnore(candidate.key)
    })
  const conflictValues = (kind: string) => (kind === 'adet' && pdf && pdf.scheduleQty != null && pdf.planQty != null ? [
    { label: `Çizelge: ${pdf.scheduleQty}`, qty: pdf.scheduleQty },
    { label: `Plan: ${pdf.planQty}`, qty: pdf.planQty },
  ] : [])

  return (
    <section className="border-b border-line text-[12.5px]" aria-label="Mühendislik incelemesi" data-testid="review-panel">
      <div className="flex items-start justify-between gap-2 px-4 pt-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <span className="truncate font-mono" data-testid="review-code">{input.poz_code || '(kodsuz)'}</span>
            <span className={cn('rounded-md border px-1.5 py-px text-[10.5px] font-semibold whitespace-nowrap', TONE[st.tone])} data-testid="review-status">
              {st.label}
            </span>
          </h2>
          <div className="mt-0.5 text-[11.5px] text-muted">
            {CATEGORY_INFO[input.category]?.label}
            {candidate ? ` · güven %${Math.round(candidate.confidence * 100)}` : item?.detection ? ` · güven %${Math.round(item.detection.confidence * 100)}` : ''}
          </div>
        </div>
        <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink" aria-label="İncelemeyi kapat">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {conflicts.length > 0 && (
        <div className="mx-4 mt-2 rounded-lg border border-danger/30 bg-danger-soft px-2.5 py-2 text-danger" data-testid="review-conflicts">
          <div className="font-semibold">Çelişki — karar sizin</div>
          {conflicts.map((c) => (
            <div key={c.message} className="mt-1">
              <div>{c.message}</div>
              {!readOnly && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {conflictValues(c.kind).map((v) => (
                    <button
                      key={v.label}
                      type="button"
                      onClick={() => setValue({ quantity: v.qty })}
                      className={cn('h-9 rounded-md border px-2.5 text-[12px] font-semibold', input.quantity === v.qty ? 'border-ink bg-surface text-ink' : 'border-danger/30 bg-surface text-danger')}
                      data-testid="review-conflict-choice"
                    >
                      {v.label} adet {input.quantity === v.qty ? '✓' : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Ölçüler ve adet */}
      <div className="px-4 pt-2.5">
        {editing && !readOnly ? (
          <div className="grid grid-cols-3 gap-2" data-testid="review-edit">
            <Num label="En (mm)" value={input.width_mm} onChange={(v) => setValue({ width_mm: v })} testId="review-width" />
            <Num label="Boy (mm)" value={input.height_mm} onChange={(v) => setValue({ height_mm: v })} testId="review-height" />
            <Num label="Adet" int value={input.quantity} onChange={(v) => v && setValue({ quantity: v })} testId="review-qty" />
            <label className="col-span-3 flex flex-col gap-0.5 text-[11px] text-muted">
              İş grubu (malzeme sınıfı)
              <select value={input.category} onChange={(e) => setValue({ category: e.target.value as QuantityCategory })} className="h-10 rounded-md border border-line bg-surface px-2 text-base text-ink sm:h-9 sm:text-[13px]" data-testid="review-category">
                {QUANTITY_CATEGORIES.map((q) => (
                  <option key={q.value} value={q.value}>
                    {q.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              ['En', input.width_mm != null ? `${input.width_mm} mm` : '—'],
              ['Boy', input.height_mm != null ? `${input.height_mm} mm` : '—'],
              ['Adet', String(input.quantity)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-surface-2 px-2 py-1.5">
                <dt className="text-[10.5px] text-muted uppercase">{k}</dt>
                <dd className="font-mono font-semibold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {corrected.length > 0 && item?.original && (
          <p className="mt-1.5 text-[11.5px] text-warn" data-testid="review-corrected">
            Kullanıcı düzeltmesi: {corrected.map((f) => `${FIELD[f]} ${String((item.original as unknown as Record<string, unknown>)[f] ?? '—')} → ${String((item as unknown as Record<string, unknown>)[f] ?? '—')}`).join(' · ')}
          </p>
        )}
      </div>

      {/* Hesap yöntemi */}
      <div className="px-4 pt-2.5" data-testid="review-calc">
        <div className="mb-1 font-semibold text-ink">Hesaplama</div>
        {exp.lines.length ? (
          <table className="w-full text-[11.5px]">
            <tbody>
              {exp.lines.map((l) => (
                <tr key={l.label} className="align-top">
                  <td className="py-0.5 pr-2 text-muted">{l.label}</td>
                  <td className="py-0.5 pr-2 font-mono text-ink-2">{l.formula}</td>
                  <td className="py-0.5 text-right font-mono font-semibold whitespace-nowrap text-ink">{l.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {exp.notes.map((n) => (
          <p key={n} className="mt-0.5 text-[11px] text-subtle">
            {n}
          </p>
        ))}
      </div>

      {/* Kaynak */}
      <div className="px-4 pt-2.5">
        <div className="mb-1 font-semibold text-ink">Kaynak</div>
        <ul className="space-y-0.5 text-[11.5px] text-ink-2">
          {(pdf?.sheets ?? prov?.sheets ?? []).map((s) => (
            <li key={s}>• {s}</li>
          ))}
          {(pdf?.dimsFrom ?? prov?.dims_from) && <li>• Ölçü kaynağı: {{ cizelge: 'çizelge', kart: 'doğrama listesi kartı', etiket: 'plan etiketi' }[(pdf?.dimsFrom ?? prov?.dims_from) as string] ?? pdf?.dimsFrom}</li>}
          {(pdf?.scheduleQty ?? prov?.schedule_qty) != null && <li>• Çizelge adedi: {pdf?.scheduleQty ?? prov?.schedule_qty}</li>}
          {(pdf?.planQty ?? prov?.plan_qty) != null && <li>• Plan sayımı: {pdf?.planQty ?? prov?.plan_qty}{(pdf?.floorMultiplier ?? prov?.floor_multiplier) ? ` (kat çarpanı ×${pdf?.floorMultiplier ?? prov?.floor_multiplier})` : ''}</li>}
          {(pdf?.codeVariants ?? prov?.code_variants ?? []).length > 1 && <li>• Kod yazımları: {(pdf?.codeVariants ?? prov?.code_variants)!.join(', ')}</li>}
          {item?.drawing_ref?.file_name && <li>• Dosya: {item.drawing_ref.file_name}</li>}
        </ul>
        {pages.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {pages.slice(0, 8).map((p) => (
              <button key={p} type="button" onClick={() => onShow(p)} className="inline-flex h-9 items-center gap-1 rounded-md border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink hover:bg-surface-3" data-testid="review-show-page">
                <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
                Sayfa {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Teknik özellikler */}
      {attrs && (
        <div className="px-4 pt-2.5" data-testid="review-attrs">
          <div className="mb-1 font-semibold text-ink">Teknik özellikler</div>
          <dl className="space-y-1">
            {(Object.keys(ATTR_LABEL) as AttrKey[])
              .filter((k) => attrs[k])
              .map((k) => {
                const v = attrs[k]!
                return (
                  <div key={k} className="rounded-md border border-line px-2 py-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-[11px] text-muted">{ATTR_LABEL[k]}</dt>
                      <dd className={cn('text-[10.5px] font-semibold whitespace-nowrap', STATUS_CLS[v.status])}>{ATTR_STATUS_LABEL[v.status]}</dd>
                    </div>
                    <div className="text-ink">{v.value || '—'}</div>
                    <div className="text-[10.5px] break-words text-subtle">{v.source}</div>
                  </div>
                )
              })}
          </dl>
        </div>
      )}

      {/* Kanıt ve belirsizlik */}
      {(candidate || item?.detection) && (
        <details className="px-4 pt-2.5">
          <summary className="cursor-pointer font-semibold text-ink">Kanıtlar ve belirsizlikler</summary>
          <ul className="mt-1 space-y-0.5 text-[11.5px]">
            {(candidate?.reasons ?? item?.detection?.reasons ?? []).map((r) => (
              <li key={r} className="text-warn">
                • {r}
              </li>
            ))}
            {(candidate?.evidence ?? item?.detection?.evidence ?? []).map((r) => (
              <li key={r} className="text-muted">
                ✓ {r}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Onay bilgisi */}
      {item?.approved_at && (
        <p className="px-4 pt-2 text-[11.5px] text-ok" data-testid="review-approved-at">
          Onay: {dtf.format(new Date(item.approved_at))}
        </p>
      )}

      {/* İşlemler */}
      {!readOnly && (
        <div className="px-4 pt-3 pb-3">
          <label className="flex flex-col gap-0.5 text-[11px] text-muted">
            İnceleme notu (düzeltme / red / belirsizlik nedeni)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} className="rounded-md border border-line bg-surface px-2 py-1.5 text-base text-ink sm:text-[12.5px]" data-testid="review-note" />
          </label>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={busy || !approvable || item?.verification === 'onaylandi'}
              onClick={() => void approve()}
              title={approvable ? 'Ölçü, adet ve iş grubunu onayla' : 'Onay için iş grubu (malzeme) seçilmeli ve ölçüler tamamlanmalı'}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-ok/30 bg-ok-soft text-[12.5px] font-semibold text-ok disabled:opacity-45"
              data-testid="review-approve"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Onayla
            </button>
            <button type="button" onClick={() => setEditing((v) => !v)} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface text-[12.5px] font-semibold text-ink" data-testid="review-edit-toggle" aria-pressed={editing}>
              <PencilLine className="h-4 w-4" aria-hidden="true" />
              {editing ? 'Düzeltmeyi bitir' : 'Düzelt'}
            </button>
            <button type="button" disabled={busy || !!item?.uncertain} onClick={() => void uncertain()} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-warn-line bg-warn-soft text-[12.5px] font-semibold text-warn disabled:opacity-45" data-testid="review-uncertain">
              <CircleHelp className="h-4 w-4" aria-hidden="true" />
              Belirsiz
            </button>
            <button type="button" disabled={busy || item?.verification === 'reddedildi'} onClick={() => void reject()} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface text-[12.5px] font-semibold text-muted disabled:opacity-45" data-testid="review-reject">
              <CircleSlash className="h-4 w-4" aria-hidden="true" />
              Reddet
            </button>
          </div>
          {!approvable && <p className="mt-1.5 text-[11px] text-warn">Onay için iş grubu (PVC / alüminyum vb.) seçilmeli ve en, boy, adet tamamlanmalı.</p>}
          {!item && <p className="mt-1.5 text-[11px] text-subtle">Onay veya "Belirsiz" pozu metraja ekler; "Reddet" öneriyi listeden kaldırır.</p>}
        </div>
      )}

      {item && store.kind === 'remote' && (
        <details className="px-4 pb-3">
          <summary className="cursor-pointer text-[12px] font-semibold text-muted hover:text-ink">Düzeltme geçmişi</summary>
          <div className="mt-2">
            <ItemHistory key={`${item.id}-${item.version}`} itemId={item.id} />
          </div>
        </details>
      )}
    </section>
  )
}
