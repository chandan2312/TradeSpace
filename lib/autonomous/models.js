// Institutional Entry Models Engine
// Implements the 5 core SMC / ICT dynamic entry models:
//   1. ICT 2022 Mentorship Model (Liquidity Sweep + MSS + Displacement FVG Retracement)
//   2. Turtle Soup Reversal (External Liquidity Raid & Fast Reclamation)
//   3. Breaker Block & Mitigation Retest (Failed Order Block Flip)
//   4. OTE Trend Continuation (Optimal Trade Entry 62-79% Fibonacci + Order Flow Defense)
//   5. ICT Silver Bullet (Algorithmic 60-Minute Killzone Window FVG Delivery)

import { avgRange, findPivots } from "../patterns/core.js";
import { getCurrentTimeSlot } from "./timeslots.js";

export const ENTRY_MODEL_DEFINITIONS = {
  ICT_2022: {
    id: "ict_2022",
    name: "ICT 2022 Mentorship Model",
    badge: "2022 Mentorship",
    description: "Liquidity Sweep + Market Structure Shift (MSS) + Displacement FVG CE Retracement.",
    idealContext: "Session opening reversal or strong continuation following a liquidity raid.",
  },
  TURTLE_SOUP: {
    id: "turtle_soup",
    name: "Turtle Soup Liquidity Raid",
    badge: "Turtle Soup",
    description: "External Range Liquidity Raid (PDH/PDL/Session Extreme) + Immediate Wick Rejection & Fast Reclamation.",
    idealContext: "Failed breakouts above/below key session levels offering ultra-tight invalidation.",
  },
  BREAKER_BLOCK: {
    id: "breaker_block",
    name: "Breaker Block & Mitigation Retest",
    badge: "Breaker Block",
    description: "Failed Order Block Flip — Violent displacement breaches prior high/low order block; retest offers high-probability mitigation.",
    idealContext: "V-shaped reversals and structural changes where trapped liquidity provides acceleration.",
  },
  OTE_CONTINUATION: {
    id: "ote_continuation",
    name: "OTE Trend Expansion (Optimal Trade Entry)",
    badge: "OTE Sweetspot",
    description: "Trend Continuation Retracement into 62% - 79% Fibonacci Golden Pocket with Order Block defense.",
    idealContext: "Strong trending markets in line with dominant 4H order flow and Macro Compass.",
  },
  SILVER_BULLET: {
    id: "silver_bullet",
    name: "ICT Silver Bullet Window",
    badge: "Silver Bullet",
    description: "Time-Window Algorithmic Delivery (London 11-12, NY AM 17-18, NY PM 22-23 EET) with clean FVG retest.",
    idealContext: "Strictly inside 60-minute algorithmic delivery windows targeting opposing session liquidity.",
  },
};

/**
 * Evaluates all 5 entry models dynamically and determines the optimal setup.
 * @param {Object} params
 * @param {string} params.symbol
 * @param {number} params.dir - 1 (Buy) or -1 (Sell)
 * @param {Object} params.scenario - active scenario (Intraday or Swing)
 * @param {Object} params.frames - candle bars { D1, H4, H1, M15 }
 * @param {Object} params.ranges - dealing ranges
 * @param {Object} params.htfFvg - 4H FVG lifecycle output
 * @param {Object} params.targetDOL - Draw on Liquidity target
 * @param {Object} params.config - user configuration
 * @param {Object} params.brain - market brain state
 * @returns {Object} Winning entry model and full evaluation comparison
 */
