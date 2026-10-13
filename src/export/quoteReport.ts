/**
 * Teklif rapor modeli — PDF ve Excel aynı modelden üretilir; ekran toplamlarıyla birebir aynıdır
 * (hepsi src/quote/engine.ts ile hesaplanır).
 */
import { COMPANY } from '@/config/company'
import type { Company, Contact, Project } from '@/data/types'
import { formatMilli } from '@/quantity/precision'
import { computeQuote, itemDims, type QuoteTotals } from '@/quote/engine'
import { formatMoney, formatPct } from '@/quote/money'
import { type Quote, type QuoteItem, type QuoteSettingsInput, QUOTE_STATUS_LABEL, QUOTE_UNIT_LABEL } from '@/quote/types'

export interface QuoteReportRow {
  no: number
  poz: string
  description: string
  system: string | null
  notes: string | null
  dims: string
  pieces: number
  qtyMilli: number
  qtyText: string
  unit: string
  unitPrice: number
  lineTotal: number
  verified: boolean
  source: string | null
  ok: boolean
}

export interface QuoteReport {
  quote: Quote
  issuer: { name: string; lines: string[]; bank: string | null; closing: string }
  customer: { name: string; lines: string[] }
  project: { code: string; name: string; location: string | null } | null
  rows: QuoteReportRow[]
  totals: QuoteTotals
  /** Fiyat sütunları gösterilsin mi (gizleme seçeneği veya toplam bedelli teklif) */
  showPrices: boolean
  totalLines: { label: string; value: string; strong?: boolean }[]
  generatedAt: Date
  money: (cents: number) => string
}

const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${iso}T00:00:00`)) : '—')
export const formatQuoteDate = date

export const DEFAULT_CLOSING = 'Teklifimizin uygun bulunacağını umar, iyi çalışmalar dileriz.'

export function buildQuoteReport(
  quote: Quote,
  items: QuoteItem[],
  ctx: { customer: Company | null; contact: Contact | null; project: Project | null; settings: QuoteSettingsInput; generatedAt?: Date },
): QuoteReport {
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
  const totals = computeQuote(quote, sorted)
  const money = (c: number) => formatMoney(c, quote.currency)
  const s = ctx.settings
  const issuerLines = [
    s.address,
    [s.phone, s.email].filter(Boolean).join(' · ') || null,
    s.website ?? COMPANY.websiteLabel,
    s.tax_office || s.tax_number ? `Vergi dairesi: ${s.tax_office ?? '—'} · Vergi no: ${s.tax_number ?? '—'}` : null,
  ].filter((x): x is string => !!x)
  const c = ctx.customer
  const customerLines = [
    ctx.contact ? `İlgili: ${ctx.contact.full_name}${ctx.contact.title ? ` (${ctx.contact.title})` : ''}` : null,
    [c?.address, c?.city].filter(Boolean).join(', ') || null,
    [c?.phone ?? ctx.contact?.phone, c?.email ?? ctx.contact?.email].filter(Boolean).join(' · ') || null,
    c?.tax_office || c?.tax_number ? `Vergi dairesi: ${c?.tax_office ?? '—'} · Vergi no: ${c?.tax_number ?? '—'}` : null,
  ].filter((x): x is string => !!x)

  const rows: QuoteReportRow[] = sorted.map((i, idx) => {
    const r = totals.items[idx]
    return {
      no: idx + 1,
      poz: i.poz_code ?? '',
      description: i.description,
      system: i.system_type,
      notes: i.notes,
      dims: itemDims(i),
      pieces: i.quantity,
      qtyMilli: r.qty,
      qtyText: r.ok ? formatMilli(r.qty) : 'Hatalı',
      unit: QUOTE_UNIT_LABEL[i.unit],
      unitPrice: r.unitPrice,
      lineTotal: r.lineTotal,
      verified: i.measure_verified,
      source: i.source === 'metraj' ? (i.source_label ?? 'Metraj') : null,
      ok: r.ok,
    }
  })

  const detailed = quote.pricing_mode === 'detayli'
  const totalLines: QuoteReport['totalLines'] = [{ label: detailed ? 'Kalemler toplamı' : 'Teklif bedeli', value: money(totals.itemsTotal) }]
  if (totals.shipping) totalLines.push({ label: 'Nakliye', value: money(totals.shipping) })
  if (totals.other) totalLines.push({ label: quote.other_label || 'Diğer giderler', value: money(totals.other) })
  if (totals.shipping || totals.other) totalLines.push({ label: 'Ara toplam', value: money(totals.subtotal) })
  if (totals.discount) {
    totalLines.push({ label: quote.discount_kind === 'yuzde' ? `İndirim (%${String(quote.discount_value).replace('.', ',')})` : 'İndirim', value: `− ${money(totals.discount)}` })
    totalLines.push({ label: 'İndirimli toplam', value: money(totals.net) })
  }
  totalLines.push({ label: `KDV (${formatPct(totals.vatBp)})`, value: money(totals.vat) })
  totalLines.push({ label: 'GENEL TOPLAM', value: money(totals.grandTotal), strong: true })

  return {
    quote,
    issuer: {
      name: s.legal_name || COMPANY.name,
      lines: issuerLines,
      bank: s.iban ? `${s.bank_name ? `${s.bank_name} · ` : ''}IBAN: ${s.iban.replace(/(.{4})/g, '$1 ').trim()}` : null,
      closing: s.closing_text || DEFAULT_CLOSING,
    },
    customer: { name: c?.name ?? '—', lines: customerLines },
    project: ctx.project ? { code: ctx.project.code, name: ctx.project.name, location: ctx.project.location } : null,
    rows,
    totals,
    showPrices: detailed && !quote.hide_unit_prices,
    totalLines,
    generatedAt: ctx.generatedAt ?? new Date(),
    money,
  }
}

export function quoteFileName(q: Quote, ext: 'pdf' | 'xlsx'): string {
  const safe = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ı/g, 'i')
      .replace(/İ/g, 'I')
      .replace(/[^\w-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60)
  return `${q.quote_no}-Rev${q.revision}-${safe(q.title) || 'teklif'}.${ext}`
}

export const statusText = (q: Quote) => (q.superseded ? `Eski revizyon (${QUOTE_STATUS_LABEL[q.status]})` : QUOTE_STATUS_LABEL[q.status])
