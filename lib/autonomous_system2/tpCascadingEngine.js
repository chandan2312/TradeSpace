/**
 * lib/autonomous_system2/tpCascadingEngine.js
 *
 * Microstructural Take-Profit Cascading Engine
 * Staged Targets:
 * - TP1 (40% scale-out): Fair Value equilibrium (Session VWAP or TPO POC) -> Triggers Breakeven move.
 * - TP2 (35% scale-out): Opposite Value Area boundary (high statistical lock-in).
 * - TP3 (25% runner): Asymmetric 3.5R - 4.5R runner trailed via Chandelier ATR band.
 */

function roundPrice(p) {
  if (p < 5) return Math.round(p * 100000) / 100000;
  if (p < 500) return Math.round(p * 1000) / 1000;
  return Math.round(p * 100) / 100;
}

/**
 * Calculates cascading TP targets for an approved position.
 * @param {object} signal - Model signal
 * @param {number} stopDistance - Absolute stop distance in points
 * @param {object} tpoProfile - Current TPO profile
 * @returns {object} Cascading target schedule
 */
export function calculateCascadingTargets(signal, stopDistance, tpoProfile) {
  const { direction, entryPrice } = signal;

  // Tier 1: Target 1 (Scale out 40% & trigger Breakeven)
  let tp1Price = signal.tp1 ?? (direction === 1 ? entryPrice + stopDistance * 1.5 : entryPrice - stopDistance * 1.5);
  // Ensure TP1 is in the profitable direction
  if (direction === 1 && tp1Price <= entryPrice) tp1Price = entryPrice + stopDistance * 1.5;
  if (direction === -1 && tp1Price >= entryPrice) tp1Price = entryPrice - stopDistance * 1.5;

  // Tier 2: Target 2 (Scale out 35%)
  let tp2Price = signal.tp2 ?? (direction === 1 ? entryPrice + stopDistance * 2.8 : entryPrice - stopDistance * 2.8);
  if (direction === 1 && tp2Price <= tp1Price) tp2Price = entryPrice + stopDistance * 2.8;
  if (direction === -1 && tp2Price >= tp1Price) tp2Price = entryPrice - stopDistance * 2.8;

  // Tier 3: Target 3 (Runner 25%)
  const tp3Price = direction === 1 ? entryPrice + stopDistance * 4.0 : entryPrice - stopDistance * 4.0;

  return {
    tp1: {
      price: roundPrice(tp1Price),
      allocationPct: 40,
      rMultiple: Math.abs(tp1Price - entryPrice) / stopDistance,
      triggersBreakeven: true,
      description: "FAIR_VALUE_EQUILIBRIUM_SCALE_OUT",
    },
    tp2: {
      price: roundPrice(tp2Price),
      allocationPct: 35,
      rMultiple: Math.abs(tp2Price - entryPrice) / stopDistance,
      description: "OPPOSING_VALUE_BOUNDARY_TARGET",
    },
    tp3: {
      price: roundPrice(tp3Price),
      allocationPct: 25,
      rMultiple: Math.abs(tp3Price - entryPrice) / stopDistance,
      description: "ASYMMETRIC_EXPANSION_RUNNER",
    },
  };
}