export function evaluateAllEntryModels({
  symbol,
  dir,
  scenario,
  frames,
  ranges,
  htfFvg,
  targetDOL,
  config = {},
  brain = {},
}) {
  const setupBars = scenario?.id === "swing" ? (frames.H4 || frames.H1) : (frames.H1 || frames.M15);
  const triggerBars = scenario?.id === "swing" ? (frames.H1 || frames.M15) : (frames.M15 || frames.H1);

  if (!setupBars || setupBars.length < 20) return null;

  const currentPrice = setupBars[setupBars.length - 1].close;
  const avg = avgRange(setupBars);
  const minRR = config.minRR || scenario?.minRR || 2.0;
  const activeTimeSlot = config?.currentTimeSlot || (config?.mockTime ? getCurrentTimeSlot(config.mockTime) : (setupBars?.length ? getCurrentTimeSlot(setupBars[setupBars.length - 1]) : getCurrentTimeSlot()));

  // Model Enabled Toggles
  const enabledMap = config.enabledModels || {
    ict_2022: true,
    turtle_soup: true,
    breaker_block: true,
    ote_continuation: true,
    silver_bullet: true,
  };

  const detectedModels = [];

  // ==========================================================================
  // MODEL 1: ICT 2022 Mentorship Model
  // ==========================================================================
  if (enabledMap.ict_2022 !== false) {
    const m2022 = detectIct2022Model({
      bars: triggerBars || setupBars,
      dir,
      avg,
      currentPrice,
      ranges,
      targetDOL,
      minRR,
      htfFvg,
      activeTimeSlot,
    });
    if (m2022) detectedModels.push(m2022);
  }

  // ==========================================================================
  // MODEL 2: Turtle Soup Liquidity Raid
  // ==========================================================================
  if (enabledMap.turtle_soup !== false) {
    const mTurtle = detectTurtleSoupModel({
      bars: setupBars,
      triggerBars,
      dir,
      avg,
      currentPrice,
      ranges,
      targetDOL,
      minRR,
      brain,
      activeTimeSlot,
    });
    if (mTurtle) detectedModels.push(mTurtle);
  }

  // ==========================================================================
  // MODEL 3: Breaker Block & Mitigation Retest
  // ==========================================================================
  if (enabledMap.breaker_block !== false) {
    const mBreaker = detectBreakerBlockModel({
      bars: setupBars,
      dir,
      avg,
      currentPrice,
      ranges,
      targetDOL,
      minRR,
      activeTimeSlot,
    });
    if (mBreaker) detectedModels.push(mBreaker);
  }

  // ==========================================================================
  // MODEL 4: OTE Trend Continuation (Optimal Trade Entry)
  // ==========================================================================
  if (enabledMap.ote_continuation !== false) {
    const mOte = detectOteContinuationModel({
      bars: setupBars,
      dir,
      avg,
      currentPrice,
      ranges,
      targetDOL,
      minRR,
      brain,
      activeTimeSlot,
    });
    if (mOte) detectedModels.push(mOte);
  }

  // ==========================================================================
  // MODEL 5: ICT Silver Bullet Window
  // ==========================================================================
  if (enabledMap.silver_bullet !== false) {
    const mSb = detectSilverBulletModel({
      bars: triggerBars || setupBars,
      dir,
      avg,
      currentPrice,
      ranges,
      targetDOL,
      minRR,
      activeTimeSlot,
    });
    if (mSb) detectedModels.push(mSb);
  }

  if (!detectedModels.length) return null;

  // ==========================================================================
  // Cross-Model Confluence Synergy Scoring
  // ==========================================================================
  for (let i = 0; i < detectedModels.length; i++) {
    const a = detectedModels[i];
    for (let j = 0; j < detectedModels.length; j++) {
      if (i === j) continue;
      const b = detectedModels[j];
      // If two distinct models have entry levels within 0.35 * avg of each other:
      if (Math.abs(a.entry - b.entry) <= avg * 0.35) {
        a.confluenceScore = Math.min(100, a.confluenceScore + 15);
        if (!a.confluenceTags.includes("MULTI_MODEL_CONFLUENCE")) {
          a.confluenceTags.push("MULTI_MODEL_CONFLUENCE");
          a.confluenceWith = a.confluenceWith || [];
          a.confluenceWith.push(b.name);
        }
      }
    }
  }

  // Sort by highest confluence score, prioritizing models that meet minimum R:R
  detectedModels.sort((a, b) => {
    if (a.meetsMinRR !== b.meetsMinRR) {
      return a.meetsMinRR ? -1 : 1;
    }
    return b.confluenceScore - a.confluenceScore;
  });

  const primary = detectedModels[0];

  return {
    ...primary,
    modelId: primary.id,
    modelName: primary.name,
    modelBadge: primary.badge,
    timeSlot: activeTimeSlot,
    allCandidates: detectedModels,
    candidateCount: detectedModels.length,
    meetsMinRR: primary.meetsMinRR,
  };
}

