/**
 * lib/autonomous_quant/regimeEngine.js
 *
 * System #2 Quantitative Regime & Volatility Squeeze Engine
 * 1. Rolling Rescaled Range (R/S) Hurst Exponent (H) for persistent trend vs. mean-reverting vs. noise.
 * 2. Volatility Compression / Squeeze Meter (Bollinger Band compression inside Keltner Channels).
 * 3. Parkinson Extreme-Value Volatility (Pure OHLC High-to-Low efficiency).
 */

import { REGIMES, QUANT_THRESHOLDS } from "./constants.js";

/**
 * Calculates rolling Hurst Exponent using Rescaled Range (R/S) analysis.
 * @param {Array<number>} prices - Array of close prices (typically length >= 100)
 * @returns {number} Hurst exponent H (0.0 to 1.0)
 */
export function calculateHurstExponent(prices) {
  const N = prices.length;
  if (N < 30) return 0.50; // Default to random walk if insufficient data

  // 1. Calculate log returns
  const returns = [];
  for (let i = 1; i < N; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }

  const numReturns = returns.length;
  const meanReturn = returns.reduce((acc, val) => acc + val, 0) / numReturns;

  // 2. Mean-adjusted cumulative deviations
  let cumDev = 0;
  let maxDev = -Infinity;
  let minDev = Infinity;
  let sumSqDiff = 0;

  for (let i = 0; i < numReturns; i++) {
    const diff = returns[i] - meanReturn;
    cumDev += diff;
    if (cumDev > maxDev) maxDev = cumDev;
    if (cumDev < minDev) minDev = cumDev;
    sumSqDiff += diff * diff;
  }

  // 3. Range R and Standard Deviation S
  const R = maxDev - minDev;
  const S = Math.sqrt(sumSqDiff / numReturns);

  if (S <= 1e-12 || R <= 1e-12) return 0.50;

  // 4. Hurst Exponent: (R / S) = c * N^H  => H = ln(R / S) / ln(N)
  // Adjusted for finite sample bias
  const RS = R / S;
  const H = Math.log(RS) / Math.log(numReturns * 0.5);

  // Clamp within realistic bounds [0.05, 0.95]
  return Math.max(0.05, Math.min(0.95, H));
}

/**
 * Calculates Parkinson Extreme-Value Volatility (5x more efficient than close-to-close).
 * Formula: sigma_P = sqrt( 1 / (4 * ln(2) * N) * sum( (ln(H/L))^2 ) )
 */
export function calculateParkinsonVolatility(bars) {
  const N = bars.length;
  if (N < 5) return 0;

  let sumLogSq = 0;
  for (let i = 0; i < N; i++) {
    const high = bars[i].high ?? bars[i].h;
    const low = Math.max(1e-6, bars[i].low ?? bars[i].l);
    const hlRatio = Math.log(high / low);
    sumLogSq += hlRatio * hlRatio;
  }

  const factor = 1 / (4 * Math.log(2) * N);
  return Math.sqrt(factor * sumLogSq);
}

/**
 * Calculates Average True Range (ATR).
 */
export function calculateAtr(bars, period = 14) {
  if (!bars || bars.length < 2) return 1e-4;
  const N = Math.min(bars.length, period + 1);
  let trSum = 0;

  for (let i = bars.length - N + 1; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    const curH = cur.high ?? cur.h;
    const curL = cur.low ?? cur.l;
    const prevC = prev.close ?? prev.c;

    const tr = Math.max(
      curH - curL,
      Math.abs(curH - prevC),
      Math.abs(curL - prevC)
    );
    trSum += tr;
  }

  return trSum / (N - 1);
}

/**
 * Evaluates Volatility Compression (Bollinger Bands inside Keltner Channels).
 * @param {Array<object>} bars - Historical bars (length >= 25)
 * @returns {object} Squeeze state & metrics
 */
