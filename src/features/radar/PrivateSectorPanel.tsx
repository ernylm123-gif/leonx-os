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
const TAB_LABEL: Record<Tab, string> = { ...SEGMENT_LABEL, firmalar: 'MÃ¼teahhit FirmalarÄ±' }

const QUALITY = [
  { v: '', l: 'TÃ¼m fÄ±rsat kaliteleri' },
  { v: '70', l: 'YÃ¼ksek (â‰¥ 70)' },
  { v: '50', l: 'Orta ve Ã¼zeri (â‰¥ 50)' },
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
 * 020: Ã–zel sektÃ¶r inÅŸaat satÄ±ÅŸ paneli. BÃ¶lÃ¼mler, puanlar, aÅŸamalar ve sayÄ±lar sunucuda yazÄ±lan kayÄ±tlardan
 * gelir; uydurma Ã¶lÃ§Ã¼t, tahmini yanÄ±t oranÄ± veya garanti gÃ¶sterilmez. Kamu ihaleleri ayrÄ±, ikincil sekmededir.
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

  if (ov === null) return <p className="card px-5 py-8 text-center text-sm text-subtle">Ã–zel sektÃ¶r paneli yÃ¼kleniyorâ€¦</p>
  if (ov === 'yok') {
    return <Notice tone="warn" testId="private-missing">Ã–zel sektÃ¶r keÅŸfi veritabanÄ±nda henÃ¼z etkin deÄŸil (migration 020 uygulanmadÄ±). Mevcut radar â€œTÃ¼m fÄ±rsatlarâ€ bÃ¶lÃ¼mÃ¼nde Ã§alÄ±ÅŸmaya devam ediyor.</Notice>
  }

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }))
  const counts: Record<Tab, number> = { ...ov.segments, firmalar: ov.segments.firmalar }
  const lastRun = ov.runs[0]

  return (
    <div className="flex flex-col gap-6" data-testid="private-panel">
      <DiscoveryStatus ov={ov} data={data} onSaved={() => setTick((t) => t + 1)} />

      <section aria-label="BÃ¶lÃ¼mler" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6" data-testid="private-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            data-testid={`private-tab-${t}`}
            className={cn('min-w-0 rounded-xl border px-3 py-2.5 text-left shadow-card transition-colors', tab === t ? 'border-primary bg-surface-2' : 'border-line bg-surface hover:bg-surface-2', t === 'kamu_ihale' && 'opacity-80')}
          >
            <div className="truncate text-[11.5px] font-medium text-muted">{TAB_LABEL[t]}{t === 'kamu_ihale' ? ' Â· ikincil' : ''}</div>
            <div className="mt-1 font-mono text-xl font-semibold text-ink" data-value>{counts[t] ?? 0}</div>
          </button>
        ))}
      </section>

      <section aria-label="SÃ¼zgeÃ§ler" className="flex flex-col gap-2.5">
        <SearchInput value={f.q} onChange={(v) => set('q', v)} placeholder="Proje, ilÃ§e veya firma araâ€¦" label="Ã–zel sektÃ¶r kayÄ±tlarÄ±nda ara" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5" data-testid="private-filters">
          <FilterSelect value={f.district} onChange={(v) => set('district', v)} label="Ä°lÃ§e">
            <option value="">TÃ¼m ilÃ§eler</option>
            {ANKARA_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
            {cov.filter((c) => c.city !== 'Ankara').map((c) => <option key={c.district} value={c.district}>{c.district} ({c.city})</option>)}
          </FilterSelect>
          <FilterSelect value={f.company} onChange={(v) => set('company', v)} label="Firma">
            <option value="">TÃ¼m firmalar</option>
            {contractors.map(({ c }) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FilterSelect>
          <FilterSelect value={f.stage} onChange={(v) => set('stage', v)} label="Proje aÅŸamasÄ±">
            <option value="">TÃ¼m aÅŸamalar</option>
            <option value="dogrulanamadi">{STAGE_UNVERIFIED}</option>
            {(['ruhsat', 'temel_atma', 'hafriyat', 'temel', 'kaba_insaat', 'kaba_tamam', 'duvar', 'cephe', 'dograma', 'ince_isler'] as const).map((s) => <option key={s} value={s}>{STAGE_NAMES[s]}</option>)}
          </FilterSelect>
          <FilterSelect value={f.type} onChange={(v) => set('type', v)} label="Proje tÃ¼rÃ¼">
            <option value="">TÃ¼m proje tÃ¼rleri</option>
            {PROJECT_TYPES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </FilterSelect>
          <FilterSelect value={f.product} onChange={(v) => set('product', v)} label="Ä°lgili Ã¼rÃ¼n">
            <option value="">TÃ¼m Ã¼rÃ¼nler</option>
            {(Object.keys(PRODUCT_LABEL) as ProductGroup[]).map((g) => <option key={g} value={g}>{PRODUCT_LABEL[g]}</option>)}
          </FilterSelect>
          <FilterSelect value={f.quality} onChange={(v) => set('quality', v)} label="FÄ±rsat kalitesi">
            {QUALITY.map((q) => <option key={q.v} value={q.v}>{q.l}</option>)}
          </FilterSelect>
          <FilterSelect value={f.contact} onChange={(v) => set('contact', v)} label="Ä°letiÅŸim">
            <option value="">Ä°letiÅŸim: tÃ¼mÃ¼</option>
            <option value="var">DoÄŸrulanmÄ±ÅŸ kanal var</option>
            <option value="yok">Kanal yok</option>
          </FilterSelect>
          <FilterSelect value={f.outreach} onChange={(v) => set('outreach', v)} label="E-posta durumu">
            <option value="">E-posta: tÃ¼mÃ¼</option>
            <option value="yok">Taslak yok</option>
            <option value="inceleme">Ä°ncelemede</option>
            <option value="onaylandi">OnaylandÄ±</option>
            <option value="gonderildi_elle">Elle gÃ¶nderildi</option>
          </FilterSelect>
          <FilterSelect value={f.reply} onChange={(v) => set('reply', v)} label="YanÄ±t durumu">
            <option value="">YanÄ±t: tÃ¼mÃ¼</option>
            {(Object.keys(REPLY_LABEL) as ReplyStatus[]).map((r) => <option key={r} value={r}>{REPLY_LABEL[r]}</option>)}
          </FilterSelect>
          {JSON.stringify(f) !== JSON.stringify(NO_FILTERS) && <Button variant="ghost" onClick={() => setF(NO_FILTERS)}>SÃ¼zgeÃ§leri temizle</Button>}
        </div>
      </section>

      {tab === 'firmalar' ? (
        <ContractorList rows={contractors} />
      ) : list.length === 0 ? (
        <Notice testId="private-empty">
          Bu bÃ¶lÃ¼mde kayÄ±t yok. {lastRun ? `Son keÅŸif: ${fmtDateTime(lastRun.started_at)} â€” ${DISCOVERY_STATUS_LABEL[lastRun.status]}.` : 'HenÃ¼z keÅŸif Ã§alÄ±ÅŸmadÄ±.'} KayÄ±tlar yalnÄ±z kaynaklÄ± kanÄ±ttan oluÅŸur; boÅŸ liste uydurma veriyle doldurulmaz.
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
  ruhsat: 'YapÄ± ruhsatÄ±', temel_atma: 'Temel atma', hafriyat: 'Hafriyat / kazÄ±', temel: 'Temel', kaba_insaat: 'Kaba inÅŸaat / karkas', kaba_tamam: 'Kaba inÅŸaat tamamlandÄ±',
  duvar: 'Duvar Ã¶rme', cephe: 'Cephe', dograma: 'DoÄŸrama / pencere montajÄ±', ince_isler: 'Ä°nce iÅŸler', tamamlandi: 'TamamlandÄ±',
}

function ProjectCard({ o, companies, draft, contacts }: { o: RadarOpportunity; companies: RadarCompany[]; draft?: RadarDraft; contacts: Map<string, number> }) {
  const [open, setOpen] = useState(false)
  const verified = o.procurement_status === 'dogrulanmis_talep' || o.verified_need
  return (
    <li className="card min-w-0 px-4 py-3.5" data-testid="private-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link to={`/leonx-ai/firsat/${o.id}`} className="min-w-0 flex-1 text-[14px] font-semibold text-ink hover:underline" data-testid="private-card-title">{o.title}</Link>
        <span className="font-mono text-[15px] font-semibold text-ink" title="Ã–zel sektÃ¶r fÄ±rsat puanÄ±" data-testid="private-card-score">{o.private_score ?? 'â€”'}</span>
      </div>
      <p className="mt-0.5 text-[12px] text-muted">
        {[o.district, o.city].filter(Boolean).join(' / ') || 'Konum bilinmiyor'}
        {o.project_type ? ` Â· ${PROJECT_TYPE_BY_KEY[o.project_type]?.label ?? o.project_type}` : ''}
        {o.unit_text ? ` Â· ${o.unit_text}` : ''}
        {o.size_band && o.size_band !== 'bilinmiyor' ? ` Â· ${SIZE_LABEL[o.size_band as SizeBand]}` : ''}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        <span className={cn('rounded-md px-1.5 py-0.5 font-semibold', verified ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn')} data-testid="private-card-need">
          {verified ? 'DoÄŸrulanmÄ±ÅŸ satÄ±n alma talebi' : o.procurement_status === 'tedarikci_daveti' ? 'TedarikÃ§i daveti (Ã¼rÃ¼n doÄŸrulanmadÄ±)' : 'Potansiyel fÄ±rsat â€” aÃ§Ä±k talep doÄŸrulanmadÄ±'}
        </span>
        <span className={cn('rounded-md px-1.5 py-0.5 font-semibold', o.stage_active ? 'bg-surface-2 text-ink' : 'bg-surface-2 text-subtle')} data-testid="private-card-stage">
          {o.stage_display ?? STAGE_UNVERIFIED}{o.stage_confidence ? ` Â· gÃ¼ven: ${CONFIDENCE_LABEL[o.stage_confidence].toLocaleLowerCase('tr-TR')}` : ''}
        </span>
        {(o.product_groups ?? []).slice(0, 4).map((g) => <span key={g} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-ink-2">{PRODUCT_LABEL[g as ProductGroup] ?? g}</span>)}
        {draft && <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-ink-2">E-posta: {draft.status === 'inceleme' ? 'incelemede' : draft.status}{draft.reply_status && draft.reply_status !== 'yok' ? ` Â· ${REPLY_LABEL[draft.reply_status]}` : ''}</span>}
      </div>
      {o.relevance_explanation && <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2" data-testid="private-card-why">{o.relevance_explanation}</p>}
      <div className="mt-2 flex flex-col gap-1 text-[11.5px] text-muted">
        {companies.map((c) => (
          <span key={c.id}>
            <Building2 className="mr-1 inline h-3 w-3" aria-hidden="true" />{c.name}{c.name_basis === 'alan_adi' ? ' (ad kaynakta yok â€” alan adÄ±)' : ''}
            {c.website ? <> Â· <ExtLink href={c.website}>{c.website.replace(/^https:\/\//, '')}</ExtLink></> : ''}
            {` Â· ${contacts.get(c.id) ?? 0} doÄŸrulanmÄ±ÅŸ iletiÅŸim kanalÄ±`}
          </span>
        ))}
        {o.stage_evidence_url && (
          <span data-testid="private-card-evidence">
            KanÄ±t: <ExtLink href={o.stage_evidence_url}>{o.stage_evidence_url}</ExtLink>
            {o.stage_evidence_at ? ` Â· yayÄ±n ${fmtDay(o.stage_evidence_at)}` : ' Â· yayÄ±n tarihi yok'}
            {o.stage_verified_at ? ` Â· son doÄŸrulama ${fmtDateTime(o.stage_verified_at)}` : ''}
          </span>
        )}
        {o.stage_explanation && <span>AÅŸama aÃ§Ä±klamasÄ±: {o.stage_explanation}</span>}
      </div>
      {(o.private_score_breakdown ?? []).length > 0 && (
        <button type="button" className="mt-2 text-[11.5px] font-semibold text-ink-2 underline underline-offset-2" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Puan dÃ¶kÃ¼mÃ¼nÃ¼ gizle' : 'Puan nasÄ±l hesaplandÄ±?'}
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
  if (!rows.length) return <Notice testId="contractors-empty">HenÃ¼z Ã¶zel sektÃ¶r yÃ¼klenici kaydÄ± yok. Firmalar yalnÄ±z kaynaklÄ± keÅŸiften (arama sonucu, firma sitesi) veya sizin eklediÄŸiniz kayÄ±tlardan oluÅŸur.</Notice>
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
            <span className="text-[11.5px] text-muted">{projects} proje Â· {contacts} iletiÅŸim kanalÄ±</span>
          </div>
          <span className="text-[11.5px] text-muted">
            {CONTRACTOR_KIND_LABEL[(c.contractor_kind ?? 'bilinmiyor') as ContractorKind]} Â· {SIZE_LABEL[(c.size_band ?? 'bilinmiyor') as SizeBand]}
            {(c.districts ?? []).length ? ` Â· ${(c.districts ?? []).join(', ')}` : ''}
            {c.discovery_source ? ` Â· keÅŸif: ${c.discovery_source === 'arama' ? 'arama API' : c.discovery_source === 'firma_sitesi' ? 'firma sitesi' : c.discovery_source}` : ''}
            {c.opted_out ? ' Â· listeden Ã§Ä±kmak istedi' : ''}
          </span>
          <span className="text-[11.5px] text-subtle">
            {c.website ? <ExtLink href={c.website}>{c.website.replace(/^https:\/\//, '')}</ExtLink> : 'Web sitesi doÄŸrulanmadÄ±'}
            {` Â· son araÅŸtÄ±rma ${c.last_research_at ? fmtDateTime(c.last_research_at) : 'â€”'} Â· sonraki ${c.next_research_at ? fmtDay(c.next_research_at) : 'â€”'}`}
            {c.research_status && c.research_status !== 'ok' ? ` Â· ${c.research_note ?? c.research_status}` : ''}
          </span>
          {c.website && (
            <label className="flex items-center gap-2 text-[11.5px] text-ink-2">
              <input type="checkbox" checked={c.monitor_active ?? true} onChange={() => void toggle(c)} /> Yeni proje duyurularÄ± iÃ§in firma sitesini izle
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
    <Panel title="Proje bazlÄ± e-posta kuyruÄŸu" subtitle="GÃ¶nderen: erlindoorkapi@gmail.com Â· Otomatik gÃ¶nderim yalnÄ±z tÃ¼m denetimler geÃ§erse" icon={Mail}>
      {queue.length === 0 ? (
        <p className="text-[12.5px] text-subtle" data-testid="outreach-empty">Ä°ncelemede taslak yok. Taslaklar, eÅŸik puanÄ± geÃ§en ve firmanÄ±n kendi sitesinde doÄŸrulanmÄ±ÅŸ kurumsal e-postasÄ± olan Ã¶zel sektÃ¶r projeleri iÃ§in oluÅŸturulur.</p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="outreach-queue">
          {queue.map((d) => {
            const o = opp.get(d.opportunity_id)
            const c = d.contact_id ? contact.get(d.contact_id) : null
            return (
              <li key={d.id} className="rounded-xl border border-line p-3 text-[12.5px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{d.subject}</span>
                  <span className="text-[11.5px] text-muted">{d.status === 'inceleme' ? 'Ä°ncelemede' : 'OnaylandÄ± â€” gÃ¶nderim denetimlerini bekliyor'}</span>
                </div>
                <p className="mt-0.5 text-[11.5px] text-muted">{o?.title ?? 'Proje'} Â· AlÄ±cÄ±: {c?.value ?? 'â€”'}</p>
                {(d.blocked_reasons ?? []).length > 0 && (
                  <p className="mt-1 text-[11.5px] text-warn">Otomatik gÃ¶nderilmiyor: {(d.blocked_reasons ?? []).map((r) => BLOCK_LABEL[r as BlockReason] ?? r).join(' Â· ')}</p>
                )}
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[11.5px] font-semibold text-ink-2">E-posta metni</summary>
                  <pre className="mt-1.5 font-sans text-[12px] whitespace-pre-wrap text-ink-2">{d.body}</pre>
                </details>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {d.status === 'inceleme' && <Button variant="secondary" disabled={busy === d.id} icon={CheckCircle2} onClick={() => void act(d, () => updateDraft(requireSupabase(), d, { status: 'onaylandi' }))}>Onayla</Button>}
                  {c && <a className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-[12.5px] font-semibold text-ink" href={`mailto:${encodeURIComponent(c.value)}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`}><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />E-posta istemcisinde aÃ§</a>}
                  <Button variant="ghost" disabled={busy === d.id} onClick={() => void act(d, () => updateDraft(requireSupabase(), d, { status: 'gonderildi_elle' }))}>Elle gÃ¶nderdim</Button>
                  <FilterSelect value={d.reply_status ?? 'yok'} onChange={(v) => void act(d, () => setDraftReply(requireSupabase(), d, v as ReplyStatus))} label="YanÄ±t durumu" className="h-10">
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
    <Panel title="SatÄ±ÅŸ performansÄ±" subtitle="YalnÄ±z kayÄ±tlÄ± gerÃ§ek olaylar: gÃ¶nderim defteri, iÅŸaretlenen yanÄ±tlar ve fÄ±rsat durum geÃ§iÅŸleri" icon={TrendingUp}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="private-performance">
        <Kpi label="GÃ¶nderilen e-posta" value={p.emails_sent} hint={`${p.drafts_manual_sent} elle Â· ${p.emails_failed} hata`} />
        <Kpi label="Ä°ncelemedeki taslak" value={p.drafts_review} />
        <Kpi label="YanÄ±tlar" value={p.replies} hint="Sizin iÅŸaretlediÄŸiniz" />
        <Kpi label="Teklif talepleri" value={p.quote_requests} />
        <Kpi label="ToplantÄ±lar" value={p.meetings} />
        <Kpi label="Verilen teklifler" value={p.quotes_sent} />
        <Kpi label="KazanÄ±lan" value={p.won} tone={p.won ? 'ok' : undefined} />
        <Kpi label="Kaybedilen" value={p.lost} />
      </div>
    </Panel>
  )
}

function Coverage({ cov }: { cov: DistrictCoverage[] }) {
  const ankara = cov.filter((c) => c.city === 'Ankara')
  const searched = ankara.filter((c) => c.queries30d > 0).length
  return (
    <Panel title="Ä°lÃ§e kapsamÄ± (son 30 gÃ¼n)" subtitle={`Ankara: ${searched}/${ankara.length || 25} ilÃ§e arandÄ± Â· ikincil: Hatay, KahramanmaraÅŸ`} icon={MapPinned}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="private-coverage">
        {cov.map((c) => (
          <div key={`${c.city}-${c.district}`} className={cn('rounded-lg border px-2.5 py-2 text-[11.5px]', c.queries30d ? 'border-line bg-surface' : 'border-warn-line bg-warn-soft')}>
            <div className="font-semibold text-ink">{c.district}{c.city !== 'Ankara' ? ` (${c.city})` : ''}</div>
            <div className="text-muted">{c.queries30d} sorgu Â· {c.results30d} sonuÃ§</div>
            <div className="text-muted">{c.companies} firma Â· {c.private_projects} proje Â· {c.active_sites} aktif</div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function RunLog({ runs }: { runs: PrivateRun[] }) {
  return (
    <Panel title="KeÅŸif Ã§alÄ±ÅŸtÄ±rmalarÄ±" subtitle="Sunucuda saatte bir (cihazlar kapalÄ±yken de). SÄ±fÄ±r sonuÃ§ nedeniyle birlikte gÃ¶sterilir." icon={Activity}>
      {runs.length === 0 ? (
        <p className="text-[12.5px] text-subtle" data-testid="private-runs-empty">HenÃ¼z keÅŸif Ã§alÄ±ÅŸtÄ±rmasÄ± kaydÄ± yok.</p>
      ) : (
        <ul className="divide-y divide-line text-[12px]" data-testid="private-runs">
          {runs.map((r) => (
            <li key={r.id} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted">{fmtDateTime(r.started_at)}</span>
                <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-semibold', STATUS_TONE[r.status])} data-testid="private-run-status">{DISCOVERY_STATUS_LABEL[r.status]}</span>
                <span className="text-ink-2">{r.api_calls} API Ã§aÄŸrÄ±sÄ± Â· {r.results_seen} sonuÃ§ ({r.results_new} yeni, {r.results_rejected} elendi) Â· {r.companies_new} yeni firma Â· {r.projects_new} yeni / {r.projects_updated} gÃ¼ncellenen proje Â· {r.contacts_verified} iletiÅŸim Â· {r.outreach_candidates} e-posta adayÄ±</span>
              </div>
              {r.districts.length > 0 && <p className="text-[11.5px] text-subtle">Ä°lÃ§eler: {r.districts.join(', ')}</p>}
              {r.queries.length > 0 && <p className="text-[11.5px] text-subtle">Sorgular: {r.queries.join(' Â· ')}</p>}
              {r.quota_limit !== null && <p className="text-[11.5px] text-subtle">Arama bÃ¼tÃ§esi: {r.quota_used}/{r.quota_limit} kullanÄ±ldÄ± Â· kalan {r.quota_remaining}{r.diversity ? ` Â· ${r.diversity.distinctDomains} farklÄ± alan adÄ±` : ''}</p>}
              {r.note && <p className="text-[11.5px] text-warn">{r.note}</p>}
              {r.errors.length > 0 && <p className="text-[11.5px] text-danger">Hatalar: {r.errors.slice(0, 3).join(' Â· ')}</p>}
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
  if (!src) missing.push('Ã–zel sektÃ¶r keÅŸif kaynaÄŸÄ± kayÄ±tlÄ± deÄŸil')
  else if (src.permission_status !== 'izinli' || !src.active) missing.push(`KeÅŸif kaynaÄŸÄ± "${PERMISSION_LABEL[src.permission_status]}${src.active ? '' : ', pasif'}" â€” Kaynaklar bÃ¶lÃ¼mÃ¼nde Tavily koÅŸullarÄ±nÄ± onaylayÄ±p Ä°zinli + Etkin yapÄ±n`)
  if (st && !st.search_api_enabled) missing.push('Ayarlar â€º Arama API kapalÄ±')
  if (st && !st.discovery_enabled) missing.push('Ã–zel sektÃ¶r keÅŸfi kapalÄ± (aÅŸaÄŸÄ±dan aÃ§Ä±n)')
  const lastRun = ov.runs[0]
  if (lastRun?.status === 'yapilandirma_eksik') missing.push('TAVILY_API_KEY Edge Function gizli deÄŸiÅŸkeni tanÄ±mlÄ± deÄŸil')

  const save = async (patch: Parameters<typeof saveRadarSettings>[2]) => {
    if (!s) return
    setBusy(true)
    setErr(null)
    try {
      await saveRadarSettings(requireSupabase(), s, patch)
      notify('KeÅŸif ayarÄ± kaydedildi.', 'success')
      onSaved()
    } catch (e) {
      setErr(dataErrorMessage(e, 'Ayarlar'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Ã–zel sektÃ¶r inÅŸaat keÅŸfi" subtitle="Ankaraâ€™nÄ±n 25 ilÃ§esi Ã¶nce Â· Hatay ve KahramanmaraÅŸ ikincil Â· kamu ihaleleri ayrÄ± ve ikincil kanal" icon={HardHat}>
      {err && <FormAlert>{err}</FormAlert>}
      {missing.length > 0 ? (
        <Notice tone="warn" testId="private-config-missing">
          KeÅŸif ÅŸu an Ã§alÄ±ÅŸamaz; tarama kaydÄ± bunu â€œbaÅŸarÄ±lÄ±â€ olarak gÃ¶stermez. Eksikler: {missing.join(' Â· ')}.
        </Notice>
      ) : (
        <Notice testId="private-config-ok">KeÅŸif yapÄ±landÄ±rÄ±lmÄ±ÅŸ: saatte bir {st?.queries_per_run ?? 1} sorgu, en az aranmÄ±ÅŸ ilÃ§eler Ã¶nce.</Notice>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Arama bÃ¼tÃ§esi (bu ay)" value={ov.quota ? `${ov.quota.month_used}/${ov.quota.month_limit}` : 'â€”'} hint={ov.quota ? `BugÃ¼n ${ov.quota.day_used}/${ov.quota.day_limit} Â· LEONX sÄ±nÄ±rÄ±` : undefined} />
        <Kpi label="Son keÅŸif" value={lastRun ? DISCOVERY_STATUS_LABEL[lastRun.status] : 'â€”'} hint={lastRun ? fmtDateTime(lastRun.started_at) : 'Ã‡alÄ±ÅŸmadÄ±'} />
        <Kpi label="AÅŸamasÄ± doÄŸrulanamayan" value={ov.unverified_stage} hint="YakÄ±n tarihli kanÄ±t yok; aktif sayÄ±lmaz" />
        <Kpi label="Gmail (erlindoorkapi@gmail.com)" value={st?.gmail_verified_at ? 'DoÄŸrulandÄ±' : 'BaÄŸlÄ± deÄŸil'} hint={st?.gmail_last_check?.error ?? (st?.outreach_auto_send ? 'Otomatik gÃ¶nderim aÃ§Ä±k' : 'Otomatik gÃ¶nderim kapalÄ±')} tone={st?.gmail_verified_at ? 'ok' : 'warn'} />
      </div>
      {s && s.discovery_enabled !== undefined && (
        <details className="mt-4" data-testid="private-settings">
          <summary className="flex cursor-pointer items-center gap-1.5 text-[12.5px] font-semibold text-ink-2"><Settings2 className="h-3.5 w-3.5" aria-hidden="true" />KeÅŸif ve e-posta ayarlarÄ±</summary>
          <div className="mt-3 flex flex-col gap-4">
            <Toggle id="discovery-enabled" checked={!!s.discovery_enabled} onChange={(v) => void save({ discovery_enabled: v })} label="Ã–zel sektÃ¶r keÅŸfi" description="Yetkili arama APIâ€™si (Tavily) ile saatlik, ilÃ§e rotasyonlu sorgular. Google sonuÃ§ sayfasÄ± kazÄ±nmaz." />
            <Toggle id="company-monitoring" checked={!!s.company_monitoring_enabled} onChange={(v) => void save({ company_monitoring_enabled: v })} label="Firma sitelerini izle" description="Bulunan firmalarÄ±n kendi sitelerinde robots.txtâ€™ye uyarak proje sayfalarÄ± ve kurumsal iletiÅŸim kanallarÄ± (Ã§alÄ±ÅŸtÄ±rma baÅŸÄ±na en Ã§ok 2 firma)." />
            <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
              Saatlik sorgu sayÄ±sÄ±
              <FilterSelect value={String(s.discovery_queries_per_run ?? 1)} onChange={(v) => void save({ discovery_queries_per_run: Number(v) })} label="Saatlik sorgu sayÄ±sÄ±" className="h-10">
                {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </FilterSelect>
              <span className="text-[11.5px] text-subtle">Tavily Ã¼cretsiz kotasÄ± ~1.000/ay: saatte 1 sorgu â‰ˆ 720/ay. Daha fazlasÄ± Ã¼cretli plan gerektirir.</span>
            </label>
            <TextAreaField label="Ticari ileti hukuki dayanaÄŸÄ± (otomatik gÃ¶nderim iÃ§in zorunlu)" value={legal} onChange={(e) => setLegal(e.target.value)} rows={3} hint="Ã–r. alÄ±cÄ±larÄ±n tacir olduÄŸu, adreslerin firmalarÄ±n kendi sitelerinde kamuya aÃ§Ä±k kurumsal adres olduÄŸu, Ä°YS/ret yÃ¼kÃ¼mlÃ¼lÃ¼klerinin nasÄ±l karÅŸÄ±landÄ±ÄŸÄ±. Hukuki danÄ±ÅŸmanÄ±nÄ±zla doÄŸrulayÄ±n." />
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !legal.trim()} onClick={() => void save({ outreach_legal_note: legal.trim(), outreach_legal_confirmed_at: new Date().toISOString() })}>Hukuki dayanaÄŸÄ± kaydet</Button>
            </div>
            <Toggle
              id="auto-send"
              checked={!!s.outreach_auto_send}
              onChange={(v) => (v && (!s.gmail_verified_at || !s.outreach_legal_confirmed_at) ? notify('Ã–nce Gmail (erlindoorkapi@gmail.com) baÄŸlantÄ±sÄ± sunucuda doÄŸrulanmalÄ± ve hukuki dayanak kaydedilmeli.', 'error') : void save({ outreach_auto_send: v }))}
              label="OnaylÄ± taslaklarÄ± otomatik gÃ¶nder"
              description="YalnÄ±z sizin onayladÄ±ÄŸÄ±nÄ±z taslaklar, tÃ¼m denetimler (Gmail doÄŸrulamasÄ±, ret listesi, alÄ±cÄ± doÄŸrulamasÄ±, gÃ¼nlÃ¼k sÄ±nÄ±r, 90 gÃ¼n kuralÄ±) geÃ§erse gÃ¶nderilir."
            />
          </div>
        </details>
      )}
    </Panel>
  )
}
