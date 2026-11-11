import { bridge, ratesCache } from "../bridge.js";
import { toBrokerSymbol, toCanonicalSymbol } from "../symbols/mapping.js";
import { brokerTimestampToUtcMs, timestampToUtcMs } from "../time.js";
import { normalizeCandles } from "../candleNormalization.js";

export { brokerTimestampToUtcMs, timestampToUtcMs };

// Robust closed-bar frames for the bias and autonomous engines.
// Supports per-TF TTL caching, closed-only validation, and UTC timestamp normalization.
export const FRAME_SPEC = {
  D1:  { ttl: 600_000, count: 80,  seconds: 86400 },
  H4:  { ttl: 180_000, count: 140, seconds: 14400 },
  H1:  { ttl: 60_000,  count: 180, seconds: 3600 },
  M30: { ttl: 45_000,  count: 200, seconds: 1800 },
  M15: { ttl: 30_000,  count: 240, seconds: 900 },
  M5:  { ttl: 15_000,  count: 250, seconds: 300 },
  M1:  { ttl: 5_000,   count: 200, seconds: 60 },
};

const MAX_BARS_CACHE_KEYS = 300;
const cache = (globalThis._tsClosedBiasBars ||= new Map());
const inFlight = (globalThis._tsInFlightBiasBars ||= new Map());

function setBarsCache(key, value) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_BARS_CACHE_KEYS) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
    else break;
  }
}



export function normalizeClosedBars(rawBars, tf, options = {}) {
  const spec = FRAME_SPEC[tf];
  if (!spec) throw new Error(`Unsupported bias timeframe: ${tf}`);
  const nowMs = new Date(options.now ?? Date.now()).getTime();
  const dedup = new Map();
  for (const raw of rawBars || []) {
    const semantics = raw.timestampSemantics || options.timestampSemantics || process.env.MT5_TIMESTAMP_SEMANTICS || "BROKER_NAIVE";
    const rawTime = raw.t ?? raw.time;
    const openMs = timestampToUtcMs(rawTime, { ...options, timestampSemantics: semantics });
    const numericTime = Number(rawTime);
    const naiveCloseMs = Number.isFinite(numericTime) ? (numericTime < 1e11 ? numericTime * 1000 : numericTime) + spec.seconds * 1000 : NaN;
    const closeMs = raw.closeTime != null
      ? timestampToUtcMs(raw.closeTime, { ...options, timestampSemantics: semantics })
      : semantics === "BROKER_NAIVE"
        ? timestampToUtcMs(naiveCloseMs, { ...options, timestampSemantics: semantics })
        : openMs + spec.seconds * 1000;
    const bar = {
      time: openMs / 1000,
      closeTime: closeMs / 1000,
      open: Number(raw.o ?? raw.open),
      high: Number(raw.h ?? raw.high),
      low: Number(raw.l ?? raw.low),
      close: Number(raw.c ?? raw.close),
      v: Number(raw.tick_volume ?? raw.v ?? raw.volume ?? 0),
      closed: true,
      timestampSemantics: "UTC_INSTANT",
    };
    if (!Number.isFinite(openMs) || !Number.isFinite(closeMs) || closeMs > nowMs + 60_000 || raw.closed === false || raw.isClosed === false) continue;
    if (![bar.open, bar.high, bar.low, bar.close].every((x) => Number.isFinite(x) && x > 0)) continue;
    if (bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close) || bar.high < bar.low) continue;
    dedup.set(bar.time, bar);
  }
  return [...dedup.values()].sort((a, b) => a.time - b.time);
}

