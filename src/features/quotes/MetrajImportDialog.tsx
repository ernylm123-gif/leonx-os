import { AlertTriangle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormAlert, SelectField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { createQuoteItems } from '@/data/quoteApi'
import { listItems, listTakeoffs } from '@/data/quantityApi'
import type { QuantityTakeoff } from '@/data/types'
import { dataErrorMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { computeItem } from '@/quantity/engine'
import { formatCenti } from '@/quantity/precision'
import { CATEGORY_INFO, type QuantityItem } from '@/quantity/types'
import { quantityToQuoteItems } from '@/quote/fromQuantity'
import type { Quote, QuoteItem } from '@/quote/types'

const TAKEOFF_STATUS = { taslak: 'Taslak', onaylandi: 'Onaylı', arsiv: 'Arşiv' } as const
const VER = { onaylandi: 'Onaylı', bekliyor: 'Doğrulama bekliyor', reddedildi: 'Reddedildi' } as const

/** CAD metrajındaki pozları teklif kalemine aktarır; ölçü kaynağı ve doğrulama durumu korunur. */
export function MetrajImportDialog({ open, onClose, quote, existing, onImported }: { open: boolean; onClose: () => void; quote: Quote; existing: QuoteItem[]; onImported?: () => void }) {
  const { projects } = useData()
  const { notify } = useToast()
  const [projectId, setProjectId] = useState('')
  const [takeoffs, setTakeoffs] = useState<QuantityTakeoff[]>([])
  const [takeoffId, setTakeoffId] = useState('')
  const [items, setItems] = useState<QuantityItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const imported = useMemo(() => new Set(existing.map((i) => i.source_item_id).filter(Boolean) as string[]), [existing])

  useEffect(() => {
    if (open) {
      setProjectId(quote.project_id ?? '')
      setError(null)
    }
  }, [open, quote.project_id])

  useEffect(() => {
    if (!open || !projectId) {
      setTakeoffs([])
      setTakeoffId('')
      return
    }
    let cancelled = false
    setLoading(true)
    listTakeoffs(requireSupabase(), projectId)
      .then((t) => {
        if (cancelled) return
        setTakeoffs(t)
        setTakeoffId((t.find((x) => x.status === 'onaylandi') ?? t[0])?.id ?? '')
      })
      .catch((e) => !cancelled && setError(dataErrorMessage(e, 'Metraj sürümlerini yükleme')))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [open, projectId])

  useEffect(() => {
    if (!takeoffId) {
      setItems([])
      setSelected(new Set())
      return
    }
    let cancelled = false
    setLoading(true)
    listItems(requireSupabase(), takeoffId)
      .then((rows) => {
        if (cancelled) return
        setItems(rows)
        // Varsayılan: reddedilmemiş ve daha önce aktarılmamış pozlar
        // Varsayılan: yalnız onaylı pozlar (doğrulanmamış ölçü kesin teklife kendiliğinden girmez)
        setSelected(new Set(rows.filter((r) => r.verification === 'onaylandi' && !imported.has(r.id)).map((r) => r.id)))
      })
      .catch((e) => !cancelled && setError(dataErrorMessage(e, 'Pozları yükleme')))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [takeoffId, imported])

  const takeoff = takeoffs.find((t) => t.id === takeoffId)
  const chosen = items.filter((i) => selected.has(i.id))
  const unverified = chosen.filter((i) => i.verification !== 'onaylandi').length
  const dup = chosen.filter((i) => imported.has(i.id)).length

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const submit = async () => {
    if (!takeoff || chosen.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const startSort = existing.reduce((m, i) => Math.max(m, i.sort_order), 0) + 1
      const { items: inputs, skipped } = quantityToQuoteItems(chosen, takeoff, startSort)
      await createQuoteItems(requireSupabase(), quote.id, inputs)
      notify(`${inputs.length} kalem metrajdan aktarıldı${skipped.length ? `, ${skipped.length} poz atlandı (${skipped.map((s) => `${s.poz}: ${s.reason}`).join('; ')})` : ''}.`, skipped.length ? 'info' : 'success')
      onImported?.()
      onClose()
    } catch (e) {
      setError(dataErrorMessage(e, 'Aktarma'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title="Metrajdan aktar"
      description="CAD analizinden oluşturulan metraj pozları, ölçüleri ve kaynağıyla birlikte teklife eklenir. Fiyatları aktarımdan sonra girersiniz."
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[13px] text-muted">
            {chosen.length} poz seçili{unverified ? ` · ${unverified} doğrulanmamış ölçü` : ''}
          </span>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Vazgeç
            </Button>
            <Button variant="primary" onClick={() => void submit()} disabled={busy || chosen.length === 0} data-testid="import-submit">
              {busy ? 'Aktarılıyor…' : `${chosen.length} pozu aktar`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <FormAlert>{error}</FormAlert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField label="Proje" value={projectId} onChange={(e) => setProjectId(e.target.value)} data-testid="import-project">
            <option value="">Proje seçin…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Metraj sürümü" value={takeoffId} onChange={(e) => setTakeoffId(e.target.value)} disabled={!takeoffs.length} hint={projectId && !loading && !takeoffs.length ? 'Bu projede metraj yok. CAD Analiz ekranından oluşturabilirsiniz.' : undefined} data-testid="import-takeoff">
            {takeoffs.map((t) => (
              <option key={t.id} value={t.id}>
                Rev {t.revision} · {t.name} · {TAKEOFF_STATUS[t.status]}
              </option>
            ))}
          </SelectField>
        </div>
        {takeoff && takeoff.status !== 'onaylandi' && (
          <p className="flex items-start gap-2 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-2.5 text-[12.5px] text-warn">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Bu metraj sürümü onaylanmamış. Onay bekleyen ölçüler teklifte "Ölçü doğrulanmadı" olarak işaretlenir.
          </p>
        )}
        {dup > 0 && (
          <p className="rounded-xl border border-warn-line bg-warn-soft px-3.5 py-2.5 text-[12.5px] text-warn" data-testid="import-duplicate">
            {dup} poz bu teklife daha önce aktarıldı; yeniden aktarılırsa iki kez sayılır.
          </p>
        )}
        {items.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-surface-2 text-[11px] tracking-[0.06em] text-muted uppercase">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Tümünü seç"
                      checked={selected.size > 0 && selected.size === items.filter((i) => i.verification !== 'reddedildi').length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(items.filter((i) => i.verification !== 'reddedildi').map((i) => i.id)) : new Set())}
                    />
                  </th>
                  <th className="px-3 py-2">Poz</th>
                  <th className="px-3 py-2">İş grubu</th>
                  <th className="px-3 py-2 text-right">Adet</th>
                  <th className="px-3 py-2 text-right">Metraj</th>
                  <th className="px-3 py-2">Doğrulama</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((i) => {
                  const r = computeItem(i)
                  const rejected = i.verification === 'reddedildi'
                  return (
                    <tr key={i.id} className={rejected ? 'text-subtle' : undefined} data-testid="import-row">
                      <td className="px-3 py-2">
                        <input type="checkbox" aria-label={`${i.poz_code} seç`} checked={selected.has(i.id)} disabled={rejected} onChange={() => toggle(i.id)} />
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {i.poz_code}
                        {imported.has(i.id) && <span className="ml-1.5 rounded bg-surface-2 px-1 text-[10.5px] text-muted">aktarıldı</span>}
                      </td>
                      <td className="px-3 py-2">{CATEGORY_INFO[i.category].label}</td>
                      <td className="px-3 py-2 text-right font-mono">{i.quantity}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.ok && r.primary ? `${formatCenti(r.primary.centi)} ${r.primary.unit === 'm2' ? 'm²' : r.primary.unit === 'mtul' ? 'mtül' : r.primary.unit}` : 'Hatalı'}</td>
                      <td className={`px-3 py-2 ${i.verification === 'onaylandi' ? 'text-ok' : rejected ? '' : 'text-warn'}`}>{VER[i.verification]}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {loading && <p className="text-[13px] text-muted">Yükleniyor…</p>}
      </div>
    </Modal>
  )
}