// ----------------------------------------------------------------------------
// Model 1: ICT 2022 Mentorship Model Detector
// ----------------------------------------------------------------------------
function detectIct2022Model({
  bars,
  dir,
  avg,
  currentPrice,
  ranges,
  targetDOL,
  minRR,
  htfFvg,
  activeTimeSlot,
}) {
  const n = bars.length;
  if (n < 15) return null;

  // 1. Find recent liquidity sweep + displacement FVG
  const { highs, lows } = findPivots(bars, 3, 3);
  let sweepBar = null;
  let sweepExtreme = null;

  if (dir === 1) {
    // Buy setup: Look for swept swing low followed by displacement upward
    for (let i = n - 15; i < n - 2; i++) {
      const b = bars[i];
      const prevLows = lows.filter((l) => l.i < i && l.i >= i - 20);
      for (const pl of prevLows) {
        if (b.low < pl.price && b.close > pl.price) {
          sweepBar = i;
          sweepExtreme = b.low;
          break;
        }
      }
      if (sweepBar) break;
    }
  } else {
    // Sell setup: Look for swept swing high followed by displacement downward
    for (let i = n - 15; i < n - 2; i++) {
      const b = bars[i];
      const prevHighs = highs.filter((h) => h.i < i && h.i >= i - 20);
      for (const ph of prevHighs) {
        if (b.high > ph.price && b.close < ph.price) {
          sweepBar = i;
          sweepExtreme = b.high;
          break;
        }
      }
      if (sweepBar) break;
    }
  }

  // 2. Discover displacement FVGs created after or near the sweep
  const startIdx = sweepBar ? sweepBar : Math.max(2, n - 12);
  const fvgs = [];
  for (let i = startIdx; i < n; i++) {
    const b0 = bars[i - 2];
    const b2 = bars[i];
    if (dir === 1 && b2.low > b0.high) {
      fvgs.push({
        top: b2.low,
        bottom: b0.high,
        ce: (b2.low + b0.high) / 2,
        age: n - 1 - i,
      });
    } else if (dir === -1 && b2.high < b0.low) {
      fvgs.push({
        top: b0.low,
        bottom: b2.high,
        ce: (b0.low + b2.high) / 2,
        age: n - 1 - i,
      });
    }
  }

  if (!fvgs.length) return null;
  const bestFvg = fvgs[fvgs.length - 1]; // Most recent displacement FVG

  const entry = bestFvg.ce;
  let sl = dir === 1
    ? (sweepExtreme ? sweepExtreme - avg * 0.35 : bestFvg.bottom - avg * 0.45)
    : (sweepExtreme ? sweepExtreme + avg * 0.35 : bestFvg.top + avg * 0.45);

  const tp = resolveTargetTP({ entry, dir, avg, ranges, targetDOL });
  const actualRisk = Math.abs(entry - sl);
  const actualReward = dir === 1 ? (tp - entry) : (entry - tp);
  const rr = actualRisk > 0 && actualReward > 0 ? Math.round((actualReward / actualRisk) * 100) / 100 : 0;

  let confluenceScore = 65;
  const confluenceTags = ["ICT_2022", "DISPLACEMENT_FVG"];

  if (sweepBar) {
    confluenceScore += 20;
    confluenceTags.push("SWEEP_CONFIRMED");
  }

  // Time slot affinity boost
  const timeBoost = activeTimeSlot?.modelAffinities?.ict_2022 || 0;
  confluenceScore += timeBoost;

  return {
    id: "ict_2022",
    name: "ICT 2022 Mentorship Model",
    badge: "2022 Mentorship",
    type: "FVG_CE",
    entry,
    sl,
    tp,
    rr,
    price: entry,
    zoneHigh: bestFvg.top,
    zoneLow: bestFvg.bottom,
    confluenceScore: Math.min(100, Math.max(10, confluenceScore)),
    confluenceTags,
    meetsMinRR: rr >= minRR,
    label: `2022 Model FVG CE (${entry.toFixed(4)})`,
    rationale: `Liquidity sweep confirmed with sharp displacement leaving unmitigated FVG CE at ${entry.toFixed(4)}. Target: ${tp.toFixed(4)} (${rr}R).`,
  };
}

