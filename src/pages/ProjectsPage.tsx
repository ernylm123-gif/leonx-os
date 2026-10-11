import { CalendarClock, FolderKanban, FolderPlus, GitBranch, Paperclip, Users } from 'lucide-react'
import { DataTableShell } from '@/components/ui/DataTableShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { FeatureList } from '@/components/ui/FeatureList'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { PlannedAction } from '@/components/ui/Button'
import { PlannedNotice } from '@/components/ui/PlannedNotice'
import { COMPANY } from '@/config/company'

const COLUMNS = ['Proje', 'Firma', 'Kategori', 'Aşama', 'Teslim tarihi', 'Sorumlu']

export function ProjectsPage() {
  return (
    <>
      <PageHeader
        icon={FolderKanban}
        eyebrow="Genel"
        title="Projeler"
        description="Alüminyum, PVC, kapı, korkuluk, cephe ve metal imalat projelerinin keşiften teslime kadar takibi."
        status="planned"
        actions={<PlannedAction icon={FolderPlus} label="Yeni proje" phase="Faz 2" />}
      />

      <PlannedNotice className="mb-6">
        Proje kayıtları veritabanı bağlantısıyla (Faz 2) birlikte etkinleşecek. Şu anda gösterilen tablo yalnızca yapıyı
        temsil eder; kayıt eklenmemiştir.
      </PlannedNotice>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="list" aria-label="Proje kategorileri">
        {COMPANY.disciplines.map((d) => (
          <span
            key={d}
            role="listitem"
            className="shrink-0 rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-titanium-300"
          >
            {d}
          </span>
        ))}
      </div>

      <DataTableShell
        columns={COLUMNS}
        empty={
          <EmptyState
            icon={FolderKanban}
            title="Henüz proje kaydı yok"
            description="Veritabanı bağlandığında projeler burada listelenecek, filtrelenebilecek ve aşamalarına göre izlenebilecek."
          />
        }
      />

      <Panel title="Planlanan yetenekler" subtitle="Bu modül için yol haritası" className="mt-6">
        <FeatureList
          items={[
            { icon: GitBranch, title: 'Aşama takibi', description: 'Keşif, ölçü, çizim, teklif, üretim, montaj ve teslim aşamaları.' },
            { icon: Users, title: 'Firma ve sorumlu ataması', description: 'Her proje bir firma kaydına ve sorumlu personele bağlanır.' },
            { icon: Paperclip, title: 'Dosya ve çizim arşivi', description: 'DWG/DXF, PDF ve fotoğrafların proje altında saklanması.' },
            { icon: CalendarClock, title: 'Termin planlama', description: 'Üretim ve montaj tarihlerinin takvim üzerinde izlenmesi.' },
          ]}
        />
      </Panel>
    </>
  )
}
