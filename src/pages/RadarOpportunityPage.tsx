import { ArrowLeft, Building2, ClipboardCopy, FileDown, FileSpreadsheet, FolderPlus, History, Loader2, Mail, Radar, Search, ShieldAlert, Sparkles, Target } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { FormAlert, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { COMPANY } from '@/config/company'
import { useToast } from '@/context/toast'
import {
  createDraft,
  FunctionUnavailableError,
  importToCrm,
  loadOpportunityDetail,
  type OpportunityDetail,
  researchContactsRemote,
  setOpportunityStatus,
  updateDraft,
  updateOpportunity,
  updateRadarCompany,
} from '@/data/radarApi'
import { ROLE_LABEL, SECTOR_LABEL, STAGE_LABEL, STATUS_LABEL, STATUS_ORDER, type OppStatus, type RadarCompany, type RadarDraft } from '@/data/radarTypes'
import { NeedBadge, ExtLink, Meter, Notice, useRadarData } from '@/features/radar/shared'
import { downloadBytes, loadPdfAssets } from '@/lib/download'
import { dataErrorMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { useLiveQuery } from '@/lib/useLiveList'
import { buildViews, capabilitiesFrom, fmtDateTime, fmtDay, locationText, missingInfo, projectTypeLabel, risks, strategy, toAssistant, localDate } from '@/radar/view'
import { draftEmail } from '@radar/assistant.ts'
import { CONTACT_KIND_LABEL } from '@radar/contacts.ts'
import { LABEL_TEXT } from '@radar/score.ts'
import { categoryName } from '@radar/taxonomy.ts'

const EMPTY_DETAIL: OpportunityDetail = { evidence: [], actions: [], drafts: [] }
const FN_KEY = 'leonx-radar-fn-unavailable'

function fnUnavailable(): boolean {
  try {
    return sessionStorage.getItem(FN_KEY) === '1'
  } catch {
    return false
  }
}

export function RadarOpportunityPage() {
  const { id = '' } = useParams()
  const { notify } = useToast()
  const q = useRadarData()
  const d = useLiveQuery<OpportunityDetail>(['radar_evidence', 'radar_actions', 'radar_outreach_drafts'], () => loadOpportunityDetail(requireSupabase(), id), EMPTY_DETAIL)
  const views = useMemo(() => buildViews(q.data), [q.data])
  const v = views.find((x) => x.opp.id === id)
  const [statusDraft, setStatusDraft] = useState<{ status: OppStatus; note: string } | null>(null)
  const [nextAction, setNextAction] = useState<string | null>(null)
  const [crm, setCrm] = useState<{ project: boolean; companyId: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [mail, setMail] = useState<{ draft: RadarDraft | null; subject: string; body: string; to: string } | null>(null)
  const [unavailable, setUnavailable] = useState(fnUnavailable())
  const [site, setSite] = useState<{ c: RadarCompany; url: string } | null>(null)

  if (q.error && !q.data.opportunities.length) return <ErrorState message={q.error} onRetry={() => void q.reload()} />
  if (q.loading && !v) return <LoadingState />
  if (!v) {
    return (
      <div className="card px-6 py-12 text-center">
        <p className="text-sm text-muted">Fırsat bulunamadı.</p>
        <Link to="/leonx-ai" className="mt-3 inline-block text-sm underline">Panele dön</Link>
      </div>
    )
  }
  const o = v.opp
  const today = localDate()
  const st = strategy(v)
  const verified = v.categories.filter((c) => c.need_status === 'dogrulanmis')
  const potential = v.categories.filter((c) => c.need_status !== 'dogrulanmis')
  const emails = v.companies.flatMap((c) => c.contacts.filter((k) => k.kind.endsWith('eposta')).map((k) => ({ c, k })))

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      if (e instanceof FunctionUnavailableError) {
        setUnavailable(true)
        try {
          sessionStorage.setItem(FN_KEY, '1')
        } catch {
          /* yok say */
        }
        notify(e.message, 'error')
      } else notify(dataErrorMessage(e, 'İşlem'), 'error')
    } finally {
      setBusy(null)
    }
  }

  const exportReport = (kind: 'pdf' | 'xlsx') =>
    run(kind, async () => {
      const { buildRadarReport, radarFileName } = await import('@/export/radarReport')
      const report = buildRadarReport(v, d.data.evidence, d.data.actions)
      if (kind === 'xlsx') {
        const { radarToXlsx } = await import('@/export/radarXlsx')
        downloadBytes(radarToXlsx(report), radarFileName(o.title, 'xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      } else {
        const [{ radarToPdf }, assets] = await Promise.all([import('@/export/radarPdf'), loadPdfAssets()])
        downloadBytes(await radarToPdf(report, assets), radarFileName(o.title, 'pdf'), 'application/pdf')
      }
    })

  const openMail = (existing?: RadarDraft) => {
    if (existing) return setMail({ draft: existing, subject: existing.subject, body: existing.body, to: emails[0]?.k.value ?? '' })
    const as = toAssistant([v], q.data)[0]
    const co = v.companies.find((c) => c.link.role === 'ana_yuklenici') ?? v.companies[0]
    const tpl = draftEmail(as, { now: new Date(), capabilities: capabilitiesFrom(q.data.settings?.capability_text, COMPANY.capabilities), companyName: COMPANY.name, website: COMPANY.website }, co ? as.companies.find((x) => x.name === co.company.name) : null)
    setMail({ draft: null, subject: tpl.subject, body: tpl.body, to: emails[0]?.k.value ?? '' })
  }

  const mailHref = mail && mail.to ? `mailto:${encodeURIComponent(mail.to)}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}` : undefined

  return (
    <>
      <Link to="/leonx-ai" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Radar paneli</Link>
      <PageHeader icon={Radar} code="M06" eyebrow="LEONX AI Radar" title={o.title} description={`${locationText(o)} · ${LABEL_TEXT[o.label]}`} />

      <div className="mb-4 flex flex-wrap gap-2" data-testid="opp-actions">
        <Button variant="secondary" icon={Building2} disabled={!v.companies.length || !!busy} onClick={() => setCrm({ project: false, companyId: v.companies[0]?.company.id ?? '' })} data-testid="opp-crm">Firmayı CRM'e aktar</Button>
        <Button variant="secondary" icon={FolderPlus} disabled={!!busy} onClick={() => setCrm({ project: true, companyId: v.companies[0]?.company.id ?? '' })} data-testid="opp-project">{o.project_id ? 'Proje adayını aç' : 'Proje adayı oluştur'}</Button>
        <Button variant="secondary" icon={Mail} onClick={() => openMail()} data-testid="opp-mail">E-posta taslağı</Button>
        <Button variant="secondary" icon={busy === 'pdf' ? Loader2 : FileDown} disabled={!!busy} onClick={() => void exportReport('pdf')} data-testid="opp-pdf">PDF</Button>
        <Button variant="secondary" icon={busy === 'xlsx' ? Loader2 : FileSpreadsheet} disabled={!!busy} onClick={() => void exportReport('xlsx')} data-testid="opp-xlsx">Excel</Button>
        {o.crm_company_id && <Link className="inline-flex h-10 items-center text-sm underline" to={`/firmalar/${o.crm_company_id}`} data-testid="opp-crm-link">CRM firması</Link>}
        {o.project_id && <Link className="inline-flex h-10 items-center text-sm underline" to={`/projeler/${o.project_id}`} data-testid="opp-project-link">Proje adayı</Link>}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <Panel title="A. Proje bilgileri" icon={Target}>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2" data-testid="opp-section-a">
              {[
                ['Konum', locationText(o)],
                ['Proje türü', projectTypeLabel(o.project_type)],
                ['Sektör', SECTOR_LABEL[o.sector]],
                ['Aşama', STAGE_LABEL[o.stage]],
                ['İKN', o.tender?.ikn ?? 'bilinmiyor'],
                ['Son teklif tarihi', fmtDay(o.deadline)],
                ['İlk görülme', fmtDateTime(o.first_seen_at)],
                ['Son güncelleme', fmtDateTime(o.last_updated_at)],
              ].map(([k, val]) => (
                <div key={k} className="min-w-0"><dt className="text-[11.5px] text-muted">{k}</dt><dd className="break-words text-ink">{val}</dd></div>
              ))}
            </dl>
          </Panel>

          <Panel title="B. İş fırsatı" icon={Sparkles}>
            <div className="grid grid-cols-2 gap-4">
              <Meter label="Fırsat puanı" value={o.score} tone={o.verified_need ? 'ok' : 'warn'} testId="opp-score" />
              <Meter label="Güvenilirlik (ayrı ölçüt)" value={o.reliability} tone="muted" testId="opp-reliability" />
            </div>
            {!o.verified_need && <div className="mt-3"><Notice tone="warn" testId="opp-unverified">Bu fırsatta kaynakla doğrulanmış ihtiyaç yok; yalnız potansiyel ihtiyaç gösteriliyor. “Doğrulanmış iş fırsatı” değildir.</Notice></div>}
            <h3 className="mt-4 text-[12px] font-semibold text-muted uppercase">Doğrulanmış kapsam</h3>
            <div className="mt-1 flex flex-wrap gap-1.5" data-testid="opp-verified">
              {verified.length ? verified.map((c) => <NeedBadge key={c.id} need="dogrulanmis">{categoryName(c.category_key)}</NeedBadge>) : <span className="text-[13px] text-subtle">Yok</span>}
            </div>
            <h3 className="mt-3 text-[12px] font-semibold text-muted uppercase">Potansiyel kapsam (doğrulanmadı)</h3>
            <div className="mt-1 flex flex-wrap gap-1.5" data-testid="opp-potential">
              {potential.length ? potential.map((c) => <NeedBadge key={c.id} need="potansiyel">{categoryName(c.category_key)}</NeedBadge>) : <span className="text-[13px] text-subtle">Yok</span>}
            </div>
            <h3 className="mt-3 text-[12px] font-semibold text-muted uppercase">Eksik bilgiler</h3>
            <ul className="mt-1 list-disc pl-5 text-[13px] text-ink-2">{missingInfo(v).map((m) => <li key={m}>{m}</li>)}</ul>
            <h3 className="mt-3 text-[12px] font-semibold text-muted uppercase">Puan açıklaması</h3>
            <table className="mt-1 w-full text-[12.5px]" data-testid="opp-breakdown">
              <tbody className="divide-y divide-line">
                {o.score_breakdown.map((p) => (
                  <tr key={p.key}><td className="py-1.5 pr-2 text-ink">{p.label}</td><td className="py-1.5 pr-2 font-mono whitespace-nowrap">{p.points} / {p.weight}</td><td className="py-1.5 text-muted">{p.reason}</td></tr>
                ))}
                {o.reliability_breakdown.map((p) => (
                  <tr key={p.key}><td className="py-1.5 pr-2 text-ink">Güvenilirlik: {p.label}</td><td className="py-1.5 pr-2 font-mono whitespace-nowrap">{p.points} / {p.max}</td><td className="py-1.5 text-muted">{p.reason}</td></tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="C. Firma analizi" icon={Building2}>
            {!v.companies.length ? <p className="text-[13px] text-subtle">Kaynaklarda firma/kurum adı bulunamadı (bilinmiyor).</p> : (
              <ul className="flex flex-col gap-4" data-testid="opp-companies">
                {v.companies.map(({ company: c, link, contacts }) => (
                  <li key={c.id} className="rounded-xl border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-ink">{c.name}</span>
                      <span className="text-[12px] text-muted">{ROLE_LABEL[link.role]}{link.verified ? ' · doğrulandı' : ' · rol tahmini (doğrulanmadı)'}</span>
                    </div>
                    <div className="mt-1 text-[12.5px] text-ink-2">
                      Web sitesi: {c.website ? <><ExtLink href={c.website} />{c.website_verified ? ' (doğrulandı)' : ' (doğrulanmadı)'}{c.website_source === 'sahip' ? ' · sahip girdi' : ''}</> : 'bilinmiyor'}
                      <button type="button" className="ml-2 text-[12px] underline" onClick={() => setSite({ c, url: c.website ?? '' })}>Web sitesini gir</button>
                    </div>
                    {contacts.length > 0 && (
                      <ul className="mt-2 text-[12.5px]">
                        {contacts.map((k) => <li key={k.id} className="break-words">{CONTACT_KIND_LABEL[k.kind]}: <b>{k.value}</b> <span className="text-subtle">— kaynak <ExtLink href={k.source_url} /> · doğrulama {fmtDateTime(k.verified_at)}</span></li>)}
                      </ul>
                    )}
                    <div className="mt-2">
                      <Button
                        variant="ghost"
                        icon={busy === `ara-${c.id}` ? Loader2 : Search}
                        disabled={unavailable || !c.website || !!busy}
                        onClick={() => void run(`ara-${c.id}`, async () => {
                          const r = await researchContactsRemote(requireSupabase(), c.id)
                          notify(`${r.saved} kurumsal kanal kaydedildi; ${r.skipped_personal} kişisel adres saklanmadı.`, 'success')
                        })}
                        data-testid="opp-research"
                      >
                        İletişim araştır
                      </Button>
                      {(unavailable || !c.website) && (
                        <p className="mt-1 text-[11.5px] text-subtle" data-testid="opp-research-why">
                          {unavailable ? 'Sunucu işlevi (radar-contacts) henüz dağıtılmadı; dağıtım sahip onayıyla yapılır.' : 'Önce kaynaktan doğrulanmış web sitesini girin; adres firma adından tahmin edilmez.'}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="D. Ticari strateji (öneri)" subtitle="Kayıtlı verilerden kural tabanlı üretilmiş ÖNERİDİR." icon={Target}>
            <div className="grid grid-cols-1 gap-4 text-[13px] sm:grid-cols-2" data-testid="opp-strategy">
              {([['Kime', st.whom], ['Hangi kanal', st.channels], ['Ne sorulmalı', st.questions], ['Hangi belgeler istenmeli', st.documents], ['Hangi ürünler', st.products]] as const).map(([t, list]) => (
                <div key={t}><h3 className="text-[12px] font-semibold text-muted">{t}</h3><ul className="mt-1 list-disc pl-5 text-ink-2">{list.map((x) => <li key={x}>{x}</li>)}</ul></div>
              ))}
              <div><h3 className="text-[12px] font-semibold text-muted">Sonraki aksiyon</h3><p className="mt-1 text-ink">{st.nextAction}</p></div>
            </div>
          </Panel>

          <Panel title="E. Risk analizi" icon={ShieldAlert}>
            <ul className="list-disc pl-5 text-[13px] text-warn" data-testid="opp-risks">{risks(v, today).map((r) => <li key={r.code}>{r.text}</li>)}</ul>
          </Panel>

          <Panel title="F. Kaynaklar" subtitle="Her iddia kaynağına bağlıdır; kaynak içeriği dış veridir." icon={Radar}>
            {!d.data.evidence.length ? <p className="text-[13px] text-subtle">{d.loading ? 'Yükleniyor…' : 'Kaynak kaydı yok.'}</p> : (
              <ol className="list-decimal pl-5 text-[13px]" data-testid="opp-sources">
                {d.data.evidence.map((e) => (
                  <li key={e.id} className="mb-2 break-words">
                    <span className="text-ink">{e.claim}</span>
                    {e.excerpt && <span className="block text-[12px] text-muted">“{e.excerpt}”</span>}
                    <span className="block text-[11.5px] text-subtle"><ExtLink href={e.url} /> · yayın {fmtDay(e.published_at)} · erişim {fmtDateTime(e.accessed_at)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Durum" icon={History}>
            <SelectField label="İş akışı durumu" value={statusDraft?.status ?? o.status} onChange={(e) => setStatusDraft({ status: e.target.value as OppStatus, note: statusDraft?.note ?? '' })} data-testid="opp-status">
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </SelectField>
            {statusDraft && statusDraft.status !== o.status && (
              <div className="mt-2 grid gap-2">
                <TextField label="Not (isteğe bağlı)" value={statusDraft.note} onChange={(e) => setStatusDraft({ ...statusDraft, note: e.target.value })} data-testid="opp-status-note" />
                <Button variant="primary" disabled={!!busy} onClick={() => void run('status', async () => {
                  await setOpportunityStatus(requireSupabase(), o, statusDraft.status, statusDraft.note.trim() || null)
                  setStatusDraft(null)
                  notify('Durum güncellendi.', 'success')
                })} data-testid="opp-status-save">Durumu kaydet</Button>
              </div>
            )}
            <TextField className="mt-3" label="Sonraki aksiyon" value={nextAction ?? o.next_action ?? ''} onChange={(e) => setNextAction(e.target.value)} onBlur={() => {
              if (nextAction == null || nextAction === (o.next_action ?? '')) return
              void run('next', async () => {
                await updateOpportunity(requireSupabase(), o, { next_action: nextAction.trim() || null })
                setNextAction(null)
              })
            }} data-testid="opp-next" />
            <h3 className="mt-4 text-[12px] font-semibold text-muted uppercase">Geçmiş</h3>
            <ul className="mt-1 text-[12.5px]" data-testid="opp-history">
              {d.data.actions.length ? d.data.actions.map((a) => (
                <li key={a.id} className="border-b border-line py-1.5 last:border-0">
                  <span className="text-ink">{a.from_status ? STATUS_LABEL[a.from_status as OppStatus] ?? a.from_status : '—'} → {STATUS_LABEL[a.to_status as OppStatus] ?? a.to_status}</span>
                  <span className="block text-[11.5px] text-subtle">{fmtDateTime(a.created_at)}{a.note ? ` · ${a.note}` : ''}</span>
                </li>
              )) : <li className="text-subtle">Henüz durum değişikliği yok.</li>}
            </ul>
          </Panel>
          <Panel title="E-posta taslakları" subtitle="Sistem e-posta GÖNDERMEZ; taslağı kopyalayıp kendi e-posta istemcinizden gönderirsiniz." icon={Mail}>
            <ul className="text-[12.5px]" data-testid="opp-drafts">
              {d.data.drafts.length ? d.data.drafts.map((x) => (
                <li key={x.id} className="border-b border-line py-1.5 last:border-0">
                  <button type="button" className="text-left text-ink underline-offset-2 hover:underline" onClick={() => openMail(x)}>{x.subject}</button>
                  <span className="block text-[11.5px] text-subtle">{x.status === 'taslak' ? 'Taslak' : x.status === 'onaylandi' ? 'Onaylandı' : 'Elle gönderildi'} · {fmtDateTime(x.updated_at)}</span>
                </li>
              )) : <li className="text-subtle">Taslak yok.</li>}
            </ul>
          </Panel>
        </div>
      </div>

      <Modal
        open={!!crm}
        onClose={() => setCrm(null)}
        busy={busy === 'crm'}
        title={crm?.project ? 'Proje adayı oluştur' : "Firmayı CRM'e aktar"}
        description={crm?.project
          ? 'Bu fırsattan “Yeni fırsat” aşamasında bir proje adayı oluşturulur (firma seçiliyse CRM firması da oluşturulur/bağlanır). Tekrar çalıştırmak çift kayıt oluşturmaz.'
          : 'Seçili firma yalnız radar verisiyle (ad, kaynaklı kurumsal e-posta/telefon) Firmalar modülüne eklenir. Tekrar çalıştırmak çift kayıt oluşturmaz.'}
        footer={crm && (
          <>
            <Button variant="ghost" onClick={() => setCrm(null)}>Vazgeç</Button>
            <Button variant="primary" disabled={busy === 'crm' || (!crm.project && !crm.companyId)} data-testid="crm-confirm" onClick={() => void run('crm', async () => {
              await importToCrm(requireSupabase(), o.id, crm.companyId || null, crm.project)
              notify(crm.project ? 'Proje adayı hazır.' : "Firma CRM'e aktarıldı.", 'success')
              setCrm(null)
              await q.reload()
            })}>{crm.project ? 'Proje adayı oluştur' : 'Aktar'}</Button>
          </>
        )}
      >
        {crm && (
          <SelectField label="Firma" value={crm.companyId} onChange={(e) => setCrm({ ...crm, companyId: e.target.value })} data-testid="crm-company">
            {crm.project && <option value="">Firma bağlamadan</option>}
            {v.companies.map(({ company: c, link }) => <option key={c.id} value={c.id}>{c.name} — {ROLE_LABEL[link.role]}{link.verified ? '' : ' (rol doğrulanmadı)'}</option>)}
          </SelectField>
        )}
      </Modal>

      <Modal open={!!mail} onClose={() => setMail(null)} size="lg" title="E-posta taslağı" description="Otomatik gönderim yoktur. Taslağı kaydedin, kopyalayın veya e-posta istemcinizde açın." footer={mail && (
        <>
          <Button variant="ghost" icon={ClipboardCopy} onClick={() => void navigator.clipboard?.writeText(`Konu: ${mail.subject}\n\n${mail.body}`).then(() => notify('Panoya kopyalandı.', 'success'), () => notify('Kopyalanamadı.', 'error'))} data-testid="mail-copy">Kopyala</Button>
          {mailHref ? <a href={mailHref} className="inline-flex h-10 items-center rounded-xl border border-line px-3 text-sm font-semibold" data-testid="mail-open">E-posta istemcisinde aç</a> : null}
          <Button variant="primary" disabled={busy === 'mail'} onClick={() => void run('mail', async () => {
            const db = requireSupabase()
            const contact = emails.find((e) => e.k.value === mail.to)
            if (mail.draft) await updateDraft(db, mail.draft, { subject: mail.subject, body: mail.body, contact_id: contact?.k.id ?? null })
            else await createDraft(db, { opportunity_id: o.id, company_id: contact?.c.company.id ?? v.companies[0]?.company.id ?? null, contact_id: contact?.k.id ?? null, subject: mail.subject, body: mail.body })
            notify('Taslak kaydedildi (gönderilmedi).', 'success')
            setMail(null)
          })} data-testid="mail-save">Taslağı kaydet</Button>
        </>
      )}>
        {mail && (
          <div className="grid gap-3" data-testid="mail-dialog">
            <SelectField label="Alıcı (yalnız kaynaklı kurumsal adresler)" value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} data-testid="mail-to">
              <option value="">Alıcı seçilmedi</option>
              {emails.map(({ c, k }) => <option key={k.id} value={k.value}>{k.value} ({c.company.name})</option>)}
            </SelectField>
            {!emails.length && <FormAlert tone="warn">Doğrulanmış kurumsal e-posta yok. Adres tahmin edilmez; “İletişim araştır” ile firmanın kendi sitesinden kaynaklı kanal bulun.</FormAlert>}
            <TextField label="Konu" value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} data-testid="mail-subject" />
            <TextAreaField label="İleti" rows={14} value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} data-testid="mail-body" />
          </div>
        )}
      </Modal>

      <Modal open={!!site} onClose={() => setSite(null)} title="Firmanın web sitesi" description="Yalnız kaynakta gördüğünüz veya doğruladığınız adresi girin (https). Adres firma adından tahmin edilmez." footer={site && (
        <Button variant="primary" disabled={busy === 'site'} onClick={() => void run('site', async () => {
          const url = site.url.trim()
          if (url && !/^https:\/\/[^\s/]+/.test(url)) throw new Error('Adres https:// ile başlamalı')
          await updateRadarCompany(requireSupabase(), site.c, { website: url || null, website_source: url ? 'sahip' : null, website_verified: !!url })
          setSite(null)
        })}>Kaydet</Button>
      )}>
        {site && <TextField label="Web sitesi" value={site.url} onChange={(e) => setSite({ ...site, url: e.target.value })} placeholder="https://" />}
      </Modal>
    </>
  )
}
