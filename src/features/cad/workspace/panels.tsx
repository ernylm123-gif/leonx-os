import { AlertOctagon, AlertTriangle, Eye, EyeOff, Info, Search, Trash2 } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { type DisplayUnitId, CONFIRMABLE_UNITS } from '@/cad/units'
import { supportOf, type ReportWarning, type Scene, type SceneEntity } from '@/cad/types'
import type { Measurement } from '@/cad/viewer/engine'
import { formatBytes } from '@/lib/files'
import { cn } from '@/lib/cn'
import { formatAreaWorld, formatLengthWorld, nf, type UnitState } from '../format'
import type { LoadedCad } from '../useCadDocument'
import { KV, MiniButton, rgbCss, Section, StatusChip, SupportBadge } from './ui'

// ------------------------------------------------------------------ Birim / ölçek

export function UnitsCard({
  doc,
  units,
  onChoose,
  onCalibrate,
  onScale,
  onConfirmScale,
}: {
  doc: LoadedCad
  units: UnitState
  onChoose: (mm: number, label: string) => void
  onCalibrate: () => void
  onScale: (denominator: number) => void
  /** Ölçü yazılarıyla doğrulanan ölçeği onayla */
  onConfirmScale?: (denominator: number) => void
}) {
  const [custom, setCustom] = useState('')
  const pageScale = doc.pdfDoc?.pages[doc.pdfDoc.current - 1]?.analysis?.scale ?? null
  return (
    <Section title={doc.kind === 'pdf' ? 'Ölçek' : 'Çizim birimi'}>
      <div className="flex flex-wrap items-center gap-2">
        {units.mmPerUnit == null ? (
          <StatusChip tone="danger">Bilinmiyor</StatusChip>
        ) : units.verified ? (
          <StatusChip tone="ok">Doğrulandı</StatusChip>
        ) : (
          <StatusChip tone="warn">Doğrulanmadı</StatusChip>
        )}
        <span className="min-w-0 text-[12px] text-muted">{units.note}</span>
      </div>
      {doc.kind === 'dxf' && (
        <>
          <p className="mt-2.5 text-[12px] text-muted">
            {units.source === 'dosya'
              ? 'Birim dosya başlığından okundu. Çizim farklı birimle çizilmişse değiştirin.'
              : 'Çizimin hangi birimle çizildiğini seçin. Seçim yapılmadan ölçüler kesin kabul edilmez.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Çizim birimi seçimi">
            {CONFIRMABLE_UNITS.map((u) => (
              <MiniButton
                key={u.code}
                tone={units.mmPerUnit === u.mm && units.verified ? 'primary' : 'default'}
                onClick={() => onChoose(u.mm, u.name)}
                testId={`unit-${u.short}`}
              >
                {u.short}
              </MiniButton>
            ))}
            <MiniButton onClick={onCalibrate} title="Bilinen bir ölçüyle iki nokta seçerek ölçek belirleyin">
              Kalibre et
            </MiniButton>
          </div>
        </>
      )}
      {doc.kind === 'pdf' && doc.pdf && (
        <>
          <p className="mt-2.5 text-[12px] text-muted">
            {doc.pdf.kind === 'taranmis'
              ? 'Taranmış PDF: ölçü yalnızca kalibrasyondan sonra alınabilir ve görüntü çözünürlüğü kadar hassastır.'
              : 'PDF kâğıt birimindedir. Çizimdeki bilinen bir ölçüyle kalibre edin veya ölçeği girin.'}
          </p>
          {pageScale?.inferred && (
            <div className="mt-2 rounded-lg border border-ok/30 bg-ok-soft px-2.5 py-2 text-[12px] text-ink" data-testid="scale-suggestion">
              <p>
                Bu sayfadaki <strong>{pageScale.inferred.support}/{pageScale.inferred.total}</strong> ölçü yazısı, çizgi uzunluklarıyla{' '}
                <strong>1/{pageScale.inferred.denominator}</strong> ölçeğinde uyumlu
                {pageScale.title ? (pageScale.title === pageScale.inferred.denominator ? ' (antetteki ölçekle aynı)' : ` (antette 1/${pageScale.title} yazıyor!)`) : ''}.
              </p>
              {onConfirmScale && (
                <MiniButton tone="primary" className="mt-1.5" onClick={() => onConfirmScale(pageScale.inferred!.denominator)} testId="scale-confirm">
                  1/{pageScale.inferred.denominator} ölçeğini onayla
                </MiniButton>
              )}
            </div>
          )}
          {pageScale?.conflict && <p className="mt-2 text-[11.5px] text-danger">{pageScale.conflict}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <MiniButton tone="primary" onClick={onCalibrate} testId="pdf-calibrate">
              İki noktayla kalibre et
            </MiniButton>
            {doc.pdf.scaleHints.map((h) => (
              <MiniButton key={h.denominator} onClick={() => onScale(h.denominator)} title={`Çizimdeki metin: "${h.text}"`}>
                1/{h.denominator} (çizimde yazan)
              </MiniButton>
            ))}
          </div>
          <form
            className="mt-2 flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              const n = Number(custom.replace(',', '.'))
              if (Number.isFinite(n) && n > 0 && n <= 10000) onScale(n)
            }}
          >
            <label className="text-[12px] text-muted" htmlFor="pdf-scale">
              Ölçek 1/
            </label>
            <input
              id="pdf-scale"
              inputMode="decimal"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="h-8 w-20 rounded-lg border border-line bg-surface px-2 text-base text-ink sm:text-[12.5px]"
              placeholder="50"
            />
            <button
              type="submit"
              disabled={!custom}
              className="inline-flex h-8 items-center rounded-lg border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink hover:bg-surface-2 disabled:opacity-45"
            >
              Uygula
            </button>
          </form>
          {units.source === 'olcek' && (
            <p className="mt-2 text-[11.5px] text-warn">
              Ölçek beyanı kâğıt çıktısının ölçekli basıldığını varsayar. Kesin metraj için bilinen bir ölçüyle kalibrasyon yapın.
            </p>
          )}
        </>
      )}
    </Section>
  )
}

