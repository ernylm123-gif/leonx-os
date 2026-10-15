import { Info } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormAlert, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/context/toast'
import { ConflictError } from '@/data/api'
import { createQuoteItems, updateQuoteItem } from '@/data/quoteApi'
import { dataErrorMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { useFormDirty } from '@/lib/unsaved'
import { useResetOnOpen } from '@/lib/useResetOnOpen'
import { formatMilli } from '@/quantity/precision'
import { computeQuoteItem, emptyQuoteItem, itemInputOf, type QuoteCalcParams } from '@/quote/engine'
import { CURRENCY_SYMBOL, formatMoney, fromMm, toMm } from '@/quote/money'
import { ITEM_TEMPLATES } from '@/quote/templates'
import { DIM_UNITS, type DimUnit, type Quote, type QuoteItem, type QuoteItemInput, QUOTE_UNIT_LABEL, QUOTE_UNITS, type QuoteUnit } from '@/quote/types'
import { numText, parseNum } from './shared'

interface Props {
  open: boolean
  onClose: () => void
  quote: Quote
  params: QuoteCalcParams
  item?: QuoteItem | null
  /** Yeni kalemin sırası */
  nextSort: number
  onSaved?: (items: QuoteItem[]) => void
}

interface FormState {
  poz: string
  description: string
  system: string
  unit: QuoteUnit
  dimUnit: DimUnit
  width: string
  height: string
  manualMeasure: string
  quantity: string
  material: string
  labor: string
  install: string
  other: string
  manualPrice: boolean
  unitPrice: string
  notes: string
  verified: boolean
}

function toForm(i: QuoteItemInput): FormState {
  const u = i.dim_unit
  return {
    poz: i.poz_code ?? '',
    description: i.description,
    system: i.system_type ?? '',
    unit: i.unit,
    dimUnit: u,
    width: i.width_mm != null ? numText(fromMm(i.width_mm, u)) : '',
    height: i.height_mm != null ? numText(fromMm(i.height_mm, u)) : '',
    manualMeasure: numText(i.manual_measure),
    quantity: numText(i.quantity),
    material: numText(i.material_cost || null),
    labor: numText(i.labor_cost || null),
    install: numText(i.install_cost || null),
    other: numText(i.other_cost || null),
    manualPrice: i.unit_price != null,
    unitPrice: numText(i.unit_price),
    notes: i.notes ?? '',
    verified: i.measure_verified,
  }
}

type Parsed = { ok: true; value: QuoteItemInput } | { ok: false; errors: Partial<Record<keyof FormState, string>> }

function parse(f: FormState, base: QuoteItemInput): Parsed {
  const errors: Partial<Record<keyof FormState, string>> = {}
  const measured = QUOTE_UNITS.find((u) => u.value === f.unit)?.measured
  const num = (k: keyof FormState, raw: string, opts: { min?: number; max?: number; required?: boolean; positive?: boolean } = {}) => {
    const v = parseNum(raw)
    if (v == null) {
      if (opts.required) errors[k] = 'Zorunlu alan.'
      return null
    }
    if (Number.isNaN(v)) {
      errors[k] = 'Geçerli bir sayı girin (ör. 1250,5).'
      return null
    }
    if (opts.positive && !(v > 0)) errors[k] = 'Sıfırdan büyük olmalı.'
    else if (opts.min != null && v < opts.min) errors[k] = `En az ${opts.min}.`
    else if (opts.max != null && v > opts.max) errors[k] = `En fazla ${opts.max.toLocaleString('tr-TR')}.`
    return v
  }
  if (!f.description.trim()) errors.description = 'Açıklama zorunludur.'
  if (f.poz.trim().length > 40) errors.poz = 'En fazla 40 karakter.'
  const w = measured ? num('width', f.width, { positive: true }) : null
  const h = measured === 'alan' ? num('height', f.height, { positive: true }) : null
  const wMm = w != null ? toMm(w, f.dimUnit) : null
  const hMm = h != null ? toMm(h, f.dimUnit) : null
  if (wMm != null && wMm > 100_000) errors.width = 'En fazla 100 m.'
  if (hMm != null && hMm > 100_000) errors.height = 'En fazla 100 m.'
  const mm = measured ? num('manualMeasure', f.manualMeasure, { positive: true, max: 100_000_000 }) : null
  if (measured && mm == null && !errors.manualMeasure) {
    if (measured === 'alan' && (wMm == null || hMm == null)) errors.width = errors.width ?? 'En ve Boy girin (veya birim ölçü).'
    if (measured === 'uzunluk' && wMm == null) errors.width = errors.width ?? 'Uzunluk girin (veya birim ölçü).'
  }
  const qty = num('quantity', f.quantity, { required: true, positive: true, max: 1_000_000 })
  const money = (k: keyof FormState, raw: string) => num(k, raw, { min: 0, max: 999_999_999_999 }) ?? 0
  const material = money('material', f.material)
  const labor = money('labor', f.labor)
  const install = money('install', f.install)
  const other = money('other', f.other)
  const price = f.manualPrice ? num('unitPrice', f.unitPrice, { required: true, min: 0, max: 999_999_999_999 }) : null
  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    value: {
      ...base,
      poz_code: f.poz.trim() || null,
      description: f.description.trim(),
      system_type: f.system.trim() || null,
      unit: f.unit,
      dim_unit: f.dimUnit,
      width_mm: wMm,
      height_mm: hMm,
      manual_measure: mm,
      quantity: qty!,
      material_cost: material,
      labor_cost: labor,
      install_cost: install,
      other_cost: other,
      unit_price: price,
      notes: f.notes.trim() || null,
      measure_verified: f.verified,
    },
  }
}

