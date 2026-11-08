// lib/bias/retracement.js — Institutional SMC Retracement Quality & Velocity Engine
// Evaluates the depth, velocity, liquidity engineering, and structural integrity of market pullbacks.
// Replaces naive fibonacci checks with multi-pillar institutional physics:
// 1. Dynamic Impulse Leg Discovery (Origin to Crest)
// 2. Strict Institutional OTE Pricing Zones (61.8% - 78.6% with 70.5% sweet spot)
// 3. Retracement Velocity Ratio (Corrective Compression vs Adverse Freight Train)
// 4. Liquidity Architecture (Inducement, Trendline Compression, Equal Extremes)
// 5. Mitigation Confluence with Multi-Timeframe Dealing Ranges & Anchors

import { avgRange, findPivots } from "../patterns/core.js";

/**
 * Causal ATR calculator (rolling window of 14 bars)
 */
export function computeCausalAtr(bars, count = 14) {
  if (!bars || bars.length < 2) return 1.0;
  const n = Math.min(bars.length - 1, count);
  let trSum = 0;
  for (let k = Math.max(1, bars.length - n); k < bars.length; k++) {
    const p = bars[k - 1].close;
    trSum += Math.max(bars[k].high - bars[k].low, Math.abs(bars[k].high - p), Math.abs(bars[k].low - p));
  }
  return n > 0 ? trSum / n : 1.0;
}

/**
 * Institutional Retracement Depth Classifications
 */
export const RETRACEMENT_STAGES = {
  SHALLOW_CHASING: "SHALLOW_CHASING",             // < 38.2% (Premature, chasing momentum, poor R:R)
  EQUILIBRIUM_DISCOUNT: "EQUILIBRIUM_DISCOUNT",   // 38.2% - 61.8% (Crosses 50% equilibrium threshold)
  OTE_GOLDEN_POCKET: "OTE_GOLDEN_POCKET",         // 61.8% - 78.6% (Institutional OTE sweet spot, 70.5% center)
  DEEP_ORIGIN_TEST: "DEEP_ORIGIN_TEST",           // 78.6% - 100.0% (Deep test of origin defense order blocks)
  ORIGIN_VIOLATED: "ORIGIN_VIOLATED",             // > 100.0% (Structural invalidation: body close broke leg origin)
};

/**
 * Analyzes the dynamic retracement quality of the current active swing leg.
 *
 * @param {Array<Object>} bars - Array of closed price bars (UTC epoch instant)
 * @param {number|string} dir - Direction of the impulse trend (1/"buy" for Bullish, -1/"sell" for Bearish)
 * @param {Object} options - Contextual options
 * @param {string} [options.tf="15M"] - Timeframe being analyzed
 * @param {Object} [options.dealingRange=null] - Dealing range object from computeDealingRange()
 * @param {Object} [options.structure=null] - Structure object from analyzeStructure()
 * @param {number} [options.avg=null] - Pre-calculated ATR
 * @returns {Object|null} Comprehensive retracement quality assessment
 */
