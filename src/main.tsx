import './bootstrap'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AuthProvider } from './context/auth'
import { PreferencesProvider } from './context/preferences'
import { ToastProvider } from './context/toast'
import { UpdateProvider } from './context/update'
import { markBooted } from './lib/bootSignal'
import './index.css'

/** İlk çizim tamamlandı: açılış korumasının "uygulama açılmadı" zamanlayıcısı durur */
function BootSignal() {
  useEffect(() => markBooted(), [])
  return null
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreferencesProvider>
      <AuthProvider>
        <ToastProvider>
          <UpdateProvider>
            <App />
            <BootSignal />
          </UpdateProvider>
        </ToastProvider>
      </AuthProvider>
    </PreferencesProvider>
  </StrictMode>,
)
