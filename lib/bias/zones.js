import { findPivots } from "../patterns/core.js";

// Zone detectors for the bias engine (headless — no drawing metadata).
//
// Order block: the last opposite-direction candle before a displacement candle
// that breaks a confirmed swing — the origin of the move. Unmitigated OBs are
// zones price tends to react from; a close fully through the far side kills
// the zone. `tapped` = price has already traded back into it.
//
// FVG: same 3-candle imbalance rule as lib/patterns/fvg.js, with the same
// lifecycle — wick through the far side = filled (dropped), CLOSE through =
// inverted (iFVG, now works the other way), close back beyond the near side
// after inversion = reclaimed (dropped).

export function detectOrderBlocks(bars, avg, lookback = 120) {
  const n = bars.length;
  const start = Math.max(0, n - lookback);
  const right = 3;
  const { highs, lows } = findPivots(bars, 3, 3);

  let lastH = null;
  let lastL = null;
  let hIdx = 0;
  let lIdx = 0;
  const raw = [];
  for (let i = 0; i < n; i++) {
    // a pivot exists only once its right-window has printed
    while (hIdx < highs.length && highs[hIdx].i + right <= i) lastH = highs[hIdx++];
    while (lIdx < lows.length && lows[lIdx].i + right <= i) lastL = lows[lIdx++];
    if (i < start) continue;
    const b = bars[i];
    if (lastH && b.close > lastH.price && b.close - b.open >= 1.2 * avg) {
      const ob = lastOpposite(bars, i, 1);
      if (ob) raw.push({ dir: 1, top: ob.high, bottom: ob.low, i: ob.i, brokeAt: i });
      lastH = null;
    } else if (lastL && b.close < lastL.price && b.open - b.close >= 1.2 * avg) {
      const ob = lastOpposite(bars, i, -1);
      if (ob) raw.push({ dir: -1, top: ob.high, bottom: ob.low, i: ob.i, brokeAt: i });
      lastL = null;
    }
  }

  const out = [];
  for (const z of raw) {
    let tapped = false;
    let dead = false;
    for (let j = z.brokeAt + 1; j < n; j++) {
      const c = bars[j];
      if (z.dir === 1 ? c.close < z.bottom : c.close > z.top) { dead = true; break; }
      if (z.dir === 1 ? c.low <= z.top : c.high >= z.bottom) tapped = true;
    }
    if (!dead) out.push({ dir: z.dir, top: z.top, bottom: z.bottom, i: z.i, age: n - 1 - z.brokeAt, tapped });
  }
  return out.slice(-8);
}

// nearest opposite-direction candle before the displacement — the block itself
function lastOpposite(bars, breakI, dir) {
  for (let k = breakI - 1; k >= Math.max(0, breakI - 10); k--) {
    const b = bars[k];
    if (dir === 1 ? b.close < b.open : b.close > b.open) return { high: b.high, low: b.low, i: k };
  }
  return null;
}

export function fvgZones(bars, avg, lookback = 60) {
  const n = bars.length;
  const start = Math.max(2, n - lookback);
  const minGap = 0.35 * avg;
  const zones = [];
  for (let i = start; i < n; i++) {
    const a = bars[i - 2];
    const c = bars[i];
    if (c.low - a.high >= minGap) zones.push({ dir: 1, top: c.low, bottom: a.high, i });
    else if (a.low - c.high >= minGap) zones.push({ dir: -1, top: a.low, bottom: c.high, i });
  }

  const out = [];
  for (const z of zones) {
    let state = "open";
    let invertedAt = null;
    let dead = false;
    for (let j = z.i + 1; j < n && !dead; j++) {
      const b = bars[j];
      if (state === "open") {
        if (z.dir === 1 ? b.close < z.bottom : b.close > z.top) {
          state = "inverted";
          invertedAt = j;
        } else if (z.dir === 1 ? b.low <= z.bottom : b.high >= z.top) {
          dead = true; // wick filled the gap
        }
      } else if (z.dir === 1 ? b.close > z.top : b.close < z.bottom) {
        dead = true; // inversion reclaimed
      }
    }
    if (!dead) out.push({ ...z, age: n - 1 - z.i, state, invertedAt });
  }
  return out;
}
