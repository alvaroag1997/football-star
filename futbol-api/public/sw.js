/* Equilibrio FC · Service worker de notificaciones push (v1.5)
 * Recibe las notificaciones aunque la app esté cerrada y las muestra como cualquier app
 * (pantalla de bloqueo, barra de notificaciones). Al tocarla, abre el chat o el partido. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Equilibrio FC', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Equilibrio FC';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),   // si sustituye a otra (mismo chat), vuelve a sonar/vibrar
      vibrate: [80, 40, 80],
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (app) {
      // La app ya está abierta: se le pide que navegue sin recargar
      app.postMessage({ type: 'open', url });
      return app.focus();
    }
    return self.clients.openWindow(url);
  })());
});

// Si el navegador renueva la suscripción, la app la volverá a registrar al abrirse.
self.addEventListener('pushsubscriptionchange', () => {});
