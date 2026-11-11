// MT5 bridge proxy + in-memory caches (symbols list, rates).
// Caches live on globalThis so HMR in dev doesn't wipe them.
const g = globalThis;

export function getBridgeUrl() {
  return (
    g._tsBridgeUrlOverride ||
    process.env.NEXUS_MT5_REMOTE_URL ||
    process.env.AUTONOMOUS_MT5_REMOTE_URL ||
    process.env.MT5_BRIDGE_URL ||
    "http://127.0.0.1:8765"
  ).replace(/\/$/, "");
}

export const BRIDGE_URL = getBridgeUrl();

export function getBridgeToken() {
  return (
    process.env.NEXUS_MT5_REMOTE_TOKEN ||
    process.env.AUTONOMOUS_MT5_REMOTE_TOKEN ||
    process.env.MT5_TOKEN ||
    process.env.MT5_BRIDGE_TOKEN ||
    ""
  );
}

if (!g._tsBridgeCircuit) {
  g._tsBridgeCircuit = {
    isOpen: false,
    failures: 0,
    lastFailureTime: 0,
    lastSuccessTime: 0,
    lastProbeTime: 0,
    errorMessage: "",
  };
}

if (!g._tsInFlightBridge) {
  g._tsInFlightBridge = new Map();
}

const CIRCUIT_COOLDOWN_MS = 8_000;
const PROBE_TIMEOUT_MS = 1_000;
const DEFAULT_BRIDGE_TIMEOUT_MS = 2_500;

export function getBridgeStatus() {
  const circuit = g._tsBridgeCircuit;
  const now = Date.now();
  return {
    url: getBridgeUrl(),
    isOpen: !!circuit?.isOpen,
    failures: circuit?.failures || 0,
    lastFailure: circuit?.lastFailureTime ? new Date(circuit.lastFailureTime).toISOString() : null,
    lastSuccess: circuit?.lastSuccessTime ? new Date(circuit.lastSuccessTime).toISOString() : null,
    errorMessage: circuit?.errorMessage || null,
    cooldownRemainingMs: circuit?.isOpen ? Math.max(0, CIRCUIT_COOLDOWN_MS - (now - (circuit?.lastFailureTime || 0))) : 0,
  };
}

// 2.5s default: ultra-responsive fast fail prevents Next.js socket pool exhaustion and event-loop lag.
export async function bridge(method, path, payload, { timeoutMs = DEFAULT_BRIDGE_TIMEOUT_MS } = {}) {
  const url = getBridgeUrl();
  const token = getBridgeToken();
  const circuit = g._tsBridgeCircuit;
  const now = Date.now();

  // Circuit Breaker Fast-Fail (0ms)
  if (circuit.isOpen) {
    const elapsed = now - (circuit.lastFailureTime || 0);
    const probeElapsed = now - (circuit.lastProbeTime || 0);
    const canProbe = elapsed > CIRCUIT_COOLDOWN_MS && probeElapsed > CIRCUIT_COOLDOWN_MS;

    if (!canProbe) {
      return {
        ok: false,
        status: 503,
        circuitOpen: true,
        message: `Bridge offline (${circuit.errorMessage || "circuit open"})`,
        url,
      };
    }

    // Allow this single request to act as a probe with a tight 1s timeout
    circuit.lastProbeTime = now;
    timeoutMs = Math.min(timeoutMs, PROBE_TIMEOUT_MS);
  }

  // Idempotent Read Operations In-Flight Coalescing (Single-Flight)
  // Ensures identical concurrent reads share the same active network request
  const isReadOnly =
    method === "GET" ||
    (method === "POST" &&
      [
        "/ticks",
        "/rates",
        "/bulk_rates",
        "/account",
        "/state",
        "/positions",
        "/orders",
        "/history",
        "/symbols",
        "/symbol",
        "/health",
        "/ping_timeframes",
        "/calc_profit",
      ].includes(path));

  const flightKey = isReadOnly ? `${url}:${method}:${path}:${payload ? JSON.stringify(payload) : ""}` : null;
  if (flightKey && g._tsInFlightBridge.has(flightKey)) {
    const cached = await g._tsInFlightBridge.get(flightKey);
    return cached && typeof cached === "object" ? (Array.isArray(cached) ? [...cached] : { ...cached }) : cached;
  }

  const executeFetch = async () => {
    try {
      const res = await fetch(`${url}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Connection": "close",
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
          url,
        };
      }

      const data = await res.json();
      // Successful response: reset circuit breaker
      circuit.isOpen = false;
      circuit.failures = 0;
      circuit.lastSuccessTime = Date.now();
      circuit.errorMessage = "";
      return data;
    } catch (err) {
      const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
      const msg = isTimeout ? `bridge timeout (${timeoutMs}ms)` : `bridge fetch failed: ${err?.message || "connection error"}`;
      circuit.failures += 1;
      circuit.lastFailureTime = Date.now();
      circuit.errorMessage = msg;

      // Trip circuit on 2 consecutive connection failures / timeouts to protect server event loop
      if (circuit.failures >= 2) {
        circuit.isOpen = true;
      }

      return {
        ok: false,
        status: isTimeout ? 504 : 503,
        circuitOpen: circuit.isOpen,
        message: msg,
        url,
      };
    }
  };

  if (!flightKey) return executeFetch();

  const flightPromise = executeFetch();
  g._tsInFlightBridge.set(flightKey, flightPromise);
  try {
    const data = await flightPromise;
    return data && typeof data === "object" ? (Array.isArray(data) ? [...data] : { ...data }) : data;
  } finally {
    g._tsInFlightBridge.delete(flightKey);
  }
}

// Bounded LRU cache ensuring memory never clogs from historical scroll pagination or dense frame scans
export class BoundedRatesCache extends Map {
  constructor(maxSize = 250) {
    super();
    this.maxSize = maxSize;
  }

  set(key, value) {
    if (this.has(key)) {
      this.delete(key);
    } else if (this.size >= this.maxSize) {
      const now = Date.now();
      let evicted = false;
      for (const [k, v] of this.entries()) {
        const at = v?.at || 0;
        const ttl = k.includes(":history:") ? 3600_000 : (RATES_TTL_MS || 60_000);
        if (now - at > ttl) {
          this.delete(k);
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        const oldestKey = this.keys().next().value;
        if (oldestKey !== undefined) this.delete(oldestKey);
      }
    }
    return super.set(key, value);
  }
}

if (!g._tsSymCache) g._tsSymCache = { at: 0, items: [] };
if (!g._tsRatesCache || !(g._tsRatesCache instanceof BoundedRatesCache)) {
  const existing = g._tsRatesCache;
  g._tsRatesCache = new BoundedRatesCache(250);
  if (existing && typeof existing.forEach === "function") {
    existing.forEach((v, k) => g._tsRatesCache.set(k, v));
  }
}

export const symbolsCache = g._tsSymCache;
export const ratesCache = g._tsRatesCache;
export const RATES_TTL_MS = 15_000;
export const SYMBOLS_TTL_MS = 5 * 60_000;
