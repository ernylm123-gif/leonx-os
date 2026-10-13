import { AlertTriangle, CheckCheck, Copy, Crosshair, History, Lock, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { cn } from '@/lib/cn'
import { computeItem, type ItemResult, summarize, type Totals } from '@/quantity/engine'
import { formatCenti, formatMilli } from '@/quantity/precision'
import {
  CATEGORY_INFO,
  emptyItem,
  QUANTITY_CATEGORIES,
  type QuantityCategory,
  type QuantityItem,
  type QuantityItemInput,
  SHAPE_LABEL,
  UNIT_LABEL,
  VERIFICATION_LABEL,
  type Verification,
} from '@/quantity/types'
import { QuantityItemForm } from './QuantityItemForm'
import type { ItemsStore } from './useItemsStore'

const VER_STYLE: Record<Verification, string> = {
  onaylandi: 'border-ok/30 bg-ok-soft text-ok',
  bekliyor: 'border-warn-line bg-warn-soft text-warn',
  reddedildi: 'border-line bg-surface-2 text-subtle line-through',
}

export function VerificationChip({ v }: { v: Verification }) {
  return <span className={cn('inline-flex shrink-0 items-center rounded-md border px-1.5 py-px text-[10.5px] font-semibold whitespace-nowrap', VER_STYLE[v])}>{VERIFICATION_LABEL[v]}</span>
}

function inputOf(item: QuantityItem): QuantityItemInput {
  const { id: _id, takeoff_id: _t, project_id: _p, created_by: _c, created_at: _ca, updated_at: _u, version: _v, ...rest } = item
  return rest
}

function dims(item: QuantityItem): string {
  if (item.shape === 'manuel') return item.manual_area_m2 != null ? `${String(item.manual_area_m2).replace('.', ',')} m² (elle)` : '—'
  if (item.shape === 'cokgen') return `${item.vertices?.length ?? 0} köşe`
  if (item.shape === 'daire') return item.width_mm != null ? `Ø ${item.width_mm}` : '—'
  const w = item.width_mm ?? '—'
  const h = item.height_mm ?? '—'
  return item.shape === 'yamuk' ? `${w} × ${h}/${item.height2_mm ?? '—'}` : `${w} × ${h}`
}

export interface QuantityTableProps {
  store: ItemsStore
  compact?: boolean
  /** Çizimde göster (CAD çalışma alanında) */
  onLocate?: (item: QuantityItem) => void
  onHistory?: (item: QuantityItem) => void
  onSelectItem?: (item: QuantityItem | null) => void
  selectedId?: string | null
  /** Yeni poz için varsayılanlar (ör. kat) */
  defaults?: Partial<QuantityItemInput>
}

export function QuantityTable({ store, compact, onLocate, onHistory, onSelectItem, selectedId, defaults }: QuantityTableProps) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<'' | QuantityCategory>('')
  const [floor, setFloor] = useState('')
  const [space, setSpace] = useState('')
  const [ver, setVer] = useState<'' | Verification>('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{ item: QuantityItem | null; initial: QuantityItemInput } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)
  const [bulkCat, setBulkCat] = useState<'' | QuantityCategory>('')

  const results = useMemo(() => new Map(store.items.map((i) => [i.id, computeItem(i)])), [store.items])
  const floors = useMemo(() => [...new Set(store.items.map((i) => i.floor).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'tr')), [store.items])
  const spaces = useMemo(() => [...new Set(store.items.map((i) => i.space).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'tr')), [store.items])

  const filtered = useMemo(() => {
    const term = q.trim().toLocaleLowerCase('tr')
    return store.items
      .filter((i) => (!cat || i.category === cat) && (!floor || i.floor === floor) && (!space || i.space === space) && (!ver || i.verification === ver))
      .filter((i) => !term || [i.poz_code, i.description ?? '', i.floor ?? '', i.space ?? '', CATEGORY_INFO[i.category]?.label ?? ''].some((s) => s.toLocaleLowerCase('tr').includes(term)))
      .sort((a, b) => a.sort_order - b.sort_order || a.poz_code.localeCompare(b.poz_code, 'tr', { numeric: true }))
  }, [store.items, q, cat, floor, space, ver])

  const totals: Totals = useMemo(() => summarize(filtered, filtered.map((i) => results.get(i.id)!)), [filtered, results])
  const filterActive = !!(q || cat || floor || space || ver)
  const ro = store.readOnly
  const selectedItems = filtered.filter((i) => checked.has(i.id))

  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const allChecked = filtered.length > 0 && filtered.every((i) => checked.has(i.id))

  const save = async (input: QuantityItemInput) => {
    setBusy(true)
    try {
      if (editing?.item) {
        const ok = await store.update(editing.item, input)
        if (ok) setEditing(null)
      } else {
        const maxOrder = store.items.reduce((m, i) => Math.max(m, i.sort_order), 0)
        const rows = await store.create([{ ...input, sort_order: maxOrder + 10 }])
        if (rows) setEditing(null)
      }
    } finally {
      setBusy(false)
    }
  }

  const duplicate = async (item: QuantityItem) => {
    const maxOrder = store.items.reduce((m, i) => Math.max(m, i.sort_order), 0)
    await store.create([{ ...inputOf(item), poz_code: `${item.poz_code}-K`.slice(0, 40), sort_order: maxOrder + 10, drawing_ref: item.drawing_ref ? { ...item.drawing_ref } : null }])
  }

  const setQty = async (item: QuantityItem, value: number) => {
    if (!Number.isInteger(value) || value < 1 || value > 100000 || value === item.quantity) return
    await store.update(item, { quantity: value })
  }

  const sel = 'h-9 min-w-0 rounded-lg border border-line bg-surface px-2 text-base text-ink sm:text-[12.5px]'
  return (
    <div className={cn('flex min-h-0 flex-col', compact ? 'h-full' : '')} data-testid="quantity-table">
      {ro && (
        <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {store.readOnlyReason}
        </div>
      )}
      {/* Süzgeçler ve işlemler */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        <label className="relative min-w-[140px] flex-1 sm:max-w-[220px]">
          <span className="sr-only">Poz ara</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Poz, açıklama ara" className={cn(sel, 'w-full pl-8')} data-testid="qt-search" />
        </label>
        <select value={cat} onChange={(e) => setCat(e.target.value as QuantityCategory | '')} className={sel} aria-label="İş grubu süzgeci" data-testid="qt-filter-category">
          <option value="">Tüm iş grupları</option>
          {QUANTITY_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {floors.length > 0 && (
          <select value={floor} onChange={(e) => setFloor(e.target.value)} className={sel} aria-label="Kat süzgeci">
            <option value="">Tüm katlar</option>
            {floors.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        )}
        {spaces.length > 0 && (
          <select value={space} onChange={(e) => setSpace(e.target.value)} className={sel} aria-label="Mahal süzgeci">
            <option value="">Tüm mahaller</option>
            {spaces.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        )}
        <select value={ver} onChange={(e) => setVer(e.target.value as Verification | '')} className={sel} aria-label="Doğrulama süzgeci" data-testid="qt-filter-verification">
          <option value="">Tüm durumlar</option>
          <option value="onaylandi">Onaylı</option>
          <option value="bekliyor">Doğrulama bekleyen</option>
          <option value="reddedildi">Reddedilen</option>
        </select>
        {filterActive && (
          <button
            type="button"
            onClick={() => {
              setQ('')
              setCat('')
              setFloor('')
              setSpace('')
              setVer('')
            }}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-muted hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Temizle
          </button>
        )}
        <div className="flex-1" />
        {!ro && (
          <button
            type="button"
            onClick={() => setEditing({ item: null, initial: emptyItem({ ...defaults, verification: 'onaylandi' }) })}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-ink hover:bg-primary-hover"
            data-testid="qt-add"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Poz ekle
          </button>
        )}
      </div>

      {selectedItems.length > 0 && !ro && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface-2 px-3 py-2 text-[12.5px]" data-testid="qt-bulk">
          <span className="font-semibold text-ink">{selectedItems.length} kalem seçili</span>
          <select value={bulkCat} onChange={(e) => setBulkCat(e.target.value as QuantityCategory | '')} className={sel} aria-label="Toplu iş grubu">
            <option value="">İş grubu ata…</option>
            {QUANTITY_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!bulkCat}
            onClick={async () => {
              await store.updateMany(selectedItems, { category: bulkCat as QuantityCategory })
              setBulkCat('')
            }}
            className="h-9 rounded-lg border border-line bg-surface px-2.5 font-semibold text-ink hover:bg-surface-3 disabled:opacity-45"
            data-testid="qt-bulk-category"
          >
            Uygula
          </button>
          <button
            type="button"
            onClick={() => store.updateMany(selectedItems, { verification: 'onaylandi' })}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-ok/30 bg-ok-soft px-2.5 font-semibold text-ok hover:brightness-95"
            data-testid="qt-bulk-approve"
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Onayla
          </button>
          <button type="button" onClick={() => store.updateMany(selectedItems, { verification: 'bekliyor' })} className="h-9 rounded-lg border border-line bg-surface px-2.5 font-semibold text-ink hover:bg-surface-3">
            Doğrulamaya al
          </button>
          <button type="button" onClick={() => setConfirmDelete(selectedItems.map((i) => i.id))} className="h-9 rounded-lg border border-danger/30 bg-danger-soft px-2.5 font-semibold text-danger">
            Sil
          </button>
          <button type="button" onClick={() => setChecked(new Set())} className="h-9 rounded-lg px-2 font-semibold text-muted hover:text-ink">
            Seçimi kaldır
          </button>
        </div>
      )}

      {/* Tablo */}
      <div className={cn('min-h-0 overflow-auto', compact ? 'flex-1' : 'max-h-[70dvh]')}>
        <table className="w-full min-w-[980px] border-separate border-spacing-0 text-[12.5px]">
          <thead className="sticky top-0 z-[1] bg-surface">
            <tr className="text-left text-[10.5px] font-semibold tracking-wide text-subtle uppercase">
              <th className="w-9 border-b border-line px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Tümünü seç"
                  checked={allChecked}
                  onChange={() => setChecked(allChecked ? new Set() : new Set(filtered.map((i) => i.id)))}
                  disabled={ro}
                />
              </th>
              <th className="border-b border-line px-2 py-2">Poz</th>
              <th className="border-b border-line px-2 py-2">İş grubu</th>
              <th className="border-b border-line px-2 py-2">Kat / Mahal</th>
              <th className="border-b border-line px-2 py-2">Şekil · Ölçü (mm)</th>
              <th className="border-b border-line px-2 py-2 text-right">Adet</th>
              <th className="border-b border-line px-2 py-2 text-right">Birim alan m²</th>
              <th className="border-b border-line px-2 py-2 text-right">Metraj</th>
              <th className="border-b border-line px-2 py-2 text-right">Çevre m</th>
              <th className="border-b border-line px-2 py-2 text-right">Cam m²</th>
              <th className="border-b border-line px-2 py-2">Durum</th>
              <th className="border-b border-line px-2 py-2 text-right">
                <span className="sr-only">İşlemler</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const r = results.get(item.id) as ItemResult
              const selected = selectedId === item.id
              return (
                <tr
                  key={item.id}
                  className={cn('group cursor-default', selected ? 'bg-surface-3' : 'hover:bg-surface-2/70', item.verification === 'reddedildi' && 'opacity-60')}
                  onClick={() => onSelectItem?.(selected ? null : item)}
                  data-testid="qt-row"
                >
                  <td className="border-b border-line/70 px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`${item.poz_code} seç`} checked={checked.has(item.id)} onChange={() => toggle(item.id)} disabled={ro} />
                  </td>
                  <td className="border-b border-line/70 px-2 py-1.5 font-mono font-semibold text-ink">
                    <span className="inline-flex items-center gap-1">
                      {item.poz_code}
                      {!r.ok && (
                        <span title={r.errors.map((e) => e.message).join('\n')} aria-label="Hatalı kalem">
                          <AlertTriangle className="h-3.5 w-3.5 text-danger" aria-hidden="true" />
                        </span>
                      )}
                      {r.ok && r.warnings.length > 0 && (
                        <span title={r.warnings.join('\n')} aria-label="Uyarı var">
                          <AlertTriangle className="h-3.5 w-3.5 text-warn" aria-hidden="true" />
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="border-b border-line/70 px-2 py-1.5 text-ink-2">{CATEGORY_INFO[item.category]?.label}</td>
                  <td className="border-b border-line/70 px-2 py-1.5 text-muted">{[item.floor, item.space].filter(Boolean).join(' / ') || '—'}</td>
                  <td className="border-b border-line/70 px-2 py-1.5 text-ink-2">
                    <span className="text-muted">{SHAPE_LABEL[item.shape]}</span> · <span className="font-mono">{dims(item)}</span>
                  </td>
                  <td className="border-b border-line/70 px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                    {ro ? (
                      <span className="font-mono">{item.quantity}</span>
                    ) : (
                      <input
                        key={`${item.id}-${item.version}`}
                        defaultValue={item.quantity}
                        inputMode="numeric"
                        aria-label={`${item.poz_code} adet`}
                        className="h-8 w-16 rounded-md border border-transparent bg-transparent px-1.5 text-right font-mono text-base text-ink hover:border-line focus:border-titanium focus:bg-surface sm:text-[12.5px]"
                        onBlur={(e) => void setQty(item, Number(e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        }}
                        data-testid="qt-qty"
                      />
                    )}
                  </td>
                  <td className="border-b border-line/70 px-2 py-1.5 text-right font-mono">{r.unit.frameArea != null ? formatMilli(r.unit.frameArea) : '—'}</td>
                  <td className="border-b border-line/70 px-2 py-1.5 text-right font-mono font-semibold text-ink" data-testid="qt-primary">
                    {r.primary ? `${formatCenti(r.primary.centi)} ${UNIT_LABEL[r.primary.unit]}` : '—'}
                  </td>
                  <td className="border-b border-line/70 px-2 py-1.5 text-right font-mono">{r.ok && r.total.perimeter ? formatCenti(r.total.perimeter) : '—'}</td>
                  <td className="border-b border-line/70 px-2 py-1.5 text-right font-mono">{r.ok && r.total.glassArea ? formatCenti(r.total.glassArea) : '—'}</td>
                  <td className="border-b border-line/70 px-2 py-1.5">
                    <VerificationChip v={item.verification} />
                  </td>
                  <td className="border-b border-line/70 px-2 py-1" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-0.5">
                      {onLocate && item.drawing_ref?.boxes?.length ? (
                        <IconBtn label="Çizimde göster" onClick={() => onLocate(item)} icon={Crosshair} />
                      ) : null}
                      {onHistory && <IconBtn label="Değişiklik geçmişi" onClick={() => onHistory(item)} icon={History} />}
                      {!ro && (
                        <>
                          <IconBtn label="Düzenle" onClick={() => setEditing({ item, initial: inputOf(item) })} icon={Pencil} testId="qt-edit" />
                          <IconBtn label="Çoğalt" onClick={() => void duplicate(item)} icon={Copy} testId="qt-duplicate" />
                          <IconBtn label="Sil" onClick={() => setConfirmDelete([item.id])} icon={Trash2} danger testId="qt-delete" />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-[13px] text-muted">
                  {store.loading ? 'Yükleniyor…' : store.items.length === 0 ? 'Henüz poz yok. Çizimden tespit edilen pozları ekleyin veya elle poz girin.' : 'Süzgeçle eşleşen poz yok.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <TotalsBar totals={totals} filtered={filterActive} />

      {editing && (
        <QuantityItemForm
          open={!!editing}
          title={editing.item ? `Poz düzenle — ${editing.item.poz_code}` : 'Yeni poz'}
          initial={editing.initial}
          busy={busy}
          onClose={() => setEditing(null)}
          onSubmit={save}
        />
      )}
      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete && confirmDelete.length > 1 ? `${confirmDelete.length} poz silinsin mi?` : 'Poz silinsin mi?'}
        message="Silinen pozlar metraj toplamlarından çıkarılır. İşlem değişiklik geçmişine kaydedilir."
        busy={busy}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete) return
          setBusy(true)
          const ok = await store.remove(confirmDelete)
          setBusy(false)
          if (ok) {
            setChecked((s) => new Set([...s].filter((id) => !confirmDelete.includes(id))))
            setConfirmDelete(null)
          }
        }}
      />
    </div>
  )
}

function IconBtn({ label, onClick, icon: Icon, danger, testId }: { label: string; onClick: () => void; icon: typeof Pencil; danger?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testId}
      className={cn('grid h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-surface-3', danger ? 'hover:text-danger' : 'hover:text-ink')}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  )
}

/** Toplamlar: onaylı (kesin) ve doğrulama bekleyen ayrı gösterilir */
export function TotalsBar({ totals, filtered }: { totals: Totals; filtered?: boolean }) {
  const v = totals.verified
  const p = totals.pending
  return (
    <div className="shrink-0 border-t border-line bg-surface px-3 py-2 text-[12.5px]" data-testid="qt-totals">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <span className="font-semibold text-ink">{filtered ? 'Süzülen toplam' : 'Onaylı toplam'}</span>
        <span>
          <span className="text-muted">Doğrama </span>
          <span className="font-mono font-semibold text-ink" data-testid="qt-total-area">
            {formatCenti(v.frameArea)} m²
          </span>
        </span>
        {v.length > 0 && (
          <span>
            <span className="text-muted">Doğrusal </span>
            <span className="font-mono font-semibold text-ink">{formatCenti(v.length)} mtül</span>
          </span>
        )}
        <span>
          <span className="text-muted">Çevre </span>
          <span className="font-mono text-ink">{formatCenti(v.perimeter)} m</span>
        </span>
        {v.glassArea > 0 && (
          <span>
            <span className="text-muted">Cam </span>
            <span className="font-mono text-ink">{formatCenti(v.glassArea)} m²</span>
          </span>
        )}
        <span>
          <span className="text-muted">Adet </span>
          <span className="font-mono text-ink">{v.pieces.toLocaleString('tr-TR')}</span>
        </span>
        {(p.items > 0 || totals.invalid > 0) && (
          <span className="ml-auto flex flex-wrap gap-x-3 text-warn" data-testid="qt-pending">
            {p.items > 0 && <span>Doğrulama bekleyen: {p.items} kalem · {formatCenti(p.frameArea)} m² (toplama dahil değil)</span>}
            {totals.invalid > 0 && <span className="text-danger">{totals.invalid} hatalı kalem</span>}
          </span>
        )}
      </div>
    </div>
  )
}
