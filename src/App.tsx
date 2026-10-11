import { MotionConfig } from 'framer-motion'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { usePreferences } from '@/context/preferences'
import { AppLayout } from '@/layouts/AppLayout'
import { DashboardPage } from '@/pages/DashboardPage'

// Dashboard ilk açılışta hazır gelir; diğer modüller ihtiyaç anında yüklenir.
const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'projeler', lazy: () => import('@/pages/ProjectsPage').then((m) => ({ Component: m.ProjectsPage })) },
      { path: 'cad-analiz', lazy: () => import('@/pages/CadAnalysisPage').then((m) => ({ Component: m.CadAnalysisPage })) },
      { path: 'metraj', lazy: () => import('@/pages/QuantityPage').then((m) => ({ Component: m.QuantityPage })) },
      { path: 'teklifler', lazy: () => import('@/pages/QuotesPage').then((m) => ({ Component: m.QuotesPage })) },
      { path: 'firmalar', lazy: () => import('@/pages/CompaniesPage').then((m) => ({ Component: m.CompaniesPage })) },
      { path: 'leonx-ai', lazy: () => import('@/pages/AiPage').then((m) => ({ Component: m.AiPage })) },
      { path: 'raporlar', lazy: () => import('@/pages/ReportsPage').then((m) => ({ Component: m.ReportsPage })) },
      { path: 'ayarlar', lazy: () => import('@/pages/SettingsPage').then((m) => ({ Component: m.SettingsPage })) },
      { path: '*', lazy: () => import('@/pages/NotFoundPage').then((m) => ({ Component: m.NotFoundPage })) },
    ],
  },
])

export function App() {
  const { preferences } = usePreferences()
  return (
    <MotionConfig reducedMotion={preferences.reduceMotion ? 'always' : 'user'}>
      <RouterProvider router={router} />
    </MotionConfig>
  )
}
