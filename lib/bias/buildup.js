import { findPivots, avgRange, detectGaps } from "../patterns/core.js";

// Liquidity Buildup & Compression Detector (ICT Smart Money Institutional Engine)
//
// Key Responsibilities:
//   1. Detects engineered trendline liquidity (cascading BSL highs & SSL lows)
//      with mathematical linear regression: slope (m), intercept (c), R^2, and projected line level L(t).
//   2. Distinguishes true sloped cascades (Descending BSL, Ascending SSL) from flat clusters (EQH/EQL).
//   3. Measures actual volatility compression ratio (buildup candle range vs baseline ATR).
//   4. Implements robust lifecycle states: 'untapped', 'pending' (in-progress pierce), 'swept', and 'broken'.
//   5. Protects against truncated windows: recent pierces within 1-3 bars are labeled 'pending' rather than falsely 'broken'.
//   6. Enforces unified absolute bar index coordinates to eliminate sliding-window repainting.
//   7. Provides safe call guards: missing or zero 'avg' automatically falls back to avgRange(bars).

/**
 * Least-squares linear regression fit through pivot points.
 * Returns slope (m), y-intercept (c), and coefficient of determination (r2).
 */
function fitLine(points) {
  const k = points.length;
  if (k < 2) return { m: 0, c: points[0]?.price ?? 0, r2: 0 };

  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const p of points) {
    sx += p.i;
    sy += p.price;
    sxx += p.i * p.i;
    sxy += p.i * p.price;
    syy += p.price * p.price;
  }

  const denom = k * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) {
    return { m: 0, c: sy / k, r2: 0 };
  }

  const m = (k * sxy - sx * sy) / denom;
  const c = (sy - m * sx) / k;

  const totalVar = syy - (sy * sy) / k;
  let r2 = 0;
  if (totalVar > 1e-12) {
    let ssRes = 0;
    for (const p of points) {
      const pred = m * p.i + c;
      const res = p.price - pred;
      ssRes += res * res;
    }
    r2 = Math.max(0, Math.min(1, 1 - ssRes / totalVar));
  }

  return { m, c, r2 };
}

/**
 * Measures candle range compression across the buildup span compared to baseline ATR.
 */
function measureCompression(bars, startIdx, endIdx, baselineAvg) {
  const s = Math.max(0, startIdx);
  const e = Math.min(bars.length - 1, endIdx);
  if (e <= s || baselineAvg <= 0) return 1.0;

  let sum = 0;
  let count = 0;
  for (let i = s; i <= e; i++) {
    sum += bars[i].high - bars[i].low;
    count++;
  }
  return (sum / Math.max(1, count)) / baselineAvg;
}

/**
 * Core detector for trendline liquidity buildups, sweeps, and compression.
 * Fully backwards-compatible with engine.js, setup.js, and redecision.js.
 */