export function QuoteItemForm({ open, onClose, quote, params, item, nextSort, onSaved }: Props) {
  const { notify } = useToast()
  const [f, setF] = useState<FormState>(() => toForm(emptyQuoteItem()))
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { markDirty } = useFormDirty(open, 'Teklif kalemi formu')
  const base = useMemo<QuoteItemInput>(() => (item ? itemInputOf(item) : emptyQuoteItem(nextSort)), [item, nextSort])

  // Açılışta formu render sırasında sıfırla (effect ile sıfırlamak, açılır açılmaz yazılan değerleri ezebilir)
  useResetOnOpen(open, () => {
    setF(toForm(base))
    setErrors({})
    setFormError(null)
  })

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }))
  const measured = QUOTE_UNITS.find((u) => u.value === f.unit)?.measured
  const parsed = parse(f, base)
  const preview = parsed.ok ? computeQuoteItem(parsed.value, params) : null
  const cur = CURRENCY_SYMBOL[quote.currency]
  const unitLabel = QUOTE_UNIT_LABEL[f.unit]
  const detailed = params.pricing_mode === 'detayli'

  const changeDimUnit = (u: DimUnit) => {
    // Girilen değerleri yeni birime çevir (aynı fiziksel ölçü)
    const conv = (raw: string) => {
      const v = parseNum(raw)
      return v == null || Number.isNaN(v) ? raw : numText(fromMm(toMm(v, f.dimUnit), u))
    }
    setF((s) => ({ ...s, dimUnit: u, width: conv(s.width), height: conv(s.height) }))
  }

  const applyTemplate = (label: string) => {
    const t = ITEM_TEMPLATES.find((x) => x.label === label)
    if (!t) return
    setF((s) => ({ ...s, description: t.description, system: t.system_type, unit: t.unit }))
    markDirty()
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const p = parse(f, base)
    if (!p.ok) {
      setErrors(p.errors)
      return
    }
    setErrors({})
    setBusy(true)
    setFormError(null)
    try {
      const db = requireSupabase()
      const saved = item ? [await updateQuoteItem(db, item, p.value)] : await createQuoteItems(db, quote.id, [p.value])
      notify(item ? 'Kalem güncellendi.' : 'Kalem eklendi.')
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setFormError(err instanceof ConflictError ? 'Bu kalem başka bir cihazda değiştirildi veya silindi. Kapatıp güncel hâlini açın.' : dataErrorMessage(err, 'Kalem kaydetme'))
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
      title={item ? 'Kalemi düzenle' : 'Kalem ekle'}
      description={`${quote.quote_no} · Rev ${quote.revision}`}
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[13px] text-muted" data-testid="qi-preview" aria-live="polite">
            {preview && preview.ok ? (
              <>
                Miktar <b className="font-mono text-ink">{formatMilli(preview.qty)}</b> {unitLabel}
                {detailed && (
                  <>
                    {' '}
                    · Birim <b className="font-mono text-ink">{formatMoney(preview.unitPrice, quote.currency)}</b> · Tutar{' '}
                    <b className="font-mono text-ink">{formatMoney(preview.lineTotal, quote.currency)}</b>
                  </>
                )}
              </>
            ) : (
              'Hesap için zorunlu alanları doldurun'
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Vazgeç
            </Button>
            <Button variant="primary" onClick={() => void submit()} disabled={busy} data-testid="qi-save">
              {busy ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={submit} onChangeCapture={markDirty} noValidate className="space-y-5">
        {formError && <FormAlert>{formError}</FormAlert>}
        {item?.source === 'metraj' && (
          <p className="flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-muted">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Kaynak: {item.source_label ?? 'Metraj'}. Ölçüleri değiştirirseniz metraj kaydı değişmez.
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[140px_1fr]">
          <TextField label="Poz no" value={f.poz} error={errors.poz} onChange={(e) => set('poz', e.target.value)} maxLength={40} data-testid="qi-poz" />
          <SelectField label="Hazır şablon" value="" onChange={(e) => applyTemplate(e.target.value)} hint="Açıklama, sistem ve birimi doldurur">
            <option value="">Şablon seçin…</option>
            {ITEM_TEMPLATES.map((t) => (
              <option key={t.label} value={t.label}>
                {t.label}
              </option>
            ))}
          </SelectField>
        </div>
        <TextAreaField label="İş kalemi açıklaması" required value={f.description} error={errors.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} rows={2} className="[&_textarea]:min-h-[64px]" data-testid="qi-description" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <TextField label="Ürün / sistem" value={f.system} onChange={(e) => set('system', e.target.value)} maxLength={120} className="col-span-2" />
          <SelectField label="Birim" value={f.unit} onChange={(e) => set('unit', e.target.value as QuoteUnit)} data-testid="qi-unit">
            {QUOTE_UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </SelectField>
          <TextField label="Adet" required inputMode="decimal" value={f.quantity} error={errors.quantity} onChange={(e) => set('quantity', e.target.value)} data-testid="qi-quantity" />
        </div>

        {measured && (
          <fieldset className="rounded-xl border border-line p-3.5">
            <legend className="px-1 text-[12px] font-semibold tracking-wide text-subtle uppercase">Ölçü</legend>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <SelectField label="Ölçü birimi" value={f.dimUnit} onChange={(e) => changeDimUnit(e.target.value as DimUnit)} data-testid="qi-dimunit">
                {DIM_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </SelectField>
              <TextField label={measured === 'alan' ? `En (${f.dimUnit})` : `Uzunluk (${f.dimUnit})`} inputMode="decimal" value={f.width} error={errors.width} onChange={(e) => set('width', e.target.value)} data-testid="qi-width" />
              {measured === 'alan' && <TextField label={`Boy (${f.dimUnit})`} inputMode="decimal" value={f.height} error={errors.height} onChange={(e) => set('height', e.target.value)} data-testid="qi-height" />}
              <TextField
                label={`Birim ölçü (${unitLabel})`}
                inputMode="decimal"
                value={f.manualMeasure}
                error={errors.manualMeasure}
                onChange={(e) => set('manualMeasure', e.target.value)}
                hint="Düzensiz şekil için; doluysa En×Boy yerine kullanılır"
              />
            </div>
            <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={f.verified} onChange={(e) => set('verified', e.target.checked)} data-testid="qi-verified" />
              Ölçü doğrulandı (yerinde veya onaylı metrajla)
            </label>
          </fieldset>
        )}

        {detailed ? (
          <fieldset className="rounded-xl border border-line p-3.5">
            <legend className="px-1 text-[12px] font-semibold tracking-wide text-subtle uppercase">
              Maliyet ({cur} / {unitLabel})
            </legend>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <TextField label="Malzeme" inputMode="decimal" value={f.material} error={errors.material} onChange={(e) => set('material', e.target.value)} data-testid="qi-material" />
              <TextField label="İşçilik" inputMode="decimal" value={f.labor} error={errors.labor} onChange={(e) => set('labor', e.target.value)} data-testid="qi-labor" />
              <TextField label="Montaj" inputMode="decimal" value={f.install} error={errors.install} onChange={(e) => set('install', e.target.value)} data-testid="qi-install" />
              <TextField label="Diğer" inputMode="decimal" value={f.other} error={errors.other} onChange={(e) => set('other', e.target.value)} />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
              <label className="flex items-center gap-2 text-[13px] text-ink-2">
                <input type="checkbox" checked={f.manualPrice} onChange={(e) => set('manualPrice', e.target.checked)} data-testid="qi-manual-price" />
                Satış birim fiyatını elle gir
              </label>
              {f.manualPrice ? (
                <TextField label={`Satış birim fiyatı (${cur} / ${unitLabel})`} inputMode="decimal" value={f.unitPrice} error={errors.unitPrice} onChange={(e) => set('unitPrice', e.target.value)} data-testid="qi-price" />
              ) : (
                <p className="text-[12.5px] text-muted">
                  Satış fiyatı = maliyet (fire %{numText(params.waste_pct) || 0} malzemeye) × genel gider %{numText(params.overhead_pct) || 0} × kâr oranı %{numText(params.profit_pct) || 0}
                  {preview?.ok ? (
                    <>
                      {' '}
                      → <b className="font-mono text-ink">{formatMoney(preview.unitPrice, quote.currency)}</b> / {unitLabel}
                    </>
                  ) : null}
                </p>
              )}
            </div>
          </fieldset>
        ) : (
          <p className="rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-muted">Toplam bedelli teklif: kalem fiyatı girilmez; bedel teklifin fiyatlandırma bölümünde belirlenir.</p>
        )}

        <TextAreaField label="Not" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={2000} rows={2} className="[&_textarea]:min-h-[56px]" />
      </form>
    </Modal>
  )
}
