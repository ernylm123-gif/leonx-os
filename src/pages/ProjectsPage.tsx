import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, ChevronRight, Columns3, FolderKanban, FolderPlus, List, MapPin } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { CategoryChips } from '@/components/ui/CategoryChips'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { PriorityLabel, ProgressBar, StageBadge } from '@/components/ui/ProjectBadges'
import { ErrorState, SkeletonRows } from '@/components/ui/States'
import { FilterSelect, SearchInput } from '@/components/ui/Toolbar'
import { useData } from '@/context/data'
import { ProjectForm } from '@/features/projects/ProjectForm'
import { ProjectKanban } from '@/features/projects/ProjectKanban'
import { CATEGORY_LABEL, CLOSED_STAGES, isActiveStage, PROJECT_CATEGORIES, PROJECT_STAGES, type ProjectStage, QUOTE_STAGES } from '@/lib/domain'
import { cn } from '@/lib/cn'
import { daysUntil, formatDate, localISODate, matchesSearch } from '@/lib/stats'

function DueLabel({ due, active }: { due: string | null; active: boolean }) {
  if (!due) return <span className="text-subtle">—</span>
  const d = daysUntil(due, localISODate())
  const late = active && d < 0
  return (
    <span className={cn('whitespace-nowrap', late ? 'font-medium text-danger' : 'text-ink-2')}>
      {formatDate(due)}
      {late && <span className="ml-1.5 text-[11px]">({-d} gün gecikti)</span>}
    </span>
  )
}

/** Aşama filtresi: tekil aşama veya gruplar (panodaki kartlardan gelen bağlantılar dahil) */
export function matchesStageFilter(stage: ProjectStage, filter: string): boolean {
  if (filter === 'tumu') return true
  if (filter === 'aktif') return isActiveStage(stage)
  if (filter === 'teklif') return QUOTE_STAGES.includes(stage)
  if (filter === 'kapanan') return CLOSED_STAGES.includes(stage) && stage !== 'iptal'
  return stage === filter
}

