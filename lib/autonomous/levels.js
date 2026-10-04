// Dynamic Institutional Level Detector & Confluence Scoring Engine
// Evaluates FVG Consequent Encroachment (50%), Order Blocks, Optimal Trade Entry (OTE 62-79%),
// and Reclaimed Liquidity Levels. Does NOT rely on naive static rules.

import { avgRange, findPivots } from "../patterns/core.js";
import { evaluateAllEntryModels } from "./models.js";

/**
 * Discovers and ranks institutional reaction levels for a qualified setup.
 * Dynamically resolves between the 5 Core Institutional Entry Models:
 *   1. ICT 2022 Mentorship Model
 *   2. Turtle Soup Liquidity Raid
 *   3. Breaker Block & Mitigation Retest
 *   4. OTE Trend Continuation
 *   5. ICT Silver Bullet Window
 * @param {Object} params
 * @param {string} params.symbol
 * @param {number} params.dir - 1 (Buy) or -1 (Sell)
 * @param {Object} params.scenario - active scenario (Intraday or Swing)
 * @param {Object} params.frames - multi-timeframe candle bars { D1, H4, H1, M15 }
 * @param {Object} params.ranges - dealing ranges
 * @param {Object} params.htfFvg - 4H FVG lifecycle output
 * @param {Object} params.targetDOL - dynamic Draw on Liquidity target
 * @param {Object} params.config - user configuration
 * @param {Object} params.brain - market brain state
 */
