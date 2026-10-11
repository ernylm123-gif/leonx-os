import { Calculator, FileSpreadsheet, Layers, Ruler, Scissors, Weight } from 'lucide-react'
import { DataTableShell } from '@/components/ui/DataTableShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { FeatureList } from '@/components/ui/FeatureList'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { PlannedAction } from '@/components/ui/Button'
import { PlannedNotice } from '@/components/ui/PlannedNotice'
import { COMPANY } from '@/config/company'

const COLUMNS = ['Poz', 'Eleman', 'Kategori', 'Birim', 'Miktar', 'Kaynak']

export function QuantityPage() {
  return (
    <>
      <PageHeader
        icon={Ruler}
        eyebrow="Mühendislik"
        title="Metraj"
        description="CAD analizinden gelen veya elle girilen ölçülerle malzeme ve işçilik metrajının hazırlanması."
        status="planned"
        actions={<PlannedAction icon={FileSpreadsheet} label="Metraj oluştur" phase="Faz 4" />}
      />

      <PlannedNotice className="mb-6">
        Otomatik metraj hesaplaması Faz 4'te eklenecek. Bu ekranda hesaplanmış veya örnek metraj verisi bulunmaz.
      </PlannedNotice>

      <Panel title="Ürün grupları" subtitle="Metraj kalemlerinin sınıflandırılacağı LEONX Metal faaliyet alanları" icon={Layers} className="mb-6">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {COMPANY.disciplines.map((d) => (
            <li key={d} className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-3">
              <div className="text-sm font-medium text-silver-100">{d}</div>
              <div className="mt-1 text-[11px] text-titanium-500">Kalem yok</div>
            </li>
          ))}
        </ul>
      </Panel>

      <DataTableShell
        columns={COLUMNS}
        empty={
          <EmptyState
            icon={Ruler}
            title="Metraj kalemi bulunmuyor"
            description="Bir proje seçilip CAD analizi tamamlandığında metraj kalemleri burada otomatik oluşturulacak."
          />
        }
      />

      <Panel title="Planlanan yetenekler" subtitle="Bu modül için yol haritası" className="mt-6">
        <FeatureList
          items={[
            { icon: Calculator, title: 'Otomatik hesaplama', description: 'Profil uzunlukları, cam ve panel alanları, aksesuar adetleri.' },
            { icon: Scissors, title: 'Kesim optimizasyonu', description: 'Boy profillerden fire oranını en aza indiren kesim planı.' },
            { icon: Weight, title: 'Ağırlık hesabı', description: 'Profil birim ağırlıklarına göre toplam ağırlık.' },
            { icon: FileSpreadsheet, title: 'Dışa aktarma', description: 'Metraj listelerinin Excel ve PDF olarak alınması.' },
          ]}
        />
      </Panel>
    </>
  )
}
