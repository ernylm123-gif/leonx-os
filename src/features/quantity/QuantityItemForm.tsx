import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import type { ComponentProps } from 'react'
import { Modal } from '@/components/ui/Modal'
import { computeItem, unitForCategory } from '@/quantity/engine'
import { formatCenti, formatMilli, parseDecimalInput } from '@/quantity/precision'
import {
  CATEGORY_INFO,
  type GlassMode,
  type MeasureBasis,
  QUANTITY_CATEGORIES,
  type QuantityCategory,
  type QuantityItemInput,
  type QuantityUnit,
  SHAPES,
  type ShapeKind,
  UNIT_LABEL,
  UNITS,
  VERIFICATION,
  type Verification,
} from '@/quantity/types'

type NumField =
  | 'width_mm'
  | 'height_mm'
  | 'height2_mm'
  | 'apex_mm'
  | 'rise_mm'
  | 'manual_area_m2'
  | 'manual_perimeter_m'
  | 'manual_quantity'
  | 'install_gap_mm'
  | 'glass_deduction_mm'
  | 'glass_manual_m2'

const NUM_FIELDS: NumField[] = ['width_mm', 'height_mm', 'height2_mm', 'apex_mm', 'rise_mm', 'manual_area_m2', 'manual_perimeter_m', 'manual_quantity', 'install_gap_mm', 'glass_deduction_mm', 'glass_manual_m2']

