import { BadgePercent, FilePlus2, FileText, History, Send, Stamp } from 'lucide-react'
import { PlannedAction } from '@/components/ui/Button'
import { RoadmapPanel } from '@/components/ui/FeatureList'
import { PageHeader } from '@/components/ui/PageHeader'
import { PlannedNotice } from '@/components/ui/PlannedNotice'
import { MILESTONE } from '@/config/company'

const STAGES = ['Taslak', 'Gönderildi', 'Revizyon', 'Onaylandı', 'Reddedildi']

export function QuotesPage() {
  return (
    <>
      <PageHeader
        icon={FileText}
        code="M04"
        eyebrow="Ticari"
        title="Teklifler"
        description="Metraj ve birim fiyatlardan teklif oluşturma, revizyon takibi ve kurumsal PDF çıktıları."
        status="planned"
        actions={<PlannedAction icon={FilePlus2} label="Yeni teklif" phase={MILESTONE.quotes} />}
      />

      <PlannedNotice className="mb-6">
        Fiyatlandırma ve teklif hazırlama henüz geliştirilmedi. Sistemde kayıtlı teklif veya fiyat bilgisi yoktur.
      </PlannedNotice>

      <section aria-label="Teklif aşamaları" className="-mx-4 overflow-x-auto overscroll-x-contain px-4 pb-2 sm:mx-0 sm:px-0">
        <ol className="grid min-w-[720px] grid-cols-5 gap-3">
          {STAGES.map((s, i) => (
            <li key={s} className="card flex min-h-[220px] flex-col">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-subtle">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-sm font-semibold text-ink">{s}</span>
                </span>
                <span className="font-mono text-xs text-subtle" aria-label="Veri yok">
                  —
                </span>
              </div>
              <div className="m-3 flex flex-1 items-center justify-center rounded-xl border border-dashed border-line text-center text-xs text-subtle">
                Teklif yok
              </div>
            </li>
          ))}
        </ol>
      </section>

      <RoadmapPanel
        items={[
          { icon: BadgePercent, title: 'Fiyatlandırma kuralları', description: 'Birim fiyat, işçilik, kâr ve iskonto parametreleri.' },
          { icon: History, title: 'Revizyon geçmişi', description: 'Her teklif sürümünün değişiklikleriyle birlikte saklanması.' },
          { icon: Stamp, title: 'Kurumsal PDF', description: 'LEONX Metal antetli, imzalı teklif çıktıları.' },
          { icon: Send, title: 'Gönderim takibi', description: 'Teklifin gönderim ve yanıt durumlarının izlenmesi.' },
        ]}
      />
    </>
  )
}
