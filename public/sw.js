// Stub service worker — required by Chrome for installability.
// ponytail: no caching, upgrade if you want offline.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
