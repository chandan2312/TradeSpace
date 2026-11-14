/**
 * lib/autonomous_system2/vwapEngine.js
 *
 * Institutional Anchored Volume-Weighted Average Price (VWAP) & Statistical Bands Engine
 * Replaces arbitrary moving averages with true volume-clearing benchmarks.
 * Evaluates:
 * - Session VWAP (μ): Center of gravity for institutional execution algorithms (POV/TWAP/VWAP).
 * - Statistical Standard Deviation Bands (±1σ, ±2σ, ±3σ).
 * - Probes beyond ±2.0σ identify statistical inventory exhaustion / liquidation extremes.
 */

import { QUANT_THRESHOLDS } from "./constants.js";

/**
 * Calculates Anchored Session VWAP and standard deviation bands for a sequence of session bars.
 * @param {Array<object>} sessionBars - M15 bars belonging to the current trading session
 * @param {number} atr - 14-period ATR for fallback volume weighting if volume is synthetic
 * @returns {object} { vwap, upper1, lower1, upper2, lower2, upper3, lower3, stdDev, isExhaustedUpper, isExhaustedLower }
 */
export function calculateSessionVwap(sessionBars, atr = 10) {
  if (!sessionBars || sessionBars.length === 0) {
    return null;
  }

  let cumVolume = 0;
  let cumTypicalVolume = 0;
  const priceData = [];

  for (let i = 0; i < sessionBars.length; i++) {
    const bar = sessionBars[i];
    const high = bar.high ?? bar.h;
    const low = bar.low ?? bar.l;
    const close = bar.close ?? bar.c;
    const rawVol = bar.volume ?? bar.v ?? bar.tick_volume ?? 0;

    // Typical price: (H + L + C) / 3
    const typicalPrice = (high + low + close) / 3;

    // Real volume or synthetic liquidity proxy (range / ATR normalized)
    const effectiveVol = rawVol > 0 ? rawVol : Math.max(1, Math.round(((high - low) / Math.max(1e-5, atr * 0.05)) * 100));

    cumTypicalVolume += typicalPrice * effectiveVol;
    cumVolume += effectiveVol;

    priceData.push({ typicalPrice, effectiveVol });
  }

  if (cumVolume <= 0) return null;

  const vwap = cumTypicalVolume / cumVolume;

  // Calculate volume-weighted variance
  let cumVariance = 0;
  for (let i = 0; i < priceData.length; i++) {
    const diff = priceData[i].typicalPrice - vwap;
    cumVariance += priceData[i].effectiveVol * (diff * diff);
  }

  const variance = cumVariance / cumVolume;
  const stdDev = Math.sqrt(Math.max(1e-8, variance));

  const upper1 = vwap + QUANT_THRESHOLDS.VWAP_SIGMA_1 * stdDev;
  const lower1 = vwap - QUANT_THRESHOLDS.VWAP_SIGMA_1 * stdDev;
  const upper2 = vwap + QUANT_THRESHOLDS.VWAP_SIGMA_2 * stdDev;
  const lower2 = vwap - QUANT_THRESHOLDS.VWAP_SIGMA_2 * stdDev;
  const upper3 = vwap + QUANT_THRESHOLDS.VWAP_SIGMA_3 * stdDev;
  const lower3 = vwap - QUANT_THRESHOLDS.VWAP_SIGMA_3 * stdDev;

  const latestBar = sessionBars[sessionBars.length - 1];
  const curClose = latestBar.close ?? latestBar.c;
  const curHigh = latestBar.high ?? latestBar.h;
  const curLow = latestBar.low ?? latestBar.l;

  return {
    vwap: Math.round(vwap * 100000) / 100000,
    upper1: Math.round(upper1 * 100000) / 100000,
    lower1: Math.round(lower1 * 100000) / 100000,
    upper2: Math.round(upper2 * 100000) / 100000,
    lower2: Math.round(lower2 * 100000) / 100000,
    upper3: Math.round(upper3 * 100000) / 100000,
    lower3: Math.round(lower3 * 100000) / 100000,
    stdDev: Math.round(stdDev * 100000) / 100000,
    // Statistical Exhaustion Flags: Probing into 2nd/3rd standard deviation bands
    isProbedAbove2Sigma: curHigh >= upper2,
    isProbedBelow2Sigma: curLow <= lower2,
    isAcceptedInside2Sigma: curClose < upper2 && curClose > lower2,
    cumVolume,
  };
}