function Sel({ options, ...rest }: Omit<ComponentProps<typeof SelectField>, 'children'> & { options: { value: string; label: string }[] }) {
  return (
    <SelectField {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </SelectField>
  )
}

const fmt = (v: number | null) => (v == null ? '' : String(v).replace('.', ','))

function verticesToText(v: [number, number][] | null): string {
  return (v ?? []).map(([x, y]) => `${fmt(x)}; ${fmt(y)}`).join('\n')
}
function textToVertices(t: string): [number, number][] | null {
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return null
  const out: [number, number][] = []
  for (const l of lines) {
    const [a, b] = l.split(/[;\t]/)
    const x = parseDecimalInput(a ?? '').value
    const y = parseDecimalInput(b ?? '').value
    if (x == null || y == null) return null
    out.push([x, y])
  }
  return out
}

/** Poz ekleme / düzenleme formu. Hesap sonucu ve hatalar canlı gösterilir; hatalı kayıt kaydedilmez. */
export function QuantityItemForm({
  open,
  title,
  initial,
  onClose,
  onSubmit,
  busy,
  extra,
}: {
  open: boolean
  title: string
  initial: QuantityItemInput
  onClose: () => void
  onSubmit: (input: QuantityItemInput) => void | Promise<void>
  busy?: boolean
  extra?: ReactNode
}) {
  const [v, setV] = useState<QuantityItemInput>(initial)
  const [raw, setRaw] = useState<Record<NumField, string>>(() => Object.fromEntries(NUM_FIELDS.map((f) => [f, fmt(initial[f])])) as Record<NumField, string>)
  const [qtyRaw, setQtyRaw] = useState(String(initial.quantity))
  const [vertText, setVertText] = useState(verticesToText(initial.vertices))
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!open) return
    setV(initial)
    setRaw(Object.fromEntries(NUM_FIELDS.map((f) => [f, fmt(initial[f])])) as Record<NumField, string>)
    setQtyRaw(String(initial.quantity))
    setVertText(verticesToText(initial.vertices))
    setTouched(false)
  }, [open, initial])

  const parsed = useMemo(() => {
    const next: QuantityItemInput = { ...v }
    const bad: string[] = []
    const ambiguous: string[] = []
    for (const f of NUM_FIELDS) {
      const r = parseDecimalInput(raw[f])
      if (raw[f].trim() && r.value == null) bad.push(f)
      if (r.ambiguous) ambiguous.push(f)
      next[f] = r.value
    }
    const q = Number(qtyRaw.replace(/\s/g, ''))
    next.quantity = Number.isFinite(q) ? q : Number.NaN
    next.vertices = next.shape === 'cokgen' ? textToVertices(vertText) : null
    next.unit = unitForCategory(next.category, next.unit)
    return { next, bad, ambiguous }
  }, [v, raw, qtyRaw, vertText])

  const result = useMemo(() => computeItem(parsed.next), [parsed.next])
  const fieldError = (f: string) => (touched ? result.errors.find((e) => e.field === f)?.message : undefined) ?? (parsed.bad.includes(f) ? 'Geçersiz sayı.' : undefined)
  const info = CATEGORY_INFO[v.category]
  const linear = info.family === 'dogrusal'
  const free = info.unit === 'serbest'
  const set = <K extends keyof QuantityItemInput>(k: K, val: QuantityItemInput[K]) => setV((p) => ({ ...p, [k]: val }))
  const num = (f: NumField, label: string, hint?: string) => (
    <TextField
      label={label}
      inputMode="decimal"
      value={raw[f]}
      onChange={(e) => setRaw((r) => ({ ...r, [f]: e.target.value }))}
      error={fieldError(f)}
      hint={parsed.ambiguous.includes(f) ? '"1.250" binlik ayırıcıyla 1250 kabul edildi.' : hint}
      data-testid={`qf-${f}`}
    />
  )

  const submit = () => {
    setTouched(true)
    if (!result.ok || parsed.bad.length) return
    void onSubmit({ ...parsed.next, poz_code: parsed.next.poz_code.trim() })
  }

  const shape = v.shape
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      busy={busy}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy} data-testid="qf-save">
            Kaydet
          </Button>
        </div>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextField label="Poz kodu" required value={v.poz_code} onChange={(e) => set('poz_code', e.target.value)} error={fieldError('poz_code')} maxLength={40} data-testid="qf-poz" />
          <Sel
            label="İş grubu"
            value={v.category}
            onChange={(e) => set('category', e.target.value as QuantityCategory)}
            options={QUANTITY_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
            data-testid="qf-category"
          />
          <Sel
            label="Doğrulama"
            value={v.verification}
            onChange={(e) => set('verification', e.target.value as Verification)}
            options={VERIFICATION.map((x) => ({ value: x.value, label: x.label }))}
          />
          <TextField label="Kat" value={v.floor ?? ''} onChange={(e) => set('floor', e.target.value || null)} maxLength={80} placeholder="ör. Zemin" />
          <TextField label="Mahal" value={v.space ?? ''} onChange={(e) => set('space', e.target.value || null)} maxLength={80} placeholder="ör. Salon" />
          <TextField label="Adet" required inputMode="numeric" value={qtyRaw} onChange={(e) => setQtyRaw(e.target.value)} error={fieldError('quantity')} data-testid="qf-quantity" />
        </div>

        {free && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Sel
              label="Metraj birimi"
              value={v.unit}
              onChange={(e) => set('unit', e.target.value as QuantityUnit)}
              options={UNITS.map((u) => ({ value: u.value, label: u.label }))}
            />
            {v.unit === 'kg' && num('manual_quantity', 'Birim ağırlık (kg / adet)')}
          </div>
        )}

        {linear || (free && v.unit === 'mtul') ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {num('width_mm', 'Uzunluk (mm)')}
            {num('height_mm', 'Yükseklik (mm, bilgi)')}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Sel label="Şekil" value={shape} onChange={(e) => set('shape', e.target.value as ShapeKind)} options={SHAPES.map((s) => ({ value: s.value, label: s.label }))} data-testid="qf-shape" />
              <Sel
                label="Ölçü esası"
                value={v.measure_basis}
                onChange={(e) => set('measure_basis', e.target.value as MeasureBasis)}
                options={[
                  { value: 'dograma', label: 'Doğrama dış ölçüsü' },
                  { value: 'bosluk', label: 'Duvar boşluğu (kaba)' },
                ]}
              />
              {v.measure_basis === 'bosluk' && num('install_gap_mm', 'Montaj payı (mm / kenar)', 'Doğrama = boşluk − 2 × pay')}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {shape === 'daire' ? (
                num('width_mm', 'Çap (mm)')
              ) : shape === 'cokgen' ? null : shape === 'manuel' ? (
                <>
                  {num('manual_area_m2', 'Birim alan (m²)')}
                  {num('manual_perimeter_m', 'Birim çevre (m)', 'İsteğe bağlı')}
                </>
              ) : (
                <>
                  {num('width_mm', shape === 'ucgen' || shape === 'yamuk' ? 'Taban genişliği (mm)' : 'Genişlik (mm)')}
                  {num('height_mm', shape === 'yamuk' ? 'Sol yükseklik (mm)' : shape === 'kemerli' ? 'Toplam yükseklik (mm)' : 'Yükseklik (mm)')}
                  {shape === 'yamuk' && num('height2_mm', 'Sağ yükseklik (mm)')}
                  {shape === 'ucgen' && num('apex_mm', 'Tepe konumu (soldan, mm)', 'Boş: ortada')}
                  {shape === 'kemerli' && num('rise_mm', 'Kemer yüksekliği (mm)', 'Genişliğin yarısı = yarım daire')}
                </>
              )}
            </div>
            {shape === 'cokgen' && (
              <TextAreaField
                label="Köşe koordinatları (mm) — her satıra x; y"
                rows={5}
                value={vertText}
                onChange={(e) => setVertText(e.target.value)}
                error={fieldError('vertices')}
                hint="Köşeleri sırayla girin; ilk köşe tekrar yazılmaz."
              />
            )}
            {info.glass && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Sel
                  label="Cam alanı"
                  value={v.glass_mode}
                  onChange={(e) => set('glass_mode', e.target.value as GlassMode)}
                  options={[
                    { value: 'yok', label: 'Hesaplanmasın' },
                    { value: 'dusum', label: 'Profil düşümüyle (tahmini)' },
                    { value: 'manuel', label: 'Elle gir' },
                  ]}
                />
                {v.glass_mode === 'dusum' && num('glass_deduction_mm', 'Profil düşümü (mm / kenar)')}
                {v.glass_mode === 'manuel' && num('glass_manual_m2', 'Birim cam alanı (m²)')}
              </div>
            )}
          </>
        )}

        <TextAreaField label="Açıklama" rows={2} value={v.description ?? ''} onChange={(e) => set('description', e.target.value || null)} maxLength={1000} />

        {/* Canlı hesap */}
        <section className="rounded-xl border border-line bg-surface-2/60 p-3.5" aria-live="polite" data-testid="qf-preview">
          <h3 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase">Hesap</h3>
          {result.ok ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-3">
              {result.unit.frameArea != null && (
                <div>
                  <dt className="text-muted">Birim doğrama alanı</dt>
                  <dd className="font-mono text-ink">{formatMilli(result.unit.frameArea)} m²</dd>
                </div>
              )}
              {result.unit.openingArea != null && (
                <div>
                  <dt className="text-muted">Birim boşluk alanı</dt>
                  <dd className="font-mono text-ink">{formatMilli(result.unit.openingArea)} m²</dd>
                </div>
              )}
              {result.unit.perimeter != null && (
                <div>
                  <dt className="text-muted">Birim çevre</dt>
                  <dd className="font-mono text-ink">{formatMilli(result.unit.perimeter)} m</dd>
                </div>
              )}
              {result.unit.glassArea != null && (
                <div>
                  <dt className="text-muted">Birim cam alanı</dt>
                  <dd className="font-mono text-ink">{formatMilli(result.unit.glassArea)} m²</dd>
                </div>
              )}
              {result.unit.length != null && (
                <div>
                  <dt className="text-muted">Birim uzunluk</dt>
                  <dd className="font-mono text-ink">{formatMilli(result.unit.length)} m</dd>
                </div>
              )}
              {result.primary && (
                <div>
                  <dt className="text-muted">Metraj</dt>
                  <dd className="font-mono font-semibold text-ink" data-testid="qf-primary">
                    {formatCenti(result.primary.centi)} {UNIT_LABEL[result.primary.unit]}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-[13px] text-muted">Ölçüleri girin; hesap burada görünür.</p>
          )}
          {result.warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {result.warnings.map((w) => (
                <li key={w} className="flex gap-1.5 text-[12px] text-warn">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {w}
                </li>
              ))}
            </ul>
          )}
          {touched && !result.ok && result.errors.length > 0 && (
            <p className="mt-2 text-[12px] text-danger" role="alert">
              Kayıt için hataları düzeltin ({result.errors.length}).
            </p>
          )}
          {result.ok && v.verification === 'onaylandi' && (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ok">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Onaylı kalem kesin metraj toplamlarına dahil edilir.
            </p>
          )}
        </section>
        {extra}
      </form>
    </Modal>
  )
}
