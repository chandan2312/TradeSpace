import { avgRange } from "../patterns/core.js";

// 4H Fair Value Gap (FVG) & Inverse FVG (iFVG) Order Flow Engine
// Tracks 4H institutional imbalances with institutional lifecycle intelligence:
//   1. Formation: 3-candle imbalance (BISI vs SIBI) with Consequent Encroachment (CE = 50%)
//   2. Respected: Price retests the gap, bodies defend the boundary/CE, and rejects outward
//   3. Unrespected: A 4H candle CLOSES decisively through the far side (inverts into iFVG)
//   4. Active Testing: Current price is currently inside an open/respected gap zone
//   5. Order Flow Synthesis: Recency-weighted ratio and sequence of respected vs violated gaps

/**
 * Analyzes all 4H FVGs and classifies their respect/disrespect states.
 * @param {Array} bars - 4H Candlestick bars
 * @param {number} [avg] - Average 4H candle range
 * @param {number} [lookback=80] - Number of bars to inspect for active order flow
 */
export function analyze4HFVGs(bars, avg = null, lookback = 80) {
  if (!bars || bars.length < 3) {
    return {
      all: [],
      respected: [],
      unrespected: [],
      unmitigated: [],
      active: null,
      activeGaps: [],
      ifvgs: [],
      unreclaimedIfvgs: [],
      respectedIfvgs: [],
      activeIfvgs: [],
      activeIfvg: null,
      orderFlowState: "NEUTRAL",
      bullishRespectedCount: 0,
      bullishUnrespectedCount: 0,
      bearishRespectedCount: 0,
      bearishUnrespectedCount: 0,
      bullishIfvgRespectedCount: 0,
      bearishIfvgRespectedCount: 0,
      netRespectScore: 0,
      nearestSupportFVG: null,
      nearestResistanceFVG: null,
      nearestIfvgSupport: null,
      nearestIfvgResistance: null,
      currentPrice: bars && bars.length ? bars[bars.length - 1].close : null,
    };
  }

  const n = bars.length;
  const a = avg || avgRange(bars);
  const minGap = Math.max(0.28 * (Number.isFinite(a) && a > 0 ? a : 1), 0.0001); // filters out microscopic spread noise
  const start = Math.max(2, n - lookback);
  const currentPrice = bars[n - 1].close;

  // 1. Identify raw 3-candle imbalances
  const rawGaps = [];
  for (let i = start; i < n; i++) {
    const prev = bars[i - 2];
    const impCandle = bars[i - 1]; // the displacement candle
    const curr = bars[i];

    // Bullish FVG (BISI): gap between candle 1 high and candle 3 low
    if (curr.low - prev.high >= minGap) {
      // Quality check: displacement candle must expand in the direction of the gap
      if (impCandle.close > impCandle.open && impCandle.high >= curr.low) {
        const top = curr.low;
        const bottom = prev.high;
        rawGaps.push({
          id: `4H-BULL-${bars[i].time || i}`,
          dir: 1,
          type: "BULLISH_FVG",
          top,
          bottom,
          ce: (top + bottom) / 2, // Consequent Encroachment (50%)
          size: top - bottom,
          born: i,
          bornTime: bars[i].time || i,
          confirmedAt: bars[i].time || i,
        });
      }
    }
    // Bearish FVG (SIBI): gap between candle 3 high and candle 1 low
    else if (prev.low - curr.high >= minGap) {
      // Quality check: displacement candle must expand downward
      if (impCandle.close < impCandle.open && impCandle.low <= curr.high) {
        const top = prev.low;
        const bottom = curr.high;
        rawGaps.push({
          id: `4H-BEAR-${bars[i].time || i}`,
          dir: -1,
          type: "BEARISH_FVG",
          top,
          bottom,
          ce: (top + bottom) / 2,
          size: top - bottom,
          born: i,
          bornTime: bars[i].time || i,
          confirmedAt: bars[i].time || i,
        });
      }
    }
  }

  const all = [];
  const respected = [];
  const unrespected = [];
  const unmitigated = [];
  const activeGaps = [];
  const ifvgs = [];
  let active = null;

  for (const gap of rawGaps) {
    const bull = gap.dir === 1;
    let state = "UNMITIGATED";
    let tested = false;
    let respectedAt = null;
    let respectKnownAt = null;
    let violatedAt = null;
    let deepestPenetration = null;
    let bodiesStayedAboveCE = true;
    let bodiesStayedBelowCE = true;
    let fillPct = 0;

    // iFVG Lifecycle tracking (once gap is violated/unrespected)
    let ifvgState = null; // "VIRGIN_INVERTED", "TAPPED_INVERTED", "RESPECTED_INVERTED", "RECLAIMED"
    let ifvgTested = false;
    let ifvgTestedAt = null;
    let ifvgRespectedAt = null;
    let ifvgRespectKnownAt = null;
    let ifvgReclaimed = false;
    let ifvgReclaimedAt = null;
    let ifvgDeepestPenetration = null;
    let ifvgBodiesStayedAboveCE = true;
    let ifvgBodiesStayedBelowCE = true;

    // Evaluate lifecycle across subsequent bars ONLY (j > gap.born)
    for (let j = gap.born + 1; j < n; j++) {
      const b = bars[j];

      if (state !== "UNRESPECTED") {
        if (bull) {
          // Bullish gap: retest occurs when bar trades down into gap (low <= top)
          if (b.low <= gap.top) {
            tested = true;
            if (deepestPenetration === null || b.low < deepestPenetration) {
              deepestPenetration = b.low;
            }
            if (b.close < gap.ce) {
              bodiesStayedAboveCE = false;
            }
            const penDepth = Math.max(0, gap.top - b.low);
            fillPct = Math.min(1.0, Math.max(fillPct, gap.size > 0 ? penDepth / gap.size : 0));

            // Unrespected (violated): A 4H candle body closes DECISIVELY below the bottom of the gap
            if (b.close < gap.bottom) {
              state = "UNRESPECTED";
              violatedAt = j;
              ifvgState = "VIRGIN_INVERTED";
              continue; // Inverted! Continue tracking subsequent bars for iFVG lifecycle
            }

            // Respected: Body defended the gap (close >= bottom), AND subsequent price expanded away
            if (b.close >= gap.bottom && state !== "RESPECTED") {
              let bounced = false;
              let bounceBarIdx = null;
              const lookaheadLimit = Math.min(j + 4, n);
              for (let k = j + 1; k < lookaheadLimit; k++) {
                const nb = bars[k];
                if (nb.close > gap.top || (nb.close >= gap.top && nb.high >= gap.top + 0.3 * a)) {
                  bounced = true;
                  bounceBarIdx = k;
                  break;
                }
              }
              // Check 2: Strong single-bar rejection wick (hammer closing back above the top)
              if (!bounced && b.close >= gap.top && (b.close - b.low) >= (b.high - b.low) * 0.5) {
                bounced = true;
                bounceBarIdx = j;
              }

              if (bounced) {
                state = "RESPECTED";
                respectedAt = j;
                respectKnownAt = bounceBarIdx;
              } else {
                state = "TAPPED";
              }
            }
          }
        } else {
          // Bearish gap: retest occurs when bar trades up into gap (high >= bottom)
          if (b.high >= gap.bottom) {
            tested = true;
            if (deepestPenetration === null || b.high > deepestPenetration) {
              deepestPenetration = b.high;
            }
            if (b.close > gap.ce) {
              bodiesStayedBelowCE = false;
            }
            const penDepth = Math.max(0, b.high - gap.bottom);
            fillPct = Math.min(1.0, Math.max(fillPct, gap.size > 0 ? penDepth / gap.size : 0));

            // Unrespected (violated): A 4H candle body closes DECISIVELY above the top of the gap
            if (b.close > gap.top) {
              state = "UNRESPECTED";
              violatedAt = j;
              ifvgState = "VIRGIN_INVERTED";
              continue; // Inverted! Continue tracking subsequent bars for iFVG lifecycle
            }

            // Respected: Body defended the gap (close <= top), AND subsequent price expanded away
            if (b.close <= gap.top && state !== "RESPECTED") {
              let dropped = false;
              let dropBarIdx = null;
              const lookaheadLimit = Math.min(j + 4, n);
              for (let k = j + 1; k < lookaheadLimit; k++) {
                const nb = bars[k];
                if (nb.close < gap.bottom || (nb.close <= gap.bottom && nb.low <= gap.bottom - 0.3 * a)) {
                  dropped = true;
                  dropBarIdx = k;
                  break;
                }
              }
              // Check 2: Strong single-bar rejection wick (shooting star closing back below bottom)
              if (!dropped && b.close <= gap.bottom && (b.high - b.close) >= (b.high - b.low) * 0.5) {
                dropped = true;
                dropBarIdx = j;
              }

              if (dropped) {
                state = "RESPECTED";
                respectedAt = j;
                respectKnownAt = dropBarIdx;
              } else {
                state = "TAPPED";
              }
            }
          }
        }
      } else {
        // Gap is UNRESPECTED -> Active iFVG Lifecycle tracking!
        if (ifvgReclaimed) {
          break; // Inversion destroyed
        }

        if (bull) {
          // Violated Bullish FVG -> Operates as INVERTED RESISTANCE (dir: -1)
          // Invalidation (Reclaimed by bulls): Price closes decisively back above the top
          if (b.close > gap.top) {
            ifvgReclaimed = true;
            ifvgReclaimedAt = j;
            ifvgState = "RECLAIMED";
            break;
          }

          // Retest of Inverted Resistance: price rallies back up into [gap.bottom, gap.top]
          if (b.high >= gap.bottom) {
            ifvgTested = true;
            if (ifvgTestedAt === null) ifvgTestedAt = j;
            if (ifvgDeepestPenetration === null || b.high > ifvgDeepestPenetration) {
              ifvgDeepestPenetration = b.high;
            }
            if (b.close > gap.ce) {
              ifvgBodiesStayedBelowCE = false;
            }

            // Respect of Inverted Resistance: bodies defended ceiling (close <= gap.top),
            // AND subsequent price expanded downward away from gap.bottom
            if (b.close <= gap.top && ifvgState !== "RESPECTED_INVERTED") {
              let dropped = false;
              let dropBarIdx = null;
              const lookaheadLimit = Math.min(j + 4, n);
              for (let k = j + 1; k < lookaheadLimit; k++) {
                const nb = bars[k];
                if (nb.close < gap.bottom || (nb.close <= gap.bottom && nb.low <= gap.bottom - 0.3 * a)) {
                  dropped = true;
                  dropBarIdx = k;
                  break;
                }
              }
              // Single-bar shooting star rejection wick
              if (!dropped && b.close <= gap.bottom && (b.high - b.close) >= (b.high - b.low) * 0.5) {
                dropped = true;
                dropBarIdx = j;
              }

              if (dropped) {
                ifvgState = "RESPECTED_INVERTED";
                ifvgRespectedAt = j;
                ifvgRespectKnownAt = dropBarIdx;
              } else {
                ifvgState = "TAPPED_INVERTED";
              }
            }
          }
        } else {
          // Violated Bearish FVG -> Operates as INVERTED SUPPORT (dir: 1)
          // Invalidation (Reclaimed by bears): Price closes decisively back below the bottom
          if (b.close < gap.bottom) {
            ifvgReclaimed = true;
            ifvgReclaimedAt = j;
            ifvgState = "RECLAIMED";
            break;
          }

          // Retest of Inverted Support: price drops back down into [gap.bottom, gap.top]
          if (b.low <= gap.top) {
            ifvgTested = true;
            if (ifvgTestedAt === null) ifvgTestedAt = j;
            if (ifvgDeepestPenetration === null || b.low < ifvgDeepestPenetration) {
              ifvgDeepestPenetration = b.low;
            }
            if (b.close < gap.ce) {
              ifvgBodiesStayedAboveCE = false;
            }

            // Respect of Inverted Support: bodies defended floor (close >= gap.bottom),
            // AND subsequent price expanded upward away from gap.top
            if (b.close >= gap.bottom && ifvgState !== "RESPECTED_INVERTED") {
              let bounced = false;
              let bounceBarIdx = null;
              const lookaheadLimit = Math.min(j + 4, n);
              for (let k = j + 1; k < lookaheadLimit; k++) {
                const nb = bars[k];
                if (nb.close > gap.top || (nb.close >= gap.top && nb.high >= gap.top + 0.3 * a)) {
                  bounced = true;
                  bounceBarIdx = k;
                  break;
                }
              }
              // Single-bar hammer rejection wick
              if (!bounced && b.close >= gap.top && (b.close - b.low) >= (b.high - b.low) * 0.5) {
                bounced = true;
                bounceBarIdx = j;
              }

              if (bounced) {
                ifvgState = "RESPECTED_INVERTED";
                ifvgRespectedAt = j;
                ifvgRespectKnownAt = bounceBarIdx;
              } else {
                ifvgState = "TAPPED_INVERTED";
              }
            }
          }
        }
      }
    }

    // Check if the latest candle is currently inside this gap.
    // CRITICAL: A gap born on the latest candle (gap.born === n - 1) CANNOT be testing itself!
    const lastBar = bars[n - 1];
    const isCurrentlyInside = gap.born < n - 1 && (
      bull
        ? lastBar.low <= gap.top && lastBar.close >= gap.bottom
        : lastBar.high >= gap.bottom && lastBar.close <= gap.top
    );

    const isInverted = state === "UNRESPECTED";
    const ageBars = n - 1 - gap.born;

    // Quality label is only valid for respected natural gaps
    let respectQuality = null;
    if (state === "RESPECTED") {
      respectQuality = bull
        ? bodiesStayedAboveCE ? "A_PRIME_CE_DEFENDED" : "B_BOTTOM_DEFENDED"
        : bodiesStayedBelowCE ? "A_PRIME_CE_DEFENDED" : "B_TOP_DEFENDED";
    }

    const classifiedGap = {
      ...gap,
      state,
      tested,
      ageBars,
      isCurrentlyInside,
      isInverted,
      fillPct: Math.round(fillPct * 100) / 100,
      respectedAt: respectedAt !== null ? n - 1 - respectedAt : null,
      respectKnownAt: respectKnownAt !== null ? n - 1 - respectKnownAt : null,
      violatedAt: violatedAt !== null ? n - 1 - violatedAt : null,
      deepestPenetration,
      respectQuality,
    };

    all.push(classifiedGap);

    if (state === "RESPECTED") {
      respected.push(classifiedGap);
    } else if (state === "UNRESPECTED") {
      unrespected.push(classifiedGap);

      // Inverted FVG (iFVG) classification
      const invertedDir = -gap.dir;
      const role = bull ? "INVERTED_RESISTANCE" : "INVERTED_SUPPORT";
      const isCurrentlyInsideIfvg = !ifvgReclaimed && gap.born < n - 1 && (
        invertedDir === 1
          ? lastBar.low <= gap.top && lastBar.close >= gap.bottom
          : lastBar.high >= gap.bottom && lastBar.close <= gap.top
      );

      let ifvgRespectQuality = null;
      if (ifvgState === "RESPECTED_INVERTED") {
        ifvgRespectQuality = invertedDir === 1
          ? (ifvgBodiesStayedAboveCE ? "A_PRIME_CE_DEFENDED" : "B_ZONE_DEFENDED")
          : (ifvgBodiesStayedBelowCE ? "A_PRIME_CE_DEFENDED" : "B_ZONE_DEFENDED");
      }

      const ifvgObj = {
        ...classifiedGap,
        id: `4H-iFVG-${bars[gap.born].time || gap.born}`,
        originalId: gap.id,
        originalDir: gap.dir,
        dir: invertedDir, // 1 for INVERTED_SUPPORT, -1 for INVERTED_RESISTANCE
        role,
        top: gap.top,
        bottom: gap.bottom,
        ce: gap.ce,
        size: gap.size,
        born: gap.born,
        bornTime: gap.bornTime,
        inversionBar: violatedAt,
        inversionTime: bars[violatedAt]?.time || violatedAt,
        inversionAgeBars: n - 1 - violatedAt,
        state: ifvgState || "VIRGIN_INVERTED",
        tested: ifvgTested,
        testedAt: ifvgTestedAt !== null ? n - 1 - ifvgTestedAt : null,
        respected: ifvgState === "RESPECTED_INVERTED",
        respectedAt: ifvgRespectedAt !== null ? n - 1 - ifvgRespectedAt : null,
        respectKnownAt: ifvgRespectKnownAt !== null ? n - 1 - ifvgRespectKnownAt : null,
        respectQuality: ifvgRespectQuality,
        reclaimed: ifvgReclaimed,
        reclaimedAt: ifvgReclaimedAt !== null ? n - 1 - ifvgReclaimedAt : null,
        isCurrentlyInside: isCurrentlyInsideIfvg,
        deepestPenetration: ifvgDeepestPenetration,
      };

      ifvgs.push(ifvgObj);
    } else if (state === "UNMITIGATED") {
      unmitigated.push(classifiedGap);
    }

    // Active testing: currently inside an open or respected natural gap (never on birth bar)
    if (isCurrentlyInside && state !== "UNRESPECTED") {
      activeGaps.push(classifiedGap);
      active = classifiedGap; // most recent active gap
    }
  }

  // Live and Respected iFVG subsets
  const unreclaimedIfvgs = ifvgs.filter((g) => !g.reclaimed);
  const respectedIfvgs = unreclaimedIfvgs.filter((g) => g.respected);
  const activeIfvgs = unreclaimedIfvgs.filter((g) => g.isCurrentlyInside);
  const activeIfvg = activeIfvgs[activeIfvgs.length - 1] || null;

  // Count metrics
  const bullishRespectedCount = respected.filter((g) => g.dir === 1).length;
  const bullishUnrespectedCount = unrespected.filter((g) => g.dir === 1).length;
  const bearishRespectedCount = respected.filter((g) => g.dir === -1).length;
  const bearishUnrespectedCount = unrespected.filter((g) => g.dir === -1).length;

  const bullishIfvgRespectedCount = respectedIfvgs.filter((g) => g.dir === 1).length;
  const bearishIfvgRespectedCount = respectedIfvgs.filter((g) => g.dir === -1).length;

  // Order Flow Synthesis:
  // Bullish dominance = Bullish FVGs respected + Bearish FVGs violated/inverted + Bullish iFVGs respected
  // Bearish dominance = Bearish FVGs respected + Bullish FVGs violated/inverted + Bearish iFVGs respected
  const bullPoints = bullishRespectedCount * 2 + bearishUnrespectedCount * 1.5 + bullishIfvgRespectedCount * 1.5;
  const bearPoints = bearishRespectedCount * 2 + bullishUnrespectedCount * 1.5 + bearishIfvgRespectedCount * 1.5;
  
  // Symmetric Rounding: Eliminates native JS Math.round bullish-bias asymmetry at 0.5 thresholds
  const rawDiff = bullPoints - bearPoints;
  const netRespectScore = Math.sign(rawDiff) * Math.round(Math.abs(rawDiff));

  let orderFlowState = "NEUTRAL";
  if (netRespectScore >= 3) {
    orderFlowState = "STRONG_BULLISH_ORDER_FLOW";
  } else if (netRespectScore <= -3) {
    orderFlowState = "STRONG_BEARISH_ORDER_FLOW";
  } else if (netRespectScore > 0) {
    orderFlowState = "LEANING_BULLISH";
  } else if (netRespectScore < 0) {
    orderFlowState = "LEANING_BEARISH";
  }

  // Find nearest supporting and resisting 4H FVGs relative to current price.
  // Combines unmitigated/respected natural gaps PLUS live unreclaimed iFVGs:
  const supportCandidates = [
    // 1. Natural Bullish FVGs below current price
    ...all.filter((g) => g.state !== "UNRESPECTED" && g.dir === 1 && g.top <= currentPrice),
    // 2. Live Inverted Support (iFVG) below current price
    ...unreclaimedIfvgs.filter((g) => g.role === "INVERTED_SUPPORT" && g.top <= currentPrice),
  ].sort((a, b) => b.top - a.top);
  const nearestSupportFVG = supportCandidates[0] || null;

  const resistanceCandidates = [
    // 1. Natural Bearish FVGs above current price
    ...all.filter((g) => g.state !== "UNRESPECTED" && g.dir === -1 && g.bottom >= currentPrice),
    // 2. Live Inverted Resistance (iFVG) above current price
    ...unreclaimedIfvgs.filter((g) => g.role === "INVERTED_RESISTANCE" && g.bottom >= currentPrice),
  ].sort((a, b) => a.bottom - b.bottom);
  const nearestResistanceFVG = resistanceCandidates[0] || null;

  // Specific iFVG nearest landmarks
  const nearestIfvgSupport = unreclaimedIfvgs
    .filter((g) => g.role === "INVERTED_SUPPORT" && g.top <= currentPrice)
    .sort((a, b) => b.top - a.top)[0] || null;
  const nearestIfvgResistance = unreclaimedIfvgs
    .filter((g) => g.role === "INVERTED_RESISTANCE" && g.bottom >= currentPrice)
    .sort((a, b) => a.bottom - b.bottom)[0] || null;

  return {
    all,
    respected,
    unrespected,
    unmitigated,
    active,
    activeGaps,
    ifvgs,
    unreclaimedIfvgs,
    respectedIfvgs,
    activeIfvgs,
    activeIfvg,
    orderFlowState,
    bullishRespectedCount,
    bullishUnrespectedCount,
    bearishRespectedCount,
    bearishUnrespectedCount,
    bullishIfvgRespectedCount,
    bearishIfvgRespectedCount,
    netRespectScore,
    nearestSupportFVG,
    nearestResistanceFVG,
    nearestIfvgSupport,
    nearestIfvgResistance,
    currentPrice,
  };
}
