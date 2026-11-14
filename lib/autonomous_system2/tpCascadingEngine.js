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

  // Tier 1: Target 1 (Structural Equilibrium - VWAP, POC, or 1.5R fallback)
  let tp1Price = signal.tp1 ?? (direction === 1 ? entryPrice + stopDistance * 1.5 : entryPrice - stopDistance * 1.5);
  // Ensure TP1 is in the profitable direction
  if (direction === 1 && tp1Price <= entryPrice) tp1Price = entryPrice + stopDistance * 1.5;
  if (direction === -1 && tp1Price >= entryPrice) tp1Price = entryPrice - stopDistance * 1.5;

  // Tier 2: Target 2 (Opposite Value Area boundary or 2.8R expansion)
  let tp2Price = signal.tp2 ?? (direction === 1 ? entryPrice + stopDistance * 2.8 : entryPrice - stopDistance * 2.8);
  if (direction === 1 && tp2Price <= tp1Price) tp2Price = entryPrice + stopDistance * 2.8;
  if (direction === -1 && tp2Price >= tp1Price) tp2Price = entryPrice - stopDistance * 2.8;

  // Tier 3: Target 3 (Runner 4.0R)
  const tp3Price = direction === 1 ? entryPrice + stopDistance * 4.0 : entryPrice - stopDistance * 4.0;

  const rMult1 = Math.round((Math.abs(tp1Price - entryPrice) / stopDistance) * 100) / 100;
  const rMult2 = Math.round((Math.abs(tp2Price - entryPrice) / stopDistance) * 100) / 100;
  const rMult3 = Math.round((Math.abs(tp3Price - entryPrice) / stopDistance) * 100) / 100;

  return {
    tp1: {
      price: roundPrice(tp1Price),
      allocationPct: 50,
      rMultiple: rMult1,
      triggersBreakeven: true,
      description: "STRUCTURAL_FAIR_VALUE_EQUILIBRIUM",
    },
    tp2: {
      price: roundPrice(tp2Price),
      allocationPct: 35,
      rMultiple: rMult2,
      description: "OPPOSING_VALUE_EXPANSION",
    },
    tp3: {
      price: roundPrice(tp3Price),
      allocationPct: 15,
      rMultiple: rMult3,
      description: "ASYMMETRIC_EXPANSION_RUNNER",
    },
  };
}