// ------------------------------------------------------------------ Dosya / analiz raporu

export function FilePanel({ doc, units, unit, children }: { doc: LoadedCad; units: UnitState; unit: DisplayUnitId; children?: ReactNode }) {
  const r = doc.report
  const bb = doc.scene.bbox
  return (
    <div>
      <Section title="Dosya">
        <dl>
          <KV k="Ad" v={<span title={doc.fileName}>{doc.fileName}</span>} />
          <KV k="Boyut" v={formatBytes(doc.size)} />
          {r && <KV k="Biçim" v={`DXF ${r.release ?? r.acadver ?? 'sürümü bilinmiyor'}`} />}
          {r && <KV k="Kodlama" v={r.encoding} mono />}
          {doc.pdf && <KV k="Biçim" v={`PDF · sayfa ${doc.pdf.pageNumber}/${doc.pdf.pageCount}`} />}
          {doc.pdf && (
            <KV
              k="PDF türü"
              v={{ vektorel: 'Vektörel', taranmis: 'Taranmış (raster)', karma: 'Karma (vektör + görüntü)', bos: 'Boş sayfa' }[doc.pdf.kind]}
            />
          )}
          {bb && (
            <KV
              k="Çizim sınırı"
              v={`${formatLengthWorld(bb[2] - bb[0], units, unit)} × ${formatLengthWorld(bb[3] - bb[1], units, unit).split(' · ')[0]}`}
            />
          )}
        </dl>
      </Section>
      {children}
      {r && (
        <Section title="Analiz">
          <dl>
            <KV k="Çizilen nesne" v={nf(0).format(r.stats.entities)} mono />
            <KV k="Blok referansı" v={nf(0).format(r.stats.inserts)} mono />
            <KV k="Nokta" v={nf(0).format(r.stats.points)} mono />
            <KV k="Süre" v={`${nf(0).format(r.stats.parseMs + r.stats.buildMs)} ms`} mono />
            {r.paperSpaceSkipped > 0 && <KV k="Kağıt alanı (dahil değil)" v={nf(0).format(r.paperSpaceSkipped)} mono />}
          </dl>
          {r.truncated && (
            <p className="mt-2 rounded-lg border border-danger/30 bg-danger-soft px-2.5 py-2 text-[12px] text-danger">
              Sınır aşıldı: çizimin tamamı yüklenmedi. Bu analizden metraj kesin kabul edilmemelidir.
            </p>
          )}
        </Section>
      )}
      {r && (
        <Section title="Nesne türleri ve destek düzeyi">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10.5px] text-subtle uppercase">
                <th className="py-1 font-semibold">Tür</th>
                <th className="py-1 text-right font-semibold">Adet</th>
                <th className="py-1 text-right font-semibold">Çizilen</th>
                <th className="py-1 pl-2 text-right font-semibold">Destek</th>
              </tr>
            </thead>
            <tbody>
              {r.counts.map((c) => (
                <tr key={c.type} className="border-t border-line/70" title={supportOf(c.type).note}>
                  <td className="py-1.5 font-mono text-[11.5px] text-ink">{c.type}</td>
                  <td className="py-1.5 text-right font-mono text-[11.5px]">{nf(0).format(c.total)}</td>
                  <td className={cn('py-1.5 text-right font-mono text-[11.5px]', c.drawn < c.total && 'text-warn')}>{nf(0).format(c.drawn)}</td>
                  <td className="py-1.5 pl-2 text-right">
                    <SupportBadge level={c.level} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-subtle">Satırın üzerine gelerek destek ayrıntısını görebilirsiniz.</p>
        </Section>
      )}
      {r && r.blocks.length > 0 && (
        <Section title={`Bloklar (${r.blocks.length})`}>
          <ul className="space-y-1">
            {r.blocks.slice(0, 40).map((b) => (
              <li key={b.name} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="min-w-0 truncate font-mono text-[11.5px] text-ink" title={b.name}>
                  {b.name}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted">
                  {b.xref ? 'XREF' : `${nf(0).format(b.insertCount)} ref.`}
                </span>
              </li>
            ))}
          </ul>
          {r.blocks.length > 40 && <p className="mt-1.5 text-[11.5px] text-subtle">+{r.blocks.length - 40} blok daha</p>}
        </Section>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ Katmanlar

export function LayersPanel({ scene, hidden, onChange }: { scene: Scene; hidden: Set<string>; onChange: (next: Set<string>) => void }) {
  const [q, setQ] = useState('')
  const layers = useMemo(() => {
    const term = q.trim().toLocaleLowerCase('tr')
    return scene.layers.filter((l) => !term || l.name.toLocaleLowerCase('tr').includes(term))
  }, [scene.layers, q])
  const toggle = (name: string) => {
    const next = new Set(hidden)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    onChange(next)
  }
  const visibleCount = scene.layers.filter((l) => !hidden.has(l.name)).length
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-line p-3">
        <label className="relative block">
          <span className="sr-only">Katman ara</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Katman ara"
            className="h-9 w-full rounded-lg border border-line bg-surface pr-2 pl-8 text-base text-ink placeholder:text-subtle sm:text-[13px]"
            data-testid="layer-search"
          />
        </label>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11.5px] text-muted">
            {visibleCount}/{scene.layers.length} görünür
          </span>
          <div className="flex gap-1">
            <MiniButton onClick={() => onChange(new Set())}>Tümünü göster</MiniButton>
            <MiniButton onClick={() => onChange(new Set(scene.layers.map((l) => l.name)))}>Gizle</MiniButton>
          </div>
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="Katmanlar">
        {layers.map((l) => {
          const off = hidden.has(l.name)
          return (
            <li key={l.name} className="group flex items-center gap-2 px-2 py-0.5">
              <button
                type="button"
                onClick={() => toggle(l.name)}
                aria-pressed={!off}
                aria-label={`${l.name} katmanını ${off ? 'göster' : 'gizle'}`}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
              >
                {off ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              </button>
              <span className="h-3 w-3 shrink-0 rounded-sm border border-line-strong" style={{ background: l.aci === 7 ? 'var(--ink)' : rgbCss(l.rgb) }} aria-hidden="true" />
              <span className={cn('min-w-0 flex-1 truncate text-[12.5px]', off ? 'text-subtle line-through' : 'text-ink')} title={l.name}>
                {l.name}
              </span>
              {(l.frozen || l.off) && <span className="shrink-0 text-[10px] text-subtle">{l.frozen ? 'dondurulmuş' : 'kapalı'}</span>}
              <span className="shrink-0 font-mono text-[10.5px] text-subtle">{nf(0).format(l.count)}</span>
              <button
                type="button"
                onClick={() => onChange(new Set(scene.layers.filter((x) => x.name !== l.name).map((x) => x.name)))}
                className="hidden shrink-0 rounded-md px-1.5 py-1 text-[10.5px] font-semibold text-muted group-hover:block hover:bg-surface-2 hover:text-ink"
                title="Yalnızca bu katmanı göster"
              >
                Yalnız
              </button>
            </li>
          )
        })}
        {layers.length === 0 && <li className="px-4 py-6 text-center text-[12.5px] text-muted">Eşleşen katman yok.</li>}
      </ul>
    </div>
  )
}

// ------------------------------------------------------------------ Seçili nesne

function blockChain(scene: Scene, e: SceneEntity) {
  const chain: { name: string; detail: string }[] = []
  let i = e.insert
  let guard = 0
  while (i >= 0 && guard++ < 40) {
    const ins = scene.inserts[i]
    chain.unshift({
      name: ins.block,
      detail: `${nf(1).format(ins.rotationDeg)}° · ölçek ${nf(3).format(ins.sx)}×${nf(3).format(ins.sy)}${ins.mirrored ? ' · aynalı' : ''}`,
    })
    i = ins.parent
  }
  return chain
}

export function PropertiesPanel({
  scene,
  selection,
  units,
  unit,
  onSelectInsert,
}: {
  scene: Scene
  selection: number[]
  units: UnitState
  unit: DisplayUnitId
  onSelectInsert: (insertId: number) => void
}) {
  if (selection.length === 0) {
    return <p className="px-4 py-6 text-center text-[12.5px] text-muted">Bir nesneyi seçmek için çizimde tıklayın. Shift ile çoklu seçim yapılır.</p>
  }
  const L = (v: number) => formatLengthWorld(v, units, unit)
  const A = (v: number) => formatAreaWorld(v, units)
  if (selection.length > 1) {
    const ents = selection.map((id) => scene.entities[id])
    const len = ents.reduce((s, e) => s + (e.length ?? 0), 0)
    const area = ents.reduce((s, e) => s + (e.area ?? 0), 0)
    return (
      <Section title={`${selection.length} nesne seçili`}>
        <dl>
          <KV k="Toplam uzunluk" v={L(len)} />
          <KV k="Toplam alan" v={area > 0 ? A(area) : '—'} />
        </dl>
      </Section>
    )
  }
  const e = scene.entities[selection[0]]
  if (!e) return null
  const sup = supportOf(e.type)
  const chain = blockChain(scene, e)
  return (
    <div data-testid="properties">
      <Section title="Nesne">
        <div className="mb-2 flex items-center gap-2">
          <span className="font-mono text-[13px] font-semibold text-ink">{e.type}</span>
          <SupportBadge level={sup.level} />
        </div>
        <dl>
          <KV k="Katman" v={e.layer} />
          <KV k="Renk" v={<span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-line-strong" style={{ background: rgbCss(e.rgb) }} />{e.rgb == null ? 'Katman / varsayılan' : rgbCss(e.rgb)}</span>} />
          {e.handle && <KV k="Tanıtıcı" v={e.handle} mono />}
        </dl>
      </Section>
      <Section title="Geometri">
        <dl>
          {e.rect && (
            <>
              <KV k="Genişlik" v={L(e.rect.w)} />
              <KV k="Yükseklik" v={L(e.rect.h)} />
            </>
          )}
          {e.circle && (
            <>
              <KV k="Yarıçap" v={L(e.circle[2])} />
              <KV k="Çap" v={L(e.circle[2] * 2)} />
            </>
          )}
          {e.length != null && e.kind !== 'group' && <KV k={e.closed ? 'Çevre' : 'Uzunluk'} v={L(e.length)} />}
          {e.area != null && <KV k="Alan" v={A(e.area)} />}
          {e.kind === 'path' && <KV k="Köşe / nokta" v={nf(0).format(e.count)} mono />}
          <KV k="Hesap" v={e.exact ? 'Analitik (kesin)' : 'Parçalı yaklaşım'} />
        </dl>
        {e.text && <p className="mt-2 rounded-lg border border-line bg-surface-2 px-2.5 py-2 text-[12.5px] whitespace-pre-wrap text-ink">{e.text.value}</p>}
      </Section>
      {e.dim && (
        <Section title="Ölçü">
          <dl>
            <KV k="Tür" v={e.dim.kind} />
            <KV k="Geometriden" v={e.dim.measurement != null ? (e.dim.kind === 'acisal' ? `${nf(2).format((e.dim.measurement * 180) / Math.PI)}°` : L(e.dim.measurement)) : '—'} />
            <KV k="Görünen metin" v={e.dim.displayed ?? '—'} />
          </dl>
          {e.dim.override && (
            <p className="mt-2 rounded-lg border border-warn-line bg-warn-soft px-2.5 py-2 text-[12px] text-warn">
              Ölçü metni elle yazılmış; çizim geometrisinden bağımsızdır. Metraj için doğrulanmalıdır.
            </p>
          )}
        </Section>
      )}
      {e.hatch && (
        <Section title="Tarama">
          <dl>
            <KV k="Desen" v={e.hatch.solid ? 'Dolu (SOLID)' : e.hatch.pattern || '—'} />
            <KV k="Sınır döngüsü" v={e.hatch.loops} mono />
          </dl>
        </Section>
      )}
      {chain.length > 0 && (
        <Section title="Blok zinciri">
          <ol className="space-y-1.5">
            {chain.map((c, i) => (
              <li key={i} className="text-[12px]">
                <span className="font-mono text-ink">{'› '.repeat(i)}{c.name}</span>
                <span className="block text-[11px] text-muted">{c.detail}</span>
              </li>
            ))}
          </ol>
          <div className="mt-2">
            <MiniButton onClick={() => onSelectInsert(e.insert)}>Bloğun tamamını seç</MiniButton>
          </div>
        </Section>
      )}
      <p className="px-4 py-3 text-[11.5px] text-subtle">{sup.note}</p>
    </div>
  )
}

// ------------------------------------------------------------------ Ölçümler

export function MeasurementsPanel({
  list,
  active,
  units,
  unit,
  onRemove,
  onClear,
  action,
}: {
  list: Measurement[]
  active: Measurement | null
  units: UnitState
  unit: DisplayUnitId
  onRemove: (id: number) => void
  onClear: () => void
  action?: { label: string; run: (m: Measurement) => void }
}) {
  const value = (m: Measurement) => {
    if (m.kind === 'area') {
      let a = 0
      let p = 0
      for (let i = 0; i < m.points.length; i++) {
        const [x1, y1] = m.points[i]
        const [x2, y2] = m.points[(i + 1) % m.points.length]
        a += x1 * y2 - x2 * y1
        p += Math.hypot(x2 - x1, y2 - y1)
      }
      return `${formatAreaWorld(Math.abs(a) / 2, units)} · çevre ${formatLengthWorld(p, units, unit)}`
    }
    const [a, b] = m.points
    return b ? formatLengthWorld(Math.hypot(b[0] - a[0], b[1] - a[1]), units, unit) : '—'
  }
  return (
    <Section title="Ölçümler" actions={list.length > 0 ? <MiniButton onClick={onClear}>Temizle</MiniButton> : undefined}>
      {list.length === 0 && !active && <p className="text-[12px] text-muted">Mesafe (D) veya alan (A) aracıyla ölçüm yapın. Uç noktalara otomatik yakalanır.</p>}
      {active && (
        <p className="mb-2 text-[12px] text-warn">
          {active.kind === 'area' ? 'Alan ölçümü sürüyor: ilk noktaya tıklayın, çift tıklayın veya Enter.' : 'İkinci noktayı seçin.'} Esc ile iptal.
        </p>
      )}
      <ul className="space-y-1.5" data-testid="measurements">
        {list.map((m, i) => (
          <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2/60 px-2.5 py-1.5">
            <div className="min-w-0">
              <div className="text-[10.5px] font-semibold text-subtle uppercase">
                {m.kind === 'area' ? 'Alan' : 'Mesafe'} {i + 1}
              </div>
              <div className="truncate text-[12.5px] font-medium text-ink" data-testid="measurement-value">
                {value(m)}
              </div>
            </div>
            {action && (
              <button type="button" onClick={() => action.run(m)} className="h-8 shrink-0 rounded-md px-2 text-[11.5px] font-semibold text-ink hover:bg-surface" data-testid="measurement-action">
                {action.label}
              </button>
            )}
            <button type="button" onClick={() => onRemove(m.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface hover:text-danger" aria-label="Ölçümü sil">
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ------------------------------------------------------------------ Uyarılar

export function WarningsPanel({ warnings, onSelectHandle }: { warnings: ReportWarning[]; onSelectHandle: (h: string) => void }) {
  if (warnings.length === 0) return <p className="px-4 py-6 text-center text-[12.5px] text-muted">Analiz uyarısı yok.</p>
  const icon = { hata: AlertOctagon, uyari: AlertTriangle, bilgi: Info }
  const tone = { hata: 'text-danger', uyari: 'text-warn', bilgi: 'text-muted' }
  return (
    <ul className="divide-y divide-line" data-testid="warnings">
      {warnings.map((w) => {
        const I = icon[w.severity]
        return (
          <li key={w.code} className="flex gap-2.5 px-4 py-2.5">
            <I className={cn('mt-0.5 h-4 w-4 shrink-0', tone[w.severity])} aria-hidden="true" />
            <div className="min-w-0 text-[12.5px]">
              <p className="text-ink">
                {w.message}
                {w.count != null && w.count > 1 && <span className="ml-1.5 font-mono text-[11px] text-muted">×{nf(0).format(w.count)}</span>}
              </p>
              {w.handles && w.handles.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {w.handles.slice(0, 12).map((h) => (
                    <button key={h} type="button" onClick={() => onSelectHandle(h)} className="rounded border border-line bg-surface-2 px-1.5 font-mono text-[10.5px] text-ink-2 hover:border-line-strong">
                      {h}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ------------------------------------------------------------------ İşlem geçmişi

export interface LogEntry {
  at: Date
  message: string
}

export function HistoryPanel({ log }: { log: LogEntry[] }) {
  if (log.length === 0) return <p className="px-4 py-6 text-center text-[12.5px] text-muted">Henüz işlem yok.</p>
  const tf = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return (
    <ol className="divide-y divide-line" data-testid="history">
      {[...log].reverse().map((l, i) => (
        <li key={i} className="flex gap-3 px-4 py-2 text-[12.5px]">
          <time className="shrink-0 font-mono text-[11px] text-subtle">{tf.format(l.at)}</time>
          <span className="text-ink">{l.message}</span>
        </li>
      ))}
    </ol>
  )
}
