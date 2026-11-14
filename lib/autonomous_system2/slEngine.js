/**
 * lib/autonomous_system2/slEngine.js
 *
 * Microstructural Structural Stop Loss Engine
 * Places non-arbitrary, structure-backed stop losses tucked behind institutional rejection extremes.
 */

import { MODELS } from "./constants.js";

function roundPrice(p) {
  if (p < 5) return Math.round(p * 100000) / 100000;
  if (p < 500) return Math.round(p * 1000) / 1000;
  return Math.round(p * 100) / 100;
}

/**
 * Calculates the authoritative Stop Loss price for an approved setup.
 * @param {object} signal - Model signal
 * @param {Array<object>} bars - Recent bars
 * @param {number} atr - 14 ATR
 * @param {number} spreadPts - Current broker spread
 * @returns {object} { stopLossPrice, stopDistancePoints, bufferApplied, levelType }
 */
export function calculateStructuralStopLoss(signal, bars, atr = 10, spreadPts = 1.5) {
  const { direction, entryPrice, modelId, invalidationPrice } = signal;
  const currentBar = bars[bars.length - 1];
  const prevBar = bars.length >= 2 ? bars[bars.length - 2] : currentBar;

  let baseLevel = invalidationPrice ?? entryPrice;
  let dynamicBuffer = Math.max(spreadPts * 2.0, atr * 0.35);

  switch (modelId) {
    case MODELS.MODEL_VWAP_MEAN_REVERSION:
    case MODELS.STEIDLMAYER_80_PERCENT_RULE:
    case MODELS.MODEL_IB_FAILED_AUCTION_TRAP: {
      if (direction === 1) {
        const lowestWick = Math.min(currentBar.low ?? currentBar.l, prevBar.low ?? prevBar.l, baseLevel);
        baseLevel = lowestWick;
        const stopLossPrice = baseLevel - dynamicBuffer;
        return {
          stopLossPrice: roundPrice(stopLossPrice),
          stopDistancePoints: Math.abs(entryPrice - stopLossPrice),
          bufferApplied: dynamicBuffer,
          levelType: "SWEEP_REJECTION_EXTREME_LOW",
        };
      } else {
        const highestWick = Math.max(currentBar.high ?? currentBar.h, prevBar.high ?? prevBar.h, baseLevel);
        baseLevel = highestWick;
        const stopLossPrice = baseLevel + dynamicBuffer;
        return {
          stopLossPrice: roundPrice(stopLossPrice),
          stopDistancePoints: Math.abs(stopLossPrice - entryPrice),
          bufferApplied: dynamicBuffer,
          levelType: "SWEEP_REJECTION_EXTREME_HIGH",
        };
      }
    }

    case MODELS.MODEL_INITIATIVE_VALUE_RETEST:
    default: {
      if (direction === 1) {
        const pullbackLow = Math.min(currentBar.low ?? currentBar.l, prevBar.low ?? prevBar.l, baseLevel);
        baseLevel = pullbackLow;
        const stopLossPrice = baseLevel - dynamicBuffer;
        return {
          stopLossPrice: roundPrice(stopLossPrice),
          stopDistancePoints: Math.abs(entryPrice - stopLossPrice),
          bufferApplied: dynamicBuffer,
          levelType: "PULLBACK_VALUE_SUPPORT_LOW",
        };
      } else {
        const pullbackHigh = Math.max(currentBar.high ?? currentBar.h, prevBar.high ?? prevBar.h, baseLevel);
        baseLevel = pullbackHigh;
        const stopLossPrice = baseLevel + dynamicBuffer;
        return {
          stopLossPrice: roundPrice(stopLossPrice),
          stopDistancePoints: Math.abs(stopLossPrice - entryPrice),
          bufferApplied: dynamicBuffer,
          levelType: "PULLBACK_VALUE_RESISTANCE_HIGH",
        };
      }
    }
  }
}
