import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useResetOnOpen } from '@/lib/useResetOnOpen'
import { nf } from '../format'

/**
 * İki noktalı kalibrasyon: kullanıcı çizimde iki nokta seçer ve aradaki gerçek mesafeyi
 * girer. Çizim birimi → mm katsayısı = gerçek mm / çizim mesafesi.
 */
export function CalibrationDialog({
  open,
  worldDistance,
  onClose,
  onApply,
}: {
  open: boolean
  worldDistance: number
  onClose: () => void
  onApply: (mmPerUnit: number, knownMm: number) => void
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | undefined>()
  // Açılışta render sırasında sıfırla (effect ile sıfırlamak, açılır açılmaz yazılanları ezebilir)
  useResetOnOpen(open, () => {
    setValue('')
    setError(undefined)
  })

  const submit = () => {
    const mm = Number(value.replace(/\s/g, '').replace(',', '.'))
    if (!Number.isFinite(mm) || mm <= 0) {
      setError('Sıfırdan büyük bir mesafe girin (mm).')
      return
    }
    if (mm > 1_000_000) {
      setError('Mesafe 1 km sınırını aşıyor.')
      return
    }
    if (!(worldDistance > 0)) {
      setError('Seçilen iki nokta aynı; yeniden seçin.')
      return
    }
    onApply(mm / worldDistance, mm)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ölçek kalibrasyonu"
      description="Seçtiğiniz iki nokta arasındaki gerçek mesafeyi girin."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" onClick={submit} data-testid="calibration-apply">
            Kalibre et
          </Button>
        </div>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <p className="mb-3 text-[13px] text-muted">
          Çizimdeki mesafe: <span className="font-mono text-ink">{nf(3).format(worldDistance)}</span> çizim birimi. Doğruluğu artırmak için çizimdeki en uzun bilinen
          ölçüyü (ör. bir cephe genişliği veya ölçü çizgisi) kullanın.
        </p>
        <TextField
          label="Gerçek mesafe (mm)"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={error}
          placeholder="ör. 1200"
          data-testid="calibration-input"
          required
        />
      </form>
    </Modal>
  )
}
