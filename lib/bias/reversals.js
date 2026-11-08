import { findPivots } from "../patterns/core.js";

// Reversal-Anatomy Detectors — Candle behavior that marks institutional strong highs/lows:
//   · sweep-rejection wick: long wick through liquidity, solid body closing back
//     (Grade A when it swept an INTACT prior swing level without prior breach)
//   · V-shape reversal: sharp impulsive leg into extreme, recovered >= 70% with confirmed velocity
//   · grind -> displacement: slow, compressed overlapping drift broken by an impulsive expansion candle
//   · strongLevels(): standing defended reversal extremes that act as macro support/resistance floors

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

// ---------- Long-Wick Rejection Candle (with Intact Swing Sweep Verification) ----------
export function sweepWickCandle(bars, avg = null, lookback = 24) {
  bars = (bars || []).filter((b) => b.closed !== false && b.isClosed !== false);
  const n = bars.length;
  if (n < 5) return null;

  const a = avg && avg > 0 ? avg : computeCausalAtr(bars);
  const eps = 0.05 * a;
  const { highs, lows } = findPivots(bars, 3, 3);

  for (let i = n - 1; i >= Math.max(1, n - lookback); i--) {
    const b = bars[i];
    const range = b.high - b.low;
    if (range < 1.15 * a) continue;
    const body = Math.abs(b.close - b.open);
    if (body < 0.15 * range) continue; // Allows clean pin-bars while rejecting flat zero-body noise
    const lowerWick = Math.min(b.open, b.close) - b.low;
    const upperWick = b.high - Math.max(b.open, b.close);

    // Bullish: long lower wick (>= 55% of range), close in upper 35% of range
    if (lowerWick >= 0.55 * range && b.close >= b.high - 0.35 * range) {
      // Intact Pivot Sweep Verification:
      // A sweep is Grade A ONLY if the swept swing low was INTACT before candle i!
      // (No candle between pivot and bar i closed below the pivot price).
      let sweptPivot = null;
      for (const p of lows) {
        if (p.i < i - 1 && i - p.i <= 40 && b.low < p.price - eps && b.close > p.price) {
          let intact = true;
          for (let k = p.i + 1; k < i; k++) {
            if (bars[k].close < p.price) {
              intact = false;
              break;
            }
          }
          if (intact) {
            sweptPivot = p;
            break;
          }
        }
      }
      return {
        kind: "sweep-rejection",
        dir: 1,
        i,
        time: b.time,
        knownAt: b.time,
        age: n - 1 - i,
        extreme: b.low,
        grade: sweptPivot ? "A" : "B",
        swept: Boolean(sweptPivot),
        sweptLevel: sweptPivot ? { price: sweptPivot.price, i: sweptPivot.i, time: sweptPivot.time } : null,
        wickRatio: Math.round((lowerWick / range) * 100) / 100,
      };
    }

    // Bearish: long upper wick (>= 55% of range), close in lower 35% of range
    if (upperWick >= 0.55 * range && b.close <= b.low + 0.35 * range) {
      let sweptPivot = null;
      for (const p of highs) {
        if (p.i < i - 1 && i - p.i <= 40 && b.high > p.price + eps && b.close < p.price) {
          let intact = true;
          for (let k = p.i + 1; k < i; k++) {
            if (bars[k].close > p.price) {
              intact = false;
              break;
            }
          }
          if (intact) {
            sweptPivot = p;
            break;
          }
        }
      }
      return {
        kind: "sweep-rejection",
        dir: -1,
        i,
        time: b.time,
        knownAt: b.time,
        age: n - 1 - i,
        extreme: b.high,
        grade: sweptPivot ? "A" : "B",
        swept: Boolean(sweptPivot),
        sweptLevel: sweptPivot ? { price: sweptPivot.price, i: sweptPivot.i, time: sweptPivot.time } : null,
        wickRatio: Math.round((upperWick / range) * 100) / 100,
      };
    }
  }
  return null;
}

