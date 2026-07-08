import { bridge } from "../bridge.js";

// Multi-timeframe bar frames for the bias engine, with per-TF TTL caching so
// a watchlist refresh doesn't hammer the RDP bridge. HTF barely changes —
// cache it long; execution TFs stay fresh.
const g = globalThis;
if (!g._tsBiasBars) g._tsBiasBars = new Map(); // `${sym}:${tf}` -> { at, bars }
const cache = g._tsBiasBars;

const SPEC = {
  D1: { ttl: 600_000, count: 80 },
  H4: { ttl: 300_000, count: 200 },
  H1: { ttl: 180_000, count: 240 },
  M15: { ttl: 90_000, count: 320 },
};

export async function getBars(symbol, tf) {
  const key = `${symbol}:${tf}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < SPEC[tf].ttl) return hit.bars;
  const data = await bridge("POST", "/rates", { sym: symbol, timeframe: tf, count: SPEC[tf].count }, { timeoutMs: 20_000 });
  if (!data?.ok || !data.bars?.length) return hit?.bars || null; // stale beats nothing
  const bars = data.bars.map((b) => ({ time: b.t / 1000, open: b.o, high: b.h, low: b.l, close: b.c, v: b.tick_volume ?? 0 }));
  cache.set(key, { at: Date.now(), bars });
  return bars;
}

export async function getFrames(symbol) {
  const tfs = Object.keys(SPEC);
  const all = await Promise.all(tfs.map((tf) => getBars(symbol, tf).catch(() => null)));
  const frames = {};
  tfs.forEach((tf, i) => { frames[tf] = all[i]; });
  return frames;
}
