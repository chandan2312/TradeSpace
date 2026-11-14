/**
 * lib/autonomous_system2/priceActionEngine.js
 *
 * Standalone Price Action & Chart Structure Engine for System #2
 * Infuses tactical chart-based market structure into the Auction/VWAP framework:
 * - Swing Highs & Lows (Fractals)
 * - Liquidity Sweeps & Raids (Turtle Soup / Reclaim)
 * - Displacement & Body Dominance
 * - Micro-Fair Value Gaps (FVG) & Imbalance Confluence
 * - Structural Swing Stop Anchoring
 * - Opposing Draw on Liquidity (DOL) Targets
 *
 * NOTE: 100% self-contained. Zero external dependencies or imports from System 1.
 */

/**
 * Identifies confirmed swing highs and swing lows (fractals).
 * @param {Array<object>} bars - Array of closed bars
 * @param {number} width - 3 or 5 bar fractal width (default: 3 for agile intraday structure)
 * @returns {object} { highs: Array, lows: Array }
 */
export function findSwingFractals(bars = [], width = 3) {
  if (!bars || bars.length < width) return { highs: [], lows: [] };

  const wing = Math.floor(width / 2);
  const highs = [];
  const lows = [];

  for (let i = wing; i < bars.length - wing; i++) {
    const b = bars[i];
    const curH = b.high ?? b.h;
    const curL = b.low ?? b.l;
    const curT = b.time ?? b.t;

    if (!Number.isFinite(curH) || !Number.isFinite(curL)) continue;

    // Check Swing High
    let isHigh = true;
    for (let j = i - wing; j <= i + wing; j++) {
      if (j === i) continue;
      const otherH = bars[j].high ?? bars[j].h;
      if (otherH >= curH) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) {
      highs.push({
        index: i,
        time: curT,
        price: curH,
        side: 1, // High
      });
    }

    // Check Swing Low
    let isLow = true;
    for (let j = i - wing; j <= i + wing; j++) {
      if (j === i) continue;
      const otherL = bars[j].low ?? bars[j].l;
      if (otherL <= curL) {
        isLow = false;
        break;
      }
    }
    if (isLow) {
      lows.push({
        index: i,
        time: curT,
        price: curL,
        side: -1, // Low
      });
    }
  }

  return { highs, lows };
}

/**
 * Detects whether recent bars (e.g. current or previous 2 bars) executed a liquidity sweep
 * of a prior confirmed swing high or low.
 * @param {Array<object>} bars - Array of closed bars
 * @param {object} fractals - Output from findSwingFractals
 * @param {number} dir - Direction of trade: 1 (Long, expects sweep of low), -1 (Short, expects sweep of high)
 * @param {number} maxLookback - How many bars ago the sweep could have occurred (default: 3)
 * @param {number} minFractalAge - Minimum bars between fractal formation and sweep (default: 3)
 * @returns {object} { swept: boolean, sweptLevel: number|null, extreme: number|null, barsAgo: number }
 */
export function detectLiquiditySweep(bars = [], fractals = { highs: [], lows: [] }, dir = 1, maxLookback = 3, minFractalAge = 3) {
  if (!bars || bars.length < 5) return { swept: false, sweptLevel: null, extreme: null, barsAgo: -1 };

  const curIdx = bars.length - 1;
  const currentBar = bars[curIdx];
  const curClose = currentBar.close ?? currentBar.c;

  if (dir === 1) {
    // Bullish: We want to see a sweep of a prior SWING LOW (liquidity raid below low followed by reclaim)
    const eligibleLows = (fractals.lows || []).filter((f) => f.index <= curIdx - minFractalAge && f.index >= curIdx - 40);

    for (let offset = 0; offset < maxLookback; offset++) {
      const barIdx = curIdx - offset;
      if (barIdx < 0) break;
      const b = bars[barIdx];
      const bLow = b.low ?? b.l;
      const bClose = b.close ?? b.c;

      for (const sw of eligibleLows) {
        // Pierced below prior swing low, but price has now reclaimed above it
        if (bLow < sw.price && curClose > sw.price) {
          // Find lowest point reached during the raid
          let lowest = bLow;
          for (let k = barIdx; k <= curIdx; k++) {
            lowest = Math.min(lowest, bars[k].low ?? bars[k].l);
          }
          return {
            swept: true,
            sweptLevel: sw.price,
            extreme: lowest,
            barsAgo: offset,
            fractalAge: curIdx - sw.index,
          };
        }
      }
    }
  } else if (dir === -1) {
    // Bearish: We want to see a sweep of a prior SWING HIGH (liquidity raid above high followed by reclaim)
    const eligibleHighs = (fractals.highs || []).filter((f) => f.index <= curIdx - minFractalAge && f.index >= curIdx - 40);

    for (let offset = 0; offset < maxLookback; offset++) {
      const barIdx = curIdx - offset;
      if (barIdx < 0) break;
      const b = bars[barIdx];
      const bHigh = b.high ?? b.h;
      const bClose = b.close ?? b.c;

      for (const sw of eligibleHighs) {
        // Pierced above prior swing high, but price has now reclaimed below it
        if (bHigh > sw.price && curClose < sw.price) {
          let highest = bHigh;
          for (let k = barIdx; k <= curIdx; k++) {
            highest = Math.max(highest, bars[k].high ?? bars[k].h);
          }
          return {
            swept: true,
            sweptLevel: sw.price,
            extreme: highest,
            barsAgo: offset,
            fractalAge: curIdx - sw.index,
          };
        }
      }
    }
  }

  return { swept: false, sweptLevel: null, extreme: null, barsAgo: -1 };
}

