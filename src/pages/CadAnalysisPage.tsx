import { Boxes, FileUp, Layers3, ListTree, Ruler, ScanLine, Shapes } from 'lucide-react'
import { PlannedAction } from '@/components/ui/Button'
import { RoadmapPanel } from '@/components/ui/FeatureList'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { PlannedNotice } from '@/components/ui/PlannedNotice'
import { MILESTONE } from '@/config/company'

const PIPELINE = [
  { step: '01', title: 'Dosya yükleme', description: 'DWG / DXF dosyasının sisteme alınması' },
  { step: '02', title: 'Katman çözümleme', description: 'Katman, blok ve öznitelik okuma' },
  { step: '03', title: 'Eleman tanıma', description: 'Profil, doğrama ve panel elemanlarının ayrıştırılması' },
  { step: '04', title: 'Metraja aktarım', description: 'Ölçülerin Metraj modülüne gönderilmesi' },
]

export function CadAnalysisPage() {
  return (
    <>
      <PageHeader
        icon={ScanLine}
        code="M02"
        eyebrow="Mühendislik"
        title="CAD Analiz"
        description="DWG ve DXF çizimlerinden katman, eleman ve ölçü bilgisinin otomatik çıkarılması."
        status="planned"
        actions={<PlannedAction icon={FileUp} label="Çizim yükle" phase={MILESTONE.cad} />}
      />

      <PlannedNotice className="mb-6">
        CAD analiz motoru henüz bağlanmadı. Bu ekranda dosya yükleme ve analiz <strong>yapılamaz</strong>; aşağıdaki alan,
        motor eklendiğinde kullanılacak çalışma alanının yerleşimidir.
      </PlannedNotice>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section
          aria-label="Çizim çalışma alanı"
          className="card blueprint-grid relative flex min-h-[300px] min-w-0 flex-col items-center justify-center overflow-hidden p-8 text-center sm:min-h-[360px] xl:col-span-2"
        >
          {/* Teknik çizim çerçevesi ve köşe işaretleri */}
          <div className="pointer-events-none absolute inset-5 rounded-xl border border-dashed border-line-strong" aria-hidden="true" />
          {['top-3 left-3 border-t border-l', 'top-3 right-3 border-t border-r', 'bottom-3 left-3 border-b border-l', 'bottom-3 right-3 border-b border-r'].map((c) => (
            <span key={c} className={`pointer-events-none absolute h-4 w-4 border-titanium ${c}`} aria-hidden="true" />
          ))}
          <div className="relative grid h-16 w-16 place-items-center rounded-2xl border border-line bg-surface shadow-card">
            <Shapes className="h-7 w-7 text-titanium" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h2 className="relative mt-5 text-base font-semibold text-ink">Çizim görüntüleyici</h2>
          <p className="relative mt-2 max-w-sm text-sm text-muted">
            Analiz motoru etkinleştiğinde yüklenen çizim burada katmanlarıyla birlikte görüntülenecek.
          </p>
          <div className="relative mt-4 flex gap-2 font-mono text-[11px] text-muted">
            <span className="rounded-md border border-line bg-surface px-2 py-0.5">.DWG</span>
            <span className="rounded-md border border-line bg-surface px-2 py-0.5">.DXF</span>
          </div>
          <span className="absolute right-6 bottom-6 hidden font-mono text-[10px] text-subtle sm:block">ÖLÇEK — / KATMAN —</span>
        </section>

        <Panel title="Analiz akışı" subtitle="Planlanan işlem adımları" icon={ListTree}>
          <ol className="relative flex flex-col gap-5">
            <span className="absolute top-3 bottom-3 left-[13px] w-px bg-line" aria-hidden="true" />
            {PIPELINE.map((p) => (
              <li key={p.step} className="relative flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-surface font-mono text-[10.5px] text-muted">
                  {p.step}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{p.title}</div>
                  <div className="mt-0.5 text-xs text-muted">{p.description}</div>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <RoadmapPanel
        items={[
          { icon: Layers3, title: 'Katman eşleştirme', description: 'Çizim katmanlarının ürün gruplarıyla eşleştirilmesi.' },
          { icon: Boxes, title: 'Blok sayımı', description: 'Tekrarlanan blokların (kanat, aksesuar vb.) adetlendirilmesi.' },
          { icon: Ruler, title: 'Ölçü çıkarımı', description: 'Uzunluk, alan ve çevre ölçülerinin çizimden okunması.' },
          { icon: ScanLine, title: 'Doğrulama raporu', description: 'Okunamayan veya belirsiz elemanların kullanıcıya bildirilmesi.' },
        ]}
      />
    </>
  )
}
