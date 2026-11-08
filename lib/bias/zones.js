import { findPivots } from "../patterns/core.js";

// Zone Detectors for the Bias Engine & Institutional Execution Layer:
//
// Order Block (OB):
//   The origin candle of a structural break of a confirmed swing.
//   - Stale-Pivot Guard: Pivot is consumed on the FIRST close beyond it; cannot be re-broken bars later.
//   - Origin Selection: Identifies the true structural extreme candle of the move.
//   - Rich Lifecycle: Tracks unmitigated status, touch count, first-touch bar, 50% Mean Threshold (MT)
//     penetration depth, and clean invalidation / breaker conversion.
//   - Proximity Ranking: Ensures both Demand and Supply sides are balanced near live price (no naive slice(-8) bias).
//
// Fair Value Gap (FVG):
//   3-candle imbalance with Consequent Encroachment (CE = 50% gap level).
//   - Lifecycle: Open -> Tested/Partially Filled -> Fully Filled (Wick-through) OR Inverted (Close-through far boundary).
//   - Inversion (iFVG): Cleanly tracked with `effectiveDir` and invalidation upon reclaim.
//   - Quality: Filters micro-noise and enforces directional expansion on middle displacement candle.

function computeCausalAtr(bars, count = 14) {
  if (!bars || bars.length < 2) return 1.0;
  const n = Math.min(bars.length - 1, count);
  let trSum = 0;
  for (let k = Math.max(1, bars.length - n); k < bars.length; k++) {
    const p = bars[k - 1].close;
    trSum += Math.max(bars[k].high - bars[k].low, Math.abs(bars[k].high - p), Math.abs(bars[k].low - p));
  }
  return n > 0 ? trSum / n : 1.0;
}

