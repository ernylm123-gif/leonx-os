import { Boxes, FileUp, Layers3, ListTree, Ruler, ScanLine, Shapes } from 'lucide-react'
import { FeatureList } from '@/components/ui/FeatureList'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { PlannedAction } from '@/components/ui/Button'
import { PlannedNotice } from '@/components/ui/PlannedNotice'

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
        eyebrow="Mühendislik"
        title="CAD Analiz"
        description="DWG ve DXF çizimlerinden katman, eleman ve ölçü bilgisinin otomatik çıkarılması."
        status="planned"
        actions={<PlannedAction icon={FileUp} label="Çizim yükle" phase="Faz 3" />}
      />

      <PlannedNotice className="mb-6">
        CAD analiz motoru henüz bağlanmadı (Faz 3). Bu ekranda dosya yükleme ve analiz <strong>yapılamaz</strong>; aşağıdaki
        alan, motor eklendiğinde kullanılacak çalışma alanının yerleşimidir.
      </PlannedNotice>

      <div className="grid gap-6 xl:grid-cols-3">
        <section
          aria-label="Çizim çalışma alanı"
          className="panel blueprint-grid relative flex min-h-[320px] flex-col items-center justify-center overflow-hidden p-8 text-center xl:col-span-2"
        >
          <div className="pointer-events-none absolute inset-6 rounded-xl border border-dashed border-white/10" aria-hidden="true" />
          <div className="grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-anthracite-800">
            <Shapes className="h-7 w-7 text-titanium-300" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h2 className="mt-5 text-base font-semibold text-silver-50">Çizim görüntüleyici</h2>
          <p className="mt-2 max-w-sm text-sm text-titanium-400">
            Analiz motoru etkinleştiğinde yüklenen çizim burada katmanlarıyla birlikte görüntülenecek.
          </p>
          <div className="mt-4 flex gap-2 font-mono text-[11px] text-titanium-500">
            <span className="rounded border border-white/10 px-2 py-0.5">.DWG</span>
            <span className="rounded border border-white/10 px-2 py-0.5">.DXF</span>
          </div>
        </section>

        <Panel title="Analiz akışı" subtitle="Planlanan işlem adımları" icon={ListTree}>
          <ol className="flex flex-col gap-4">
            {PIPELINE.map((p) => (
              <li key={p.step} className="flex gap-3">
                <span className="font-mono text-xs text-titanium-500">{p.step}</span>
                <div>
                  <div className="text-sm font-medium text-silver-100">{p.title}</div>
                  <div className="mt-0.5 text-xs text-titanium-400">{p.description}</div>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <Panel title="Planlanan yetenekler" subtitle="Bu modül için yol haritası" className="mt-6">
        <FeatureList
          items={[
            { icon: Layers3, title: 'Katman eşleştirme', description: 'Çizim katmanlarının ürün gruplarıyla eşleştirilmesi.' },
            { icon: Boxes, title: 'Blok sayımı', description: 'Tekrarlanan blokların (kanat, aksesuar vb.) adetlendirilmesi.' },
            { icon: Ruler, title: 'Ölçü çıkarımı', description: 'Uzunluk, alan ve çevre ölçülerinin çizimden okunması.' },
            { icon: ScanLine, title: 'Doğrulama raporu', description: 'Okunamayan veya belirsiz elemanların kullanıcıya bildirilmesi.' },
          ]}
        />
      </Panel>
    </>
  )
}