// ---------- V-Shape Reversal (with Speed Verification & Extreme Protection) ----------
export function vReversal(bars, avg = null, window = 10) {
  bars = (bars || []).filter((b) => b.closed !== false && b.isClosed !== false);
  const n = bars.length;
  if (n < 8) return null;

  const a = avg && avg > 0 ? avg : computeCausalAtr(bars);
  const { highs, lows } = findPivots(bars, 3, 3);

  const scan = (pivots, dir) => {
    for (let k = pivots.length - 1; k >= Math.max(0, pivots.length - 4); k--) {
      const P = pivots[k];
      const preStart = Math.max(0, P.i - window);
      const pre = bars.slice(preStart, P.i);
      const post = bars.slice(P.i + 1, Math.min(n, P.i + 1 + window));
      if (pre.length < 2 || post.length < 2) continue;

      // Find the apex of the pre-drop/pre-rally leg
      let peakI = preStart;
      let peakPrice = dir === 1 ? -Infinity : Infinity;
      for (let m = 0; m < pre.length; m++) {
        const p = pre[m];
        if (dir === 1 ? p.high > peakPrice : p.low < peakPrice) {
          peakPrice = dir === 1 ? p.high : p.low;
          peakI = preStart + m;
        }
      }
      const tLeg = Math.max(1, P.i - peakI);
      const leg = dir === 1 ? peakPrice - P.price : P.price - peakPrice;
      if (leg < 2.0 * a) continue;

      // Recovery >= 70% of the leg, verified that price did not break the V extreme prior to recovery
      let recoveredAt = null;
      let lowerLowMade = false;

      for (let j = 0; j < post.length; j++) {
        const b = post[j];
        if (dir === 1 ? b.low < P.price : b.high > P.price) {
          lowerLowMade = true;
          break; // V extreme was violated!
        }
        const back = dir === 1 ? b.close - P.price : P.price - b.close;
        if (back >= 0.70 * leg) {
          recoveredAt = P.i + 1 + j;
          break;
        }
      }
      if (lowerLowMade || recoveredAt == null) continue;

      // Velocity check: recovery must be reasonably prompt (tRec <= tLeg * 1.75)
      const tRec = recoveredAt - P.i;
      if (tRec > Math.max(3, Math.round(tLeg * 1.75))) continue;

      return {
        kind: "V-reversal",
        dir,
        i: P.i,
        time: bars[P.i].time,
        recoveredAt,
        knownAt: bars[recoveredAt].time,
        age: n - 1 - recoveredAt,
        extreme: P.price,
        grade: leg >= 3.5 * a ? "A" : "B",
        legRatio: Math.round((leg / a) * 10) / 10,
        tLeg,
        tRec,
      };
    }
    return null;
  };

  const bull = scan(lows, 1);
  const bear = scan(highs, -1);

  if (bull && bear) {
    if (bull.age !== bear.age) return bull.age < bear.age ? bull : bear;
    return bull.legRatio >= bear.legRatio ? bull : bear;
  }
  return bull || bear;
}

// ---------- Slow Retracement -> Sharp Displacement ----------
export function grindThenDisplacement(bars, avg = null) {
  bars = (bars || []).filter((b) => b.closed !== false && b.isClosed !== false);
  const n = bars.length;
  if (n < 12) return null;

  const a = avg && avg > 0 ? avg : computeCausalAtr(bars);

  for (let i = n - 1; i >= Math.max(10, n - 8); i--) {
    const D = bars[i];
    const dBody = Math.abs(D.close - D.open);
    if (dBody < 1.25 * a) continue;
    const dir = Math.sign(D.close - D.open);
    if (!dir) continue;

    const grind = bars.slice(i - 8, i);
    const bodies = grind.map((b) => Math.abs(b.close - b.open));
    const meanBody = bodies.reduce((s, v) => s + v, 0) / bodies.length;
    const drift = grind[grind.length - 1].close - grind[0].open;

    // Slow, overlapping compression drift AGAINST the displacement direction
    const slow = meanBody < 0.65 * a && Math.max(...bodies) < 0.95 * a;
    const counterDrift = Math.sign(drift) === -dir && Math.abs(drift) >= 0.75 * a;
    const velocityRatio = dBody / Math.max(meanBody, 0.1 * a);

    if (slow && counterDrift && velocityRatio >= 2.0) {
      return {
        kind: "grind→displacement",
        dir,
        i,
        time: D.time,
        knownAt: D.time,
        age: n - 1 - i,
        ratio: Math.round(velocityRatio * 10) / 10,
      };
    }
  }
  return null;
}

