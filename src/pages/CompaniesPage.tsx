import { Building2, Contact, Handshake, History, Plus, Truck, UserRound } from 'lucide-react'
import { PlannedAction } from '@/components/ui/Button'
import { DataTableShell } from '@/components/ui/DataTableShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { RoadmapPanel } from '@/components/ui/FeatureList'
import { PageHeader } from '@/components/ui/PageHeader'
import { PlannedNotice } from '@/components/ui/PlannedNotice'
import { MILESTONE } from '@/config/company'

const COLUMNS = ['Firma', 'Tür', 'Yetkili', 'Telefon', 'E-posta', 'Şehir']
const TYPES = [
  { icon: UserRound, label: 'Müşteriler' },
  { icon: Truck, label: 'Tedarikçiler' },
  { icon: Handshake, label: 'İş ortakları' },
]

export function CompaniesPage() {
  return (
    <>
      <PageHeader
        icon={Building2}
        code="M05"
        eyebrow="Ticari"
        title="Firmalar"
        description="Müşteri, tedarikçi ve iş ortağı kayıtlarının, yetkili kişileri ve proje geçmişiyle birlikte yönetimi."
        status="planned"
        actions={<PlannedAction icon={Plus} label="Firma ekle" phase={MILESTONE.data} />}
      />

      <PlannedNotice className="mb-6">Firma kayıtları veritabanı bağlantısıyla birlikte etkinleşecek.</PlannedNotice>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TYPES.map(({ icon: Icon, label }) => (
          <div key={label} className="card flex min-w-0 items-center gap-3 p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface-2">
              <Icon className="h-[18px] w-[18px] text-titanium" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="truncate text-sm font-medium text-ink">{label}</span>
            <span className="ml-auto font-mono text-sm text-subtle" aria-label="Veri yok">
              —
            </span>
          </div>
        ))}
      </div>

      <DataTableShell
        caption="Firma listesi"
        columns={COLUMNS}
        empty={
          <EmptyState
            icon={Building2}
            title="Henüz firma kaydı yok"
            description="Firmalar eklendiğinde burada listelenecek ve projeler ile tekliflerle ilişkilendirilebilecek."
          />
        }
      />

      <RoadmapPanel
        items={[
          { icon: Contact, title: 'Yetkili kişiler', description: 'Her firma için birden fazla iletişim kişisi.' },
          { icon: History, title: 'Firma geçmişi', description: 'Firmaya ait projeler, teklifler ve yazışmalar.' },
        ]}
      />
    </>
  )
}
