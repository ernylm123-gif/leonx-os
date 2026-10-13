import { type ReactNode, useMemo, useState } from 'react'
import { ArrowLeft, Building2, FolderKanban, FolderPlus, Info, Mail, Pencil, Phone, Plus, Star, Trash2, Users } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Panel } from '@/components/ui/Panel'
import { StatusBadge } from '@/components/ui/ProjectBadges'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { deleteCompany, deleteContact, listContacts } from '@/data/api'
import type { Contact } from '@/data/types'
import { CompanyForm } from '@/features/companies/CompanyForm'
import { ContactForm } from '@/features/companies/ContactForm'
import { ProjectForm } from '@/features/projects/ProjectForm'
import { RelatedQuotes } from '@/features/quotes/RelatedQuotes'
import { CATEGORY_LABEL } from '@/lib/domain'
import { dataErrorMessage } from '@/lib/errors'
import { formatDate, formatDateTime } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useLiveList } from '@/lib/useLiveList'

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-sm break-words text-ink">{children ?? <span className="text-subtle">—</span>}</dd>
    </div>
  )
}

export function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { notify } = useToast()
  const { companies, projects, loading, error, refresh, removeCompany } = useData()
  const company = companies.find((c) => c.id === id)
  const related = useMemo(() => projects.filter((p) => p.company_id === id), [projects, id])
  const contacts = useLiveList<Contact>('contacts', 'company_id', company?.id, (cid) => listContacts(requireSupabase(), cid))

  const [editOpen, setEditOpen] = useState(false)
  const [projectOpen, setProjectOpen] = useState(false)
  const [contactForm, setContactForm] = useState<{ open: boolean; contact?: Contact }>({ open: false })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [contactToDelete, setContactToDelete] = useState<Contact | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading && !company) return <LoadingState label="Firma yükleniyor…" />
  if (!company) {
    return error ? (
      <ErrorState message={error} onRetry={() => void refresh()} />
    ) : (
      <div className="card">
        <EmptyState icon={Building2} title="Firma bulunamadı" description="Bu firma silinmiş veya adres hatalı olabilir.">
          <Link to="/firmalar" className="text-sm font-medium text-ink underline underline-offset-4">
            Firmalara dön
          </Link>
        </EmptyState>
      </div>
    )
  }

  const removeCompanyNow = async () => {
    setBusy(true)
    try {
      await deleteCompany(requireSupabase(), company.id)
      removeCompany(company.id)
      notify('Firma silindi.')
      navigate('/firmalar', { replace: true })
    } catch (err) {
      notify(dataErrorMessage(err, 'Silme'), 'error')
      setBusy(false)
      setConfirmDelete(false)
    }
  }

  const removeContactNow = async () => {
    if (!contactToDelete) return
    setBusy(true)
    try {
      await deleteContact(requireSupabase(), contactToDelete.id)
      contacts.setItems((l) => l.filter((c) => c.id !== contactToDelete.id))
      notify('Kişi silindi.')
      setContactToDelete(null)
    } catch (err) {
      notify(dataErrorMessage(err, 'Silme'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onContactSaved = (c: Contact) =>
    contacts.setItems((l) => {
      const rest = l.filter((x) => x.id !== c.id)
      return [c, ...rest].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.full_name.localeCompare(b.full_name, 'tr'))
    })

  const canDelete = related.length === 0

  return (
    <>
      <Link to="/firmalar" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Firmalar
      </Link>
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="brushed grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-xl font-semibold text-anthracite">
            {company.name.trim().charAt(0).toLocaleUpperCase('tr-TR')}
          </span>
          <div className="min-w-0">
            <div className="font-mono text-[11px] text-subtle">FİRMA</div>
            <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.015em] break-words text-ink sm:text-[30px]">{company.name}</h1>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={Pencil} onClick={() => setEditOpen(true)}>
            Düzenle
          </Button>
          <Button variant="ghost" icon={Trash2} onClick={() => setConfirmDelete(true)} className="hover:!bg-danger-soft hover:!text-danger">
            Sil
          </Button>
        </div>
      </header>
      <div className="ruler mb-6 opacity-80" aria-hidden="true" />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <Panel title="Firma bilgileri" icon={Info}>
            <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Detail label="Telefon">{company.phone && <a href={`tel:${company.phone}`} className="hover:underline">{company.phone}</a>}</Detail>
              <Detail label="E-posta">{company.email && <a href={`mailto:${company.email}`} className="break-all hover:underline">{company.email}</a>}</Detail>
              <Detail label="Şehir">{company.city}</Detail>
              <Detail label="Adres">{company.address && <span className="whitespace-pre-wrap">{company.address}</span>}</Detail>
              <Detail label="Vergi dairesi">{company.tax_office}</Detail>
              <Detail label="Vergi / T.C. kimlik no">{company.tax_number && <span className="font-mono">{company.tax_number}</span>}</Detail>
              <div className="sm:col-span-2">
                <Detail label="Notlar">{company.notes && <span className="whitespace-pre-wrap">{company.notes}</span>}</Detail>
              </div>
            </dl>
            <p className="mt-5 border-t border-line pt-3 text-[11px] text-subtle">
              Oluşturuldu {formatDateTime(company.created_at)} · Güncellendi {formatDateTime(company.updated_at)} · Sürüm {company.version}
            </p>
          </Panel>

          <Panel
            title="Projeler"
            subtitle={`${related.length} proje`}
            icon={FolderKanban}
            actions={
              <Button variant="secondary" icon={FolderPlus} onClick={() => setProjectOpen(true)} className="h-9 px-3 text-xs">
                Proje ekle
              </Button>
            }
            bodyClassName="p-0"
          >
            {related.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-subtle">Bu firmaya bağlı proje yok.</p>
            ) : (
              <ul className="divide-y divide-line">
                {related.map((p) => (
                  <li key={p.id}>
                    <Link to={`/projeler/${p.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2/70">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[11px] text-subtle">{p.code}</div>
                        <div className="truncate text-sm font-medium text-ink">{p.name}</div>
                        <div className="text-xs text-muted">
                          {CATEGORY_LABEL[p.category]} · Teslim {formatDate(p.due_date)}
                        </div>
                      </div>
                      <StatusBadge status={p.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <RelatedQuotes by="company_id" id={company.id} />
        </div>

        <Panel
          title="İlgili kişiler"
          subtitle={`${contacts.items.length} kişi`}
          icon={Users}
          className="h-fit"
          actions={
            <Button variant="secondary" icon={Plus} onClick={() => setContactForm({ open: true })} className="h-9 px-3 text-xs">
              Ekle
            </Button>
          }
        >
          {contacts.loading ? (
            <LoadingState />
          ) : contacts.error ? (
            <ErrorState message={contacts.error} onRetry={() => void contacts.reload()} />
          ) : contacts.items.length === 0 ? (
            <p className="py-4 text-center text-sm text-subtle">Kayıtlı kişi yok.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {contacts.items.map((c) => (
                <li key={c.id} className="rounded-xl border border-line bg-surface-2/50 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <span className="truncate">{c.full_name}</span>
                        {c.is_primary && <Star className="h-3.5 w-3.5 shrink-0 fill-warn text-warn" aria-label="Birincil kişi" />}
                      </div>
                      {c.title && <div className="text-xs text-muted">{c.title}</div>}
                    </div>
                    <div className="flex shrink-0">
                      <button type="button" onClick={() => setContactForm({ open: true, contact: c })} className="grid h-8 w-8 place-items-center rounded-lg text-subtle hover:bg-surface-3 hover:text-ink" aria-label={`${c.full_name} düzenle`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => setContactToDelete(c)} className="grid h-8 w-8 place-items-center rounded-lg text-subtle hover:bg-danger-soft hover:text-danger" aria-label={`${c.full_name} sil`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-col gap-1 text-xs">
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 text-ink-2 hover:underline">
                        <Phone className="h-3 w-3" aria-hidden="true" />
                        {c.phone}
                      </a>
                    )}
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 break-all text-ink-2 hover:underline">
                        <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {c.email}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <CompanyForm open={editOpen} onClose={() => setEditOpen(false)} company={company} />
      <ProjectForm open={projectOpen} onClose={() => setProjectOpen(false)} defaultCompanyId={company.id} onSaved={(p) => navigate(`/projeler/${p.id}`)} />
      <ContactForm
        open={contactForm.open}
        onClose={() => setContactForm({ open: false })}
        companyId={company.id}
        contact={contactForm.contact}
        onSaved={onContactSaved}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={canDelete ? 'Firma silinsin mi?' : 'Firma silinemez'}
        message={
          canDelete
            ? `"${company.name}" ve ilgili kişileri kalıcı olarak silinecek. Bu işlem geri alınamaz.`
            : `Bu firmaya bağlı ${related.length} proje var. Veri kaybını önlemek için önce projeleri silin veya başka firmaya aktarın.`
        }
        confirmLabel={canDelete ? 'Firmayı sil' : 'Tamam'}
        busy={busy}
        onConfirm={() => (canDelete ? void removeCompanyNow() : setConfirmDelete(false))}
        onClose={() => setConfirmDelete(false)}
      />
      <ConfirmDialog
        open={!!contactToDelete}
        title="Kişi silinsin mi?"
        message={`"${contactToDelete?.full_name ?? ''}" kalıcı olarak silinecek.`}
        busy={busy}
        onConfirm={() => void removeContactNow()}
        onClose={() => setContactToDelete(null)}
      />
    </>
  )
}