export function ProjectsPage() {
  const { projects, companies, loading, error, refresh, truncated } = useData()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [formOpen, setFormOpen] = useState(false)

  // Filtreler bileşen durumunda tutulur ve adrese yansıtılır (paylaşılabilir/yenilemeye dayanıklı).
  // Adres güncellemesi eşzamansız olduğundan, art arda değişikliklerde eski değer okunmaz.
  const [filters, setFilters] = useState(() => ({
    q: params.get('q') ?? '',
    asama: params.get('asama') ?? 'aktif',
    kategori: params.get('kategori') ?? '',
    firma: params.get('firma') ?? '',
    gorunum: params.get('gorunum') === 'kanban' ? 'kanban' : 'liste',
  }))
  const { q, asama: stageFilter, kategori: category, firma: company, gorunum: view } = filters
  const setParam = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    const next = new URLSearchParams()
    if (filters.q) next.set('q', filters.q)
    if (filters.asama !== 'aktif') next.set('asama', filters.asama)
    if (filters.kategori) next.set('kategori', filters.kategori)
    if (filters.firma) next.set('firma', filters.firma)
    if (filters.gorunum === 'kanban') next.set('gorunum', 'kanban')
    setParams(next, { replace: true })
  }, [filters, setParams])

  const companyName = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies])

  const filtered = useMemo(
    () =>
      projects.filter((p) => {
        if (!matchesStageFilter(p.stage, stageFilter)) return false
        if (category && p.category !== category) return false
        if (company && p.company_id !== company) return false
        return matchesSearch(q, p.code, p.name, p.location, p.company_id ? companyName.get(p.company_id) : null)
      }),
    [projects, stageFilter, category, company, q, companyName],
  )

  const hasFilters = q || stageFilter !== 'aktif' || category || company

  return (
    <>
      <PageHeader
        icon={FolderKanban}
        code="M01"
        eyebrow="Genel"
        title="Projeler"
        description="Alüminyum, PVC, kapı, korkuluk, cephe ve metal imalat projelerinin keşiften teslime kadar takibi."
        status="ready"
        actions={
          <Button variant="primary" icon={FolderPlus} onClick={() => setFormOpen(true)} disabled={loading && !projects.length}>
            Yeni proje
          </Button>
        }
      />

      <div className="mb-4">
        <CategoryChips label="İş kategorileri" />
      </div>

      <div className="mb-4 flex flex-col gap-2.5 lg:flex-row">
        <SearchInput value={q} onChange={(v) => setParam('q', v)} placeholder="Kod, ad, konum veya firma ara…" label="Projelerde ara" />
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 lg:flex">
          <FilterSelect value={stageFilter} onChange={(v) => setParam('asama', v)} label="Aşama filtresi" className="lg:w-48">
            <option value="aktif">Aktif projeler</option>
            <option value="tumu">Tüm aşamalar</option>
            <option value="teklif">Teklif bekleyenler</option>
            <option value="kapanan">Tamamlanan / teslim</option>
            {PROJECT_STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect value={category} onChange={(v) => setParam('kategori', v)} label="Kategori filtresi" className="lg:w-48">
            <option value="">Tüm kategoriler</option>
            {PROJECT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect value={company} onChange={(v) => setParam('firma', v)} label="Firma filtresi" className="lg:w-48">
            <option value="">Tüm firmalar</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </FilterSelect>
        </div>
      </div>

      {truncated && (
        <p className="mb-3 flex items-center gap-2 text-xs text-warn">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Liste ilk 1000 kayıtla sınırlıdır.
        </p>
      )}

      <section className="card overflow-hidden" aria-label="Proje listesi">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 text-xs text-muted">
          <span className="whitespace-nowrap">
            <b className="font-semibold text-ink">{filtered.length}</b> proje
            {hasFilters ? ` (toplam ${projects.length})` : ''}
          </span>
          <div className="order-last flex rounded-lg border border-line bg-surface-2 p-0.5 sm:order-none sm:mr-3 sm:ml-auto" role="group" aria-label="Görünüm">
            {(
              [
                ['liste', 'Liste', List],
                ['kanban', 'Pano', Columns3],
              ] as const
            ).map(([v, label, Icon]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setParam('gorunum', v)}
                className={view === v ? 'inline-flex h-7 items-center gap-1 rounded-md bg-surface px-2 text-[12px] font-semibold text-ink shadow-card' : 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted hover:text-ink'}
                data-testid={`view-${v}`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          {hasFilters && (
            <button type="button" onClick={() => setFilters((f) => ({ ...f, q: '', asama: 'aktif', kategori: '', firma: '' }))} className="font-medium text-ink-2 underline-offset-4 hover:underline">
              Filtreleri temizle
            </button>
          )}
        </div>

        {loading && !projects.length ? (
          <SkeletonRows />
        ) : error && !projects.length ? (
          <ErrorState message={error} onRetry={() => void refresh()} />
        ) : projects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="Henüz proje yok"
            description="İlk projenizi oluşturun. Kayıtlar bu hesapla giriş yaptığınız tüm cihazlarda görünür."
          >
            <Button variant="primary" icon={FolderPlus} onClick={() => setFormOpen(true)}>
              Yeni proje
            </Button>
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState icon={FolderKanban} title="Eşleşen proje yok" description="Arama veya filtreleri değiştirmeyi deneyin." />
        ) : view === 'kanban' ? (
          <div className="p-3">
            <ProjectKanban projects={filtered} companyName={companyName} showClosed={stageFilter !== 'aktif'} />
          </div>
        ) : (
          <>
            {/* Geniş ekran: tablo */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Projeler</caption>
                <thead className="border-b border-line bg-surface-2 text-[11px] tracking-[0.08em] text-muted uppercase">
                  <tr>
                    {['Proje', 'Firma', 'Kategori', 'Aşama', 'İlerleme', 'Öncelik', 'Teslim'].map((h) => (
                      <th key={h} scope="col" className="px-4 py-3 font-semibold whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.map((p) => (
                    <tr key={p.id} className="group cursor-pointer transition-colors hover:bg-surface-2/70" onClick={() => navigate(`/projeler/${p.id}`)}>
                      <td className="px-4 py-3">
                        <Link to={`/projeler/${p.id}`} className="block min-w-0" onClick={(e) => e.stopPropagation()}>
                          <span className="block font-mono text-[11px] text-subtle">{p.code}</span>
                          <span className="block max-w-[320px] truncate font-medium text-ink group-hover:underline">{p.name}</span>
                        </Link>
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 text-ink-2">{p.company_id ? companyName.get(p.company_id) ?? '—' : '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-ink-2">{CATEGORY_LABEL[p.category]}</td>
                      <td className="px-4 py-3">
                        <StageBadge stage={p.stage} onHold={p.on_hold} />
                      </td>
                      <td className="w-36 px-4 py-3">
                        <ProgressBar value={p.progress} label={`${p.code} ilerleme`} />
                      </td>
                      <td className="px-4 py-3">
                        <PriorityLabel priority={p.priority} />
                      </td>
                      <td className="px-4 py-3">
                        <DueLabel due={p.due_date} active={isActiveStage(p.stage)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Telefon: kartlar */}
            <ul className="divide-y divide-line md:hidden">
              {filtered.map((p) => (
                <li key={p.id}>
                  <Link to={`/projeler/${p.id}`} className="flex items-start gap-3 px-4 py-3.5 active:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-subtle">{p.code}</span>
                        <StageBadge stage={p.stage} onHold={p.on_hold} />
                      </div>
                      <div className="mt-1 truncate text-[15px] font-medium text-ink">{p.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                        <span>{p.company_id ? companyName.get(p.company_id) ?? '—' : 'Firma yok'}</span>
                        <span>{CATEGORY_LABEL[p.category]}</span>
                        {p.due_date && (
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" aria-hidden="true" />
                            <DueLabel due={p.due_date} active={isActiveStage(p.stage)} />
                          </span>
                        )}
                        <ProgressBar value={p.progress} className="w-28" label={`${p.code} ilerleme`} />
                        {p.location && (
                          <span className="inline-flex max-w-full items-center gap-1 truncate">
                            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                            {p.location}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="mt-6 h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <ProjectForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={(p) => navigate(`/projeler/${p.id}`)} />
    </>
  )
}