export function analyzeRetracementQuality(bars, dir, options = {}) {
  const cleanBars = (bars || []).filter((b) => b && b.closed !== false && b.isClosed !== false);
  const n = cleanBars.length;
  if (!n || n < 15) return null;

  const dirN = dir === 1 || dir === "buy" || dir === "BULLISH" ? 1 : dir === -1 || dir === "sell" || dir === "BEARISH" ? -1 : 0;
  if (!dirN) return null;

  const tf = options.tf || "15M";
  const atr = (typeof options.avg === "number" && options.avg > 0) ? options.avg : computeCausalAtr(cleanBars);
  const currentBar = cleanBars[n - 1];
  const currentPrice = currentBar.close;

  // =========================================================================
  // 1. DYNAMIC IMPULSE LEG DISCOVERY
  // =========================================================================
  // Find the authoritative impulse swing that established the current directional bias.
  // Pivot search depth scales dynamically with timeframe (e.g. 3/3 for M15, 4/4 for H1/H4).
  const pivotWindow = tf === "M5" || tf === "M1" ? 2 : tf === "M15" ? 3 : 4;
  const { highs, lows } = findPivots(cleanBars, pivotWindow, pivotWindow);

  // In an uptrend: impulse ends at the highest swing high, starts at preceding swing low.
  // In a downtrend: impulse ends at the lowest swing low, starts at preceding swing high.
  const sameSidePivots = dirN === 1 ? highs : lows;
  const oppSidePivots = dirN === 1 ? lows : highs;

  if (!sameSidePivots.length || !oppSidePivots.length) return null;

  // The apex of the impulse move
  const legEnd = sameSidePivots[sameSidePivots.length - 1];
  if (!legEnd || legEnd.i < 5) return null;

  // The origin of that impulse leg (must have formed before the leg ended)
  const candidateOrigins = oppSidePivots.filter((p) => p.i < legEnd.i);
  if (!candidateOrigins.length) return null;

  // Select the true structural origin (most significant opposite extreme before the impulse)
  const legStart = candidateOrigins.reduce((best, cur) => {
    if (!best) return cur;
    return dirN === 1 ? (cur.price < best.price ? cur : best) : (cur.price > best.price ? cur : best);
  }, null);

  if (!legStart) return null;

  const impulseSize = Math.abs(legEnd.price - legStart.price);
  const impulseAtrMultiple = atr > 0 ? impulseSize / atr : 0;

  // An impulse leg must have meaningful structural displacement (at least 1.25x ATR)
  if (impulseSize <= 0 || impulseAtrMultiple < 1.25) return null;

  const impulseBarCount = Math.max(1, legEnd.i - legStart.i);
  const impulseBars = cleanBars.slice(legStart.i, legEnd.i + 1);
  const impulseBodies = impulseBars.map((b) => Math.abs(b.close - b.open));
  const impulseAvgBody = impulseBodies.reduce((s, v) => s + v, 0) / impulseBodies.length;

  // =========================================================================
  // 2. FIBONACCI DEPTH & PRICING ZONES
  // =========================================================================
  // Retracement distance from impulse apex back towards origin
  const retraceDistance = dirN === 1 ? (legEnd.price - currentPrice) : (currentPrice - legEnd.price);
  const rawDepth = retraceDistance / impulseSize;
  const depthPct = Math.round(rawDepth * 1000) / 10; // e.g. 70.5%

  // Strict SMC Stage Classification
  let stage = RETRACEMENT_STAGES.SHALLOW_CHASING;
  let isOriginBreached = false;

  if (rawDepth < 0.382) {
    stage = RETRACEMENT_STAGES.SHALLOW_CHASING;
  } else if (rawDepth >= 0.382 && rawDepth < 0.618) {
    stage = RETRACEMENT_STAGES.EQUILIBRIUM_DISCOUNT;
  } else if (rawDepth >= 0.618 && rawDepth <= 0.786) {
    stage = RETRACEMENT_STAGES.OTE_GOLDEN_POCKET;
  } else if (rawDepth > 0.786 && rawDepth <= 1.0) {
    stage = RETRACEMENT_STAGES.DEEP_ORIGIN_TEST;
  } else {
    stage = RETRACEMENT_STAGES.ORIGIN_VIOLATED;
    isOriginBreached = true;
  }

  // Exact Institutional OTE Fibonacci price levels for this specific impulse swing
  const fibLevels = {
    origin: legStart.price,
    crest: legEnd.price,
    eq50: Number((legStart.price + dirN * impulseSize * 0.50).toFixed(5)),
    ote618: Number((dirN === 1 ? legEnd.price - impulseSize * 0.618 : legEnd.price + impulseSize * 0.618).toFixed(5)),
    ote705: Number((dirN === 1 ? legEnd.price - impulseSize * 0.705 : legEnd.price + impulseSize * 0.705).toFixed(5)),
    ote786: Number((dirN === 1 ? legEnd.price - impulseSize * 0.786 : legEnd.price + impulseSize * 0.786).toFixed(5)),
  };

  // Distance from the current price to the institutional 70.5% sweet spot
  const distToSweetSpot = Math.abs(currentPrice - fibLevels.ote705);
  const distToSweetSpotPips = atr > 0 ? Math.round((distToSweetSpot / (atr * 0.1)) * 10) / 10 : 0;
  const inOtePocket = rawDepth >= 0.618 && rawDepth <= 0.786;

  // =========================================================================
  // 3. CANDLE VELOCITY PHYSICS (CORRECTIVE COMPRESSION VS FREIGHT TRAIN)
  // =========================================================================
  const pullbackBars = cleanBars.slice(legEnd.i + 1);
  const pullbackCount = Math.max(1, pullbackBars.length);

  let avgPullbackBody = 0;
  let maxPullbackBody = 0;
  let largeAdverseCandleCount = 0;
  let consecutiveAdverseBars = 0;
  let maxConsecutiveAdverse = 0;

  for (const b of pullbackBars) {
    const body = Math.abs(b.close - b.open);
    avgPullbackBody += body;
    if (body > maxPullbackBody) maxPullbackBody = body;

    // Adverse candle: close moved against the impulse direction
    const isAdverse = dirN === 1 ? b.close < b.open : b.close > b.open;
    if (isAdverse && body >= 1.25 * atr) {
      largeAdverseCandleCount++;
    }

    if (isAdverse) {
      consecutiveAdverseBars++;
      if (consecutiveAdverseBars > maxConsecutiveAdverse) maxConsecutiveAdverse = consecutiveAdverseBars;
    } else {
      consecutiveAdverseBars = 0;
    }
  }
  avgPullbackBody /= pullbackCount;

  // Relative Velocity: Speed of Retracement vs Speed of Impulse
  // Ideal SMC accumulation: Impulse is fast and explosive; retracement is slow, overlapping grind.
  const impulseSpeedPerBar = impulseSize / impulseBarCount;
  const pullbackSpeedPerBar = Math.max(0, retraceDistance) / pullbackCount;
  const velocityRatio = impulseSpeedPerBar > 0 ? (pullbackSpeedPerBar / impulseSpeedPerBar) : 1;
  const bodyRatio = impulseAvgBody > 0 ? (avgPullbackBody / impulseAvgBody) : 1;

  // Corrective Compression Criteria:
  // - Pullback is taking more bars than impulse relative to distance (velocity ratio <= 0.75)
  // - Average pullback candle body is small (< 0.70x ATR)
  // - No runaway adverse marubozus
  const isCorrectiveCompression = velocityRatio <= 0.75 && avgPullbackBody < 0.75 * atr && largeAdverseCandleCount === 0;

  // Adverse Freight Train Criteria:
  // - Rapid aggressive candles plunging into the zone (velocity ratio >= 1.60)
  // - Or 3+ consecutive large adverse candles (> 1.25x ATR)
  // - Or a single catastrophic liquidation candle (> 2.5x ATR)
  const isFreightTrain = (velocityRatio >= 1.60 && pullbackCount >= 2) ||
                         (maxConsecutiveAdverse >= 3 && maxPullbackBody >= 1.25 * atr) ||
                         (maxPullbackBody >= 2.5 * atr);

  // =========================================================================
  // 4. LIQUIDITY ARCHITECTURE & INDUCEMENT (IDM)
  // =========================================================================
  // Check if the retracement is engineering liquidity pools to fuel the expansion:
  // A. Trendline liquidity: series of 3+ descending lower highs (for buys) or higher lows (for sells)
  const pullbackPivots = dirN === 1
    ? highs.filter((p) => p.i > legEnd.i)
    : lows.filter((p) => p.i > legEnd.i);

  const hasTrendlineLiquidity = pullbackPivots.length >= 3;

  // B. Equal Highs / Equal Lows (EQH / EQL) formed during the pullback
  let hasEngineeredLiquidity = hasTrendlineLiquidity;
  const eqTol = 0.25 * atr;
  if (pullbackBars.length >= 6) {
    const extremes = pullbackBars.map((b) => (dirN === 1 ? b.high : b.low));
    let clusterMatches = 0;
    for (let i = 0; i < extremes.length; i++) {
      for (let j = i + 1; j < extremes.length; j++) {
        if (Math.abs(extremes[i] - extremes[j]) <= eqTol) {
          clusterMatches++;
        }
      }
    }
    if (clusterMatches >= 3) hasEngineeredLiquidity = true;
  }

  // =========================================================================
  // 5. MITIGATION CONFLUENCE (DEALING RANGE & ANCHORS)
  // =========================================================================
  let rangeDiscountAligned = false;
  let rangeZoneName = "MID_RANGE";

  if (options.dealingRange) {
    const dr = options.dealingRange;
    rangeZoneName = dr.zone || "MID_RANGE";
    // For buy trades: Price must be in Discount (< 50% Equilibrium)
    // For sell trades: Price must be in Premium (> 50% Equilibrium)
    rangeDiscountAligned = dirN === 1
      ? (dr.currentPrice <= dr.eq || dr.pos <= 0.50)
      : (dr.currentPrice >= dr.eq || dr.pos >= 0.50);
  }

  // =========================================================================
  // 6. MULTI-PILLAR INSTITUTIONAL SCORING & QUALITY GRADING
  // =========================================================================
  let qualityGrade = "C";
  let score = 0;
  const confluenceReasons = [];
  const warnings = [];

  if (isOriginBreached) {
    qualityGrade = "F";
    score = -14;
    confluenceReasons.push(`Origin breached (${depthPct}%): structural failure`);
    warnings.push("Impulse swing origin broken; structure has inverted.");
  } else if (isFreightTrain) {
    qualityGrade = "F";
    score = -12;
    confluenceReasons.push(`Adverse Freight Train: violent velocity (${velocityRatio.toFixed(1)}x)`);
    warnings.push("Adverse liquidation velocity; high risk of slicing through discount levels.");
  } else if (inOtePocket) {
    // 61.8% - 78.6% Golden Pocket
    if (isCorrectiveCompression) {
      qualityGrade = "A+";
      score = 10;
      confluenceReasons.push(`A+ Corrective Compression into ${depthPct}% OTE Sweet Spot`);
    } else {
      qualityGrade = "A";
      score = 8;
      confluenceReasons.push(`Orderly Retracement in ${depthPct}% OTE Golden Pocket`);
    }
    if (hasEngineeredLiquidity) {
      score += 2;
      confluenceReasons.push("Clean engineered liquidity trendline above entry");
    }
    if (rangeDiscountAligned) {
      score += 1;
      confluenceReasons.push(`Aligned with ${tf} Dealing Range ${rangeZoneName}`);
    }
  } else if (stage === RETRACEMENT_STAGES.EQUILIBRIUM_DISCOUNT) {
    // 38.2% - 61.8% Equilibrium
    if (isCorrectiveCompression) {
      qualityGrade = "B+";
      score = 6;
      confluenceReasons.push(`Corrective pullback into ${depthPct}% Discount Equilibrium`);
    } else {
      qualityGrade = "B";
      score = 4;
      confluenceReasons.push(`Standard pullback to ${depthPct}%`);
    }
    if (hasEngineeredLiquidity) score += 1;
  } else if (stage === RETRACEMENT_STAGES.DEEP_ORIGIN_TEST) {
    // 78.6% - 100% Deep Test
    qualityGrade = isCorrectiveCompression ? "B-" : "C-";
    score = isCorrectiveCompression ? 2 : -4;
    confluenceReasons.push(`Deep extension (${depthPct}%): testing swing origin defense`);
    warnings.push("Deep extension near origin; demands confirmed LTF structural shift.");
  } else {
    // Shallow < 38.2% Chasing
    qualityGrade = "C";
    score = -3;
    confluenceReasons.push(`Shallow retracement (${depthPct}%): premature chasing`);
    warnings.push("Price has not reached institutional discount; awaiting deeper retracement.");
  }

  // Pre-formatted Bias Engine Drive (ready for lib/bias/engine.js)
  const biasDrive = {
    pillar: tf === "M15" || tf === "M5" ? "intraday" : "htf",
    lens: isOriginBreached || isFreightTrain ? "reversal" : "structure",
    label: `${tf} Retracement Quality`,
    dir: (isOriginBreached || isFreightTrain) ? -dirN : dirN,
    w: Math.abs(score),
    note: confluenceReasons.join(" · "),
  };

  return {
    tf,
    dir: dirN,
    dirLabel: dirN === 1 ? "BULLISH" : "BEARISH",
    stage,
    qualityGrade,
    depthPct,
    rawDepth,
    isCorrective: isCorrectiveCompression,
    isFreightTrain,
    isOriginBreached,
    inOtePocket,
    velocityRatio: Math.round(velocityRatio * 100) / 100,
    bodyRatio: Math.round(bodyRatio * 100) / 100,
    pullbackBarsCount: pullbackCount,
    impulseBarsCount: impulseBarCount,
    impulseSize,
    impulseAtrMultiple: Math.round(impulseAtrMultiple * 10) / 10,
    hasEngineeredLiquidity,
    rangeDiscountAligned,
    fibLevels,
    distToSweetSpotPips,
    score: Math.min(12, Math.max(-14, score)),
    confluenceReasons,
    warnings,
    summaryNote: confluenceReasons[0] || `${depthPct}% retracement (${qualityGrade})`,
    biasDrive,
    // Recommendations directly consumable by lib/bias/brain.js
    brainReadiness: {
      action: isOriginBreached ? "STAND_ASIDE" : isFreightTrain ? "WAIT_FOR_MSS" : inOtePocket ? "APPROVED" : stage === RETRACEMENT_STAGES.SHALLOW_CHASING ? "WAIT_PULLBACK" : "WAIT_SHIFT",
      allowedToTrade: inOtePocket && !isFreightTrain && !isOriginBreached,
      qualityScore: score,
      grade: qualityGrade,
    },
  };
}

