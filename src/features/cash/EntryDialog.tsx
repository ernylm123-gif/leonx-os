import { ArrowDownLeft, ArrowUpRight, Paperclip } from 'lucide-react'
import { type FormEvent, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormAlert, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { createEntry, updateEntry, uploadDocument } from '@/data/cashApi'
import { createCollection, createExpense } from '@/data/financeApi'
import { centsToInput, parseAmount } from '@/features/finance/shared'
import type { EntryKind, EntryStatus, FinanceAccount, FinanceCategory, FinanceEntry } from '@/finance/cash'
import { COST_GROUPS, type CostGroup, type PaymentMethod, PAYMENT_METHODS } from '@/finance/types'
import { cn } from '@/lib/cn'
import { localISODate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useFormDirty } from '@/lib/unsaved'
import { useResetOnOpen } from '@/lib/useResetOnOpen'
import { toCents } from '@/quote/money'
import { CURRENCIES, type Currency } from '@/quote/types'
import { AccountSelect, CategorySelect, cashErrorMessage, validateDocument } from './shared'

type Errors = Record<string, string>

interface Props {
  open: boolean
  onClose: () => void
  accounts: readonly FinanceAccount[]
  categories: readonly FinanceCategory[]
  /** Düzenlenecek genel kayıt (yoksa yeni kayıt) */
  entry?: FinanceEntry | null
  /** Yeni kayıt için varsayılan tür / hesap */
  defaultKind?: EntryKind
  defaultAccountId?: string
  /** Bekleyen kaydı "gerçekleşti" olarak açar (ödendi / tahsil edildi işaretleme) */
  realize?: boolean
  onSaved?: () => void
}

/**
 * Hızlı gelir/gider girişi (telefonda tek elle kullanım: büyük dokunma alanları, az zorunlu alan).
 * Proje seçilirse kayıt mevcut proje tablolarına yazılır (gelir → project_collections, gider → project_expenses);
 * seçilmezse genel kayıt (finance_entries) olur. Aynı hareket iki tabloya yazılmaz.
 */
export function EntryDialog({ open, onClose, accounts, categories, entry, defaultKind = 'gider', defaultAccountId, realize, onSaved }: Props) {
  const { projects, companies } = useData()
  const { notify } = useToast()
  const editing = !!entry
  const empty = {
    kind: defaultKind as EntryKind,
    amount: '',
    vat: '',
    date: localISODate(),
    accountId: defaultAccountId ?? '',
    currency: 'TRY' as Currency,
    categoryId: '',
    description: '',
    projectId: '',
    companyId: '',
    method: '' as PaymentMethod | '',
    doc: '',
    status: 'gerceklesti' as EntryStatus,
    due: '',
    group: 'diger' as CostGroup,
    supplier: '',
    notes: '',
  }
  const [d, setD] = useState(empty)
  const [errors, setErrors] = useState<Errors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draftId, setDraftId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const { markDirty } = useFormDirty(open, 'Gelir / gider formu')

  // Açılışta formu render sırasında sıfırla (effect ile sıfırlamak, açılır açılmaz yazılanları/hataları ezebilir)
  useResetOnOpen(
    open,
    () => {
      setErrors({})
      setError(null)
      setFile(null)
      setDraftId(crypto.randomUUID())
      if (entry) {
        setD({
          ...empty,
          kind: entry.kind,
          amount: centsToInput(toCents(entry.amount)),
          vat: entry.vat_amount ? centsToInput(toCents(entry.vat_amount)) : '',
          date: entry.entry_date,
          accountId: entry.account_id ?? '',
          currency: entry.currency,
          categoryId: entry.category_id,
          description: entry.description,
          companyId: entry.company_id ?? '',
          method: entry.payment_method ?? '',
          doc: entry.document_no ?? '',
          status: realize ? 'gerceklesti' : entry.status,
          due: entry.due_date ?? '',
          notes: entry.notes ?? '',
        })
      } else {
        const acc = accounts.find((a) => a.id === defaultAccountId && a.active)
        setD({ ...empty, accountId: acc?.id ?? '', currency: acc?.currency ?? 'TRY' })
      }
    },
    [entry, realize],
  )

  const account = accounts.find((a) => a.id === d.accountId) ?? null
  const project = projects.find((p) => p.id === d.projectId) ?? null
  const projectIncome = !!project && d.kind === 'gelir'
  // Proje tahsilatı her zaman gerçekleşmiştir (bekleyen proje alacağı ödeme planında izlenir)
  const status: EntryStatus = projectIncome ? 'gerceklesti' : d.status
  const realized = status === 'gerceklesti'
  const activeProjects = useMemo(() => [...projects].filter((p) => p.stage !== 'iptal' || p.id === d.projectId).sort((a, b) => a.code.localeCompare(b.code, 'tr')), [projects, d.projectId])
  const amountNum = parseAmount(d.amount)

  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((x) => ({ ...x, [k]: v }))

  const submit = async () => {
    const errs: Errors = {}
    const amount = parseAmount(d.amount)
    const vat = projectIncome ? 0 : parseAmount(d.vat)
    if (amount == null || Number.isNaN(amount) || amount <= 0) errs.amount = 'Sıfırdan büyük tutar girin.'
    if (Number.isNaN(vat)) errs.vat = 'Geçerli bir tutar girin.'
    if (!d.date) errs.date = 'Tarih zorunludur.'
    if (!d.description.trim()) errs.description = 'Açıklama zorunludur.'
    if (realized && !d.accountId) errs.accountId = d.kind === 'gelir' ? 'Paranın girdiği kasa/banka hesabını seçin.' : 'Paranın çıktığı kasa/banka hesabını seçin.'
    if (account && account.currency !== d.currency) errs.accountId = `Hesap ${account.currency}; kayıt ${d.currency}. Aynı para biriminde hesap seçin.`
    if (!project && !d.categoryId) errs.categoryId = 'Kategori seçin.'
    if (file) {
      const fe = validateDocument(file)
      if (fe) errs.file = fe
    }
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setError(null)
    const db = requireSupabase()
    try {
      let saved: { table: 'finance_entries' | 'project_expenses' | 'project_collections'; id: string }
      if (project && !editing) {
        if (d.kind === 'gelir') {
          const c = await createCollection(db, {
            id: draftId,
            project_id: project.id,
            received_date: d.date,
            amount: amount!,
            currency: d.currency,
            method: d.method || (account?.kind === 'kasa' ? 'nakit' : 'havale'),
            schedule_id: null,
            reference: d.doc.trim() || null,
            note: d.description.trim().slice(0, 2000),
            account_id: d.accountId || null,
            category_id: d.categoryId || null,
          })
          saved = { table: 'project_collections', id: c.id }
        } else {
          const x = await createExpense(db, {
            id: draftId,
            project_id: project.id,
            expense_date: d.date,
            cost_group: d.group,
            description: d.description.trim().slice(0, 500),
            supplier: d.supplier.trim() || null,
            amount: amount!,
            vat_amount: vat ?? 0,
            currency: d.currency,
            fx_rate_to_base: null,
            fx_to_currency: null,
            document_no: d.doc.trim() || null,
            paid: realized,
            notes: d.notes.trim() || null,
            account_id: realized ? d.accountId || null : null,
            category_id: d.categoryId || null,
            payment_method: d.method || null,
          })
          saved = { table: 'project_expenses', id: x.id }
        }
      } else {
        const input = {
          kind: d.kind,
          entry_date: d.date,
          amount: amount!,
          vat_amount: vat ?? 0,
          currency: d.currency,
          category_id: d.categoryId,
          account_id: d.accountId || null,
          status,
          due_date: status === 'bekliyor' ? d.due || null : null,
          payment_method: d.method || null,
          company_id: d.companyId || null,
          description: d.description.trim().slice(0, 500),
          document_no: d.doc.trim() || null,
          notes: d.notes.trim() || null,
        }
        const e = entry ? await updateEntry(db, entry, input) : await createEntry(db, { ...input, id: draftId })
        saved = { table: 'finance_entries', id: e.id }
      }
      if (file) {
        try {
          await uploadDocument(db, saved.table, saved.id, file)
        } catch (e) {
          notify(`Kayıt kaydedildi ancak belge yüklenemedi: ${cashErrorMessage(e, 'Belge yükleme')}`, 'error')
        }
      }
      notify(editing ? 'Kayıt güncellendi.' : project ? (d.kind === 'gelir' ? 'Proje tahsilatı kaydedildi.' : 'Proje gideri kaydedildi.') : d.kind === 'gelir' ? 'Gelir kaydedildi.' : 'Gider kaydedildi.')
      onSaved?.()
      onClose()
    } catch (e) {
      setError(cashErrorMessage(e, 'Kayıt'))
    } finally {
      setBusy(false)
    }
  }

  const kindBtn = (k: EntryKind) => (
    <button
      type="button"
      role="radio"
      aria-checked={d.kind === k}
      onClick={() => setD((x) => ({ ...x, kind: k, categoryId: '' }))}
      className={cn(
        'flex h-12 items-center justify-center gap-2 rounded-xl border text-[15px] font-semibold transition-colors',
        d.kind === k ? (k === 'gelir' ? 'border-ok/40 bg-ok-soft text-ok' : 'border-danger/40 bg-danger-soft text-danger') : 'border-line bg-surface text-muted hover:text-ink',
      )}
      data-testid={`qa-kind-${k}`}
    >
      {k === 'gelir' ? <ArrowDownLeft className="h-4 w-4" aria-hidden="true" /> : <ArrowUpRight className="h-4 w-4" aria-hidden="true" />}
      {k === 'gelir' ? 'Gelir' : 'Gider'}
    </button>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title={editing ? 'Kaydı düzenle' : 'Gelir / gider ekle'}
      description={project ? (d.kind === 'gelir' ? 'Projeye bağlı: proje tahsilatı olarak kaydedilir.' : 'Projeye bağlı: proje gideri olarak kaydedilir.') : 'Projesiz genel işletme kaydı. Tutar KDV hariç, KDV ayrı.'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="entry-form" disabled={busy} data-testid="entry-form-submit" className="h-11">
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      {error && <FormAlert>{error}</FormAlert>}
      <form
        id="entry-form"
        onChangeCapture={markDirty}
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          void submit()
        }}
        noValidate
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <div role="radiogroup" aria-label="Tür" className="grid grid-cols-2 gap-2 sm:col-span-2">
          {kindBtn('gelir')}
          {kindBtn('gider')}
        </div>
        <TextField
          label={projectIncome ? 'Tahsil edilen tutar' : 'Tutar (KDV hariç)'}
          required
          inputMode="decimal"
          value={d.amount}
          onChange={(e) => set('amount', e.target.value)}
          error={errors.amount}
          data-testid="qa-amount"
          className="text-lg"
        />
        <TextField label="Tarih" type="date" required value={d.date} onChange={(e) => set('date', e.target.value)} error={errors.date} data-testid="qa-date" />
        {!editing && (
          <SelectField label="Proje (isteğe bağlı)" value={d.projectId} onChange={(e) => set('projectId', e.target.value)} data-testid="qa-project" className="sm:col-span-2">
            <option value="">Projesiz (genel işletme)</option>
            {activeProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </SelectField>
        )}
        {!projectIncome && (
          <div role="radiogroup" aria-label="Durum" className="grid grid-cols-2 gap-2 sm:col-span-2">
            {(['gerceklesti', 'bekliyor'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={d.status === s}
                onClick={() => set('status', s)}
                className={cn('h-11 rounded-xl border text-sm font-medium', d.status === s ? 'border-titanium bg-surface-2 text-ink' : 'border-line bg-surface text-muted')}
                data-testid={`qa-status-${s}`}
              >
                {s === 'gerceklesti' ? (d.kind === 'gelir' ? 'Tahsil edildi' : 'Ödendi') : d.kind === 'gelir' ? 'Tahsil edilecek' : 'Ödenecek'}
              </button>
            ))}
          </div>
        )}
        <AccountSelect
          accounts={accounts}
          value={d.accountId}
          onChange={(id) => {
            const a = accounts.find((x) => x.id === id)
            setD((x) => ({ ...x, accountId: id, currency: a?.currency ?? x.currency }))
          }}
          label={d.kind === 'gelir' ? 'Giren hesap' : 'Çıkan hesap'}
          required={realized}
          noneLabel={realized ? 'Hesap seçin' : 'Henüz yok'}
          error={errors.accountId}
          hint={!realized ? 'Bekleyen kayıt hiçbir bakiyeyi etkilemez.' : accounts.length === 0 ? 'Önce “Kasa & Banka” bölümünden hesap ekleyin.' : undefined}
          testId="qa-account"
        />
        <SelectField label="Para birimi" value={d.currency} onChange={(e) => set('currency', e.target.value as Currency)} disabled={!!account} hint={account ? 'Hesabın para birimi' : undefined} data-testid="qa-currency">
          {CURRENCIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </SelectField>
        <CategorySelect
          categories={categories}
          kind={d.kind}
          value={d.categoryId}
          onChange={(id) => set('categoryId', id)}
          required={!project}
          noneLabel={project ? 'Kategorisiz' : 'Kategori seçin'}
          error={errors.categoryId}
          testId="qa-category"
        />
        {project && d.kind === 'gider' ? (
          <SelectField label="Maliyet grubu" value={d.group} onChange={(e) => set('group', e.target.value as CostGroup)} data-testid="qa-group">
            {COST_GROUPS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </SelectField>
        ) : (
          <SelectField label="Ödeme yöntemi" value={d.method} onChange={(e) => set('method', e.target.value as PaymentMethod | '')}>
            <option value="">Belirtilmedi</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </SelectField>
        )}
        <TextField label="Açıklama" required value={d.description} onChange={(e) => set('description', e.target.value)} error={errors.description} maxLength={500} className="sm:col-span-2" data-testid="qa-description" />
        {!projectIncome && (
          <div className="min-w-0">
            <TextField label="KDV tutarı" inputMode="decimal" value={d.vat} onChange={(e) => set('vat', e.target.value)} error={errors.vat} data-testid="qa-vat" />
            <div className="mt-1.5 flex gap-1.5">
              {[20, 10, 1].map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={amountNum == null || Number.isNaN(amountNum)}
                  onClick={() => amountNum != null && set('vat', centsToInput(Math.round((toCents(amountNum) * p) / 100)))}
                  className="h-8 rounded-full border border-line bg-surface-2 px-3 text-[12px] text-ink-2 hover:bg-surface-3 disabled:opacity-40"
                >
                  %{p}
                </button>
              ))}
            </div>
          </div>
        )}
        <TextField label={projectIncome ? 'Referans (dekont / çek no)' : 'Belge / fatura no'} value={d.doc} onChange={(e) => set('doc', e.target.value)} maxLength={80} />
        {status === 'bekliyor' && !project && <TextField label="Vade" type="date" value={d.due} onChange={(e) => set('due', e.target.value)} data-testid="qa-due" />}
        {project && d.kind === 'gider' && <TextField label="Tedarikçi" value={d.supplier} onChange={(e) => set('supplier', e.target.value)} maxLength={200} />}
        {project && d.kind === 'gider' && (
          <SelectField label="Ödeme yöntemi" value={d.method} onChange={(e) => set('method', e.target.value as PaymentMethod | '')}>
            <option value="">Belirtilmedi</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </SelectField>
        )}
        {!project && (
          <SelectField label="Firma (isteğe bağlı)" value={d.companyId} onChange={(e) => set('companyId', e.target.value)}>
            <option value="">—</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
        )}
        {!projectIncome && <TextAreaField label="Not" value={d.notes} onChange={(e) => set('notes', e.target.value)} className="sm:col-span-2" maxLength={2000} />}
        <div className="sm:col-span-2">
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
            className="sr-only"
            aria-label="Belge eki seç"
            data-testid="qa-file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Button variant="secondary" icon={Paperclip} onClick={() => fileInput.current?.click()} className="h-11">
            {file ? file.name : 'Fiş / fatura ekle'}
          </Button>
          {errors.file && <p className="mt-1.5 text-xs text-danger">{errors.file}</p>}
          <p className="mt-1 text-[11px] text-subtle">İsteğe bağlı · PDF veya fotoğraf · en fazla 15 MB</p>
        </div>
      </form>
    </Modal>
  )
}
