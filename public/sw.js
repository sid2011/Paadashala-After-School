// Paadashala Service Worker for Background Push Notifications
self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', function (event) {
  let title = 'Paadashala After School';
  let body = 'നിങ്ങൾക്ക് പുതിയ നോട്ടിഫിക്കേഷൻ വന്നിട്ടുണ്ട്.';
  let icon = '/images/apple-touch-icon.png';
  let badge = '/images/favicon-96x96.png';
  let url = '/';

  if (event.data) {
    try {
      const data = event.data.json();
      title = data.title || title;
      body = data.body || body;
      icon = data.icon || icon;
      badge = data.badge || badge;
      url = data.url || url;
    } catch (e) {
      body = event.data.text();
    }
  }

  const options = {
    body: body,
    icon: icon,
    badge: badge,
    vibrate: [200, 100, 200],
    data: { url: url },
    actions: [
      { action: 'open', title: 'തുറക്കുക (Open)' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
