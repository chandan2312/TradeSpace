import { findPivots, FAINT } from "./core.js";

// Double / triple tops & bottoms — clusters of near-equal swing highs (or
// lows) with a real pullback between them. Equal highs = resting buy-side
// liquidity; equal lows = sell-side. Only unswept clusters are drawn: once
// price wicks beyond the level the pool is consumed.
export function detectDoubleTopsBottoms(bars, ctx) {
  const { highs, lows } = findPivots(bars, 4, 4);
  const tol = 0.25 * ctx.avgRange;      // "equal" tolerance
  const minPullback = 0.8 * ctx.avgRange; // depth required between touches
  const maxSpacing = 80;                 // bars between consecutive touches
  const maxAge = 300;                    // ignore clusters ending too far back

  const out = [];
  out.push(...clusters(bars, highs, "top", tol, minPullback, maxSpacing, maxAge));
  out.push(...clusters(bars, lows, "bottom", tol, minPullback, maxSpacing, maxAge));
  return out;
}

function clusters(bars, pivots, side, tol, minPullback, maxSpacing, maxAge) {
  const isTop = side === "top";
  const found = [];

  let k = 0;
  while (k < pivots.length) {
    const group = [pivots[k]];
    let m = k + 1;
    while (m < pivots.length) {
      const cand = pivots[m];
      const prev = group[group.length - 1];
      if (cand.i - prev.i > maxSpacing) break;
      const level = isTop
        ? Math.max(...group.map((g) => g.price))
        : Math.min(...group.map((g) => g.price));
      if (Math.abs(cand.price - level) > tol) break;
      if (!pullbackBetween(bars, prev.i, cand.i, level, isTop, minPullback)) break;
      group.push(cand);
      m++;
    }

    if (group.length >= 2) {
      const level = isTop
        ? Math.max(...group.map((g) => g.price))
        : Math.min(...group.map((g) => g.price));
      const last = group[group.length - 1];
      const recent = bars.length - 1 - last.i <= maxAge;
      if (recent && !swept(bars, last.i, level, isTop, tol)) {
        const tag = (group.length === 2 ? "D" : "T") + (isTop ? "T" : "B");
        found.push({
          kind: "segment",
          i1: group[0].i,
          p1: level,
          i2: last.i,
          p2: level,
          extendRight: true,
          color: isTop ? FAINT.red : FAINT.green,
          dash: [4, 4],
          label: `${tag} ×${group.length}`,
          dots: group.map((g) => ({ i: g.i, p: g.price })),
        });
      }
      k = m; // groups don't overlap
    } else {
      k++;
    }
  }

  // keep only the most recent handful — this is a hint layer, not wallpaper
  return found.slice(-4);
}

// there must be an actual swing away from the level between two touches
function pullbackBetween(bars, i1, i2, level, isTop, minPullback) {
  let extreme = isTop ? Infinity : -Infinity;
  for (let i = i1 + 1; i < i2; i++) {
    extreme = isTop ? Math.min(extreme, bars[i].low) : Math.max(extreme, bars[i].high);
  }
  return isTop ? level - extreme >= minPullback : extreme - level >= minPullback;
}

// liquidity already taken? (any wick beyond the level after the last touch)
function swept(bars, lastTouchI, level, isTop, tol) {
  for (let i = lastTouchI + 1; i < bars.length; i++) {
    if (isTop ? bars[i].high > level + tol : bars[i].low < level - tol) return true;
  }
  return false;
}
