import { ArrowLeft, Building2, CopyPlus, FileText, FolderKanban, FolderPlus, GitBranch, History, ListPlus, Lock, Ruler, Save, Trash2, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Panel } from '@/components/ui/Panel'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { FilterSelect } from '@/components/ui/Toolbar'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { ConflictError, listContacts } from '@/data/api'
import { copyQuote, createQuoteItems, deleteQuote, deleteQuoteItems, getQuote, listQuoteHistory, listQuoteItems, listQuoteRevisions, updateQuote, updateQuoteItem } from '@/data/quoteApi'
import type { Contact } from '@/data/types'
import { ProjectForm } from '@/features/projects/ProjectForm'
import { calcParams, draftEquals, type DraftErrors, parseDraft, type QuoteDraft, toDraft } from '@/features/quotes/draft'
import { MetrajImportDialog } from '@/features/quotes/MetrajImportDialog'
import { QuoteInfoPanel, QuotePricingPanel } from '@/features/quotes/QuoteEditor'
import { QuoteExportButtons } from '@/features/quotes/QuoteExportButtons'
import { QuoteItemForm } from '@/features/quotes/QuoteItemForm'
import { QuoteItemsTable } from '@/features/quotes/QuoteItemsTable'
import { QuoteTotalsCard } from '@/features/quotes/QuoteTotalsCard'
import { QuoteStatusBadge, useQuoteSettings } from '@/features/quotes/shared'
import { dataErrorMessage } from '@/lib/errors'
import { formatDate, formatDateTime } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useUnsavedChanges } from '@/lib/unsaved'
import { useLiveList } from '@/lib/useLiveList'
import { computeQuote, itemInputOf } from '@/quote/engine'
import { formatMoney } from '@/quote/money'
import { isEditable, type Quote, type QuoteHistoryEntry, type QuoteItem, QUOTE_STATUS_LABEL, QUOTE_STATUSES, type QuoteStatus } from '@/quote/types'

const db = () => requireSupabase()
const ACTION_LABEL = { olustur: 'Oluşturuldu', durum: 'Durum değişti', revizyon: 'Revizyon oluşturuldu', kopya: 'Kopyadan oluşturuldu' } as const

