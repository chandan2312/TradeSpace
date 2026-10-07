import assert from "node:assert";
import { normalizeJournalRow, calculateJournalKpis } from "./lib/journal/store.js";

console.log("\n=======================================================");
console.log("TEST SUITE: Autonomous Journal Normalizer & KPI Engine");
console.log("=======================================================\n");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`, err);
    process.exit(1);
  }
}

// 1. Normalization of Default Model Trade
test("Normalizes Default Model WIN trade correctly", () => {
  const rawTrade = {
    _id: "60d5ec49f1b2c8b1f8e4e1a1",
    groupId: "grp_NAS100_1_123456",
    legId: "default",
    legLabel: "Default (50% Milestone + Runner)",
    managementLogic: "milestone_50",
    symbol: "NAS100",
    dir: 1,
    status: "closed_tp",
    entryPrice: 20000,
    filledPrice: 20000,
    slPrice: 19900,
    initialSlPrice: 19900,
    tpPrice: 20400,
    exitPrice: 20400,
    targetRR: 4.0,
    realizedR: 4.0,
    peakR: 4.15,
    maxDrawdownR: -0.25,
    initialRiskUsd: 250,
    realizedPnl: 1000,
    lotSize: 1.0,
    scenario: { id: "day", label: "Day Trade (4H-15M)", horizonCode: 2, tf: "15M" },
    entryModel: { id: "ICT_2022_MENTORSHIP", label: "ICT 2022 Mentorship" },
    activeTimeSlot: { label: "New York AM Killzone", session: "NEW YORK" },
    brain: { numericScore: 82, macroBias: "Bullish Expansion" },
    confluenceScore: 88,
    targetLandmark: "4H FVG Consequent Encroachment (CE 50%)",
    magicNumber: 23121101,
    brokerComment: "TS:NAS:15M:M1:MG1:T01",
    createdAt: new Date("2026-10-06T14:30:00Z"),
    filledAt: new Date("2026-10-06T14:35:00Z"),
    closedAt: new Date("2026-10-06T15:45:00Z"),
    isLive: true,
  };

  const row = normalizeJournalRow(rawTrade);

  assert.strictEqual(row.id, "60d5ec49f1b2c8b1f8e4e1a1");
  assert.strictEqual(row.symbol, "NAS100");
  assert.strictEqual(row.dirLabel, "BUY");
  assert.strictEqual(row.outcome, "WIN");
  assert.strictEqual(row.isPropFirm, false);
  assert.strictEqual(row.managementModel, "Default (50% Milestone + Runner)");
  assert.strictEqual(row.realizedR, 4.0);
  assert.strictEqual(row.peakR, 4.15);
  assert.strictEqual(row.maxDrawdownR, -0.25);
  assert.strictEqual(row.durationMinutes, 70);
  assert.strictEqual(row.magicNumber, "23121101");
  assert.strictEqual(row.executionMode, "LIVE");
});

// 2. Normalization of Prop-Firm Safe Model Trade
test("Normalizes Prop-Firm Safe Model trade with landmark & MAE", () => {
  const rawProp = {
    _id: "60d5ec49f1b2c8b1f8e4e1a2",
    groupId: "grp_NAS100_1_123456",
    legId: "prop_firm",
    legLabel: "Prop-Firm Safe (1.5R–2.5R)",
    managementLogic: "prop_firm_safe",
    symbol: "NAS100",
    dir: 1,
    status: "closed_tp",
    entryPrice: 20000,
    filledPrice: 20000,
    slPrice: 19900,
    initialSlPrice: 19900,
    tpPrice: 20185,
    exitPrice: 20185,
    targetRR: 1.85,
    realizedR: 1.85,
    peakR: 1.90,
    maxDrawdownR: -0.15,
    initialRiskUsd: 250,
    realizedPnl: 462.5,
    lotSize: 1.0,
    scenario: { id: "day", label: "Day Trade (4H-15M)", horizonCode: 2, tf: "15M" },
    entryModel: { id: "ICT_2022_MENTORSHIP", label: "ICT 2022 Mentorship" },
    activeTimeSlot: { label: "New York AM Killzone", session: "NEW YORK" },
    targetLandmark: "4H FVG Consequent Encroachment (CE 50%)",
    magicNumber: 23122101,
    createdAt: new Date("2026-10-06T14:30:00Z"),
    filledAt: new Date("2026-10-06T14:35:00Z"),
    closedAt: new Date("2026-10-06T15:10:00Z"),
    isLive: false,
  };

  const row = normalizeJournalRow(rawProp);

  assert.strictEqual(row.isPropFirm, true);
  assert.strictEqual(row.managementModel, "Prop-Firm Safe (1.5R–2.5R)");
  assert.strictEqual(row.realizedR, 1.85);
  assert.strictEqual(row.targetLandmark, "4H FVG Consequent Encroachment (CE 50%)");
  assert.strictEqual(row.durationMinutes, 35);
  assert.strictEqual(row.executionMode, "PAPER");
});

// 3. Normalization of LOSS & BREAKEVEN outcomes
test("Normalizes LOSS and BREAKEVEN outcomes properly", () => {
  const lossTrade = {
    symbol: "XAUUSD",
    dir: -1,
    status: "closed_sl",
    realizedR: -1.0,
    maxDrawdownR: -1.0,
    managementLogic: "prop_firm_safe",
  };
  const rowLoss = normalizeJournalRow(lossTrade);
  assert.strictEqual(rowLoss.outcome, "LOSS");
  assert.strictEqual(rowLoss.realizedR, -1.0);
  assert.strictEqual(rowLoss.dirLabel, "SELL");

  const beTrade = {
    symbol: "EURUSD",
    dir: 1,
    status: "closed_be",
    realizedR: 0.0,
    maxDrawdownR: -0.4,
    managementLogic: "milestone_50",
  };
  const rowBe = normalizeJournalRow(beTrade);
  assert.strictEqual(rowBe.outcome, "BREAKEVEN");
  assert.strictEqual(rowBe.realizedR, 0.0);
});

// 4. Executive KPI Calculation Engine
test("Calculates overall and model-specific KPIs accurately", () => {
  const mockTrades = [
    // Default model trades
    { outcome: "WIN", realizedR: 3.5, realizedPnlUsd: 700, peakR: 3.8, maxDrawdownR: -0.2, managementLogic: "milestone_50" },
    { outcome: "WIN", realizedR: 2.0, realizedPnlUsd: 400, peakR: 2.1, maxDrawdownR: -0.1, managementLogic: "milestone_50" },
    { outcome: "LOSS", realizedR: -1.0, realizedPnlUsd: -200, peakR: 0.2, maxDrawdownR: -1.0, managementLogic: "milestone_50" },
    { outcome: "BREAKEVEN", realizedR: 0.0, realizedPnlUsd: 0, peakR: 1.5, maxDrawdownR: -0.3, managementLogic: "milestone_50" },

    // Prop-firm safe trades
    { outcome: "WIN", realizedR: 1.85, realizedPnlUsd: 370, peakR: 1.9, maxDrawdownR: -0.1, managementLogic: "prop_firm_safe" },
    { outcome: "WIN", realizedR: 2.20, realizedPnlUsd: 440, peakR: 2.3, maxDrawdownR: -0.2, managementLogic: "prop_firm_safe" },
    { outcome: "LOSS", realizedR: -0.5, realizedPnlUsd: -100, peakR: 1.0, maxDrawdownR: -0.5, managementLogic: "prop_firm_safe" }, // SL reduced to half!

    // Open trade
    { outcome: "OPEN", unrealizedR: 1.2, peakR: 1.4, maxDrawdownR: 0, managementLogic: "prop_firm_safe" },
  ];

  const kpis = calculateJournalKpis(mockTrades);

  assert.strictEqual(kpis.totalTrades, 8);
  assert.strictEqual(kpis.closedCount, 7);
  assert.strictEqual(kpis.openCount, 1);
  assert.strictEqual(kpis.winsCount, 4);
  assert.strictEqual(kpis.lossesCount, 2);
  assert.strictEqual(kpis.beCount, 1);

  // Overall Win Rate (excluding BE): 4 wins / (4 wins + 2 losses) = 66.7%
  assert.strictEqual(kpis.winRate, 66.7);

  // Net Realized R: 3.5 + 2.0 - 1.0 + 0 + 1.85 + 2.20 - 0.5 = 8.05 R
  assert.strictEqual(kpis.totalRealizedR, 8.05);

  // Profit Factor: Gross Profit R (3.5 + 2.0 + 1.85 + 2.2 = 9.55) / Gross Loss R (1.0 + 0.5 = 1.5) = 6.37
  assert.strictEqual(kpis.profitFactor, 6.37);

  // Default Model Sub-KPIs (excluding BE: 2 wins / 3 decisive = 66.7%)
  assert.strictEqual(kpis.models.default.total, 4);
  assert.strictEqual(kpis.models.default.winRate, 66.7); // 2 wins / (2 wins + 1 loss)
  assert.strictEqual(kpis.models.default.netR, 4.5);    // 3.5 + 2.0 - 1.0

  // Prop-Firm Safe Model Sub-KPIs
  assert.strictEqual(kpis.models.propFirm.total, 3);
  assert.strictEqual(kpis.models.propFirm.winRate, 66.7); // 2 wins / 3 closed (0 BE)
  assert.strictEqual(kpis.models.propFirm.netR, 3.55);   // 1.85 + 2.2 - 0.5
});

// 5. Normalization with CFD Spread Friction & Dual-R Architecture
test("Normalizes CFD Spread Friction & Dual-R telemetry correctly", () => {
  const frictionTrade = {
    symbol: "EURUSD",
    dir: 1,
    status: "closed_tp",
    entryPrice: 1.08500,
    slPrice: 1.08300,
    tpPrice: 1.09100,
    spreadPrice: 0.00020,
    idleRR: 3.00,
    coveredRR: 2.87,
    frictionDragR: 0.13,
    recoveryPct: 63.9,
    brokerLevels: {
      entry: 1.08507,
      sl: 1.08300,
      tp: 1.09094,
    },
    managementLogic: "milestone_50",
  };

  const row = normalizeJournalRow(frictionTrade);
  assert.strictEqual(row.idleRR, 3.00);
  assert.strictEqual(row.coveredRR, 2.87);
  assert.strictEqual(row.frictionDragR, 0.13);
  assert.strictEqual(row.recoveryPct, 63.9);
  assert.strictEqual(row.spreadPrice, 0.00020);
  assert.strictEqual(row.isFrictionExcessive, false);
  assert.strictEqual(row.brokerLevels.entry, 1.08507);
  assert.strictEqual(row.brokerLevels.tp, 1.09094);
});

// 6. Spread Friction KPI Aggregations
test("Aggregates spread friction drag and recovery in KPIs", () => {
  const trades = [
    { outcome: "WIN", realizedR: 2.87, frictionDragR: 0.13, recoveryPct: 63.9, managementLogic: "milestone_50" },
    { outcome: "WIN", realizedR: 1.80, frictionDragR: 0.15, recoveryPct: 60.0, managementLogic: "prop_firm_safe" },
  ];

  const kpis = calculateJournalKpis(trades);
  assert.strictEqual(kpis.totalFrictionDragR, 0.28);
  assert.strictEqual(kpis.avgSpreadDragR, 0.14);
  assert.strictEqual(kpis.avgRecoveryPct, 62.0);
});

// 7. Isolation of Staged & Pending Trades from Journal Execution Ledger
test("Staged and pending limit ideas are strictly marked unexecuted", () => {
  const stagedTrade = {
    symbol: "EURUSD",
    dir: 1,
    status: "staged",
    entryPrice: 1.0800,
    slPrice: 1.0770,
    tpPrice: 1.0950,
  };
  const rowStaged = normalizeJournalRow(stagedTrade);
  assert.strictEqual(rowStaged.outcome, "STAGED");

  const pendingTrade = {
    symbol: "NAS100",
    dir: -1,
    status: "pending",
    entryPrice: 20000,
    slPrice: 20100,
    tpPrice: 19600,
  };
  const rowPending = normalizeJournalRow(pendingTrade);
  assert.strictEqual(rowPending.outcome, "CANCELLED"); // never executed!

  const armedTrade = {
    symbol: "XAUUSD",
    dir: 1,
    status: "armed",
    entryPrice: 2650,
    slPrice: 2640,
    tpPrice: 2700,
  };
  const rowArmed = normalizeJournalRow(armedTrade);
  assert.strictEqual(rowArmed.outcome, "CANCELLED"); // never executed!
});

console.log("\n=======================================================");
console.log(`TEST SUMMARY: ${passed} PASSED, 0 FAILED`);
console.log("=======================================================");
console.log("🎯 ALL JOURNAL TESTS PASSED WITH 100% SUCCESS!\n");
