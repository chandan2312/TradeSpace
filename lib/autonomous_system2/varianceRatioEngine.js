/**
 * lib/autonomous_system2/varianceRatioEngine.js
 *
 * Lo-MacKinlay Variance Ratio (VR) Microstructure Engine
 * Rigorous econometric test for random walk vs. mean-reverting vs. momentum regimes.
 *
 * Theory:
 * For a pure random walk, Var(r^k) = k * Var(r^1), giving VR(k) = 1.0.
 * - VR < 0.90: Negative autocorrelation -> Sub-diffusive / Mean-Reverting. Fading extremes has positive edge.
 * - VR > 1.15: Positive autocorrelation -> Super-diffusive / Directional Momentum. Initiative migration has edge.
 * - 0.90 <= VR <= 1.15: Random walk noise.
 */

import { VARIANCE_REGIMES, QUANT_THRESHOLDS } from "./constants.js";

/**
 * Computes the Lo-MacKinlay Variance Ratio for a series of closed bars.
 * @param {Array<object>} bars - Historical bars (typically length >= 60)
 * @param {number} k - Aggregation horizon (default: 4 periods)
 * @returns {object} { varianceRatio, regime, zScore, isTradeable }
 */
export function calculateVarianceRatio(bars, k = QUANT_THRESHOLDS.VARIANCE_RATIO_HORIZON) {
  if (!bars || bars.length < 40) {
    return {
      varianceRatio: 1.0,
      regime: VARIANCE_REGIMES.RANDOM_WALK_BROWNIAN,
      zScore: 0,
      isTradeable: false,
    };
  }

  const closes = bars.slice(-80).map((b) => b.close ?? b.c);
  const n = closes.length;

  // 1. Calculate 1-period log returns
  const r1 = [];
  for (let i = 1; i < n; i++) {
    r1.push(Math.log(closes[i] / closes[i - 1]));
  }
  const n1 = r1.length;
  const mean1 = r1.reduce((a, b) => a + b, 0) / n1;

  // Variance of 1-period returns: sigma_a^2
  let sumSq1 = 0;
  for (let i = 0; i < n1; i++) {
    const diff = r1[i] - mean1;
    sumSq1 += diff * diff;
  }
  const var1 = sumSq1 / (n1 - 1);

  if (var1 <= 1e-12) {
    return {
      varianceRatio: 1.0,
      regime: VARIANCE_REGIMES.RANDOM_WALK_BROWNIAN,
      zScore: 0,
      isTradeable: false,
    };
  }

  // 2. Calculate k-period overlapping log returns
  const rK = [];
  for (let i = k; i < n; i++) {
    rK.push(Math.log(closes[i] / closes[i - k]));
  }
  const nK = rK.length;
  const meanK = k * mean1;

  // Variance of k-period returns: sigma_c^2
  let sumSqK = 0;
  for (let i = 0; i < nK; i++) {
    const diff = rK[i] - meanK;
    sumSqK += diff * diff;
  }
  // Unbiased overlapping sample variance
  const m = k * (n - k + 1) * (1 - k / n);
  const varK = m > 0 ? sumSqK / m : sumSqK / nK;

  // 3. Lo-MacKinlay Variance Ratio: VR(k) = varK / var1
  const rawVr = varK / var1;
  const varianceRatio = Math.max(0.1, Math.min(2.5, rawVr));

  // Asymptotic standard error under homoskedasticity: phi = 2(2k - 1)(k - 1) / (3k * n)
  const phi = (2 * (2 * k - 1) * (k - 1)) / (3 * k * n);
  const se = Math.sqrt(Math.max(1e-8, phi));
  const zScore = (varianceRatio - 1.0) / se;

  let regime = VARIANCE_REGIMES.RANDOM_WALK_BROWNIAN;
  let isTradeable = false;

  if (varianceRatio < 0.90) {
    regime = VARIANCE_REGIMES.SUB_DIFFUSIVE_MEAN_REVERTING;
    isTradeable = true;
  } else if (varianceRatio > 1.15) {
    regime = VARIANCE_REGIMES.SUPER_DIFFUSIVE_MOMENTUM;
    isTradeable = true;
  }

  return {
    varianceRatio: Math.round(varianceRatio * 1000) / 1000,
    regime,
    zScore: Math.round(zScore * 100) / 100,
    isTradeable,
  };
}
