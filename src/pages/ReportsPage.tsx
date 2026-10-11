import { BarChart3, ClipboardList, Factory, FileBarChart, FolderKanban, LineChart } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PlannedNotice } from '@/components/ui/PlannedNotice'
import { StatusPill } from '@/components/ui/StatusPill'

const REPORTS = [
  { code: 'R01', icon: FolderKanban, title: 'Proje durum raporu', description: 'Aşamalarına göre aktif ve tamamlanan projeler.', source: 'Projeler' },
  { code: 'R02', icon: LineChart, title: 'Teklif dönüşüm raporu', description: 'Gönderilen ve onaylanan tekliflerin oranı.', source: 'Teklifler' },
  { code: 'R03', icon: ClipboardList, title: 'Malzeme ihtiyaç raporu', description: 'Onaylı işler için toplam malzeme ihtiyacı.', source: 'Metraj' },
  { code: 'R04', icon: Factory, title: 'Üretim yükü raporu', description: 'Ürün gruplarına göre planlanan üretim.', source: 'Projeler' },
  { code: 'R05', icon: FileBarChart, title: 'Firma bazlı rapor', description: 'Firma başına proje ve teklif geçmişi.', source: 'Firmalar' },
]

export function ReportsPage() {
  return (
    <>
      <PageHeader
        icon={BarChart3}
        code="M07"
        eyebrow="Ticari"
        title="Raporlar"
        description="Proje, teklif, metraj ve üretim verilerinden yönetim raporları."
        status="planned"
      />

      <PlannedNotice className="mb-6">
        Raporlar, ilgili modüller veri üretmeye başladığında oluşturulabilecek. Şu anda raporlanacak kayıt yoktur.
      </PlannedNotice>

      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map(({ code, icon: Icon, title, description, source }) => (
          <li key={code} className="card flex min-w-0 flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface-2">
                <Icon className="h-[18px] w-[18px] text-titanium" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <StatusPill tone="offline">Veri yok</StatusPill>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-ink">{title}</h2>
              <span className="font-mono text-[10px] text-subtle">{code}</span>
            </div>
            <p className="mt-1 flex-1 text-xs leading-relaxed text-muted">{description}</p>
            {/* Boş grafik alanı — veri gelmeden çizim yapılmaz */}
            <div className="mt-4 flex h-16 items-end gap-1.5 border-b border-line" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((b) => (
                <span key={b} className="h-1 flex-1 rounded-t-sm bg-surface-3" />
              ))}
            </div>
            <div className="mt-3 text-[11px] text-subtle">Kaynak modül: {source}</div>
          </li>
        ))}
      </ul>
    </>
  )
}
