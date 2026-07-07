// MT5 bridge proxy + in-memory caches (symbols list, rates).
// Caches live on globalThis so HMR in dev doesn't wipe them.
const g = globalThis;

export const BRIDGE_URL = (
  process.env.NEXUS_MT5_REMOTE_URL ||
  process.env.MT5_BRIDGE_URL ||
  "http://127.0.0.1:8765"
).replace(/\/$/, "");

const BRIDGE_TOKEN = process.env.NEXUS_MT5_REMOTE_TOKEN || "";

// 15s default: a hung bridge must not stall the 3s alert poll loop for a minute.
export async function bridge(method, path, payload, { timeoutMs = 15_000 } = {}) {
  const res = await fetch(`${BRIDGE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(BRIDGE_TOKEN ? { Authorization: `Bearer ${BRIDGE_TOKEN}` } : {}),
    },
    body: method === "POST" ? JSON.stringify(payload || {}) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  return res.json();
}

if (!g._tsSymCache) g._tsSymCache = { at: 0, items: [] };
if (!g._tsRatesCache) g._tsRatesCache = new Map();

export const symbolsCache = g._tsSymCache;
export const ratesCache = g._tsRatesCache;
export const RATES_TTL_MS = 15_000;
export const SYMBOLS_TTL_MS = 5 * 60_000;
