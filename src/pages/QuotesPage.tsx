import { BadgePercent, FilePlus2, FileText, History, Send, Stamp } from 'lucide-react'
import { FeatureList } from '@/components/ui/FeatureList'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { PlannedAction } from '@/components/ui/Button'
import { PlannedNotice } from '@/components/ui/PlannedNotice'

const STAGES = ['Taslak', 'Gönderildi', 'Revizyon', 'Onaylandı', 'Reddedildi']

export function QuotesPage() {
  return (
    <>
      <PageHeader
        icon={FileText}
        eyebrow="Ticari"
        title="Teklifler"
        description="Metraj ve birim fiyatlardan teklif oluşturma, revizyon takibi ve kurumsal PDF çıktıları."
        status="planned"
        actions={<PlannedAction icon={FilePlus2} label="Yeni teklif" phase="Faz 5" />}
      />

      <PlannedNotice className="mb-6">
        Fiyatlandırma ve teklif hazırlama Faz 4–5'te eklenecek. Sistemde kayıtlı teklif veya fiyat bilgisi yoktur.
      </PlannedNotice>

      <section aria-label="Teklif aşamaları" className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="grid min-w-[880px] grid-cols-5 gap-3">
          {STAGES.map((s) => (
            <div key={s} className="panel flex min-h-[220px] flex-col">
              <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-3">
                <span className="text-sm font-semibold text-silver-100">{s}</span>
                <span className="font-mono text-xs text-titanium-600">—</span>
              </div>
              <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-titanium-600">
                Teklif yok
              </div>
            </div>
          ))}
        </div>
      </section>

      <Panel title="Planlanan yetenekler" subtitle="Bu modül için yol haritası" className="mt-6">
        <FeatureList
          items={[
            { icon: BadgePercent, title: 'Fiyatlandırma kuralları', description: 'Birim fiyat, işçilik, kâr ve iskonto parametreleri.' },
            { icon: History, title: 'Revizyon geçmişi', description: 'Her teklif sürümünün değişiklikleriyle birlikte saklanması.' },
            { icon: Stamp, title: 'Kurumsal PDF', description: 'LEONX Metal antetli, imzalı teklif çıktıları.' },
            { icon: Send, title: 'Gönderim takibi', description: 'Teklifin gönderim ve yanıt durumlarının izlenmesi.' },
          ]}
        />
      </Panel>
    </>
  )
}
