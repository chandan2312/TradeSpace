// Shared fixture loading — used by the exporter and any parity tooling.
// Mirrors lib/telemetry/replay.mjs slicing exactly, so fixtures represent the
// bars the real replay engine would have fed the bias engine at that moment.

import fs from "fs";
import path from "path";

export const ARCHIVE_DIR = path.resolve("data/dukascopy");
export const SPEC_COUNTS = { M15: 320, H1: 240, H4: 200, D1: 80 };

// A spread of regimes: majors, a JPY cross, a non-USD cross.
export const FIXTURE_SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "AUDNZD", "GBPJPY"];

// Bar offsets back from the end of the archive — different market conditions.
export const CUT_OFFSETS = [0, 1500, 7000, 20000];

const cache = new Map();

function loadArchive(symbol) {
  if (cache.has(symbol)) return cache.get(symbol);
  const p = path.join(ARCHIVE_DIR, `${symbol}.json`);
  const data = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
  cache.set(symbol, data);
  return data;
}

// Reference clock: EURUSD M15 timestamps, so every symbol is cut at the same
// instant (exactly how a real scanner sweep sees the market).
export function targetTimeFor(cut) {
  const ref = loadArchive("EURUSD");
  if (!ref) return null;
  const idx = ref.M15.length - 1 - cut;
  return idx >= 0 ? ref.M15[idx].time : null;
}

export function sliceUpTo(bars, targetTime, maxCount) {
  if (!bars || !bars.length) return [];
  let low = 0, high = bars.length - 1, endIdx = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (bars[mid].time <= targetTime) { endIdx = mid; low = mid + 1; }
    else high = mid - 1;
  }
  if (endIdx < 0) return [];
  return bars.slice(Math.max(0, endIdx - maxCount + 1), endIdx + 1);
}

// D1 is not in the archive; derive it from H4 so the D1-dependent code paths
// (prior-week levels, D1 structure) are still exercised by the fixtures.
function deriveD1(h4) {
  const byDay = new Map();
  for (const b of h4) {
    const k = Math.floor(b.time / 86400);
    const d = byDay.get(k);
    if (!d) byDay.set(k, { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, v: b.v || 0 });
    else {
      d.high = Math.max(d.high, b.high);
      d.low = Math.min(d.low, b.low);
      d.close = b.close;
      d.time = b.time;
      d.v += b.v || 0;
    }
  }
  return [...byDay.values()].sort((a, b) => a.time - b.time);
}

export function loadFrames(symbol, cut) {
  const data = loadArchive(symbol);
  const t = targetTimeFor(cut);
  if (!data || t == null) return null;
  const M15 = sliceUpTo(data.M15, t, SPEC_COUNTS.M15);
  const H1 = sliceUpTo(data.H1, t, SPEC_COUNTS.H1);
  const H4 = sliceUpTo(data.H4, t, SPEC_COUNTS.H4);
  if (M15.length < 50 || H1.length < 50 || H4.length < 50) return null;
  const D1 = deriveD1(sliceUpTo(data.H4, t, SPEC_COUNTS.H4 * 6)).slice(-SPEC_COUNTS.D1);
  return { M15, H1, H4, D1 };
}
