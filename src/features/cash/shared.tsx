import { Download, FileText, History, Loader2, Paperclip, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormAlert, SelectField, TextAreaField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/context/toast'
import { ConflictError } from '@/data/api'
import { deleteDocument, downloadDocument, listAudit, listDocuments, uploadDocument } from '@/data/cashApi'
import { finErrorMessage } from '@/features/finance/shared'
import {
  AUDIT_ACTION_LABEL,
  DOCUMENT_MAX_BYTES,
  type DocumentTable,
  documentMime,
  type EntryKind,
  type FinanceAccount,
  type FinanceAuditRow,
  type FinanceCategory,
  type FinanceDocument,
} from '@/finance/cash'
import { type MovementKind, RECORD_STATUS_LABEL, type RecordStatus } from '@/finance/ledger'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/files'
import { requireSupabase } from '@/lib/supabase'
import { useResetOnOpen } from '@/lib/useResetOnOpen'
import type { Currency } from '@/quote/types'

/** Kasa/banka tetikleyici iletilerini (Türkçe iş kuralı) olduğu gibi, kısıt hatalarını anlaşılır gösterir */
export function cashErrorMessage(e: unknown, context: string): string {
  if (e instanceof ConflictError) return 'Kayıt başka bir cihazda değiştirildi; kapatıp yeniden açın.'
  if (e instanceof Error && !(e as { code?: string }).code && /^(Yalnız|Dosya)/.test(e.message)) return e.message
  const err = e as { code?: string; message?: string }
  const msg = err?.message ?? ''
  if (err?.code === '23514' || err?.code === 'P0001') {
    if (/^(Hesab|Pasif|Kategori|Kayıt|İptal|Virman|Aynı para|Sistem|Kullanıcı|Hareketi|Belge|Kullanılan)/.test(msg)) return msg
    if (msg.includes('finance_entries_account_required')) return 'Gerçekleşen kayıt için kasa veya banka hesabı seçin.'
    if (msg.includes('project_expenses_account_paid_check')) return 'Hesaba yalnız ödenmiş gider yazılabilir; önce “Ödendi” işaretleyin.'
    if (msg.includes('void_reason')) return 'İptal sebebi zorunludur.'
    if (msg.includes('iban')) return 'IBAN geçersiz (ör. TR33 0006 1005 1978 6457 8413 26).'
    if (msg.includes('finance_transfers_distinct')) return 'Virmanda çıkış ve giriş hesabı farklı olmalıdır.'
  }
  if (err?.code === '23505') {
    if (msg.includes('finance_accounts_name')) return 'Bu adla bir hesap zaten var.'
    if (msg.includes('finance_categories_name')) return 'Bu türde aynı adlı bir kategori zaten var.'
  }
  if (err?.code === '23503') return 'Bu kayıt başka kayıtlarda kullanıldığı için silinemez; pasifleştirebilirsiniz.'
  return finErrorMessage(e, context)
}

export function accountLabel(a: Pick<FinanceAccount, 'name' | 'currency' | 'active'>): string {
  return `${a.name} · ${a.currency}${a.active ? '' : ' (pasif)'}`
}

/** Hesap seçimi: yalnız etkin ve (verildiyse) aynı para birimindeki hesaplar; mevcut seçim korunur */
export function AccountSelect({
  accounts,
  value,
  onChange,
  currency,
  label = 'Hesap',
  required,
  noneLabel,
  error,
  hint,
  testId,
  className,
}: {
  accounts: readonly FinanceAccount[]
  value: string
  onChange: (id: string) => void
  currency?: Currency
  label?: string
  required?: boolean
  /** Boş seçenek etiketi (yoksa boş seçenek "Seçin") */
  noneLabel?: string
  error?: string
  hint?: string
  testId?: string
  className?: string
}) {
  const list = accounts.filter((a) => a.id === value || (a.active && (!currency || a.currency === currency)))
  return (
    <SelectField label={label} required={required} value={value} onChange={(e) => onChange(e.target.value)} error={error} hint={hint} data-testid={testId} className={className}>
      <option value="">{noneLabel ?? 'Seçin'}</option>
      {list.map((a) => (
        <option key={a.id} value={a.id}>
          {accountLabel(a)}
        </option>
      ))}
    </SelectField>
  )
}

export function CategorySelect({
  categories,
  kind,
  value,
  onChange,
  required,
  noneLabel,
  error,
  testId,
  className,
}: {
  categories: readonly FinanceCategory[]
  kind: EntryKind
  value: string
  onChange: (id: string) => void
  required?: boolean
  noneLabel?: string
  error?: string
  testId?: string
  className?: string
}) {
  const list = categories.filter((c) => c.kind === kind && (c.active || c.id === value))
  return (
    <SelectField label="Kategori" required={required} value={value} onChange={(e) => onChange(e.target.value)} error={error} data-testid={testId} className={className}>
      <option value="">{noneLabel ?? 'Seçin'}</option>
      {list.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
          {c.active ? '' : ' (pasif)'}
        </option>
      ))}
    </SelectField>
  )
}