// ---------- Standing Strong Lows/Highs (HTF Memory & Defensive Floors) ----------
export function strongLevels(bars, avg = null, lookback = 60) {
  bars = (bars || []).filter((b) => b.closed !== false && b.isClosed !== false);
  const n = bars.length;
  if (n < 5) return [];

  const a = avg && avg > 0 ? avg : computeCausalAtr(bars);
  const out = [];
  const startIdx = Math.max(0, n - lookback);

  // Single-pass linear scan across the window for candidate reversal candles & V-extremes
  const candidates = [];

  // 1. Collect qualifying rejection wicks across the window
  const eps = 0.05 * a;
  const { highs, lows } = findPivots(bars, 3, 3);

  for (let i = startIdx; i < n; i++) {
    const b = bars[i];
    const range = b.high - b.low;
    if (range < 1.15 * a) continue;
    const body = Math.abs(b.close - b.open);
    if (body < 0.15 * range) continue;
    const lowerWick = Math.min(b.open, b.close) - b.low;
    const upperWick = b.high - Math.max(b.open, b.close);

    if (lowerWick >= 0.55 * range && b.close >= b.high - 0.35 * range) {
      candidates.push({ kind: "sweep-rejection", dir: 1, i, extreme: b.low, grade: "B" });
    } else if (upperWick >= 0.55 * range && b.close <= b.low + 0.35 * range) {
      candidates.push({ kind: "sweep-rejection", dir: -1, i, extreme: b.high, grade: "B" });
    }
  }

  // 2. Collect qualifying V-reversals
  for (const p of lows.filter((p) => p.i >= startIdx)) {
    const pre = bars.slice(Math.max(0, p.i - 10), p.i);
    const post = bars.slice(p.i + 1, Math.min(n, p.i + 11));
    if (pre.length >= 2 && post.length >= 2) {
      const leg = Math.max(...pre.map((b) => b.high)) - p.price;
      if (leg >= 2.0 * a) {
        const recovered = post.some((b) => b.close - p.price >= 0.70 * leg);
        if (recovered) candidates.push({ kind: "V-reversal", dir: 1, i: p.i, extreme: p.price, grade: leg >= 3.5 * a ? "A" : "B" });
      }
    }
  }
  for (const p of highs.filter((p) => p.i >= startIdx)) {
    const pre = bars.slice(Math.max(0, p.i - 10), p.i);
    const post = bars.slice(p.i + 1, Math.min(n, p.i + 11));
    if (pre.length >= 2 && post.length >= 2) {
      const leg = p.price - Math.min(...pre.map((b) => b.low));
      if (leg >= 2.0 * a) {
        const recovered = post.some((b) => p.price - b.close >= 0.70 * leg);
        if (recovered) candidates.push({ kind: "V-reversal", dir: -1, i: p.i, extreme: p.price, grade: leg >= 3.5 * a ? "A" : "B" });
      }
    }
  }

  // 3. Evaluate violation and deduplicate by proximity (cluster nearby levels within 0.35 ATR)
  for (const sig of candidates) {
    let violated = false;
    for (let j = sig.i + 1; j < n; j++) {
      if (sig.dir === 1 ? bars[j].close < sig.extreme : bars[j].close > sig.extreme) {
        violated = true;
        break;
      }
    }
    if (violated) continue;

    // Check proximity deduplication against existing unviolated levels
    const existing = out.find((l) => l.dir === sig.dir && Math.abs(l.price - sig.extreme) <= 0.35 * a);
    if (existing) {
      existing.touchCount = (existing.touchCount || 1) + 1;
      if (sig.grade === "A") existing.grade = "A";
      continue;
    }

    out.push({
      id: `SL:${sig.dir === 1 ? "L" : "H"}:${bars[sig.i].time}`,
      side: sig.dir === 1 ? "low" : "high", // Preserved string side for full backward compatibility
      sideNum: sig.dir,
      dir: sig.dir,
      price: sig.extreme,
      i: sig.i,
      time: bars[sig.i].time,
      knownAt: sig.knownAt ?? bars[sig.i].time,
      age: n - 1 - sig.i,
      kind: sig.kind,
      grade: sig.grade,
      touchCount: 1,
    });
  }

  return out;
}
