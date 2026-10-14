import { FileText, Percent } from 'lucide-react'
import { useEffect, useState } from 'react'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Panel } from '@/components/ui/Panel'
import { listContacts } from '@/data/api'
import type { Contact } from '@/data/types'
import { requireSupabase } from '@/lib/supabase'
import { CURRENCY_SYMBOL } from '@/quote/money'
import { DELIVERY_TEMPLATES, NOTE_TEMPLATES, PAYMENT_TEMPLATES, SCOPE_TEMPLATES } from '@/quote/templates'
import { CURRENCIES, type Currency, type DiscountKind } from '@/quote/types'
import type { DraftErrors, QuoteDraft } from './draft'

interface Props {
  draft: QuoteDraft
  errors: DraftErrors
  locked: boolean
  companyId: string
  onChange: (patch: Partial<QuoteDraft>) => void
}

/** Şablon metnini alana ekler (boşsa yazar, doluysa yeni satıra ekler) */
function Templates({ items, onPick, disabled }: { items: string[]; onPick: (t: string) => void; disabled: boolean }) {
  if (disabled) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {items.map((t) => (
        <button key={t} type="button" onClick={() => onPick(t)} className="max-w-full truncate rounded-lg border border-line bg-surface px-2 py-1 text-left text-[11.5px] text-muted hover:bg-surface-2 hover:text-ink" title={t}>
          + {t.length > 48 ? `${t.slice(0, 48)}…` : t}
        </button>
      ))}
    </div>
  )
}

const append = (cur: string, t: string) => (cur.trim() ? `${cur.trimEnd()}\n${t}` : t)

export function QuoteInfoPanel({ draft, errors, locked, companyId, onChange }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([])
  useEffect(() => {
    let cancelled = false
    listContacts(requireSupabase(), companyId)
      .then((c) => !cancelled && setContacts(c))
      .catch(() => !cancelled && setContacts([]))
    return () => {
      cancelled = true
    }
  }, [companyId])
  const t = (k: keyof QuoteDraft) => (e: { target: { value: string } }) => onChange({ [k]: e.target.value } as Partial<QuoteDraft>)
  return (
    <Panel title="Teklif bilgileri" subtitle="PDF'te müşteriye görünen bilgiler" icon={FileText}>
      <fieldset disabled={locked} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Başlık" required value={draft.title} error={errors.title} onChange={t('title')} maxLength={200} className="sm:col-span-2" data-testid="qe-title" />
        <TextField label="Teklif tarihi" type="date" value={draft.quote_date} error={errors.quote_date} onChange={t('quote_date')} />
        <TextField label="Geçerlilik tarihi" type="date" value={draft.valid_until} error={errors.valid_until} onChange={t('valid_until')} data-testid="qe-valid" />
        <SelectField label="İlgili kişi" value={draft.contact_id} onChange={t('contact_id')} hint={contacts.length ? undefined : 'Firmada kayıtlı ilgili kişi yok'}>
          <option value="">—</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
              {c.title ? ` · ${c.title}` : ''}
            </option>
          ))}
        </SelectField>
        <div className="sm:col-span-2">
          <TextAreaField label="Kapsam" value={draft.scope} error={errors.scope} onChange={t('scope')} maxLength={5000} rows={3} />
          <Templates items={SCOPE_TEMPLATES} disabled={locked} onPick={(x) => onChange({ scope: append(draft.scope, x) })} />
        </div>
        <div>
          <TextAreaField label="Ödeme şartları" value={draft.payment_terms} error={errors.payment_terms} onChange={t('payment_terms')} maxLength={2000} rows={3} data-testid="qe-payment" />
          <Templates items={PAYMENT_TEMPLATES} disabled={locked} onPick={(x) => onChange({ payment_terms: append(draft.payment_terms, x) })} />
        </div>
        <div>
          <TextAreaField label="Teslim / montaj" value={draft.delivery_terms} error={errors.delivery_terms} onChange={t('delivery_terms')} maxLength={2000} rows={3} />
          <Templates items={DELIVERY_TEMPLATES} disabled={locked} onPick={(x) => onChange({ delivery_terms: append(draft.delivery_terms, x) })} />
        </div>
        <div className="sm:col-span-2">
          <TextAreaField label="Açıklamalar ve koşullar" value={draft.notes} error={errors.notes} onChange={t('notes')} maxLength={5000} rows={3} />
          <Templates items={NOTE_TEMPLATES} disabled={locked} onPick={(x) => onChange({ notes: append(draft.notes, x) })} />
        </div>
      </fieldset>
      <div className="mt-4">
        <TextAreaField
          label="İç not (müşteriye görünmez)"
          value={draft.internal_notes}
          error={errors.internal_notes}
          onChange={t('internal_notes')}
          maxLength={5000}
          rows={2}
          hint="Gönderilmiş teklifte de güncellenebilir; PDF'e yazılmaz."
        />
      </div>
    </Panel>
  )
}

