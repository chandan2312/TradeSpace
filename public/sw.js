const CACHE_NAME = "tradespace-cache-v1";

const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/favicon.ico"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
  // Clear old caches
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // 1. NEVER cache WebSockets, API requests, or server-side dynamic routes
  if (
    e.request.method !== "GET" || 
    url.pathname.startsWith("/api/") || 
    url.pathname.startsWith("/ws") || 
    url.protocol === "ws:" || 
    url.protocol === "wss:"
  ) {
    return; // Let the browser handle it natively (bypasses SW)
  }

  // 2. Cache-First for Next.js immutable static assets (JS chunks, CSS)
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 3. Stale-While-Revalidate for other static assets (HTML, images, fonts)
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request).then((networkResponse) => {
        if (networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return networkResponse;
      }).catch(() => {
        // If offline and fetching fails, just return what we have (or undefined)
      });
      return cached || fetchPromise;
    })
  );
});
