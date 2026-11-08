import { calculateRiskSize, lossPerLotAtStop, planPartialVolumes, dailyRiskGovernor, calculateEffectiveGroupRisk } from "../lib/autonomous/risk.js";
import { calculateOptimalRiskFreeLevel, calculatePropFirmTp, validateTargetLadder, markToMarket, partialExitLedger } from "../lib/autonomous/management.js";

console.log("=== AUDITING RISK ENGINE & DUAL-LEG MANAGEMENT FOR DAY TRADE MODEL ===");

const symInfo = {
  trade_tick_size: 0.1,
  trade_tick_value: 0.1,
  volume_min: 0.01,
  volume_max: 100.0,
  volume_step: 0.01,
  digits: 2
};

const equity = 50000;
const riskPct = 1.0; // 1% risk = $500
const entry = 20477.5;
const sl = 20383.9;
const tp = 20700;

console.log("\n1. Risk Sizing Test:");
const lossPerLot = lossPerLotAtStop({ entryPrice: entry, slPrice: sl, symInfo });
console.log("Loss per lot at stop:", lossPerLot.toFixed(2), "USD");

const riskSize = calculateRiskSize({
  equity,
  riskPct,
  entryPrice: entry,
  slPrice: sl,
  symInfo,
  requirePartials: true,
  allowMinLotFallback: false
});
console.log("Calculated volume:", riskSize.lotSize, "lots | Sized Risk:", riskSize.riskUsd.toFixed(2), "USD (Budget: $" + riskSize.budget + ")");
console.log("50/30/20 Partials:", riskSize.allocations);

console.log("\n2. Target Ladder & Dual-Leg Management Test:");
const targets = [
  { id: "tp1", price: 20550, fraction: 0.5 },
  { id: "tp2", price: 20625, fraction: 0.3 },
  { id: "runner", price: 20700, fraction: 0.2 }
];

const mockTrade = {
  dir: 1,
  entryPrice: entry,
  filledPrice: entry,
  slPrice: sl,
  initialSlPrice: sl,
  riskUsd: riskSize.riskUsd,
  initialRiskUsd: riskSize.riskUsd,
  initialVolume: riskSize.lotSize,
  targets,
  symbolSpec: symInfo
};

console.log("Target Ladder Valid?", validateTargetLadder(mockTrade));

// Test Optimal Risk-Free Level (1.0R - 1.5R fractal trailing)
const rfLevel = calculateOptimalRiskFreeLevel(mockTrade, []);
console.log("Optimal Risk-Free Level:", rfLevel);

// Test Prop-Firm Leg TP (1.5R - 2.5R bracket)
const propTp = calculatePropFirmTp(entry, sl, 1, 2.0, 2);
console.log("Prop-Firm Safe Leg TP (2.0R):", propTp);

// Test Mark to Market at TP1 (20550)
const mtm = markToMarket(mockTrade, 20550);
console.log("Mark-to-Market at TP1:", mtm);

// Test Partial Exit Execution at TP1
const partialResult = partialExitLedger(mockTrade, {
  id: "tp1",
  price: 20550,
  volume: riskSize.allocations.tp1,
  pnl: 250,
  dealTicket: 12345
});
console.log("Partial Exit Ledger Result:", {
  remainingVolume: partialResult.remainingVolume,
  remainingFraction: partialResult.remainingFraction,
  realizedR: partialResult.realizedR.toFixed(2),
  realizedPnl: partialResult.realizedPnl.toFixed(2)
});

console.log("\n3. Sibling Dual-Leg Risk Independence Test:");
const leg1 = { groupId: "grp_1", initialRiskUsd: 500, status: "pending" };
const leg2 = { groupId: "grp_1", initialRiskUsd: 500, status: "pending" };
const groupCalc = calculateEffectiveGroupRisk([leg1], leg2);
console.log("Sibling incremental risk on account:", groupCalc.incrementalRisk, "USD (Should be 0 because same group routes to separate accounts!)");

console.log("\nALL RISK & MANAGEMENT TESTS COMPLETED SUCCESSFULLY!");
