import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { AccountProvider } from './context/AccountContext'
import { AuthProvider } from './context/AuthContext'
import { PrivacyProvider } from './context/PrivacyContext'
import { ThemeProvider } from './context/ThemeContext'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <AccountProvider>
          <PrivacyProvider>
            <App />
          </PrivacyProvider>
        </AccountProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
