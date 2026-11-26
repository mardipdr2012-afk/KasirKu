/* KasirKu — service worker.
   Tugas: (1) app shell tersimpan agar aplikasi terbuka instan & tetap terbuka saat offline,
          (2) TIDAK PERNAH menyentuh panggilan API Apps Script (data selalu langsung ke server),
          (3) pembaruan: file diperbarui di latar belakang, pengguna diberi tahu lewat banner. */
const VERSI = 'kasirku-shell-v3';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/config.js', 'js/app.js', 'js/pwa.js',
  'js/struk-engine.js', 'js/struk-printer.js', 'js/struk-ui.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];
const LUAR_BOLEH = /^(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)$/;
const API = /(^|\.)(script\.google\.com|script\.googleusercontent\.com|googleusercontent\.com)$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSI).then((c) => Promise.all(SHELL.map((u) =>
    fetch(new Request(u, { cache: 'reload' })).then((r) => (r.ok ? c.put(u, r) : null)).catch(() => null)))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('kasirku-') && k !== VERSI).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

/* cache dulu, perbarui di latar belakang (stale-while-revalidate) */
function swr(req, kunci) {
  return caches.open(VERSI).then((c) => c.match(kunci || req, { ignoreSearch: true }).then((hit) => {
    const net = fetch(req).then((r) => { if (r && (r.ok || r.type === 'opaque')) c.put(kunci || req, r.clone()); return r; }).catch(() => null);
    return hit || net.then((r) => r || Response.error());
  }));
}
/* jaringan dulu, cadangan cache (untuk config.js: alamat server harus selalu yang terbaru) */
function netFirst(req) {
  return fetch(req).then((r) => { if (r.ok) caches.open(VERSI).then((c) => c.put(req, r.clone())); return r; })
    .catch(() => caches.match(req, { ignoreSearch: true }).then((h) => h || Response.error()));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (API.test(u.hostname)) return;                       // API & data: langsung ke jaringan, tanpa cache
  if (u.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      if (u.pathname.endsWith('/verifikasi.html')) return; // halaman publik: selalu segar
      e.respondWith(swr(req, 'index.html').then((r) => r || caches.match('./')));
      return;
    }
    if (u.pathname.endsWith('/js/config.js')) { e.respondWith(netFirst(req)); return; }
    e.respondWith(swr(req));
    return;
  }
  if (LUAR_BOLEH.test(u.hostname)) e.respondWith(swr(req));
});