// ----------------------------------------------------------------------------
// Model 2: Turtle Soup Liquidity Raid Detector
// ----------------------------------------------------------------------------
function detectTurtleSoupModel({
  bars,
  triggerBars,
  dir,
  avg,
  currentPrice,
  ranges,
  targetDOL,
  minRR,
  brain,
  activeTimeSlot,
}) {
  const n = bars.length;
  if (n < 15) return null;

  // Look for prominent key level raid on the last 1-6 bars
  const lookback = Math.min(n, 20);
  const { highs, lows } = findPivots(bars.slice(0, n - 4), 3, 3);
  if (!highs.length && !lows.length) return null;

  let raidLevel = null;
  let raidWick = null;

  if (dir === 1) {
    // Bullish Turtle Soup: price spiked below previous swing low, closed back inside
    for (const pl of lows.slice(-3)) {
      for (let i = n - 5; i < n; i++) {
        const b = bars[i];
        if (b.low < pl.price && b.close > pl.price) {
          raidLevel = pl.price;
          raidWick = b.low;
          break;
        }
      }
      if (raidLevel) break;
    }
  } else {
    // Bearish Turtle Soup: price spiked above previous swing high, closed back inside
    for (const ph of highs.slice(-3)) {
      for (let i = n - 5; i < n; i++) {
        const b = bars[i];
        if (b.high > ph.price && b.close < ph.price) {
          raidLevel = ph.price;
          raidWick = b.high;
          break;
        }
      }
      if (raidLevel) break;
    }
  }

  if (!raidLevel || !raidWick) return null;

  // Entry: Reclaimed level or immediate rejection retest zone
  const entry = raidLevel;
  // SL: Just beyond the raid wick (tight stop -> massive R:R!)
  const sl = dir === 1 ? raidWick - avg * 0.25 : raidWick + avg * 0.25;
  const tp = resolveTargetTP({ entry, dir, avg, ranges, targetDOL });

  const actualRisk = Math.abs(entry - sl);
  const actualReward = dir === 1 ? (tp - entry) : (entry - tp);
  const rr = actualRisk > 0 && actualReward > 0 ? Math.round((actualReward / actualRisk) * 100) / 100 : 0;

  let confluenceScore = 70;
  const confluenceTags = ["TURTLE_SOUP", "LIQUIDITY_RAID", "FAST_RECLAMATION"];

  if (activeTimeSlot?.phase === "KILLZONE") {
    confluenceScore += 15;
    confluenceTags.push("KILLZONE_RAID");
  }

  const timeBoost = activeTimeSlot?.modelAffinities?.turtle_soup || 0;
  confluenceScore += timeBoost;

  return {
    id: "turtle_soup",
    name: "Turtle Soup Liquidity Raid",
    badge: "Turtle Soup",
    type: "RECLAIMED_KEY_LEVEL",
    entry,
    sl,
    tp,
    rr,
    price: entry,
    zoneHigh: Math.max(raidLevel, raidWick),
    zoneLow: Math.min(raidLevel, raidWick),
    confluenceScore: Math.min(100, Math.max(10, confluenceScore)),
    confluenceTags,
    meetsMinRR: rr >= minRR,
    label: `Turtle Soup Reclaim (${entry.toFixed(4)})`,
    rationale: `External liquidity raid at ${raidWick.toFixed(4)} immediately rejected and reclaimed key level ${raidLevel.toFixed(4)}. Ultra-tight SL with ${rr}R profile.`,
  };
}

