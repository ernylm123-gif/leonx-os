import { MotionConfig } from 'framer-motion'
import { createBrowserRouter, RouterProvider, useRouteError } from 'react-router-dom'
import { RequireAuth } from '@/components/layout/RequireAuth'
import { usePreferences } from '@/context/preferences'
import { AppLayout } from '@/layouts/AppLayout'
import { DashboardPage } from '@/pages/DashboardPage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { RouteErrorFallback } from '@/context/update'

function RouteError() {
  return <RouteErrorFallback error={useRouteError()} />
}

// Giriş sayfası herkese açıktır; diğer tüm rotalar RequireAuth ile korunur.
// Dashboard ilk açılışta hazır gelir; diğer modüller ihtiyaç anında yüklenir.
const router = createBrowserRouter([
  { path: '/giris', element: <LoginPage />, errorElement: <RouteError /> },
  {
    path: '/',
    errorElement: <RouteError />,
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      {
        // Sayfa hataları yerleşim (menü) korunarak gösterilir
        errorElement: <RouteError />,
        children: [
          { index: true, element: <DashboardPage /> },
          {
            path: 'projeler',
            lazy: () =>
              import('@/pages/ProjectsPage').then((m) => ({
                Component: m.ProjectsPage,
              })),
          },
          {
            path: 'projeler/:id',
            lazy: () =>
              import('@/pages/ProjectDetailPage').then((m) => ({
                Component: m.ProjectDetailPage,
              })),
          },
          {
            path: 'cad-analiz',
            lazy: () =>
              import('@/pages/CadAnalysisPage').then((m) => ({
                Component: m.CadAnalysisPage,
              })),
          },
          {
            path: 'metraj',
            lazy: () =>
              import('@/pages/QuantityPage').then((m) => ({
                Component: m.QuantityPage,
              })),
          },
          {
            path: 'teklifler',
            lazy: () =>
              import('@/pages/QuotesPage').then((m) => ({
                Component: m.QuotesPage,
              })),
          },
          {
            path: 'teklifler/:id',
            lazy: () =>
              import('@/pages/QuoteDetailPage').then((m) => ({
                Component: m.QuoteDetailPage,
              })),
          },
          {
            path: 'firmalar',
            lazy: () =>
              import('@/pages/CompaniesPage').then((m) => ({
                Component: m.CompaniesPage,
              })),
          },
          {
            path: 'firmalar/:id',
            lazy: () =>
              import('@/pages/CompanyDetailPage').then((m) => ({
                Component: m.CompanyDetailPage,
              })),
          },
          {
            path: 'leonx-ai',
            lazy: () => import('@/pages/AiPage').then((m) => ({ Component: m.AiPage })),
          },
          {
            path: 'raporlar',
            lazy: () =>
              import('@/pages/ReportsPage').then((m) => ({
                Component: m.ReportsPage,
              })),
          },
          {
            path: 'ayarlar',
            lazy: () =>
              import('@/pages/SettingsPage').then((m) => ({
                Component: m.SettingsPage,
              })),
          },
          {
            path: '*',
            lazy: () =>
              import('@/pages/NotFoundPage').then((m) => ({
                Component: m.NotFoundPage,
              })),
          },
        ],
      },
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
