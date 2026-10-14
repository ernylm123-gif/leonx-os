import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Sil', busy, onConfirm, onClose, tone = 'danger' }: ConfirmDialogProps & { tone?: 'danger' | 'primary' }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant={tone} onClick={onConfirm} disabled={busy} data-testid="confirm-ok">
            {busy ? 'Siliniyor…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-danger-soft">
          <AlertTriangle className="h-5 w-5 text-danger" aria-hidden="true" />
        </span>
        <p className="text-sm leading-relaxed text-ink-2">{message}</p>
      </div>
    </Modal>
  )
}
