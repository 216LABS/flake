// Office alerts. Shows pushes and opens the right page when tapped. It handles no fetches, so it can't affect the app.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message = { title: 'Flake', body: '', url: '/dashboard' };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    // A malformed push still tells the person to look.
  }
  event.waitUntil(self.registration.showNotification(message.title, { body: message.body, icon: '/icons/icon.svg', data: { url: message.url } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/dashboard', self.location.origin);
  // Only ever open our own pages.
  const target = url.origin === self.location.origin ? url.href : `${self.location.origin}/dashboard`;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url === target);
      return open ? open.focus() : self.clients.openWindow(target);
    }),
  );
});