// ---------- Institutional Order Blocks Detector ----------
export function detectOrderBlocks(bars, avg = null, lookback = 120) {
  bars = (bars || []).filter((b) => b.closed !== false && b.isClosed !== false);
  const n = bars.length;
  if (n < 8) return [];

  const a = avg && avg > 0 ? avg : computeCausalAtr(bars);
  const start = Math.max(0, n - lookback);
  const right = 3;
  const { highs, lows } = findPivots(bars, 3, 3);

  let lastH = null;
  let lastL = null;
  let hIdx = 0;
  let lIdx = 0;
  const raw = [];
  const seenOrigins = new Set();

  for (let i = 0; i < n; i++) {
    // A pivot exists only once its confirmation right-window has printed
    while (hIdx < highs.length && highs[hIdx].i + right <= i) lastH = highs[hIdx++];
    while (lIdx < lows.length && lows[lIdx].i + right <= i) lastL = lows[lIdx++];
    if (i < start) continue;

    const b = bars[i];

    // Bullish Structure Break: Price closes above confirmed swing high
    if (lastH && b.close > lastH.price) {
      const pivotToBreak = lastH;
      // Stale Pivot Guard: A pivot is broken on the FIRST close beyond it and is retired immediately.
      // It cannot be "re-broken" bars later by a subsequent expansion candle inside the same leg!
      lastH = null;

      // Displacement verification: single-candle expansion OR 2-candle momentum cluster
      const singleDisplaced = b.close - b.open >= 1.05 * a;
      const multiDisplaced =
        i > 0 &&
        b.close > b.open &&
        bars[i - 1].close > bars[i - 1].open &&
        b.close - b.open + (bars[i - 1].close - bars[i - 1].open) >= 1.5 * a;

      if (singleDisplaced || multiDisplaced) {
        // Origin selection: find true structural extreme candle in the leg preceding the break
        const ob = findOriginCandle(bars, pivotToBreak.i, i, 1);
        if (ob && !seenOrigins.has(`${ob.i}:1`)) {
          seenOrigins.add(`${ob.i}:1`);
          // Check if displacement leg left an FVG
          const hasFvg = i >= 2 && bars[i].low - bars[i - 2].high >= 0.2 * a;
          raw.push({
            dir: 1,
            top: ob.high,
            bottom: ob.low,
            bodyTop: Math.max(ob.open, ob.close),
            bodyBottom: Math.min(ob.open, ob.close),
            i: ob.i,
            time: bars[ob.i].time,
            brokeAt: i,
            breakTime: b.time,
            hasFvg,
            pivotPrice: pivotToBreak.price,
          });
        }
      }
    } else if (lastL && b.close < lastL.price) {
      // Bearish Structure Break: Price closes below confirmed swing low
      const pivotToBreak = lastL;
      lastL = null; // Stale Pivot Guard: Retired on first break!

      const singleDisplaced = b.open - b.close >= 1.05 * a;
      const multiDisplaced =
        i > 0 &&
        b.close < b.open &&
        bars[i - 1].close < bars[i - 1].open &&
        b.open - b.close + (bars[i - 1].open - bars[i - 1].close) >= 1.5 * a;

      if (singleDisplaced || multiDisplaced) {
        const ob = findOriginCandle(bars, pivotToBreak.i, i, -1);
        if (ob && !seenOrigins.has(`${ob.i}:-1`)) {
          seenOrigins.add(`${ob.i}:-1`);
          const hasFvg = i >= 2 && bars[i - 2].low - bars[i].high >= 0.2 * a;
          raw.push({
            dir: -1,
            top: ob.high,
            bottom: ob.low,
            bodyTop: Math.max(ob.open, ob.close),
            bodyBottom: Math.min(ob.open, ob.close),
            i: ob.i,
            time: bars[ob.i].time,
            brokeAt: i,
            breakTime: b.time,
            hasFvg,
            pivotPrice: pivotToBreak.price,
          });
        }
      }
    }
  }

  // Lifecycle Tracking: penetration depth, mean threshold (50%), and invalidation
  const alive = [];
  const px = bars[n - 1].close;

  for (const z of raw) {
    let tapped = false;
    let touchCount = 0;
    let tappedAt = null;
    let mitigated50 = false;
    let maxPen = 0;
    let dead = false;
    const zoneH = Math.max(1e-9, z.top - z.bottom);
    const mt = (z.top + z.bottom) / 2;

    for (let j = z.brokeAt + 1; j < n; j++) {
      const c = bars[j];

      if (z.dir === 1) {
        // Invalidation: close below the far side of demand OB kills it
        if (c.close < z.bottom) {
          dead = true;
          break;
        }
        // Mitigation / Touch
        if (c.low <= z.top) {
          tapped = true;
          touchCount++;
          if (tappedAt == null) tappedAt = c.time;
          const penDepth = z.top - Math.min(z.top, c.low);
          maxPen = Math.max(maxPen, penDepth / zoneH);
          if (c.low <= mt) mitigated50 = true;
        }
      } else {
        // Invalidation: close above the far side of supply OB kills it
        if (c.close > z.top) {
          dead = true;
          break;
        }
        // Mitigation / Touch
        if (c.high >= z.bottom) {
          tapped = true;
          touchCount++;
          if (tappedAt == null) tappedAt = c.time;
          const penDepth = Math.max(z.bottom, c.high) - z.bottom;
          maxPen = Math.max(maxPen, penDepth / zoneH);
          if (c.high >= mt) mitigated50 = true;
        }
      }
    }

    if (!dead) {
      alive.push({
        id: `OB:${z.dir === 1 ? "BULL" : "BEAR"}:${z.time}`,
        dir: z.dir,
        top: z.top,
        bottom: z.bottom,
        meanThreshold: (z.top + z.bottom) / 2,
        bodyTop: z.bodyTop,
        bodyBottom: z.bodyBottom,
        i: z.i,
        time: z.time,
        brokeAt: z.brokeAt,
        breakTime: z.breakTime,
        age: n - 1 - z.brokeAt,
        tapped, // 100% backward compatible boolean
        touchCount,
        tappedAt,
        mitigated50,
        penetrationPct: Math.round(maxPen * 100),
        hasFvg: z.hasFvg,
        isCurrentlyInside: px >= z.bottom && px <= z.top,
        state: tapped ? "mitigated" : "unmitigated",
        quality: z.hasFvg ? "A" : "B",
      });
    }
  }

  // Relevancy & Proximity Selection: Avoids blind slice(-8) bias that crowds out one side
  const demand = alive.filter((z) => z.dir === 1).sort((a, b) => Math.abs(px - a.top) - Math.abs(px - b.top));
  const supply = alive.filter((z) => z.dir === -1).sort((a, b) => Math.abs(px - a.bottom) - Math.abs(px - b.bottom));

  // Balanced top 8: up to 4 closest demand + 4 closest supply (filling shortfall from other side)
  const selected = [];
  const maxPerSide = 4;
  const takeDemand = Math.min(demand.length, maxPerSide);
  const takeSupply = Math.min(supply.length, maxPerSide);

  for (let k = 0; k < takeDemand; k++) selected.push(demand[k]);
  for (let k = 0; k < takeSupply; k++) selected.push(supply[k]);

  // Fill remaining slots up to 8 from closest overall
  if (selected.length < 8) {
    const remaining = [...demand.slice(takeDemand), ...supply.slice(takeSupply)].sort(
      (a, b) => Math.abs(px - (a.top + a.bottom) / 2) - Math.abs(px - (b.top + b.bottom) / 2)
    );
    for (const r of remaining) {
      if (selected.length >= 8) break;
      selected.push(r);
    }
  }

  // Preserve chronological age order for standard array consumer expectations
  return selected.sort((a, b) => b.age - a.age);
}

