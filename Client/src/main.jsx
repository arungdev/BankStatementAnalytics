import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Shared tokens and component styles first — index.css layers this app's own
// tokens and page styles on top and must win.
import '@common/client/styles.css'
import './index.css'
import App from './App'
import { AuthProvider, ThemeProvider } from '@common/client'
import api from './api/client'
import { AccountProvider } from './context/AccountContext'
import { PrivacyProvider } from './context/PrivacyContext'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider api={api}>
        <AccountProvider>
          <PrivacyProvider>
            <App />
          </PrivacyProvider>
        </AccountProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
