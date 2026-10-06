import { confirmedFractals } from "./institutional.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const TF_SETTINGS = {
  M1:  { lookback: 60, left: 3, right: 3 },
  M5:  { lookback: 64, left: 3, right: 3 },
  M15: { lookback: 64, left: 3, right: 3 },
  H1:  { lookback: 72, left: 3, right: 3 },
  H4:  { lookback: 80, left: 3, right: 3 },
  D1:  { lookback: 60, left: 2, right: 2 },
};

// Multi-Timeframe Structural Dealing Range Engine
// Anchors dealing ranges to confirmed external fractal swings within relevant timeframe horizons.
export function computeDealingRange(bars, tf = "H4", avg = null, options = {}) {
  bars = (bars || []).filter((b) => b.closed !== false && b.isClosed !== false);
  if (!bars?.length) return null;

  const conf = TF_SETTINGS[tf] || { lookback: 80, left: 3, right: 3 };
  const lookback = options.lookback || conf.lookback;
  const win = bars.length > lookback ? bars.slice(-lookback) : bars;

  const piv = confirmedFractals(win);
  const chronological = [...piv.highs, ...piv.lows].sort(
    (a, b) => a.confirmedAt - b.confirmedAt || b.side - a.side
  );

  let high = null;
  let low = null;
  let lastH = null;
  let lastL = null;
  let revision = 0;

  for (const p of chronological) {
    if (p.side === 1) {
      if (!high || !low) {
        if (lastL && lastL.i < p.i && p.price > lastL.price) {
          high = p;
          low = lastL;
          revision++;
        }
      } else if (p.price > high.price) {
        high = p;
        revision++;
      }
      lastH = p;
    } else {
      if (!high || !low) {
        if (lastH && lastH.i < p.i && lastH.price > p.price) {
          high = lastH;
          low = p;
          revision++;
        }
      } else if (p.price < low.price) {
        low = p;
        revision++;
      }
      lastL = p;
    }
  }

  // Graceful fallback if confirmed fractals have not completed yet
  if (!high || !low || high.price <= low.price) {
    if (win.length < 2) return null;
    const maxBar = win.reduce((max, b, i) => (b.high > max.price ? { price: b.high, i, time: b.time } : max), { price: -Infinity, i: 0, time: 0 });
    const minBar = win.reduce((min, b, i) => (b.low < min.price ? { price: b.low, i, time: b.time } : min), { price: Infinity, i: 0, time: 0 });
    if (maxBar.price <= minBar.price) return null;
    const tLast = win.at(-1).time;
    high = { id: `FB:H:${maxBar.time}`, side: 1, i: maxBar.i, price: maxBar.price, time: maxBar.time, confirmedAt: win.length - 1, confirmationTime: tLast };
    low = { id: `FB:L:${minBar.time}`, side: -1, i: minBar.i, price: minBar.price, time: minBar.time, confirmedAt: win.length - 1, confirmationTime: tLast };
  }

  const rangeQuality = "CONFIRMED_EXTERNAL_SWINGS";
  const size = high.price - low.price;
  const currentPrice = options.currentPrice ?? win.at(-1).close;
  const currentTime = options.currentTime ?? win.at(-1).time;
  const eq = (high.price + low.price) / 2;
  const rawPos = (currentPrice - low.price) / size;
  const pos = clamp(rawPos, 0, 1);
  const coveragePct = Math.round(pos * 100);

  const zone = currentPrice === eq ? "EQUILIBRIUM" : pos < 0.25 ? "DEEP_DISCOUNT"
    : currentPrice < eq ? "DISCOUNT" : pos > 0.75 ? "DEEP_PREMIUM" : "PREMIUM";

  const status = currentPrice > high.price ? "EXPANDED_ABOVE" : currentPrice < low.price ? "EXPANDED_BELOW"
    : pos >= 0.88 ? "EXHAUSTED_HIGH" : pos <= 0.12 ? "EXHAUSTED_LOW"
    : currentPrice < eq ? "UNCOVERED_UPSIDE" : currentPrice > eq ? "UNCOVERED_DOWNSIDE" : "MID_RANGE";

  const id = `${tf}:DR:${low.time}:${high.time}`;

  return {
    tf,
    id,
    rangeQuality,
    high: high.price,
    low: low.price,
    eq,
    size,
    currentPrice,
    currentTime,
    pos: Math.round(pos * 1000) / 1000,
    rawPos,
    coveragePct,
    zone,
    status,
    isExhausted: status === "EXHAUSTED_HIGH" || status === "EXHAUSTED_LOW",
    exhaustedSide: status === "EXHAUSTED_HIGH" ? "high" : status === "EXHAUSTED_LOW" ? "low" : null,
    remainingToHigh: Math.max(0, high.price - currentPrice),
    remainingToLow: Math.max(0, currentPrice - low.price),
    remainingPctToHigh: 100 - coveragePct,
    remainingPctToLow: coveragePct,
    barsInWindow: win.length,
    anchorIds: { high: high.id, low: low.id },
    highAnchor: high,
    lowAnchor: low,
    confirmedAt: Math.max(high.confirmedAt, low.confirmedAt),
    confirmationTime: Math.max(high.confirmationTime, low.confirmationTime),
    revision,
  };
}

export function analyzeAllDealingRanges(frames, structures = {}, options = {}) {
  const ranges = {};

  for (const tf of ["M1", "M5", "M15", "H1", "H4", "D1"]) {
    if (frames[tf]) {
      const r = computeDealingRange(frames[tf], tf, null, options);
      if (r) ranges[tf] = r;
    }
  }

  const h4 = ranges.H4;
  const m15 = ranges.M15;
  const warnings = [];
  const alignments = [];

  if (h4?.status === "EXHAUSTED_HIGH") {
    warnings.push({
      type: "HTF_PREMIUM_EXHAUSTION",
      severity: "high",
      note: `H4 range ${h4.coveragePct}% covered (Deep Premium). Longs near range ceiling are high-risk.`,
    });
  }
  if (h4?.status === "EXHAUSTED_LOW") {
    warnings.push({
      type: "HTF_DISCOUNT_EXHAUSTION",
      severity: "high",
      note: `H4 range ${h4.coveragePct}% covered (Deep Discount). Shorts near range floor are high-risk.`,
    });
  }

  const dir = structures.H4?.dir ?? 0;
  if (h4 && m15 && dir === 1 && h4.remainingPctToHigh >= 20 && m15.remainingPctToHigh >= 20 && h4.coveragePct < 85) {
    alignments.push({
      type: "BULLISH_UNCOVERED_EXPANSION",
      dir: 1,
      note: `H4 in Discount (${h4.coveragePct}%) with ${m15.remainingPctToHigh}% uncovered upside runway.`,
    });
  }
  if (h4 && m15 && dir === -1 && h4.remainingPctToLow >= 20 && m15.remainingPctToLow >= 20 && h4.coveragePct > 15) {
    alignments.push({
      type: "BEARISH_UNCOVERED_EXPANSION",
      dir: -1,
      note: `H4 in Premium (${h4.coveragePct}%) with ${m15.remainingPctToLow}% uncovered downside runway.`,
    });
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
