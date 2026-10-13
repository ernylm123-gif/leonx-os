import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AuthProvider } from './context/auth'
import { PreferencesProvider } from './context/preferences'
import { ToastProvider } from './context/toast'
import { UpdateProvider } from './context/update'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreferencesProvider>
      <AuthProvider>
        <ToastProvider>
          <UpdateProvider>
            <App />
          </UpdateProvider>
        </ToastProvider>
      </AuthProvider>
    </PreferencesProvider>
  </StrictMode>,
)
