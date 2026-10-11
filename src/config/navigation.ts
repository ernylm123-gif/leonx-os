import {
  BarChart3,
  Bot,
  Building2,
  FileText,
  FolderKanban,
  LayoutDashboard,
  type LucideIcon,
  Ruler,
  ScanLine,
  Settings,
} from 'lucide-react'

export type ModuleStatus = 'ready' | 'planned'

export interface NavItem {
  path: string
  label: string
  /** Kısa açıklama — menü ipuçları ve komut paletinde kullanılır */
  description: string
  icon: LucideIcon
  group: 'genel' | 'muhendislik' | 'ticari' | 'sistem'
  /** Modülün iş mantığının durumu (arayüz her durumda hazırdır) */
  status: ModuleStatus
  /** Telefon alt çubuğunda gösterilsin mi */
  mobilePrimary?: boolean
}

export const NAV_GROUPS: Record<NavItem['group'], string> = {
  genel: 'Genel',
  muhendislik: 'Mühendislik',
  ticari: 'Ticari',
  sistem: 'Sistem',
}

export const NAV_ITEMS: NavItem[] = [
  {
    path: '/',
    label: 'Dashboard',
    description: 'Genel bakış ve sistem durumu',
    icon: LayoutDashboard,
    group: 'genel',
    status: 'ready',
    mobilePrimary: true,
  },
  {
    path: '/projeler',
    label: 'Projeler',
    description: 'Alüminyum, PVC, kapı, korkuluk, cephe ve metal imalat projeleri',
    icon: FolderKanban,
    group: 'genel',
    status: 'planned',
    mobilePrimary: true,
  },
  {
    path: '/cad-analiz',
    label: 'CAD Analiz',
    description: 'DWG / DXF çizim analizi',
    icon: ScanLine,
    group: 'muhendislik',
    status: 'planned',
    mobilePrimary: true,
  },
  {
    path: '/metraj',
    label: 'Metraj',
    description: 'Otomatik metraj ve malzeme listeleri',
    icon: Ruler,
    group: 'muhendislik',
    status: 'planned',
  },
  {
    path: '/teklifler',
    label: 'Teklifler',
    description: 'Fiyatlandırma ve teklif hazırlama',
    icon: FileText,
    group: 'ticari',
    status: 'planned',
    mobilePrimary: true,
  },
  {
    path: '/firmalar',
    label: 'Firmalar',
    description: 'Müşteri, tedarikçi ve iş ortakları',
    icon: Building2,
    group: 'ticari',
    status: 'planned',
  },
  {
    path: '/leonx-ai',
    label: 'LEONX AI',
    description: 'Yapay zekâ destekli asistan',
    icon: Bot,
    group: 'muhendislik',
    status: 'planned',
  },
  {
    path: '/raporlar',
    label: 'Raporlar',
    description: 'Proje, teklif ve üretim raporları',
    icon: BarChart3,
    group: 'ticari',
    status: 'planned',
  },
  {
    path: '/ayarlar',
    label: 'Ayarlar',
    description: 'Arayüz tercihleri ve sistem bilgisi',
    icon: Settings,
    group: 'sistem',
    status: 'ready',
  },
]

export function findNavItem(pathname: string): NavItem | undefined {
  if (pathname === '/') return NAV_ITEMS[0]
  return NAV_ITEMS.find((item) => item.path !== '/' && pathname.startsWith(item.path))
}