// ----------------------------------------------------------------------------
// Model 3: Breaker Block & Mitigation Retest Detector
// ----------------------------------------------------------------------------
function detectBreakerBlockModel({
  bars,
  dir,
  avg,
  currentPrice,
  ranges,
  targetDOL,
  minRR,
  activeTimeSlot,
}) {
  const n = bars.length;
  if (n < 20) return null;

  // Bullish Breaker: Low -> High -> Lower Low (sweep) -> Displacement UP through High
  // Bearish Breaker: High -> Low -> Higher High (sweep) -> Displacement DOWN through Low
  const { highs, lows } = findPivots(bars, 2, 2);
  let breakerCandle = null;

  if (dir === 1 && lows.length >= 2 && highs.length >= 1) {
    const lastLow = lows[lows.length - 1];
    const prevLow = lows[lows.length - 2];
    const interveningHigh = highs.find((h) => h.i > prevLow.i && h.i < lastLow.i);

    if (interveningHigh && lastLow.price < prevLow.price) {
      // Check if price subsequently displaced ABOVE interveningHigh
      const recentBreak = bars.slice(lastLow.i).some((b) => b.close > interveningHigh.price);
      if (recentBreak) {
        // Find last down-close candle before interveningHigh
        for (let i = interveningHigh.i; i >= Math.max(0, interveningHigh.i - 5); i--) {
          if (bars[i].close < bars[i].open) {
            breakerCandle = bars[i];
            break;
          }
        }
      }
    }
  } else if (dir === -1 && highs.length >= 2 && lows.length >= 1) {
    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    const interveningLow = lows.find((l) => l.i > prevHigh.i && l.i < lastHigh.i);

    if (interveningLow && lastHigh.price > prevHigh.price) {
      // Check if price subsequently displaced BELOW interveningLow
      const recentBreak = bars.slice(lastHigh.i).some((b) => b.close < interveningLow.price);
      if (recentBreak) {
        // Find last up-close candle before interveningLow
        for (let i = interveningLow.i; i >= Math.max(0, interveningLow.i - 5); i--) {
          if (bars[i].close > bars[i].open) {
            breakerCandle = bars[i];
            break;
          }
        }
      }
    }
  }

  if (!breakerCandle) return null;

  const entry = (breakerCandle.high + breakerCandle.low) / 2; // Midline of Breaker Block
  const sl = dir === 1 ? breakerCandle.low - avg * 0.35 : breakerCandle.high + avg * 0.35;
  const tp = resolveTargetTP({ entry, dir, avg, ranges, targetDOL });

  const actualRisk = Math.abs(entry - sl);
  const actualReward = dir === 1 ? (tp - entry) : (entry - tp);
  const rr = actualRisk > 0 && actualReward > 0 ? Math.round((actualReward / actualRisk) * 100) / 100 : 0;

  let confluenceScore = 68;
  const confluenceTags = ["BREAKER_BLOCK", "FAILED_OB_MITIGATION"];

  const timeBoost = activeTimeSlot?.modelAffinities?.breaker_block || 0;
  confluenceScore += timeBoost;

  return {
    id: "breaker_block",
    name: "Breaker Block & Mitigation Retest",
    badge: "Breaker Block",
    type: "BREAKER_BLOCK",
    entry,
    sl,
    tp,
    rr,
    price: entry,
    zoneHigh: breakerCandle.high,
    zoneLow: breakerCandle.low,
    confluenceScore: Math.min(100, Math.max(10, confluenceScore)),
    confluenceTags,
    meetsMinRR: rr >= minRR,
    label: `Breaker Midline (${entry.toFixed(4)})`,
    rationale: `Violent displacement broke opposing structure, flipping prior Order Block into Breaker Block retest @ ${entry.toFixed(4)}.`,
  };
}

