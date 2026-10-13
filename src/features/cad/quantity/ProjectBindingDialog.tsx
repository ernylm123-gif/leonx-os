import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useData } from '@/context/data'
import { listTakeoffs } from '@/data/quantityApi'
import type { QuantityTakeoff } from '@/data/types'
import { requireSupabase } from '@/lib/supabase'
import type { BindRequest } from './useCadProject'

const STATUS = { taslak: 'Taslak', onaylandi: 'Onaylı (kilitli)', arsiv: 'Arşiv' } as const

/** Çizimi projeye bağlama: dosya yükleme, analiz kaydı ve metraj sürümü seçimi */
export function ProjectBindingDialog({
  open,
  onClose,
  onSubmit,
  busy,
  initialProjectId,
  fileIsLocal,
  hasDoc,
  pendingCount,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (req: BindRequest) => void
  busy: boolean
  initialProjectId: string | null
  fileIsLocal: boolean
  hasDoc: boolean
  pendingCount: number
}) {
  const { projects } = useData()
  const [projectId, setProjectId] = useState(initialProjectId ?? '')
  const [takeoffs, setTakeoffs] = useState<QuantityTakeoff[]>([])
  const [choice, setChoice] = useState<string>('yeni')
  const [newName, setNewName] = useState('Metraj')
  const [upload, setUpload] = useState(true)
  const [saveAnalysis, setSaveAnalysis] = useState(true)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) setProjectId(initialProjectId ?? '')
  }, [open, initialProjectId])

  useEffect(() => {
    if (!projectId) {
      setTakeoffs([])
      return
    }
    let cancelled = false
    setLoading(true)
    listTakeoffs(requireSupabase(), projectId)
      .then((t) => {
        if (cancelled) return
        setTakeoffs(t)
        const draft = t.find((x) => x.status === 'taslak')
        setChoice(draft ? draft.id : 'yeni')
      })
      .catch(() => !cancelled && setTakeoffs([]))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [projectId])

  const chosen = takeoffs.find((t) => t.id === choice)
  const locked = chosen && chosen.status !== 'taslak'
  const sorted = useMemo(() => [...projects].sort((a, b) => a.code.localeCompare(b.code, 'tr', { numeric: true })), [projects])

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title="Proje ve metraj"
      description="Analiz ve metraj seçilen projeye kaydedilir; diğer cihazlarınızda anlık görünür."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button
            variant="primary"
            disabled={busy || !projectId || (choice === 'yeni' && !newName.trim()) || (!!locked && pendingCount > 0)}
            onClick={() => onSubmit({ projectId, takeoff: choice === 'yeni' ? { newName } : { id: choice }, uploadFile: fileIsLocal && upload, saveAnalysis: hasDoc && saveAnalysis })}
            data-testid="bind-submit"
          >
            {busy ? 'Kaydediliyor…' : 'Bağla ve kaydet'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <SelectField label="Proje" value={projectId} onChange={(e) => setProjectId(e.target.value)} required data-testid="bind-project">
          <option value="">Proje seçin…</option>
          {sorted.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </SelectField>
        {projectId && (
          <SelectField label="Metraj sürümü" value={choice} onChange={(e) => setChoice(e.target.value)} hint={loading ? 'Sürümler yükleniyor…' : undefined} data-testid="bind-takeoff">
            <option value="yeni">+ Yeni sürüm oluştur</option>
            {takeoffs.map((t) => (
              <option key={t.id} value={t.id}>
                Rev {t.revision} · {t.name} · {STATUS[t.status]}
              </option>
            ))}
          </SelectField>
        )}
        {projectId && choice === 'yeni' && <TextField label="Sürüm adı" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} required />}
        {locked && (
          <p className="rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
            Bu sürüm {chosen?.status === 'onaylandi' ? 'onaylandı ve kilitli' : 'arşivlendi'}; yalnızca görüntülenebilir.
            {pendingCount > 0 && ' Kaydedilmemiş pozları aktarmak için taslak sürüm seçin.'}
          </p>
        )}
        {hasDoc && (
          <fieldset className="space-y-2 text-[13px]">
            {fileIsLocal && (
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={upload} onChange={(e) => setUpload(e.target.checked)} />
                <span>
                  Çizim dosyasını projenin özel dosyalarına yükle
                  <span className="block text-[12px] text-muted">Dosya yalnızca sizin hesabınızla erişilebilen özel depoda saklanır.</span>
                </span>
              </label>
            )}
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={saveAnalysis} onChange={(e) => setSaveAnalysis(e.target.checked)} />
              <span>
                Analiz kaydı oluştur
                <span className="block text-[12px] text-muted">Birim, nesne sayıları, uyarılar ve tespit özeti proje geçmişine eklenir.</span>
              </span>
            </label>
          </fieldset>
        )}
        {pendingCount > 0 && !locked && <p className="text-[12.5px] text-muted">Kaydedilmemiş {pendingCount} poz bu sürüme aktarılacak.</p>}
      </div>
    </Modal>
  )
}
