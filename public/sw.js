const CACHE_NAME = "tradespace-cache-v2"; // bump = old frozen caches purged on activate

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : undefined)))
      ),
    ])
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // NEVER touch WebSockets, API requests, or non-GET
  if (
    e.request.method !== "GET" ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/ws") ||
    url.protocol === "ws:" ||
    url.protocol === "wss:"
  ) {
    return; // browser handles it natively
  }

  // Network-first for EVERYTHING cacheable, cache fallback when offline.
  // Cache-first froze dev chunks (/_next/static/ names aren't hashed in dev),
  // silently pinning old app code — freshness beats latency for a live
  // trading app; the cache exists only to open the shell offline.
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        if (response.status === 200 && (url.origin === self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
