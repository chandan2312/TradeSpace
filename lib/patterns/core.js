// Shared helpers for pattern detectors.
// Detectors are pure functions: (bars, ctx) -> drawings[].
//
// Drawing shapes consumed by lib/patterns/primitive.js (all faint by design):
//   { kind: "segment", i1, p1, i2, p2, extendRight?, color, width?, dash?, label?, dots?: [{i, p}] }
//   { kind: "zone",    i1, i2 (null = right edge), top, bottom, color, fill, label? }
//   { kind: "marker",  i, p, text, color, side: "above"|"below" }
// `i` is the bar's array index (logical coordinate), `p` a price.

// Mean candle range — the scale unit all tolerances derive from, so detectors
// self-adapt to any symbol/timeframe.
export function avgRange(bars, n = 120) {
  const slice = bars.slice(-n);
  if (!slice.length) return 1e-10;
  
  // Trim top 5% extreme candles to prevent anomalies/gaps from skewing the mean
  // Also filter out zero volume candles (often extreme spread anomalies)
  const ranges = slice.filter(b => b.volume !== 0).map(b => b.high - b.low).sort((a, b) => a - b);
  const validRanges = ranges.length > 0 ? ranges : slice.map(b => b.high - b.low).sort((a, b) => a - b);
  const cutoff = validRanges.length >= 20 ? validRanges[Math.floor(validRanges.length * 0.95)] : Infinity;
  
  let sum = 0;
  let count = 0;
  for (const r of validRanges) {
    if (r <= cutoff) {
      sum += r;
      count++;
    }
  }
  return Math.max(sum / Math.max(count, 1), 1e-10);
}

// Detect massive price gaps (e.g., weekend gaps, spread anomalies)
export function detectGaps(bars, avg, thresholdMult = 4.0) {
  const gaps = [];
  if (bars.length < 2) return gaps;
  for (let i = 1; i < bars.length; i++) {
    const gap = Math.abs(bars[i].open - bars[i-1].close);
    const spread = bars[i].high - bars[i].low;
    // Extreme spread anomaly: massive candle range but zero volume
    const isAnomaly = spread > avg * thresholdMult && bars[i].volume === 0;
    
    if (gap > avg * thresholdMult || isAnomaly) {
      gaps.push({ i, age: bars.length - 1 - i, gap: Math.max(gap, spread) });
    }
  }
  return gaps;
}

// Swing pivots: bar i is a pivot high if its high is the strict max of the
// window [i-left, i+right] (mirror for lows).
export function findPivots(bars, left = 4, right = 4) {
  const highs = [];
  const lows = [];
  for (let i = left; i < bars.length - right; i++) {
    let isH = true;
    let isL = true;
    for (let j = i - left; j <= i + right && (isH || isL); j++) {
      if (j === i) continue;
      if (bars[j].high >= bars[i].high) isH = false;
      if (bars[j].low <= bars[i].low) isL = false;
    }
    if (isH) highs.push({ i, price: bars[i].high });
    if (isL) lows.push({ i, price: bars[i].low });
  }
  return { highs, lows };
}

// Faint palette shared by all detectors (single place to tune subtlety).
export const FAINT = {
  red: "rgba(239, 83, 80, 0.35)",
  redFill: "rgba(239, 83, 80, 0.06)",
  green: "rgba(38, 166, 154, 0.35)",
  greenFill: "rgba(38, 166, 154, 0.06)",
  orange: "rgba(255, 152, 0, 0.4)",
  orangeFill: "rgba(255, 152, 0, 0.07)",
  blue: "rgba(41, 98, 255, 0.3)",
  blueFill: "rgba(41, 98, 255, 0.05)",
  text: "rgba(215, 220, 230, 0.45)",
};
