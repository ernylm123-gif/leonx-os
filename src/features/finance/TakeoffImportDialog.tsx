import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormAlert, SelectField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/context/toast'
import { createCostLines } from '@/data/financeApi'
import { listItems, listTakeoffs } from '@/data/quantityApi'
import type { QuantityTakeoff } from '@/data/types'
import { fromApprovedTakeoff } from '@/finance/fromTakeoff'
import { COST_GROUP_LABEL, type CostLine, type CostRate, FIN_UNIT_LABEL } from '@/finance/types'
import { cn } from '@/lib/cn'
import { localISODate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import type { QuantityItem } from '@/quantity/types'
import { CURRENCY_SYMBOL, formatMoney, toCents } from '@/quote/money'
import type { Currency } from '@/quote/types'
import { FinNotice, finErrorMessage, numToInput, parseAmount } from './shared'

const STATUS_LABEL = { taslak: 'taslak — onaylanmadı', onaylandi: 'onaylı', arsiv: 'arşiv' } as const

/**
 * Onaylı metrajdan tahmini maliyete aktarma. Yalnız onaylı sürümün onaylı pozları; hariç tutulanlar
 * nedenleriyle gösterilir. Katalogda fiyatı olmayan iş "fiyat tanımlanmamış" olarak gelir (sıfır yazılmaz).
 */
export function TakeoffImportDialog({ open, onClose, projectId, lines, rates, base, onImported }: { open: boolean; onClose: () => void; projectId: string; lines: CostLine[]; rates: CostRate[]; base: Currency; onImported?: (rows: CostLine[]) => void }) {
  const { notify } = useToast()
  const [takeoffs, setTakeoffs] = useState<QuantityTakeoff[]>([])
  const [takeoffId, setTakeoffId] = useState('')
  const [items, setItems] = useState<QuantityItem[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [prices, setPrices] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setError(null)
    setSkip(new Set())
    setPrices({})
    let alive = true
    void (async () => {
      try {
        const list = await listTakeoffs(requireSupabase(), projectId)
        if (!alive) return
        setTakeoffs(list)
        const imported = lines.find((l) => l.source === 'metraj' && l.source_takeoff_id)?.source_takeoff_id
        setTakeoffId(imported && list.some((t) => t.id === imported) ? imported : (list.find((t) => t.status === 'onaylandi')?.id ?? list[0]?.id ?? ''))
      } catch (e) {
        if (alive) setError(finErrorMessage(e, 'Metraj listesi'))
      }
    })()
    return () => {
      alive = false
    }
  }, [open, projectId, lines])

  useEffect(() => {
    if (!open || !takeoffId) {
      setItems([])
      return
    }
    let alive = true
    setLoading(true)
    void (async () => {
      try {
        const rows = await listItems(requireSupabase(), takeoffId)
        if (alive) setItems(rows)
      } catch (e) {
        if (alive) setError(finErrorMessage(e, 'Metraj pozları'))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [open, takeoffId])

  const takeoff = takeoffs.find((t) => t.id === takeoffId)
  const plan = useMemo(() => (takeoff ? fromApprovedTakeoff(takeoff, items, rates, lines, localISODate(), base) : null), [takeoff, items, rates, lines, base])
  const blockedBy = plan?.blockedByTakeoff ? takeoffs.find((t) => t.id === plan.blockedByTakeoff) : null
  const chosen = plan ? plan.lines.filter((l) => !skip.has(l.key)) : []
  const priceErrors = chosen.filter((l) => l.needsPrice && prices[l.key]?.trim() && Number.isNaN(parseAmount(prices[l.key])))

  const submit = async () => {
    if (!plan || chosen.length === 0 || plan.blockedByTakeoff || priceErrors.length) return
    setBusy(true)
    setError(null)
    try {
      const startSort = lines.reduce((m, l) => Math.max(m, l.sort_order + 1), 0)
      const rows = chosen.map(({ key, poz: _poz, needsPrice, ...l }, i) => ({
        ...l,
        sort_order: startSort + i,
        unit_cost: needsPrice ? parseAmount(prices[key] ?? '') : l.unit_cost,
      }))
      const saved = await createCostLines(requireSupabase(), rows)
      notify(`${saved.length} maliyet satırı metrajdan aktarıldı.`)
      onImported?.(saved)
      onClose()
    } catch (e) {
      setError(finErrorMessage(e, 'Metraj aktarımı'))
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
      title="Metrajdan maliyete aktar"
      description="Yalnız onaylı metraj sürümünün onaylı pozları aktarılır. Birim maliyetler katalogdan gelir; olmayanlar için siz girersiniz."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !plan || chosen.length === 0 || !!plan.blockedByTakeoff || priceErrors.length > 0} data-testid="ti-submit">
            {busy ? 'Aktarılıyor…' : `${chosen.length} satırı aktar`}
          </Button>
        </>
      }
    >
      {error && <FormAlert>{error}</FormAlert>}
      {takeoffs.length === 0 ? (
        <p className="text-sm text-muted">Bu projede metraj sürümü yok. Önce Metraj modülünde metraj hazırlayıp onaylayın.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <SelectField label="Metraj sürümü" value={takeoffId} onChange={(e) => setTakeoffId(e.target.value)} data-testid="ti-takeoff">
            {takeoffs.map((t) => (
              <option key={t.id} value={t.id}>
                Rev {t.revision} · {t.name} ({STATUS_LABEL[t.status]})
              </option>
            ))}
          </SelectField>
          {takeoff && takeoff.status !== 'onaylandi' && (
            <FinNotice tone="danger" testId="ti-not-approved">
              Bu sürüm onaylı değil; doğrulanmamış metraj maliyete aktarılamaz. Metraj ekranında sürümü onaylayın.
            </FinNotice>
          )}
          {plan?.blockedByTakeoff && (
            <FinNotice tone="danger" testId="ti-blocked">
              Bu projeye {blockedBy ? `Rev ${blockedBy.revision} · ${blockedBy.name}` : 'başka bir metraj sürümü'} zaten aktarılmış. Çift sayımı önlemek için önce o satırları silin.
            </FinNotice>
          )}
          {loading ? (
            <p className="text-sm text-muted">Pozlar yükleniyor…</p>
          ) : plan && plan.lines.length > 0 ? (
            <ul className="divide-y divide-line rounded-xl border border-line" aria-label="Aktarılacak satırlar">
              {plan.lines.map((l) => (
                <li key={l.key} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-[13px]', skip.has(l.key) && 'opacity-50')} data-testid="ti-row" data-needs-price={l.needsPrice}>
                  <input
                    type="checkbox"
                    checked={!skip.has(l.key)}
                    onChange={() => setSkip((s) => (s.has(l.key) ? new Set([...s].filter((k) => k !== l.key)) : new Set(s).add(l.key)))}
                    aria-label={`${l.description} aktar`}
                    className="h-4 w-4 accent-[var(--color-titanium,#8a9099)]"
                  />
                  <span className="min-w-0 flex-1 break-words text-ink">
                    {l.description}
                    <span className="block text-[11px] text-muted">
                      {COST_GROUP_LABEL[l.cost_group]} · {numToInput(l.quantity, 2)} {FIN_UNIT_LABEL[l.unit]}
                    </span>
                  </span>
                  {l.needsPrice ? (
                    <input
                      inputMode="decimal"
                      placeholder={`Birim maliyet (${CURRENCY_SYMBOL[base]})`}
                      value={prices[l.key] ?? ''}
                      onChange={(e) => setPrices((p) => ({ ...p, [l.key]: e.target.value }))}
                      className="h-9 w-36 rounded-lg border border-warn-line bg-surface px-2 text-base sm:text-sm"
                      aria-label={`${l.description} birim maliyet`}
                      data-testid="ti-price"
                    />
                  ) : (
                    <span className="font-mono text-ink-2">
                      {formatMoney(toCents(l.unit_cost ?? 0), l.currency)}/{FIN_UNIT_LABEL[l.unit]}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : plan && takeoff?.status === 'onaylandi' ? (
            <p className="text-sm text-muted">Aktarılacak yeni satır yok.</p>
          ) : null}
          {plan && plan.lines.some((l) => l.needsPrice) && (
            <FinNotice>Fiyatı tanımlanmamış satırlar boş bırakılırsa “fiyat tanımlanmamış” olarak eklenir ve tahmini toplama katılmaz (sıfır kabul edilmez).</FinNotice>
          )}
          {plan && plan.lines.some((l) => l.measure_basis === 'cevre') && (
            <FinNotice tone="info">“Çevre bazlı tahmini” satırlar doğrama dış çevresinden hesaplanır; profil satın alma/kesim boyu değildir.</FinNotice>
          )}
          {plan && plan.alreadyImported > 0 && <p className="text-xs text-muted" data-testid="ti-already">{plan.alreadyImported} satır daha önce aktarıldı ve tekrar eklenmeyecek.</p>}
          {plan && plan.excluded.length > 0 && (
            <div data-testid="ti-excluded">
              <p className="mb-1 text-xs font-semibold text-ink-2">Aktarılmayan pozlar ({plan.excluded.length})</p>
              <ul className="space-y-0.5 text-xs text-muted">
                {plan.excluded.map((x, i) => (
                  <li key={`${x.poz}-${i}`}>
                    <span className="font-mono text-ink-2">{x.poz}</span> — {x.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
