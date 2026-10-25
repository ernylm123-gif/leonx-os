import { Bot, FileText, LayoutGrid, MessageSquareText, Rss, Settings2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/ui/PageHeader'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { AssistantPanel } from '@/features/radar/AssistantPanel'
import { RadarDashboard } from '@/features/radar/RadarDashboard'
import { ReportsPanel } from '@/features/radar/ReportsPanel'
import { SettingsPanel } from '@/features/radar/SettingsPanel'
import { SourcesPanel } from '@/features/radar/SourcesPanel'
import { useRadarData } from '@/features/radar/shared'

type Section = 'panel' | 'raporlar' | 'asistan' | 'kaynaklar' | 'ayarlar'
const SECTIONS: { value: Section; label: string; icon: typeof Bot }[] = [
  { value: 'panel', label: 'Panel', icon: LayoutGrid },
  { value: 'raporlar', label: 'Raporlar', icon: FileText },
  { value: 'asistan', label: 'Asistan', icon: MessageSquareText },
  { value: 'kaynaklar', label: 'Kaynaklar', icon: Rss },
  { value: 'ayarlar', label: 'Ayarlar', icon: Settings2 },
]

/** LEONX AI — Proje ve İş Fırsatı Radarı */
export function AiPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('bolum') as Section | null
  const section: Section = raw && SECTIONS.some((s) => s.value === raw) ? raw : 'panel'
  const q = useRadarData()
  return (
    <>
      <PageHeader
        icon={Bot}
        code="M06"
        eyebrow="Mühendislik"
        title="LEONX AI"
        description="Proje ve iş fırsatı radarı: izinli kaynaklardan kapı, alüminyum/PVC, cephe, korkuluk ve metal imalat fırsatları. Kural tabanlı, açıklanabilir; doğrulanmış ve potansiyel bilgiler ayrı gösterilir."
        status="ready"
      />
      <div className="mb-6 max-w-2xl">
        <SegmentedControl name="Radar bölümü" value={section} options={SECTIONS} layoutId="radar-section" onChange={(v) => setParams(v === 'panel' ? {} : { bolum: v }, { replace: true })} />
      </div>
      {section === 'panel' && <RadarDashboard data={q.data} loading={q.loading} error={q.error} reload={() => void q.reload()} />}
      {section === 'raporlar' && <ReportsPanel />}
      {section === 'asistan' && <AssistantPanel data={q.data} />}
      {section === 'kaynaklar' && <SourcesPanel data={q.data} />}
      {section === 'ayarlar' && <SettingsPanel data={q.data} />}
    </>
  )
}
