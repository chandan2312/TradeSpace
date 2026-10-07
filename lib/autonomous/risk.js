// Monetary amounts are in the account currency, despite legacy *Usd field names.
const positive = (n) => Number.isFinite(Number(n)) && Number(n) > 0;
export function floorVolume(volume, step) {
  if (!positive(volume) || !positive(step)) return 0;
  return Number((Math.floor(Number(volume) / Number(step) + 1e-9) * Number(step)).toFixed(8));
}

export function lossPerLotAtStop({ entryPrice, slPrice, symInfo = {}, lossPerLot }) {
  if (!positive(entryPrice) || !positive(slPrice) || Number(entryPrice) === Number(slPrice)) return 0;
  if (positive(lossPerLot)) return Number(lossPerLot); // order_calc_profit, converted by broker
  const size = Number(symInfo.trade_tick_size);
  const value = Number(symInfo.trade_tick_value_loss ?? symInfo.trade_tick_value);
  return positive(size) && positive(value) ? Math.abs(entryPrice - slPrice) / size * value : 0;
}

// Exact original-volume 50/30/20 allocations, never rounded up or dust remainders.
export function planPartialVolumes(volume, symInfo = {}) {
  const step = Number(symInfo.volume_step), min = Number(symInfo.volume_min);
  if (!positive(volume) || !positive(step) || !positive(min)) return null;
  const parts = [0.5, 0.3, 0.2].map((fraction) => Number((volume * fraction).toFixed(8)));
  if (parts.some((part) => part < min - 1e-9 || Math.abs(part / step - Math.round(part / step)) > 1e-7)) return null;
  return { tp1: parts[0], tp2: parts[1], runner: parts[2] };
}

export function calculateRiskSize({ equity, riskPct, riskUsd, entryPrice, slPrice, symInfo = {}, lossPerLot, requirePartials = false, allowMinLotFallback = false }) {
  const budget = riskUsd !== undefined ? Number(riskUsd) : Number(equity) * Number(riskPct) / 100;
  const min = Number(symInfo.volume_min), max = Number(symInfo.volume_max), step = Number(symInfo.volume_step);
  const loss = lossPerLotAtStop({ entryPrice, slPrice, symInfo, lossPerLot });
  const zero = (reason) => ({ lotSize: 0, riskUsd: 0, budget, lossPerLot: loss, allocations: null, reason });
  if (!positive(budget) || !positive(loss) || !positive(min) || !positive(max) || !positive(step) || max < min) {
    if (allowMinLotFallback && positive(loss) && positive(min) && positive(max) && positive(step) && max >= min) {
      const fallbackVol = requirePartials ? (floorVolume(Math.max(min, step * 10), step * 10) || min) : min;
      const allocations = requirePartials ? planPartialVolumes(fallbackVol, symInfo) : null;
      return { lotSize: fallbackVol, riskUsd: fallbackVol * loss, budget: fallbackVol * loss, lossPerLot: loss, allocations, reason: null };
    }
    return zero("Invalid risk budget, stop, or broker specification");
  }
  let volume = floorVolume(Math.min(budget / loss, max), step);
  if (requirePartials) volume = floorVolume(volume, step * 10);
  if (volume < min || volume * loss > budget + 1e-8) {
    if (allowMinLotFallback && positive(min)) {
      volume = min;
      if (requirePartials) volume = floorVolume(Math.max(min, step * 10), step * 10) || min;
    } else {
      return zero("Minimum lot exceeds risk budget");
    }
  }
  const allocations = requirePartials ? planPartialVolumes(volume, symInfo) : null;
  if (requirePartials && !allocations) {
    if (!allowMinLotFallback) return zero("50/30/20 partial allocation not feasible at broker minimum/step");
  }
  return { lotSize: volume, riskUsd: volume * loss, budget, lossPerLot: loss, allocations, reason: null };
}

export function dailyRiskGovernor({ startEquity, equity, realizedPnl = 0, maxDailyLossPct, reservedRisk = 0, newRisk = 0, partitioned = false }) {
  if (![startEquity, equity, maxDailyLossPct].every(positive)) return { permitted: false, reason: "Daily equity baseline unavailable" };
  if (![realizedPnl, reservedRisk, newRisk].every((n) => Number.isFinite(Number(n)))) return { permitted: false, reason: "Daily risk ledger unavailable" };
  const limit = startEquity * maxDailyLossPct / 100;
  const drawdown = partitioned ? Math.max(0, -realizedPnl) : Math.max(0, startEquity - equity, -realizedPnl);
  return { permitted: drawdown + Math.max(0, reservedRisk) + Math.max(0, newRisk) < limit, drawdown, limit, remaining: Math.max(0, limit - drawdown - reservedRisk), reason: "Broker-day drawdown/reserved-risk limit" };
}

/**
 * Computes Partitioned Effective Reserved Risk across setup groups.
 * Because sibling legs (Default MG1 vs Prop MG2) route to separate receiver accounts,
 * their risk does not stack additively on any real account.
 * For any setup group, effective risk is max(leg.risk).
 */
