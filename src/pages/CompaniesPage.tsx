import { Building2, Contact, Handshake, Plus, Truck, UserRound } from 'lucide-react'
import { DataTableShell } from '@/components/ui/DataTableShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { FeatureList } from '@/components/ui/FeatureList'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { PlannedAction } from '@/components/ui/Button'
import { PlannedNotice } from '@/components/ui/PlannedNotice'

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
        eyebrow="Ticari"
        title="Firmalar"
        description="Müşteri, tedarikçi ve iş ortağı kayıtlarının, yetkili kişileri ve proje geçmişiyle birlikte yönetimi."
        status="planned"
        actions={<PlannedAction icon={Plus} label="Firma ekle" phase="Faz 2" />}
      />

      <PlannedNotice className="mb-6">Firma kayıtları veritabanı bağlantısıyla (Faz 2) birlikte etkinleşecek.</PlannedNotice>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TYPES.map(({ icon: Icon, label }) => (
          <div key={label} className="panel flex items-center gap-3 p-4">
            <Icon className="h-5 w-5 text-titanium-300" strokeWidth={1.75} aria-hidden="true" />
            <span className="text-sm font-medium text-silver-100">{label}</span>
            <span className="ml-auto font-mono text-sm text-titanium-600">—</span>
          </div>
        ))}
      </div>

      <DataTableShell
        columns={COLUMNS}
        empty={
          <EmptyState
            icon={Building2}
            title="Henüz firma kaydı yok"
            description="Firmalar eklendiğinde burada listelenecek ve projeler ile tekliflerle ilişkilendirilebilecek."
          />
        }
      />

      <Panel title="Planlanan yetenekler" subtitle="Bu modül için yol haritası" className="mt-6">
        <FeatureList
          items={[
            { icon: Contact, title: 'Yetkili kişiler', description: 'Her firma için birden fazla iletişim kişisi.' },
            { icon: Building2, title: 'Firma geçmişi', description: 'Firmaya ait projeler, teklifler ve yazışmalar.' },
          ]}
        />
      </Panel>
    </>
  )
}
