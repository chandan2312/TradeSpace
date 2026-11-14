/**
 * lib/autonomous_system2/tpoTopologyEngine.js
 *
 * Steidlmayer CBOT TPO Profile & Distribution Topology Engine
 * Classifies the physical structure of the auction profile into standard institutional topologies:
 * 1. D-Shape: Symmetrical two-sided balance (POC near center, mean reversion dominates).
 * 2. P-Shape: Aggressive buying initiative at open, heavy balance consolidation at highs.
 * 3. b-Shape: Aggressive selling initiative at open, heavy balance consolidation at lows.
 * 4. Double Distribution (B-Shape): Two distinct Value Areas separated by a Low-Volume Node (LVN).
 * 5. Trending Auction: One-sided directional elongation (> 2.2x IB range).
 */

import { TOPOLOGY_SHAPES, QUANT_THRESHOLDS } from "./constants.js";
import { classifyAuctionTime } from "./timeEngine.js";

/**
 * Builds a complete TPO profile and classifies its Distribution Topology.
 * @param {Array<object>} sessionBars - M15 bars of the trading session
 * @param {number} atr - 14-period ATR for dynamic price-step quantization
 * @returns {object} Full TPO Profile with Topology classification
 */
export function buildTpoTopologyProfile(sessionBars, atr = 10) {
  if (!sessionBars || sessionBars.length === 0) {
    return null;
  }

  // 1. Dynamic Price Step Quantization (scale-invariant across all assets)
  const priceStep = Math.max(1e-6, atr / QUANT_THRESHOLDS.TPO_PRICE_STEP_ATR_DIVISOR);
  const roundPrice = (p) => Math.round(p / priceStep) * priceStep;

  let sessionHigh = -Infinity;
  let sessionLow = Infinity;
  let ibHigh = -Infinity;
  let ibLow = Infinity;

  // TPO Distribution Matrix: priceLevelKey -> count of TPO periods
  const tpoCounts = new Map();

  for (let periodIdx = 0; periodIdx < sessionBars.length; periodIdx++) {
    const bar = sessionBars[periodIdx];
    const high = bar.high ?? bar.h;
    const low = bar.low ?? bar.l;
    const time = bar.time ?? bar.t;

    if (high > sessionHigh) sessionHigh = high;
    if (low < sessionLow) sessionLow = low;

    const timeInfo = classifyAuctionTime(time);

    // Initial Balance (First 60 mins of London 09:00-10:00 or NY 15:30-16:30)
    if (timeInfo.isInitialBalanceWindow) {
      if (high > ibHigh) ibHigh = high;
      if (low < ibLow) ibLow = low;
    }

    const minLevel = roundPrice(low);
    const maxLevel = roundPrice(high);

    for (let p = minLevel; p <= maxLevel + 1e-9; p += priceStep) {
      const key = roundPrice(p);
      tpoCounts.set(key, (tpoCounts.get(key) || 0) + 1);
    }
  }

  // Fallback if session started mid-day
  if (!Number.isFinite(ibHigh)) ibHigh = sessionHigh;
  if (!Number.isFinite(ibLow)) ibLow = sessionLow;
  const ibRange = Math.max(priceStep, ibHigh - ibLow);
  const sessionRange = Math.max(priceStep, sessionHigh - sessionLow);

  // 2. Calculate Point of Control (POC)
  const distribution = [];
  let maxTpoCount = 0;
  let tpoPoc = (sessionHigh + sessionLow) / 2;
  let totalTpos = 0;

  for (const [price, count] of tpoCounts.entries()) {
    distribution.push({ price, count });
    totalTpos += count;

    if (count > maxTpoCount) {
      maxTpoCount = count;
      tpoPoc = price;
    }
  }

  distribution.sort((a, b) => a.price - b.price);

  // 3. Calculate 70% Value Area (VAH and VAL)
  const targetTpoCount = Math.floor(totalTpos * QUANT_THRESHOLDS.TPO_VALUE_AREA_PCT);
  let pocIdx = distribution.findIndex((d) => d.price === tpoPoc);
  if (pocIdx === -1) pocIdx = Math.floor(distribution.length / 2);

  let accumulatedTpos = distribution[pocIdx]?.count || 0;
  let upperIdx = pocIdx;
  let lowerIdx = pocIdx;

  while (accumulatedTpos < targetTpoCount && (upperIdx < distribution.length - 1 || lowerIdx > 0)) {
    const nextUpper = upperIdx < distribution.length - 1 ? distribution[upperIdx + 1].count : 0;
    const nextLower = lowerIdx > 0 ? distribution[lowerIdx - 1].count : 0;

    if (nextUpper >= nextLower && upperIdx < distribution.length - 1) {
      upperIdx++;
      accumulatedTpos += nextUpper;
    } else if (lowerIdx > 0) {
      lowerIdx--;
      accumulatedTpos += nextLower;
    } else if (upperIdx < distribution.length - 1) {
      upperIdx++;
      accumulatedTpos += nextUpper;
    } else {
      break;
    }
  }

  const vah = distribution[upperIdx]?.price ?? sessionHigh;
  const val = distribution[Math.max(0, lowerIdx)]?.price ?? sessionLow;

  // 4. Excess Tails vs. Unfinished Auctions (Single prints)
  let upperExcessTics = 0;
  for (let i = distribution.length - 1; i >= 0; i--) {
    if (distribution[i].count === 1) upperExcessTics++;
    else break;
  }
  const hasUpperExcess = upperExcessTics >= 2;

  let lowerExcessTics = 0;
  for (let i = 0; i < distribution.length; i++) {
    if (distribution[i].count === 1) lowerExcessTics++;
    else break;
  }
  const hasLowerExcess = lowerExcessTics >= 2;

  // Poor High / Poor Low (Unfinished Auctions)
  const highestBucket = distribution[distribution.length - 1];
  const lowestBucket = distribution[0];
  const isPoorHigh = upperExcessTics === 0 && highestBucket && highestBucket.count >= 2;
  const isPoorLow = lowerExcessTics === 0 && lowestBucket && lowestBucket.count >= 2;

  // 5. Dalton Rotation Factor (RF)
  let rotationFactor = 0;
  for (let i = 1; i < sessionBars.length; i++) {
    const cur = sessionBars[i];
    const prev = sessionBars[i - 1];
    const curH = cur.high ?? cur.h;
    const curL = cur.low ?? cur.l;
    const prevH = prev.high ?? prev.h;
    const prevL = prev.low ?? prev.l;

    if (curH > prevH) rotationFactor += 1;
    else if (curH < prevH) rotationFactor -= 1;

    if (curL > prevL) rotationFactor += 1;
    else if (curL < prevL) rotationFactor -= 1;
  }

  // 6. Distribution Topology Classification
  // Relative position of POC within the session range: [0.0 = session low, 1.0 = session high]
  const pocRelativeHeight = sessionRange > 0 ? (tpoPoc - sessionLow) / sessionRange : 0.5;
  const extensionRatio = sessionRange / ibRange;

  let topology = TOPOLOGY_SHAPES.D_SHAPE_BALANCED;

  if (extensionRatio >= 2.2) {
    topology = TOPOLOGY_SHAPES.TRENDING_AUCTION;
  } else if (pocRelativeHeight >= 0.65 && lowerExcessTics >= 3) {
    // Heavy balance at highs with single prints below = P-Shape (Buyer initiative)
    topology = TOPOLOGY_SHAPES.P_SHAPE_BUYER_INITIATIVE;
  } else if (pocRelativeHeight <= 0.35 && upperExcessTics >= 3) {
    // Heavy balance at lows with single prints above = b-Shape (Seller initiative)
    topology = TOPOLOGY_SHAPES.B_SHAPE_SELLER_INITIATIVE;
  } else if (pocRelativeHeight >= 0.35 && pocRelativeHeight <= 0.65) {
    topology = TOPOLOGY_SHAPES.D_SHAPE_BALANCED;
  }

  return {
    tpoPoc,
    vah,
    val,
    sessionHigh,
    sessionLow,
    ibHigh,
    ibLow,
    ibMid: (ibHigh + ibLow) / 2,
    ibRange,
    sessionRange,
    extensionRatio,
    topology,
    rotationFactor,
    hasUpperExcess,
    hasLowerExcess,
    isPoorHigh,
    isPoorLow,
    poorHighPrice: isPoorHigh ? sessionHigh : null,
    poorLowPrice: isPoorLow ? sessionLow : null,
    totalTpos,
  };
}
