import { AlertTriangle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { FormAlert, SelectField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { createQuote, createQuoteItems, listQuoteItems, listQuotesBy } from '@/data/quoteApi'
import type { QuantityTakeoff } from '@/data/types'
import { useQuoteSettings } from '@/features/quotes/shared'
import { dataErrorMessage } from '@/lib/errors'
import { addDays, localISODate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useResetOnOpen } from '@/lib/useResetOnOpen'
import { computeItem } from '@/quantity/engine'
import { formatCenti } from '@/quantity/precision'
import type { QuantityItem } from '@/quantity/types'
import { quantityToQuoteItems } from '@/quote/fromQuantity'
import { isEditable, type Quote, type QuoteInput } from '@/quote/types'

const NEW = '__yeni__'

/**
 * Onaylı metraj pozlarını teklife aktarır (Faz 6). Mevcut taslak teklif seçilir veya projenin
 * müşterisi için yeni teklif oluşturulur; ölçü, adet ve kaynak (metraj sürümü) korunur.
 */
export function SendToQuoteDialog({ open, onClose, projectId, takeoff, items }: { open: boolean; onClose: () => void; projectId: string; takeoff: QuantityTakeoff; items: QuantityItem[] }) {
  const { projects } = useData()
  const { values: settings } = useQuoteSettings()
  const { notify } = useToast()
  const navigate = useNavigate()
  const project = projects.find((p) => p.id === projectId) ?? null
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [target, setTarget] = useState(NEW)
  const [includeUnverified, setIncludeUnverified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Açılışta durumu render sırasında sıfırla (effect ile sıfırlamak, açılır açılmaz yapılan seçimleri ezebilir)
  useResetOnOpen(
    open,
    () => {
      setError(null)
      setIncludeUnverified(false)
    },
    [projectId],
  )

  useEffect(() => {
    if (!open) return
    let cancelled = false
    listQuotesBy(requireSupabase(), 'project_id', projectId)
      .then((q) => {
        if (cancelled) return
        const editable = q.filter(isEditable)
        setQuotes(editable)
        setTarget(editable[0]?.id ?? NEW)
      })
      .catch((e) => !cancelled && setError(dataErrorMessage(e, 'Teklifleri yükleme')))
    return () => {
      cancelled = true
    }
  }, [open, projectId])

  const approved = items.filter((i) => i.verification === 'onaylandi')
  const pending = items.filter((i) => i.verification === 'bekliyor')
  const chosen = includeUnverified ? [...approved, ...pending] : approved
  const totals = useMemo(() => {
    let m2 = 0
    let mtul = 0
    for (const i of chosen) {
      const r = computeItem(i)
      if (r.primary?.unit === 'm2') m2 += r.primary.centi
      if (r.primary?.unit === 'mtul') mtul += r.primary.centi
    }
    return { m2, mtul }
  }, [chosen])

  const submit = async () => {
    if (!chosen.length) return
    setBusy(true)
    setError(null)
    try {
      const db = requireSupabase()
      let quoteId = target
      let existingMax = 0
      const already = new Set<string>()
      if (target === NEW) {
        if (!project?.company_id) throw new Error('Projenin müşterisi (firma) tanımlı değil; teklif için önce projeye müşteri atayın.')
        const today = localISODate()
        const input: QuoteInput = {
          company_id: project.company_id,
          contact_id: null,
          project_id: project.id,
          title: project.name.slice(0, 200),
          scope: null,
          quote_date: today,
          valid_until: addDays(today, settings.default_validity_days),
          currency: settings.default_currency,
          pricing_mode: 'detayli',
          lump_sum: null,
          lump_cost: null,
          waste_pct: 0,
          overhead_pct: 0,
          profit_pct: 0,
          shipping_amount: 0,
          other_amount: 0,
          other_label: null,
          discount_kind: 'yok',
          discount_value: 0,
          vat_pct: settings.default_vat_pct,
          hide_unit_prices: false,
          payment_terms: settings.default_payment_terms,
          delivery_terms: settings.default_delivery_terms,
          notes: null,
          internal_notes: null,
        }
        quoteId = (await createQuote(db, input)).id
      } else {
        const ex = await listQuoteItems(db, target)
        existingMax = ex.reduce((m, i) => Math.max(m, i.sort_order), 0)
        for (const i of ex) if (i.source_item_id) already.add(i.source_item_id)
      }
      const fresh = chosen.filter((i) => !already.has(i.id))
      const { items: inputs, skipped } = quantityToQuoteItems(fresh, takeoff, existingMax + 1)
      if (inputs.length) await createQuoteItems(db, quoteId, inputs)
      const dup = chosen.length - fresh.length
      notify(
        `${inputs.length} kalem teklife aktarıldı${dup ? `, ${dup} poz zaten teklifteydi` : ''}${skipped.length ? `, ${skipped.length} poz atlandı (${skipped.map((s) => `${s.poz}: ${s.reason}`).join('; ')})` : ''}.`,
        skipped.length ? 'info' : 'success',
      )
      onClose()
      navigate(`/teklifler/${quoteId}`)
    } catch (e) {
      setError(dataErrorMessage(e, 'Teklife aktarma'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title="Teklife aktar"
      description="Onaylı metraj pozları ölçü, adet ve kaynak bilgisiyle teklif kalemine dönüşür. Fiyatları teklif ekranında girersiniz."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || chosen.length === 0} data-testid="send-quote-submit">
            {busy ? 'Aktarılıyor…' : `${chosen.length} pozu aktar`}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <FormAlert>{error}</FormAlert>}
        <SelectField label="Hedef teklif" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="send-quote-target">
          <option value={NEW}>+ Yeni teklif oluştur ({project?.name ?? 'proje'})</option>
          {quotes.map((q) => (
            <option key={q.id} value={q.id}>
              {q.quote_no} · Rev {q.revision} · {q.title}
            </option>
          ))}
        </SelectField>
        <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-ink">
          <div>
            <strong>{approved.length}</strong> onaylı poz · Metraj Rev {takeoff.revision} ({takeoff.name})
          </div>
          <div className="mt-0.5 text-muted">
            Toplam {formatCenti(totals.m2)} m²{totals.mtul ? ` · ${formatCenti(totals.mtul)} mtül` : ''}
          </div>
        </div>
        {pending.length > 0 && (
          <label className="flex items-start gap-2 text-[13px] text-ink">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={includeUnverified} onChange={(e) => setIncludeUnverified(e.target.checked)} />
            <span>
              Doğrulama bekleyen {pending.length} pozu da aktar
              <span className="mt-0.5 flex items-center gap-1 text-[12px] text-warn">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                Teklifte "ölçü doğrulanmadı" olarak işaretlenir.
              </span>
            </span>
          </label>
        )}
        {!approved.length && !includeUnverified && <p className="text-[13px] text-muted">Aktarmak için önce metrajdaki pozları onaylayın.</p>}
      </div>
    </Modal>
  )
}
