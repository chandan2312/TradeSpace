/**
 * lib/autonomous_quant/tpoEngine.js
 *
 * System #2 TPO (Time-Price Opportunity) Auction Profile Engine
 * Strictly based on J. Peter Steidlmayer's Chicago Board of Trade (CBOT) framework.
 * Operates on 100% pure OHLC data—no external tick volume feeds required.
 */

import { TPO_DAY_TYPES, VALUE_RELATIONSHIPS, QUANT_THRESHOLDS } from "./constants.js";
import { classifyAuctionTime } from "./timeEngine.js";

/**
 * Calculates a full TPO profile for a collection of intraday bars belonging to a session.
 * @param {Array<object>} sessionBars - M15 or M5 bars for the trading session
 * @param {number} atr - 14-period ATR for dynamic price-step quantization
 * @returns {object} Full TPO Profile (POC, VAH, VAL, IB, DayType, ExcessTails)
 */
export function buildTpoProfile(sessionBars, atr = 10) {
  if (!sessionBars || sessionBars.length === 0) {
    return null;
  }

  // 1. Dynamic Price Step Quantization (prevents floating-point fragmentation)
  const priceStep = Math.max(0.1, atr / QUANT_THRESHOLDS.TPO_PRICE_STEP_ATR_DIVISOR);
  const roundPrice = (p) => Math.round(p / priceStep) * priceStep;

  // Track session extremes
  let sessionHigh = -Infinity;
  let sessionLow = Infinity;

  // Initial Balance (IB): First 4 M15 bars of session (60 mins)
  let ibHigh = -Infinity;
  let ibLow = Infinity;
  let ibBarCount = 0;

  // TPO Distribution Matrix: priceLevelKey -> Set<periodIndex>
  const tpoMatrix = new Map();

  for (let periodIdx = 0; periodIdx < sessionBars.length; periodIdx++) {
    const bar = sessionBars[periodIdx];
    const high = bar.high ?? bar.h;
    const low = bar.low ?? bar.l;
    const time = bar.time ?? bar.t;

    if (high > sessionHigh) sessionHigh = high;
    if (low < sessionLow) sessionLow = low;

    const timeInfo = classifyAuctionTime(time);

    // Initial Balance tracking (London IB 09:00-10:00 or NY IB 15:30-16:30)
    if (timeInfo.isInitialBalanceWindow || ibBarCount < 4) {
      if (high > ibHigh) ibHigh = high;
      if (low < ibLow) ibLow = low;
      ibBarCount++;
    }

    // Populate TPO brackets for this time period
    const startStep = roundPrice(low);
    const endStep = roundPrice(high);

    // Safety limit to avoid infinite loops on bad data
    const maxSteps = 500;
    let stepCount = 0;

    for (let p = startStep; p <= endStep + 1e-9; p = roundPrice(p + priceStep)) {
      if (stepCount++ > maxSteps) break;
      const key = p.toFixed(4);
      if (!tpoMatrix.has(key)) {
        tpoMatrix.set(key, new Set());
      }
      tpoMatrix.get(key).add(periodIdx);
    }
  }

  if (tpoMatrix.size === 0) return null;

  // 2. Calculate TPO Point of Control (POC)
  // Level with maximum unique period brackets
  let maxTpoCount = 0;
  let tpoPoc = roundPrice((sessionHigh + sessionLow) / 2);
  let totalTpos = 0;

  // Convert map to sorted array of { price, count }
  const distribution = [];
  for (const [key, periodSet] of tpoMatrix.entries()) {
    const price = parseFloat(key);
    const count = periodSet.size;
    totalTpos += count;
    distribution.push({ price, count });
    if (count > maxTpoCount) {
      maxTpoCount = count;
      tpoPoc = price;
    }
  }

  distribution.sort((a, b) => a.price - b.price);

  // 3. Calculate 70% Value Area (VAH & VAL) via Steidlmayer Dual-Expansion Algorithm
  const targetTpos = Math.floor(totalTpos * QUANT_THRESHOLDS.TPO_VALUE_AREA_PCT);
  let accumulatedTpos = maxTpoCount;

  // Find index of POC in sorted distribution
  const pocIdx = distribution.findIndex((d) => Math.abs(d.price - tpoPoc) < 1e-6);
  let upperIdx = pocIdx >= 0 ? pocIdx + 1 : 0;
  let lowerIdx = pocIdx >= 0 ? pocIdx - 1 : 0;

  while (accumulatedTpos < targetTpos && (upperIdx < distribution.length || lowerIdx >= 0)) {
    const upperCount = upperIdx < distribution.length ? distribution[upperIdx].count : 0;
    const lowerCount = lowerIdx >= 0 ? distribution[lowerIdx].count : 0;

    if (upperCount >= lowerCount && upperIdx < distribution.length) {
      accumulatedTpos += upperCount;
      upperIdx++;
    } else if (lowerIdx >= 0) {
      accumulatedTpos += lowerCount;
      lowerIdx--;
    } else {
      break;
    }
  }

  const val = lowerIdx >= 0 ? distribution[lowerIdx].price : sessionLow;
  const vah = upperIdx < distribution.length ? distribution[Math.min(distribution.length - 1, upperIdx - 1)].price : sessionHigh;

  // 4. Initial Balance Metrics
  const ibRange = Math.max(priceStep, ibHigh - ibLow);
  const ibMid = (ibHigh + ibLow) / 2;
  const totalSessionRange = Math.max(priceStep, sessionHigh - sessionLow);
  const ibExtensionRatio = totalSessionRange / ibRange;

  // 5. Day Type Classification
  let dayType = TPO_DAY_TYPES.NORMAL_DAY;
  const upperExtension = (sessionHigh - ibHigh) / ibRange;
  const lowerExtension = (ibLow - sessionLow) / ibRange;

  if (upperExtension > 0.25 && lowerExtension > 0.25) {
    dayType = TPO_DAY_TYPES.NEUTRAL_DAY; // Expanded both sides
  } else if (ibExtensionRatio > 2.2) {
    dayType = TPO_DAY_TYPES.TREND_DAY; // Unilateral relentless trend
  } else if (upperExtension > 0.3 || lowerExtension > 0.3) {
    dayType = TPO_DAY_TYPES.NORMAL_VARIATION; // One-sided extension
  } else if (ibExtensionRatio <= 1.25) {
    dayType = TPO_DAY_TYPES.NORMAL_DAY; // Contained inside IB
  }

  // 6. Detect Excess Tails vs. Poor Extremes (Unfinished Auctions)
  // Extremes that only have 1 period bracket and at least 3 consecutive single steps are true Excess
  let upperExcessTics = 0;
  for (let i = distribution.length - 1; i >= 0; i--) {
    if (distribution[i].count === 1) upperExcessTics++;
    else break;
  }
  const hasUpperExcess = upperExcessTics >= 3;

  let lowerExcessTics = 0;
  for (let i = 0; i < distribution.length; i++) {
    if (distribution[i].count === 1) lowerExcessTics++;
    else break;
  }
  const hasLowerExcess = lowerExcessTics >= 3;

  // Unfinished Auction (Poor High / Poor Low):
  // When an extreme has NO excess tail and >= 2 brackets traded at the exact peak/trough
  const highestBucket = distribution[distribution.length - 1];
  const lowestBucket = distribution[0];
  const isPoorHigh = upperExcessTics === 0 && highestBucket && highestBucket.count >= 2;
  const isPoorLow = lowerExcessTics === 0 && lowestBucket && lowestBucket.count >= 2;

  // 7. Calculate Dalton's Rotation Factor (RF)
  // Quantifies auction initiative (+1 for higher high, +1 for higher low, -1 for lower high, -1 for lower low)
  let rotationFactor = 0;
  for (let i = 1; i < sessionBars.length; i++) {
    const curH = sessionBars[i].high ?? sessionBars[i].h;
    const curL = sessionBars[i].low ?? sessionBars[i].l;
    const prevH = sessionBars[i - 1].high ?? sessionBars[i - 1].h;
    const prevL = sessionBars[i - 1].low ?? sessionBars[i - 1].l;
    if (curH > prevH) rotationFactor += 1;
    else if (curH < prevH) rotationFactor -= 1;
    if (curL > prevL) rotationFactor += 1;
    else if (curL < prevL) rotationFactor -= 1;
  }

  return {
    sessionHigh,
    sessionLow,
    sessionRange: totalSessionRange,
    ibHigh,
    ibLow,
    ibMid,
    ibRange,
    ibExtensionRatio: Math.round(ibExtensionRatio * 100) / 100,
    tpoPoc,
    vah,
    val,
    dayType,
    hasUpperExcess,
    hasLowerExcess,
    isPoorHigh,
    isPoorLow,
    poorHighPrice: isPoorHigh ? sessionHigh : null,
    poorLowPrice: isPoorLow ? sessionLow : null,
    rotationFactor,
    totalTpos,
    priceStep,
  };
}

/**
 * Compares Today's TPO Value Area against Yesterday's TPO Value Area to determine Multi-Day Bias.
 */
export function classifyValueRelationship(todayTpo, yesterdayTpo) {
  if (!todayTpo || !yesterdayTpo) return VALUE_RELATIONSHIPS.INSIDE_VALUE;

  const tVah = todayTpo.vah;
  const tVal = todayTpo.val;
  const yVah = yesterdayTpo.vah;
  const yVal = yesterdayTpo.val;

  if (tVal > yVah) return VALUE_RELATIONSHIPS.HIGHER_VALUE;
  if (tVah < yVal) return VALUE_RELATIONSHIPS.LOWER_VALUE;
  if (tVah > yVah && tVal > yVal) return VALUE_RELATIONSHIPS.OVERLAPPING_HIGHER;
  if (tVah < yVah && tVal < yVal) return VALUE_RELATIONSHIPS.OVERLAPPING_LOWER;
  if (tVah <= yVah && tVal >= yVal) return VALUE_RELATIONSHIPS.INSIDE_VALUE;
  if (tVah >= yVah && tVal <= yVal) return VALUE_RELATIONSHIPS.OUTSIDE_VALUE;

  return VALUE_RELATIONSHIPS.INSIDE_VALUE;
}
