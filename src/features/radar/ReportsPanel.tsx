import { Activity, FileDown, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { SkeletonRows } from '@/components/ui/States'
import { useToast } from '@/context/toast'
import { listDigests, loadOps } from '@/data/radarApi'
import type { RadarDigest, RadarOps } from '@/data/radarTypes'
import { buildDigestReport, DIGEST_KIND_LABEL } from '@/export/radarDigest'
import { downloadBytes, loadPdfAssets } from '@/lib/download'
import { dataErrorMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { useLiveQuery } from '@/lib/useLiveList'
import { fmtDateTime, fmtDay } from '@/radar/view'
import { radarFileName } from '@/export/radarReport'
import { Kpi, Notice } from './shared'

/** LEONX AI › Raporlar: sunucuda zamanlanmış günlük/haftalık raporlar ve tarama sağlığı */
export function ReportsPanel() {
  const { notify } = useToast()
  const q = useLiveQuery<RadarDigest[] | null>(['radar_reports'], () => listDigests(requireSupabase()).catch(() => null), [])
  const [health, setHealth] = useState<RadarOps | null | 'yok'>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    loadOps(requireSupabase()).then((h) => live && setHealth(h), () => live && setHealth('yok'))
    return () => {
      live = false
    }
  }, [q.data])

  const reports = useMemo(() => q.data ?? [], [q.data])
  const current = reports.find((r) => r.id === selected) ?? reports[0] ?? null
  const report = useMemo(() => (current ? buildDigestReport(current) : null), [current])

  const exportAs = async (kind: 'pdf' | 'xlsx') => {
    if (!report) return
    setBusy(kind)
    try {
      if (kind === 'xlsx') {
        const { radarToXlsx } = await import('@/export/radarXlsx')
        downloadBytes(radarToXlsx(report), radarFileName(report.title, 'xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      } else {
        const [{ radarToPdf }, assets] = await Promise.all([import('@/export/radarPdf'), loadPdfAssets()])
        downloadBytes(await radarToPdf(report, assets), radarFileName(report.title, 'pdf'), 'application/pdf')
      }
    } catch (e) {
      notify(dataErrorMessage(e, 'Dışa aktarma'), 'error')
    } finally {
      setBusy(null)
    }
  }

  if (q.data === null) {
    return (
      <Notice tone="warn" testId="reports-unavailable">
        Zamanlanmış raporlar için veritabanı güncellemesi (016) henüz uygulanmadı. Uygulama sahip onayıyla yapılır (docs/LEONX_AI_RADAR.md §11).
      </Notice>
    )
  }

  const h = health && health !== 'yok' ? health : null
  return (
    <div className="flex flex-col gap-6" data-testid="radar-reports">
      <Panel title="Radar işletim durumu" subtitle={h ? `Veritabanından okundu: ${fmtDateTime(h.checked_at)} · son 24 saat` : 'Sunucu durumu okunuyor…'} icon={Activity}>
        {health === 'yok' && <Notice tone="warn">İşletim özeti okunamadı (018 uygulanmamış olabilir).</Notice>}
        {h && <OpsView h={h} />}
      </Panel>

      <Panel
        title="Zamanlanmış raporlar"
        subtitle="Günlük rapor her sabah 07:30, haftalık özet pazartesi 08:00 (Türkiye saati) sunucuda üretilir; cihazların açık olması gerekmez."
        icon={FileText}
      >
        {q.loading && !reports.length ? <SkeletonRows rows={3} /> : !reports.length ? (
          <p className="text-[13px] text-subtle" data-testid="reports-empty">Henüz rapor üretilmedi. İlk rapor zamanlayıcının bir sonraki çalışmasında oluşur.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
            <ul className="flex flex-col gap-1 text-[13px]" data-testid="reports-list">
              {reports.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(r.id)}
                    className={`w-full rounded-md px-2 py-1.5 text-left ${current?.id === r.id ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-2 hover:bg-surface-2'}`}
                  >
                    {DIGEST_KIND_LABEL[r.kind]}
                    <span className="block text-[11.5px] font-normal text-subtle">{r.period_start === r.period_end ? fmtDay(r.period_start) : `${fmtDay(r.period_start)} – ${fmtDay(r.period_end)}`}</span>
                  </button>
                </li>
              ))}
            </ul>
            {report && current && (
              <article className="min-w-0" data-testid="report-view">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h3 className="min-w-0 flex-1 text-[14px] font-semibold text-ink">{report.title}</h3>
                  <Button variant="secondary" icon={busy === 'pdf' ? Loader2 : FileDown} disabled={!!busy} onClick={() => void exportAs('pdf')} data-testid="report-pdf">PDF</Button>
                  <Button variant="secondary" icon={busy === 'xlsx' ? Loader2 : FileSpreadsheet} disabled={!!busy} onClick={() => void exportAs('xlsx')} data-testid="report-xlsx">Excel</Button>
                </div>
                <p className="mb-3 text-[11.5px] text-subtle">{report.subtitle}</p>
                {report.sections.map((s) => (
                  <section key={s.key} className="mb-4">
                    <h4 className="text-[12px] font-semibold uppercase text-muted">{s.title}</h4>
                    {s.note && <p className="mt-1 text-[11.5px] text-warn">{s.note}</p>}
                    <ul className="mt-1 divide-y divide-line text-[12.5px]">
                      {s.rows.map((row, i) => {
                        const opp = [...(current.payload.top ?? []), ...(current.payload.deadlines ?? []), ...(current.payload.follow_ups ?? [])]
                          .find((o) => row.label.endsWith(o.title))
                        return (
                          <li key={i} className="py-1.5">
                            {opp ? <Link className="font-medium text-ink underline-offset-2 hover:underline" to={`/leonx-ai/firsat/${opp.id}`}>{row.label}</Link> : <span className="font-medium text-ink">{row.label}</span>}
                            <span className={`block ${row.tone === 'warn' ? 'text-warn' : row.tone === 'muted' ? 'text-subtle' : 'text-ink-2'}`}>{row.value}</span>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ))}
              </article>
            )}
          </div>
        )}
      </Panel>
    </div>
  )
}

const REJECT_TEXT: Record<string, string> = {
  urun_yok: 'LEONX ürünü / yapım işi yok',
  insaat_disi: 'Satış, kiralama, hizmet ilanı',
  tamamlanmis: 'Proje tamamlanmış',
  kapsam_disi_alim: 'Kapsam dışı mal/hizmet/altyapı alımı',
}
const PUSH_TEXT: Record<string, string> = { gonderildi: 'Gönderildi', bekliyor: 'Bekliyor', basarisiz: 'Başarısız', yok: '—' }

/** İşletim özeti: her sayı radar_ops() ile veritabanından gelir (tahmin yok) */
function OpsView({ h }: { h: RadarOps }) {
  const httpBad = h.last_dispatch_http && (h.last_dispatch_http.status_code == null || h.last_dispatch_http.status_code >= 300)
  const remedies: string[] = []
  if (!h.scan_configured || !h.cron_active) remedies.push('Zamanlayıcı bağlı değil: leonx-radar işi ve radar_config.scan_url kontrol edilmeli.')
  if (!h.active_sources) remedies.push('İzinli ve etkin kaynak yok: Kaynaklar bölümünde bir kaynağı “Doğrula” ile sınayıp İzinli + Etkin yapın. Kaynak yokken tarama hiçbir şey bulamaz.')
  if (httpBad) remedies.push(`radar-scan çağrısı başarısız (${h.last_dispatch_http?.status_code ?? h.last_dispatch_http?.error ?? 'yanıt yok'}): işlev günlüklerine bakın veya işlevi yeniden dağıtın.`)
  if (h.push.subscriptions === 0) remedies.push('Bildirim aboneliği yok: Ayarlar › Bildirimler bölümünden bu cihazda bildirimleri açın.')
  if (h.push.failed > 0) remedies.push(`${h.push.failed} bildirim son 7 günde cihaza iletilemedi: cihazda bildirimi kapatıp yeniden açın.`)
  return (
    <div className="flex flex-col gap-3" data-testid="radar-ops">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="radar-health">
        <Kpi label="Etkin doğrulanmış kaynak" value={h.active_sources} hint={`${h.verified_sources} doğrulanmış · ${h.candidate_sources} aday`} tone={h.active_sources ? 'ok' : 'warn'} testId="ops-active" />
        <Kpi label="Son başarılı tarama" value={h.last_success_at ? fmtDateTime(h.last_success_at) : 'Hiç'} tone={h.last_success_at ? undefined : 'warn'} testId="ops-last-success" />
        <Kpi label="Sonraki tarama" value={h.next_scan_at ? fmtDateTime(h.next_scan_at) : 'Zamanlanmadı'} hint="Sunucuda saatte bir; cihaz açık olmasa da" tone={h.next_scan_at ? undefined : 'warn'} testId="ops-next" />
        <Kpi label="Taranan kaynak" value={h.sources_checked_24h} hint={`${h.runs_24h} çalıştırma · ${h.errors_24h} hata`} tone={h.errors_24h ? 'warn' : undefined} testId="ops-checked" />
        <Kpi label="Toplanan öğe" value={h.items_collected_24h} testId="ops-collected" />
        <Kpi label="Elenen öğe" value={h.items_rejected_24h} hint="LEONX ile ilgisiz" testId="ops-rejected" />
        <Kpi label="Yeni fırsat" value={h.opportunities_new_24h} hint={`${h.opportunities_verified_24h} doğrulanmış · toplam ${h.opportunities_total}`} testId="ops-new" />
        <Kpi label="Son bildirim" value={h.push.last ? PUSH_TEXT[h.push.last.push_state] ?? h.push.last.push_state : '—'} hint={`${h.push.subscriptions} cihaz · son başarılı ${h.push.last_success_at ? fmtDateTime(h.push.last_success_at) : '—'}`} tone={h.push.failed ? 'warn' : undefined} testId="ops-push" />
      </div>
      {Object.keys(h.reject_reasons_24h).length > 0 && (
        <p className="text-[12.5px] text-ink-2" data-testid="ops-reasons">
          Elenme nedenleri: {Object.entries(h.reject_reasons_24h).map(([k, n]) => `${REJECT_TEXT[k] ?? k} ${n}`).join(' · ')}
        </p>
      )}
      {h.errors.length > 0 && (
        <ul className="text-[12.5px] text-danger" data-testid="radar-health-failing">
          {h.errors.map((e, i) => <li key={i}>{fmtDateTime(e.at)} · {e.name}: {e.error ?? (e.http_status ? `HTTP ${e.http_status}` : e.status)}{e.failures > 0 ? ` (${e.failures} ardışık hata; geri çekilmeyle yeniden denenecek)` : ''}</li>)}
        </ul>
      )}
      {remedies.length > 0 && (
        <Notice tone="warn" testId="ops-remedies">
          <ul className="list-disc pl-4">{remedies.map((r) => <li key={r}>{r}</li>)}</ul>
        </Notice>
      )}
    </div>
  )
}