/**
 * Evaluates whether a candle exhibits institutional displacement (body dominance & expansion).
 * @param {object} bar - Candle to evaluate
 * @param {number} atr - Current 14 ATR
 * @param {number} dir - Direction: 1 (Bullish), -1 (Bearish)
 * @returns {object} { hasDisplacement: boolean, bodyRatio: number, rangeRatio: number }
 */
export function detectDisplacement(bar, atr = 10, dir = 1) {
  if (!bar) return { hasDisplacement: false, bodyRatio: 0, rangeRatio: 0 };

  const h = bar.high ?? bar.h;
  const l = bar.low ?? bar.l;
  const o = bar.open ?? bar.o;
  const c = bar.close ?? bar.c;

  const range = Math.max(1e-6, h - l);
  const body = dir === 1 ? c - o : o - c;
  const bodyRatio = body / range;
  const rangeRatio = atr > 0 ? range / atr : 1.0;

  // Institutional displacement: body in desired direction >= 50% of range and total range >= 0.70 ATR
  const hasDisplacement = bodyRatio >= 0.50 && rangeRatio >= 0.70;

  return {
    hasDisplacement,
    bodyRatio: Math.round(bodyRatio * 100) / 100,
    rangeRatio: Math.round(rangeRatio * 100) / 100,
  };
}

/**
 * Detects recent 3-bar Fair Value Gaps (FVG) and evaluates if any unmitigated gap sits near a target level.
 * @param {Array<object>} bars - Recent closed bars
 * @param {number} lookback - Lookback window (default: 20)
 * @returns {Array<object>} List of recent active FVGs
 */
export function detectRecentFairValueGaps(bars = [], lookback = 20) {
  if (!bars || bars.length < 4) return [];

  const startIdx = Math.max(2, bars.length - lookback);
  const fvgs = [];

  for (let i = startIdx; i < bars.length; i++) {
    const b0 = bars[i - 2];
    const b2 = bars[i];

    const b0High = b0.high ?? b0.h;
    const b0Low = b0.low ?? b0.l;
    const b2High = b2.high ?? b2.h;
    const b2Low = b2.low ?? b2.l;

    // Bullish FVG: b2.low > b0.high (gap between bar 0 high and bar 2 low)
    if (b2Low > b0High) {
      const gapBottom = b0High;
      const gapTop = b2Low;
      const gapMid = (gapTop + gapBottom) / 2;

      // Check if subsequent bars mitigated it
      let isMitigated = false;
      for (let j = i + 1; j < bars.length; j++) {
        const testLow = bars[j].low ?? bars[j].l;
        if (testLow <= gapBottom) {
          isMitigated = true;
          break;
        }
      }

      if (!isMitigated) {
        fvgs.push({
          dir: 1,
          top: gapTop,
          bottom: gapBottom,
          ce: gapMid,
          createdIndex: i,
          time: b2.time ?? b2.t,
        });
      }
    }

    // Bearish FVG: b2.high < b0.low (gap between bar 0 low and bar 2 high)
    if (b2High < b0Low) {
      const gapTop = b0Low;
      const gapBottom = b2High;
      const gapMid = (gapTop + gapBottom) / 2;

      let isMitigated = false;
      for (let j = i + 1; j < bars.length; j++) {
        const testHigh = bars[j].high ?? bars[j].h;
        if (testHigh >= gapTop) {
          isMitigated = true;
          break;
        }
      }

      if (!isMitigated) {
        fvgs.push({
          dir: -1,
          top: gapTop,
          bottom: gapBottom,
          ce: gapMid,
          createdIndex: i,
          time: b2.time ?? b2.t,
        });
      }
    }
  }

  return fvgs;
}

