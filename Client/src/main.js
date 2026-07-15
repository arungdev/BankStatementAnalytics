import './index.css'

// Register the PWA service worker so the app can be installed and desktop notifications
// are attributed to "BankStatement Analytics" rather than the browser. Best-effort only.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* ignore */ })
  })
}

import('./main.jsx')
