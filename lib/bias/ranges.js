import { findPivots, avgRange } from "../patterns/core.js";

// Multi-Timeframe Structural Dealing Range Engine
// Evaluates the active dealing ranges on M15, H1, H4, and D1.
// Determines:
//   1. Governing Range High & Range Low
//   2. Equilibrium (50% midpoint)
//   3. Current position in range (% covered, Discount vs Premium)
//   4. Range coverage status: Uncovered Run vs Range Exhaustion / Expansion
//   5. Multi-timeframe range alignment and warning flags

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const TF_SETTINGS = {
  M15: { lookback: 64, left: 3, right: 3 },
  H1:  { lookback: 72, left: 3, right: 3 },
  H4:  { lookback: 80, left: 3, right: 3 },
  D1:  { lookback: 60, left: 2, right: 2 },
};

/**
 * Computes the active dealing range for a single timeframe.
 * @param {Array} bars - Candlestick bars
 * @param {string} tf - Timeframe identifier (M15, H1, H4, D1)
 * @param {number} [avg] - Average bar range
 */
export function computeDealingRange(bars, tf = "H4", avg = null) {
  if (!bars || bars.length < 15) return null;

  const conf = TF_SETTINGS[tf] || { lookback: 60, left: 3, right: 3 };
  const n = bars.length;
  const a = avg || avgRange(bars);
  const lookback = Math.min(n, conf.lookback);
  const win = bars.slice(n - lookback);
  const currentPrice = bars[n - 1].close;

  const { highs, lows } = findPivots(win, conf.left, conf.right);

  let rangeHigh = -Infinity;
  let rangeLow = Infinity;
  let highPivot = null;
  let lowPivot = null;

  if (highs.length >= 1 && lows.length >= 1) {
    // Find the governing major swing high and swing low in the window
    for (const h of highs) {
      if (h.price > rangeHigh) {
        rangeHigh = h.price;
        highPivot = h;
      }
    }
    for (const l of lows) {
      if (l.price < rangeLow) {
        rangeLow = l.price;
        lowPivot = l;
      }
    }
  }

  // Fallback to highest high / lowest low of the window if pivots are scarce
  if (!highPivot || !lowPivot || rangeHigh <= rangeLow) {
    rangeHigh = Math.max(...win.map((b) => b.high));
    rangeLow = Math.min(...win.map((b) => b.low));
  }

  const rangeSize = rangeHigh - rangeLow;
  if (rangeSize <= 0) return null;

  const eq = (rangeHigh + rangeLow) / 2;
  const rawPos = (currentPrice - rangeLow) / rangeSize;
  const pos = clamp(rawPos, 0, 1);
  const coveragePct = Math.round(pos * 100);

  // Classify Auction Zone
  let zone = "EQUILIBRIUM";
  if (pos < 0.25) zone = "DEEP_DISCOUNT";
  else if (pos < 0.45) zone = "DISCOUNT";
  else if (pos > 0.75) zone = "DEEP_PREMIUM";
  else if (pos > 0.55) zone = "PREMIUM";

  // Classify Range Coverage & State
  let status = "MID_RANGE";
  let isExhausted = false;
  let exhaustedSide = null;

  if (currentPrice > rangeHigh) {
    status = "EXPANDED_ABOVE";
  } else if (currentPrice < rangeLow) {
    status = "EXPANDED_BELOW";
  } else if (pos >= 0.88) {
    status = "EXHAUSTED_HIGH";
    isExhausted = true;
    exhaustedSide = "high";
  } else if (pos <= 0.12) {
    status = "EXHAUSTED_LOW";
    isExhausted = true;
    exhaustedSide = "low";
  } else if (pos < 0.45) {
    status = "UNCOVERED_UPSIDE";
  } else if (pos > 0.55) {
    status = "UNCOVERED_DOWNSIDE";
  }

  const remainingToHigh = Math.max(0, rangeHigh - currentPrice);
  const remainingToLow = Math.max(0, currentPrice - rangeLow);
  const remainingPctToHigh = Math.max(0, 100 - coveragePct);
  const remainingPctToLow = Math.max(0, coveragePct);

  return {
    tf,
    high: rangeHigh,
    low: rangeLow,
    eq,
    size: rangeSize,
    currentPrice,
    pos: Math.round(pos * 1000) / 1000,
    coveragePct,
    zone,
    status,
    isExhausted,
    exhaustedSide,
    remainingToHigh,
    remainingToLow,
    remainingPctToHigh,
    remainingPctToLow,
    barsInWindow: lookback,
  };
}

/**
 * Analyzes multi-timeframe dealing ranges across M15, H1, H4, and D1.
 * Evaluates range coverage and surfaces institutional alignment / conflict warnings.
 * @param {Object} frames - { M15, H1, H4, D1 }
 */
