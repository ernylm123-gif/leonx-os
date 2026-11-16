import { Activity, Building2, CheckCircle2, ExternalLink, HardHat, Mail, MapPinned, Settings2, TrendingUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { FormAlert, TextAreaField } from '@/components/ui/Field'
import { Panel } from '@/components/ui/Panel'
import { Toggle } from '@/components/ui/Toggle'
import { FilterSelect, SearchInput } from '@/components/ui/Toolbar'
import { useToast } from '@/context/toast'
import { loadDistrictCoverage, loadOutreachDrafts, loadPrivateOverview, saveRadarSettings, setDraftReply, updateCompanyMonitoring, updateDraft } from '@/data/radarApi'
import { type DistrictCoverage, PERMISSION_LABEL, type PrivateOverview, type PrivateRun, type PrivateSegment, type RadarCompany, type RadarData, type RadarDraft, type RadarOpportunity, REPLY_LABEL, type ReplyStatus } from '@/data/radarTypes'
import { cn } from '@/lib/cn'
import { dataErrorMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { fmtDateTime, fmtDay } from '@/radar/view'
import { CONTRACTOR_KIND_LABEL, type ContractorKind, SIZE_LABEL, type SizeBand } from '@radar/company.ts'
import { PRODUCT_LABEL, type ProductGroup } from '@radar/construction.ts'
import { DISCOVERY_STATUS_LABEL } from '@radar/discovery.ts'
import { ANKARA_DISTRICTS } from '@radar/geo.ts'
import { BLOCK_LABEL, type BlockReason } from '@radar/outreach.ts'
import { CONFIDENCE_LABEL, SEGMENT_LABEL, STAGE_UNVERIFIED } from '@radar/privateIntel.ts'
import { PROJECT_TYPE_BY_KEY, PROJECT_TYPES } from '@radar/taxonomy.ts'
import { ExtLink, Kpi, Notice } from './shared'

type Tab = PrivateSegment | 'firmalar'
const TABS: Tab[] = ['ozel_proje', 'yeni_baslayan', 'aktif_santiye', 'firmalar', 'teklif_firsati', 'kamu_ihale']
const TAB_LABEL: Record<Tab, string> = { ...SEGMENT_LABEL, firmalar: 'Müteahhit Firmaları' }

const QUALITY = [
  { v: '', l: 'Tüm fırsat kaliteleri' },
  { v: '70', l: 'Yüksek (≥ 70)' },
  { v: '50', l: 'Orta ve üzeri (≥ 50)' },
]

const STATUS_TONE: Record<PrivateRun['status'], string> = {
  basarili: 'bg-ok-soft text-ok',
  basarili_yeni_yok: 'bg-surface-2 text-ink-2',
  eksik: 'bg-warn-soft text-warn',
  basarisiz: 'bg-danger-soft text-danger',
  kaynak_yok: 'bg-warn-soft text-warn',
  yapilandirma_eksik: 'bg-warn-soft text-warn',
  kota_doldu: 'bg-warn-soft text-warn',
}

interface Filters { q: string; district: string; company: string; stage: string; type: string; product: string; quality: string; contact: string; outreach: string; reply: string }
const NO_FILTERS: Filters = { q: '', district: '', company: '', stage: '', type: '', product: '', quality: '', contact: '', outreach: '', reply: '' }

/**
 * 020: Özel sektör inşaat satış paneli. Bölümler, puanlar, aşamalar ve sayılar sunucuda yazılan kayıtlardan
 * gelir; uydurma ölçüt, tahmini yanıt oranı veya garanti gösterilmez. Kamu ihaleleri ayrı, ikincil sekmededir.
 */
export function PrivateSectorPanel({ data }: { data: RadarData }) {
  const [ov, setOv] = useState<PrivateOverview | null | 'yok'>(null)
  const [cov, setCov] = useState<DistrictCoverage[]>([])
  const [drafts, setDrafts] = useState<RadarDraft[]>([])
  const [tab, setTab] = useState<Tab>('ozel_proje')
  const [f, setF] = useState<Filters>(NO_FILTERS)
  const [tick, setTick] = useState(0)
  const refreshKey = `${data.opportunities.length}:${data.companies.length}:${data.contacts.length}:${data.opportunities[0]?.last_updated_at ?? ''}:${tick}`

  useEffect(() => {
    let live = true
    const db = requireSupabase()
    Promise.all([loadPrivateOverview(db), loadDistrictCoverage(db), loadOutreachDrafts(db).catch(() => [])]).then(([o, c, d]) => {
      if (!live) return
      setOv(o ?? 'yok')
      setCov(c)
      setDrafts(d)
    }, () => live && setOv('yok'))
    return () => {
      live = false
    }
  }, [refreshKey])

  const companyOf = useMemo(() => {
    const byId = new Map(data.companies.map((c) => [c.id, c]))
    const m = new Map<string, RadarCompany[]>()
    for (const l of data.oppCompanies) {
      const c = byId.get(l.company_id)
      if (c) m.set(l.opportunity_id, [...(m.get(l.opportunity_id) ?? []), c])
    }
    return m
  }, [data.companies, data.oppCompanies])
  const contactsOf = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of data.contacts) m.set(c.company_id, (m.get(c.company_id) ?? 0) + 1)
    return m
  }, [data.contacts])
  const draftOf = useMemo(() => {
    const m = new Map<string, RadarDraft>()
    for (const d of drafts) if (!m.has(d.opportunity_id)) m.set(d.opportunity_id, d)
    return m
  }, [drafts])

  const inTab = (o: RadarOpportunity, t: PrivateSegment) => (t === 'kamu_ihale' ? o.sector === 'kamu' || (o.segments ?? []).includes('kamu_ihale') : (o.segments ?? []).includes(t))
  const list = useMemo(() => {
    if (tab === 'firmalar') return []
    const q = f.q.toLocaleLowerCase('tr-TR')
    return data.opportunities
      .filter((o) => o.status !== 'ilgisiz' && o.status !== 'kaybedildi' && inTab(o, tab))
      .filter((o) => {
        const cos = companyOf.get(o.id) ?? []
        const d = draftOf.get(o.id)
        if (q && !`${o.title} ${o.district ?? ''} ${cos.map((c) => c.name).join(' ')}`.toLocaleLowerCase('tr-TR').includes(q)) return false
        if (f.district && o.district !== f.district) return false
        if (f.company && !cos.some((c) => c.id === f.company)) return false
        if (f.stage === 'dogrulanamadi' ? o.stage_active === true : f.stage && o.construction_stage !== f.stage) return false
        if (f.type && o.project_type !== f.type) return false
        if (f.product && !(o.product_groups ?? []).includes(f.product)) return false
        if (f.quality && (o.private_score ?? 0) < Number(f.quality)) return false
        const hasContact = cos.some((c) => (contactsOf.get(c.id) ?? 0) > 0)
        if (f.contact === 'var' && !hasContact) return false
        if (f.contact === 'yok' && hasContact) return false
        if (f.outreach === 'yok' ? !!d : f.outreach && d?.status !== f.outreach) return false
        if (f.reply && (d?.reply_status ?? 'yok') !== f.reply) return false
        return true
      })
      .sort((a, b) => (b.private_score ?? -1) - (a.private_score ?? -1) || Date.parse(b.last_updated_at) - Date.parse(a.last_updated_at))
  }, [data.opportunities, tab, f, companyOf, contactsOf, draftOf])

  const contractors = useMemo(() => {
    const projects = new Map<string, number>()
    for (const l of data.oppCompanies) projects.set(l.company_id, (projects.get(l.company_id) ?? 0) + 1)
    const q = f.q.toLocaleLowerCase('tr-TR')
    return data.companies
      .filter((c) => c.sector !== 'kamu' && !c.excluded && (c.discovery_source || projects.get(c.id)))
      .filter((c) => (!q || c.name.toLocaleLowerCase('tr-TR').includes(q)) && (!f.district || (c.districts ?? []).includes(f.district)))
      .map((c) => ({ c, projects: projects.get(c.id) ?? 0, contacts: contactsOf.get(c.id) ?? 0 }))
      .sort((a, b) => b.projects - a.projects || a.c.name.localeCompare(b.c.name, 'tr'))
  }, [data.companies, data.oppCompanies, contactsOf, f.q, f.district])

  if (ov === null) return <p className="card px-5 py-8 text-center text-sm text-subtle">Özel sektör paneli yükleniyor…</p>
  if (ov === 'yok') {
    return <Notice tone="warn" testId="private-missing">Özel sektör keşfi veritabanında henüz etkin değil (migration 020 uygulanmadı). Mevcut radar “Tüm fırsatlar” bölümünde çalışmaya devam ediyor.</Notice>
  }

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }))
  const counts: Record<Tab, number> = { ...ov.segments, firmalar: ov.segments.firmalar }
  const lastRun = ov.runs[0]

  return (
    <div className="flex flex-col gap-6" data-testid="private-panel">
      <DiscoveryStatus ov={ov} data={data} onSaved={() => setTick((t) => t + 1)} />

      <section aria-label="Bölümler" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6" data-testid="private-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            data-testid={`private-tab-${t}`}
            className={cn('min-w-0 rounded-xl border px-3 py-2.5 text-left shadow-card transition-colors', tab === t ? 'border-primary bg-surface-2' : 'border-line bg-surface hover:bg-surface-2', t === 'kamu_ihale' && 'opacity-80')}
          >
            <div className="truncate text-[11.5px] font-medium text-muted">{TAB_LABEL[t]}{t === 'kamu_ihale' ? ' · ikincil' : ''}</div>
            <div className="mt-1 font-mono text-xl font-semibold text-ink" data-value>{counts[t] ?? 0}</div>
          </button>
        ))}
      </section>

      <section aria-label="Süzgeçler" className="flex flex-col gap-2.5">
        <SearchInput value={f.q} onChange={(v) => set('q', v)} placeholder="Proje, ilçe veya firma ara…" label="Özel sektör kayıtlarında ara" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5" data-testid="private-filters">
          <FilterSelect value={f.district} onChange={(v) => set('district', v)} label="İlçe">
            <option value="">Tüm ilçeler</option>
            {ANKARA_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
            {cov.filter((c) => c.city !== 'Ankara').map((c) => <option key={c.district} value={c.district}>{c.district} ({c.city})</option>)}
          </FilterSelect>
          <FilterSelect value={f.company} onChange={(v) => set('company', v)} label="Firma">
            <option value="">Tüm firmalar</option>
            {contractors.map(({ c }) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FilterSelect>
          <FilterSelect value={f.stage} onChange={(v) => set('stage', v)} label="Proje aşaması">
            <option value="">Tüm aşamalar</option>
            <option value="dogrulanamadi">{STAGE_UNVERIFIED}</option>
            {(['ruhsat', 'temel_atma', 'hafriyat', 'temel', 'kaba_insaat', 'kaba_tamam', 'duvar', 'cephe', 'dograma', 'ince_isler'] as const).map((s) => <option key={s} value={s}>{STAGE_NAMES[s]}</option>)}
          </FilterSelect>
          <FilterSelect value={f.type} onChange={(v) => set('type', v)} label="Proje türü">
            <option value="">Tüm proje türleri</option>
            {PROJECT_TYPES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </FilterSelect>
          <FilterSelect value={f.product} onChange={(v) => set('product', v)} label="İlgili ürün">
            <option value="">Tüm ürünler</option>
            {(Object.keys(PRODUCT_LABEL) as ProductGroup[]).map((g) => <option key={g} value={g}>{PRODUCT_LABEL[g]}</option>)}
          </FilterSelect>
          <FilterSelect value={f.quality} onChange={(v) => set('quality', v)} label="Fırsat kalitesi">
            {QUALITY.map((q) => <option key={q.v} value={q.v}>{q.l}</option>)}
          </FilterSelect>
          <FilterSelect value={f.contact} onChange={(v) => set('contact', v)} label="İletişim">
            <option value="">İletişim: tümü</option>
            <option value="var">Doğrulanmış kanal var</option>
            <option value="yok">Kanal yok</option>
          </FilterSelect>
          <FilterSelect value={f.outreach} onChange={(v) => set('outreach', v)} label="E-posta durumu">
            <option value="">E-posta: tümü</option>
            <option value="yok">Taslak yok</option>
            <option value="inceleme">İncelemede</option>
            <option value="onaylandi">Onaylandı</option>
            <option value="gonderildi_elle">Elle gönderildi</option>
          </FilterSelect>
          <FilterSelect value={f.reply} onChange={(v) => set('reply', v)} label="Yanıt durumu">
            <option value="">Yanıt: tümü</option>
            {(Object.keys(REPLY_LABEL) as ReplyStatus[]).map((r) => <option key={r} value={r}>{REPLY_LABEL[r]}</option>)}
          </FilterSelect>
          {JSON.stringify(f) !== JSON.stringify(NO_FILTERS) && <Button variant="ghost" onClick={() => setF(NO_FILTERS)}>Süzgeçleri temizle</Button>}
        </div>
      </section>

      {tab === 'firmalar' ? (
        <ContractorList rows={contractors} />
      ) : list.length === 0 ? (
        <Notice testId="private-empty">
          Bu bölümde kayıt yok. {lastRun ? `Son keşif: ${fmtDateTime(lastRun.started_at)} — ${DISCOVERY_STATUS_LABEL[lastRun.status]}.` : 'Henüz keşif çalışmadı.'} Kayıtlar yalnız kaynaklı kanıttan oluşur; boş liste uydurma veriyle doldurulmaz.
        </Notice>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="private-list">
          {list.map((o) => <ProjectCard key={o.id} o={o} companies={companyOf.get(o.id) ?? []} draft={draftOf.get(o.id)} contacts={contactsOf} />)}
        </ul>
      )}

      <OutreachQueue drafts={drafts} data={data} onChange={() => setTick((t) => t + 1)} />
      <Performance ov={ov} />
      <Coverage cov={cov} />
      <RunLog runs={ov.runs} />
    </div>
  )
}

const STAGE_NAMES: Record<string, string> = {
  ruhsat: 'Yapı ruhsatı', temel_atma: 'Temel atma', hafriyat: 'Hafriyat / kazı', temel: 'Temel', kaba_insaat: 'Kaba inşaat / karkas', kaba_tamam: 'Kaba inşaat tamamlandı',
  duvar: 'Duvar örme', cephe: 'Cephe', dograma: 'Doğrama / pencere montajı', ince_isler: 'İnce işler', tamamlandi: 'Tamamlandı',
}

function ProjectCard({ o, companies, draft, contacts }: { o: RadarOpportunity; companies: RadarCompany[]; draft?: RadarDraft; contacts: Map<string, number> }) {
  const [open, setOpen] = useState(false)
  const verified = o.procurement_status === 'dogrulanmis_talep' || o.verified_need
  return (
    <li className="card min-w-0 px-4 py-3.5" data-testid="private-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link to={`/leonx-ai/firsat/${o.id}`} className="min-w-0 flex-1 text-[14px] font-semibold text-ink hover:underline" data-testid="private-card-title">{o.title}</Link>
        <span className="font-mono text-[15px] font-semibold text-ink" title="Özel sektör fırsat puanı" data-testid="private-card-score">{o.private_score ?? '—'}</span>
      </div>
      <p className="mt-0.5 text-[12px] text-muted">
        {[o.district, o.city].filter(Boolean).join(' / ') || 'Konum bilinmiyor'}
        {o.project_type ? ` · ${PROJECT_TYPE_BY_KEY[o.project_type]?.label ?? o.project_type}` : ''}
        {o.unit_text ? ` · ${o.unit_text}` : ''}
        {o.size_band && o.size_band !== 'bilinmiyor' ? ` · ${SIZE_LABEL[o.size_band as SizeBand]}` : ''}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        <span className={cn('rounded-md px-1.5 py-0.5 font-semibold', verified ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn')} data-testid="private-card-need">
          {verified ? 'Doğrulanmış satın alma talebi' : o.procurement_status === 'tedarikci_daveti' ? 'Tedarikçi daveti (ürün doğrulanmadı)' : 'Potansiyel fırsat — açık talep doğrulanmadı'}
        </span>
        <span className={cn('rounded-md px-1.5 py-0.5 font-semibold', o.stage_active ? 'bg-surface-2 text-ink' : 'bg-surface-2 text-subtle')} data-testid="private-card-stage">
          {o.stage_display ?? STAGE_UNVERIFIED}{o.stage_confidence ? ` · güven: ${CONFIDENCE_LABEL[o.stage_confidence].toLocaleLowerCase('tr-TR')}` : ''}
        </span>
        {(o.product_groups ?? []).slice(0, 4).map((g) => <span key={g} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-ink-2">{PRODUCT_LABEL[g as ProductGroup] ?? g}</span>)}
        {draft && <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-ink-2">E-posta: {draft.status === 'inceleme' ? 'incelemede' : draft.status}{draft.reply_status && draft.reply_status !== 'yok' ? ` · ${REPLY_LABEL[draft.reply_status]}` : ''}</span>}
      </div>
      {o.relevance_explanation && <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2" data-testid="private-card-why">{o.relevance_explanation}</p>}
      <div className="mt-2 flex flex-col gap-1 text-[11.5px] text-muted">
        {companies.map((c) => (
          <span key={c.id}>
            <Building2 className="mr-1 inline h-3 w-3" aria-hidden="true" />{c.name}{c.name_basis === 'alan_adi' ? ' (ad kaynakta yok — alan adı)' : ''}
            {c.website ? <> · <ExtLink href={c.website}>{c.website.replace(/^https:\/\//, '')}</ExtLink></> : ''}
            {` · ${contacts.get(c.id) ?? 0} doğrulanmış iletişim kanalı`}
          </span>
        ))}
        {o.stage_evidence_url && (
          <span data-testid="private-card-evidence">
            Kanıt: <ExtLink href={o.stage_evidence_url}>{o.stage_evidence_url}</ExtLink>
            {o.stage_evidence_at ? ` · yayın ${fmtDay(o.stage_evidence_at)}` : ' · yayın tarihi yok'}
            {o.stage_verified_at ? ` · son doğrulama ${fmtDateTime(o.stage_verified_at)}` : ''}
          </span>
        )}
        {o.stage_explanation && <span>Aşama açıklaması: {o.stage_explanation}</span>}
      </div>
      {(o.private_score_breakdown ?? []).length > 0 && (
        <button type="button" className="mt-2 text-[11.5px] font-semibold text-ink-2 underline underline-offset-2" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Puan dökümünü gizle' : 'Puan nasıl hesaplandı?'}
        </button>
      )}
      {open && (
        <table className="mt-2 w-full text-[11.5px]" data-testid="private-card-breakdown">
          <tbody>
            {(o.private_score_breakdown ?? []).map((p) => (
              <tr key={p.key} className="border-t border-line">
                <td className="py-1 pr-2 text-ink-2">{p.label}</td>
                <td className="py-1 pr-2 font-mono text-ink">{p.points}/{p.weight}</td>
                <td className="py-1 text-muted">{p.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  )
}

function ContractorList({ rows }: { rows: { c: RadarCompany; projects: number; contacts: number }[] }) {
  const { notify } = useToast()
  if (!rows.length) return <Notice testId="contractors-empty">Henüz özel sektör yüklenici kaydı yok. Firmalar yalnız kaynaklı keşiften (arama sonucu, firma sitesi) veya sizin eklediğiniz kayıtlardan oluşur.</Notice>
  const toggle = async (c: RadarCompany) => {
    try {
      await updateCompanyMonitoring(requireSupabase(), c, { monitor_active: !(c.monitor_active ?? true) })
    } catch (e) {
      notify(dataErrorMessage(e, 'Firma'), 'error')
    }
  }
  return (
    <ul className="card divide-y divide-line" data-testid="contractor-list">
      {rows.map(({ c, projects, contacts }) => (
        <li key={c.id} className="flex flex-col gap-1 px-4 py-3 text-[12.5px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-ink">{c.name}</span>
            <span className="text-[11.5px] text-muted">{projects} proje · {contacts} iletişim kanalı</span>
          </div>
          <span className="text-[11.5px] text-muted">
            {CONTRACTOR_KIND_LABEL[(c.contractor_kind ?? 'bilinmiyor') as ContractorKind]} · {SIZE_LABEL[(c.size_band ?? 'bilinmiyor') as SizeBand]}
            {(c.districts ?? []).length ? ` · ${(c.districts ?? []).join(', ')}` : ''}
            {c.discovery_source ? ` · keşif: ${c.discovery_source === 'arama' ? 'arama API' : c.discovery_source === 'firma_sitesi' ? 'firma sitesi' : c.discovery_source}` : ''}
            {c.opted_out ? ' · listeden çıkmak istedi' : ''}
          </span>
          <span className="text-[11.5px] text-subtle">
            {c.website ? <ExtLink href={c.website}>{c.website.replace(/^https:\/\//, '')}</ExtLink> : 'Web sitesi doğrulanmadı'}
            {` · son araştırma ${c.last_research_at ? fmtDateTime(c.last_research_at) : '—'} · sonraki ${c.next_research_at ? fmtDay(c.next_research_at) : '—'}`}
            {c.research_status && c.research_status !== 'ok' ? ` · ${c.research_note ?? c.research_status}` : ''}
          </span>
          {c.website && (
            <label className="flex items-center gap-2 text-[11.5px] text-ink-2">
              <input type="checkbox" checked={c.monitor_active ?? true} onChange={() => void toggle(c)} /> Yeni proje duyuruları için firma sitesini izle
            </label>
          )}
        </li>
      ))}
    </ul>
  )
}

function OutreachQueue({ drafts, data, onChange }: { drafts: RadarDraft[]; data: RadarData; onChange: () => void }) {
  const { notify } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const queue = drafts.filter((d) => d.generated_by === 'sistem' && (d.status === 'inceleme' || d.status === 'onaylandi'))
  const opp = new Map(data.opportunities.map((o) => [o.id, o]))
  const contact = new Map(data.contacts.map((c) => [c.id, c]))
  const act = async (d: RadarDraft, fn: () => Promise<unknown>) => {
    setBusy(d.id)
    try {
      await fn()
      onChange()
    } catch (e) {
      notify(dataErrorMessage(e, 'Taslak'), 'error')
    } finally {
      setBusy(null)
    }
  }
  return (
    <Panel title="Proje bazlı e-posta kuyruğu" subtitle="Gönderen: info@erlinkapi.tr · Otomatik gönderim yalnız tüm denetimler geçerse" icon={Mail}>
      {queue.length === 0 ? (
        <p className="text-[12.5px] text-subtle" data-testid="outreach-empty">İncelemede taslak yok. Taslaklar, eşik puanı geçen ve firmanın kendi sitesinde doğrulanmış kurumsal e-postası olan özel sektör projeleri için oluşturulur.</p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="outreach-queue">
          {queue.map((d) => {
            const o = opp.get(d.opportunity_id)
            const c = d.contact_id ? contact.get(d.contact_id) : null
            return (
              <li key={d.id} className="rounded-xl border border-line p-3 text-[12.5px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{d.subject}</span>
                  <span className="text-[11.5px] text-muted">{d.status === 'inceleme' ? 'İncelemede' : 'Onaylandı — gönderim denetimlerini bekliyor'}</span>
                </div>
                <p className="mt-0.5 text-[11.5px] text-muted">{o?.title ?? 'Proje'} · Alıcı: {c?.value ?? '—'}</p>
                {(d.blocked_reasons ?? []).length > 0 && (
                  <p className="mt-1 text-[11.5px] text-warn">Otomatik gönderilmiyor: {(d.blocked_reasons ?? []).map((r) => BLOCK_LABEL[r as BlockReason] ?? r).join(' · ')}</p>
                )}
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[11.5px] font-semibold text-ink-2">E-posta metni</summary>
                  <pre className="mt-1.5 font-sans text-[12px] whitespace-pre-wrap text-ink-2">{d.body}</pre>
                </details>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {d.status === 'inceleme' && <Button variant="secondary" disabled={busy === d.id} icon={CheckCircle2} onClick={() => void act(d, () => updateDraft(requireSupabase(), d, { status: 'onaylandi' }))}>Onayla</Button>}
                  {c && <a className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-[12.5px] font-semibold text-ink" href={`mailto:${encodeURIComponent(c.value)}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`}><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />E-posta istemcisinde aç</a>}
                  <Button variant="ghost" disabled={busy === d.id} onClick={() => void act(d, () => updateDraft(requireSupabase(), d, { status: 'gonderildi_elle' }))}>Elle gönderdim</Button>
                  <FilterSelect value={d.reply_status ?? 'yok'} onChange={(v) => void act(d, () => setDraftReply(requireSupabase(), d, v as ReplyStatus))} label="Yanıt durumu" className="h-10">
                    {(Object.keys(REPLY_LABEL) as ReplyStatus[]).map((r) => <option key={r} value={r}>{REPLY_LABEL[r]}</option>)}
                  </FilterSelect>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function Performance({ ov }: { ov: PrivateOverview }) {
  const p = ov.performance
  return (
    <Panel title="Satış performansı" subtitle="Yalnız kayıtlı gerçek olaylar: gönderim defteri, işaretlenen yanıtlar ve fırsat durum geçişleri" icon={TrendingUp}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="private-performance">
        <Kpi label="Gönderilen e-posta" value={p.emails_sent} hint={`${p.drafts_manual_sent} elle · ${p.emails_failed} hata`} />
        <Kpi label="İncelemedeki taslak" value={p.drafts_review} />
        <Kpi label="Yanıtlar" value={p.replies} hint="Sizin işaretlediğiniz" />
        <Kpi label="Teklif talepleri" value={p.quote_requests} />
        <Kpi label="Toplantılar" value={p.meetings} />
        <Kpi label="Verilen teklifler" value={p.quotes_sent} />
        <Kpi label="Kazanılan" value={p.won} tone={p.won ? 'ok' : undefined} />
        <Kpi label="Kaybedilen" value={p.lost} />
      </div>
    </Panel>
  )
}

function Coverage({ cov }: { cov: DistrictCoverage[] }) {
  const ankara = cov.filter((c) => c.city === 'Ankara')
  const searched = ankara.filter((c) => c.queries30d > 0).length
  return (
    <Panel title="İlçe kapsamı (son 30 gün)" subtitle={`Ankara: ${searched}/${ankara.length || 25} ilçe arandı · ikincil: Hatay, Kahramanmaraş`} icon={MapPinned}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="private-coverage">
        {cov.map((c) => (
          <div key={`${c.city}-${c.district}`} className={cn('rounded-lg border px-2.5 py-2 text-[11.5px]', c.queries30d ? 'border-line bg-surface' : 'border-warn-line bg-warn-soft')}>
            <div className="font-semibold text-ink">{c.district}{c.city !== 'Ankara' ? ` (${c.city})` : ''}</div>
            <div className="text-muted">{c.queries30d} sorgu · {c.results30d} sonuç</div>
            <div className="text-muted">{c.companies} firma · {c.private_projects} proje · {c.active_sites} aktif</div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function RunLog({ runs }: { runs: PrivateRun[] }) {
  return (
    <Panel title="Keşif çalıştırmaları" subtitle="Sunucuda saatte bir (cihazlar kapalıyken de). Sıfır sonuç nedeniyle birlikte gösterilir." icon={Activity}>
      {runs.length === 0 ? (
        <p className="text-[12.5px] text-subtle" data-testid="private-runs-empty">Henüz keşif çalıştırması kaydı yok.</p>
      ) : (
        <ul className="divide-y divide-line text-[12px]" data-testid="private-runs">
          {runs.map((r) => (
            <li key={r.id} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted">{fmtDateTime(r.started_at)}</span>
                <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-semibold', STATUS_TONE[r.status])} data-testid="private-run-status">{DISCOVERY_STATUS_LABEL[r.status]}</span>
                <span className="text-ink-2">{r.api_calls} API çağrısı · {r.results_seen} sonuç ({r.results_new} yeni, {r.results_rejected} elendi) · {r.companies_new} yeni firma · {r.projects_new} yeni / {r.projects_updated} güncellenen proje · {r.contacts_verified} iletişim · {r.outreach_candidates} e-posta adayı</span>
              </div>
              {r.districts.length > 0 && <p className="text-[11.5px] text-subtle">İlçeler: {r.districts.join(', ')}</p>}
              {r.queries.length > 0 && <p className="text-[11.5px] text-subtle">Sorgular: {r.queries.join(' · ')}</p>}
              {r.quota_limit !== null && <p className="text-[11.5px] text-subtle">Arama bütçesi: {r.quota_used}/{r.quota_limit} kullanıldı · kalan {r.quota_remaining}{r.diversity ? ` · ${r.diversity.distinctDomains} farklı alan adı` : ''}</p>}
              {r.note && <p className="text-[11.5px] text-warn">{r.note}</p>}
              {r.errors.length > 0 && <p className="text-[11.5px] text-danger">Hatalar: {r.errors.slice(0, 3).join(' · ')}</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function DiscoveryStatus({ ov, data, onSaved }: { ov: PrivateOverview; data: RadarData; onSaved: () => void }) {
  const { notify } = useToast()
  const s = data.settings
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [legal, setLegal] = useState(s?.outreach_legal_note ?? '')
  useEffect(() => setLegal(s?.outreach_legal_note ?? ''), [s?.outreach_legal_note])
  const src = ov.discovery_source
  const st = ov.settings
  const missing: string[] = []
  if (!src) missing.push('Özel sektör keşif kaynağı kayıtlı değil')
  else if (src.permission_status !== 'izinli' || !src.active) missing.push(`Keşif kaynağı "${PERMISSION_LABEL[src.permission_status]}${src.active ? '' : ', pasif'}" — Kaynaklar bölümünde Tavily koşullarını onaylayıp İzinli + Etkin yapın`)
  if (st && !st.search_api_enabled) missing.push('Ayarlar › Arama API kapalı')
  if (st && !st.discovery_enabled) missing.push('Özel sektör keşfi kapalı (aşağıdan açın)')
  const lastRun = ov.runs[0]
  if (lastRun?.status === 'yapilandirma_eksik') missing.push('TAVILY_API_KEY Edge Function gizli değişkeni tanımlı değil')

  const save = async (patch: Parameters<typeof saveRadarSettings>[2]) => {
    if (!s) return
    setBusy(true)
    setErr(null)
    try {
      await saveRadarSettings(requireSupabase(), s, patch)
      notify('Keşif ayarı kaydedildi.', 'success')
      onSaved()
    } catch (e) {
      setErr(dataErrorMessage(e, 'Ayarlar'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Özel sektör inşaat keşfi" subtitle="Ankara’nın 25 ilçesi önce · Hatay ve Kahramanmaraş ikincil · kamu ihaleleri ayrı ve ikincil kanal" icon={HardHat}>
      {err && <FormAlert>{err}</FormAlert>}
      {missing.length > 0 ? (
        <Notice tone="warn" testId="private-config-missing">
          Keşif şu an çalışamaz; tarama kaydı bunu “başarılı” olarak göstermez. Eksikler: {missing.join(' · ')}.
        </Notice>
      ) : (
        <Notice testId="private-config-ok">Keşif yapılandırılmış: saatte bir {st?.queries_per_run ?? 1} sorgu, en az aranmış ilçeler önce.</Notice>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Arama bütçesi (bu ay)" value={ov.quota ? `${ov.quota.month_used}/${ov.quota.month_limit}` : '—'} hint={ov.quota ? `Bugün ${ov.quota.day_used}/${ov.quota.day_limit} · LEONX sınırı` : undefined} />
        <Kpi label="Son keşif" value={lastRun ? DISCOVERY_STATUS_LABEL[lastRun.status] : '—'} hint={lastRun ? fmtDateTime(lastRun.started_at) : 'Çalışmadı'} />
        <Kpi label="Aşaması doğrulanamayan" value={ov.unverified_stage} hint="Yakın tarihli kanıt yok; aktif sayılmaz" />
        <Kpi label="Gmail (info@erlinkapi.tr)" value={st?.gmail_verified_at ? 'Doğrulandı' : 'Bağlı değil'} hint={st?.gmail_last_check?.error ?? (st?.outreach_auto_send ? 'Otomatik gönderim açık' : 'Otomatik gönderim kapalı')} tone={st?.gmail_verified_at ? 'ok' : 'warn'} />
      </div>
      {s && s.discovery_enabled !== undefined && (
        <details className="mt-4" data-testid="private-settings">
          <summary className="flex cursor-pointer items-center gap-1.5 text-[12.5px] font-semibold text-ink-2"><Settings2 className="h-3.5 w-3.5" aria-hidden="true" />Keşif ve e-posta ayarları</summary>
          <div className="mt-3 flex flex-col gap-4">
            <Toggle id="discovery-enabled" checked={!!s.discovery_enabled} onChange={(v) => void save({ discovery_enabled: v })} label="Özel sektör keşfi" description="Yetkili arama API’si (Tavily) ile saatlik, ilçe rotasyonlu sorgular. Google sonuç sayfası kazınmaz." />
            <Toggle id="company-monitoring" checked={!!s.company_monitoring_enabled} onChange={(v) => void save({ company_monitoring_enabled: v })} label="Firma sitelerini izle" description="Bulunan firmaların kendi sitelerinde robots.txt’ye uyarak proje sayfaları ve kurumsal iletişim kanalları (çalıştırma başına en çok 2 firma)." />
            <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
              Saatlik sorgu sayısı
              <FilterSelect value={String(s.discovery_queries_per_run ?? 1)} onChange={(v) => void save({ discovery_queries_per_run: Number(v) })} label="Saatlik sorgu sayısı" className="h-10">
                {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </FilterSelect>
              <span className="text-[11.5px] text-subtle">Tavily ücretsiz kotası ~1.000/ay: saatte 1 sorgu ≈ 720/ay. Daha fazlası ücretli plan gerektirir.</span>
            </label>
            <TextAreaField label="Ticari ileti hukuki dayanağı (otomatik gönderim için zorunlu)" value={legal} onChange={(e) => setLegal(e.target.value)} rows={3} hint="Ör. alıcıların tacir olduğu, adreslerin firmaların kendi sitelerinde kamuya açık kurumsal adres olduğu, İYS/ret yükümlülüklerinin nasıl karşılandığı. Hukuki danışmanınızla doğrulayın." />
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !legal.trim()} onClick={() => void save({ outreach_legal_note: legal.trim(), outreach_legal_confirmed_at: new Date().toISOString() })}>Hukuki dayanağı kaydet</Button>
            </div>
            <Toggle
              id="auto-send"
              checked={!!s.outreach_auto_send}
              onChange={(v) => (v && (!s.gmail_verified_at || !s.outreach_legal_confirmed_at) ? notify('Önce Gmail (info@erlinkapi.tr) bağlantısı sunucuda doğrulanmalı ve hukuki dayanak kaydedilmeli.', 'error') : void save({ outreach_auto_send: v }))}
              label="Onaylı taslakları otomatik gönder"
              description="Yalnız sizin onayladığınız taslaklar, tüm denetimler (Gmail doğrulaması, ret listesi, alıcı doğrulaması, günlük sınır, 90 gün kuralı) geçerse gönderilir."
            />
          </div>
        </details>
      )}
    </Panel>
  )
}
