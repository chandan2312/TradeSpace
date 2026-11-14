/**
 * lib/autonomous_system2/models.js
 *
 * Orthogonal Institutional Quantitative Execution Models
 * Blended with Tactical Chart Price Action & Market Structure:
 * 1. Model A: Institutional VWAP & Value Reversion (Inventory Exhaustion Fade + Liquidity Sweep)
 * 2. Model B: Steidlmayer 80% Rule (Value Area Traversal + Boundary Liquidity Raid Reclaim)
 * 3. Model C: Initiative Value Migration & Retest (P/b-Shape Trend Retest + Micro-FVG / Displacement)
 * 4. Model D: Initial Balance (IB) Failed Auction Trap (IB Range Raid Reclaim)
 *
 * NOTE: 100% self-contained. Zero external dependencies or imports from System 1.
 */

import { MODELS, QUANT_THRESHOLDS } from "./constants.js";
import { classifyAuctionTime } from "./timeEngine.js";
import {
  findSwingFractals,
  detectLiquiditySweep,
  detectDisplacement,
  detectRecentFairValueGaps,
  findOverlappingFVG,
  findStructuralStopAnchor,
} from "./priceActionEngine.js";

/**
 * Evaluates all institutional models against the current bar, market microstructure, and chart price action.
 * @param {Array<object>} bars - Recent historical bars (M15)
 * @param {object} tpoProfile - Current session TPO topology profile
 * @param {object} vwapState - Current session VWAP state
 * @param {object} scenarioState - Sovereign Auction Scenario from scenarios.js
 * @param {number} atr - Current 14-period ATR
 * @param {object} yesterdayTpo - Previous session TPO profile
 * @param {object} macroContext - Macro daily open, prior day high/low
 * @returns {object|null} Signal object if a model triggers, or null
 */