// ----------------------------------------------------------------------------
// Model 4: OTE Trend Continuation Detector
// ----------------------------------------------------------------------------
function detectOteContinuationModel({
  bars,
  dir,
  avg,
  currentPrice,
  ranges,
  targetDOL,
  minRR,
  brain,
  activeTimeSlot,
}) {
  const { highs, lows } = findPivots(bars, 3, 3);
  if (!highs.length || !lows.length) return null;

  let swingHigh = null;
  let swingLow = null;

  if (dir === 1) {
    const lastH = highs[highs.length - 1];
    const precedingLows = lows.filter((l) => l.i < lastH.i);
    const anchorLow = precedingLows.length ? precedingLows[precedingLows.length - 1] : lows[lows.length - 1];
    swingHigh = lastH.price;
    swingLow = anchorLow.price;
  } else {
    const lastL = lows[lows.length - 1];
    const precedingHighs = highs.filter((h) => h.i < lastL.i);
    const anchorHigh = precedingHighs.length ? precedingHighs[precedingHighs.length - 1] : highs[highs.length - 1];
    swingHigh = anchorHigh.price;
    swingLow = lastL.price;
  }

  const span = swingHigh - swingLow;
  if (span <= 0) return null;

  // 62%, 70.5%, 79% Fibonacci levels
  const fib62 = dir === 1 ? swingHigh - span * 0.62 : swingLow + span * 0.62;
  const sweetspot = dir === 1 ? swingHigh - span * 0.705 : swingLow + span * 0.705;
  const fib79 = dir === 1 ? swingHigh - span * 0.79 : swingLow + span * 0.79;

  const entry = sweetspot;
  const sl = dir === 1 ? swingLow - avg * 0.35 : swingHigh + avg * 0.35;
  const tp = resolveTargetTP({ entry, dir, avg, ranges, targetDOL });

  const actualRisk = Math.abs(entry - sl);
  const actualReward = dir === 1 ? (tp - entry) : (entry - tp);
  const rr = actualRisk > 0 && actualReward > 0 ? Math.round((actualReward / actualRisk) * 100) / 100 : 0;

  let confluenceScore = 65;
  const confluenceTags = ["OTE_SWEETSPOT", "TREND_CONTINUATION"];

  // Order flow alignment bonus
  if (brain?.fvgOrderFlow === "BULLISH_DOMINANT" || brain?.fvgOrderFlow === "BEARISH_DOMINANT") {
    confluenceScore += 20;
    confluenceTags.push("HTF_ORDER_FLOW_ALIGNED");
  }

  const timeBoost = activeTimeSlot?.modelAffinities?.ote_continuation || 0;
  confluenceScore += timeBoost;

  return {
    id: "ote_continuation",
    name: "OTE Trend Expansion (Optimal Trade Entry)",
    badge: "OTE Sweetspot",
    type: "OTE_SWEETSPOT",
    entry,
    sl,
    tp,
    rr,
    price: entry,
    zoneHigh: Math.max(fib62, fib79),
    zoneLow: Math.min(fib62, fib79),
    confluenceScore: Math.min(100, Math.max(10, confluenceScore)),
    confluenceTags,
    meetsMinRR: rr >= minRR,
    label: `OTE 70.5% Sweetspot (${entry.toFixed(4)})`,
    rationale: `Institutional impulse retracement into 62% - 79% Fibonacci discount/premium golden pocket with structural SL behind swing anchor.`,
  };
}

