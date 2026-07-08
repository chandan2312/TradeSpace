import { findPivots } from "../patterns/core.js";

// Reversal-anatomy detectors — candle behaviour that marks strong highs/lows:
//   · sweep-rejection wick: long wick through liquidity, solid body closing
//     back (grade A when the wick actually ran a prior swing level)
//   · V-shape reversal: sharp leg into an extreme, recovered ≥70% just as fast
//   · grind → displacement: slow overlapping retracement, then a candle 2.5×
//     the grind's velocity the other way
// On HTF these candles create PROTECTED lows/highs — strongLevels() keeps
// them as standing evidence until price closes through them.

// ---------- long-wick rejection candle (optionally sweeping a swing) ----------
export function sweepWickCandle(bars, avg, lookback = 24) {
  const n = bars.length;
  const { highs, lows } = findPivots(bars, 3, 3);
  const eps = 0.05 * avg;

  for (let i = n - 1; i >= Math.max(1, n - lookback); i--) {
    const b = bars[i];
    const range = b.high - b.low;
    if (range < 1.3 * avg) continue;
    const body = Math.abs(b.close - b.open);
    if (body < 0.22 * range) continue;
    const lowerWick = Math.min(b.open, b.close) - b.low;
    const upperWick = b.high - Math.max(b.open, b.close);

    // bullish: long lower wick, close in the top third
    if (lowerWick >= 0.55 * range && b.close >= b.high - 0.35 * range) {
      const swept = lows.some((p) => p.i < i - 2 && i - p.i <= 40 && b.low < p.price - eps && b.close > p.price);
      return { kind: "sweep-rejection", dir: 1, i, age: n - 1 - i, extreme: b.low, grade: swept ? "A" : "B", swept };
    }
    // bearish mirror
    if (upperWick >= 0.55 * range && b.close <= b.low + 0.35 * range) {
      const swept = highs.some((p) => p.i < i - 2 && i - p.i <= 40 && b.high > p.price + eps && b.close < p.price);
      return { kind: "sweep-rejection", dir: -1, i, age: n - 1 - i, extreme: b.high, grade: swept ? "A" : "B", swept };
    }
  }
  return null;
}

// ---------- V-shape reversal ----------
export function vReversal(bars, avg, window = 10) {
  const n = bars.length;
  const { highs, lows } = findPivots(bars, 4, 4);

  const scan = (pivots, dir) => {
    for (let k = pivots.length - 1; k >= Math.max(0, pivots.length - 3); k--) {
      const P = pivots[k];
      const pre = bars.slice(Math.max(0, P.i - window), P.i);
      const post = bars.slice(P.i + 1, Math.min(n, P.i + 1 + window));
      if (pre.length < 3 || post.length < 3) continue;

      const leg = dir === 1
        ? Math.max(...pre.map((b) => b.high)) - P.price
        : P.price - Math.min(...pre.map((b) => b.low));
      if (leg < 2.2 * avg) continue;

      // recovery ≥70% of the leg, and note WHEN it recovered (freshness)
      let recoveredAt = null;
      for (let j = 0; j < post.length; j++) {
        const back = dir === 1 ? post[j].close - P.price : P.price - post[j].close;
        if (back >= 0.7 * leg) { recoveredAt = P.i + 1 + j; break; }
      }
      if (recoveredAt == null) continue;
      return { kind: "V-reversal", dir, i: P.i, age: n - 1 - recoveredAt, extreme: P.price, grade: leg >= 3.5 * avg ? "A" : "B" };
    }
    return null;
  };

  const bull = scan(lows, 1);
  const bear = scan(highs, -1);
  if (bull && bear) return bull.age <= bear.age ? bull : bear;
  return bull || bear;
}

// ---------- slow retracement → sharp reversal ----------
export function grindThenDisplacement(bars, avg) {
  const n = bars.length;
  for (let i = n - 1; i >= Math.max(12, n - 8); i--) {
    const D = bars[i];
    const dBody = Math.abs(D.close - D.open);
    if (dBody < 1.5 * avg) continue;
    const dir = Math.sign(D.close - D.open);

    const grind = bars.slice(i - 10, i);
    const bodies = grind.map((b) => Math.abs(b.close - b.open));
    const meanBody = bodies.reduce((s, v) => s + v, 0) / bodies.length;
    const drift = grind[grind.length - 1].close - grind[0].open;

    // slow, overlapping drift AGAINST the displacement, no impulses inside it
    const slow = meanBody < 0.55 * avg && Math.max(...bodies) < 0.9 * avg;
    const counterDrift = Math.sign(drift) === -dir && Math.abs(drift) >= avg;
    if (slow && counterDrift && dBody / (meanBody || avg) >= 2.5) {
      return { kind: "grind→displacement", dir, i, age: n - 1 - i, ratio: Math.round((dBody / (meanBody || avg)) * 10) / 10 };
    }
  }
  return null;
}

// ---------- standing strong lows/highs (HTF memory) ----------
// Every unviolated reversal extreme in the window stays on the books: a
// strong low below price is persistent bullish evidence and vice versa.
export function strongLevels(bars, avg, lookback = 60) {
  const n = bars.length;
  const out = [];
  const seen = new Set();

  const consider = (sig) => {
    if (!sig || seen.has(sig.i)) return;
    seen.add(sig.i);
    // violated? a close through the extreme kills the level
    for (let j = sig.i + 1; j < n; j++) {
      if (sig.dir === 1 ? bars[j].close < sig.extreme : bars[j].close > sig.extreme) return;
    }
    out.push({ side: sig.dir === 1 ? "low" : "high", price: sig.extreme, i: sig.i, age: n - 1 - sig.i, kind: sig.kind, grade: sig.grade });
  };

  // sweep the window in slices so we collect ALL qualifying candles, not
  // just the freshest
  for (let end = n; end > Math.max(20, n - lookback); end -= 6) {
    const slice = bars.slice(0, end);
    consider(sweepWickCandle(slice, avg, 6));
    consider(vReversal(slice, avg));
  }
  return out;
}
