import { type FormEvent, type ReactNode, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormAlert, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useData } from '@/context/data'
import { useToast } from '@/context/toast'
import { createAccount, createCategory, createRecurring, createTransfer, updateAccount, updateCategory, updateRecurring } from '@/data/cashApi'
import { centsToInput, parseAmount } from '@/features/finance/shared'
import {
  ACCOUNT_KINDS,
  type AccountKind,
  type EntryKind,
  type FinanceAccount,
  type FinanceCategory,
  type FinanceRecurring,
  FREQUENCIES,
  type Frequency,
} from '@/finance/cash'
import { type PaymentMethod, PAYMENT_METHODS } from '@/finance/types'
import { localISODate } from '@/lib/stats'
import { requireSupabase } from '@/lib/supabase'
import { useFormDirty } from '@/lib/unsaved'
import { useResetOnOpen } from '@/lib/useResetOnOpen'
import { formatMoney, toCents } from '@/quote/money'
import { CURRENCIES, type Currency } from '@/quote/types'
import { AccountSelect, CategorySelect, cashErrorMessage } from './shared'

type Errors = Record<string, string>

/** Ortak form kabuğu: kaydetme, hata, kaydedilmemiş değişiklik uyarısı */
function CashFormModal({ open, onClose, title, description, formId, busy, error, submitLabel, onSubmit, children }: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  formId: string
  busy: boolean
  error: string | null
  submitLabel: string
  onSubmit: () => void
  children: ReactNode
}) {
  const { markDirty } = useFormDirty(open, title)
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={busy} data-testid={`${formId}-submit`}>
            {busy ? 'Kaydediliyor…' : submitLabel}
          </Button>
        </>
      }
    >
      {error && <FormAlert>{error}</FormAlert>}
      <form
        id={formId}
        onChangeCapture={markDirty}
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          onSubmit()
        }}
        noValidate
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        {children}
      </form>
    </Modal>
  )
}

