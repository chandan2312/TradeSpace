import { avgRange } from "../patterns/core.js";

// 4H Fair Value Gap (FVG) Order Flow Engine
// Tracks 4H institutional imbalances with full lifecycle intelligence:
//   1. Formation: 3-candle imbalance (BISI vs SIBI) with Consequent Encroachment (CE = 50%)
//   2. Respected: Price retests the gap, bodies defend the boundary/CE, and rejects outward
//   3. Unrespected: A 4H candle CLOSES decisively through the far side (gap fails into iFVG)
//   4. Active Testing: Current price is currently inside the zone
//   5. Order Flow Synthesis: Ratio and sequence of respected vs violated gaps

/**
 * Analyzes all 4H FVGs and classifies their respect/disrespect states.
 * @param {Array} bars - 4H Candlestick bars
 * @param {number} [avg] - Average 4H candle range
 * @param {number} [lookback=80] - Number of bars to inspect
 */
export function analyze4HFVGs(bars, avg = null, lookback = 80) {
  if (!bars || bars.length < 3) {
    return {
      all: [],
      respected: [],
      unrespected: [],
      unmitigated: [],
      active: null,
      orderFlowState: "NEUTRAL",
      bullishRespectedCount: 0,
      bullishUnrespectedCount: 0,
      bearishRespectedCount: 0,
      bearishUnrespectedCount: 0,
      netRespectScore: 0,
      nearestSupportFVG: null,
      nearestResistanceFVG: null,
    };
  }

  const n = bars.length;
  const a = avg || avgRange(bars);
  const minGap = 0.28 * a; // filters out microscopic spread noise
  const start = Math.max(2, n - lookback);
  const currentPrice = bars[n - 1].close;

  // 1. Identify raw 3-candle imbalances
  const rawGaps = [];
  for (let i = start; i < n; i++) {
    const prev = bars[i - 2];
    const curr = bars[i];
    const impCandle = bars[i - 1]; // the displacement candle

    // Bullish FVG (BISI): gap between candle 1 high and candle 3 low
    if (curr.low - prev.high >= minGap) {
      const top = curr.low;
      const bottom = prev.high;
      rawGaps.push({
        id: `4H-BULL-${i}`,
        dir: 1,
        type: "BULLISH_FVG",
        top,
        bottom,
        ce: (top + bottom) / 2, // Consequent Encroachment
        size: top - bottom,
        born: i,
        bornTime: bars[i].time,
      });
    }
    // Bearish FVG (SIBI): gap between candle 3 high and candle 1 low
    else if (prev.low - curr.high >= minGap) {
      const top = prev.low;
      const bottom = curr.high;
      rawGaps.push({
        id: `4H-BEAR-${i}`,
        dir: -1,
        type: "BEARISH_FVG",
        top,
        bottom,
        ce: (top + bottom) / 2,
        size: top - bottom,
        born: i,
        bornTime: bars[i].time,
      });
    }
  }

  const all = [];
  const respected = [];
  const unrespected = [];
  const unmitigated = [];
  let active = null;

  for (const gap of rawGaps) {
    const bull = gap.dir === 1;
    let state = "UNMITIGATED";
    let tested = false;
    let respectedAt = null;
    let violatedAt = null;
    let deepestPenetration = null;
    let bodiesStayedAboveCE = true;
    let bodiesStayedBelowCE = true;

    for (let j = gap.born + 1; j < n; j++) {
      const b = bars[j];

      if (bull) {
        // Bullish gap: test occurs when bar trades down into gap (low <= top)
        if (b.low <= gap.top) {
          tested = true;
          if (deepestPenetration === null || b.low < deepestPenetration) {
            deepestPenetration = b.low;
          }
          if (b.close < gap.ce) {
            bodiesStayedAboveCE = false;
          }

          // Unrespected (violated): A 4H candle body closes BELOW the bottom of the gap!
          if (b.close < gap.bottom) {
            state = "UNRESPECTED";
            violatedAt = j;
            break; // Once violated, it is invalidated / inverted
          }

          // Respected: Bar wicked into the gap, body closed >= bottom,
          // and a subsequent bar closed back above the top (or moved away)
          if (b.close >= gap.bottom) {
            // Check if price bounced away
            const nextBars = bars.slice(j, Math.min(j + 4, n));
            const bounced = nextBars.some((nb) => nb.close > gap.top || nb.high > gap.top + 0.5 * a);
            if (bounced) {
              state = "RESPECTED";
              respectedAt = j;
            }
          }
        }
      } else {
        // Bearish gap: test occurs when bar trades up into gap (high >= bottom)
        if (b.high >= gap.bottom) {
          tested = true;
          if (deepestPenetration === null || b.high > deepestPenetration) {
            deepestPenetration = b.high;
          }
          if (b.close > gap.ce) {
            bodiesStayedBelowCE = false;
          }

          // Unrespected (violated): A 4H candle body closes ABOVE the top of the gap!
          if (b.close > gap.top) {
            state = "UNRESPECTED";
            violatedAt = j;
            break; // Invalidation
          }

          // Respected: Bar wicked into gap, body closed <= top,
          // and subsequent bar closed back below bottom (or sold off)
          if (b.close <= gap.top) {
            const nextBars = bars.slice(j, Math.min(j + 4, n));
            const dropped = nextBars.some((nb) => nb.close < gap.bottom || nb.low < gap.bottom - 0.5 * a);
            if (dropped) {
              state = "RESPECTED";
              respectedAt = j;
            }
          }
        }
      }
    }

    // Check if the latest candle is currently testing this gap
    const lastBar = bars[n - 1];
    const isCurrentlyInside =
      bull
        ? lastBar.low <= gap.top && lastBar.close >= gap.bottom
        : lastBar.high >= gap.bottom && lastBar.close <= gap.top;

    if (isCurrentlyInside && state !== "UNRESPECTED") {
      state = "TESTING";
    }

    const ageBars = n - 1 - gap.born;
    const classifiedGap = {
      ...gap,
      state,
      tested,
      ageBars,
      isCurrentlyInside,
      respectedAt: respectedAt !== null ? n - 1 - respectedAt : null,
      violatedAt: violatedAt !== null ? n - 1 - violatedAt : null,
      deepestPenetration,
      respectQuality: bull
        ? bodiesStayedAboveCE ? "A_PRIME_CE_DEFENDED" : "B_BOTTOM_DEFENDED"
        : bodiesStayedBelowCE ? "A_PRIME_CE_DEFENDED" : "B_TOP_DEFENDED",
    };

    all.push(classifiedGap);

    if (state === "RESPECTED") respected.push(classifiedGap);
    else if (state === "UNRESPECTED") unrespected.push(classifiedGap);
    else if (state === "UNMITIGATED") unmitigated.push(classifiedGap);
    else if (state === "TESTING") active = classifiedGap;
  }

  // Count metrics
  const bullishRespectedCount = respected.filter((g) => g.dir === 1).length;
  const bullishUnrespectedCount = unrespected.filter((g) => g.dir === 1).length;
  const bearishRespectedCount = respected.filter((g) => g.dir === -1).length;
  const bearishUnrespectedCount = unrespected.filter((g) => g.dir === -1).length;

  // Order Flow Synthesis:
  // Bullish dominance = Bullish FVGs respected + Bearish FVGs violated/inverted
  // Bearish dominance = Bearish FVGs respected + Bullish FVGs violated/inverted
  const bullPoints = bullishRespectedCount * 2 + bearishUnrespectedCount * 1.5;
  const bearPoints = bearishRespectedCount * 2 + bullishUnrespectedCount * 1.5;
  const netRespectScore = Math.round(bullPoints - bearPoints);

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

  // Find nearest open or respected supporting/resisting 4H FVGs relative to current price
  const supportCandidates = all
    .filter((g) => g.state !== "UNRESPECTED" && g.dir === 1 && g.top <= currentPrice)
    .sort((a, b) => b.top - a.top);
  const nearestSupportFVG = supportCandidates[0] || null;

  const resistanceCandidates = all
    .filter((g) => g.state !== "UNRESPECTED" && g.dir === -1 && g.bottom >= currentPrice)
    .sort((a, b) => a.bottom - b.bottom);
  const nearestResistanceFVG = resistanceCandidates[0] || null;

  return {
    all,
    respected,
    unrespected,
    unmitigated,
    active,
    orderFlowState,
    bullishRespectedCount,
    bullishUnrespectedCount,
    bearishRespectedCount,
    bearishUnrespectedCount,
    netRespectScore,
    nearestSupportFVG,
    nearestResistanceFVG,
    currentPrice,
  };
}
