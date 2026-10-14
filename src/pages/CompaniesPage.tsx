import { useEffect, useMemo, useState } from 'react'
import { Building2, ChevronRight, Mail, MapPin, Phone, Plus } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { ErrorState, SkeletonRows } from '@/components/ui/States'
import { SearchInput } from '@/components/ui/Toolbar'
import { useData } from '@/context/data'
import { CompanyForm } from '@/features/companies/CompanyForm'
import { isActiveStage } from '@/lib/domain'
import { matchesSearch } from '@/lib/stats'

export function CompaniesPage() {
  const { companies, projects, loading, error, refresh } = useData()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [formOpen, setFormOpen] = useState(false)
  const [q, setQ] = useState(() => params.get('q') ?? '')
  useEffect(() => setParams(q ? { q } : {}, { replace: true }), [q, setParams])

  const projectCounts = useMemo(() => {
    const m = new Map<string, { total: number; active: number }>()
    for (const p of projects) {
      if (!p.company_id) continue
      const e = m.get(p.company_id) ?? { total: 0, active: 0 }
      e.total++
      if (isActiveStage(p.stage)) e.active++
      m.set(p.company_id, e)
    }
    return m
  }, [projects])

  const filtered = useMemo(
    () => companies.filter((c) => matchesSearch(q, c.name, c.city, c.email, c.phone, c.tax_number)),
    [companies, q],
  )

  return (
    <>
      <PageHeader
        icon={Building2}
        code="M05"
        eyebrow="Ticari"
        title="Firmalar"
        description="Müşteri ve iş ortağı kayıtları, ilgili kişileri ve proje geçmişiyle birlikte."
        status="ready"
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setFormOpen(true)}>
            Firma ekle
          </Button>
        }
      />

      <div className="mb-4">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Firma adı, şehir, e-posta, telefon veya vergi no ara…"
          label="Firmalarda ara"
        />
      </div>

      <section className="card overflow-hidden" aria-label="Firma listesi">
        <div className="border-b border-line px-4 py-3 text-xs text-muted">
          <b className="font-semibold text-ink">{filtered.length}</b> firma{q ? ` (toplam ${companies.length})` : ''}
        </div>
        {loading && !companies.length ? (
          <SkeletonRows />
        ) : error && !companies.length ? (
          <ErrorState message={error} onRetry={() => void refresh()} />
        ) : companies.length === 0 ? (
          <EmptyState icon={Building2} title="Henüz firma yok" description="Müşteri veya iş ortağı firmalarınızı ekleyerek başlayın.">
            <Button variant="primary" icon={Plus} onClick={() => setFormOpen(true)}>
              Firma ekle
            </Button>
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Building2} title="Eşleşen firma yok" description="Farklı bir arama deneyin." />
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((c) => {
              const counts = projectCounts.get(c.id)
              return (
                <li key={c.id}>
                  <Link to={`/firmalar/${c.id}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2/70 active:bg-surface-2 sm:gap-4">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-sm font-semibold text-ink-2">
                      {c.name.trim().charAt(0).toLocaleUpperCase('tr-TR')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium text-ink">{c.name}</div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                        {c.city && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" aria-hidden="true" />
                            {c.city}
                          </span>
                        )}
                        {c.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3" aria-hidden="true" />
                            {c.phone}
                          </span>
                        )}
                        {c.email && (
                          <span className="hidden items-center gap-1 sm:inline-flex">
                            <Mail className="h-3 w-3" aria-hidden="true" />
                            {c.email}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="hidden shrink-0 text-right text-xs sm:block">
                      <div className="font-medium text-ink">{counts?.total ?? 0} proje</div>
                      <div className="text-subtle">{counts?.active ?? 0} aktif</div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <CompanyForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={(c) => navigate(`/firmalar/${c.id}`)} />
    </>
  )
}