/**
 * Checks if a given price level (e.g. VWAP or POC) overlaps with an active unmitigated FVG.
 * @param {number} levelPrice - Price level to test
 * @param {Array<object>} fvgs - Active FVGs
 * @param {number} dir - Direction: 1 (Bullish), -1 (Bearish)
 * @param {number} tolerance - Tolerance buffer (e.g. 0.2 ATR)
 * @returns {object|null} Overlapping FVG or null
 */
export function findOverlappingFVG(levelPrice, fvgs = [], dir = 1, tolerance = 0) {
  if (!Number.isFinite(levelPrice) || !fvgs.length) return null;

  for (const fvg of fvgs) {
    if (fvg.dir !== dir) continue;
    if (levelPrice >= fvg.bottom - tolerance && levelPrice <= fvg.top + tolerance) {
      return fvg;
    }
  }
  return null;
}

/**
 * Finds the nearest opposing swing fractal to act as a natural Draw on Liquidity (DOL) target.
 * @param {object} fractals - Output from findSwingFractals
 * @param {number} currentPrice - Current execution price
 * @param {number} dir - Direction: 1 (Long), -1 (Short)
 * @param {number} minDistance - Minimum distance (e.g. 1.5R * risk)
 * @param {number} maxDistance - Maximum distance (e.g. 4.0R * risk)
 * @returns {number|null} Target price, or null if none in range
 */
export function findDrawOnLiquidityTarget(fractals = { highs: [], lows: [] }, currentPrice, dir = 1, minDistance = 0, maxDistance = Infinity) {
  if (!Number.isFinite(currentPrice)) return null;

  if (dir === 1) {
    // For Long: Opposing target is a prior swing HIGH above current price
    const candidateHighs = (fractals.highs || [])
      .filter((f) => f.price >= currentPrice + minDistance && f.price <= currentPrice + maxDistance)
      .sort((a, b) => a.price - b.price); // Closest first

    return candidateHighs.length > 0 ? candidateHighs[0].price : null;
  } else {
    // For Short: Opposing target is a prior swing LOW below current price
    const candidateLows = (fractals.lows || [])
      .filter((f) => f.price <= currentPrice - minDistance && f.price >= currentPrice - maxDistance)
      .sort((a, b) => b.price - a.price); // Closest first (highest low below price)

    return candidateLows.length > 0 ? candidateLows[0].price : null;
  }
}

/**
 * Finds a structural swing point to anchor the stop loss.
 * @param {Array<object>} bars - Recent closed bars
 * @param {object} fractals - Output from findSwingFractals
 * @param {number} dir - Direction: 1 (Long), -1 (Short)
 * @param {number} lookbackBars - Lookback for structural pivot (default: 8)
 * @returns {number} Structural extreme price
 */
export function findStructuralStopAnchor(bars = [], fractals = { highs: [], lows: [] }, dir = 1, lookbackBars = 8) {
  if (!bars || bars.length === 0) return 0;

  const startIdx = Math.max(0, bars.length - lookbackBars);
  let extreme = dir === 1 ? Infinity : -Infinity;

  // Check recent bar wicks
  for (let i = startIdx; i < bars.length; i++) {
    const b = bars[i];
    if (dir === 1) {
      extreme = Math.min(extreme, b.low ?? b.l);
    } else {
      extreme = Math.max(extreme, b.high ?? b.h);
    }
  }

  // Also check recent fractals in this window
  if (dir === 1 && fractals.lows) {
    const recentLows = fractals.lows.filter((f) => f.index >= startIdx);
    for (const f of recentLows) {
      extreme = Math.min(extreme, f.price);
    }
  } else if (dir === -1 && fractals.highs) {
    const recentHighs = fractals.highs.filter((f) => f.index >= startIdx);
    for (const f of recentHighs) {
      extreme = Math.max(extreme, f.price);
    }
  }

  return extreme;
}
