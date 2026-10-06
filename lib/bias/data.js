import { bridge } from "../bridge.js";

// Robust closed-bar frames for the bias and autonomous engines.
// Supports per-TF TTL caching, closed-only validation, and UTC timestamp normalization.
export const FRAME_SPEC = {
  D1:  { ttl: 600_000, count: 100, seconds: 86400 },
  H4:  { ttl: 180_000, count: 220, seconds: 14400 },
  H1:  { ttl: 60_000,  count: 260, seconds: 3600 },
  M15: { ttl: 30_000,  count: 360, seconds: 900 },
  M5:  { ttl: 15_000,  count: 420, seconds: 300 },
  M1:  { ttl: 5_000,   count: 480, seconds: 60 },
};

const cache = (globalThis._tsClosedBiasBars ||= new Map());

export function timestampToUtcMs(value, options = {}) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && !/^\d+(\.\d+)?$/.test(value)) return Date.parse(value);
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  const rawMs = number < 1e11 ? number * 1000 : number;
  const semantics = options.timestampSemantics || process.env.MT5_TIMESTAMP_SEMANTICS || "BROKER_NAIVE";
  const nowMs = Number(options.now) || Date.now();
  const isBrokerTime = semantics === "BROKER_NAIVE" || rawMs > nowMs + 60_000;
  if (!isBrokerTime) return rawMs;
  if (options.brokerUtcOffsetMinutes != null && Number.isFinite(Number(options.brokerUtcOffsetMinutes))) {
    return rawMs - Number(options.brokerUtcOffsetMinutes) * 60000;
  }
  const zone = options.brokerTimeZone || process.env.MT5_BROKER_TIMEZONE || "Europe/Athens";
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  let utcMs = rawMs;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(formatter.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
    const localMs = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    utcMs += rawMs - localMs;
  }
  return utcMs;
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
  if (!options.forceRefresh && hit && nowMs >= hit.at && nowMs - hit.at < spec.ttl) return { ...hit, source: "cache" };
  try {
    const request = options.fetchRates || ((sym, timeframe, count) => bridge("POST", "/rates", { sym, timeframe, count }, { timeoutMs: 20_000 }));
    let data = await request(symbol, tf, spec.count).catch(() => null);
    if (!data?.ok || !data.bars?.length) {
      data = await bridge("POST", "/rates", { sym: symbol, timeframe: tf, count: spec.count }, { timeoutMs: 20_000 }).catch(() => null);
    }
    if (!data?.ok || !data.bars?.length) throw new Error(`Rates unavailable for ${symbol} ${tf}`);
    let bars = normalizeClosedBars(data.bars, tf, { ...options, timestampSemantics: data.timestampSemantics || semantics });
    if (!bars.length && data.bars?.length) {
      bars = data.bars.map((b) => ({
        time: Math.floor(timestampToUtcMs(b.t ?? b.time, { ...options, timestampSemantics: semantics }) / 1000),
        closeTime: Math.floor((timestampToUtcMs(b.t ?? b.time, { ...options, timestampSemantics: semantics }) + spec.seconds * 1000) / 1000),
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
    cache.set(key, result);
    return result;
  } catch (error) {
    console.warn(`[loadFrame] ${symbol} ${tf}:`, error.message);
    return { at: hit?.at ?? null, bars: hit?.bars || null, symbolMeta: hit?.symbolMeta || null, source: "stale_cache", error: error.message };
  }
}

export async function getBars(symbol, tf, options = {}) {
  return (await loadFrame(symbol, tf, options)).bars;
}

export async function getFrames(symbol, options = {}) {
  const nowMs = new Date(options.now ?? Date.now()).getTime();
  const tfs = options.timeframes || ["D1", "H4", "H1", "M15", "M5", ...(options.includeM1 ? ["M1"] : [])];
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
    metadata[tf] = {
      fetchedAt: result.at,
      lastClosedAt,
      source: result.source,
      error: result.error,
      closedOnly: true,
      stale: !!result.error || !lastClosedAt || (nowMs - lastClosedAt > maxBarAgeMs),
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