async function loadFrame(symbol, tf, options) {
  const spec = FRAME_SPEC[tf];
  if (!spec) throw new Error(`Unsupported bias timeframe: ${tf}`);
  const nowMs = new Date(options.now ?? Date.now()).getTime();
  const semantics = options.timestampSemantics || process.env.MT5_TIMESTAMP_SEMANTICS || "BROKER_NAIVE";
  const key = `${symbol}:${tf}:${semantics}:${options.brokerUtcOffsetMinutes ?? options.brokerTimeZone ?? "default"}`;
  const hit = cache.get(key);
  if (!options.forceRefresh && hit && nowMs >= hit.at && nowMs - hit.at < spec.ttl) {
    cache.delete(key);
    cache.set(key, hit);
    return { ...hit, source: "cache" };
  }

  // Check Unified Shared Rates Cache (populated by charts or previous scans)
  const canonSym = toCanonicalSymbol(symbol);
  const brokerSym = toBrokerSymbol(symbol);
  const sharedKey = `${canonSym}:${tf}:live`;
  const sharedHit = ratesCache.get(sharedKey) || ratesCache.get(`${brokerSym}:${tf}:live`);
  if (!options.forceRefresh && sharedHit?.data?.bars?.length && (nowMs - sharedHit.at < spec.ttl)) {
    const rawBars = sharedHit.data.bars;
    const bars = normalizeClosedBars(rawBars, tf, { ...options, now: nowMs, timestampSemantics: "UTC_INSTANT" });
    if (bars.length >= Math.min(spec.count * 0.75, 40)) {
      const result = { at: sharedHit.at, bars, symbolMeta: sharedHit.data.symbolMeta || null, source: "shared_rates_cache", error: null };
      setBarsCache(key, result);
      return result;
    }
  }

  if (inFlight.has(key)) return inFlight.get(key);

  const fetchPromise = (async () => {
    try {
      const reqCount = Math.max(spec.count, 500);
      const request = options.fetchRates || ((sym, timeframe, count) => bridge("POST", "/rates", { sym: toBrokerSymbol(sym), timeframe, count }, { timeoutMs: 3_000 }));
      let data = await request(symbol, tf, reqCount).catch((err) => ({ ok: false, message: err?.message || "fetch error" }));
      // If bridge returned empty or not connected and circuit is not open, retry once after 200ms
      if ((!data?.ok || !data.bars?.length) && !data?.circuitOpen) {
        await new Promise((r) => setTimeout(r, 200));
        data = await request(symbol, tf, reqCount).catch((err) => ({ ok: false, message: err?.message || "fetch error" }));
      }
      if (!data?.ok || !data.bars?.length) {
        const detail = data?.message || data?.error || (data?.status ? `status: ${data.status}` : "rates empty/unavailable");
        throw new Error(`Rates unavailable for ${symbol} ${tf} (${detail})`);
      }

      // Populate Unified Shared Rates Cache so user charts load instantly with zero duplicate MT5 calls
      let chartBars = data.bars.map((b) => ({
        ...b,
        t: brokerTimestampToUtcMs(b.t, { brokerTimeZone: "Europe/Athens" }),
      }));
      chartBars = normalizeCandles(chartBars, tf);
      const sharedData = {
        ok: true,
        bars: chartBars,
        timestampSemantics: "UTC_INSTANT",
        symbol: canonSym,
        brokerSymbol,
        symbolMeta: data.symbolMeta || data.meta || null,
      };
      ratesCache.set(sharedKey, { at: nowMs, data: sharedData });
      if (brokerSym !== canonSym) ratesCache.set(`${brokerSym}:${tf}:live`, { at: nowMs, data: sharedData });

      let bars = normalizeClosedBars(chartBars, tf, { ...options, timestampSemantics: "UTC_INSTANT" });
      if (!bars.length && chartBars.length) {
        bars = chartBars.map((b) => ({
          time: Math.floor(b.t / 1000),
          closeTime: Math.floor((b.t + spec.seconds * 1000) / 1000),
          open: Number(b.o ?? b.open),
          high: Number(b.h ?? b.high),
          low: Number(b.l ?? b.low),
          close: Number(b.c ?? b.close),
          v: Number(b.tick_volume ?? b.v ?? 0),
          closed: true,
          timestampSemantics: "UTC_INSTANT",
        })).filter((b) => Number.isFinite(b.open) && b.open > 0 && b.high >= b.low);
      }
      if (!bars.length) throw new Error(`No closed candles in snapshot for ${symbol} ${tf}`);
      const result = { at: nowMs, bars, symbolMeta: data.symbolMeta || data.meta || null, source: "bridge", error: null };
      setBarsCache(key, result);
      return result;
    } catch (error) {
      if (process.env.DEBUG_BRIDGE || options.debug) {
        console.warn(`[loadFrame] ${symbol} ${tf}:`, error.message);
      }
      return { at: hit?.at ?? null, bars: hit?.bars || null, symbolMeta: hit?.symbolMeta || null, source: "stale_cache", error: error.message };
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, fetchPromise);
  return fetchPromise;
}

export async function getBars(symbol, tf, options = {}) {
  return (await loadFrame(symbol, tf, options)).bars;
}

export async function getFrames(symbol, options = {}) {
  const nowMs = new Date(options.now ?? Date.now()).getTime();
  const tfs = options.timeframes || ["D1", "H4", "H1", "M30", "M15", "M5", ...(options.includeM1 ? ["M1"] : [])];
  const results = await Promise.all(tfs.map((tf) => loadFrame(symbol, tf, { ...options, now: nowMs })));
  const frames = {};
  const metadata = {};
  for (let i = 0; i < tfs.length; i++) {
    const tf = tfs[i], result = results[i], spec = FRAME_SPEC[tf];
    const bars = result.bars?.filter((bar) => bar.closeTime * 1000 <= nowMs + 60_000) || result.bars || null;
    frames[tf] = bars?.length ? bars : null;
    const lastClosedAt = bars?.at(-1)?.closeTime * 1000 || null;
    const realisticBarAge = Math.max(spec.seconds * 4 * 1000, 1800_000);
    const maxBarAgeMs = options.maxBarAgeMs?.[tf] ?? realisticBarAge;
    const maxFetchAgeMs = Math.max(spec.ttl * 20, 300_000);

    // Differentiate between real stale data vs normal market close (weekend/rollover):
    const d = new Date(nowMs);
    const day = d.getUTCDay();
    const h = d.getUTCHours();
    const isWeekend = (day === 5 && h >= 22) || day === 6 || (day === 0 && h < 21);
    const isFreshFromBridge = result.at && (nowMs - result.at < maxFetchAgeMs);
    const isStaleByAge = !isWeekend && lastClosedAt && (nowMs - lastClosedAt > maxBarAgeMs);
    const isStale = !!result.error || !lastClosedAt || (!isFreshFromBridge && isStaleByAge);

    metadata[tf] = {
      fetchedAt: result.at,
      lastClosedAt,
      source: result.source,
      error: result.error,
      closedOnly: true,
      stale: isStale,
      maxBarAgeMs,
      maxFetchAgeMs,
    };
  }
  frames.snapshot = {
    asOf: nowMs,
    symbol,
    semantics: "UTC_INSTANT",
    closedOnly: true,
    timeframes: metadata,
    stale: Object.values(metadata).some((meta) => meta.stale),
  };
  frames.symbolMeta = results.find((result) => result.symbolMeta)?.symbolMeta || options.symbolMeta || null;
  return frames;
}