export function detectTrendlineLiquidity(bars, avg, lookback = 120) {
  if (!Array.isArray(bars) || bars.length < 20) {
    return { draws: [], sweeps: [] };
  }

  const n = bars.length;
  const effectiveAvg = (typeof avg === "number" && Number.isFinite(avg) && avg > 0)
    ? avg
    : avgRange(bars);

  const start = Math.max(0, n - lookback);
  const win = bars.slice(start);
  const { highs, lows } = findPivots(win, 3, 3);

  // Map pivots to absolute bar indices so coordinates never slide/repaint
  const absHighs = highs.map(p => ({ i: start + p.i, price: p.price }));
  const absLows = lows.map(p => ({ i: start + p.i, price: p.price }));

  const draws = [];
  const sweeps = [];
  const px = bars[n - 1].close;
  const tol = 0.5 * effectiveAvg;
  const pierceTol = 0.12 * effectiveAvg;
  const gaps = detectGaps(win, effectiveAvg, 3.0).map(g => ({ ...g, i: start + g.i }));

  /**
   * Unified processor for both sides:
   * dir = +1 -> Highs (Buy-Side Liquidity / BSL above price)
   * dir = -1 -> Lows  (Sell-Side Liquidity / SSL below price)
   */
  function processPivots(pivots, dir) {
    if (pivots.length < 3) return;

    const groups = [];
    let current = [];

    for (let i = 0; i < pivots.length; i++) {
      const P = pivots[i];

      if (current.length === 0) {
        current.push(P);
      } else {
        const anchor = current[0];
        const prev = current[current.length - 1];

        // Opposing directional gaps break compression (continuation gaps do not)
        const gapFound = gaps.some(g => {
          if (g.i <= prev.i || g.i > P.i) return false;
          const barPrev = bars[Math.max(0, g.i - 1)];
          const barCur = bars[Math.min(n - 1, g.i)];
          const gapDir = barCur.open > barPrev.close ? 1 : -1;
          // For BSL (descending highs), an upward gap breaks structure. A downward gap confirms trend.
          return dir === 1 ? gapDir > 0 : gapDir < 0;
        });

        // Anchor boundary check:
        // BSL highs should stay below anchor.price + tol
        // SSL lows should stay above anchor.price - tol
        const anchorBreached = dir === 1
          ? P.price > anchor.price + tol
          : P.price < anchor.price - tol;

        // Massive opposing displacement check:
        const displacementBreached = dir === 1
          ? (P.price - prev.price) > 3 * effectiveAvg
          : (prev.price - P.price) > 3 * effectiveAvg;

        const temporalBreak = P.i - prev.i > 40;

        if (anchorBreached || displacementBreached || temporalBreak || gapFound) {
          if (current.length >= 3) groups.push(current);
          current = [P];
        } else {
          current.push(P);
        }
      }
    }
    if (current.length >= 3) groups.push(current);

    // Evaluate each candidate group
    for (const grp of groups) {
      const startP = grp[0];
      const endP = grp[grp.length - 1];

      // Fit regression line across the touches
      const { m, c, r2 } = fitLine(grp);
      const L = (idx) => m * idx + c;

      // Classify geometry: Sloped trendline vs Flat Equal Highs/Lows (EQH/EQL)
      const slopeThreshold = 0.015 * effectiveAvg;
      const isExpectedSlope = dir === 1 ? m < -slopeThreshold : m > slopeThreshold;
      const isFlat = Math.abs(m) <= slopeThreshold;

      // If slope is strongly against the expected direction (e.g. ascending highs labeled as descending BSL), reject
      if (!isExpectedSlope && !isFlat) continue;

      const compressionRatio = measureCompression(bars, startP.i, endP.i, effectiveAvg);
      const isTight = compressionRatio < 0.85;

      let typeName = "";
      if (isFlat) {
        typeName = dir === 1 ? "EQH" : "EQL";
      } else {
        typeName = dir === 1 ? "Descending BSL" : "Ascending SSL";
      }

      let note = grp.length >= 5
        ? "Massive multi-phase compression"
        : (isFlat ? "Equal liquidity pool" : "Curvy trendline liquidity");
      if (isTight) note += " (Tight Squeeze)";

      // Lifecycle evaluation across bars
      let state = "untapped";
      let sweptAt = null;

      // 1. Did the final pivot touch itself pierce and reject the prior established line?
      if (grp.length >= 3) {
        const priorTouches = grp.slice(0, -1);
        const priorFit = fitLine(priorTouches);
        const priorL = (idx) => priorFit.m * idx + priorFit.c;
        const lastLineVal = priorL(endP.i);
        const lastBar = bars[endP.i];

        const lastPierced = dir === 1
          ? endP.price > lastLineVal + pierceTol
          : endP.price < lastLineVal - pierceTol;

        if (lastPierced) {
          const closedBack = dir === 1 ? lastBar.close < lastLineVal : lastBar.close > lastLineVal;
          if (closedBack) {
            state = "swept";
            sweptAt = endP.i;
          }
        }
      }

      // 2. Lifecycle evaluation across bars following the group's final touch
      for (let j = endP.i + 1; j < n; j++) {
        const lineVal = L(j);
        const extreme = dir === 1 ? bars[j].high : bars[j].low;
        const pierced = dir === 1 ? extreme > lineVal + pierceTol : extreme < lineVal - pierceTol;

        if (pierced) {
          // Check for reclaim within up to 4 bars
          let closedBack = false;
          const lookAheadLimit = Math.min(j + 4, n);
          for (let k = j; k < lookAheadLimit; k++) {
            const lkVal = L(k);
            if (dir === 1 ? bars[k].close < lkVal : bars[k].close > lkVal) {
              closedBack = true;
              break;
            }
          }

          if (closedBack) {
            state = "swept";
            sweptAt = j;

            // Post-sweep validation: if subsequent bars later heavily break and hold beyond the line, mark broken
            let sustainedBreak = false;
            for (let k = j + 4; k < n; k++) {
              const postLine = L(k);
              const brokeHard = dir === 1
                ? bars[k].close > postLine + effectiveAvg
                : bars[k].close < postLine - effectiveAvg;
              if (brokeHard) {
                sustainedBreak = true;
                break;
              }
            }
            if (sustainedBreak) {
              state = "broken";
            }
            break;
          } else {
            // Guard against truncated reclaim window on live / recent candles
            const barsRemaining = (n - 1) - j;
            if (barsRemaining < 3) {
              state = "pending"; // Actively piercing, not broken
            } else {
              state = "broken";
            }
            break;
          }
        }
      }

      const projectedPrice = L(n - 1);
      const isAheadOfPrice = dir === 1
        ? (projectedPrice > px - 0.25 * effectiveAvg || startP.price > px)
        : (projectedPrice < px + 0.25 * effectiveAvg || startP.price < px);

      if (state === "untapped" && isAheadOfPrice) {
        draws.push({
          type: typeName,
          side: dir,
          price: projectedPrice,         // Dynamic projected line price for redecision.js & targets
          projectedPrice,
          anchorPrice: startP.price,     // Horizontal origin anchor
          touches: grp.length,
          start: { i: startP.i, price: startP.price },
          end: { i: endP.i, price: endP.price },
          slope: m,
          r2,
          compressionRatio,
          state: "untapped",
          note,
        });
      } else if (state === "pending" && isAheadOfPrice) {
        // Pending state: actively piercing without confirmed break; emit with pending state flag
        draws.push({
          type: `${typeName} (Testing)`,
          side: dir,
          price: projectedPrice,
          projectedPrice,
          anchorPrice: startP.price,
          touches: grp.length,
          start: { i: startP.i, price: startP.price },
          end: { i: endP.i, price: endP.price },
          slope: m,
          r2,
          compressionRatio,
          state: "pending",
          note: `${note} [Active Piercing]`,
        });
      } else if (state === "swept" && sweptAt !== null) {
        sweeps.push({
          type: `${typeName} Swept`,
          side: dir,
          price: L(sweptAt),
          projectedPrice,
          anchorPrice: startP.price,
          touches: grp.length,
          start: { i: startP.i, price: startP.price },
          end: { i: endP.i, price: endP.price },
          slope: m,
          r2,
          compressionRatio,
          state: "swept",
          age: n - 1 - sweptAt,
          sweptAt,
          note,
        });
      }
    }
  }

  processPivots(absHighs, 1);
  processPivots(absLows, -1);

  return { draws, sweeps };
}
