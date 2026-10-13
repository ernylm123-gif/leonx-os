import { CheckCircle2, CircleSlash, Clock3, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { listItemHistory } from '@/data/quantityApi'
import type { QuantityItemHistory } from '@/data/types'
import { cn } from '@/lib/cn'
import { requireSupabase } from '@/lib/supabase'
import { computeItem } from '@/quantity/engine'
import { canApprove } from '@/quantity/fromDetection'
import { formatCenti, formatMilli } from '@/quantity/precision'
import { CATEGORY_INFO, type QuantityItem, UNIT_LABEL, type Verification } from '@/quantity/types'
import { VerificationChip } from './QuantityTable'
import type { ItemsStore } from './useItemsStore'

const FIELD_LABEL: Record<string, string> = {
  poz_code: 'Poz kodu',
  category: 'İş grubu',
  floor: 'Kat',
  space: 'Mahal',
  shape: 'Şekil',
  width_mm: 'Genişlik',
  height_mm: 'Yükseklik',
  height2_mm: 'Sağ yükseklik',
  apex_mm: 'Tepe konumu',
  rise_mm: 'Kemer yüksekliği',
  vertices: 'Köşeler',
  manual_area_m2: 'Elle alan',
  manual_perimeter_m: 'Elle çevre',
  manual_quantity: 'Birim miktar',
  quantity: 'Adet',
  unit: 'Birim',
  measure_basis: 'Ölçü esası',
  install_gap_mm: 'Montaj payı',
  glass_mode: 'Cam hesabı',
  glass_deduction_mm: 'Profil düşümü',
  glass_manual_m2: 'Cam alanı',
  description: 'Açıklama',
  verification: 'Doğrulama',
  sort_order: 'Sıra',
  drawing_ref: 'Çizim referansı',
  detection: 'Tespit bilgisi',
}

const dtf = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const show = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'object' ? '(değişti)' : String(v))

export function ItemHistory({ itemId }: { itemId: string }) {
  const [rows, setRows] = useState<QuantityItemHistory[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    listItemHistory(requireSupabase(), itemId)
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
  }, [itemId])
  if (error) return <p className="text-[12px] text-danger">Geçmiş yüklenemedi.</p>
  if (!rows) return <p className="text-[12px] text-muted">Yükleniyor…</p>
  if (!rows.length) return <p className="text-[12px] text-muted">Kayıt yok.</p>
  return (
    <ol className="space-y-2" data-testid="item-history">
      {rows.map((h) => (
        <li key={h.id} className="text-[12px]">
          <div className="flex items-center gap-1.5 text-muted">
            <Clock3 className="h-3 w-3" aria-hidden="true" />
            {dtf.format(new Date(h.changed_at))} · {h.action === 'ekle' ? 'Eklendi' : h.action === 'sil' ? 'Silindi' : 'Düzeltildi'}
          </div>
          {h.action === 'guncelle' && (
            <ul className="mt-0.5 space-y-0.5 pl-4.5">
              {Object.entries(h.changes).map(([k, c]) => (
                <li key={k} className="text-ink-2">
                  {FIELD_LABEL[k] ?? k}: <span className="text-muted line-through">{show(c.eski)}</span> → <span className="text-ink">{show(c.yeni)}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}

/** Seçili poz: hesap özeti, tespit bilgisi, doğrulama işlemleri ve düzeltme geçmişi */
export function ItemDetail({ item, store, onClose }: { item: QuantityItem; store: ItemsStore; onClose: () => void }) {
  const r = computeItem(item)
  const approvable = canApprove(item)
  const setVer = (v: Verification) => store.update(item, { verification: v })
  return (
    <section className="border-b border-line" aria-label="Seçili poz" data-testid="item-detail">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-ink">
          <span className="truncate font-mono">{item.poz_code}</span>
          <VerificationChip v={item.verification} />
        </h2>
        <button type="button" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink" aria-label="Poz ayrıntısını kapat">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-2.5 text-[12px]">
        <dt className="text-muted">İş grubu</dt>
        <dd className="text-right text-ink">{CATEGORY_INFO[item.category]?.label}</dd>
        <dt className="text-muted">Adet</dt>
        <dd className="text-right font-mono text-ink">{item.quantity}</dd>
        {r.unit.frameArea != null && (
          <>
            <dt className="text-muted">Birim alan</dt>
            <dd className="text-right font-mono text-ink">{formatMilli(r.unit.frameArea)} m²</dd>
          </>
        )}
        {r.primary && (
          <>
            <dt className="text-muted">Metraj</dt>
            <dd className="text-right font-mono font-semibold text-ink">
              {formatCenti(r.primary.centi)} {UNIT_LABEL[r.primary.unit]}
            </dd>
          </>
        )}
      </dl>
      {!r.ok && (
        <ul className="mx-4 mb-2 space-y-0.5 rounded-lg border border-danger/30 bg-danger-soft px-2.5 py-2 text-[12px] text-danger">
          {r.errors.map((e) => (
            <li key={e.message}>{e.message}</li>
          ))}
        </ul>
      )}
      {r.warnings.length > 0 && (
        <ul className="mx-4 mb-2 space-y-0.5 text-[11.5px] text-warn">
          {r.warnings.map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
      )}
      {item.detection && (
        <div className="mx-4 mb-2 rounded-lg border border-line bg-surface-2/60 px-2.5 py-2 text-[11.5px]">
          <div className="font-semibold text-ink-2">
            Otomatik tespit · güven %{Math.round(item.detection.confidence * 100)} · öneri: {CATEGORY_INFO[item.detection.suggested_category]?.label}
          </div>
          {item.detection.reasons.slice(0, 4).map((x) => (
            <div key={x} className="text-warn">
              • {x}
            </div>
          ))}
        </div>
      )}
      {!store.readOnly && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          <button
            type="button"
            disabled={!approvable || item.verification === 'onaylandi'}
            onClick={() => void setVer('onaylandi')}
            title={approvable ? undefined : 'Onay için iş grubu seçilmeli ve hesap hatasız olmalı'}
            className={cn('inline-flex h-8 items-center gap-1 rounded-lg border border-ok/30 bg-ok-soft px-2.5 text-[12px] font-semibold text-ok disabled:opacity-45')}
            data-testid="item-approve"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Onayla
          </button>
          <button type="button" disabled={item.verification === 'bekliyor'} onClick={() => void setVer('bekliyor')} className="h-8 rounded-lg border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink disabled:opacity-45">
            Doğrulamaya al
          </button>
          <button
            type="button"
            disabled={item.verification === 'reddedildi'}
            onClick={() => void setVer('reddedildi')}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface px-2.5 text-[12px] font-semibold text-muted disabled:opacity-45"
          >
            <CircleSlash className="h-3.5 w-3.5" aria-hidden="true" />
            Reddet
          </button>
        </div>
      )}
      {store.kind === 'remote' && (
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
