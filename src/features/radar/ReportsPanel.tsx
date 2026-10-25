import { Activity, FileDown, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { SkeletonRows } from '@/components/ui/States'
import { useToast } from '@/context/toast'
import { listDigests, loadHealth } from '@/data/radarApi'
import type { RadarDigest, RadarHealth } from '@/data/radarTypes'
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
  const [health, setHealth] = useState<RadarHealth | null | 'yok'>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    loadHealth(requireSupabase()).then((h) => live && setHealth(h), () => live && setHealth('yok'))
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
      <Panel title="Tarama sağlığı" subtitle={h ? `Denetim: ${fmtDateTime(h.checked_at)}` : 'Sunucu durumu okunuyor…'} icon={Activity}>
        {health === 'yok' && <Notice tone="warn">Sağlık özeti okunamadı (016 uygulanmamış olabilir).</Notice>}
        {h && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="radar-health">
              <Kpi label="Zamanlayıcı" value={h.scan_configured ? 'Bağlı' : 'Bağlı değil'} tone={h.scan_configured ? 'ok' : 'warn'} />
              <Kpi label="İzinli kaynak" value={h.active_sources} />
              <Kpi label="Son tarama" value={h.last_run_at ? fmtDateTime(h.last_run_at) : '—'} />
              <Kpi label="24 saat tarama / hata" value={`${h.runs_24h} / ${h.errors_24h}`} tone={h.errors_24h ? 'warn' : undefined} />
            </div>
            {h.failing_sources.length > 0 && (
              <ul className="mt-3 text-[12.5px] text-danger" data-testid="radar-health-failing">
                {h.failing_sources.map((s) => <li key={s.id}>{s.name}: {s.failures} ardışık hata — Kaynaklar bölümünden test edin.</li>)}
              </ul>
            )}
          </>
        )}
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
