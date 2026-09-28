const CACHE_NAME = 'calgen-v5';
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './parser.js',
  './ics.js',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png'
];

// Install event: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate event: clean up outdated caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch event: Network-first for navigation, Cache-first / Stale-while-revalidate for assets
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Exclude APK files from Service Worker caching
  if (url.pathname.endsWith('.apk') || url.pathname.includes('/app/')) {
    event.respondWith(fetch(request));
    return;
  }

  // If share_target navigation (query params attached to root or index.html)
  if (url.origin === location.origin && (url.searchParams.has('text') || url.searchParams.has('title') || url.searchParams.has('url'))) {
    // Deliver index.html from cache or network
    event.respondWith(
      caches.match('./index.html', { ignoreSearch: true }).then((cached) => {
        return cached || caches.match('./', { ignoreSearch: true }).then((rootCached) => {
          return rootCached || fetch(request);
        });
      })
    );
    return;
  }

  // Same-origin static assets: stale-while-revalidate
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(() => {
          // Fallback to cached version if offline
          return cachedResponse;
        });

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // External requests: regular network fetch
  event.respondWith(fetch(request));
});
