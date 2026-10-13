import { ArrowDown, ArrowUp, Copy, Pencil, Ruler, Trash2 } from 'lucide-react'
import { formatMilli } from '@/quantity/precision'
import { itemDims, type ItemCalc } from '@/quote/engine'
import { formatMoney } from '@/quote/money'
import { type Currency, type QuoteItem, QUOTE_UNIT_LABEL } from '@/quote/types'
import { cn } from '@/lib/cn'
import { UnverifiedBadge } from './shared'

interface Props {
  items: QuoteItem[]
  calcs: ItemCalc[]
  currency: Currency
  detailed: boolean
  editable: boolean
  busy: boolean
  onEdit: (i: QuoteItem) => void
  onDuplicate: (i: QuoteItem) => void
  onDelete: (i: QuoteItem) => void
  onMove: (i: QuoteItem, dir: -1 | 1) => void
}

function Source({ i }: { i: QuoteItem }) {
  if (i.source !== 'metraj') return null
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium text-muted" title={i.source_label ?? 'Metrajdan aktarıldı'}>
      <Ruler className="h-3 w-3" aria-hidden="true" />
      {i.source_item_id ? 'Metraj' : 'Metraj (kaynak silinmiş)'}
    </span>
  )
}

function Actions({ i, idx, count, editable, busy, onEdit, onDuplicate, onDelete, onMove }: Omit<Props, 'items' | 'calcs' | 'currency' | 'detailed'> & { i: QuoteItem; idx: number; count: number }) {
  if (!editable) return null
  const b = 'grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30'
  return (
    <div className="-ml-1.5 flex flex-wrap items-center gap-0.5">
      <button type="button" className={b} onClick={() => onMove(i, -1)} disabled={busy || idx === 0} aria-label={`${i.poz_code ?? 'Kalem'} yukarı taşı`}>
        <ArrowUp className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" className={b} onClick={() => onMove(i, 1)} disabled={busy || idx === count - 1} aria-label={`${i.poz_code ?? 'Kalem'} aşağı taşı`}>
        <ArrowDown className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" className={b} onClick={() => onEdit(i)} disabled={busy} aria-label={`${i.poz_code ?? i.description} düzenle`} data-testid="qi-edit">
        <Pencil className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" className={b} onClick={() => onDuplicate(i)} disabled={busy} aria-label={`${i.poz_code ?? i.description} çoğalt`} data-testid="qi-duplicate">
        <Copy className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" className={cn(b, 'hover:text-danger')} onClick={() => onDelete(i)} disabled={busy} aria-label={`${i.poz_code ?? i.description} sil`} data-testid="qi-delete">
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

export function QuoteItemsTable(props: Props) {
  const { items, calcs, currency, detailed } = props
  const qtyText = (i: QuoteItem, c: ItemCalc) => (c.ok ? `${formatMilli(c.qty)} ${QUOTE_UNIT_LABEL[i.unit]}` : 'Hatalı')
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-[13px]" data-testid="quote-items">
          <thead className="border-b border-line bg-surface-2 text-[11px] tracking-[0.06em] text-muted uppercase">
            <tr>
              <th className="w-10 px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">Poz · Açıklama</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Ölçü · Adet</th>
              <th className="px-3 py-2.5 text-right">Miktar</th>
              {detailed && <th className="px-3 py-2.5 text-right whitespace-nowrap">Birim fiyat</th>}
              {detailed && <th className="px-3 py-2.5 text-right">Tutar</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((i, idx) => {
              const c = calcs[idx]
              return (
                <tr key={i.id} className={cn(!c.ok && 'bg-danger-soft/40')} data-testid="qi-row">
                  <td className="px-3 py-2.5 align-top font-mono text-subtle">{idx + 1}</td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {i.poz_code && <span className="font-mono font-semibold text-ink">{i.poz_code}</span>}
                      {i.system_type && <span className="text-[12px] text-muted">{i.system_type}</span>}
                      <Source i={i} />
                      {!i.measure_verified && <UnverifiedBadge />}
                    </div>
                    <p className="mt-0.5 min-w-[160px] text-ink-2">{i.description}</p>
                    {i.notes && <p className="mt-0.5 max-w-[460px] text-[12px] text-muted">{i.notes}</p>}
                    {[...c.errors, ...c.warnings.filter((w) => !/doğrulanmadı/.test(w))].map((m) => (
                      <p key={m} className={cn('mt-0.5 text-[12px]', c.errors.includes(m) ? 'text-danger' : 'text-warn')}>
                        {m}
                      </p>
                    ))}
                    {props.editable && (
                      <div className="mt-1">
                        <Actions {...props} i={i} idx={idx} count={items.length} />
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 align-top whitespace-nowrap text-ink-2">
                    {itemDims(i)}
                    <span className="block text-[12px] text-muted">× {String(i.quantity).replace('.', ',')} adet</span>
                  </td>
                  <td className="px-3 py-2.5 text-right align-top font-mono whitespace-nowrap" data-testid="qi-qty">
                    {qtyText(i, c)}
                  </td>
                  {detailed && <td className="px-3 py-2.5 text-right align-top font-mono whitespace-nowrap">{formatMoney(c.unitPrice, currency)}</td>}
                  {detailed && (
                    <td className="px-3 py-2.5 text-right align-top font-mono font-semibold whitespace-nowrap text-ink" data-testid="qi-total">
                      {formatMoney(c.lineTotal, currency)}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line md:hidden">
        {items.map((i, idx) => {
          const c = calcs[idx]
          return (
            <li key={i.id} className="px-4 py-3" data-testid="qi-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[12px] text-subtle">{idx + 1}.</span>
                    {i.poz_code && <span className="font-mono font-semibold text-ink">{i.poz_code}</span>}
                    <Source i={i} />
                    {!i.measure_verified && <UnverifiedBadge />}
                  </div>
                  <p className="mt-0.5 text-[13.5px] text-ink-2">{i.description}</p>
                </div>
                {detailed && <span className="shrink-0 font-mono text-[13.5px] font-semibold text-ink">{formatMoney(c.lineTotal, currency)}</span>}
              </div>
              <p className="mt-1 text-[12.5px] text-muted">
                {itemDims(i)} · {String(i.quantity).replace('.', ',')} adet · {qtyText(i, c)}
                {detailed && ` · ${formatMoney(c.unitPrice, currency)} / ${QUOTE_UNIT_LABEL[i.unit]}`}
              </p>
              {c.errors.map((m) => (
                <p key={m} className="mt-0.5 text-[12px] text-danger">
                  {m}
                </p>
              ))}
              <div className="mt-1">
                <Actions {...props} i={i} idx={idx} count={items.length} />
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
