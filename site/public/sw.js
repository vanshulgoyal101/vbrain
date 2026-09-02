// Service worker — offline app SHELL only.
//
// SECURITY: this caches only the static shell (HTML/JS/CSS/icon/marked). It NEVER
// caches /api/* (the private brain bundle + captures), /files/* (résumé PDFs),
// /mcp, or /healthz — so no personal content is ever written to disk. The brain
// content is fetched fresh over the network every time (gated by the Supabase token).
const CACHE = 'vbrain-shell-v1';
const SHELL = [
  '/', '/index.html', '/app.js', '/lib.js', '/styles.css',
  '/brain.svg', '/vendor/marked.min.js', '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never touch private/dynamic paths — always straight to the network.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/') || url.pathname === '/mcp' || url.pathname === '/healthz') return;

  // Shell: network-first (so updates land immediately), cache as offline fallback.
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
        return res;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match('/index.html'))),
  );
});
