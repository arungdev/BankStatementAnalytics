import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { AccountProvider } from './context/AccountContext'
import { AuthProvider } from './context/AuthContext'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <AccountProvider>
        <App />
      </AccountProvider>
    </AuthProvider>
  </StrictMode>,
)