export function selectOptimalEntryLevel({
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
  // 1. Try resolving via the 5 Dynamic Institutional Entry Models
  const modelResult = evaluateAllEntryModels({
    symbol,
    dir,
    scenario,
    frames,
    ranges,
    htfFvg,
    targetDOL,
    config,
    brain,
  });

  if (modelResult) {
    const avg = avgRange(scenario?.id === "swing" ? (frames.H4 || frames.H1) : (frames.H1 || frames.M15));
    const risk = Math.abs(modelResult.entry - modelResult.sl);
    return {
      ...modelResult,
      riskPips: Math.round(risk / (avg * 0.0001 || 0.0001)),
      targetDOL,
    };
  }

  const setupBars = scenario?.id === "swing" ? (frames.H4 || frames.H1) : (frames.H1 || frames.M15);
  const triggerBars = scenario?.id === "swing" ? (frames.H1 || frames.M15) : (frames.M15 || frames.H1);
  if (!setupBars || setupBars.length < 20) return null;

  const currentPrice = setupBars[setupBars.length - 1].close;
  const avg = avgRange(setupBars);
  const minRR = config.minRR || scenario.minRR || 2.0;

  const candidateLevels = [];

  // --------------------------------------------------------------------------
  // 1. FVG Consequent Encroachment (CE - 50% Midpoint)
  // --------------------------------------------------------------------------
  // Check 4H FVGs from lifecycle engine first
  if (htfFvg?.respected?.length) {
    for (const g of htfFvg.respected) {
      if (g.dir === dir && g.ce) {
        candidateLevels.push({
          type: "FVG_CE",
          tf: "H4",
          price: g.ce,
          zoneHigh: Math.max(g.top, g.bottom),
          zoneLow: Math.min(g.top, g.bottom),
          quality: g.quality || "A_RESPECTED",
          age: g.ageBars || 0,
          label: `4H FVG CE (${g.ce.toFixed(4)})`,
        });
      }
    }
  }

  // Also scan setup timeframe bars for fresh, unmitigated FVGs
  const localFvgs = findLocalFVGs(setupBars, dir);
  for (const fvg of localFvgs.slice(-3)) {
    candidateLevels.push({
      type: "FVG_CE",
      tf: scenario.sessionTf,
      price: fvg.ce,
      zoneHigh: fvg.top,
      zoneLow: fvg.bottom,
      quality: "A_FRESH",
      age: fvg.age,
      label: `${scenario.sessionTf} FVG CE (${fvg.ce.toFixed(4)})`,
    });
  }

  // --------------------------------------------------------------------------
  // 2. Institutional Order Block (OB)
  // --------------------------------------------------------------------------
  const obs = findOrderBlocks(setupBars, dir, avg);
  for (const ob of obs.slice(-2)) {
    candidateLevels.push({
      type: "ORDER_BLOCK",
      tf: scenario.sessionTf,
      price: ob.meanThreshold, // 50% midpoint of the OB
      zoneHigh: ob.top,
      zoneLow: ob.bottom,
      quality: "HIGH_DISPLACEMENT",
      age: ob.age,
      label: `${scenario.sessionTf} OB MT (${ob.meanThreshold.toFixed(4)})`,
    });
  }

  // --------------------------------------------------------------------------
  // 3. Optimal Trade Entry (OTE: 62% - 79% Fibonacci of recent impulse)
  // --------------------------------------------------------------------------
  const ote = calculateOTE(setupBars, dir);
  if (ote) {
    candidateLevels.push({
      type: "OTE_SWEETSPOT",
      tf: scenario.sessionTf,
      price: ote.sweetspot, // 70.5% Fibonacci
      zoneHigh: dir === 1 ? ote.fib62 : ote.fib79,
      zoneLow: dir === 1 ? ote.fib79 : ote.fib62,
      quality: "GOLDEN_POCKET",
      age: 0,
      label: `OTE 70.5% (${ote.sweetspot.toFixed(4)})`,
      fib62: ote.fib62,
      fib79: ote.fib79,
    });
  }

  if (!candidateLevels.length) {
    // Fallback: If no clean FVG/OB, use active dealing range discount/premium sweetspot
    const activeRange = ranges?.ranges?.[scenario.sessionTf] || ranges?.ranges?.H4;
    if (activeRange) {
      const sweetspot = dir === 1
        ? activeRange.low + (activeRange.high - activeRange.low) * 0.35 // 35% Discount
        : activeRange.high - (activeRange.high - activeRange.low) * 0.35; // 65% Premium
      candidateLevels.push({
        type: "RANGE_AUCTION_POCKET",
        tf: scenario.sessionTf,
        price: sweetspot,
        zoneHigh: sweetspot + avg * 0.3,
        zoneLow: sweetspot - avg * 0.3,
        quality: "AUCTION_DISCOUNT",
        age: 0,
        label: `${activeRange.tf} Range Auction Pocket`,
      });
    }
  }

  if (!candidateLevels.length) return null;

  // --------------------------------------------------------------------------
  // 4. Confluence Scoring Algorithm
  // --------------------------------------------------------------------------
  const scoredLevels = candidateLevels.map((lvl) => {
    let score = 50;
    const tags = [lvl.type];

    // Proximity to OTE sweetspot
    if (ote) {
      const distToOte = Math.abs(lvl.price - ote.sweetspot);
      if (distToOte <= avg * 0.6) {
        score += 30;
        tags.push("OTE_CONFLUENCE");
      }
    }

    // Overlap with FVG
    if (lvl.type === "ORDER_BLOCK") {
      const overlapsFvg = candidateLevels.some(
        (c) => c.type === "FVG_CE" && Math.abs(c.price - lvl.price) <= avg * 0.5
      );
      if (overlapsFvg) {
        score += 25;
        tags.push("OB_FVG_STACKED");
      }
    }

    // Dealing range zone alignment
    const rangeObj = ranges?.ranges?.[scenario.sessionTf] || ranges?.ranges?.H4;
    if (rangeObj) {
      const rangeSpan = rangeObj.high - rangeObj.low;
      if (rangeSpan > 0) {
        const lvlPct = ((lvl.price - rangeObj.low) / rangeSpan) * 100;
        if (dir === 1 && lvlPct <= 35) {
          score += 20;
          tags.push("DEEP_DISCOUNT");
        } else if (dir === 1 && lvlPct <= 50) {
          score += 10;
          tags.push("DISCOUNT");
        } else if (dir === -1 && lvlPct >= 65) {
          score += 20;
          tags.push("DEEP_PREMIUM");
        } else if (dir === -1 && lvlPct >= 50) {
          score += 10;
          tags.push("PREMIUM");
        }
      }
    }

    // Untested / Freshness bonus
    if (lvl.age <= 8) {
      score += 10;
      tags.push("FRESH");
    }

    // Retracement orientation:
    // For BUY: level at or below current price (discount pullback entry) is preferred over chasing higher
    if (dir === 1) {
      if (lvl.price <= currentPrice + avg * 0.15) {
        score += 15;
        tags.push("DISCOUNT_PULLBACK");
      } else if (lvl.price > currentPrice + avg * 0.5) {
        score -= 20; // chasing higher
      }
    } else if (dir === -1) {
      if (lvl.price >= currentPrice - avg * 0.15) {
        score += 15;
        tags.push("PREMIUM_PULLBACK");
      } else if (lvl.price < currentPrice - avg * 0.5) {
        score -= 20; // chasing lower
      }
    }

    // Distance sanity: level must be reachable (not 500 pips away)
    const distToPrice = Math.abs(currentPrice - lvl.price);
    if (distToPrice > avg * 4) {
      score -= 25;
    }

    return {
      ...lvl,
      confluenceScore: Math.min(100, Math.max(10, score)),
      confluenceTags: tags,
    };
  });

  // Sort by highest confluence score
  scoredLevels.sort((a, b) => b.confluenceScore - a.confluenceScore);
  const primary = scoredLevels[0];

  // --------------------------------------------------------------------------
  // 5. Calculate Invalidation (SL) and Target (TP)
  // --------------------------------------------------------------------------
  let sl = 0;
  if (dir === 1) {
    // Buy SL: placed below the level zone floor minus buffer (0.45 * avg)
    const floor = Math.min(primary.zoneLow, primary.price);
    sl = floor - avg * 0.45;
  } else {
    // Sell SL: placed above the level zone ceiling plus buffer (0.45 * avg)
    const ceiling = Math.max(primary.zoneHigh, primary.price);
    sl = ceiling + avg * 0.45;
  }

  // Ensure minimum structural risk buffer (at least 0.4 * avg)
  const risk = Math.abs(primary.price - sl);
  if (risk < avg * 0.35) {
    sl = dir === 1 ? primary.price - avg * 0.45 : primary.price + avg * 0.45;
  }

  // Target DOL resolution: must be strictly on the WINNING side of entry!
  let tp = 0;
  const isTargetDolValid = targetDOL?.price && (
    dir === 1 ? targetDOL.price > primary.price + avg * 0.5 : targetDOL.price < primary.price - avg * 0.5
  );

  if (isTargetDolValid) {
    tp = targetDOL.price;
  } else {
    // Fallback TP: opposing dealing range extremity or minimum 3.5x ATR expansion
    const h4R = ranges?.ranges?.H4;
    const d1R = ranges?.ranges?.D1;
    if (dir === 1) {
      tp = (h4R && h4R.high > primary.price + avg * 1.5)
        ? h4R.high
        : ((d1R && d1R.high > primary.price + avg * 1.5) ? d1R.high : primary.price + avg * 3.5);
    } else {
      tp = (h4R && h4R.low < primary.price - avg * 1.5)
        ? h4R.low
        : ((d1R && d1R.low < primary.price - avg * 1.5) ? d1R.low : primary.price - avg * 3.5);
    }
  }

  // Calculate true directional reward (must be strictly positive in direction of trade)
  const actualRisk = Math.abs(primary.price - sl);
  const actualReward = dir === 1 ? (tp - primary.price) : (primary.price - tp);

  if (actualReward <= 0 || actualRisk <= 0) {
    return {
      ...primary,
      allCandidates: scoredLevels,
      entry: primary.price,
      sl,
      tp,
      rr: 0,
      targetDOL,
      meetsMinRR: false,
      rejectionReason: "Target is on the losing side of entry or invalid.",
    };
  }

  const rr = Math.round((actualReward / actualRisk) * 100) / 100;

  // Verify Risk:Reward clearance
  if (rr < minRR) {
    return {
      ...primary,
      allCandidates: scoredLevels,
      entry: primary.price,
      sl,
      tp,
      rr,
      targetDOL,
      meetsMinRR: false,
      rejectionReason: `Calculated R:R of ${rr}R is below minimum threshold of ${minRR}R.`,
    };
  }

  return {
    ...primary,
    allCandidates: scoredLevels,
    entry: primary.price,
    sl,
    tp,
    rr,
    riskPips: Math.round(risk / (avg * 0.0001 || 0.0001)),
    targetDOL,
    meetsMinRR: true,
  };
}

// ----------------------------------------------------------------------------
// Internal Pattern Helpers
// ----------------------------------------------------------------------------

function findLocalFVGs(bars, dir) {
  const fvgs = [];
  if (bars.length < 4) return fvgs;
  for (let i = 2; i < bars.length; i++) {
    const b0 = bars[i - 2];
    const b1 = bars[i - 1];
    const b2 = bars[i];
    if (dir === 1) {
      // Bullish FVG: b2.low > b0.high
      if (b2.low > b0.high) {
        const top = b2.low;
        const bottom = b0.high;
        const ce = (top + bottom) / 2;
        fvgs.push({ top, bottom, ce, age: bars.length - 1 - i });
      }
    } else {
      // Bearish FVG: b2.high < b0.low
      if (b2.high < b0.low) {
        const top = b0.low;
        const bottom = b2.high;
        const ce = (top + bottom) / 2;
        fvgs.push({ top, bottom, ce, age: bars.length - 1 - i });
      }
    }
  }
  return fvgs;
}

function findOrderBlocks(bars, dir, avg) {
  const obs = [];
  if (bars.length < 5) return obs;
  for (let i = bars.length - 12; i < bars.length - 2; i++) {
    if (i < 1) continue;
    const b = bars[i];
    const next1 = bars[i + 1];
    const next2 = bars[i + 2];
    if (dir === 1) {
      // Bullish OB: down-close candle before strong bullish expansion
      const isBearCandle = b.close < b.open;
      const isImpulse = (next1.close - next1.open) > avg * 1.2 || (next2.close - next2.open) > avg * 1.2;
      if (isBearCandle && isImpulse) {
        obs.push({
          top: b.high,
          bottom: b.low,
          open: b.open,
          meanThreshold: (b.high + b.low) / 2,
          age: bars.length - 1 - i,
        });
      }
    } else {
      // Bearish OB: up-close candle before strong bearish expansion
      const isBullCandle = b.close > b.open;
      const isImpulse = (next1.open - next1.close) > avg * 1.2 || (next2.open - next2.close) > avg * 1.2;
      if (isBullCandle && isImpulse) {
        obs.push({
          top: b.high,
          bottom: b.low,
          open: b.open,
          meanThreshold: (b.high + b.low) / 2,
          age: bars.length - 1 - i,
        });
      }
    }
  }
  return obs;
}

function calculateOTE(bars, dir) {
  const { highs, lows } = findPivots(bars, 3, 3);
  if (!highs.length || !lows.length) return null;

  let swingHigh = null;
  let swingLow = null;

  if (dir === 1) {
    // Bullish OTE: impulse expanded from a prior swing low up to a recent swing high
    const lastH = highs[highs.length - 1];
    const precedingLows = lows.filter((l) => l.i < lastH.i);
    const anchorLow = precedingLows.length ? precedingLows[precedingLows.length - 1] : lows[lows.length - 1];
    swingHigh = lastH.price;
    swingLow = anchorLow.price;
  } else {
    // Bearish OTE: impulse expanded from a prior swing high down to a recent swing low
    const lastL = lows[lows.length - 1];
    const precedingHighs = highs.filter((h) => h.i < lastL.i);
    const anchorHigh = precedingHighs.length ? precedingHighs[precedingHighs.length - 1] : highs[highs.length - 1];
    swingHigh = anchorHigh.price;
    swingLow = lastL.price;
  }

  const span = swingHigh - swingLow;
  if (span <= 0) return null;

  if (dir === 1) {
    // Bullish OTE: retracing into Discount
    const fib62 = swingHigh - span * 0.62;
    const sweetspot = swingHigh - span * 0.705;
    const fib79 = swingHigh - span * 0.79;
    return { fib62, sweetspot, fib79, swingHigh, swingLow };
  } else {
    // Bearish OTE: retracing into Premium
    const fib62 = swingLow + span * 0.62;
    const sweetspot = swingLow + span * 0.705;
    const fib79 = swingLow + span * 0.79;
    return { fib62, sweetspot, fib79, swingHigh, swingLow };
  }
}
