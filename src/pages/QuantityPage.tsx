import { Calculator, FileSpreadsheet, Layers, Ruler, Scissors, Weight } from 'lucide-react'
import { PlannedAction } from '@/components/ui/Button'
import { DataTableShell } from '@/components/ui/DataTableShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { RoadmapPanel } from '@/components/ui/FeatureList'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { PlannedNotice } from '@/components/ui/PlannedNotice'
import { COMPANY, MILESTONE } from '@/config/company'

const COLUMNS = ['Poz', 'Eleman', 'Kategori', 'Birim', 'Miktar', 'Kaynak']

export function QuantityPage() {
  return (
    <>
      <PageHeader
        icon={Ruler}
        code="M03"
        eyebrow="Mühendislik"
        title="Metraj"
        description="CAD analizinden gelen veya elle girilen ölçülerle malzeme ve işçilik metrajının hazırlanması."
        status="planned"
        actions={<PlannedAction icon={FileSpreadsheet} label="Metraj oluştur" phase={MILESTONE.pricing} />}
      />

      <PlannedNotice className="mb-6">
        Otomatik metraj hesaplaması henüz geliştirilmedi. Bu ekranda hesaplanmış veya örnek metraj verisi bulunmaz.
      </PlannedNotice>

      <Panel
        title="Ürün grupları"
        subtitle="Metraj kalemlerinin sınıflandırılacağı LEONX Metal faaliyet alanları"
        icon={Layers}
        className="mb-6"
      >
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {COMPANY.disciplines.map((d, i) => (
            <li key={d} className="min-w-0 rounded-xl border border-line bg-surface-2/60 px-4 py-3">
              <div className="font-mono text-[10px] text-subtle">G{String(i + 1).padStart(2, '0')}</div>
              <div className="mt-1 truncate text-sm font-medium text-ink">{d}</div>
              <div className="mt-1 text-[11px] text-subtle">Kalem yok</div>
            </li>
          ))}
        </ul>
      </Panel>

      <DataTableShell
        caption="Metraj kalemleri"
        columns={COLUMNS}
        empty={
          <EmptyState
            icon={Ruler}
            title="Metraj kalemi bulunmuyor"
            description="Bir proje seçilip CAD analizi tamamlandığında metraj kalemleri burada otomatik oluşturulacak."
          />
        }
      />

      <RoadmapPanel
        items={[
          { icon: Calculator, title: 'Otomatik hesaplama', description: 'Profil uzunlukları, cam ve panel alanları, aksesuar adetleri.' },
          { icon: Scissors, title: 'Kesim optimizasyonu', description: 'Boy profillerden fire oranını en aza indiren kesim planı.' },
          { icon: Weight, title: 'Ağırlık hesabı', description: 'Profil birim ağırlıklarına göre toplam ağırlık.' },
          { icon: FileSpreadsheet, title: 'Dışa aktarma', description: 'Metraj listelerinin Excel ve PDF olarak alınması.' },
        ]}
      />
    </>
  )
}