export function evaluateExecutionModels(
  bars,
  tpoProfile,
  vwapState,
  scenarioState,
  atr,
  yesterdayTpo = null,
  macroContext = {}
) {
  if (!bars || bars.length < 5 || !tpoProfile || !vwapState) return null;

  const { dailyOpen = null, priorDayHigh = null, priorDayLow = null } = macroContext;
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

  // Tactical Chart Price Action Primitives
  const fractals = findSwingFractals(bars, 3);
  const bullSweep = detectLiquiditySweep(bars, fractals, 1, 3);
  const bearSweep = detectLiquiditySweep(bars, fractals, -1, 3);
  const bullDisplacement = detectDisplacement(currentBar, atr, 1);
  const bearDisplacement = detectDisplacement(currentBar, atr, -1);
  const activeFvgs = detectRecentFairValueGaps(bars, 15);

  // =========================================================================
  // MODEL A: INSTITUTIONAL VWAP MEAN REVERSION (INVENTORY EXHAUSTION FADE)
  // =========================================================================
  if (allowed.includes(MODELS.MODEL_VWAP_MEAN_REVERSION)) {
    const { vwap, upper1, upper2, lower1, lower2 } = vwapState;

    // Case A1: Bearish Fade (Probed above +2.0σ VWAP OR probed +1.0σ with Liquidity Sweep of Swing High)
    const isStandardProbe = curHigh >= upper2 && curClose < upper2;
    const isSweepProbe = curHigh >= upper1 + atr * 0.15 && bearSweep.swept && curClose < bearSweep.sweptLevel;
    const hasBearishRejection = upperWickPct >= 0.18 || bearDisplacement.hasDisplacement || curClose < curOpen;
    const isDailyShortAligned = !dailyOpen || curClose <= dailyOpen || upperWickPct >= 0.30 || bearSweep.swept;

    if (isDailyShortAligned && (isStandardProbe || isSweepProbe) && hasBearishRejection) {
      const structuralHigh = findStructuralStopAnchor(bars, fractals, -1, 6);
      const sweepExtreme = Math.max(curHigh, prevHigh, bearSweep.extreme ?? curHigh, structuralHigh);
      const stopDistance = Math.max(atr * 0.35, (sweepExtreme - curClose) + atr * 0.18);
      const stopLoss = curClose + stopDistance;

      const tp1 = vwap; // Primary Target: Institutional Fair Value (Session VWAP)
      const tp2 = lower1; // Secondary Target: Opposite 1σ Band

      const potentialProfit = curClose - tp1;
      const rrRatio = potentialProfit / stopDistance;

      if (rrRatio >= QUANT_THRESHOLDS.MIN_RR_RATIO || (curClose - tp2) / stopDistance >= 1.8) {
        return {
          modelId: MODELS.MODEL_VWAP_MEAN_REVERSION,
          caseId: bearSweep.swept ? "CASE_A1_SWEEP_VWAP_EXHAUSTION_FADE" : "CASE_A1_BEARISH_VWAP_2SIGMA_EXHAUSTION_FADE",
          direction: -1,
          time: currentBar.time ?? currentBar.t,
          entryPrice: curClose,
          stopLoss,
          tp1,
          tp2,
          rrRatio: Math.round(((curClose - tp2) / stopDistance) * 100) / 100,
          invalidationPrice: sweepExtreme,
          reason: `Inventory Exhaustion Fade Short: ${bearSweep.swept ? `Swept swing high at ${bearSweep.sweptLevel.toFixed(2)}` : `Probed +2.0σ VWAP (${upper2.toFixed(2)})`} with rejection wick (${(upperWickPct * 100).toFixed(0)}%). Target: Session VWAP (${vwap.toFixed(2)}).`,
          priceAction: {
            hasSweep: bearSweep.swept,
            sweptLevel: bearSweep.sweptLevel,
            hasDisplacement: bearDisplacement.hasDisplacement,
            bodyRatio: bearDisplacement.bodyRatio,
            hasFvgConfluence: false,
            structuralAnchor: sweepExtreme,
          },
        };
      }
    }

    // Case A2: Bullish Fade (Probed below -2.0σ VWAP OR probed -1.0σ with Liquidity Sweep of Swing Low)
    const isStandardLongProbe = curLow <= lower2 && curClose > lower2;
    const isSweepLongProbe = curLow <= lower1 - atr * 0.15 && bullSweep.swept && curClose > bullSweep.sweptLevel;
    const hasBullishRejection = lowerWickPct >= 0.18 || bullDisplacement.hasDisplacement || curClose > curOpen;
    const isDailyLongAligned = !dailyOpen || curClose >= dailyOpen || lowerWickPct >= 0.30 || bullSweep.swept;

    if (isDailyLongAligned && (isStandardLongProbe || isSweepLongProbe) && hasBullishRejection) {
      const structuralLow = findStructuralStopAnchor(bars, fractals, 1, 6);
      const sweepExtreme = Math.min(curLow, prevLow, bullSweep.extreme ?? curLow, structuralLow);
      const stopDistance = Math.max(atr * 0.35, (curClose - sweepExtreme) + atr * 0.18);
      const stopLoss = curClose - stopDistance;

      const tp1 = vwap; // Primary Target: Institutional Fair Value (Session VWAP)
      const tp2 = upper1; // Secondary Target: Opposite 1σ Band

      const potentialProfit = tp1 - curClose;
      const rrRatio = potentialProfit / stopDistance;

      if (rrRatio >= QUANT_THRESHOLDS.MIN_RR_RATIO || (tp2 - curClose) / stopDistance >= 1.8) {
        return {
          modelId: MODELS.MODEL_VWAP_MEAN_REVERSION,
          caseId: bullSweep.swept ? "CASE_A2_SWEEP_VWAP_EXHAUSTION_FADE" : "CASE_A2_BULLISH_VWAP_2SIGMA_EXHAUSTION_FADE",
          direction: 1,
          time: currentBar.time ?? currentBar.t,
          entryPrice: curClose,
          stopLoss,
          tp1,
          tp2,
          rrRatio: Math.round(((tp2 - curClose) / stopDistance) * 100) / 100,
          invalidationPrice: sweepExtreme,
          reason: `Inventory Exhaustion Fade Long: ${bullSweep.swept ? `Swept swing low at ${bullSweep.sweptLevel.toFixed(2)}` : `Probed -2.0σ VWAP (${lower2.toFixed(2)})`} with rejection wick (${(lowerWickPct * 100).toFixed(0)}%). Target: Session VWAP (${vwap.toFixed(2)}).`,
          priceAction: {
            hasSweep: bullSweep.swept,
            sweptLevel: bullSweep.sweptLevel,
            hasDisplacement: bullDisplacement.hasDisplacement,
            bodyRatio: bullDisplacement.bodyRatio,
            hasFvgConfluence: false,
            structuralAnchor: sweepExtreme,
          },
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
    // Sweet Blend: Either 2 closed bars inside VAL OR a single-bar Liquidity Sweep of VAL/Swing Low with reclaim!
    const isProbedBelowVal = (tpoProfile.sessionLow < yVal || prevLow < yVal - atr * 0.1 || curLow < yVal) && rf > -4;
    const isStandardInsideVal = curClose > yVal && prevClose > yVal && curClose < yPoc;
    const isSweepReclaimVal = bullSweep.swept && curLow < yVal && curClose > yVal && curClose < yPoc;
    const hasLowerRejection = tpoProfile.hasLowerExcess || lowerWickPct >= 0.15 || bullDisplacement.hasDisplacement || bullSweep.swept;

    if (hasLowerRejection && isProbedBelowVal && (isStandardInsideVal || isSweepReclaimVal)) {
      const structuralLow = findStructuralStopAnchor(bars, fractals, 1, 6);
      const sweepExtreme = Math.min(curLow, prevLow, thirdLow, tpoProfile.sessionLow ?? curLow, structuralLow);
      const stopDistance = Math.max(atr * 0.40, (curClose - sweepExtreme) + atr * 0.20);
      const stopLoss = curClose - stopDistance;

      const tp1 = yPoc; // Equilibrium Fair Value
      const tp2 = yVah; // Full Value Area Traversal (The 80% Rule Destination)

      const potentialProfit = tp2 - curClose;
      const rrRatio = potentialProfit / stopDistance;

      if (rrRatio >= 1.6 && tp1 > curClose && tp2 > tp1) {
        return {
          modelId: MODELS.STEIDLMAYER_80_PERCENT_RULE,
          caseId: isSweepReclaimVal ? "CASE_B1_SWEEP_80_PCT_RULE_REENTRY" : "CASE_B1_BULLISH_80_PCT_RULE_REENTRY",
          direction: 1,
          time: currentBar.time ?? currentBar.t,
          entryPrice: curClose,
          stopLoss,
          tp1,
          tp2,
          rrRatio: Math.round(rrRatio * 100) / 100,
          invalidationPrice: sweepExtreme,
          reason: `Steidlmayer 80% Rule Long: ${isSweepReclaimVal ? "Liquidity sweep below VAL reclaimed" : "Acceptance inside Prior Value Area"} above VAL (${yVal.toFixed(2)}). Target: ${tp2.toFixed(2)}.`,
          priceAction: {
            hasSweep: bullSweep.swept,
            sweptLevel: bullSweep.sweptLevel,
            hasDisplacement: bullDisplacement.hasDisplacement,
            bodyRatio: bullDisplacement.bodyRatio,
            hasFvgConfluence: false,
            structuralAnchor: sweepExtreme,
          },
        };
      }
    }

    // Case B2: Bearish Value Area Re-entry (Acceptance below VAH)
    // Sweet Blend: Either 2 closed bars inside VAH OR a single-bar Liquidity Sweep of VAH/Swing High with reclaim!
    const isProbedAboveVah = (tpoProfile.sessionHigh > yVah || prevHigh > yVah + atr * 0.1 || curHigh > yVah) && rf < 4;
    const isStandardInsideVah = curClose < yVah && prevClose < yVah && curClose > yPoc;
    const isSweepReclaimVah = bearSweep.swept && curHigh > yVah && curClose < yVah && curClose > yPoc;
    const hasUpperRejection = tpoProfile.hasUpperExcess || upperWickPct >= 0.15 || bearDisplacement.hasDisplacement || bearSweep.swept;

    if (hasUpperRejection && isProbedAboveVah && (isStandardInsideVah || isSweepReclaimVah)) {
      const structuralHigh = findStructuralStopAnchor(bars, fractals, -1, 6);
      const sweepExtreme = Math.max(curHigh, prevHigh, thirdHigh, tpoProfile.sessionHigh ?? curHigh, structuralHigh);
      const stopDistance = Math.max(atr * 0.40, (sweepExtreme - curClose) + atr * 0.20);
      const stopLoss = curClose + stopDistance;

      const tp1 = yPoc;
      const tp2 = yVal;

      const potentialProfit = curClose - tp2;
      const rrRatio = potentialProfit / stopDistance;

      if (rrRatio >= 1.6 && tp1 < curClose && tp2 < tp1) {
        return {
          modelId: MODELS.STEIDLMAYER_80_PERCENT_RULE,
          caseId: isSweepReclaimVah ? "CASE_B2_SWEEP_80_PCT_RULE_REENTRY" : "CASE_B2_BEARISH_80_PCT_RULE_REENTRY",
          direction: -1,
          time: currentBar.time ?? currentBar.t,
          entryPrice: curClose,
          stopLoss,
          tp1,
          tp2,
          rrRatio: Math.round(rrRatio * 100) / 100,
          invalidationPrice: sweepExtreme,
          reason: `Steidlmayer 80% Rule Short: ${isSweepReclaimVah ? "Liquidity sweep above VAH reclaimed" : "Acceptance inside Prior Value Area"} below VAH (${yVah.toFixed(2)}). Target: ${tp2.toFixed(2)}.`,
          priceAction: {
            hasSweep: bearSweep.swept,
            sweptLevel: bearSweep.sweptLevel,
            hasDisplacement: bearDisplacement.hasDisplacement,
            bodyRatio: bearDisplacement.bodyRatio,
            hasFvgConfluence: false,
            structuralAnchor: sweepExtreme,
          },
        };
      }
    }
  }

  // =========================================================================
  // MODEL C: INITIATIVE VALUE MIGRATION & RETEST (P-SHAPE / B-SHAPE TREND)
  // =========================================================================
  if (allowed.includes(MODELS.MODEL_INITIATIVE_VALUE_RETEST)) {
    const { tpoPoc, sessionHigh, sessionLow, ibMid = 0 } = tpoProfile;
    const { vwap } = vwapState;

    // Case C1: Bullish Initiative Retest (P-Shape: Pullback to Developing POC/VWAP + FVG / Displacement)
    if (scenarioState.masterBias === "BULLISH_TREND") {
      const isAboveDailyOpen = !dailyOpen || curClose >= dailyOpen;
      const supportLevel = Math.max(vwap, tpoPoc);
      const isRetestingSupport = curLow <= supportLevel + atr * 0.40 && prevLow <= supportLevel + atr * 0.40;
      const isSupportHolding = curClose >= supportLevel - atr * 0.20 && curClose >= (ibMid || supportLevel);
      const overlappingFvg = findOverlappingFVG(supportLevel, activeFvgs, 1, atr * 0.35);
      const isConfirmedBounce =
        curClose > prevHigh ||
        (lowerWickPct >= 0.20 && curClose > curOpen) ||
        (bullDisplacement.hasDisplacement && curClose > curOpen);

      if (isAboveDailyOpen && isRetestingSupport && isSupportHolding && isConfirmedBounce) {
        const pullbackLow = Math.min(curLow, prevLow);
        const stopDistance = Math.max(atr * 0.45, (curClose - pullbackLow) + atr * 0.25);
        const stopLoss = curClose - stopDistance;

        const tp1 = curClose + stopDistance * 1.8;
        const tp2 = curClose + stopDistance * 3.2;

        const potentialProfit = tp2 - curClose;
        const rrRatio = potentialProfit / stopDistance;

        if (rrRatio >= 2.0 && tp1 > curClose) {
          return {
            modelId: MODELS.MODEL_INITIATIVE_VALUE_RETEST,
            caseId: overlappingFvg ? "CASE_C1_FVG_VALUE_MIGRATION_RETEST" : "CASE_C1_BULLISH_VALUE_MIGRATION_RETEST",
            direction: 1,
            time: currentBar.time ?? currentBar.t,
            entryPrice: curClose,
            stopLoss,
            tp1,
            tp2,
            rrRatio: Math.round(rrRatio * 100) / 100,
            invalidationPrice: pullbackLow,
            reason: `Initiative Value Retest Long: P-Shape buyer initiative confirmed above Daily Open. Retested Developing POC/VWAP (${supportLevel.toFixed(2)})${overlappingFvg ? " with FVG support" : ""} at discount. Target: ${tp1.toFixed(2)}.`,
            priceAction: {
              hasSweep: bullSweep.swept,
              sweptLevel: bullSweep.sweptLevel,
              hasDisplacement: bullDisplacement.hasDisplacement,
              bodyRatio: bullDisplacement.bodyRatio,
              hasFvgConfluence: Boolean(overlappingFvg),
              structuralAnchor: pullbackLow,
            },
          };
        }
      }
    }

    // Case C2: Bearish Initiative Retest (b-Shape: Pullback to Developing POC/VWAP + FVG / Displacement)
    if (scenarioState.masterBias === "BEARISH_TREND") {
      const isBelowDailyOpen = !dailyOpen || curClose <= dailyOpen;
      const resistanceLevel = Math.min(vwap, tpoPoc);
      const isRetestingResistance = curHigh >= resistanceLevel - atr * 0.40 && prevHigh >= resistanceLevel - atr * 0.40;
      const isResistanceHolding = curClose <= resistanceLevel + atr * 0.20 && curClose <= (ibMid || resistanceLevel);
      const overlappingFvg = findOverlappingFVG(resistanceLevel, activeFvgs, -1, atr * 0.35);
      const isConfirmedRoll =
        curClose < prevLow ||
        (upperWickPct >= 0.20 && curClose < curOpen) ||
        (bearDisplacement.hasDisplacement && curClose < curOpen);

      if (isBelowDailyOpen && isRetestingResistance && isResistanceHolding && isConfirmedRoll) {
        const pullbackHigh = Math.max(curHigh, prevHigh);
        const stopDistance = Math.max(atr * 0.45, (pullbackHigh - curClose) + atr * 0.25);
        const stopLoss = curClose + stopDistance;

        const tp1 = curClose - stopDistance * 1.8;
        const tp2 = curClose - stopDistance * 3.2;

        const potentialProfit = curClose - tp2;
        const rrRatio = potentialProfit / stopDistance;

        if (rrRatio >= 2.0 && tp1 < curClose) {
          return {
            modelId: MODELS.MODEL_INITIATIVE_VALUE_RETEST,
            caseId: overlappingFvg ? "CASE_C2_FVG_VALUE_MIGRATION_RETEST" : "CASE_C2_BEARISH_VALUE_MIGRATION_RETEST",
            direction: -1,
            time: currentBar.time ?? currentBar.t,
            entryPrice: curClose,
            stopLoss,
            tp1,
            tp2,
            rrRatio: Math.round(rrRatio * 100) / 100,
            invalidationPrice: pullbackHigh,
            reason: `Initiative Value Retest Short: b-Shape seller initiative confirmed below Daily Open. Retested Developing POC/VWAP (${resistanceLevel.toFixed(2)})${overlappingFvg ? " with FVG resistance" : ""} at premium. Target: ${tp1.toFixed(2)}.`,
            priceAction: {
              hasSweep: bearSweep.swept,
              sweptLevel: bearSweep.sweptLevel,
              hasDisplacement: bearDisplacement.hasDisplacement,
              bodyRatio: bearDisplacement.bodyRatio,
              hasFvgConfluence: Boolean(overlappingFvg),
              structuralAnchor: pullbackHigh,
            },
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

    // Case D1: Bearish Failed Auction High (Trapped Breakout Buyers + Swing Sweep)
    if ((tpoProfile.hasUpperExcess || upperWickPct >= 0.22 || bearSweep.swept) && rotationFactor < 3) {
      const sweptIbHigh = curHigh > ibHigh || prevHigh > ibHigh || (bearSweep.swept && bearSweep.sweptLevel >= ibHigh - atr * 0.1);
      const closedBelowIbHigh = curClose < ibHigh;
      const isBearishTrapWick = upperWickPct >= 0.20 || curClose < curOpen;

      if (sweptIbHigh && closedBelowIbHigh && isBearishTrapWick) {
        const structuralHigh = findStructuralStopAnchor(bars, fractals, -1, 6);
        const sweepExtreme = Math.max(curHigh, prevHigh, bearSweep.extreme ?? curHigh, structuralHigh);
        const stopDistance = Math.max(atr * 0.35, (sweepExtreme - curClose) + atr * 0.18);
        const stopLoss = curClose + stopDistance;

        const tp1 = tpoPoc && tpoPoc < curClose ? tpoPoc : ibMid;
        const tp2 = tpoProfile.poorLowPrice && tpoProfile.poorLowPrice < curClose ? tpoProfile.poorLowPrice : ibLow;

        const potentialProfit = curClose - tp2;
        const rrRatio = potentialProfit / stopDistance;

        if (rrRatio >= 1.8 && tp1 < curClose && tp2 < tp1) {
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
            reason: `Trapped buyers at IB High (${ibHigh.toFixed(2)})${bearSweep.swept ? ` + swept swing high at ${bearSweep.sweptLevel.toFixed(2)}` : ""}. Target: ${tp2.toFixed(2)}.`,
            priceAction: {
              hasSweep: bearSweep.swept,
              sweptLevel: bearSweep.sweptLevel,
              hasDisplacement: bearDisplacement.hasDisplacement,
              bodyRatio: bearDisplacement.bodyRatio,
              hasFvgConfluence: false,
              structuralAnchor: sweepExtreme,
            },
          };
        }
      }
    }

    // Case D2: Bullish Failed Auction Low (Trapped Breakout Sellers + Swing Sweep)
    if ((tpoProfile.hasLowerExcess || lowerWickPct >= 0.22 || bullSweep.swept) && rotationFactor > -3) {
      const sweptIbLow = curLow < ibLow || prevLow < ibLow || (bullSweep.swept && bullSweep.sweptLevel <= ibLow + atr * 0.1);
      const closedAboveIbLow = curClose > ibLow;
      const isBullishTrapWick = lowerWickPct >= 0.20 || curClose > curOpen;

      if (sweptIbLow && closedAboveIbLow && isBullishTrapWick) {
        const structuralLow = findStructuralStopAnchor(bars, fractals, 1, 6);
        const sweepExtreme = Math.min(curLow, prevLow, bullSweep.extreme ?? curLow, structuralLow);
        const stopDistance = Math.max(atr * 0.35, (curClose - sweepExtreme) + atr * 0.18);
        const stopLoss = curClose - stopDistance;

        const tp1 = tpoPoc && tpoPoc > curClose ? tpoPoc : ibMid;
        const tp2 = tpoProfile.poorHighPrice && tpoProfile.poorHighPrice > curClose ? tpoProfile.poorHighPrice : ibHigh;

        const potentialProfit = tp2 - curClose;
        const rrRatio = potentialProfit / stopDistance;

        if (rrRatio >= 1.8 && tp1 > curClose && tp2 > tp1) {
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
            reason: `Trapped sellers at IB Low (${ibLow.toFixed(2)})${bullSweep.swept ? ` + swept swing low at ${bullSweep.sweptLevel.toFixed(2)}` : ""}. Target: ${tp2.toFixed(2)}.`,
            priceAction: {
              hasSweep: bullSweep.swept,
              sweptLevel: bullSweep.sweptLevel,
              hasDisplacement: bullDisplacement.hasDisplacement,
              bodyRatio: bullDisplacement.bodyRatio,
              hasFvgConfluence: false,
              structuralAnchor: sweepExtreme,
            },
          };
        }
      }
    }
  }

  return null;
}
