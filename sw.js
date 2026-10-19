// Offline cache for the app shell. User data is never cached here – it lives
// in the private on-device folder (OPFS) managed by js/store.js.
const VERSION = 'spancheck-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/store.js', 'js/data.js', 'js/img.js', 'js/markers.js', 'js/exporters.js',
  'vendor/jspdf.umd.min.js', 'vendor/jszip.min.js', 'vendor/exifr.lite.umd.js',
  'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/leaflet.js', 'vendor/leaflet.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // map tiles go straight to network
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
