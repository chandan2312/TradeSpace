// MT5 bridge proxy + in-memory caches (symbols list, rates).
// Caches live on globalThis so HMR in dev doesn't wipe them.
const g = globalThis;

export const BRIDGE_URL = (
  process.env.NEXUS_MT5_REMOTE_URL ||
  process.env.AUTONOMOUS_MT5_REMOTE_URL ||
  process.env.MT5_BRIDGE_URL ||
  "http://127.0.0.1:8765"
).replace(/\/$/, "");

export function getBridgeToken() {
  return (
    process.env.NEXUS_MT5_REMOTE_TOKEN ||
    process.env.AUTONOMOUS_MT5_REMOTE_TOKEN ||
    process.env.MT5_TOKEN ||
    process.env.MT5_BRIDGE_TOKEN ||
    ""
  );
}

// 15s default: a hung bridge must not stall the 3s alert poll loop for a minute.
export async function bridge(method, path, payload, { timeoutMs = 15_000 } = {}) {
  const token = getBridgeToken();
  const res = await fetch(`${BRIDGE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: method === "POST" ? JSON.stringify(payload || {}) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    return {
      ok: false,
      status: res.status,
      message: parsed?.message || parsed?.error || text || `HTTP ${res.status}`,
    };
  }
  return res.json();
}

if (!g._tsSymCache) g._tsSymCache = { at: 0, items: [] };
if (!g._tsRatesCache) g._tsRatesCache = new Map();

export const symbolsCache = g._tsSymCache;
export const ratesCache = g._tsRatesCache;
export const RATES_TTL_MS = 15_000;
export const SYMBOLS_TTL_MS = 5 * 60_000;