function useSave(onClose: () => void, context: string) {
  const { notify } = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      notify(message)
      onClose()
    } catch (e) {
      setError(cashErrorMessage(e, context))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

function CurrencySelect({ value, onChange, disabled, hint, testId }: { value: Currency; onChange: (c: Currency) => void; disabled?: boolean; hint?: string; testId?: string }) {
  return (
    <SelectField label="Para birimi" value={value} onChange={(e) => onChange(e.target.value as Currency)} disabled={disabled} hint={hint} data-testid={testId}>
      {CURRENCIES.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </SelectField>
  )
}

// ================================================================== Hesap
export function AccountForm({ open, onClose, account, hasMovements }: { open: boolean; onClose: () => void; account: FinanceAccount | null; hasMovements: boolean }) {
  const empty = { name: '', kind: 'kasa' as AccountKind, currency: 'TRY' as Currency, opening: '', openingDate: localISODate(), bank: '', iban: '', notes: '', active: true }
  const [d, setD] = useState(empty)
  const [errors, setErrors] = useState<Errors>({})
  const [draftId, setDraftId] = useState('')
  const s = useSave(onClose, 'Hesap kaydı')
  useResetOnOpen(
    open,
    () => {
      setErrors({})
      s.setError(null)
      setDraftId(crypto.randomUUID())
      setD(
        account
          ? {
              name: account.name,
              kind: account.kind,
              currency: account.currency,
              opening: centsToInput(toCents(account.opening_balance)),
              openingDate: account.opening_date,
              bank: account.bank_name ?? '',
              iban: account.iban ?? '',
              notes: account.notes ?? '',
              active: account.active,
            }
          : empty,
      )
    },
    [account],
  )
  const submit = () => {
    const errs: Errors = {}
    const neg = d.opening.trim().startsWith('-')
    const opening = parseAmount(neg ? d.opening.trim().slice(1) : d.opening)
    const iban = d.iban.replace(/\s/g, '').toUpperCase()
    if (!d.name.trim()) errs.name = 'Hesap adı zorunludur.'
    if (Number.isNaN(opening)) errs.opening = 'Geçerli bir tutar girin (borç için başına - yazın).'
    if (iban && !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) errs.iban = 'IBAN geçersiz (ör. TR33 0006 1005 1978 6457 8413 26).'
    if (!d.openingDate) errs.openingDate = 'Tarih zorunludur.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const input = {
      name: d.name.trim().slice(0, 120),
      kind: d.kind,
      currency: d.currency,
      opening_balance: (neg ? -1 : 1) * (opening ?? 0),
      opening_date: d.openingDate,
      bank_name: d.kind === 'kasa' ? null : d.bank.trim() || null,
      iban: d.kind === 'kasa' ? null : iban || null,
      notes: d.notes.trim() || null,
      active: d.active,
      sort_order: account?.sort_order ?? 0,
    }
    const db = requireSupabase()
    void s.run(() => (account ? updateAccount(db, account, input) : createAccount(db, { ...input, id: draftId })), account ? 'Hesap güncellendi.' : 'Hesap eklendi.')
  }
  return (
    <CashFormModal open={open} onClose={onClose} title={account ? 'Hesabı düzenle' : 'Yeni hesap'} description="Bakiye = açılış bakiyesi + gerçekleşen girişler − çıkışlar." formId="account-form" busy={s.busy} error={s.error} submitLabel="Kaydet" onSubmit={submit}>
      <TextField label="Hesap adı" required value={d.name} onChange={(e) => setD((x) => ({ ...x, name: e.target.value }))} error={errors.name} maxLength={120} data-testid="acc-name" placeholder="ör. Merkez kasa" />
      <SelectField label="Tür" value={d.kind} onChange={(e) => setD((x) => ({ ...x, kind: e.target.value as AccountKind }))} data-testid="acc-kind">
        {ACCOUNT_KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </SelectField>
      <CurrencySelect value={d.currency} onChange={(currency) => setD((x) => ({ ...x, currency }))} disabled={!!account && hasMovements} hint={account && hasMovements ? 'Hareketi olan hesabın para birimi değişmez.' : undefined} testId="acc-currency" />
      <TextField label="Açılış bakiyesi" inputMode="decimal" value={d.opening} onChange={(e) => setD((x) => ({ ...x, opening: e.target.value }))} error={errors.opening} data-testid="acc-opening" placeholder="0,00" />
      <TextField label="Açılış tarihi" type="date" value={d.openingDate} onChange={(e) => setD((x) => ({ ...x, openingDate: e.target.value }))} error={errors.openingDate} hint="Açılış bakiyesinin geçerli olduğu gün (bilgi amaçlı)." />
      {d.kind !== 'kasa' && (
        <>
          <TextField label="Banka" value={d.bank} onChange={(e) => setD((x) => ({ ...x, bank: e.target.value }))} maxLength={120} />
          <TextField label="IBAN" value={d.iban} onChange={(e) => setD((x) => ({ ...x, iban: e.target.value }))} error={errors.iban} maxLength={42} className="sm:col-span-2" data-testid="acc-iban" autoCapitalize="characters" />
        </>
      )}
      <TextAreaField label="Not" value={d.notes} onChange={(e) => setD((x) => ({ ...x, notes: e.target.value }))} className="sm:col-span-2" maxLength={2000} />
      {account && (
        <label className="flex items-center gap-2 text-sm text-ink-2 sm:col-span-2">
          <input type="checkbox" checked={d.active} onChange={(e) => setD((x) => ({ ...x, active: e.target.checked }))} className="h-4 w-4" data-testid="acc-active" />
          Etkin (pasif hesaba yeni hareket yazılmaz; bakiyesi ve geçmişi korunur)
        </label>
      )}
    </CashFormModal>
  )
}

// ================================================================== Virman
export function TransferDialog({ open, onClose, accounts, defaultFrom }: { open: boolean; onClose: () => void; accounts: readonly FinanceAccount[]; defaultFrom?: string }) {
  const empty = { from: '', to: '', date: localISODate(), amount: '', toAmount: '', description: '' }
  const [d, setD] = useState(empty)
  const [errors, setErrors] = useState<Errors>({})
  const [draftId, setDraftId] = useState('')
  const s = useSave(onClose, 'Virman')
  useResetOnOpen(open, () => {
    setErrors({})
    s.setError(null)
    setDraftId(crypto.randomUUID())
    setD({ ...empty, from: defaultFrom ?? '' })
  })
  const from = accounts.find((a) => a.id === d.from)
  const to = accounts.find((a) => a.id === d.to)
  const cross = !!from && !!to && from.currency !== to.currency
  const submit = () => {
    const errs: Errors = {}
    const amount = parseAmount(d.amount)
    const toAmount = cross ? parseAmount(d.toAmount) : amount
    if (!from) errs.from = 'Çıkış hesabını seçin.'
    if (!to) errs.to = 'Giriş hesabını seçin.'
    if (from && to && from.id === to.id) errs.to = 'Farklı bir hesap seçin.'
    if (amount == null || Number.isNaN(amount) || amount <= 0) errs.amount = 'Sıfırdan büyük tutar girin.'
    if (cross && (toAmount == null || Number.isNaN(toAmount) || toAmount <= 0)) errs.toAmount = `Hesaba giren ${to!.currency} tutarını girin (kur uydurulmaz).`
    if (!d.date) errs.date = 'Tarih zorunludur.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const db = requireSupabase()
    void s.run(
      () => createTransfer(db, { id: draftId, transfer_date: d.date, from_account_id: from!.id, to_account_id: to!.id, from_amount: amount!, to_amount: toAmount!, description: d.description.trim() || null }),
      'Virman kaydedildi.',
    )
  }
  return (
    <CashFormModal open={open} onClose={onClose} title="Hesaplar arası virman" description="Virman gelir veya gider değildir; yalnız bakiyeleri taşır." formId="transfer-form" busy={s.busy} error={s.error} submitLabel="Virmanı kaydet" onSubmit={submit}>
      <AccountSelect accounts={accounts} value={d.from} onChange={(id) => setD((x) => ({ ...x, from: id }))} label="Çıkış hesabı" required error={errors.from} testId="tr-from" />
      <AccountSelect accounts={accounts} value={d.to} onChange={(id) => setD((x) => ({ ...x, to: id }))} label="Giriş hesabı" required error={errors.to} testId="tr-to" />
      <TextField label={cross ? `Çıkan tutar (${from!.currency})` : 'Tutar'} required inputMode="decimal" value={d.amount} onChange={(e) => setD((x) => ({ ...x, amount: e.target.value }))} error={errors.amount} data-testid="tr-amount" />
      {cross ? (
        <TextField label={`Giren tutar (${to!.currency})`} required inputMode="decimal" value={d.toAmount} onChange={(e) => setD((x) => ({ ...x, toAmount: e.target.value }))} error={errors.toAmount} data-testid="tr-to-amount" hint="Bankanın uyguladığı kurla hesaba geçen tutar." />
      ) : (
        <TextField label="Tarih" type="date" required value={d.date} onChange={(e) => setD((x) => ({ ...x, date: e.target.value }))} error={errors.date} data-testid="tr-date" />
      )}
      {cross && <TextField label="Tarih" type="date" required value={d.date} onChange={(e) => setD((x) => ({ ...x, date: e.target.value }))} error={errors.date} data-testid="tr-date" />}
      <TextField label="Açıklama" value={d.description} onChange={(e) => setD((x) => ({ ...x, description: e.target.value }))} maxLength={500} className={cross ? undefined : 'sm:col-span-2'} placeholder="ör. Bankaya yatırıldı" data-testid="tr-description" />
    </CashFormModal>
  )
}

// ================================================================== Kategori
export function CategoryForm({ open, onClose, category, kind }: { open: boolean; onClose: () => void; category: FinanceCategory | null; kind: EntryKind }) {
  const [name, setName] = useState('')
  const [k, setK] = useState<EntryKind>(kind)
  const [active, setActive] = useState(true)
  const [errors, setErrors] = useState<Errors>({})
  const [draftId, setDraftId] = useState('')
  const s = useSave(onClose, 'Kategori kaydı')
  useResetOnOpen(
    open,
    () => {
      setErrors({})
      s.setError(null)
      setDraftId(crypto.randomUUID())
      setName(category?.name ?? '')
      setK(category?.kind ?? kind)
      setActive(category?.active ?? true)
    },
    [category, kind],
  )
  const submit = () => {
    if (!name.trim()) return setErrors({ name: 'Kategori adı zorunludur.' })
    setErrors({})
    const db = requireSupabase()
    void s.run(
      () => (category ? updateCategory(db, category, { name: name.trim().slice(0, 80), active }) : createCategory(db, { id: draftId, kind: k, name: name.trim().slice(0, 80), active: true, sort_order: 500 })),
      category ? 'Kategori güncellendi.' : 'Kategori eklendi.',
    )
  }
  return (
    <CashFormModal open={open} onClose={onClose} title={category ? 'Kategoriyi düzenle' : 'Yeni kategori'} description={category?.is_system ? 'Sistem kategorisi silinemez; adını değiştirebilir veya pasifleştirebilirsiniz.' : undefined} formId="category-form" busy={s.busy} error={s.error} submitLabel="Kaydet" onSubmit={submit}>
      <SelectField label="Tür" value={k} onChange={(e) => setK(e.target.value as EntryKind)} disabled={!!category} data-testid="cat-kind">
        <option value="gider">Gider</option>
        <option value="gelir">Gelir</option>
      </SelectField>
      <TextField label="Ad" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={80} data-testid="cat-name" />
      {category && (
        <label className="flex items-center gap-2 text-sm text-ink-2 sm:col-span-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4" data-testid="cat-active" />
          Etkin (pasif kategori yeni kayıtlarda seçilemez)
        </label>
      )}
    </CashFormModal>
  )
}

// ================================================================== Düzenli şablon
export function RecurringForm({ open, onClose, row, accounts, categories }: { open: boolean; onClose: () => void; row: FinanceRecurring | null; accounts: readonly FinanceAccount[]; categories: readonly FinanceCategory[] }) {
  const { companies } = useData()
  const empty = { kind: 'gider' as EntryKind, description: '', amount: '', vat: '', currency: 'TRY' as Currency, categoryId: '', accountId: '', method: '' as PaymentMethod | '', companyId: '', frequency: 'aylik' as Frequency, start: localISODate(), end: '', active: true, notes: '' }
  const [d, setD] = useState(empty)
  const [errors, setErrors] = useState<Errors>({})
  const [draftId, setDraftId] = useState('')
  const s = useSave(onClose, 'Düzenli kayıt')
  useResetOnOpen(
    open,
    () => {
      setErrors({})
      s.setError(null)
      setDraftId(crypto.randomUUID())
      setD(
        row
          ? {
              kind: row.kind,
              description: row.description,
              amount: centsToInput(toCents(row.amount)),
              vat: row.vat_amount ? centsToInput(toCents(row.vat_amount)) : '',
              currency: row.currency,
              categoryId: row.category_id,
              accountId: row.account_id ?? '',
              method: row.payment_method ?? '',
              companyId: row.company_id ?? '',
              frequency: row.frequency,
              start: row.start_date,
              end: row.end_date ?? '',
              active: row.active,
              notes: row.notes ?? '',
            }
          : empty,
      )
    },
    [row],
  )
  const account = accounts.find((a) => a.id === d.accountId)
  const submit = () => {
    const errs: Errors = {}
    const amount = parseAmount(d.amount)
    const vat = parseAmount(d.vat)
    if (!d.description.trim()) errs.description = 'Açıklama zorunludur.'
    if (amount == null || Number.isNaN(amount) || amount <= 0) errs.amount = 'Sıfırdan büyük tutar girin.'
    if (Number.isNaN(vat)) errs.vat = 'Geçerli bir tutar girin.'
    if (!d.categoryId) errs.categoryId = 'Kategori seçin.'
    if (!d.start) errs.start = 'Başlangıç tarihi zorunludur.'
    if (d.end && d.end < d.start) errs.end = 'Bitiş başlangıçtan önce olamaz.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const input = {
      kind: d.kind,
      description: d.description.trim().slice(0, 500),
      amount: amount!,
      vat_amount: vat ?? 0,
      currency: account?.currency ?? d.currency,
      category_id: d.categoryId,
      account_id: d.accountId || null,
      payment_method: d.method || null,
      company_id: d.companyId || null,
      frequency: d.frequency,
      start_date: d.start,
      end_date: d.end || null,
      active: d.active,
      notes: d.notes.trim() || null,
    }
    const db = requireSupabase()
    void s.run(() => (row ? updateRecurring(db, row, input) : createRecurring(db, { ...input, id: draftId })), row ? 'Düzenli kayıt güncellendi.' : 'Düzenli kayıt eklendi.')
  }
  const amountNum = parseAmount(d.amount)
  return (
    <CashFormModal
      open={open}
      onClose={onClose}
      title={row ? 'Düzenli kaydı düzenle' : 'Yeni düzenli gelir / gider'}
      description="Vadesi gelen her tarih için “bekliyor” kaydı bir kez üretilir; ödendiğinde işaretleyin. Bekleyen kayıt bakiyeyi etkilemez."
      formId="recurring-form"
      busy={s.busy}
      error={s.error}
      submitLabel="Kaydet"
      onSubmit={submit}
    >
      <SelectField label="Tür" value={d.kind} onChange={(e) => setD((x) => ({ ...x, kind: e.target.value as EntryKind, categoryId: '' }))} data-testid="rc-kind">
        <option value="gider">Gider</option>
        <option value="gelir">Gelir</option>
      </SelectField>
      <SelectField label="Sıklık" value={d.frequency} onChange={(e) => setD((x) => ({ ...x, frequency: e.target.value as Frequency }))} data-testid="rc-frequency">
        {FREQUENCIES.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </SelectField>
      <TextField label="Açıklama" required value={d.description} onChange={(e) => setD((x) => ({ ...x, description: e.target.value }))} error={errors.description} maxLength={500} className="sm:col-span-2" data-testid="rc-description" placeholder="ör. Atölye kirası" />
      <TextField label="Tutar (KDV hariç)" required inputMode="decimal" value={d.amount} onChange={(e) => setD((x) => ({ ...x, amount: e.target.value }))} error={errors.amount} data-testid="rc-amount" />
      <div className="min-w-0">
        <TextField label="KDV tutarı" inputMode="decimal" value={d.vat} onChange={(e) => setD((x) => ({ ...x, vat: e.target.value }))} error={errors.vat} />
        <div className="mt-1.5 flex gap-1.5">
          {[20, 10, 1].map((p) => (
            <button key={p} type="button" disabled={amountNum == null || Number.isNaN(amountNum)} onClick={() => amountNum != null && setD((x) => ({ ...x, vat: centsToInput(Math.round((toCents(amountNum) * p) / 100)) }))} className="h-8 rounded-full border border-line bg-surface-2 px-3 text-[12px] text-ink-2 disabled:opacity-40">
              %{p}
            </button>
          ))}
        </div>
      </div>
      <CategorySelect categories={categories} kind={d.kind} value={d.categoryId} onChange={(categoryId) => setD((x) => ({ ...x, categoryId }))} required error={errors.categoryId} testId="rc-category" />
      <AccountSelect accounts={accounts} value={d.accountId} onChange={(id) => setD((x) => ({ ...x, accountId: id, currency: accounts.find((a) => a.id === id)?.currency ?? x.currency }))} label="Hesap (isteğe bağlı)" noneLabel="Ödenirken seçilecek" testId="rc-account" />
      <CurrencySelect value={account?.currency ?? d.currency} onChange={(currency) => setD((x) => ({ ...x, currency }))} disabled={!!account} />
      <SelectField label="Ödeme yöntemi" value={d.method} onChange={(e) => setD((x) => ({ ...x, method: e.target.value as PaymentMethod | '' }))}>
        <option value="">Belirtilmedi</option>
        {PAYMENT_METHODS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </SelectField>
      <TextField label="Başlangıç" type="date" required value={d.start} onChange={(e) => setD((x) => ({ ...x, start: e.target.value }))} error={errors.start} data-testid="rc-start" />
      <TextField label="Bitiş (isteğe bağlı)" type="date" value={d.end} onChange={(e) => setD((x) => ({ ...x, end: e.target.value }))} error={errors.end} />
      <SelectField label="Firma (isteğe bağlı)" value={d.companyId} onChange={(e) => setD((x) => ({ ...x, companyId: e.target.value }))}>
        <option value="">—</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      {row && (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={d.active} onChange={(e) => setD((x) => ({ ...x, active: e.target.checked }))} className="h-4 w-4" />
          Etkin
        </label>
      )}
      {row && <p className="text-[12px] text-muted sm:col-span-2">Sıradaki tarih: {row.next_date} · {formatMoney(toCents(row.amount) + toCents(row.vat_amount), row.currency)}</p>}
    </CashFormModal>
  )
}
