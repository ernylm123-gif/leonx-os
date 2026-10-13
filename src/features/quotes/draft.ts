import type { QuoteCalcParams } from '@/quote/engine'
import type { Currency, DiscountKind, PricingMode, Quote, QuoteInput } from '@/quote/types'
import { numText, parseNum } from './shared'

/** Teklif bilgileri ve fiyatlandırma formu (metin alanları) */
export interface QuoteDraft {
  title: string
  scope: string
  quote_date: string
  valid_until: string
  contact_id: string
  currency: Currency
  pricing_mode: PricingMode
  lump_sum: string
  lump_cost: string
  waste_pct: string
  overhead_pct: string
  profit_pct: string
  shipping_amount: string
  other_amount: string
  other_label: string
  discount_kind: DiscountKind
  discount_value: string
  vat_pct: string
  hide_unit_prices: boolean
  payment_terms: string
  delivery_terms: string
  notes: string
  internal_notes: string
}

export function toDraft(q: Quote): QuoteDraft {
  return {
    title: q.title,
    scope: q.scope ?? '',
    quote_date: q.quote_date,
    valid_until: q.valid_until ?? '',
    contact_id: q.contact_id ?? '',
    currency: q.currency,
    pricing_mode: q.pricing_mode,
    lump_sum: numText(q.lump_sum),
    lump_cost: numText(q.lump_cost),
    waste_pct: numText(q.waste_pct),
    overhead_pct: numText(q.overhead_pct),
    profit_pct: numText(q.profit_pct),
    shipping_amount: numText(q.shipping_amount),
    other_amount: numText(q.other_amount),
    other_label: q.other_label ?? '',
    discount_kind: q.discount_kind,
    discount_value: numText(q.discount_value),
    vat_pct: numText(q.vat_pct),
    hide_unit_prices: q.hide_unit_prices,
    payment_terms: q.payment_terms ?? '',
    delivery_terms: q.delivery_terms ?? '',
    notes: q.notes ?? '',
    internal_notes: q.internal_notes ?? '',
  }
}

export type DraftErrors = Partial<Record<keyof QuoteDraft, string>>
export type DraftPatch = Omit<QuoteInput, 'company_id' | 'project_id'>

const MAX_MONEY = 999_999_999_999

/** Taslağı doğrular ve veritabanına yazılacak alanlara çevirir */
export function parseDraft(d: QuoteDraft): { ok: true; patch: DraftPatch } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {}
  const num = (k: keyof QuoteDraft, raw: string, min: number, max: number, required = false): number | null => {
    const v = parseNum(raw)
    if (v == null) {
      if (required) errors[k] = 'Zorunlu alan.'
      return null
    }
    if (Number.isNaN(v)) errors[k] = 'Geçerli bir sayı girin.'
    else if (v < min) errors[k] = `En az ${min}.`
    else if (v > max) errors[k] = `En fazla ${max.toLocaleString('tr-TR')}.`
    return Number.isNaN(v) ? null : v
  }
  const text = (k: keyof QuoteDraft, raw: string, max: number) => {
    const t = raw.trim()
    if (t.length > max) errors[k] = `En fazla ${max} karakter.`
    return t || null
  }
  const title = d.title.trim()
  if (!title) errors.title = 'Başlık zorunludur.'
  else if (title.length > 200) errors.title = 'En fazla 200 karakter.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.quote_date)) errors.quote_date = 'Geçerli bir tarih girin.'
  if (d.valid_until && !/^\d{4}-\d{2}-\d{2}$/.test(d.valid_until)) errors.valid_until = 'Geçerli bir tarih girin.'
  else if (d.valid_until && d.valid_until < d.quote_date) errors.valid_until = 'Geçerlilik tarihi teklif tarihinden önce olamaz.'
  const lumpSum = num('lump_sum', d.lump_sum, 0, MAX_MONEY, d.pricing_mode === 'toplam')
  const lumpCost = num('lump_cost', d.lump_cost, 0, MAX_MONEY)
  const waste = num('waste_pct', d.waste_pct, 0, 100) ?? 0
  const overhead = num('overhead_pct', d.overhead_pct, 0, 500) ?? 0
  const profit = num('profit_pct', d.profit_pct, 0, 1000) ?? 0
  const shipping = num('shipping_amount', d.shipping_amount, 0, MAX_MONEY) ?? 0
  const other = num('other_amount', d.other_amount, 0, MAX_MONEY) ?? 0
  const discount = d.discount_kind === 'yok' ? 0 : (num('discount_value', d.discount_value, 0, d.discount_kind === 'yuzde' ? 100 : MAX_MONEY, true) ?? 0)
  const vat = num('vat_pct', d.vat_pct, 0, 100, true) ?? 0
  const patch: DraftPatch = {
    title,
    scope: text('scope', d.scope, 5000),
    quote_date: d.quote_date,
    valid_until: d.valid_until || null,
    contact_id: d.contact_id || null,
    currency: d.currency,
    pricing_mode: d.pricing_mode,
    lump_sum: lumpSum,
    lump_cost: lumpCost,
    waste_pct: waste,
    overhead_pct: overhead,
    profit_pct: profit,
    shipping_amount: shipping,
    other_amount: other,
    other_label: text('other_label', d.other_label, 80),
    discount_kind: d.discount_kind,
    discount_value: discount,
    vat_pct: vat,
    hide_unit_prices: d.hide_unit_prices,
    payment_terms: text('payment_terms', d.payment_terms, 2000),
    delivery_terms: text('delivery_terms', d.delivery_terms, 2000),
    notes: text('notes', d.notes, 5000),
    internal_notes: text('internal_notes', d.internal_notes, 5000),
  }
  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, patch }
}

/** Hesap parametreleri: taslak geçerliyse taslaktan (canlı önizleme), değilse kayıtlı tekliften */
export function calcParams(q: Quote, draft: QuoteDraft | null): QuoteCalcParams {
  const p = draft ? parseDraft(draft) : null
  const src = p && p.ok ? p.patch : q
  return {
    pricing_mode: src.pricing_mode,
    lump_sum: src.lump_sum,
    lump_cost: src.lump_cost,
    waste_pct: src.waste_pct,
    overhead_pct: src.overhead_pct,
    profit_pct: src.profit_pct,
    shipping_amount: src.shipping_amount,
    other_amount: src.other_amount,
    discount_kind: src.discount_kind,
    discount_value: src.discount_value,
    vat_pct: src.vat_pct,
  }
}

export function draftEquals(a: QuoteDraft, b: QuoteDraft): boolean {
  return (Object.keys(a) as (keyof QuoteDraft)[]).every((k) => a[k] === b[k])
}