const KIND_STYLE: Record<MovementKind, string> = {
  gelir: 'border-ok/25 bg-ok-soft text-ok',
  gider: 'border-danger/25 bg-danger-soft text-danger',
  transfer: 'border-line bg-surface-2 text-ink-2',
}
const KIND_TEXT: Record<MovementKind, string> = { gelir: 'Gelir', gider: 'Gider', transfer: 'Virman' }
export function MovementKindBadge({ kind }: { kind: MovementKind }) {
  return <span className={cn('inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap', KIND_STYLE[kind])}>{KIND_TEXT[kind]}</span>
}

export function RecordStatusBadge({ status }: { status: RecordStatus }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap',
        status === 'gerceklesti' && 'border-line bg-surface text-ink-2',
        status === 'bekliyor' && 'border-warn-line bg-warn-soft text-warn',
        status === 'iptal' && 'border-line bg-surface-2 text-subtle line-through',
      )}
      data-testid="record-status"
      data-status={status}
    >
      {RECORD_STATUS_LABEL[status]}
    </span>
  )
}

// ================================================================== İptal (silme yerine)
export function VoidDialog({ open, onClose, title, onConfirm }: { open: boolean; onClose: () => void; title: string; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useResetOnOpen(open, () => {
    setReason('')
    setError(null)
  }, [])
  const submit = async () => {
    if (!reason.trim()) {
      setError('İptal sebebini yazın.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm(reason.trim())
      onClose()
    } catch (e) {
      setError(cashErrorMessage(e, 'İptal'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title={title}
      description="Kayıt silinmez; iptal edilmiş olarak saklanır ve bakiye ile raporlardan çıkar. Geri alınamaz."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="danger" onClick={() => void submit()} disabled={busy} data-testid="void-confirm">
            {busy ? 'İptal ediliyor…' : 'İptal et'}
          </Button>
        </>
      }
    >
      {error && <FormAlert>{error}</FormAlert>}
      <TextAreaField label="İptal sebebi" required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-testid="void-reason" />
    </Modal>
  )
}

// ================================================================== Değişiklik geçmişi
const FIELD_LABEL: Record<string, string> = {
  amount: 'Tutar', vat_amount: 'KDV', entry_date: 'Tarih', expense_date: 'Tarih', received_date: 'Tarih', transfer_date: 'Tarih', description: 'Açıklama',
  note: 'Not', notes: 'Not', category_id: 'Kategori', account_id: 'Hesap', status: 'Durum', paid: 'Ödendi', currency: 'Para birimi', document_no: 'Belge no',
  payment_method: 'Ödeme yöntemi', method: 'Yöntem', company_id: 'Firma', due_date: 'Vade', from_amount: 'Çıkan tutar', to_amount: 'Giren tutar',
  from_account_id: 'Çıkış hesabı', to_account_id: 'Giriş hesabı', voided_reason: 'İptal sebebi', kind: 'Tür', supplier: 'Tedarikçi', cost_group: 'Maliyet grubu',
  reference: 'Referans', schedule_id: 'Taksit',
}
const SKIP = new Set(['updated_at', 'version', 'created_at', 'created_by', 'voided_at', 'voided_by', 'id'])

function diff(row: FinanceAuditRow): { field: string; from: unknown; to: unknown }[] {
  if (!row.old_row || !row.new_row) return []
  const keys = new Set([...Object.keys(row.old_row), ...Object.keys(row.new_row)])
  return [...keys]
    .filter((k) => !SKIP.has(k) && JSON.stringify(row.old_row![k] ?? null) !== JSON.stringify(row.new_row![k] ?? null))
    .map((k) => ({ field: k, from: row.old_row![k], to: row.new_row![k] }))
}

const dtf = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function HistoryDialog({
  open,
  onClose,
  table,
  rowId,
  title,
  resolve,
}: {
  open: boolean
  onClose: () => void
  table: string
  rowId: string
  title: string
  /** Kimlik alanlarını (hesap, kategori) okunur ada çevirir */
  resolve?: (field: string, value: unknown) => string | null
}) {
  const [rows, setRows] = useState<FinanceAuditRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    let alive = true
    setRows(null)
    setError(null)
    listAudit(requireSupabase(), table, rowId)
      .then((r) => alive && setRows(r))
      .catch((e) => alive && setError(cashErrorMessage(e, 'Geçmiş')))
    return () => {
      alive = false
    }
  }, [open, table, rowId])
  const show = (field: string, v: unknown) => {
    if (v == null || v === '') return '—'
    const r = resolve?.(field, v)
    if (r) return r
    if (typeof v === 'boolean') return v ? 'Evet' : 'Hayır'
    return String(v)
  }
  return (
    <Modal open={open} onClose={onClose} title={title} description="Kayıt üzerinde yapılan her değişiklik sunucuda saklanır.">
      {error && <FormAlert>{error}</FormAlert>}
      {!rows && !error && <p className="text-sm text-subtle">Yükleniyor…</p>}
      {rows && rows.length === 0 && <p className="text-sm text-subtle">Bu kayıt için geçmiş yok (013 öncesi oluşturulmuş olabilir).</p>}
      {rows && rows.length > 0 && (
        <ol className="flex flex-col gap-3" data-testid="history-list">
          {rows.map((r) => {
            const changes = diff(r)
            return (
              <li key={r.id} className="rounded-xl border border-line bg-surface-2/50 px-3 py-2.5" data-testid="history-row" data-action={r.action}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span className="font-semibold text-ink">{AUDIT_ACTION_LABEL[r.action]}</span>
                  <span className="font-mono text-[11.5px] text-muted">{dtf.format(new Date(r.changed_at))}</span>
                </div>
                {r.action === 'void' && <p className="mt-1 text-[12.5px] text-ink-2">Sebep: {String(r.new_row?.voided_reason ?? '—')}</p>}
                {r.action === 'update' && changes.length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-0.5 text-[12.5px] text-ink-2">
                    {changes.map((c) => (
                      <li key={c.field} className="break-words">
                        <span className="text-muted">{FIELD_LABEL[c.field] ?? c.field}:</span> <span className="line-through opacity-70">{show(c.field, c.from)}</span> → {show(c.field, c.to)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </Modal>
  )
}

export function HistoryButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Geçmiş" title="Geçmiş" data-testid="record-history">
      <History className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

// ================================================================== Belge ekleri
export function DocumentsSection({ table, entryId }: { table: DocumentTable; entryId: string }) {
  const { notify } = useToast()
  const [docs, setDocs] = useState<FinanceDocument[]>([])
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const reload = () =>
    listDocuments(requireSupabase(), table, entryId)
      .then(setDocs)
      .catch(() => setDocs([]))
  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, entryId])
  const pick = async (file: File | undefined) => {
    if (!file) return
    const err = validateDocument(file)
    if (err) return notify(err, 'error')
    setBusy(true)
    try {
      await uploadDocument(requireSupabase(), table, entryId, file)
      notify('Belge eklendi.')
      await reload()
    } catch (e) {
      notify(cashErrorMessage(e, 'Belge yükleme'), 'error')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  const open = async (d: FinanceDocument) => {
    try {
      const blob = await downloadDocument(requireSupabase(), d)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = d.file_name
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (e) {
      notify(cashErrorMessage(e, 'Belge indirme'), 'error')
    }
  }
  const remove = async (d: FinanceDocument) => {
    try {
      await deleteDocument(requireSupabase(), d)
      await reload()
    } catch (e) {
      notify(cashErrorMessage(e, 'Belge silme'), 'error')
    }
  }
  return (
    <div className="sm:col-span-2" data-testid="documents">
      <div className="mb-1.5 text-[13px] font-medium text-ink-2">Belge ekleri (fiş / fatura)</div>
      <ul className="flex flex-col gap-1.5">
        {docs.map((d) => (
          <li key={d.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/50 px-2.5 py-1.5 text-[13px]" data-testid="document-row">
            <FileText className="h-4 w-4 shrink-0 text-titanium" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{d.file_name}</span>
            <span className="text-[11px] text-subtle">{formatBytes(d.size_bytes)}</span>
            <button type="button" onClick={() => void open(d)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-3" aria-label={`${d.file_name} indir`}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => void remove(d)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-danger" aria-label={`${d.file_name} kaldır`}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} data-testid="document-input" aria-label="Belge seç" />
      <Button variant="secondary" icon={busy ? Loader2 : Paperclip} disabled={busy} onClick={() => input.current?.click()} className="mt-2">
        {busy ? 'Yükleniyor…' : 'Belge ekle'}
      </Button>
      <p className="mt-1 text-[11px] text-subtle">PDF, JPEG, PNG, WEBP veya HEIC · en fazla 15 MB · özel depoda saklanır</p>
    </div>
  )
}

export function validateDocument(file: { name: string; size: number; type?: string }): string | null {
  if (!documentMime(file.name, file.type)) return 'Yalnız PDF, JPEG, PNG, WEBP veya HEIC belge eklenebilir.'
  if (file.size <= 0) return 'Dosya boş.'
  if (file.size > DOCUMENT_MAX_BYTES) return 'Dosya 15 MB sınırını aşıyor.'
  return null
}
