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
  /** Dar alanlarda (telefon alt navigasyonu) kullanılan kısa ad */
  shortLabel?: string
  /** Modül kodu — teknik başlıklarda gösterilir */
  code: string
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
    code: 'M00',
    label: 'Dashboard',
    description: 'Genel bakış ve sistem durumu',
    icon: LayoutDashboard,
    group: 'genel',
    status: 'ready',
    mobilePrimary: true,
  },
  {
    path: '/projeler',
    code: 'M01',
    label: 'Projeler',
    description: 'Alüminyum, PVC, kapı, korkuluk, cephe ve metal imalat projeleri',
    icon: FolderKanban,
    group: 'genel',
    status: 'ready',
    mobilePrimary: true,
  },
  {
    path: '/cad-analiz',
    code: 'M02',
    label: 'CAD Analiz',
    shortLabel: 'CAD',
    description: 'DXF çizim analizi, PDF ölçümü ve CAD görüntüleyici',
    icon: ScanLine,
    group: 'muhendislik',
    status: 'ready',
    mobilePrimary: true,
  },
  {
    path: '/metraj',
    code: 'M03',
    label: 'Metraj',
    description: 'Poz bazlı metraj, doğrulama, revizyon ve Excel/PDF',
    icon: Ruler,
    group: 'muhendislik',
    status: 'ready',
  },
  {
    path: '/teklifler',
    code: 'M04',
    label: 'Teklifler',
    description: 'Fiyatlandırma ve teklif hazırlama',
    icon: FileText,
    group: 'ticari',
    status: 'planned',
    mobilePrimary: true,
  },
  {
    path: '/firmalar',
    code: 'M05',
    label: 'Firmalar',
    description: 'Müşteri ve iş ortağı kayıtları, ilgili kişiler',
    icon: Building2,
    group: 'ticari',
    status: 'ready',
  },
  {
    path: '/leonx-ai',
    code: 'M06',
    label: 'LEONX AI',
    description: 'Yapay zekâ destekli asistan',
    icon: Bot,
    group: 'muhendislik',
    status: 'planned',
  },
  {
    path: '/raporlar',
    code: 'M07',
    label: 'Raporlar',
    description: 'Gerçek proje verilerinden özetler',
    icon: BarChart3,
    group: 'ticari',
    status: 'ready',
  },
  {
    path: '/ayarlar',
    code: 'M08',
    label: 'Ayarlar',
    description: 'Hesap, oturum, tema ve sistem bilgisi',
    icon: Settings,
    group: 'sistem',
    status: 'ready',
  },
]

export function findNavItem(pathname: string): NavItem | undefined {
  if (pathname === '/') return NAV_ITEMS[0]
  return NAV_ITEMS.find((item) => item.path !== '/' && pathname.startsWith(item.path))
}