export function QuotePricingPanel({ draft, errors, locked, onChange }: Omit<Props, 'companyId'>) {
  const cur = CURRENCY_SYMBOL[draft.currency]
  const t = (k: keyof QuoteDraft) => (e: { target: { value: string } }) => onChange({ [k]: e.target.value } as Partial<QuoteDraft>)
  const detailed = draft.pricing_mode === 'detayli'
  return (
    <Panel title="Fiyatlandırma" subtitle="Maliyet, kâr, indirim ve KDV" icon={Percent}>
      <fieldset disabled={locked} className="space-y-4">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Fiyatlandırma türü">
          {(
            [
              ['detayli', 'Detaylı'],
              ['toplam', 'Toplam bedel'],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={draft.pricing_mode === v}
              onClick={() => onChange({ pricing_mode: v })}
              className={`h-10 rounded-xl border text-sm font-semibold ${draft.pricing_mode === v ? 'border-titanium bg-surface-2 text-ink' : 'border-line text-muted hover:text-ink'}`}
              data-testid={`qe-mode-${v}`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Para birimi" value={draft.currency} onChange={(e) => onChange({ currency: e.target.value as Currency })} data-testid="qe-currency">
            {CURRENCIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.value}
              </option>
            ))}
          </SelectField>
          <TextField label="KDV (%)" inputMode="decimal" value={draft.vat_pct} error={errors.vat_pct} onChange={t('vat_pct')} data-testid="qe-vat" />
        </div>
        {detailed ? (
          <div className="grid grid-cols-3 gap-3">
            <TextField label="Fire (%)" inputMode="decimal" value={draft.waste_pct} error={errors.waste_pct} onChange={t('waste_pct')} hint="Malzemeye" data-testid="qe-waste" />
            <TextField label="Genel gider (%)" inputMode="decimal" value={draft.overhead_pct} error={errors.overhead_pct} onChange={t('overhead_pct')} data-testid="qe-overhead" />
            <TextField label="Kâr oranı (%)" inputMode="decimal" value={draft.profit_pct} error={errors.profit_pct} onChange={t('profit_pct')} hint="Maliyet üzerine" data-testid="qe-profit" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <TextField label={`Teklif bedeli (${cur}, KDV hariç)`} required inputMode="decimal" value={draft.lump_sum} error={errors.lump_sum} onChange={t('lump_sum')} data-testid="qe-lump" />
            <TextField label={`Tahmini maliyet (${cur})`} inputMode="decimal" value={draft.lump_cost} error={errors.lump_cost} onChange={t('lump_cost')} hint="İsteğe bağlı; kâr hesabı için" />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <TextField label={`Nakliye (${cur})`} inputMode="decimal" value={draft.shipping_amount} error={errors.shipping_amount} onChange={t('shipping_amount')} data-testid="qe-shipping" />
          <TextField label={`Diğer giderler (${cur})`} inputMode="decimal" value={draft.other_amount} error={errors.other_amount} onChange={t('other_amount')} />
          {Number(draft.other_amount.replace(',', '.')) > 0 && <TextField label="Diğer giderler açıklaması" value={draft.other_label} onChange={t('other_label')} maxLength={80} className="col-span-2" placeholder="Ör. İskele kiralama" />}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="İndirim" value={draft.discount_kind} onChange={(e) => onChange({ discount_kind: e.target.value as DiscountKind })} data-testid="qe-discount-kind">
            <option value="yok">İndirim yok</option>
            <option value="yuzde">Yüzde (%)</option>
            <option value="tutar">Tutar ({cur})</option>
          </SelectField>
          {draft.discount_kind !== 'yok' && (
            <TextField label={draft.discount_kind === 'yuzde' ? 'İndirim (%)' : `İndirim (${cur})`} inputMode="decimal" value={draft.discount_value} error={errors.discount_value} onChange={t('discount_value')} data-testid="qe-discount" />
          )}
        </div>
        <label className="flex items-start gap-2 text-[13px] text-ink-2">
          <input type="checkbox" className="mt-0.5" checked={draft.hide_unit_prices} onChange={(e) => onChange({ hide_unit_prices: e.target.checked })} data-testid="qe-hide-prices" />
          <span>
            PDF'te birim fiyatları gizle
            <span className="block text-[12px] text-muted">Kalemler miktarlarıyla listelenir; yalnızca toplamlar gösterilir.</span>
          </span>
        </label>
      </fieldset>
    </Panel>
  )
}