export function calculateEffectiveGroupRisk(reservedTrades = [], newTrade = null) {
  const groupRiskMap = new Map();
  let ungroupedRisk = 0;

  for (const t of reservedTrades) {
    const r = Math.max(0, Number(t.initialRiskUsd || t.riskUsd || 0));
    if (t.groupId) {
      groupRiskMap.set(t.groupId, Math.max(groupRiskMap.get(t.groupId) || 0, r));
    } else {
      ungroupedRisk += r;
    }
  }

  // Baseline reserved risk across all existing setups
  let baselineReservedRisk = ungroupedRisk;
  for (const r of groupRiskMap.values()) {
    baselineReservedRisk += r;
  }

  if (!newTrade) {
    return { reservedRisk: baselineReservedRisk, incrementalRisk: 0, totalWithNew: baselineReservedRisk };
  }

  // Calculate incremental risk of newTrade
  const newTradeRisk = Math.max(0, Number(newTrade.initialRiskUsd || newTrade.riskUsd || 0));
  let incrementalRisk = newTradeRisk;

  if (newTrade.groupId && groupRiskMap.has(newTrade.groupId)) {
    // Sibling leg: the group already has risk allocated.
    const existingGroupRisk = groupRiskMap.get(newTrade.groupId);
    incrementalRisk = Math.max(0, newTradeRisk - existingGroupRisk);
  }

  return {
    reservedRisk: baselineReservedRisk,
    incrementalRisk,
    totalWithNew: baselineReservedRisk + incrementalRisk,
  };
}

/**
 * Computes Partitioned Daily Realized PnL for setup groups.
 * Separates streams by management model / receiver leg so that dual legs are not
 * stacked additively into a false 2x daily drawdown.
 * Returns the worst-case receiver stream PnL.
 */
export function calculatePartitionedDailyPnl(trades = [], startDate = null) {
  if (!Array.isArray(trades) || trades.length === 0) return 0;
  const startMs = startDate ? new Date(startDate).getTime() : 0;

  let pnlDefault = 0;
  let pnlProp = 0;
  let pnlStandalone = 0;

  for (const t of trades) {
    let tradePnl = 0;
    if (t.partialExits?.length) {
      tradePnl = t.partialExits
        .filter((e) => !startMs || new Date(e.time).getTime() >= startMs)
        .reduce((sum, e) => sum + Number(e.pnl || 0), 0);
    } else if (!startMs || (t.closedAt && new Date(t.closedAt).getTime() >= startMs)) {
      tradePnl = Number(t.realizedPnl || 0);
    }

    const mgmt = t.managementLogic || (t.legId === "prop_firm" ? "prop_firm_safe" : "milestone_50");
    if (mgmt === "prop_firm_safe") {
      pnlProp += tradePnl;
    } else if (mgmt === "milestone_50" || t.legId === "default") {
      pnlDefault += tradePnl;
    } else {
      pnlStandalone += tradePnl;
    }
  }

  const account1 = pnlDefault + pnlStandalone;
  const account2 = pnlProp + pnlStandalone;

  return Math.min(account1, account2);
}

/**
 * Computes Partitioned Daily Realized R across setup groups.
 * Evaluates realized R per receiver stream (milestone_50 vs prop_firm_safe),
 * returning the worst-case receiver stream R.
 * Sibling legs (Default MG1 vs Prop MG2) route to separate receiver accounts,
 * so their risk and stopouts are never charged additively against the same account.
 */
export function calculatePartitionedDailyR(trades = [], startDate = null) {
  if (!Array.isArray(trades) || trades.length === 0) return 0;
  const startMs = startDate ? new Date(startDate).getTime() : 0;

  let rDefault = 0;
  let rProp = 0;
  let rStandalone = 0;

  for (const t of trades) {
    let tradeR = 0;
    if (t.partialExits?.length) {
      tradeR = t.partialExits
        .filter((e) => !startMs || new Date(e.time).getTime() >= startMs)
        .reduce((sum, e) => sum + Number(e.weightedR || 0), 0);
    } else if (!startMs || (t.closedAt && new Date(t.closedAt).getTime() >= startMs)) {
      tradeR = Number.isFinite(t.realizedR)
        ? Number(t.realizedR)
        : (t.status === "closed_tp" ? Number(t.targetRR || 2) : (t.status === "closed_be" ? 0 : -1));
    }

    const mgmt = t.managementLogic || (t.legId === "prop_firm" ? "prop_firm_safe" : "milestone_50");
    if (mgmt === "prop_firm_safe") {
      rProp += tradeR;
    } else if (mgmt === "milestone_50" || t.legId === "default") {
      rDefault += tradeR;
    } else {
      rStandalone += tradeR;
    }
  }

  const account1 = rDefault + rStandalone;
  const account2 = rProp + rStandalone;

  return Math.min(account1, account2);
}


