import { CalendarClock, FolderKanban, FolderPlus, GitBranch, Paperclip, Users } from 'lucide-react'
import { PlannedAction } from '@/components/ui/Button'
import { CategoryChips } from '@/components/ui/CategoryChips'
import { DataTableShell } from '@/components/ui/DataTableShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { RoadmapPanel } from '@/components/ui/FeatureList'
import { PageHeader } from '@/components/ui/PageHeader'
import { PlannedNotice } from '@/components/ui/PlannedNotice'
import { MILESTONE } from '@/config/company'

const COLUMNS = ['Proje', 'Firma', 'Kategori', 'Aşama', 'Teslim tarihi', 'Sorumlu']

export function ProjectsPage() {
  return (
    <>
      <PageHeader
        icon={FolderKanban}
        code="M01"
        eyebrow="Genel"
        title="Projeler"
        description="Alüminyum, PVC, kapı, korkuluk, cephe ve metal imalat projelerinin keşiften teslime kadar takibi."
        status="planned"
        actions={<PlannedAction icon={FolderPlus} label="Yeni proje" phase={MILESTONE.data} />}
      />

      <PlannedNotice className="mb-6">
        Proje kayıtları veritabanı bağlantısıyla birlikte etkinleşecek. Aşağıdaki tablo yalnızca yapıyı gösterir; kayıt
        eklenmemiştir.
      </PlannedNotice>

      <div className="mb-4">
        <CategoryChips label="Proje kategorileri" />
      </div>

      <DataTableShell
        caption="Proje listesi"
        columns={COLUMNS}
        empty={
          <EmptyState
            icon={FolderKanban}
            title="Henüz proje kaydı yok"
            description="Veritabanı bağlandığında projeler burada listelenecek, filtrelenebilecek ve aşamalarına göre izlenebilecek."
          />
        }
      />

      <RoadmapPanel
        items={[
          { icon: GitBranch, title: 'Aşama takibi', description: 'Keşif, ölçü, çizim, teklif, üretim, montaj ve teslim aşamaları.' },
          { icon: Users, title: 'Firma ve sorumlu ataması', description: 'Her proje bir firma kaydına ve sorumlu personele bağlanır.' },
          { icon: Paperclip, title: 'Dosya ve çizim arşivi', description: 'DWG/DXF, PDF ve fotoğrafların proje altında saklanması.' },
          { icon: CalendarClock, title: 'Termin planlama', description: 'Üretim ve montaj tarihlerinin takvim üzerinde izlenmesi.' },
        ]}
      />
    </>
  )
}
