/**
 * lib/autonomous_quant/redecisionEngine.js
 *
 * System #2 In-Flight Structural Redecision Engine
 * Monitors open trades against real-time market regime flips and TPO structural shifts.
 * Protects capital by executing proactive risk tightening or early exits when trade thesis is broken.
 */

import { REGIMES, TPO_DAY_TYPES } from "./constants.js";

/**
 * Re-evaluates an active trade against the newest market state.
 * @param {object} trade - Active trade
 * @param {object} biasState - Current market bias state
 * @param {object} tpoProfile - Current session TPO profile
 * @param {object} bar - Current bar
 * @returns {object} { shouldExitEarly: boolean, shouldTightenStop: boolean, newStopPrice: number, reason: string }
 */
export function redecideOpenTrade(trade, biasState, tpoProfile, bar) {
  if (!trade || trade.status === "CLOSED") {
    return { shouldExitEarly: false, shouldTightenStop: false };
  }

  const curClose = bar.close ?? bar.c;

  // Case 1: Adverse Volatility Squeeze Fired Against Open Trade
  // If we are Long, but a high-energy Squeeze just fired BEARISH, the thesis is shattered.
  const squeeze = biasState.regimeInfo?.squeezeInfo;
  if (squeeze && squeeze.squeezeFired) {
    if (trade.direction === 1 && squeeze.fireDirection === -1) {
      return {
        shouldExitEarly: true,
        shouldTightenStop: false,
        reason: "ADVERSE_BEARISH_SQUEEZE_EXPLOSION: Hostile volatility expansion fired against Long position.",
      };
    } else if (trade.direction === -1 && squeeze.fireDirection === 1) {
      return {
        shouldExitEarly: true,
        shouldTightenStop: false,
        reason: "ADVERSE_BULLISH_SQUEEZE_EXPLOSION: Hostile volatility expansion fired against Short position.",
      };
    }
  }

  // Case 2: Model 1 Failed Auction Trap Failed to Reverse (Trend Day Expansion)
  // If we took a Model 1 fade, but the day is officially declared a TREND_DAY (IB extension > 2.2x),
  // do NOT fight the trend! Tighten stop immediately to minimize damage.
  if (trade.modelId === "MODEL_1_IB_FAILED_AUCTION_TRAP" && tpoProfile?.dayType === TPO_DAY_TYPES.TREND_DAY) {
    if (trade.direction === 1 && curClose < tpoProfile.ibLow) {
      return {
        shouldExitEarly: true,
        shouldTightenStop: false,
        reason: "FAILED_AUCTION_INVALIDATION: Market accepted into one-sided Trend Day below IB Low.",
      };
    } else if (trade.direction === -1 && curClose > tpoProfile.ibHigh) {
      return {
        shouldExitEarly: true,
        shouldTightenStop: false,
        reason: "FAILED_AUCTION_INVALIDATION: Market accepted into one-sided Trend Day above IB High.",
      };
    }
  }

  // Case 3: Hurst Exponent Degraded into Pure Noise (Loss of Statistical Momentum)
  // If trade has been running for > 8 bars, has not hit TP1, and Hurst dropped to 0.50 (random walk),
  // tighten stop to cut risk in half.
  if (trade.barsHeld >= 8 && !trade.tp1Hit && biasState.regimeInfo?.regime === REGIMES.RANDOM_WALK_NOISE) {
    const halfRiskStop = (trade.entryPrice + trade.currentStopLoss) / 2;
    return {
      shouldExitEarly: false,
      shouldTightenStop: true,
      newStopPrice: Math.round(halfRiskStop * 100) / 100,
      reason: "RANDOM_WALK_DEFENSE: Hurst collapsed into noise without reaching TP1. Risk halved.",
    };
  }

  return { shouldExitEarly: false, shouldTightenStop: false };
}
