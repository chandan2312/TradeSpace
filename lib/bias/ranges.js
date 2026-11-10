import { confirmedFractals, displacementAt } from "./institutional.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const TF_SETTINGS = {
  M1:  { lookback: 60, left: 3, right: 3 },
  M5:  { lookback: 64, left: 3, right: 3 },
  M15: { lookback: 64, left: 3, right: 3 },
  M30: { lookback: 68, left: 3, right: 3 },
  H1:  { lookback: 72, left: 3, right: 3 },
  H4:  { lookback: 80, left: 3, right: 3 },
  D1:  { lookback: 60, left: 2, right: 2 },
};

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

// Multi-Timeframe Structural Dealing Range Engine
// Anchors dealing ranges to confirmed external fractal swings or active noise-immune structural legs.
export function computeDealingRange(bars, tf = "H4", avg = null, options = {}) {
  bars = (bars || []).filter((b) => b.closed !== false && b.isClosed !== false);
  if (!bars?.length) return null;

  const conf = TF_SETTINGS[tf] || { lookback: 80, left: 3, right: 3 };
  const lookback = options.lookback || conf.lookback;

  // Compute fractals on the full series to prevent window-cliff edge truncation,
  // then filter pivots to those relevant to the lookback window.
  const piv = confirmedFractals(bars, { tf, left: conf.left, right: conf.right, allowAsymmetric: true });
  const startIdx = Math.max(0, bars.length - lookback);
  const win = bars.length > lookback ? bars.slice(-lookback) : bars;

  const relevantHighs = piv.highs.filter((p) => p.i >= startIdx);
  const relevantLows = piv.lows.filter((p) => p.i >= startIdx);

  const chronological = [...relevantHighs, ...relevantLows].sort(
    (a, b) => a.confirmedAt - b.confirmedAt || b.side - a.side
  );

  const effectiveAtr = avg && avg > 0 ? avg : computeCausalAtr(bars);
  const minBodyRatio = options.minBodyRatio ?? 0.50;
  const minAtrRatio = options.minAtrRatio ?? 0.85;

  let high = null;
  let low = null;
  let lastH = null;
  let lastL = null;
  let revision = 0;
  let isFallback = false;
  let structuralLegMeta = null;

  // 1. Walk confirmed pivots chronologically with Anti-Noise Gates
  // Gate 1: Candle Body Closes Only (wicks are liquidity sweeps, not structure breaks).
  // Gate 2: Displacement Verification (>= 50% body ratio & >= 0.85x ATR; anemic drift is rejected).
  for (const p of chronological) {
    if (p.side === 1) {
      if (!high || !low) {
        if (lastL && lastL.i < p.i && p.price > lastL.price) {
          high = p;
          low = lastL;
          revision++;
        }
      } else if (p.price > high.price) {
        let hasDisplacedBreak = false;
        let originL = low;
        for (let i = high.i + 1; i <= p.i; i++) {
          if (bars[i].close > high.price) {
            const disp = displacementAt(bars, i, 1, { avg: effectiveAtr, minBodyRatio, minAtrRatio });
            const dispNext = (i + 1 < bars.length)
              ? displacementAt(bars, i + 1, 1, { avg: effectiveAtr, minBodyRatio, minAtrRatio })
              : { valid: false };
            if (disp.valid || dispNext.valid) {
              hasDisplacedBreak = true;
              const candidates = piv.lows.filter((l) => l.i < i && l.i >= high.i - 10);
              if (candidates.length) originL = candidates.reduce((min, l) => (l.price < min.price ? l : min), candidates[0]);
              break;
            }
          }
        }
        if (hasDisplacedBreak) {
          const priorHighPrice = high.price;
          structuralLegMeta = { legType: "BOS", dir: 1, origin: originL, brokenLevel: priorHighPrice };
          low = originL;
        }
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
        let hasDisplacedBreak = false;
        let originH = high;
        for (let i = low.i + 1; i <= p.i; i++) {
          if (bars[i].close < low.price) {
            const disp = displacementAt(bars, i, -1, { avg: effectiveAtr, minBodyRatio, minAtrRatio });
            const dispNext = (i + 1 < bars.length)
              ? displacementAt(bars, i + 1, -1, { avg: effectiveAtr, minBodyRatio, minAtrRatio })
              : { valid: false };
            if (disp.valid || dispNext.valid) {
              hasDisplacedBreak = true;
              const candidates = piv.highs.filter((h) => h.i < i && h.i >= low.i - 10);
              if (candidates.length) originH = candidates.reduce((max, h) => (h.price > max.price ? h : max), candidates[0]);
              break;
            }
          }
        }
        if (hasDisplacedBreak) {
          const priorLowPrice = low.price;
          structuralLegMeta = { legType: "CHOCH", dir: -1, origin: originH, brokenLevel: priorLowPrice };
          high = originH;
        }
        low = p;
        revision++;
      }
      lastL = p;
    }
  }

  // Graceful fallback if confirmed fractals have not completed yet inside window
  if (!high || !low || high.price <= low.price) {
    if (win.length < 2) return null;
    const maxBar = win.reduce((max, b, i) => (b.high > max.price ? { price: b.high, i, time: b.time } : max), { price: -Infinity, i: 0, time: 0 });
    const minBar = win.reduce((min, b, i) => (b.low < min.price ? { price: b.low, i, time: b.time } : min), { price: Infinity, i: 0, time: 0 });
    if (maxBar.price <= minBar.price) return null;
    const tLast = win.at(-1).time;
    high = { id: `FB:H:${maxBar.time}`, side: 1, i: maxBar.i, price: maxBar.price, time: maxBar.time, confirmedAt: win.length - 1, confirmationTime: tLast };
    low = { id: `FB:L:${minBar.time}`, side: -1, i: minBar.i, price: minBar.price, time: minBar.time, confirmedAt: win.length - 1, confirmationTime: tLast };
    isFallback = true;
  }

  // 2. Check for recent active structural expansion beyond the last confirmed swing
  if (high && low && !isFallback) {
    for (let i = Math.max(high.i, low.i) + 1; i < bars.length; i++) {
      if (bars[i].close > high.price) {
        const disp = displacementAt(bars, i, 1, { avg: effectiveAtr, minBodyRatio, minAtrRatio });
        const dispNext = (i + 1 < bars.length)
          ? displacementAt(bars, i + 1, 1, { avg: effectiveAtr, minBodyRatio, minAtrRatio })
          : { valid: false };
        if (disp.valid || dispNext.valid) {
          let peakPrice = -Infinity;
          let peakBarIdx = i;
          let peakTime = bars[i].time;
          for (let k = high.i; k < bars.length; k++) {
            if (bars[k].high > peakPrice) {
              peakPrice = bars[k].high;
              peakBarIdx = k;
              peakTime = bars[k].time;
            }
          }
          const legSize = peakPrice - low.price;
          if (legSize >= 1.25 * effectiveAtr) {
            const priorHighPrice = high.price;
            high = {
              id: `EXP:H:${peakTime}`,
              side: 1,
              i: peakBarIdx,
              price: peakPrice,
              time: peakTime,
              confirmedAt: peakBarIdx,
              confirmationTime: peakTime,
            };
            structuralLegMeta = { legType: "BOS", dir: 1, origin: low, brokenLevel: priorHighPrice };
          }
        }
      } else if (bars[i].close < low.price) {
        const disp = displacementAt(bars, i, -1, { avg: effectiveAtr, minBodyRatio, minAtrRatio });
        const dispNext = (i + 1 < bars.length)
          ? displacementAt(bars, i + 1, -1, { avg: effectiveAtr, minBodyRatio, minAtrRatio })
          : { valid: false };
        if (disp.valid || dispNext.valid) {
          let troughPrice = Infinity;
          let troughBarIdx = i;
          let troughTime = bars[i].time;
          for (let k = low.i; k < bars.length; k++) {
            if (bars[k].low < troughPrice) {
              troughPrice = bars[k].low;
              troughBarIdx = k;
              troughTime = bars[k].time;
            }
          }
          const legSize = high.price - troughPrice;
          if (legSize >= 1.25 * effectiveAtr) {
            const priorLowPrice = low.price;
            low = {
              id: `EXP:L:${troughTime}`,
              side: -1,
              i: troughBarIdx,
              price: troughPrice,
              time: troughTime,
              confirmedAt: troughBarIdx,
              confirmationTime: troughTime,
            };
            structuralLegMeta = { legType: "CHOCH", dir: -1, origin: high, brokenLevel: priorLowPrice };
          }
        }
      }
    }
  }

  const size = high.price - low.price;
  const sizeAtr = effectiveAtr > 0 ? size / effectiveAtr : null;
  const isCompressed = sizeAtr != null && sizeAtr < 0.8;

  const rangeQuality = isCompressed
    ? "SUB_ATR_COMPRESSION"
    : isFallback
    ? "FALLBACK_WINDOW_EXTREMES"
    : structuralLegMeta
    ? (structuralLegMeta.legType === "CHOCH" ? "DISPLACED_CHOCH_STRUCTURAL_LEG" : "DISPLACED_BOS_STRUCTURAL_LEG")
    : "CONFIRMED_EXTERNAL_SWINGS";

  // Synchronized price evaluation: prioritize options.currentPrice (live) over completed bar close
  const currentPrice = options.currentPrice ?? win.at(-1).close;
  const currentTime = options.currentTime ?? win.at(-1).time;
  const eq = (high.price + low.price) / 2;
  const rawPos = size > 0 ? (currentPrice - low.price) / size : 0.5;
  const pos = clamp(rawPos, 0, 1);
  const coveragePct = Math.round(pos * 100);

  // Structural leg direction & categorization
  const direction = structuralLegMeta?.dir ?? (low.time < high.time ? 1 : -1);
  const legStart = direction === 1 ? low : high;
  const legEnd = direction === 1 ? high : low;
  const rangeType = revision >= 3 ? "CONSOLIDATION" : "IMPULSE_EXPANSION";

  // Equilibrium band (45% to 55%) prevents float equality failure
  const isEqBand = pos >= 0.45 && pos <= 0.55;
  const zone = isEqBand ? "EQUILIBRIUM" : pos < 0.25 ? "DEEP_DISCOUNT"
    : currentPrice < eq ? "DISCOUNT" : pos > 0.75 ? "DEEP_PREMIUM" : "PREMIUM";

  const status = currentPrice > high.price ? "EXPANDED_ABOVE" : currentPrice < low.price ? "EXPANDED_BELOW"
    : pos >= 0.88 ? "EXHAUSTED_HIGH" : pos <= 0.12 ? "EXHAUSTED_LOW"
    : currentPrice < eq ? "UNCOVERED_UPSIDE" : currentPrice > eq ? "UNCOVERED_DOWNSIDE" : "MID_RANGE";

  const id = `${tf}:DR:${low.time}:${high.time}`;

  // Institutional Fibonacci & OTE Levels
  const fibs = {
    high: high.price,
    extension162: direction === 1 ? high.price + size * 0.618 : low.price - size * 0.618,
    extension127: direction === 1 ? high.price + size * 0.272 : low.price - size * 0.272,
    premium79: low.price + size * 0.79,
    ote705: low.price + size * 0.705, // Institutional OTE midpoint
    premium618: low.price + size * 0.618,
    eq,
    discount382: low.price + size * 0.382,
    oteDiscount618: low.price + size * (1 - 0.618),
    oteDiscount705: low.price + size * (1 - 0.705),
    oteDiscount79: low.price + size * (1 - 0.79),
    low: low.price,
  };

  // Liquidity mapping: External Range Liquidity (ERL) and Internal Range Liquidity (IRL)
  const erl = {
    high: { id: `ERL:H:${high.time}`, price: high.price, side: 1, type: "EXTERNAL_RANGE_LIQUIDITY" },
    low: { id: `ERL:L:${low.time}`, price: low.price, side: -1, type: "EXTERNAL_RANGE_LIQUIDITY" },
  };
  const irl = {
    eq: { id: `IRL:EQ:${high.time}:${low.time}`, price: eq, type: "INTERNAL_RANGE_LIQUIDITY" },
  };

  const remainingToHigh = Math.max(0, high.price - currentPrice);
  const remainingToLow = Math.max(0, currentPrice - low.price);

  return {
    tf,
    id,
    rangeQuality,
    high: high.price,
    low: low.price,
    eq,
    size,
    sizeAtr,
    atr: effectiveAtr,
    currentPrice,
    currentTime,
    pos: Math.round(pos * 1000) / 1000,
    rawPos,
    coveragePct,
    zone,
    status,
    direction,
    rangeType,
    legStart,
    legEnd,
    isExhausted: status === "EXHAUSTED_HIGH" || status === "EXHAUSTED_LOW",
    exhaustedSide: status === "EXHAUSTED_HIGH" ? "high" : status === "EXHAUSTED_LOW" ? "low" : null,
    isExpandedAbove: currentPrice > high.price,
    isExpandedBelow: currentPrice < low.price,
    isExpanded: currentPrice > high.price || currentPrice < low.price,
    remainingToHigh,
    remainingToLow,
    remainingToHighAtr: effectiveAtr > 0 ? remainingToHigh / effectiveAtr : null,
    remainingToLowAtr: effectiveAtr > 0 ? remainingToLow / effectiveAtr : null,
    remainingPctToHigh: 100 - coveragePct,
    remainingPctToLow: coveragePct,
    barsInWindow: win.length,
    anchorIds: { high: high.id, low: low.id },
    highAnchor: high,
    lowAnchor: low,
    fibs,
    erl,
    irl,
    confirmedAt: Math.max(high.confirmedAt ?? 0, low.confirmedAt ?? 0),
    confirmationTime: Math.max(high.confirmationTime ?? 0, low.confirmationTime ?? 0),
    knownAt: Math.max(high.confirmationTime ?? 0, low.confirmationTime ?? 0),
    revision,
    structuralLegType: structuralLegMeta?.legType || (isFallback ? "FALLBACK" : "CONTAINER"),
    isStructuralLeg: Boolean(structuralLegMeta),
    brokenLevel: structuralLegMeta?.brokenLevel ?? null,
    impulseOriginPrice: structuralLegMeta?.origin?.price ?? null,
  };
}

