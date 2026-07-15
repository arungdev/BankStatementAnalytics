// Minimal service worker — its only job is to make the app installable as a PWA so that
// desktop notifications are attributed to "BankStatement Analytics" (with its icon) instead
// of the generic browser. It deliberately does NOT cache anything; every request falls
// through to the network, so it can't serve a stale app.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// A fetch handler must exist for the browser to treat the app as installable.
// Passthrough only — no caching.
self.addEventListener('fetch', () => { /* default network handling */ });

// If a reminder toast is clicked, focus an existing app window or open one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/bills');
    })
  );
});
