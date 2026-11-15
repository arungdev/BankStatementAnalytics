// Apply the saved theme before rendering; served from this application's origin.
try {
  var preference = JSON.parse(localStorage.getItem('themePreference') || '"system"');
  if (preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches))
    document.documentElement.dataset.theme = 'dark';
} catch { /* Storage may be unavailable. */ }
