// Service worker : met en cache l'interface pour un démarrage rapide.
// Les données (Supabase, HubSpot, géocodage) ne sont jamais mises en cache ici.
const CACHE = 'carte-clients-v7';
const SHELL = ['./', './index.html', './style.css', './app.js', './config.js', './manifest.webmanifest', './icon.svg'];
const STATIC_HOSTS = /unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const same = url.origin === location.origin;
  // Tuiles de carte IGN (/wmts) mises en cache ; géocodage et itinéraires toujours en direct.
  const tile = url.hostname === 'data.geopf.fr' && url.pathname.startsWith('/wmts');
  if (!same && !tile && !STATIC_HOSTS.test(url.hostname)) return; // réseau direct (Supabase, API…)
  if (same) {
    // Interface : réseau d'abord (pour recevoir les mises à jour), cache si hors ligne.
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request)));
    return;
  }
  // Tuiles et bibliothèques : cache d'abord.
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  })));
});
