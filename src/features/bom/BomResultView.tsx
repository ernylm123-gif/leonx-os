import { type ReactNode, useState } from 'react'
import { type BomCalcLine, type CutListEntry, groupByRole, type MaterialTotal } from '@/bom/engine'
import { type BomWarningRow, ROLE_LABEL } from '@/bom/types'
import { fmtInt, fmtMm, fmtQty, qtyUnit } from '@/export/bomReport'
import { cn } from '@/lib/cn'
import { formatMoney } from '@/quote/money'
import type { Currency } from '@/quote/types'
import { CostText, WarningList } from './shared'

const TH = 'px-3 py-2 whitespace-nowrap'
const TD = 'px-3 py-1.5'
const NUM = 'px-3 py-1.5 text-right font-mono tabular-nums whitespace-nowrap'

type Tab = 'toplam' | 'kesim' | 'satirlar'

/**
 * Hesap sonucu veya kayıtlı sürüm: özet, uyarılar, malzeme toplamları, profil kesim listesi ve rol bazında
 * satırlar. Ekran, Excel ve PDF aynı motor fonksiyonlarını (materialTotals, cutList) kullanır.
 */
export function BomResultView({
  lines,
  totals,
  cutList,
  warnings,
  cost,
  unpriced,
  testId = 'bom-result',
}: {
  lines: BomCalcLine[]
  totals: MaterialTotal[]
  cutList: CutListEntry[]
  warnings: BomWarningRow[]
  cost: Partial<Record<Currency, number>>
  unpriced: number
  testId?: string
}) {
  const [tab, setTab] = useState<Tab>('toplam')
  const errors = warnings.filter((w) => w.level === 'hata').length
  const warns = warnings.filter((w) => w.level === 'uyari').length
  const profileMilli = totals.filter((t) => t.unit === 'mm_profil').reduce((s, t) => s + t.totalMilli, 0)
  const bars = totals.reduce((s, t) => s + (t.barEstimate ?? 0), 0)
  return (
    <div className="space-y-4" data-testid={testId}>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Tile label="Malzeme satırı" value={lines.length.toLocaleString('tr-TR')} sub={`${totals.length} kalem`} testId="bom-tile-lines" />
        <Tile label="Profil (fire dahil)" value={`${fmtQty(profileMilli)} m`} sub={bars ? `≈ ${bars} standart boy (tahmini)` : 'standart boy tanımsız'} testId="bom-tile-profile" />
        <Tile label="Maliyet (fiyatlı satırlar)" value={<CostText cost={cost} />} sub={unpriced ? `${unpriced} satır fiyat tanımlı değil` : 'tüm satırlar fiyatlı'} warn={unpriced > 0} testId="bom-tile-cost" />
        <Tile label="Hata / uyarı" value={`${errors} / ${warns}`} sub={errors ? 'hatalı reçete onaylanamaz' : 'hata yok'} warn={errors > 0} testId="bom-tile-errors" />
      </div>
      {warnings.length > 0 && (
        <div className="rounded-xl border border-line bg-surface-2/50 px-3 py-2.5">
          <WarningList warnings={warnings} />
        </div>
      )}
      <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface-2 p-1" role="tablist" aria-label="Reçete görünümü">
        {(
          [
            ['toplam', `Malzeme toplamları (${totals.length})`],
            ['kesim', `Kesim listesi (${cutList.length})`],
            ['satirlar', `Satırlar (${lines.length})`],
          ] as [Tab, string][]
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={tab === v}
            onClick={() => setTab(v)}
            className={cn('h-9 flex-1 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-colors', tab === v ? 'border border-line bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}
            data-testid={`bom-tab-${v}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'toplam' && (
        <div className="overflow-x-auto rounded-xl border border-line" data-testid="bom-totals">
          <table className="w-full min-w-[860px] text-[12.5px]">
            <thead className="bg-surface-2 text-left text-[10.5px] font-semibold tracking-wide text-subtle uppercase">
              <tr>
                <th className={TH}>Rol</th>
                <th className={TH}>Kod</th>
                <th className={TH}>Malzeme</th>
                <th className={cn(TH, 'text-right')}>Parça</th>
                <th className={cn(TH, 'text-right')}>Net</th>
                <th className={cn(TH, 'text-right')}>Fire</th>
                <th className={cn(TH, 'text-right')}>Toplam</th>
                <th className={TH}>Birim</th>
                <th className={cn(TH, 'text-right')} title="Yukarı yuvarla(fire dahil toplam / standart boy) — tahmin, optimizasyon değil">
                  Tah. boy
                </th>
                <th className={cn(TH, 'text-right')}>Ağırlık kg</th>
                <th className={cn(TH, 'text-right')}>Maliyet</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((t) => (
                <tr key={t.key} className="border-t border-line" data-testid="bom-total-row" data-code={t.code ?? ''}>
                  <td className={TD}>{ROLE_LABEL[t.role]}</td>
                  <td className={cn(TD, 'font-mono text-[12px]', !t.code && 'text-warn')}>{t.code ?? 'kod yok'}</td>
                  <td className={cn(TD, 'text-ink')}>{t.name}</td>
                  <td className={NUM}>{fmtInt(t.pieces)}</td>
                  <td className={NUM}>{fmtQty(t.netMilli)}</td>
                  <td className={NUM}>{t.wasteMilli ? fmtQty(t.wasteMilli) : '—'}</td>
                  <td className={cn(NUM, 'font-semibold text-ink')} data-testid="bom-total-qty">
                    {fmtQty(t.totalMilli)}
                  </td>
                  <td className={TD}>{qtyUnit(t.unit)}</td>
                  <td className={NUM} data-testid="bom-total-bars">
                    {fmtInt(t.barEstimate)}
                  </td>
                  <td className={NUM}>{t.weightMilli == null ? '—' : fmtQty(t.weightMilli)}</td>
                  <td className={NUM}>{Object.keys(t.cost).length ? <CostText cost={t.cost} /> : <span className="text-subtle">fiyat tanımlı değil</span>}</td>
                </tr>
              ))}
              {totals.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-muted">
                    Satır yok. Pozlara sistem atayın; sistemin bileşen ve kurallarını kütüphanede tanımlayın.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'kesim' && (
        <div className="space-y-2">
          <p className="text-[12px] text-muted">Profil kodu × kesim boyu × açı. Kesim optimizasyonu (boy yerleşimi) sonraki aşamadadır; standart boy adedi yalnız tahmindir.</p>
          <div className="overflow-x-auto rounded-xl border border-line" data-testid="bom-cutlist">
            <table className="w-full min-w-[640px] text-[12.5px]">
              <thead className="bg-surface-2 text-left text-[10.5px] font-semibold tracking-wide text-subtle uppercase">
                <tr>
                  <th className={TH}>Kod</th>
                  <th className={TH}>Profil</th>
                  <th className={cn(TH, 'text-right')}>Kesim boyu mm</th>
                  <th className={TH}>Açı</th>
                  <th className={cn(TH, 'text-right')}>Parça</th>
                  <th className={cn(TH, 'text-right')}>Std. boy mm</th>
                  <th className={TH}>Pozlar</th>
                </tr>
              </thead>
              <tbody>
                {cutList.map((c) => (
                  <tr key={c.key} className="border-t border-line" data-testid="bom-cut-row" data-code={c.code ?? ''} data-cut={c.cutDmm / 10}>
                    <td className={cn(TD, 'font-mono text-[12px]')}>{c.code ?? 'kod yok'}</td>
                    <td className={TD}>
                      <span className="text-ink">{c.name}</span> <span className="text-subtle">· {ROLE_LABEL[c.role]}</span>
                    </td>
                    <td className={cn(NUM, 'font-semibold text-ink')}>{fmtMm(c.cutDmm)}</td>
                    <td className={TD}>{c.angle ? `${c.angle}°` : '—'}</td>
                    <td className={NUM} data-testid="bom-cut-pieces">
                      {fmtInt(c.pieces)}
                    </td>
                    <td className={NUM}>{fmtInt(c.standardLengthMm)}</td>
                    <td className={cn(TD, 'text-muted')}>{c.poz.join(', ')}</td>
                  </tr>
                ))}
                {cutList.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-muted">
                      Kesimli profil satırı yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'satirlar' && (
        <div className="space-y-3" data-testid="bom-lines">
          {groupByRole(lines).map((g) => (
            <section key={g.role} className="overflow-hidden rounded-xl border border-line">
              <h4 className="border-b border-line bg-surface-2 px-3 py-2 text-[12px] font-semibold text-ink">
                {g.label} <span className="font-normal text-subtle">· {g.lines.length} satır</span>
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-[12.5px]">
                  <thead className="text-left text-[10.5px] font-semibold tracking-wide text-subtle uppercase">
                    <tr>
                      <th className={TH}>Poz</th>
                      <th className={TH}>Kod · malzeme</th>
                      <th className={cn(TH, 'text-right')}>Kesim mm</th>
                      <th className={TH}>Açı</th>
                      <th className={cn(TH, 'text-right')}>Parça</th>
                      <th className={cn(TH, 'text-right')}>Net</th>
                      <th className={cn(TH, 'text-right')}>Toplam</th>
                      <th className={TH}>Birim</th>
                      <th className={cn(TH, 'text-right')}>Tutar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lines.map((l) => (
                      <tr key={l.lineKey} className="border-t border-line" data-testid="bom-line" data-key={l.lineKey}>
                        <td className={cn(TD, 'font-mono text-[12px] font-semibold text-ink')}>{l.poz}</td>
                        <td className={TD}>
                          <span className="font-mono text-[12px] text-muted">{l.code ?? 'kod yok'}</span> <span className="text-ink">{l.name}</span>
                        </td>
                        <td className={NUM}>{fmtMm(l.cutDmm)}</td>
                        <td className={TD}>{l.angle ? `${l.angle}°` : '—'}</td>
                        <td className={NUM}>{fmtInt(l.pieces)}</td>
                        <td className={NUM}>{fmtQty(l.netMilli)}</td>
                        <td className={cn(NUM, 'text-ink')}>{fmtQty(l.totalMilli)}</td>
                        <td className={TD}>{qtyUnit(l.unit)}</td>
                        <td className={NUM}>{l.lineCostCents != null && l.currency ? formatMoney(l.lineCostCents, l.currency) : <span className="text-subtle">{l.costNote ?? 'fiyat tanımlı değil'}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          {lines.length === 0 && <p className="px-1 text-sm text-muted">Satır yok.</p>}
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, sub, warn, testId }: { label: string; value: ReactNode; sub?: string; warn?: boolean; testId?: string }) {
  return (
    <div className={cn('min-w-0 rounded-xl border px-3 py-2.5', warn ? 'border-warn-line bg-warn-soft' : 'border-line bg-surface-2/60')} data-testid={testId}>
      <div className={cn('text-[11px] font-medium', warn ? 'text-warn' : 'text-muted')}>{label}</div>
      <div className="mt-0.5 truncate text-[15px] font-semibold text-ink">{value}</div>
      {sub && <div className={cn('mt-0.5 truncate text-[11px]', warn ? 'text-warn' : 'text-subtle')}>{sub}</div>}
    </div>
  )
}
