import { FileText, GitBranch } from 'lucide-react'
import type { CadAnalysis, QuantityTakeoff } from '@/data/types'
import { cn } from '@/lib/cn'
import { Section } from '../workspace/ui'

const dtf = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const T_STATUS = { taslak: 'Taslak', onaylandi: 'Onaylı', arsiv: 'Arşiv' } as const
const A_STATUS = { tamamlandi: 'Tamamlandı', eksik: 'Eksik (sınır aşıldı)', hatali: 'Hatalı' } as const

/** Bağlı projenin analiz geçmişi ve metraj sürümleri */
export function ProjectHistoryPanel({
  analyses,
  takeoffs,
  currentTakeoffId,
  onSelectTakeoff,
}: {
  analyses: CadAnalysis[]
  takeoffs: QuantityTakeoff[]
  currentTakeoffId: string | null
  onSelectTakeoff: (id: string) => void
}) {
  return (
    <div data-testid="project-history">
      <Section title={`Metraj sürümleri (${takeoffs.length})`}>
        {takeoffs.length === 0 ? (
          <p className="text-[12px] text-muted">Henüz metraj sürümü yok.</p>
        ) : (
          <ul className="space-y-1">
            {takeoffs.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onSelectTakeoff(t.id)}
                  className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-surface-2', t.id === currentTakeoffId && 'bg-surface-3')}
                >
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-titanium" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-ink">
                    Rev {t.revision} · {t.name}
                  </span>
                  <span className={cn('shrink-0 text-[10.5px] font-semibold', t.status === 'onaylandi' ? 'text-ok' : t.status === 'arsiv' ? 'text-subtle' : 'text-warn')}>{T_STATUS[t.status]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={`Analiz geçmişi (${analyses.length})`}>
        {analyses.length === 0 ? (
          <p className="text-[12px] text-muted">Bu projede kayıtlı analiz yok.</p>
        ) : (
          <ul className="space-y-2">
            {analyses.map((a) => (
              <li key={a.id} className="flex gap-2 text-[12px]">
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-titanium" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink" title={a.file_name}>
                    {a.file_name}
                  </div>
                  <div className="text-[11px] text-muted">
                    {dtf.format(new Date(a.created_at))} · {a.file_kind.toUpperCase()} · {A_STATUS[a.status]}
                  </div>
                  <div className="text-[11px] text-muted">
                    {a.entity_count.toLocaleString('tr-TR')} nesne · {a.candidate_count} aday · birim {a.units_verified ? 'doğrulandı' : 'doğrulanmadı'}
                    {!a.file_id && ' · dosya silinmiş'}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
