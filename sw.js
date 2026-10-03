const CACHE_NAME = 'fleemarket-cache-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './10_Player_Flee_Items_Database_Complete.csv'
];

// Install Event: Safely cache essential files individually without crashing on missing assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        ASSETS_TO_CACHE.map((url) => {
          return fetch(url).then((response) => {
            if (!response.ok) throw new Error(`Request failed for ${url}`);
            return cache.put(url, response);
          }).catch((err) => {
            console.warn('Skipping optional cache asset:', err);
          });
        })
      );
    })
  );
  self.skipWaiting();
});

// Activate Event: Clean up old stale caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch Event: Serve from cache first, fallback to network
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached asset and update cache in background
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        return caches.match('./index.html');
      });
    })
  );
});
