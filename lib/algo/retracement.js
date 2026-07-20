// Retracement classifier — classifies the current pullback into one of four
// behavioral types so setup/confirm logic can weight risk accordingly. Bands
// follow ICT/OTE doctrine (research-verified): <62% weak/chasable, 62–79% the
// OTE continuation pocket (70.5% midpoint), >79% deep extension, body-close
// past 100% (leg origin) = reversal/invalidation. Depth alone is NOT enough —
// the structural origin-break is the independent reversal signal.
//   "liquidity-building" — shallow pullback coiling equal highs/lows ahead = continuation fuel
//   "weak"               — < 62% (premature; chasing gives bad R/R)
//   "ote"                — 62–79% OTE continuation pocket (the good entry)
//   "deep"               — > 79% extension, near origin, caution
//   "reversal"           — broke the impulse leg's origin → structure flipped
// Plus a depth fraction (0=none, 1=fully back to origin). Pure function, no I/O.

import { findPivots, avgRange } from "../patterns/core.js";
import { liquidityMap } from "../bias/liquidity.js";

export function classifyRetracement(bars, dir, cfg = {}) {
  const n = bars?.length;
  if (!n || n < 40) return null;
  const px = bars[n - 1].close;
  const dirN = dir === "buy" ? 1 : -1;

  // impulse leg: from the last opposite-side extreme (leg start) to the last
  // same-side extreme (leg end). A fresh impulse with one confirmed swing high
  // is the common case — one same-side pivot is enough.
  const { highs, lows } = findPivots(bars, 3, 3);
  const sameSide = dirN === 1 ? highs : lows;
  const oppSide = dirN === 1 ? lows : highs;
  if (sameSide.length < 1 || oppSide.length < 1) return null;
  const legEnd = sameSide[sameSide.length - 1];
  const legStart = oppSide.filter((p) => p.i < legEnd.i).slice(-1)[0];
  if (!legStart) return null;
  const impSize = Math.abs(legEnd.price - legStart.price);
  if (impSize <= 0) return null;

  // current retracement depth from the leg end back toward the leg start
  const retrace = dirN === 1
    ? Math.max(0, legEnd.price - px)
    : Math.max(0, px - legEnd.price);
  const depth = retrace / impSize;

  // structural signal (independent of depth): broke the leg origin = body-close
  // past 100% → structure flipped → reversal/invalidation.
  const brokeOrigin = dirN === 1 ? px < legStart.price : px > legStart.price;

  // liquidity-build: equal clusters, trendline formation, or slow grind
  const liq = liquidityMap(bars, avgRange(bars));
  const hasEqualBuilds = (liq.builds || []).some((b) => Math.abs(b.price - px) < 0.5 * impSize);

  // direct equal-highs/lows detection on recent bars (catches consolidation pivot-based doesn't)
  const pullbackBars = bars.slice(Math.max(0, legEnd.i - 5)); // include a few bars before leg end
  const atr = avgRange(bars);
  const tol = 0.3 * atr;
  const hasRawEqualHighs = dirN === 1 && detectEqualLevels(pullbackBars.map(b => b.high), tol) >= 4;
  const hasRawEqualLows = dirN === -1 && detectEqualLevels(pullbackBars.map(b => b.low), tol) >= 4;

  // trendline: 3+ pivots bouncing along a line (ascending channel for buy retrace)
  const recentPivots = dirN === 1
    ? highs.filter(p => p.i >= legEnd.i).slice(-5)  // highs after the leg peak (buy pullback makes lower highs)
    : lows.filter(p => p.i >= legEnd.i).slice(-5);   // lows after the leg peak (sell pullback makes higher lows)
  const hasTrendline = recentPivots.length >= 3 && detectTrendline(recentPivots, bars);

  // slow grind: many bars with small net movement (coiling in time, not just price)
  const slowGrind = pullbackBars.length >= 12
    && retrace / impSize < 0.5
    && (retrace / pullbackBars.length) < atr * 0.3;  // avg retrace per bar < 30% of ATR

  const hasBuild = hasEqualBuilds || hasRawEqualHighs || hasRawEqualLows || hasTrendline || slowGrind;

  let type, score, note;
  if (brokeOrigin) {
    type = "reversal"; score = cfg.reversalW ?? -14; note = `broke origin @ ${r5(legStart.price)} (struct flip)`;
  } else if (hasBuild && depth < 0.5) {
    const reasons = [];
    if (hasEqualBuilds || hasRawEqualHighs || hasRawEqualLows) reasons.push("EQ");
    if (hasTrendline) reasons.push("trendline");
    if (slowGrind) reasons.push("slow grind");
    type = "liquidity-building";
    score = cfg.liqBuildW ?? 10;
    note = `shallow ${Math.round(depth*100)}% coiling (${reasons.join(", ")})`;
  } else if (depth >= 0.62 && depth <= 0.79) {
    type = "ote"; score = cfg.oteW ?? 8; note = `OTE ${Math.round(depth*100)}% (mid 70.5%)`;
  } else if (depth > 0.79) {
    type = "deep"; score = cfg.deepW ?? -4; note = `deep ${Math.round(depth*100)}% — near origin`;
  } else {
    type = "weak"; score = cfg.weakW ?? -3; note = `weak/premature ${Math.round(depth*100)}%`;
  }
  return { type, depth: Math.round(depth*100)/100, score, note };
}

// Detect if pivots form a trendline (3+ pivots with consistent slope, allows curve)
function detectTrendline(pivots, bars) {
  if (pivots.length < 3) return false;
  // fit line: y = mx + b where x=bar index, y=price
  const n = pivots.length;
  const sumX = pivots.reduce((s, p) => s + p.i, 0);
  const sumY = pivots.reduce((s, p) => s + p.price, 0);
  const sumXY = pivots.reduce((s, p) => s + p.i * p.price, 0);
  const sumX2 = pivots.reduce((s, p) => s + p.i * p.i, 0);
  const m = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const b = (sumY - m * sumX) / n;
  // check fit: all pivots within 2 ATR of the line
  const atr = avgRange(bars);
  const fits = pivots.every(p => {
    const expected = m * p.i + b;
    return Math.abs(p.price - expected) < 2 * atr;
  });
  return fits && Math.abs(m) > 0; // slope exists
}

function detectEqualLevels(prices, tol) {
  if (!prices || prices.length < 2) return 0;
  let maxCluster = 0;
  for (let i = 0; i < prices.length; i++) {
    let clusterSize = 1;
    for (let j = 0; j < prices.length; j++) {
      if (i !== j && Math.abs(prices[i] - prices[j]) <= tol) {
        clusterSize++;
      }
    }
    if (clusterSize > maxCluster) maxCluster = clusterSize;
  }
  return maxCluster;
}

const r5 = (v) => (v == null ? "" : Math.round(v * 1e5) / 1e5);
