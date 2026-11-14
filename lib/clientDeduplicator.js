"use client";

/**
 * Institutional Client-Side In-Flight Request Deduplicator & Coalescer
 *
 * Automatically intercepts and coalesces concurrent identical GET requests
 * across all dashboard components (Dashboard, ChartPanel, Watchlist, Cockpit, etc.).
 *
 * Features:
 * 1. In-Flight Coalescing: When 2+ components request the exact same URL concurrently,
 *    they share the EXACT SAME in-flight Promise. Only 1 HTTP request is sent over the wire.
 * 2. Rapid-Burst Micro-Cache: Identical GET responses are cached for 1.5 seconds so rapid
 *    re-renders and tab switches return instantly (0ms) without hitting the server.
 * 3. Mutation-Aware Invalidation: Any POST, PATCH, PUT, or DELETE request immediately
 *    bypasses deduplication and purges cached GET responses for that endpoint path.
 */

if (typeof window !== "undefined" && !window._tsDeduplicatorInstalled) {
  window._tsDeduplicatorInstalled = true;
  const originalFetch = window.fetch;
  const inFlightGetMap = new Map();
  const recentCacheMap = new Map();

  window.fetch = async function (input, init = {}) {
    const method = (init.method || "GET").toUpperCase();
    const url = typeof input === "string" ? input : (input?.url || "");

    const isInternalApi = typeof url === "string" && (url.startsWith("/api/") || url.includes("/api/"));

    // Mutations (POST, PATCH, DELETE, PUT): execute immediately and invalidate cached GET responses
    if (!isInternalApi || method !== "GET") {
      if (isInternalApi) {
        const basePath = url.split("?")[0];
        for (const k of recentCacheMap.keys()) {
          if (k.startsWith(basePath)) recentCacheMap.delete(k);
        }
      }
      return originalFetch.apply(this, arguments);
    }

    const key = url;
    const now = Date.now();

    // 1. Instant Micro-Cache: return clone in 0ms if identical request completed in last 1500ms
    const cached = recentCacheMap.get(key);
    if (cached && now - cached.at < 1500) {
      return cached.res.clone();
    }

    // 2. In-Flight Coalescing: if identical request is currently pending, await that exact Promise
    if (inFlightGetMap.has(key)) {
      const inFlightPromise = inFlightGetMap.get(key);
      try {
        const res = await inFlightPromise;
        return res.clone();
      } catch (err) {
        // If the in-flight failed, fall through to retry
      }
    }

    // 3. Dispatch single network fetch and share with all concurrent callers
    const fetchPromise = (async () => {
      try {
        const res = await originalFetch.apply(window, [input, init]);
        if (res.ok) {
          if (recentCacheMap.size > 200) {
            const oldestKeys = Array.from(recentCacheMap.keys()).slice(0, 50);
            for (const k of oldestKeys) recentCacheMap.delete(k);
          }
          recentCacheMap.set(key, { at: Date.now(), res: res.clone() });
        }
        return res;
      } finally {
        inFlightGetMap.delete(key);
      }
    })();

    inFlightGetMap.set(key, fetchPromise);
    const res = await fetchPromise;
    return res.clone();
  };
}
