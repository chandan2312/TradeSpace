/**
 * lib/autonomous_quant/tpCascadingEngine.js
 *
 * System #2 Take-Profit Cascading Engine
 * Implements institutional multi-tier target staging:
 * - TP1 (40% scale-out): TPO POC / Center of Gravity (triggers Breakeven move)
 * - TP2 (35% scale-out): Opposing Value Area boundary (high probability lock-in)
 * - TP3 (25% runner): Trailed via dynamic Chandelier ATR band for 4R-6R+ asymmetric home runs.
 */

/**
 * Calculates cascading TP targets for an approved position.
 * @param {object} signal - Model signal
 * @param {number} stopDistance - Absolute stop distance in points
 * @param {object} tpoProfile - TPO profile
 * @returns {object} Cascading target schedule
 */
export function calculateCascadingTargets(signal, stopDistance, tpoProfile) {
  const { direction, entryPrice } = signal;

  // Tier 1: Target 1 (Scale out 40% & trigger Breakeven)
  // Anchored to TPO POC if favorably located, otherwise 1.5R
  let tp1Price = direction === 1 ? entryPrice + stopDistance * 1.5 : entryPrice - stopDistance * 1.5;
  if (tpoProfile && tpoProfile.tpoPoc) {
    const poc = tpoProfile.tpoPoc;
    if (direction === 1 && poc > entryPrice && poc < entryPrice + stopDistance * 2.2) {
      tp1Price = poc;
    } else if (direction === -1 && poc < entryPrice && poc > entryPrice - stopDistance * 2.2) {
      tp1Price = poc;
    }
  }

  // Tier 2: Target 2 (Scale out 35%)
  // Anchored to opposing Value boundary (VAH/VAL) or 2.8R
  let tp2Price = direction === 1 ? entryPrice + stopDistance * 2.8 : entryPrice - stopDistance * 2.8;
  if (tpoProfile) {
    if (direction === 1 && tpoProfile.vah > tp1Price) {
      tp2Price = tpoProfile.vah;
    } else if (direction === -1 && tpoProfile.val < tp1Price) {
      tp2Price = tpoProfile.val;
    }
  }

  // Tier 3: Target 3 (Runner 25%)
  // Asymmetric 4.5R target or dynamic runner
  const tp3Price = direction === 1 ? entryPrice + stopDistance * 4.5 : entryPrice - stopDistance * 4.5;

  return {
    tp1: {
      price: Math.round(tp1Price * 100) / 100,
      allocationPct: 40,
      rMultiple: Math.abs(tp1Price - entryPrice) / stopDistance,
      triggersBreakeven: true,
      description: "TPO_POC_OR_1.5R_SCALE_OUT",
    },
    tp2: {
      price: Math.round(tp2Price * 100) / 100,
      allocationPct: 35,
      rMultiple: Math.abs(tp2Price - entryPrice) / stopDistance,
      description: "OPPOSING_VALUE_BOUNDARY_2.8R",
    },
    tp3: {
      price: Math.round(tp3Price * 100) / 100,
      allocationPct: 25,
      rMultiple: Math.abs(tp3Price - entryPrice) / stopDistance,
      description: "ASYMMETRIC_EXPANSION_RUNNER_4.5R",
    },
  };
}