const resolveFrame = (frames, tf) => {
  if (!frames) return null;
  if (frames[tf]) return frames[tf];
  // Support aliases: M15/15M, M30/30M, H4/4H, D1/1D
  const num = tf.replace(/^[A-Za-z]+/, "");
  const alpha = tf.replace(/[0-9]+/, "");
  const inverted = `${num}${alpha}`;
  if (frames[inverted]) return frames[inverted];
  return null;
};

export function analyzeAllDealingRanges(frames = {}, structures = {}, options = {}) {
  const ranges = {};

  const enrichedOptions = options;

  for (const tf of ["M1", "M5", "M15", "M30", "H1", "H4", "D1"]) {
    const bars = resolveFrame(frames, tf);
    if (bars?.length) {
      const r = computeDealingRange(bars, tf, null, enrichedOptions);
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
    const h4ZoneText = h4.coveragePct <= 50 ? "Discount" : "Premium";
    alignments.push({
      type: "BULLISH_UNCOVERED_EXPANSION",
      dir: 1,
      note: `H4 in ${h4ZoneText} (${h4.coveragePct}%) with ${m15.remainingPctToHigh}% uncovered upside runway.`,
    });
  }
  if (h4 && m15 && dir === -1 && h4.remainingPctToLow >= 20 && m15.remainingPctToLow >= 20 && h4.coveragePct > 15) {
    const h4ZoneText = h4.coveragePct >= 50 ? "Premium" : "Discount";
    alignments.push({
      type: "BEARISH_UNCOVERED_EXPANSION",
      dir: -1,
      note: `H4 in ${h4ZoneText} (${h4.coveragePct}%) with ${m15.remainingPctToLow}% uncovered downside runway.`,
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
    // Flattened direct accessors
    H4: h4,
    M15: m15,
    D1: ranges.D1,
    H1: ranges.H1,
    M30: ranges.M30,
    M5: ranges.M5,
    M1: ranges.M1,
  };
}
