// Studyloop Service Worker: immer frisch laden (Updates kommen von selbst), offline Kopie, Web Push.
const CACHE = 'studyloop-v8';
const CORE = ['./', 'index.html', 'css/app.css', 'vendor/supabase.js', 'js/app.js', 'js/store.js', 'js/schedule.js', 'js/ui.js', 'js/icons.js',
  'js/views.js', 'js/editors.js', 'js/settings.js', 'js/auth.js', 'js/push.js', 'js/ctx.js', 'js/presets.js', 'js/config.js', 'js/apple.js', 'js/inbox.js', 'js/overview.js',
  'icons/icon-192.png', 'icons/apple-touch-icon.png', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  // Zahl am App-Symbol kommt vom Server mit (ungelesene Mitteilungen)
  const badge = typeof d.badge === 'number' && 'setAppBadge' in self.navigator
    ? (d.badge > 0 ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()).catch(() => {})
    : Promise.resolve();
  e.waitUntil(Promise.all([badge, self.registration.showNotification(d.title || 'Studyloop', {
    body: d.body || '',
    tag: d.tag || undefined,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: d.url || './', key: d.tag || null },
  })]));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const key = e.notification.data?.key || null;
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope)) {
        await c.focus();
        c.postMessage({ type: 'open', url, key });
        return;
      }
    }
    // App war zu: Schlüssel im Link mitgeben, damit die Mitteilung als gelesen gilt
    const u = new URL(url);
    if (key) u.hash = (u.hash ? u.hash + '&' : '#') + 'n=' + encodeURIComponent(key);
    await self.clients.openWindow(u.href);
  })());
});