/**
 * Multi-Timeframe Retracement Synthesis.
 * Evaluates retracement quality simultaneously across M15 (Intraday), H1 (Day Trade), and H4 (Macro Swing).
 *
 * @param {Object} frames - Multi-timeframe closed bars { M15, H1, H4 }
 * @param {Object} structures - Structures per timeframe from analyzeStructure()
 * @param {Object} dealingRanges - Dealing ranges from analyzeAllDealingRanges()
 * @param {number} macroDir - Macro trend direction (1 for Bullish, -1 for Bearish)
 * @returns {Object} Unified multi-timeframe retracement evaluation
 */
export function analyzeAllRetracements(frames = {}, structures = {}, dealingRanges = {}, macroDir = 0) {
  const evaluations = {};
  const drives = [];
  const warnings = [];

  const timeframes = [
    { tf: "M15", weightMult: 1.0, pillar: "intraday" },
    { tf: "H1",  weightMult: 1.2, pillar: "htf" },
    { tf: "H4",  weightMult: 1.5, pillar: "htf" },
  ];

  for (const { tf, weightMult, pillar } of timeframes) {
    const bars = frames[tf];
    if (!bars || bars.length < 15) continue;

    let tfDir = structures[tf]?.dir || macroDir;
    // Dynamic fallback: deduce active impulse direction from the most recent swing apex
    if (!tfDir && bars.length >= 15) {
      const pivotWindow = tf === "M5" || tf === "M1" ? 2 : tf === "M15" ? 3 : 4;
      const { highs, lows } = findPivots(bars, pivotWindow, pivotWindow);
      if (highs.length && lows.length) {
        const lastH = highs[highs.length - 1];
        const lastL = lows[lows.length - 1];
        tfDir = lastH.i > lastL.i ? 1 : -1;
      }
    }
    if (!tfDir) continue;

    const dr = dealingRanges?.ranges?.[tf] || null;
    const res = analyzeRetracementQuality(bars, tfDir, { tf, dealingRange: dr, structure: structures[tf] });

    if (res) {
      evaluations[tf] = res;

      // Push scaled drive for Bias Engine
      if (res.biasDrive && Math.abs(res.score) >= 4) {
        drives.push({
          pillar,
          lens: res.biasDrive.lens,
          label: `${tf} Retrace Quality (${res.qualityGrade})`,
          dir: res.biasDrive.dir,
          w: Math.round(res.biasDrive.w * weightMult),
          note: res.summaryNote,
        });
      }

      for (const w of res.warnings || []) {
        warnings.push(`${tf}: ${w}`);
      }
    }
  }

  // Cross-Timeframe Confluence: M15 + H1 both in OTE Golden Pocket
  const m15Res = evaluations.M15;
  const h1Res = evaluations.H1;
  const h4Res = evaluations.H4;

  let compositeGrade = "C";
  let compositeScore = 0;

  if (m15Res && h1Res && m15Res.inOtePocket && h1Res.inOtePocket && !m15Res.isFreightTrain) {
    compositeGrade = "A+";
    compositeScore = 12;
    drives.push({
      pillar: "htf",
      lens: "structure",
      label: "Dual-Timeframe OTE Nesting",
      dir: m15Res.dir,
      w: 10,
      note: "1H and 15M simultaneously in OTE Golden Pocket with corrective compression",
    });
  } else if (m15Res?.inOtePocket || h1Res?.inOtePocket) {
    compositeGrade = (m15Res?.isCorrective || h1Res?.isCorrective) ? "A" : "B+";
    compositeScore = 8;
  } else if (m15Res?.isFreightTrain || h1Res?.isFreightTrain) {
    compositeGrade = "F";
    compositeScore = -10;
  }

  return {
    evaluations,
    drives,
    warnings,
    compositeGrade,
    compositeScore,
    m15: m15Res || null,
    h1: h1Res || null,
    h4: h4Res || null,
  };
}