export function evaluateVolatilitySqueeze(bars) {
  const period = QUANT_THRESHOLDS.BOLLINGER_PERIOD;
  if (!bars || bars.length < period + 5) {
    return {
      isSqueezeOn: false,
      squeezeBars: 0,
      squeezeFired: false,
      fireDirection: 0,
      momentumSlope: 0,
    };
  }

  const closes = bars.slice(-period).map((b) => b.close ?? b.c);
  const currentBar = bars[bars.length - 1];
  const previousBar = bars[bars.length - 2];

  // 1. Bollinger Bands (20 SMA, 2.0 stddev)
  const sma20 = closes.reduce((a, b) => a + b, 0) / period;
  const variance = closes.reduce((acc, c) => acc + (c - sma20) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  const bbUpper = sma20 + QUANT_THRESHOLDS.BOLLINGER_STDDEV * stdDev;
  const bbLower = sma20 - QUANT_THRESHOLDS.BOLLINGER_STDDEV * stdDev;

  // 2. Keltner Channels (20 EMA, 1.5 ATR)
  const atr = calculateAtr(bars, 20);
  const kcUpper = sma20 + QUANT_THRESHOLDS.KELTNER_ATR_MULT * atr;
  const kcLower = sma20 - QUANT_THRESHOLDS.KELTNER_ATR_MULT * atr;

  // 3. Squeeze Detection: BB inside KC
  const currentSqueezeOn = bbUpper <= kcUpper && bbLower >= kcLower;

  // Count consecutive squeeze bars prior to current bar (optimized O(1) ATR reuse)
  let squeezeBars = 0;
  for (let offset = 1; offset <= 15; offset++) {
    const startIdx = bars.length - period - offset;
    if (startIdx < 0) break;
    const windowCloses = bars.slice(startIdx, bars.length - offset).map((b) => b.close ?? b.c);
    const windowSma = windowCloses.reduce((a, b) => a + b, 0) / period;
    const windowVar = windowCloses.reduce((acc, c) => acc + (c - windowSma) ** 2, 0) / period;
    const windowStd = Math.sqrt(windowVar);
    const windowBbU = windowSma + QUANT_THRESHOLDS.BOLLINGER_STDDEV * windowStd;
    const windowBbL = windowSma - QUANT_THRESHOLDS.BOLLINGER_STDDEV * windowStd;
    const windowKcU = windowSma + QUANT_THRESHOLDS.KELTNER_ATR_MULT * atr;
    const windowKcL = windowSma - QUANT_THRESHOLDS.KELTNER_ATR_MULT * atr;

    if (windowBbU <= windowKcU && windowBbL >= windowKcL) {
      squeezeBars++;
    } else {
      break;
    }
  }

  // Squeeze Fired: was in squeeze for >= 4 bars, now breaking out on this exact bar!
  const squeezeFired = squeezeBars >= 4 && !currentSqueezeOn;
  let fireDirection = 0; // 1 = Bullish expansion, -1 = Bearish expansion
  if (squeezeFired) {
    const curC = currentBar.close ?? currentBar.c;
    fireDirection = curC > sma20 ? 1 : -1;
  }

  // Scan backwards up to 6 bars to detect recent squeeze firing and track impulse extremes
  let recentSqueezeFire = false;
  let recentFireDirection = 0;
  let barsSinceFire = -1;
  let impulseHigh = -Infinity;
  let impulseLow = Infinity;
  let accumulatedSqueezeBars = squeezeBars;

  if (squeezeFired) {
    recentSqueezeFire = true;
    recentFireDirection = fireDirection;
    barsSinceFire = 0;
    impulseHigh = currentBar.high ?? currentBar.h;
    impulseLow = currentBar.low ?? currentBar.l;
  } else {
    for (let lb = 1; lb <= 6; lb++) {
      const barIdx = bars.length - 1 - lb;
      if (barIdx < period + 6) break;

      const subCloses = bars.slice(barIdx - period + 1, barIdx + 1).map((b) => b.close ?? b.c);
      const subSma = subCloses.reduce((a, b) => a + b, 0) / period;
      const subVar = subCloses.reduce((acc, c) => acc + (c - subSma) ** 2, 0) / period;
      const subStd = Math.sqrt(subVar);
      const subBbU = subSma + QUANT_THRESHOLDS.BOLLINGER_STDDEV * subStd;
      const subBbL = subSma - QUANT_THRESHOLDS.BOLLINGER_STDDEV * subStd;
      const subKcU = subSma + QUANT_THRESHOLDS.KELTNER_ATR_MULT * atr;
      const subKcL = subSma - QUANT_THRESHOLDS.KELTNER_ATR_MULT * atr;
      const wasSqueezeOnAtSub = subBbU <= subKcU && subBbL >= subKcL;

      if (!wasSqueezeOnAtSub) {
        let subSqBars = 0;
        for (let o = 1; o <= 12; o++) {
          const sIdx = barIdx - period - o + 1;
          if (sIdx < 0) break;
          const wCloses = bars.slice(sIdx, barIdx - o + 1).map((b) => b.close ?? b.c);
          const wSma = wCloses.reduce((a, b) => a + b, 0) / period;
          const wVar = wCloses.reduce((acc, c) => acc + (c - wSma) ** 2, 0) / period;
          const wStd = Math.sqrt(wVar);
          const wBbU = wSma + QUANT_THRESHOLDS.BOLLINGER_STDDEV * wStd;
          const wBbL = wSma - QUANT_THRESHOLDS.BOLLINGER_STDDEV * wStd;
          const wKcU = wSma + QUANT_THRESHOLDS.KELTNER_ATR_MULT * atr;
          const wKcL = wSma - QUANT_THRESHOLDS.KELTNER_ATR_MULT * atr;
          if (wBbU <= wKcU && wBbL >= wKcL) {
            subSqBars++;
          } else {
            break;
          }
        }

        if (subSqBars >= 4) {
          recentSqueezeFire = true;
          const fireC = bars[barIdx].close ?? bars[barIdx].c;
          recentFireDirection = fireC > subSma ? 1 : -1;
          barsSinceFire = lb;
          accumulatedSqueezeBars = subSqBars;
          const impulseSlice = bars.slice(barIdx);
          impulseHigh = Math.max(...impulseSlice.map((b) => b.high ?? b.h));
          impulseLow = Math.min(...impulseSlice.map((b) => b.low ?? b.l));
          break;
        }
      }
    }
  }

  // 4. John Carter TTM Momentum Oscillator
  // Delta from dynamic Donchian/SMA baseline
  const recentBars = bars.slice(-period);
  const highest20 = Math.max(...recentBars.map((b) => b.high ?? b.h));
  const lowest20 = Math.min(...recentBars.map((b) => b.low ?? b.l));
  const baseline = ((highest20 + lowest20) / 2 + sma20) / 2;
  const currentDelta = (currentBar.close ?? currentBar.c) - baseline;

  // Linear regression slope of delta over 10 periods
  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  const regN = Math.min(10, bars.length - 1);
  for (let k = 0; k < regN; k++) {
    const idx = bars.length - regN + k;
    const cK = bars[idx].close ?? bars[idx].c;
    const yK = cK - baseline;
    sumX += k; sumY += yK; sumXX += k * k; sumXY += k * yK;
  }
  const meanX = sumX / regN;
  const meanY = sumY / regN;
  const varX = sumXX / regN - meanX * meanX;
  const covXY = sumXY / regN - meanX * meanY;
  const momentumSlope = varX > 1e-12 ? covXY / varX : 0;
  const isMomentumExpanding = fireDirection === 1 ? momentumSlope > 0 : momentumSlope < 0;

  return {
    isSqueezeOn: currentSqueezeOn,
    squeezeBars: currentSqueezeOn ? squeezeBars + 1 : squeezeBars,
    squeezeFired,
    fireDirection,
    recentSqueezeFire,
    recentFireDirection,
    barsSinceFire,
    impulseHigh,
    impulseLow,
    accumulatedSqueezeBars,
    bbUpper,
    bbLower,
    kcUpper,
    kcLower,
    midline: sma20,
    momentumSlope: Math.round(momentumSlope * 100) / 100,
    isMomentumExpanding,
    atr,
  };
}

/**
 * Master Regime Assessment combining Hurst Exponent and Volatility Squeeze.
 */
export function assessMarketRegime(bars) {
  if (!bars || bars.length < 50) {
    return {
      regime: REGIMES.RANDOM_WALK_NOISE,
      hurst: 0.50,
      isTradeable: false,
      reason: "INSUFFICIENT_BARS",
      parkinsonVol: 0,
      squeezeInfo: {
        isSqueezeOn: false,
        squeezeBars: 0,
        squeezeFired: false,
        fireDirection: 0,
        momentumSlope: 0,
      },
    };
  }

  const closes = bars.slice(-QUANT_THRESHOLDS.HURST_LOOKBACK_BARS).map((b) => b.close ?? b.c);
  const hurst = calculateHurstExponent(closes);
  const squeezeInfo = evaluateVolatilitySqueeze(bars);
  const parkinsonVol = calculateParkinsonVolatility(bars.slice(-30));

  let regime = REGIMES.RANDOM_WALK_NOISE;
  let isTradeable = true;

  if (squeezeInfo.isSqueezeOn) {
    regime = REGIMES.VOLATILITY_SQUEEZE;
  } else if (hurst > QUANT_THRESHOLDS.HURST_TREND_THRESHOLD) {
    regime = REGIMES.TREND_PERSISTENT;
  } else if (hurst < QUANT_THRESHOLDS.HURST_MEAN_REV_THRESHOLD) {
    regime = REGIMES.MEAN_REVERTING;
  } else {
    // 0.45 <= H <= 0.55 = Pure random noise / chop
    regime = REGIMES.RANDOM_WALK_NOISE;
    isTradeable = false; // The Prop Firm Shield halts trading!
  }

  return {
    regime,
    hurst: Math.round(hurst * 1000) / 1000,
    isTradeable,
    parkinsonVol: Math.round(parkinsonVol * 10000) / 10000,
    squeezeInfo,
  };
}
