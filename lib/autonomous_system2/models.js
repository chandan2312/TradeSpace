/**
 * lib/autonomous_system2/models.js
 *
 * System #2 Formal Execution Models:
 * 1. Model 1: Initial Balance (IB) Failed Auction Trap (Mean Reversion / Trapped Liquidity)
 * 2. Model 2: Coiled Squeeze & Value Area Expansion (Volatility Breakout / Trend Runner)
 * 3. Model 3: Unfinished Auction Sweep (Exploiting Poor Highs / Poor Lows)
 */

import { MODELS } from "./constants.js";
import { classifyAuctionTime } from "./timeEngine.js";

/**
 * Evaluates all 3 models against the current bar and market state.
 * @param {Array<object>} bars - Recent historical bars (M15)
 * @param {object} tpoProfile - Current session TPO profile
 * @param {object} biasState - Master bias and regime state
 * @param {number} atr - Current 14-period ATR
 * @param {object} yesterdayTpo - Previous session TPO profile (Auction Context)
 * @returns {object|null} Signal object if a model triggers, or null
 */
export function evaluateExecutionModels(bars, tpoProfile, biasState, atr, yesterdayTpo = null) {
  if (!bars || bars.length < 5 || !tpoProfile) return null;

  const currentBar = bars[bars.length - 1];
  const previousBar = bars[bars.length - 2];
  const timeInfo = classifyAuctionTime(currentBar.time ?? currentBar.t);

  // Time Filter: Entries only permitted in active London/NY windows post-IB formation
  if (!timeInfo.isEntryPermittedWindow) return null;

  const curHigh = currentBar.high ?? currentBar.h;
  const curLow = currentBar.low ?? currentBar.l;
  const curOpen = currentBar.open ?? currentBar.o;
  const curClose = currentBar.close ?? currentBar.c;
  const candleRange = Math.max(0.01, curHigh - curLow);

  const prevHigh = previousBar.high ?? previousBar.h;
  const prevLow = previousBar.low ?? previousBar.l;
  const prevClose = previousBar.close ?? previousBar.c;

  // -------------------------------------------------------------------------
  // MODEL 0: STEIDLMAYER 80% RULE (VALUE AREA RE-ENTRY & TRAVERSAL)
  // -------------------------------------------------------------------------
  // Classic Auction Market Theory: When price re-enters prior Value Area and prints
  // two consecutive 15m closes inside, there is an 80% statistical probability of
  // traversing the entire Value Area to the opposite boundary.
  if (yesterdayTpo && biasState.allowedModels.includes(MODELS.STEIDLMAYER_80_PERCENT_RULE)) {
    const { vah: yVah, val: yVal, tpoPoc: yPoc } = yesterdayTpo;
    const thirdBar = bars.length >= 3 ? bars[bars.length - 3] : previousBar;
    const thirdLow = thirdBar.low ?? thirdBar.l;
    const thirdHigh = thirdBar.high ?? thirdBar.h;
    const rf = tpoProfile.rotationFactor ?? 0;

    // Case 0A: Bullish Value Area Re-entry (Acceptance above VAL)
    // Requires: Genuine probe/open outside Value Area, Excess Tail at session low, and 2 consecutive closes accepted inside
    const isProbedBelowVal = (tpoProfile.ibLow < yVal || prevLow < yVal - atr * 0.2) && rf > -3;
    const isAcceptedInsideVal = curClose > yVal && prevClose > yVal && curClose < yPoc && curClose > curOpen;

    if (tpoProfile.hasLowerExcess && isProbedBelowVal && isAcceptedInsideVal) {
      const sweepExtreme = Math.min(curLow, prevLow, thirdLow);
      const stopDistance = Math.max(atr * 0.4, (curClose - sweepExtreme) + atr * 0.2);
      const stopLoss = curClose - stopDistance;

      const tp1 = yPoc; // First target: Equilibrium fair value
      const tp2 = yVah; // Second target: Full Value Area traversal

      const potentialProfit = tp2 - curClose;
      const rrRatio = potentialProfit / stopDistance;

      if (rrRatio >= 2.0 && tp1 > curClose && tp2 > tp1) {
        return {
          modelId: MODELS.STEIDLMAYER_80_PERCENT_RULE,
          caseId: "CASE_0A_BULLISH_80_PCT_RULE_REENTRY",
          direction: 1, // Long
          entryPrice: curClose,
          stopLoss,
          tp1,
          tp2,
          rrRatio: Math.round(rrRatio * 100) / 100,
          invalidationPrice: sweepExtreme,
          reason: `Steidlmayer 80% Rule Long: Lower Excess Tail formed with acceptance inside Prior Value Area above VAL (${yVal.toFixed(2)}). RotationFactor: ${rf}. Target: ${tp2.toFixed(2)}.`,
        };
      }
    }

    // Case 0B: Bearish Value Area Re-entry (Acceptance below VAH)
    // Requires: Genuine probe/open outside Value Area, Excess Tail at session high, and 2 consecutive closes accepted inside
    const isProbedAboveVah = (tpoProfile.ibHigh > yVah || prevHigh > yVah + atr * 0.2) && rf < 3;
    const isAcceptedInsideVah = curClose < yVah && prevClose < yVah && curClose > yPoc && curClose < curOpen;

    if (tpoProfile.hasUpperExcess && isProbedAboveVah && isAcceptedInsideVah) {
      const sweepExtreme = Math.max(curHigh, prevHigh, thirdHigh);
      const stopDistance = Math.max(atr * 0.4, (sweepExtreme - curClose) + atr * 0.2);
      const stopLoss = curClose + stopDistance;

      const tp1 = yPoc; // First target: Equilibrium fair value
      const tp2 = yVal; // Second target: Full Value Area traversal

      const potentialProfit = curClose - tp2;
      const rrRatio = potentialProfit / stopDistance;

      if (rrRatio >= 2.0 && tp1 < curClose && tp2 < tp1) {
        return {
          modelId: MODELS.STEIDLMAYER_80_PERCENT_RULE,
          caseId: "CASE_0B_BEARISH_80_PCT_RULE_REENTRY",
          direction: -1, // Short
          entryPrice: curClose,
          stopLoss,
          tp1,
          tp2,
          rrRatio: Math.round(rrRatio * 100) / 100,
          invalidationPrice: sweepExtreme,
          reason: `Steidlmayer 80% Rule Short: Upper Excess Tail formed with acceptance inside Prior Value Area below VAH (${yVah.toFixed(2)}). RotationFactor: ${rf}. Target: ${tp2.toFixed(2)}.`,
        };
      }
    }
  }

  // -------------------------------------------------------------------------
  // MODEL 1: INITIAL BALANCE (IB) FAILED AUCTION TRAP
  // -------------------------------------------------------------------------
  // Best in: ROTATIONAL_BALANCED or MEAN_REVERTING regimes
  if (biasState.allowedModels.includes(MODELS.MODEL_1_IB_FAILED_AUCTION_TRAP)) {
    const { ibHigh, ibLow, tpoPoc, ibMid, rotationFactor = 0 } = tpoProfile;
    const upperWick = curHigh - Math.max(curOpen, curClose);
    const lowerWick = Math.min(curOpen, curClose) - curLow;
    const upperWickPct = upperWick / candleRange;
    const lowerWickPct = lowerWick / candleRange;

    // Case 1A: Bearish Failed Auction High (Trapped Breakout Buyers)
    // Institutional Rejection Check: Requires verified Upper Excess Tail and Rotation Factor < 3
    if (tpoProfile.hasUpperExcess && rotationFactor < 3) {
      const sweptIbHigh = curHigh > ibHigh || prevHigh > ibHigh;
      const closedBelowIbHigh = curClose < ibHigh;
      const isBearishTrapWick = upperWickPct >= 0.28 || curClose < curOpen;

      if (sweptIbHigh && closedBelowIbHigh && isBearishTrapWick) {
        const sweepExtreme = Math.max(curHigh, prevHigh);
        const stopDistance = Math.max(atr * 0.4, (sweepExtreme - curClose) + atr * 0.2);
        const stopLoss = curClose + stopDistance;

        // Targets: TP1 at TPO POC (or IB Mid), TP2 at IB Low (or Poor Low if confirmed)
        const tp1 = tpoPoc && tpoPoc < curClose ? tpoPoc : ibMid;
        const tp2 = tpoProfile.poorLowPrice && tpoProfile.poorLowPrice < curClose ? tpoProfile.poorLowPrice : ibLow;

        const potentialProfit = curClose - tp2;
        const rrRatio = potentialProfit / stopDistance;

        if (rrRatio >= 2.0 && tp1 < curClose && tp2 < tp1) {
          return {
            modelId: MODELS.MODEL_1_IB_FAILED_AUCTION_TRAP,
            caseId: "CASE_1A_BEARISH_IB_HIGH_TRAP",
            direction: -1, // Short
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

    // Case 1B: Bullish Failed Auction Low (Trapped Breakout Sellers)
    // Institutional Rejection Check: Requires verified Lower Excess Tail and Rotation Factor > -3
    if (tpoProfile.hasLowerExcess && rotationFactor > -3) {
      const sweptIbLow = curLow < ibLow || prevLow < ibLow;
      const closedAboveIbLow = curClose > ibLow;
      const isBullishTrapWick = lowerWickPct >= 0.28 || curClose > curOpen;

      if (sweptIbLow && closedAboveIbLow && isBullishTrapWick) {
        const sweepExtreme = Math.min(curLow, prevLow);
        const stopDistance = Math.max(atr * 0.4, (curClose - sweepExtreme) + atr * 0.2);
        const stopLoss = curClose - stopDistance;

        // Targets: TP1 at TPO POC (or IB Mid), TP2 at IB High (or Poor High if confirmed)
        const tp1 = tpoPoc && tpoPoc > curClose ? tpoPoc : ibMid;
        const tp2 = tpoProfile.poorHighPrice && tpoProfile.poorHighPrice > curClose ? tpoProfile.poorHighPrice : ibHigh;

        const potentialProfit = tp2 - curClose;
        const rrRatio = potentialProfit / stopDistance;

        if (rrRatio >= 2.0 && tp1 > curClose && tp2 > tp1) {
          return {
            modelId: MODELS.MODEL_1_IB_FAILED_AUCTION_TRAP,
            caseId: "CASE_1B_BULLISH_IB_LOW_TRAP",
            direction: 1, // Long
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

  // -------------------------------------------------------------------------
  // MODEL 2: COILED SQUEEZE & VALUE AREA EXPANSION
  // -------------------------------------------------------------------------
  // Best in: VOLATILITY_SQUEEZE or TREND_PERSISTENT with verified Squeeze Fire
  if (biasState.allowedModels.includes(MODELS.MODEL_2_COILED_SQUEEZE_EXPANSION)) {
    const squeeze = biasState.regimeInfo?.squeezeInfo;
    if (squeeze && squeeze.squeezeFired && squeeze.squeezeBars >= 4) {
      // Pure Auction Market Theory Acceptance:
      // Bullish Expansion requires price accepted strictly ABOVE Prior Session's TPO Point of Control (POC)
      // Bearish Expansion requires price accepted strictly BELOW Prior Session's TPO Point of Control (POC)
      const isAboveAuctionValue = yesterdayTpo ? curClose > yesterdayTpo.tpoPoc : curClose > tpoProfile.ibMid;
      const isBelowAuctionValue = yesterdayTpo ? curClose < yesterdayTpo.tpoPoc : curClose < tpoProfile.ibMid;

      // Case 2A: Bullish Volatility Expansion Breakout (Accepted above Prior TPO POC!)
      if (curClose > squeeze.kcUpper && curClose > prevClose && squeeze.isMomentumExpanding && isAboveAuctionValue) {
        const stopDistance = Math.max(atr * 0.5, curClose - squeeze.midline);
        const stopLoss = curClose - stopDistance;
        const tp1 = curClose + stopDistance * 1.5;
        const tp2 = curClose + stopDistance * 3.2;

        return {
          modelId: MODELS.MODEL_2_COILED_SQUEEZE_EXPANSION,
          caseId: "CASE_2A_BULLISH_SQUEEZE_RELEASE",
          direction: 1,
          entryPrice: curClose,
          stopLoss,
          tp1,
          tp2,
          rrRatio: 3.2,
          invalidationPrice: squeeze.midline,
          reason: `Coiled Squeeze (${squeeze.squeezeBars} bars) fired Long with Value Acceptance above Prior POC (${yesterdayTpo ? yesterdayTpo.tpoPoc.toFixed(2) : "IB_MID"}).`,
        };
      }

      // Case 2B: Bearish Volatility Expansion Breakout (Accepted below Prior TPO POC!)
      if (curClose < squeeze.kcLower && curClose < prevClose && squeeze.isMomentumExpanding && isBelowAuctionValue) {
        const stopDistance = Math.max(atr * 0.5, squeeze.midline - curClose);
        const stopLoss = curClose + stopDistance;
        const tp1 = curClose - stopDistance * 1.5;
        const tp2 = curClose - stopDistance * 3.2;

        return {
          modelId: MODELS.MODEL_2_COILED_SQUEEZE_EXPANSION,
          caseId: "CASE_2B_BEARISH_SQUEEZE_RELEASE",
          direction: -1,
          entryPrice: curClose,
          stopLoss,
          tp1,
          tp2,
          rrRatio: 3.2,
          invalidationPrice: squeeze.midline,
          reason: `Coiled Squeeze (${squeeze.squeezeBars} bars) fired Short with Value Acceptance below Prior POC (${yesterdayTpo ? yesterdayTpo.tpoPoc.toFixed(2) : "IB_MID"}).`,
        };
      }
    }
  }

  // -------------------------------------------------------------------------
  // MODEL 3: UNFINISHED AUCTION SWEEP (POOR HIGH / POOR LOW MAGNET RUN)
  // -------------------------------------------------------------------------
  // Best in: Active session when a Poor High or Poor Low was flagged earlier
  if (biasState.allowedModels.includes(MODELS.MODEL_3_UNFINISHED_AUCTION_SWEEP)) {
    // Case 3A: Poor High Magnet Run (Unfinished Auction above price)
    if (tpoProfile.isPoorHigh && tpoProfile.poorHighPrice) {
      const distanceToPoorHigh = tpoProfile.poorHighPrice - curClose;
      // Price must be approaching the Poor High within 1.8 ATR with bullish momentum
      if (distanceToPoorHigh > atr * 0.5 && distanceToPoorHigh < atr * 2.5 && curClose > prevClose) {
        const stopDistance = Math.max(atr * 0.4, curClose - curLow + atr * 0.15);
        const stopLoss = curClose - stopDistance;
        const tp1 = curClose + stopDistance * 1.4;
        const tp2 = tpoProfile.poorHighPrice + atr * 0.2; // Target sweeping through the Poor High

        const rrRatio = (tp2 - curClose) / stopDistance;
        if (rrRatio >= 2.2) {
          return {
            modelId: MODELS.MODEL_3_UNFINISHED_AUCTION_SWEEP,
            caseId: "CASE_3A_POOR_HIGH_SWEEP_RUN",
            direction: 1,
            entryPrice: curClose,
            stopLoss,
            tp1,
            tp2,
            rrRatio: Math.round(rrRatio * 100) / 100,
            invalidationPrice: curLow - atr * 0.15,
            reason: `Targeting Unfinished Auction (Poor High at ${tpoProfile.poorHighPrice.toFixed(2)}).`,
          };
        }
      }
    }

    // Case 3B: Poor Low Magnet Run (Unfinished Auction below price)
    if (tpoProfile.isPoorLow && tpoProfile.poorLowPrice) {
      const distanceToPoorLow = curClose - tpoProfile.poorLowPrice;
      if (distanceToPoorLow > atr * 0.5 && distanceToPoorLow < atr * 2.5 && curClose < prevClose) {
        const stopDistance = Math.max(atr * 0.4, curHigh - curClose + atr * 0.15);
        const stopLoss = curClose + stopDistance;
        const tp1 = curClose - stopDistance * 1.4;
        const tp2 = tpoProfile.poorLowPrice - atr * 0.2;

        const rrRatio = (curClose - tp2) / stopDistance;
        if (rrRatio >= 2.2) {
          return {
            modelId: MODELS.MODEL_3_UNFINISHED_AUCTION_SWEEP,
            caseId: "CASE_3B_POOR_LOW_SWEEP_RUN",
            direction: -1,
            entryPrice: curClose,
            stopLoss,
            tp1,
            tp2,
            rrRatio: Math.round(rrRatio * 100) / 100,
            invalidationPrice: curHigh + atr * 0.15,
            reason: `Targeting Unfinished Auction (Poor Low at ${tpoProfile.poorLowPrice.toFixed(2)}).`,
          };
        }
      }
    }
  }

  return null;
}