// ----------------------------------------------------------------------------
// Model 5: ICT Silver Bullet Window Detector
// ----------------------------------------------------------------------------
function detectSilverBulletModel({
  bars,
  dir,
  avg,
  currentPrice,
  ranges,
  targetDOL,
  minRR,
  activeTimeSlot,
}) {
  const n = bars.length;
  if (n < 8) return null;

  // Silver bullet relies on fresh 1M-15M FVG created during/near the active window
  const fvgs = [];
  for (let i = n - 6; i < n; i++) {
    if (i < 2) continue;
    const b0 = bars[i - 2];
    const b2 = bars[i];
    if (dir === 1 && b2.low > b0.high) {
      fvgs.push({ top: b2.low, bottom: b0.high, ce: (b2.low + b0.high) / 2, age: n - 1 - i });
    } else if (dir === -1 && b2.high < b0.low) {
      fvgs.push({ top: b0.low, bottom: b2.high, ce: (b0.low + b2.high) / 2, age: n - 1 - i });
    }
  }

  if (!fvgs.length) return null;
  const sbFvg = fvgs[fvgs.length - 1];

  const entry = sbFvg.ce;
  const sl = dir === 1 ? sbFvg.bottom - avg * 0.35 : sbFvg.top + avg * 0.35;
  const tp = resolveTargetTP({ entry, dir, avg, ranges, targetDOL });

  const actualRisk = Math.abs(entry - sl);
  const actualReward = dir === 1 ? (tp - entry) : (entry - tp);
  const rr = actualRisk > 0 && actualReward > 0 ? Math.round((actualReward / actualRisk) * 100) / 100 : 0;

  let confluenceScore = 55;
  const confluenceTags = ["SILVER_BULLET", "ALGORITHMIC_60MIN_DELIVERY"];

  if (activeTimeSlot?.isSilverBullet) {
    confluenceScore += 40; // Massive boost during the official 60-min window!
    confluenceTags.push("ACTIVE_SILVER_BULLET_HOUR");
  } else if (activeTimeSlot?.phase === "KILLZONE") {
    confluenceScore += 15;
  }

  const timeBoost = activeTimeSlot?.modelAffinities?.silver_bullet || 0;
  confluenceScore += timeBoost;

  return {
    id: "silver_bullet",
    name: "ICT Silver Bullet Window",
    badge: "Silver Bullet",
    type: "SILVER_BULLET_FVG",
    entry,
    sl,
    tp,
    rr,
    price: entry,
    zoneHigh: sbFvg.top,
    zoneLow: sbFvg.bottom,
    confluenceScore: Math.min(100, Math.max(10, confluenceScore)),
    confluenceTags,
    meetsMinRR: rr >= minRR,
    label: `Silver Bullet FVG (${entry.toFixed(4)})`,
    rationale: `Algorithmic 60-min delivery window FVG created targeting session draw on liquidity. Quick fill anticipated.`,
  };
}

// ----------------------------------------------------------------------------
// Internal Helper: Target DOL Resolution
// ----------------------------------------------------------------------------
function resolveTargetTP({ entry, dir, avg, ranges, targetDOL }) {
  const isTargetDolValid = targetDOL?.price && (
    dir === 1 ? targetDOL.price > entry + avg * 0.5 : targetDOL.price < entry - avg * 0.5
  );

  if (isTargetDolValid) {
    return targetDOL.price;
  }

  const h4R = ranges?.ranges?.H4;
  const d1R = ranges?.ranges?.D1;
  if (dir === 1) {
    return (h4R && h4R.high > entry + avg * 1.5)
      ? h4R.high
      : ((d1R && d1R.high > entry + avg * 1.5) ? d1R.high : entry + avg * 3.5);
  } else {
    return (h4R && h4R.low < entry - avg * 1.5)
      ? h4R.low
      : ((d1R && d1R.low < entry - avg * 1.5) ? d1R.low : entry - avg * 3.5);
  }
}
