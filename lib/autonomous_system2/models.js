/**
 * lib/autonomous_system2/models.js
 *
 * Orthogonal Institutional Quantitative Execution Models
 * Strictly purged of all retail indicators.
 * 1. Model A: Institutional VWAP & Value Reversion (Inventory Exhaustion Fade)
 * 2. Model B: Steidlmayer 80% Rule (Value Area Traversal)
 * 3. Model C: Initiative Value Migration & Retest (P-Shape / b-Shape Trend)
 * 4. Model D: Initial Balance (IB) Failed Auction Trap
 */

import { MODELS, QUANT_THRESHOLDS } from "./constants.js";
import { classifyAuctionTime } from "./timeEngine.js";

/**
 * Evaluates all institutional models against the current bar and market state.
 * @param {Array<object>} bars - Recent historical bars (M15)
 * @param {object} tpoProfile - Current session TPO topology profile
 * @param {object} vwapState - Current session VWAP state
 * @param {object} scenarioState - Sovereign Auction Scenario from scenarios.js
 * @param {number} atr - Current 14-period ATR
 * @param {object} yesterdayTpo - Previous session TPO profile
 * @returns {object|null} Signal object if a model triggers, or null
 */
export function evaluateExecutionModels(
  bars,
  tpoProfile,
  vwapState,
  scenarioState,
  atr,
  yesterdayTpo = null
) {
  if (!bars || bars.length < 5 || !tpoProfile || !vwapState) return null;

  const currentBar = bars[bars.length - 1];
  const previousBar = bars[bars.length - 2];
  const timeInfo = classifyAuctionTime(currentBar.time ?? currentBar.t);

  // Time Filter: Entries permitted strictly in post-IB active windows (Rule 1.7)
  if (!timeInfo.isEntryPermittedWindow) return null;

  const curHigh = currentBar.high ?? currentBar.h;
  const curLow = currentBar.low ?? currentBar.l;
  const curOpen = currentBar.open ?? currentBar.o;
  const curClose = currentBar.close ?? currentBar.c;
  const candleRange = Math.max(1e-6, curHigh - curLow);

  const prevHigh = previousBar.high ?? previousBar.h;
  const prevLow = previousBar.low ?? previousBar.l;
  const prevClose = previousBar.close ?? previousBar.c;

  const upperWick = curHigh - Math.max(curOpen, curClose);
  const lowerWick = Math.min(curOpen, curClose) - curLow;
  const upperWickPct = upperWick / candleRange;
  const lowerWickPct = lowerWick / candleRange;

  const allowed = scenarioState?.allowedModels ?? [];

  // =========================================================================
  // MODEL A: INSTITUTIONAL VWAP MEAN REVERSION (INVENTORY EXHAUSTION FADE)
  // =========================================================================
  if (allowed.includes(MODELS.MODEL_VWAP_MEAN_REVERSION)) {
    const { vwap, upper2, lower2 } = vwapState;

    // Case A1: Bearish Fade (Probed above +2.0σ VWAP Exhaustion Band)
    if (curHigh >= upper2 && curClose < upper2 && (upperWickPct >= QUANT_THRESHOLDS.MIN_EXCESS_WICK_RATIO || curClose < curOpen)) {
      const sweepExtreme = Math.max(curHigh, prevHigh);
      const stopDistance = Math.max(atr * 0.35, (sweepExtreme - curClose) + atr * 0.18);
      const stopLoss = curClose + stopDistance;

      const tp1 = vwap; // Primary Target: Institutional Fair Value (Session VWAP)
      const tp2 = vwapState.lower1; // Secondary Target: Opposite 1σ Band

      const potentialProfit = curClose - tp1;
      const rrRatio = potentialProfit / stopDistance;

      if (rrRatio >= QUANT_THRESHOLDS.MIN_RR_RATIO || (curClose - tp2) / stopDistance >= 2.0) {
        return {
          modelId: MODELS.MODEL_VWAP_MEAN_REVERSION,
          caseId: "CASE_A1_BEARISH_VWAP_2SIGMA_EXHAUSTION_FADE",
          direction: -1,
          time: currentBar.time ?? currentBar.t,
          entryPrice: curClose,
          stopLoss,
          tp1,
          tp2,
          rrRatio: Math.round(((curClose - tp2) / stopDistance) * 100) / 100,
          invalidationPrice: sweepExtreme,
          reason: `Inventory Exhaustion Fade Short: Probed above +2.0σ VWAP (${upper2.toFixed(2)}) with upper rejection wick (${(upperWickPct * 100).toFixed(0)}%). Target: Session VWAP (${vwap.toFixed(2)}).`,
        };
      }
    }

    // Case A2: Bullish Fade (Probed below -2.0σ VWAP Exhaustion Band)
    if (curLow <= lower2 && curClose > lower2 && (lowerWickPct >= QUANT_THRESHOLDS.MIN_EXCESS_WICK_RATIO || curClose > curOpen)) {
      const sweepExtreme = Math.min(curLow, prevLow);
      const stopDistance = Math.max(atr * 0.35, (curClose - sweepExtreme) + atr * 0.18);
      const stopLoss = curClose - stopDistance;

      const tp1 = vwap; // Primary Target: Institutional Fair Value (Session VWAP)
      const tp2 = vwapState.upper1; // Secondary Target: Opposite 1σ Band

      const potentialProfit = tp1 - curClose;
      const rrRatio = potentialProfit / stopDistance;

      if (rrRatio >= QUANT_THRESHOLDS.MIN_RR_RATIO || (tp2 - curClose) / stopDistance >= 2.0) {
        return {
          modelId: MODELS.MODEL_VWAP_MEAN_REVERSION,
          caseId: "CASE_A2_BULLISH_VWAP_2SIGMA_EXHAUSTION_FADE",
          direction: 1,
          time: currentBar.time ?? currentBar.t,
          entryPrice: curClose,
          stopLoss,
          tp1,
          tp2,
          rrRatio: Math.round(((tp2 - curClose) / stopDistance) * 100) / 100,
          invalidationPrice: sweepExtreme,
          reason: `Inventory Exhaustion Fade Long: Probed below -2.0σ VWAP (${lower2.toFixed(2)}) with lower rejection wick (${(lowerWickPct * 100).toFixed(0)}%). Target: Session VWAP (${vwap.toFixed(2)}).`,
        };
      }
    }
  }

  // =========================================================================
  // MODEL B: STEIDLMAYER 80% RULE (VALUE AREA RE-ENTRY & TRAVERSAL)
  // =========================================================================
  if (yesterdayTpo && allowed.includes(MODELS.STEIDLMAYER_80_PERCENT_RULE)) {
    const { vah: yVah, val: yVal, tpoPoc: yPoc } = yesterdayTpo;
    const thirdBar = bars.length >= 3 ? bars[bars.length - 3] : previousBar;
    const thirdLow = thirdBar.low ?? thirdBar.l;
    const thirdHigh = thirdBar.high ?? thirdBar.h;
    const rf = tpoProfile.rotationFactor ?? 0;

    // Case B1: Bullish Value Area Re-entry (Acceptance above VAL)
    const isProbedBelowVal = (tpoProfile.sessionLow < yVal || prevLow < yVal - atr * 0.1) && rf > -3;
    const isAcceptedInsideVal = curClose > yVal && prevClose > yVal && curClose < yPoc && curClose > curOpen;
    const hasLowerRejection = tpoProfile.hasLowerExcess || lowerWickPct >= 0.18 || prevLow < yVal - atr * 0.1;

    if (hasLowerRejection && isProbedBelowVal && isAcceptedInsideVal) {
      const sweepExtreme = Math.min(curLow, prevLow, thirdLow);
      const stopDistance = Math.max(atr * 0.35, (curClose - sweepExtreme) + atr * 0.18);
      const stopLoss = curClose - stopDistance;

      const tp1 = yPoc; // Equilibrium Fair Value
      const tp2 = yVah; // Full Value Area Traversal (The 80% Rule Destination)

      const potentialProfit = tp2 - curClose;
      const rrRatio = potentialProfit / stopDistance;

      if (rrRatio >= 2.0 && tp1 > curClose && tp2 > tp1) {
        return {
          modelId: MODELS.STEIDLMAYER_80_PERCENT_RULE,
          caseId: "CASE_B1_BULLISH_80_PCT_RULE_REENTRY",
          direction: 1,
          time: currentBar.time ?? currentBar.t,
          entryPrice: curClose,
          stopLoss,
          tp1,
          tp2,
          rrRatio: Math.round(rrRatio * 100) / 100,
          invalidationPrice: sweepExtreme,
          reason: `Steidlmayer 80% Rule Long: Lower Excess Rejection formed with acceptance inside Prior Value Area above VAL (${yVal.toFixed(2)}). RotationFactor: ${rf}. Target: ${tp2.toFixed(2)}.`,
        };
      }
    }

    // Case B2: Bearish Value Area Re-entry (Acceptance below VAH)
    const isProbedAboveVah = (tpoProfile.sessionHigh > yVah || prevHigh > yVah + atr * 0.1) && rf < 3;
    const isAcceptedInsideVah = curClose < yVah && prevClose < yVah && curClose > yPoc && curClose < curOpen;
    const hasUpperRejection = tpoProfile.hasUpperExcess || upperWickPct >= 0.18 || prevHigh > yVah + atr * 0.1;

    if (hasUpperRejection && isProbedAboveVah && isAcceptedInsideVah) {
      const sweepExtreme = Math.max(curHigh, prevHigh, thirdHigh);
      const stopDistance = Math.max(atr * 0.35, (sweepExtreme - curClose) + atr * 0.18);
      const stopLoss = curClose + stopDistance;

      const tp1 = yPoc;
      const tp2 = yVal;

      const potentialProfit = curClose - tp2;
      const rrRatio = potentialProfit / stopDistance;

      if (rrRatio >= 2.0 && tp1 < curClose && tp2 < tp1) {
        return {
          modelId: MODELS.STEIDLMAYER_80_PERCENT_RULE,
          caseId: "CASE_B2_BEARISH_80_PCT_RULE_REENTRY",
          direction: -1,
          time: currentBar.time ?? currentBar.t,
          entryPrice: curClose,
          stopLoss,
          tp1,
          tp2,
          rrRatio: Math.round(rrRatio * 100) / 100,
          invalidationPrice: sweepExtreme,
          reason: `Steidlmayer 80% Rule Short: Upper Excess Rejection formed with acceptance inside Prior Value Area below VAH (${yVah.toFixed(2)}). RotationFactor: ${rf}. Target: ${tp2.toFixed(2)}.`,
        };
      }
    }
  }

  // =========================================================================
  // MODEL C: INITIATIVE VALUE MIGRATION & RETEST (P-SHAPE / B-SHAPE TREND)
  // =========================================================================
  if (allowed.includes(MODELS.MODEL_INITIATIVE_VALUE_RETEST)) {
    const { tpoPoc, sessionHigh, sessionLow } = tpoProfile;
    const { vwap } = vwapState;

    // Case C1: Bullish Initiative Retest (P-Shape: Pullback to Developing POC/VWAP)
    if (scenarioState.masterBias === "BULLISH_TREND") {
      const supportLevel = Math.max(vwap, tpoPoc);
      const isRetestingSupport = curLow <= supportLevel + atr * 0.35 && prevLow <= supportLevel + atr * 0.35;
      const isSupportHolding = curClose >= supportLevel - atr * 0.15 && curClose > curOpen;

      if (isRetestingSupport && isSupportHolding && (lowerWickPct >= 0.18 || curClose > prevClose)) {
        const pullbackLow = Math.min(curLow, prevLow);
        const stopDistance = Math.max(atr * 0.35, (curClose - pullbackLow) + atr * 0.18);
        const stopLoss = curClose - stopDistance;

        const tp1 = sessionHigh > curClose + atr * 0.5 ? sessionHigh : curClose + stopDistance * 1.8;
        const tp2 = curClose + stopDistance * 3.2;

        const potentialProfit = tp2 - curClose;
        const rrRatio = potentialProfit / stopDistance;

        if (rrRatio >= 2.0 && tp1 > curClose) {
          return {
            modelId: MODELS.MODEL_INITIATIVE_VALUE_RETEST,
            caseId: "CASE_C1_BULLISH_VALUE_MIGRATION_RETEST",
            direction: 1,
            time: currentBar.time ?? currentBar.t,
            entryPrice: curClose,
            stopLoss,
            tp1,
            tp2,
            rrRatio: Math.round(rrRatio * 100) / 100,
            invalidationPrice: pullbackLow,
            reason: `Initiative Value Retest Long: P-Shape buyer initiative confirmed. Retested Developing POC/VWAP (${supportLevel.toFixed(2)}) at discount. Target: ${tp1.toFixed(2)}.`,
          };
        }
      }
    }

    // Case C2: Bearish Initiative Retest (b-Shape: Pullback to Developing POC/VWAP)
    if (scenarioState.masterBias === "BEARISH_TREND") {
      const resistanceLevel = Math.min(vwap, tpoPoc);
      const isRetestingResistance = curHigh >= resistanceLevel - atr * 0.35 && prevHigh >= resistanceLevel - atr * 0.35;
      const isResistanceHolding = curClose <= resistanceLevel + atr * 0.15 && curClose < curOpen;

      if (isRetestingResistance && isResistanceHolding && (upperWickPct >= 0.18 || curClose < prevClose)) {
        const pullbackHigh = Math.max(curHigh, prevHigh);
        const stopDistance = Math.max(atr * 0.35, (pullbackHigh - curClose) + atr * 0.18);
        const stopLoss = curClose + stopDistance;

        const tp1 = sessionLow < curClose - atr * 0.5 ? sessionLow : curClose - stopDistance * 1.8;
        const tp2 = curClose - stopDistance * 3.2;

        const potentialProfit = curClose - tp2;
        const rrRatio = potentialProfit / stopDistance;

        if (rrRatio >= 2.0 && tp1 < curClose) {
          return {
            modelId: MODELS.MODEL_INITIATIVE_VALUE_RETEST,
            caseId: "CASE_C2_BEARISH_VALUE_MIGRATION_RETEST",
            direction: -1,
            time: currentBar.time ?? currentBar.t,
            entryPrice: curClose,
            stopLoss,
            tp1,
            tp2,
            rrRatio: Math.round(rrRatio * 100) / 100,
            invalidationPrice: pullbackHigh,
            reason: `Initiative Value Retest Short: b-Shape seller initiative confirmed. Retested Developing POC/VWAP (${resistanceLevel.toFixed(2)}) at premium. Target: ${tp1.toFixed(2)}.`,
          };
        }
      }
    }
  }

  // =========================================================================
  // MODEL D: INITIAL BALANCE (IB) FAILED AUCTION TRAP
  // =========================================================================
  if (allowed.includes(MODELS.MODEL_IB_FAILED_AUCTION_TRAP)) {
    const { ibHigh, ibLow, tpoPoc, ibMid, rotationFactor = 0 } = tpoProfile;

    // Case D1: Bearish Failed Auction High (Trapped Breakout Buyers)
    if ((tpoProfile.hasUpperExcess || upperWickPct >= 0.25) && rotationFactor < 3) {
      const sweptIbHigh = curHigh > ibHigh || prevHigh > ibHigh;
      const closedBelowIbHigh = curClose < ibHigh;
      const isBearishTrapWick = upperWickPct >= 0.22 || curClose < curOpen;

      if (sweptIbHigh && closedBelowIbHigh && isBearishTrapWick) {
        const sweepExtreme = Math.max(curHigh, prevHigh);
        const stopDistance = Math.max(atr * 0.35, (sweepExtreme - curClose) + atr * 0.18);
        const stopLoss = curClose + stopDistance;

        const tp1 = tpoPoc && tpoPoc < curClose ? tpoPoc : ibMid;
        const tp2 = tpoProfile.poorLowPrice && tpoProfile.poorLowPrice < curClose ? tpoProfile.poorLowPrice : ibLow;

        const potentialProfit = curClose - tp2;
        const rrRatio = potentialProfit / stopDistance;

        if (rrRatio >= 2.0 && tp1 < curClose && tp2 < tp1) {
          return {
            modelId: MODELS.MODEL_IB_FAILED_AUCTION_TRAP,
            caseId: "CASE_D1_BEARISH_IB_HIGH_TRAP",
            direction: -1,
            time: currentBar.time ?? currentBar.t,
            entryPrice: curClose,
            stopLoss,
            tp1,
            tp2,
            rrRatio: Math.round(rrRatio * 100) / 100,
            invalidationPrice: sweepExtreme,
            reason: `Trapped buyers at IB High (${ibHigh.toFixed(2)}). RotationFactor: ${rotationFactor}. Target: ${tp2.toFixed(2)}.`,
          };
        }
      }
    }

    // Case D2: Bullish Failed Auction Low (Trapped Breakout Sellers)
    if ((tpoProfile.hasLowerExcess || lowerWickPct >= 0.25) && rotationFactor > -3) {
      const sweptIbLow = curLow < ibLow || prevLow < ibLow;
      const closedAboveIbLow = curClose > ibLow;
      const isBullishTrapWick = lowerWickPct >= 0.22 || curClose > curOpen;

      if (sweptIbLow && closedAboveIbLow && isBullishTrapWick) {
        const sweepExtreme = Math.min(curLow, prevLow);
        const stopDistance = Math.max(atr * 0.35, (curClose - sweepExtreme) + atr * 0.18);
        const stopLoss = curClose - stopDistance;

        const tp1 = tpoPoc && tpoPoc > curClose ? tpoPoc : ibMid;
        const tp2 = tpoProfile.poorHighPrice && tpoProfile.poorHighPrice > curClose ? tpoProfile.poorHighPrice : ibHigh;

        const potentialProfit = tp2 - curClose;
        const rrRatio = potentialProfit / stopDistance;

        if (rrRatio >= 2.0 && tp1 > curClose && tp2 > tp1) {
          return {
            modelId: MODELS.MODEL_IB_FAILED_AUCTION_TRAP,
            caseId: "CASE_D2_BULLISH_IB_LOW_TRAP",
            direction: 1,
            time: currentBar.time ?? currentBar.t,
            entryPrice: curClose,
            stopLoss,
            tp1,
            tp2,
            rrRatio: Math.round(rrRatio * 100) / 100,
            invalidationPrice: sweepExtreme,
            reason: `Trapped sellers at IB Low (${ibLow.toFixed(2)}). RotationFactor: ${rotationFactor}. Target: ${tp2.toFixed(2)}.`,
          };
        }
      }
    }
  }

  return null;
}
