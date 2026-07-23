const CACHE_NAME = 'deepseek-enhanced-assistant-v42-knowledge';
const APP_SHELL = [
  './',
  './index.html',
  './training.html',
  './demand/index.html',
  './demand/demand.css',
  './demand/demand.js',
  './knowledge/index.html',
  './knowledge/config.js',
  './knowledge/knowledge.css',
  './knowledge/knowledge.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './favicon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.url.includes('/chat/completions') || request.url.includes('api.deepseek.com')) {
    event.respondWith(fetch(request));
    return;
  }

  if (/\/(demand|knowledge)\/config\.js$/.test(new URL(request.url).pathname)) {
    event.respondWith(
      fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      }).catch(() => caches.match(request))
    );
    return;
  }

  if (request.method !== 'GET') return;

  const acceptsHtml = request.headers.get('accept')?.includes('text/html');
  const isNavigation = request.mode === 'navigate' || acceptsHtml;

  if (isNavigation) {
    event.respondWith(
      fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      }).catch(() => caches.match(request).then(cached => {
        if (cached) return cached;
        const path = new URL(request.url).pathname;
        if (path.includes('/demand/')) return caches.match('./demand/index.html');
        if (path.includes('/knowledge/')) return caches.match('./knowledge/index.html');
        return caches.match('./index.html');
      }))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
