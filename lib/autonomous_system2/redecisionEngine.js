/**
 * lib/autonomous_system2/redecisionEngine.js
 *
 * Microstructural In-Flight Redecision Engine
 * Continuously audits open positions against real-time auction structure flips.
 * Protects capital by executing proactive early exits when the structural thesis is invalidated.
 */

import { TOPOLOGY_SHAPES, MODELS } from "./constants.js";

/**
 * Re-evaluates an active trade against the newest auction state.
 * @param {object} trade - Active trade object
 * @param {object} scenarioState - Current scenario state
 * @param {object} tpoProfile - Current TPO profile
 * @param {object} vwapState - Current VWAP state
 * @param {object} bar - Current closed bar
 * @returns {object} { shouldExitEarly: boolean, shouldTightenStop: boolean, newStopPrice: number, reason: string }
 */
export function redecideOpenTrade(trade, scenarioState, tpoProfile, vwapState, bar) {
  if (!trade || trade.status === "CLOSED") {
    return { shouldExitEarly: false, shouldTightenStop: false };
  }

  const curClose = bar.close ?? bar.c;

  // Case 1: Mean Reversion / Fade Invalidation (Hostile Trend Day Expansion)
  // If we took a fade (VWAP reversion or 80% Rule), but the market printed a full TRENDING_AUCTION
  // with one-sided extension, do NOT hold through trend days!
  const isFadeModel =
    trade.modelId === MODELS.MODEL_VWAP_MEAN_REVERSION ||
    trade.modelId === MODELS.STEIDLMAYER_80_PERCENT_RULE ||
    trade.modelId === MODELS.MODEL_IB_FAILED_AUCTION_TRAP;

  if (isFadeModel && tpoProfile?.topology === TOPOLOGY_SHAPES.TRENDING_AUCTION) {
    if (trade.direction === 1 && curClose < tpoProfile.ibLow) {
      return {
        shouldExitEarly: true,
        shouldTightenStop: false,
        reason: "TRENDING_AUCTION_INVALIDATION: One-sided trend day expansion broke out below IB Low against Long fade.",
      };
    } else if (trade.direction === -1 && curClose > tpoProfile.ibHigh) {
      return {
        shouldExitEarly: true,
        shouldTightenStop: false,
        reason: "TRENDING_AUCTION_INVALIDATION: One-sided trend day expansion broke out above IB High against Short fade.",
      };
    }
  }

  // Case 2: Initiative Value Retest Invalidation (Broken VWAP Support/Resistance)
  // If we are Long on value retest, but price accepted below Session VWAP, the initiative buyers failed.
  if (trade.modelId === MODELS.MODEL_INITIATIVE_VALUE_RETEST && vwapState) {
    if (trade.direction === 1 && curClose < vwapState.lower1) {
      return {
        shouldExitEarly: true,
        shouldTightenStop: false,
        reason: "VWAP_SUPPORT_COLLAPSE: Price accepted below -1.0σ VWAP band, invalidating buyer initiative.",
      };
    } else if (trade.direction === -1 && curClose > vwapState.upper1) {
      return {
        shouldExitEarly: true,
        shouldTightenStop: false,
        reason: "VWAP_RESISTANCE_BREACH: Price accepted above +1.0σ VWAP band, invalidating seller initiative.",
      };
    }
  }

  return { shouldExitEarly: false, shouldTightenStop: false };
}
