import { FileText, Ruler, ScanLine } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Panel } from '@/components/ui/Panel'
import { listProjectFiles } from '@/data/api'
import { listAnalyses, listProjectItems, listTakeoffs } from '@/data/quantityApi'
import type { CadAnalysis, ProjectFile, QuantityTakeoff } from '@/data/types'
import { fileExtension } from '@/lib/files'
import { requireSupabase } from '@/lib/supabase'
import { useLiveList } from '@/lib/useLiveList'
import { summarize } from '@/quantity/engine'
import { formatCenti } from '@/quantity/precision'
import type { QuantityItem } from '@/quantity/types'

const STATUS = { taslak: 'Taslak', onaylandi: 'Onaylı', arsiv: 'Arşiv' } as const
const dtf = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** Proje detayında CAD dosyaları, analiz geçmişi, metraj sürümleri ve toplamlar (canlı) */
export function ProjectQuantity({ projectId }: { projectId: string }) {
  const db = requireSupabase
  const files = useLiveList<ProjectFile>('project_files', 'project_id', projectId, (id) => listProjectFiles(db(), id))
  const analyses = useLiveList<CadAnalysis>('cad_analyses', 'project_id', projectId, (id) => listAnalyses(db(), id))
  const takeoffs = useLiveList<QuantityTakeoff>('quantity_takeoffs', 'project_id', projectId, (id) => listTakeoffs(db(), id))
  const items = useLiveList<QuantityItem>('quantity_items', 'project_id', projectId, (id) => listProjectItems(db(), id))

  const cadFiles = files.items.filter((f) => ['dxf', 'dwg', 'pdf'].includes(fileExtension(f.file_name)))
  const byTakeoff = useMemo(() => {
    const m = new Map<string, QuantityItem[]>()
    for (const i of items.items) m.set(i.takeoff_id, [...(m.get(i.takeoff_id) ?? []), i])
    return m
  }, [items.items])
  const current = takeoffs.items.find((t) => t.status === 'onaylandi') ?? takeoffs.items[0] ?? null
  const currentTotals = current ? summarize(byTakeoff.get(current.id) ?? []) : null

  return (
    <Panel
      title="CAD ve metraj"
      subtitle="Çizimler, analiz geçmişi ve metraj sürümleri"
      icon={Ruler}
      actions={
        <Link to={`/cad-analiz?proje=${projectId}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-surface-2">
          <ScanLine className="h-4 w-4" aria-hidden="true" />
          CAD Analiz
        </Link>
      }
    >
      <div className="space-y-5" data-testid="project-quantity">
        {current && currentTotals && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={`Rev ${current.revision} · ${STATUS[current.status]}`} value={`${formatCenti(currentTotals.verified.frameArea)} m²`} hint="Onaylı doğrama alanı" />
            <Stat label="Onaylı poz" value={String(currentTotals.verified.items)} hint={`${currentTotals.verified.pieces.toLocaleString('tr-TR')} adet`} />
            <Stat label="Bekleyen doğrulama" value={String(currentTotals.pending.items)} hint={`${formatCenti(currentTotals.pending.frameArea)} m² dahil değil`} warn={currentTotals.pending.items > 0} />
            <Stat label="Doğrusal" value={`${formatCenti(currentTotals.verified.length)} mtül`} hint="Korkuluk vb." />
          </div>
        )}

        <section>
          <h3 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase">Metraj sürümleri</h3>
          {takeoffs.items.length === 0 ? (
            <p className="text-[13px] text-muted">Henüz metraj sürümü yok. CAD Analiz ekranında çizimden poz ekleyerek veya Metraj ekranında elle oluşturabilirsiniz.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {takeoffs.items.map((t) => {
                const tot = summarize(byTakeoff.get(t.id) ?? [])
                return (
                  <li key={t.id}>
                    <Link to={`/metraj?proje=${projectId}&surum=${t.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px] hover:bg-surface-2">
                      <span className="font-semibold text-ink">Rev {t.revision}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-2">{t.name}</span>
                      <span className={t.status === 'onaylandi' ? 'text-ok' : t.status === 'arsiv' ? 'text-subtle' : 'text-warn'}>{STATUS[t.status]}</span>
                      <span className="font-mono text-ink">{formatCenti(tot.verified.frameArea)} m²</span>
                      {tot.pending.items > 0 && <span className="text-warn">{tot.pending.items} bekleyen</span>}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase">CAD dosyaları</h3>
          {cadFiles.length === 0 ? (
            <p className="text-[13px] text-muted">DXF, DWG veya PDF çizim yok.</p>
          ) : (
            <ul className="space-y-1">
              {cadFiles.map((f) => {
                const ext = fileExtension(f.file_name)
                const count = analyses.items.filter((a) => a.file_id === f.id).length
                return (
                  <li key={f.id} className="flex items-center gap-2 text-[13px]">
                    <FileText className="h-4 w-4 shrink-0 text-titanium" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-ink" title={f.file_name}>
                      {f.file_name}
                    </span>
                    {count > 0 && <span className="shrink-0 text-[12px] text-muted">{count} analiz</span>}
                    {ext === 'dwg' ? (
                      <span className="shrink-0 text-[12px] text-muted">DXF'e dönüştürün</span>
                    ) : (
                      <Link to={`/cad-analiz?proje=${projectId}&dosya=${f.id}`} className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[12px] font-semibold text-ink hover:bg-surface-2">
                        Aç
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase">Analiz geçmişi</h3>
          {analyses.items.length === 0 ? (
            <p className="text-[13px] text-muted">Kayıtlı analiz yok.</p>
          ) : (
            <ul className="space-y-1 text-[12.5px]">
              {analyses.items.slice(0, 10).map((a) => (
                <li key={a.id} className="flex flex-wrap gap-x-2 text-muted">
                  <span className="text-ink">{a.file_name}</span>· {dtf.format(new Date(a.created_at))} · {a.candidate_count} aday · birim {a.units_verified ? 'doğrulandı' : 'doğrulanmadı'}
                  {!a.file_id && ' · dosya silinmiş'}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Panel>
  )
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint: string; warn?: boolean }) {
  return (
    <div className={warn ? 'rounded-xl border border-warn-line bg-warn-soft px-3 py-2.5' : 'rounded-xl border border-line bg-surface-2/60 px-3 py-2.5'}>
      <div className={warn ? 'text-[11px] text-warn' : 'text-[11px] text-muted'}>{label}</div>
      <div className={warn ? 'mt-0.5 font-mono text-[15px] font-semibold text-warn' : 'mt-0.5 font-mono text-[15px] font-semibold text-ink'}>{value}</div>
      <div className="text-[11px] text-subtle">{hint}</div>
    </div>
  )
}
