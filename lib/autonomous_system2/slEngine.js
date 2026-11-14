/**
 * lib/autonomous_quant/slEngine.js
 *
 * System #2 Structural Stop Loss Engine
 * Places non-arbitrary, structure-backed stop losses tucked behind institutional rejection extremes.
 */

import { MODELS } from "./constants.js";

/**
 * Calculates the authoritative Stop Loss price for an approved setup.
 * @param {object} signal - Model signal
 * @param {Array<object>} bars - Recent bars
 * @param {number} atr - 14 ATR
 * @param {number} spreadPts - Current broker spread
 * @returns {object} { stopLossPrice, stopDistancePoints, bufferApplied }
 */
export function calculateStructuralStopLoss(signal, bars, atr = 10, spreadPts = 1.5) {
  const { direction, entryPrice, modelId, invalidationPrice } = signal;
  const currentBar = bars[bars.length - 1];
  const prevBar = bars.length >= 2 ? bars[bars.length - 2] : currentBar;

  let baseLevel = invalidationPrice ?? entryPrice;
  let dynamicBuffer = atr * 0.20; // Default 20% ATR structural buffer

  switch (modelId) {
    case MODELS.STEIDLMAYER_80_PERCENT_RULE:
    case MODELS.MODEL_1_IB_FAILED_AUCTION_TRAP: {
      // For Model 1: Tuck stop behind the absolute highest/lowest point of the sweep
      if (direction === 1) {
        // Long: Stop below lowest sweep wick
        const lowestWick = Math.min(currentBar.low ?? currentBar.l, prevBar.low ?? prevBar.l, baseLevel);
        baseLevel = lowestWick;
        dynamicBuffer = Math.max(spreadPts * 1.5, atr * 0.18);
        const stopLossPrice = baseLevel - dynamicBuffer;
        return {
          stopLossPrice: Math.round(stopLossPrice * 100) / 100,
          stopDistancePoints: Math.abs(entryPrice - stopLossPrice),
          bufferApplied: dynamicBuffer,
          levelType: "SWEEP_EXTREME_LOW_BUFFER",
        };
      } else {
        // Short: Stop above highest sweep wick
        const highestWick = Math.max(currentBar.high ?? currentBar.h, prevBar.high ?? prevBar.h, baseLevel);
        baseLevel = highestWick;
        dynamicBuffer = Math.max(spreadPts * 1.5, atr * 0.18);
        const stopLossPrice = baseLevel + dynamicBuffer;
        return {
          stopLossPrice: Math.round(stopLossPrice * 100) / 100,
          stopDistancePoints: Math.abs(stopLossPrice - entryPrice),
          bufferApplied: dynamicBuffer,
          levelType: "SWEEP_EXTREME_HIGH_BUFFER",
        };
      }
    }

    case MODELS.MODEL_2_COILED_SQUEEZE_EXPANSION: {
      // For Model 2: Stop placed behind the Keltner Midline (SMA20)
      dynamicBuffer = atr * 0.15;
      if (direction === 1) {
        const stopLossPrice = baseLevel - dynamicBuffer;
        return {
          stopLossPrice: Math.round(stopLossPrice * 100) / 100,
          stopDistancePoints: Math.abs(entryPrice - stopLossPrice),
          bufferApplied: dynamicBuffer,
          levelType: "KELTNER_MIDLINE_SUPPORT",
        };
      } else {
        const stopLossPrice = baseLevel + dynamicBuffer;
        return {
          stopLossPrice: Math.round(stopLossPrice * 100) / 100,
          stopDistancePoints: Math.abs(stopLossPrice - entryPrice),
          bufferApplied: dynamicBuffer,
          levelType: "KELTNER_MIDLINE_RESISTANCE",
        };
      }
    }

    case MODELS.MODEL_3_UNFINISHED_AUCTION_SWEEP:
    default: {
      dynamicBuffer = atr * 0.20;
      const stopLossPrice = direction === 1 ? baseLevel - dynamicBuffer : baseLevel + dynamicBuffer;
      return {
        stopLossPrice: Math.round(stopLossPrice * 100) / 100,
        stopDistancePoints: Math.abs(entryPrice - stopLossPrice),
        bufferApplied: dynamicBuffer,
        levelType: "PULLBACK_SWING_PIVOT",
      };
    }
  }
}
