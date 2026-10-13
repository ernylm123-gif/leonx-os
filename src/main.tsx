import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AuthProvider } from './context/auth'
import { PreferencesProvider } from './context/preferences'
import { ToastProvider } from './context/toast'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreferencesProvider>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </PreferencesProvider>
  </StrictMode>,
)