export function analyzeAllDealingRanges(frames, structures = {}) {
  const ranges = {};
  const tfs = ["M15", "H1", "H4", "D1"];

  for (const tf of tfs) {
    if (frames[tf]) {
      const r = computeDealingRange(frames[tf], tf);
      if (r) ranges[tf] = r;
    }
  }

  // Cross-timeframe synthesis
  const h4 = ranges.H4;
  const d1 = ranges.D1;
  const h1 = ranges.H1;
  const m15 = ranges.M15;

  const warnings = [];
  const alignments = [];

  // 1. HTF Premium Exhaustion Warning:
  // If H4 or D1 is exhausted at range high (or in deep premium > 80%),
  // lower timeframe bullish movement is covering terminal ground. Chasing longs is a trap!
  if (h4?.status === "EXHAUSTED_HIGH" || (h4?.coveragePct >= 85 && m15?.zone === "PREMIUM")) {
    warnings.push({
      type: "HTF_PREMIUM_EXHAUSTION",
      severity: "high",
      note: `H4 range ${h4.coveragePct}% covered (Deep Premium). Longs near range ceiling are high-risk.`,
    });
  }

  // 2. HTF Discount Exhaustion Warning:
  // If H4 or D1 is exhausted at range low (or in deep discount < 15%),
  // lower timeframe bearish movement is covering terminal ground. Chasing shorts is a trap!
  if (h4?.status === "EXHAUSTED_LOW" || (h4?.coveragePct <= 15 && m15?.zone === "DISCOUNT")) {
    warnings.push({
      type: "HTF_DISCOUNT_EXHAUSTION",
      severity: "high",
      note: `H4 range ${h4.coveragePct}% covered (Deep Discount). Shorts near range floor are high-risk.`,
    });
  }

  // 3. Intraday vs HTF Misalignment (The Retracement Trap):
  // When M15 is running up, but H4 is in Deep Premium; OR M15 running down into H4 Deep Discount
  if (m15?.coveragePct >= 80 && h4 && h4.coveragePct >= 80) {
    warnings.push({
      type: "DOUBLE_PREMIUM_SATURATION",
      severity: "critical",
      note: "Both M15 and H4 ranges saturated in Premium (>80%). Extreme reversal or pause vulnerability.",
    });
  } else if (m15?.coveragePct <= 20 && h4 && h4.coveragePct <= 20) {
    warnings.push({
      type: "DOUBLE_DISCOUNT_SATURATION",
      severity: "critical",
      note: "Both M15 and H4 ranges saturated in Discount (<20%). Extreme bounce or pause vulnerability.",
    });
  }

  // 4. Prime Expansion Pathways (Vast Uncovered Ground Aligned with Structure):
  const h4Dir = structures.H4?.dir ?? 0;

  if (h4 && m15) {
    if (h4Dir === 1) {
      // Bullish trend structure: price expands upward through Discount into Premium
      if (h4.coveragePct < 50 && m15.coveragePct < 55) {
        alignments.push({
          type: "BULLISH_UNCOVERED_EXPANSION",
          dir: 1,
          note: `H4 in Discount (${h4.coveragePct}%) with ${m15.remainingPctToHigh}% uncovered upside runway.`,
        });
      } else if (h4.coveragePct >= 50 && h4.coveragePct < 85 && m15.remainingPctToHigh >= 20) {
        alignments.push({
          type: "BULLISH_UNCOVERED_EXPANSION",
          dir: 1,
          note: `H4 delivering through Premium (${h4.coveragePct}%) with ${m15.remainingPctToHigh}% to range ceiling.`,
        });
      }
    } else if (h4Dir === -1) {
      // Bearish trend structure: price delivers downward through Premium into Discount
      if (h4.coveragePct > 50 && m15.coveragePct > 45) {
        alignments.push({
          type: "BEARISH_UNCOVERED_EXPANSION",
          dir: -1,
          note: `H4 in Premium (${h4.coveragePct}%) with ${m15.remainingPctToLow}% uncovered downside runway.`,
        });
      } else if (h4.coveragePct <= 50 && h4.coveragePct > 15 && m15.remainingPctToLow >= 20) {
        alignments.push({
          type: "BEARISH_UNCOVERED_EXPANSION",
          dir: -1,
          note: `H4 delivering through Discount (${h4.coveragePct}%) with ${m15.remainingPctToLow}% to range floor.`,
        });
      }
    } else {
      // Neutral / range-bound fallback: position indicates mean-reversion runway
      if (h4.coveragePct < 50 && m15.coveragePct < 50) {
        alignments.push({
          type: "BULLISH_UNCOVERED_EXPANSION",
          dir: 1,
          note: `H4 in Discount (${h4.coveragePct}%) and M15 has ${m15.remainingPctToHigh}% uncovered upside room.`,
        });
      } else if (h4.coveragePct > 50 && m15.coveragePct > 50) {
        alignments.push({
          type: "BEARISH_UNCOVERED_EXPANSION",
          dir: -1,
          note: `H4 in Premium (${h4.coveragePct}%) and M15 has ${m15.remainingPctToLow}% uncovered downside room.`,
        });
      }
    }
  }

  return {
    ranges,
    warnings,
    alignments,
    h4CoveragePct: h4?.coveragePct ?? null,
    m15CoveragePct: m15?.coveragePct ?? null,
    h4Zone: h4?.zone ?? null,
    m15Zone: m15?.zone ?? null,
  };
}
