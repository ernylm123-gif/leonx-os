import { Activity, Building2, CalendarClock, Columns3, Lightbulb, List, MapPin, Radar, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Panel } from '@/components/ui/Panel'
import { ErrorState, SkeletonRows } from '@/components/ui/States'
import { FilterSelect, SearchInput } from '@/components/ui/Toolbar'
import { ANKARA_DISTRICTS, DISTRICTS } from '@radar/geo.ts'
import { LABEL_TEXT } from '@radar/score.ts'
import { categoryName } from '@radar/taxonomy.ts'
import { KIND_LABEL, RUN_LABEL, type RadarData, SECTOR_LABEL, STAGE_LABEL, STATUS_LABEL, STATUS_ORDER, PERMISSION_LABEL } from '@/data/radarTypes'
import { cn } from '@/lib/cn'
import { adviceFor, applyFilters, buildViews, daysLeft, DEFAULT_FILTERS, fmtDateTime, fmtDay, groupPipeline, kpis, localDate, locationText, type OppView, PIPELINE, type RadarFilters, sortAnkaraFirst } from '@/radar/view'
import { Kpi, Meter, NeedBadge, Notice } from './shared'

export function RadarDashboard({ data, loading, error, reload }: { data: RadarData; loading: boolean; error: string | null; reload: () => void }) {
  const [f, setF] = useState<RadarFilters>(DEFAULT_FILTERS)
  const [mode, setMode] = useState<'liste' | 'hat'>('liste')
  const views = useMemo(() => buildViews(data), [data])
  const quoted = useMemo(() => new Set(data.quotedOpportunityIds), [data.quotedOpportunityIds])
  const list = useMemo(() => sortAnkaraFirst(applyFilters(views, f)), [views, f])
  const k = useMemo(() => kpis(views, new Date(), data.settings?.high_priority_score ?? 75), [views, data.settings])
  const cities = useMemo(() => [...new Set(data.opportunities.map((o) => o.city).filter((c): c is string => !!c))].sort((a, b) => (a === 'Ankara' ? -1 : b === 'Ankara' ? 1 : a.localeCompare(b, 'tr'))), [data.opportunities])
  const lastRun = data.runs[0]
  const autoSources = data.sources.filter((s) => s.kind !== 'manual')
  const izinli = autoSources.filter((s) => s.permission_status === 'izinli' && s.active)
  const set = <K extends keyof RadarFilters>(key: K, v: RadarFilters[K]) => setF((x) => ({ ...x, [key]: v }))
  const dirty = JSON.stringify(f) !== JSON.stringify(DEFAULT_FILTERS)

  if (error && !data.opportunities.length) return <ErrorState message={error} onRetry={reload} />

  return (
    <div className="flex flex-col gap-6" data-testid="radar-dashboard">
      <section aria-label="Radar göstergeleri" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Bugün yeni" value={k.todayNew} testId="kpi-today" />
        <Kpi label="Ankara" value={k.ankara} hint="İl ve ilçeleri" testId="kpi-ankara" />
        <Kpi label="Türkiye geneli" value={k.turkey} hint="Aktif fırsatlar" testId="kpi-turkey" />
        <Kpi label="Yüksek öncelikli" value={k.highPriority} hint={`Doğrulanmış + puan ≥ ${data.settings?.high_priority_score ?? 75}`} tone={k.highPriority ? 'ok' : undefined} testId="kpi-high" />
        <Kpi label="Son tarihi yaklaşan" value={k.deadlineSoon} hint="≤ 14 gün" tone={k.deadlineSoon ? 'warn' : undefined} testId="kpi-deadline" />
        <Kpi label="İletişim bekleyen" value={k.awaitingContact} hint="Firma doğrulandı / iletişim planlandı" testId="kpi-contact" />
        <Kpi label="Son 24 saatte güncellenen" value={k.updated24h} testId="kpi-updated" />
        <Kpi label="Doğrulanmamış" value={k.unverified} hint="Yalnız potansiyel ihtiyaç" testId="kpi-unverified" />
      </section>

      <Panel title="Tarama durumu" subtitle={lastRun ? `Son tarama: ${fmtDateTime(lastRun.started_at)} · ${RUN_LABEL[lastRun.status]}` : 'Henüz tarama yapılmadı'} icon={Activity}>
        {!lastRun && (
          <Notice testId="radar-scan-empty">
            Otomatik tarama, sunucu işlevi (<b>radar-scan</b>) sahip onayıyla dağıtıldıktan ve en az bir kaynak <b>İzinli</b> ve <b>etkin</b> olarak işaretlendikten sonra başlar
            (saatte bir). Şu an {autoSources.length} otomatik kaynak kayıtlı, {izinli.length} tanesi izinli ve etkin. Bu arada “Kaynaklar” bölümünden bağlantıyı elle ekleyebilirsiniz.
          </Notice>
        )}
        {autoSources.length > 0 && (
          <ul className="mt-3 divide-y divide-line text-[13px]" data-testid="source-health">
            {autoSources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{s.name}</span>
                <span className="text-[11.5px] text-muted">{KIND_LABEL[s.kind]} · {PERMISSION_LABEL[s.permission_status]}{s.active ? '' : ' · pasif'}</span>
                <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-semibold', s.last_status === 'hata' ? 'bg-danger-soft text-danger' : s.last_status ? 'bg-surface-2 text-ink-2' : 'bg-surface-2 text-subtle')}>
                  {s.last_status ? RUN_LABEL[s.last_status] : 'Çalışmadı'}
                </span>
                {s.consecutive_failures > 0 && <span className="text-[11.5px] text-danger">{s.consecutive_failures} ardışık hata</span>}
                {s.last_error && <span className="w-full truncate text-[11.5px] text-subtle">Son hata/uyarı: {s.last_error}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <section aria-label="Fırsatlar" className="flex flex-col gap-3">
        <div className="flex flex-col gap-2.5">
          <SearchInput value={f.q} onChange={(v) => set('q', v)} placeholder="Fırsat, şehir veya firma ara…" label="Fırsatlarda ara" />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6" data-testid="radar-filters">
            <FilterSelect value={f.city} onChange={(v) => setF((x) => ({ ...x, city: v, district: !v || (DISTRICTS[v] ?? []).includes(x.district) ? x.district : '' }))} label="Şehir">
              <option value="">Tüm şehirler</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </FilterSelect>
            <FilterSelect value={f.district} onChange={(v) => set('district', v)} label={f.city && f.city !== 'Ankara' ? `İlçe (${f.city})` : 'İlçe (Ankara)'}>
              <option value="">Tüm ilçeler</option>
              {(f.city ? DISTRICTS[f.city] ?? [] : ANKARA_DISTRICTS).map((d) => <option key={d} value={d}>{d}</option>)}
            </FilterSelect>
            <FilterSelect value={f.category} onChange={(v) => set('category', v)} label="Kategori">
              <option value="">Tüm kategoriler</option>
              {data.categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
            </FilterSelect>
            <FilterSelect value={f.sector} onChange={(v) => set('sector', v as RadarFilters['sector'])} label="Kamu / özel">
              <option value="">Kamu ve özel</option>
              {(['kamu', 'ozel', 'bilinmiyor'] as const).map((s) => <option key={s} value={s}>{SECTOR_LABEL[s]}</option>)}
            </FilterSelect>
            <FilterSelect value={f.stage} onChange={(v) => set('stage', v)} label="Aşama">
              <option value="">Tüm aşamalar</option>
              {Object.entries(STAGE_LABEL).map(([s, l]) => <option key={s} value={s}>{l}</option>)}
            </FilterSelect>
            <FilterSelect value={String(f.minScore)} onChange={(v) => set('minScore', Number(v))} label="En düşük puan">
              {[0, 40, 50, 60, 70, 80, 90].map((n) => <option key={n} value={n}>{n ? `Puan ≥ ${n}` : 'Tüm puanlar'}</option>)}
            </FilterSelect>
            <FilterSelect value={f.verification} onChange={(v) => set('verification', v as RadarFilters['verification'])} label="Doğrulama durumu">
              <option value="">Doğrulanmış ve potansiyel</option>
              <option value="dogrulanmis">Yalnız doğrulanmış</option>
              <option value="potansiyel">Yalnız potansiyel</option>
            </FilterSelect>
            <FilterSelect value={f.sourceKind} onChange={(v) => set('sourceKind', v as RadarFilters['sourceKind'])} label="Kaynak türü">
              <option value="">Tüm kaynak türleri</option>
              {Object.entries(KIND_LABEL).map(([s, l]) => <option key={s} value={s}>{l}</option>)}
            </FilterSelect>
            <FilterSelect value={f.status} onChange={(v) => set('status', v as RadarFilters['status'])} label="Durum">
              <option value="aktif">Aktif (ilgisiz/kaybedilen hariç)</option>
              <option value="">Tüm durumlar</option>
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </FilterSelect>
            <label className="flex min-w-0 flex-col text-[11px] text-muted">
              Son tarih (başlangıç)
              <input type="date" value={f.deadlineFrom} onChange={(e) => set('deadlineFrom', e.target.value)} aria-label="Son tarih başlangıç" className="h-9 rounded-lg border border-line bg-surface px-2 text-base text-ink sm:text-sm" />
            </label>
            <label className="flex min-w-0 flex-col text-[11px] text-muted">
              Son tarih (bitiş)
              <input type="date" value={f.deadlineTo} onChange={(e) => set('deadlineTo', e.target.value)} aria-label="Son tarih bitiş" className="h-9 rounded-lg border border-line bg-surface px-2 text-base text-ink sm:text-sm" />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>
              <b className="font-semibold text-ink" data-testid="radar-count">{list.length}</b> fırsat · Ankara öncelikli sıralama
            </span>
            <div role="radiogroup" aria-label="Görünüm" className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
              {([['liste', 'Liste', List], ['hat', 'CRM hattı', Columns3]] as const).map(([k, label, Icon]) => (
                <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} data-testid={`radar-mode-${k}`}
                  className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold', mode === k ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
                </button>
              ))}
            </div>
            {dirty && (
              <button type="button" className="inline-flex items-center gap-1 font-medium text-ink-2 hover:underline" onClick={() => setF(DEFAULT_FILTERS)}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Filtreleri temizle
              </button>
            )}
          </div>
        </div>

        {loading && !data.opportunities.length ? (
          <SkeletonRows />
        ) : !data.opportunities.length ? (
          <div className="card flex flex-col items-center px-6 py-12 text-center" data-testid="radar-empty">
            <Radar className="h-10 w-10 text-titanium" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold text-ink">Henüz fırsat yok</h2>
            <p className="mt-2 max-w-lg text-sm text-muted">
              Radar yalnız kaynaklardan doğrulanabilen kayıtları gösterir; örnek veya uydurma fırsat eklenmez. Tarama, sunucu işlevi dağıtılıp kaynaklar “İzinli” olarak
              işaretlendikten sonra başlar. Elle bağlantı eklemek için “Kaynaklar” bölümünü kullanın.
            </p>
          </div>
        ) : !list.length ? (
          <p className="card px-5 py-8 text-center text-sm text-subtle">Filtrelere uyan fırsat yok.</p>
        ) : mode === 'hat' ? (
          <PipelineBoard views={list} quoted={quoted} />
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="radar-list">
            {list.map((v) => <OpportunityCard key={v.opp.id} v={v} quoted={quoted.has(v.opp.id)} />)}
          </ul>
        )}
      </section>
    </div>
  )
}

/** CRM hattı: mevcut durum değerleri sütun olarak; "Teklif hazırlandı" bağlı teklif taslağından türetilir */
function PipelineBoard({ views, quoted }: { views: OppView[]; quoted: ReadonlySet<string> }) {
  const groups = groupPipeline(views, quoted)
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="radar-pipeline">
      {PIPELINE.map((p) => {
        const list = groups.get(p.key) ?? []
        return (
          <section key={p.key} aria-label={`${p.label} (${list.length})`} className="card min-w-0 p-3" data-testid={`pipeline-${p.key}`}>
            <h3 className="flex items-center justify-between text-[12px] font-semibold text-muted">
              <span>{p.label}</span><span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-ink-2" data-testid="pipeline-count">{list.length}</span>
            </h3>
            {list.length === 0 ? (
              <p className="mt-2 text-[11.5px] text-subtle">Kayıt yok</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {list.slice(0, 25).map((v) => {
                  const a = adviceFor(v, quoted.has(v.opp.id))
                  return (
                    <li key={v.opp.id} className="rounded-lg border border-line bg-surface p-2.5">
                      <Link to={`/leonx-ai/firsat/${v.opp.id}`} className="block text-[13px] font-semibold break-words text-ink hover:underline">{v.opp.title}</Link>
                      <p className="mt-0.5 text-[11.5px] text-muted">{locationText(v.opp)} · puan {v.opp.score}</p>
                      <p className="mt-1 text-[11.5px] text-ink-2" title={a.reason}>Öneri: {a.text}</p>
                    </li>
                  )
                })}
                {list.length > 25 && <li className="text-[11.5px] text-subtle">+{list.length - 25} kayıt (süzgeçleri daraltın)</li>}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}

function OpportunityCard({ v, quoted }: { v: OppView; quoted: boolean }) {
  const o = v.opp
  const advice = adviceFor(v, quoted)
  const today = localDate()
  const left = daysLeft(o.deadline, today)
  const firm = v.companies[0]?.company.name
  return (
    <li className="card min-w-0 p-4" data-testid="radar-card" data-ankara={o.is_ankara}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/leonx-ai/firsat/${o.id}`} className="block font-semibold break-words text-ink hover:underline" data-testid="radar-card-title">
            {o.title}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
            <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{locationText(o)}</span>
            <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" aria-hidden="true" />{firm ?? 'Firma bilinmiyor'}</span>
            {o.deadline && (
              <span className={cn('inline-flex items-center gap-1', left != null && left <= 14 && left >= 0 ? 'font-semibold text-warn' : '')}>
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />Son tarih {fmtDay(o.deadline)}{left != null && left >= 0 ? ` (${left} gün)` : left != null ? ' (geçti)' : ''}
              </span>
            )}
          </div>
        </div>
        <span className={cn('shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold', o.verified_need ? 'border-ok/25 bg-ok-soft text-ok' : 'border-warn-line bg-warn-soft text-warn')} data-testid="radar-card-label">
          {LABEL_TEXT[o.label]}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {v.categories.slice(0, 5).map((c) => <NeedBadge key={c.id} need={c.need_status}>{categoryName(c.category_key)}</NeedBadge>)}
        {v.categories.length > 5 && <span className="text-[11px] text-subtle">+{v.categories.length - 5}</span>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Meter label="Fırsat puanı" value={o.score} tone={o.verified_need ? 'ok' : 'warn'} testId="radar-card-score" />
        <Meter label="Güvenilirlik" value={o.reliability} tone="muted" testId="radar-card-reliability" />
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-[12px] text-ink-2" data-testid="radar-card-advice">
        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
        <span><b className="font-semibold">Öneri: {advice.text}</b> <span className="text-muted">— {advice.reason} (tavsiyedir, doğrulanmış bilgi değildir)</span></span>
      </p>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-[11.5px] text-subtle">
        <span>{STATUS_LABEL[o.status]}{quoted ? ' · teklif taslağı var' : ''} · güncelleme {fmtDateTime(o.last_updated_at)}</span>
        <span className="text-ink-2">Sonraki aksiyon: {o.next_action ?? '—'}</span>
      </div>
    </li>
  )
}