export function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { notify } = useToast()
  const { companies, projects } = useData()
  const { values: settings } = useQuoteSettings()

  const quoteQ = useLiveList<Quote>('quotes', 'id', id, async (qid) => {
    const q = await getQuote(db(), qid)
    return q ? [q] : []
  })
  const quote = quoteQ.items[0] ?? null
  const itemsQ = useLiveList<QuoteItem>('quote_items', 'quote_id', id, (qid) => listQuoteItems(db(), qid))
  const revisionsQ = useLiveList<Quote>('quotes', 'root_id', quote?.root_id, (r) => listQuoteRevisions(db(), r))
  const historyQ = useLiveList<QuoteHistoryEntry>('quote_history', 'root_id', quote?.root_id, (r) => listQuoteHistory(db(), r))
  const items = useMemo(() => [...itemsQ.items].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)), [itemsQ.items])

  // ---------------------------------------------------------------- taslak (bilgiler + fiyatlandırma)
  const [base, setBase] = useState<{ id: string; version: number; draft: QuoteDraft } | null>(null)
  const [draft, setDraft] = useState<QuoteDraft | null>(null)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [saving, setSaving] = useState(false)
  const dirty = !!draft && !!base && base.id === quote?.id && !draftEquals(draft, base.draft)
  const changedElsewhere = !!quote && !!base && quote.version > base.version && dirty
  useUnsavedChanges(dirty, `Teklif ${quote?.quote_no ?? ''}`)

  // Kayıtlı teklif değiştiğinde (bu cihaz veya başka cihaz) taslak, kaydedilmemiş değişiklik yoksa yenilenir
  useEffect(() => {
    if (!quote) return
    if (!base || base.id !== quote.id || (!dirty && quote.version !== base.version)) {
      const d = toDraft(quote)
      setBase({ id: quote.id, version: quote.version, draft: d })
      setDraft(d)
      setErrors({})
    }
  }, [quote?.id, quote?.version])

  const onDraft = useCallback((patch: Partial<QuoteDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d)), [])

  const save = async (overwrite = false) => {
    if (!quote || !draft || !base) return
    const p = parseDraft(draft)
    if (!p.ok) {
      setErrors(p.errors)
      notify('Kaydedilemedi: işaretli alanları düzeltin.', 'error')
      return
    }
    setErrors({})
    setSaving(true)
    try {
      const saved = await updateQuote(db(), { id: quote.id, version: overwrite ? quote.version : base.version }, p.patch)
      const d = toDraft(saved)
      setBase({ id: saved.id, version: saved.version, draft: d })
      setDraft(d)
      quoteQ.setItems([saved])
      notify('Teklif kaydedildi.')
    } catch (e) {
      notify(e instanceof ConflictError ? 'Teklif başka bir cihazda değiştirildi. Değişikliklerinizi uygulamak için "Benimkini kaydet" veya güncel hâli için "Vazgeç" seçin.' : dataErrorMessage(e, 'Kaydetme'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    if (!quote) return
    const d = toDraft(quote)
    setBase({ id: quote.id, version: quote.version, draft: d })
    setDraft(d)
    setErrors({})
  }

  // ---------------------------------------------------------------- türetilmiş
  const params = quote ? calcParams(quote, draft) : null
  const totals = useMemo(() => (params ? computeQuote(params, items) : null), [params, items])
  const customer = companies.find((c) => c.id === quote?.company_id) ?? null
  const project = projects.find((p) => p.id === quote?.project_id) ?? null
  const [contacts, setContacts] = useState<Contact[]>([])
  useEffect(() => {
    if (!quote?.company_id) return
    listContacts(db(), quote.company_id)
      .then(setContacts)
      .catch(() => setContacts([]))
  }, [quote?.company_id])
  const contact = contacts.find((c) => c.id === quote?.contact_id) ?? null
  const editable = !!quote && isEditable(quote)
  const latest = revisionsQ.items[0]

  // ---------------------------------------------------------------- işlemler
  const [busy, setBusy] = useState(false)
  const [itemForm, setItemForm] = useState<{ open: boolean; item: QuoteItem | null }>({ open: false, item: null })
  const [importOpen, setImportOpen] = useState(false)
  const [confirm, setConfirm] = useState<null | { kind: 'deleteItem'; item: QuoteItem } | { kind: 'deleteQuote' } | { kind: 'status'; status: QuoteStatus }>(null)
  const [projectFormOpen, setProjectFormOpen] = useState(false)

  const guard = async (fn: () => Promise<void>, ctx: string) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      notify(dataErrorMessage(e, ctx), 'error')
    } finally {
      setBusy(false)
    }
  }

  const setStatus = (status: QuoteStatus) =>
    guard(async () => {
      if (!quote) return
      const saved = await updateQuote(db(), quote, { status })
      quoteQ.setItems([saved])
      notify(`Durum: ${QUOTE_STATUS_LABEL[status]}`)
    }, 'Durum değiştirme')

  const requestStatus = (status: QuoteStatus) => {
    if (!quote || status === quote.status) return
    if (dirty) {
      notify('Önce kaydedilmemiş değişiklikleri kaydedin.', 'error')
      return
    }
    if (quote.status === 'taslak') setConfirm({ kind: 'status', status })
    else void setStatus(status)
  }

  const copy = (mode: 'revizyon' | 'kopya') =>
    guard(async () => {
      if (!quote) return
      if (dirty) {
        notify('Önce kaydedilmemiş değişiklikleri kaydedin.', 'error')
        return
      }
      const newId = await copyQuote(db(), quote.id, mode)
      notify(mode === 'revizyon' ? `Rev ${(latest?.revision ?? quote.revision) + 1} oluşturuldu; önceki revizyon kilitlendi.` : 'Teklif kopyalandı (yeni numara).')
      navigate(`/teklifler/${newId}`)
    }, mode === 'revizyon' ? 'Revizyon oluşturma' : 'Kopyalama')

  const removeQuote = () =>
    guard(async () => {
      if (!quote) return
      const prev = revisionsQ.items.find((r) => r.revision < quote.revision)
      await deleteQuote(db(), quote.id)
      notify('Teklif silindi.')
      navigate(prev ? `/teklifler/${prev.id}` : '/teklifler', { replace: true })
    }, 'Silme')

  const duplicateItem = (i: QuoteItem) =>
    guard(async () => {
      if (!quote) return
      const maxSort = items.reduce((m, x) => Math.max(m, x.sort_order), 0)
      await createQuoteItems(db(), quote.id, [{ ...itemInputOf(i), sort_order: maxSort + 1 }])
      await itemsQ.reload()
      notify('Kalem çoğaltıldı.')
    }, 'Çoğaltma')

  const removeItem = (i: QuoteItem) =>
    guard(async () => {
      await deleteQuoteItems(db(), [i.id])
      itemsQ.setItems((l) => l.filter((x) => x.id !== i.id))
      notify('Kalem silindi.')
    }, 'Silme')

  const moveItem = (i: QuoteItem, dir: -1 | 1) =>
    guard(async () => {
      const order = items.slice()
      const idx = order.findIndex((x) => x.id === i.id)
      const j = idx + dir
      if (j < 0 || j >= order.length) return
      ;[order[idx], order[j]] = [order[j], order[idx]]
      for (let k = 0; k < order.length; k++) {
        if (order[k].sort_order !== k) await updateQuoteItem(db(), order[k], { sort_order: k })
      }
      await itemsQ.reload()
    }, 'Sıralama')

  const linkProject = (projectId: string | null) =>
    guard(async () => {
      if (!quote) return
      const saved = await updateQuote(db(), quote, { project_id: projectId })
      quoteQ.setItems([saved])
      notify(projectId ? 'Proje bağlandı.' : 'Proje bağlantısı kaldırıldı.')
    }, 'Proje bağlama')

  // ---------------------------------------------------------------- görünüm
  if (quoteQ.loading && !quote) return <LoadingState />
  if (quoteQ.error && !quote) return <ErrorState message={quoteQ.error} onRetry={() => void quoteQ.reload()} />
  if (!quote || !draft || !totals || !params) {
    return (
      <EmptyState icon={FileText} title="Teklif bulunamadı" description="Bu teklif silinmiş veya adres hatalı olabilir.">
        <Link to="/teklifler" className="text-sm font-semibold text-ink underline underline-offset-4">
          Tekliflere dön
        </Link>
      </EmptyState>
    )
  }
  const companyProjects = projects.filter((p) => p.company_id === quote.company_id || p.id === quote.project_id)
  const detailed = params.pricing_mode === 'detayli'

  return (
    <div className="pb-24">
      <Link to="/teklifler" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Teklifler
      </Link>

      <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-semibold text-ink-2" data-testid="quote-no">
              {quote.quote_no} · Rev {quote.revision}
            </span>
            <QuoteStatusBadge status={quote.status} superseded={quote.superseded} />
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight break-words text-ink sm:text-[28px]">{quote.title}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="h-4 w-4" aria-hidden="true" />
              {customer ? (
                <Link to={`/firmalar/${customer.id}`} className="text-ink-2 hover:underline">
                  {customer.name}
                </Link>
              ) : (
                '—'
              )}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FolderKanban className="h-4 w-4" aria-hidden="true" />
              {project ? (
                <Link to={`/projeler/${project.id}`} className="text-ink-2 hover:underline" data-testid="quote-project-link">
                  {project.code} · {project.name}
                </Link>
              ) : (
                'Projesiz'
              )}
            </span>
            <span>
              {formatDate(quote.quote_date)}
              {quote.valid_until ? ` · geçerlilik ${formatDate(quote.valid_until)}` : ''}
            </span>
            <span className="font-mono font-semibold text-ink" data-testid="quote-grand">
              {formatMoney(totals.grandTotal, draft.currency)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!quote.superseded && (
            <FilterSelect value={quote.status} onChange={(v) => requestStatus(v as QuoteStatus)} label="Teklif durumu" className="w-44">
              {QUOTE_STATUSES.filter((s) => quote.status === 'taslak' || s.value !== 'taslak').map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </FilterSelect>
          )}
          <QuoteExportButtons quote={quote} items={items} customer={customer} contact={contact} project={project} settings={settings} dirty={dirty} />
        </div>
      </header>

      <div className="mb-5 flex flex-wrap gap-2">
        {!quote.superseded && (
          <Button icon={GitBranch} onClick={() => void copy('revizyon')} disabled={busy} data-testid="quote-revise">
            Revizyon oluştur
          </Button>
        )}
        <Button icon={CopyPlus} onClick={() => void copy('kopya')} disabled={busy} data-testid="quote-copy">
          Kopyala
        </Button>
        {project ? null : (
          <Button icon={FolderPlus} onClick={() => setProjectFormOpen(true)} disabled={busy} data-testid="quote-create-project">
            Tekliften proje oluştur
          </Button>
        )}
        {editable && (
          <Button variant="ghost" icon={Trash2} onClick={() => setConfirm({ kind: 'deleteQuote' })} disabled={busy} className="hover:text-danger" data-testid="quote-delete">
            Sil
          </Button>
        )}
      </div>

      {quote.superseded ? (
        <p className="mb-5 flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2" data-testid="quote-superseded">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Bu eski bir revizyondur ve geçmiş olarak saklanır; değiştirilemez.{' '}
            {latest && latest.id !== quote.id && (
              <Link to={`/teklifler/${latest.id}`} className="font-semibold underline underline-offset-2">
                Güncel revizyon: Rev {latest.revision}
              </Link>
            )}
          </span>
        </p>
      ) : !editable ? (
        <p className="mb-5 flex items-start gap-2 rounded-xl border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn" data-testid="quote-locked">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {QUOTE_STATUS_LABEL[quote.status]} teklifin içeriği kilitlidir. Değişiklik için "Revizyon oluştur" kullanın; durum ve iç not güncellenebilir.
        </p>
      ) : null}
      {changedElsewhere && (
        <p className="mb-5 rounded-xl border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn" role="alert">
          Bu teklif siz düzenlerken başka bir cihazda güncellendi. Kaydederseniz sizin değişiklikleriniz geçerli olur; vazgeçerseniz güncel hâl yüklenir.
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Panel
            title={`Kalemler (${items.length})`}
            subtitle={detailed ? 'Poz, ölçü, miktar ve fiyat' : 'Toplam bedelli teklif: kalemler fiyatsız listelenir'}
            icon={ListPlus}
            bodyClassName="p-0"
            actions={
              editable ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" icon={Ruler} onClick={() => setImportOpen(true)} data-testid="quote-import">
                    Metrajdan aktar
                  </Button>
                  <Button variant="primary" icon={ListPlus} onClick={() => setItemForm({ open: true, item: null })} data-testid="quote-add-item">
                    Kalem ekle
                  </Button>
                </div>
              ) : undefined
            }
          >
            {itemsQ.loading && !items.length ? (
              <LoadingState />
            ) : items.length === 0 ? (
              <EmptyState icon={ListPlus} title="Henüz kalem yok" description="Elle kalem ekleyin veya projenin CAD metrajından pozları aktarın." />
            ) : (
              <QuoteItemsTable
                items={items}
                calcs={totals.items}
                currency={draft.currency}
                detailed={detailed}
                editable={editable}
                busy={busy}
                onEdit={(i) => setItemForm({ open: true, item: i })}
                onDuplicate={(i) => void duplicateItem(i)}
                onDelete={(i) => setConfirm({ kind: 'deleteItem', item: i })}
                onMove={(i, d) => void moveItem(i, d)}
              />
            )}
          </Panel>

          <Panel title="Proje bağlantısı" subtitle="Teklif bir projeye bağlanabilir; durumdan bağımsız değiştirilebilir" icon={FolderKanban}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <FilterSelect value={quote.project_id ?? ''} onChange={(v) => void linkProject(v || null)} label="Bağlı proje" className="sm:flex-1">
                <option value="">Projesiz</option>
                {companyProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </FilterSelect>
              {project && (
                <Link to={`/projeler/${project.id}`} className="inline-flex h-10 items-center rounded-xl border border-line px-3.5 text-sm font-semibold text-ink hover:bg-surface-2">
                  Projeye git
                </Link>
              )}
            </div>
          </Panel>

          <QuoteInfoPanel draft={draft} errors={errors} locked={!editable} companyId={quote.company_id} onChange={onDraft} />
        </div>

        <aside className="min-w-0 space-y-5">
          <QuoteTotalsCard t={totals} currency={draft.currency} otherLabel={draft.other_label} detailed={detailed} />
          <QuotePricingPanel draft={draft} errors={errors} locked={!editable} onChange={onDraft} />
          <Panel title="Revizyonlar ve geçmiş" icon={History}>
            <ul className="space-y-1.5 text-[13px]" data-testid="quote-revisions">
              {revisionsQ.items.map((r) => (
                <li key={r.id}>
                  <Link to={`/teklifler/${r.id}`} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${r.id === quote.id ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-2 hover:bg-surface-2'}`}>
                    <span>
                      Rev {r.revision} · {formatDate(r.quote_date)}
                    </span>
                    <QuoteStatusBadge status={r.status} superseded={r.superseded} />
                  </Link>
                </li>
              ))}
            </ul>
            <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[12px] text-muted">
              {historyQ.items.slice(0, 20).map((h) => (
                <li key={h.id}>
                  {formatDateTime(h.changed_at)} · {ACTION_LABEL[h.action]}
                  {h.action === 'durum' && h.from_status && h.to_status ? `: ${QUOTE_STATUS_LABEL[h.from_status]} → ${QUOTE_STATUS_LABEL[h.to_status]}` : ''}
                  {h.note ? ` (${h.note})` : ''}
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>

      {dirty && (
        <div className="fixed inset-x-3 bottom-[calc(84px+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface px-4 py-3 shadow-raised md:bottom-5" data-testid="quote-savebar">
          <span className="text-sm text-ink-2">Kaydedilmemiş değişiklikler</span>
          <div className="flex gap-2">
            <Button variant="ghost" icon={Undo2} onClick={discard} disabled={saving}>
              Vazgeç
            </Button>
            {changedElsewhere && (
              <Button variant="secondary" onClick={() => void save(true)} disabled={saving}>
                Benimkini kaydet
              </Button>
            )}
            <Button variant="primary" icon={Save} onClick={() => void save()} disabled={saving} data-testid="quote-save">
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          </div>
        </div>
      )}

      <QuoteItemForm
        open={itemForm.open}
        onClose={() => setItemForm({ open: false, item: null })}
        quote={quote}
        params={params}
        item={itemForm.item}
        nextSort={items.reduce((m, x) => Math.max(m, x.sort_order), 0) + 1}
        onSaved={() => void itemsQ.reload()}
      />
      <MetrajImportDialog open={importOpen} onClose={() => setImportOpen(false)} quote={quote} existing={items} onImported={() => void itemsQ.reload()} />
      <ProjectForm
        open={projectFormOpen}
        onClose={() => setProjectFormOpen(false)}
        defaultCompanyId={quote.company_id}
        defaultName={quote.title}
        onSaved={(p) => {
          setProjectFormOpen(false)
          void linkProject(p.id)
        }}
      />
      <ConfirmDialog
        open={!!confirm}
        busy={busy}
        title={confirm?.kind === 'deleteQuote' ? 'Teklif silinsin mi?' : confirm?.kind === 'deleteItem' ? 'Kalem silinsin mi?' : `Durum: ${confirm?.kind === 'status' ? QUOTE_STATUS_LABEL[confirm.status] : ''}`}
        message={
          confirm?.kind === 'deleteQuote'
            ? `${quote.quote_no} Rev ${quote.revision} ve tüm kalemleri kalıcı olarak silinir.${quote.revision > 1 ? ' Önceki revizyon yeniden güncel olur.' : ''}`
            : confirm?.kind === 'deleteItem'
              ? `"${confirm.item.poz_code ?? confirm.item.description}" kalemi silinir.`
              : 'Taslak dışındaki teklifin içeriği ve kalemleri kilitlenir; değişiklik için revizyon oluşturulur. Devam edilsin mi?'
        }
        confirmLabel={confirm?.kind === 'status' ? 'Onayla' : 'Sil'}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm
          setConfirm(null)
          if (!c) return
          if (c.kind === 'deleteQuote') void removeQuote()
          else if (c.kind === 'deleteItem') void removeItem(c.item)
          else void setStatus(c.status)
        }}
      />
    </div>
  )
}
