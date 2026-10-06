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

export function calculateRiskSize({ equity, riskPct, riskUsd, entryPrice, slPrice, symInfo = {}, lossPerLot, requirePartials = false }) {
  const budget = riskUsd !== undefined ? Number(riskUsd) : Number(equity) * Number(riskPct) / 100;
  const min = Number(symInfo.volume_min), max = Number(symInfo.volume_max), step = Number(symInfo.volume_step);
  const loss = lossPerLotAtStop({ entryPrice, slPrice, symInfo, lossPerLot });
  const zero = (reason) => ({ lotSize: 0, riskUsd: 0, budget, lossPerLot: loss, allocations: null, reason });
  if (!positive(budget) || !positive(loss) || !positive(min) || !positive(max) || !positive(step) || max < min) return zero("Invalid risk budget, stop, or broker specification");
  let volume = floorVolume(Math.min(budget / loss, max), step);
  if (requirePartials) volume = floorVolume(volume, step * 10);
  if (volume < min || volume * loss > budget + 1e-8) return zero("Minimum lot exceeds risk budget");
  const allocations = requirePartials ? planPartialVolumes(volume, symInfo) : null;
  if (requirePartials && !allocations) return zero("50/30/20 partial allocation not feasible at broker minimum/step");
  return { lotSize: volume, riskUsd: volume * loss, budget, lossPerLot: loss, allocations, reason: null };
}

export function dailyRiskGovernor({ startEquity, equity, realizedPnl = 0, maxDailyLossPct, reservedRisk = 0, newRisk = 0 }) {
  if (![startEquity, equity, maxDailyLossPct].every(positive)) return { permitted: false, reason: "Daily equity baseline unavailable" };
  if (![realizedPnl, reservedRisk, newRisk].every((n) => Number.isFinite(Number(n)))) return { permitted: false, reason: "Daily risk ledger unavailable" };
  const limit = startEquity * maxDailyLossPct / 100;
  const drawdown = Math.max(0, startEquity - equity, -realizedPnl);
  return { permitted: drawdown + Math.max(0, reservedRisk) + Math.max(0, newRisk) < limit, drawdown, limit, remaining: Math.max(0, limit - drawdown - reservedRisk), reason: "Broker-day drawdown/reserved-risk limit" };
}
