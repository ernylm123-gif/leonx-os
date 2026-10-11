import { BarChart3, ClipboardList, Factory, FileBarChart, FolderKanban, LineChart } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PlannedNotice } from '@/components/ui/PlannedNotice'
import { StatusPill } from '@/components/ui/StatusPill'

const REPORTS = [
  { icon: FolderKanban, title: 'Proje durum raporu', description: 'Aşamalarına göre aktif ve tamamlanan projeler.', source: 'Projeler' },
  { icon: LineChart, title: 'Teklif dönüşüm raporu', description: 'Gönderilen ve onaylanan tekliflerin oranı.', source: 'Teklifler' },
  { icon: ClipboardList, title: 'Malzeme ihtiyaç raporu', description: 'Onaylı işler için toplam malzeme ihtiyacı.', source: 'Metraj' },
  { icon: Factory, title: 'Üretim yükü raporu', description: 'Ürün gruplarına göre planlanan üretim.', source: 'Projeler' },
  { icon: FileBarChart, title: 'Firma bazlı rapor', description: 'Firma başına proje ve teklif geçmişi.', source: 'Firmalar' },
]

export function ReportsPage() {
  return (
    <>
      <PageHeader
        icon={BarChart3}
        eyebrow="Ticari"
        title="Raporlar"
        description="Proje, teklif, metraj ve üretim verilerinden yönetim raporları."
        status="planned"
      />

      <PlannedNotice className="mb-6">
        Raporlar, ilgili modüller veri üretmeye başladığında oluşturulabilecek. Şu anda raporlanacak kayıt yoktur.
      </PlannedNotice>

      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map(({ icon: Icon, title, description, source }) => (
          <li key={title} className="panel flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.07] bg-gradient-to-b from-anthracite-700 to-anthracite-800">
                <Icon className="h-[18px] w-[18px] text-silver-200" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <StatusPill tone="offline">Veri yok</StatusPill>
            </div>
            <h2 className="mt-4 text-sm font-semibold text-silver-50">{title}</h2>
            <p className="mt-1 flex-1 text-xs leading-relaxed text-titanium-400">{description}</p>
            <div className="mt-4 border-t border-white/[0.05] pt-3 text-[11px] text-titanium-500">Kaynak modül: {source}</div>
          </li>
        ))}
      </ul>
    </>
  )
}