// Find structural origin candle: extreme of the leg, preferring the last opposite-direction candle
function findOriginCandle(bars, pivotI, breakI, dir) {
  const lookbackStart = Math.max(0, Math.min(pivotI, breakI - 12));
  let extremeIdx = breakI - 1;
  let extremePrice = dir === 1 ? Infinity : -Infinity;

  for (let k = breakI - 1; k >= lookbackStart; k--) {
    const b = bars[k];
    if (dir === 1 ? b.low < extremePrice : b.high > extremePrice) {
      extremePrice = dir === 1 ? b.low : b.high;
      extremeIdx = k;
    }
  }

  // Search within +/- 2 bars of the extreme for the last opposite candle
  for (let k = Math.min(breakI - 1, extremeIdx + 2); k >= Math.max(lookbackStart, extremeIdx - 2); k--) {
    const b = bars[k];
    if (dir === 1 ? b.close < b.open : b.close > b.open) {
      return { high: b.high, low: b.low, open: b.open, close: b.close, i: k };
    }
  }

  // Fallback to the extreme candle itself
  const ext = bars[extremeIdx];
  return { high: ext.high, low: ext.low, open: ext.open, close: ext.close, i: extremeIdx };
}

// ---------- Fair Value Gaps (FVG) & Inversion (iFVG) Lifecycle ----------
export function fvgZones(bars, avg = null, lookback = 60) {
  bars = (bars || []).filter((b) => b.closed !== false && b.isClosed !== false);
  const n = bars.length;
  if (n < 5) return [];

  const a = avg && avg > 0 ? avg : computeCausalAtr(bars);
  const minGap = 0.2 * a;
  const start = Math.max(2, n - lookback);
  const px = bars[n - 1].close;
  const zones = [];

  for (let i = start; i < n; i++) {
    const aBar = bars[i - 2];
    const mid = bars[i - 1];
    const cBar = bars[i];

    // Bullish FVG: Gap between candle 1 high and candle 3 low, middle candle must be bullish expansion
    if (cBar.low - aBar.high >= minGap && mid.close > mid.open) {
      zones.push({
        dir: 1,
        top: cBar.low,
        bottom: aBar.high,
        ce: (cBar.low + aBar.high) / 2,
        i,
        time: cBar.time,
      });
    } else if (aBar.low - cBar.high >= minGap && mid.open > mid.close) {
      // Bearish FVG: Gap between candle 1 low and candle 3 high, middle candle must be bearish expansion
      zones.push({
        dir: -1,
        top: aBar.low,
        bottom: cBar.high,
        ce: (aBar.low + cBar.high) / 2,
        i,
        time: cBar.time,
      });
    }
  }

  const out = [];

  for (const z of zones) {
    let state = "open";
    let invertedAt = null;
    let dead = false;
    let fillPct = 0;
    let mitigated50 = false;
    let unfilledTop = z.top;
    let unfilledBottom = z.bottom;
    const gapH = Math.max(1e-9, z.top - z.bottom);

    for (let j = z.i + 1; j < n && !dead; j++) {
      const b = bars[j];

      if (state === "open") {
        if (z.dir === 1) {
          // Inversion: candle closes through the far side of the gap
          if (b.close < z.bottom) {
            state = "inverted";
            invertedAt = j;
          } else if (b.low <= z.bottom) {
            // Wick fully filled the gap through to the other side
            dead = true;
            fillPct = 1.0;
          } else if (b.low < z.top) {
            // Partial penetration / fill
            const depth = (z.top - b.low) / gapH;
            fillPct = Math.max(fillPct, depth);
            if (b.low <= z.ce) mitigated50 = true;
            unfilledTop = Math.min(unfilledTop, b.low);
          }
        } else {
          // Bearish gap
          if (b.close > z.top) {
            state = "inverted";
            invertedAt = j;
          } else if (b.high >= z.top) {
            dead = true;
            fillPct = 1.0;
          } else if (b.high > z.bottom) {
            const depth = (b.high - z.bottom) / gapH;
            fillPct = Math.max(fillPct, depth);
            if (b.high >= z.ce) mitigated50 = true;
            unfilledBottom = Math.max(unfilledBottom, b.high);
          }
        }
      } else if (state === "inverted") {
        // Inverted gap dies if price closes back beyond its original near side (reclaimed)
        if (z.dir === 1 ? b.close > z.top : b.close < z.bottom) {
          dead = true;
        }
      }
    }

    if (!dead) {
      out.push({
        id: `FVG:${z.dir === 1 ? "BULL" : "BEAR"}:${z.time}`,
        dir: z.dir,
        effectiveDir: state === "inverted" ? -z.dir : z.dir,
        top: z.top,
        bottom: z.bottom,
        ce: z.ce,
        unfilledTop,
        unfilledBottom,
        fillPct: Math.round(fillPct * 100),
        mitigated50,
        i: z.i,
        time: z.time,
        age: n - 1 - z.i,
        state,
        invertedAt,
        invertedTime: invertedAt != null ? bars[invertedAt]?.time : null,
        isCurrentlyInside: px >= z.bottom && px <= z.top,
      });
    }
  }

  return out;
}
