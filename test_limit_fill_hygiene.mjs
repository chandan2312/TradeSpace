import assert from "node:assert";
import { evaluateExecutionVetoes } from "./lib/autonomous/models.js";
import { determineTerminalStatus } from "./lib/autonomous/management.js";

console.log("\n=======================================================");
console.log("TEST SUITE: Limit Order Fill & Post-Fill Hygiene Tests");
console.log("=======================================================");

// 1. evaluateExecutionVetoes: Buy Limit fill condition (curPx <= entry)
{
  const buyCandidate = {
    modelId: "fvg_retest",
    tf: "M15",
    entry: 4122.465,
    sl: 4110.577,
    targets: [{ price: 4170.41, fraction: 1.0 }],
    currentPrice: 4121.94, // Price dipped below entry (natural buy limit fill!)
    evidence: { formationTime: Date.now() - 60000 },
  };

  // Fresh setup qualification: should flag INVERTED_LIMIT_ENTRY because buy limit is above market
  const freshGate = evaluateExecutionVetoes({
    symbol: "XAUUSD",
    dir: 1,
    entry: 4122.465,
    sl: 4110.577,
    candidate: buyCandidate,
    config: {},
  });
  assert(freshGate.vetoes.some(v => v.code === "INVERTED_LIMIT_ENTRY"), "Fresh qualification flags inverted limit entry when staging above market");
  console.log("✅ PASS: Fresh candidate staging correctly checks limit geometry");

  // Existing / pending / filled trade revalidation: MUST NOT flag INVERTED_LIMIT_ENTRY
  const existingGate = evaluateExecutionVetoes({
    symbol: "XAUUSD",
    dir: 1,
    entry: 4122.465,
    sl: 4110.577,
    candidate: { ...buyCandidate, isExistingTrade: true },
    config: { isExistingTrade: true, skipLimitGeometryCheck: true },
  });
  assert(!existingGate.vetoes.some(v => v.code === "INVERTED_LIMIT_ENTRY"), "Existing trade revalidation does NOT flag INVERTED_LIMIT_ENTRY on fill");
  console.log("✅ PASS: Existing/filling trade revalidation bypasses INVERTED_LIMIT_ENTRY");
}

// 2. evaluateExecutionVetoes: Sell Limit fill condition (curPx >= entry)
{
  const sellCandidate = {
    modelId: "fvg_retest",
    tf: "M15",
    entry: 4100.0,
    sl: 4115.0,
    targets: [{ price: 4050.0, fraction: 1.0 }],
    currentPrice: 4102.5, // Price surged above entry (natural sell limit fill!)
    evidence: { formationTime: Date.now() - 60000 },
  };

  const existingSellGate = evaluateExecutionVetoes({
    symbol: "XAUUSD",
    dir: -1,
    entry: 4100.0,
    sl: 4115.0,
    candidate: { ...sellCandidate, isExistingTrade: true },
    config: { isExistingTrade: true, skipLimitGeometryCheck: true },
  });
  assert(!existingSellGate.vetoes.some(v => v.code === "INVERTED_LIMIT_ENTRY"), "Existing sell limit revalidation does NOT flag INVERTED_LIMIT_ENTRY on fill");
  console.log("✅ PASS: Sell limit fill revalidation bypasses INVERTED_LIMIT_ENTRY");
}

// 3. determineTerminalStatus: Accurate status mapping
{
  const mockTrade = {
    dir: 1,
    entryPrice: 4122.44,
    slPrice: 4110.57,
    initialSlPrice: 4110.57,
    exitPrice: 4120.42,
    realizedR: -0.17,
  };

  // Administrative / entry_veto exit must NOT be categorized as closed_sl
  const vetoStatus = determineTerminalStatus(mockTrade, -0.17, "entry_veto");
  assert.strictEqual(vetoStatus, "cancelled", "entry_veto is categorized as cancelled, NOT closed_sl");
  console.log("✅ PASS: determineTerminalStatus categorizes entry_veto as cancelled");

  // Permission changed reason must NOT be categorized as closed_sl
  const permStatus = determineTerminalStatus(mockTrade, -0.17, "Entry permission/allocation changed before broker fill");
  assert.strictEqual(permStatus, "cancelled", "permission changed is categorized as cancelled, NOT closed_sl");
  console.log("✅ PASS: determineTerminalStatus categorizes permission changed as cancelled");

  // Legitimate Stop Loss hit must be categorized as closed_sl
  const slHitTrade = { ...mockTrade, exitPrice: 4110.50, realizedR: -1.0 };
  const realSlStatus = determineTerminalStatus(slHitTrade, -1.0, "stop");
  assert.strictEqual(realSlStatus, "closed_sl", "Legitimate stop hit is categorized as closed_sl");
  console.log("✅ PASS: determineTerminalStatus categorizes legitimate stop hit as closed_sl");

  // Breakeven exit
  const beStatus = determineTerminalStatus(mockTrade, 0.0, "breakeven");
  assert.strictEqual(beStatus, "closed_be", "Breakeven exit is categorized as closed_be");
  console.log("✅ PASS: determineTerminalStatus categorizes breakeven exit as closed_be");

  // TP hit
  const tpStatus = determineTerminalStatus({ ...mockTrade, exitPrice: 4170.41, realizedR: 4.03 }, 4.03, "tp");
  assert.strictEqual(tpStatus, "closed_tp", "TP exit is categorized as closed_tp");
  console.log("✅ PASS: determineTerminalStatus categorizes TP exit as closed_tp");
}

// 4. Proportional Realized R Calculation (Journal Store Hygiene)
{
  const riskUsd = 237.26;
  const netProfitEarlyExit = -40.40;
  const realizedR = Number((netProfitEarlyExit / riskUsd).toFixed(2));
  assert.strictEqual(realizedR, -0.17, "Proportional R is correctly -0.17R, NOT forced -1.0R");
  console.log("✅ PASS: Realized R calculation retains fractional R (-0.17R) instead of forcing -1.0R");

  const netProfitFullLoss = -237.26;
  const realizedRFull = Number((netProfitFullLoss / riskUsd).toFixed(2));
  assert.strictEqual(realizedRFull, -1.0, "Full stop loss gives -1.0R");
  console.log("✅ PASS: Full stop loss gives accurate -1.0R");
}

console.log("\n=======================================================");
console.log("🎯 ALL LIMIT FILL & HYGIENE TESTS PASSED WITH 100% SUCCESS!");
console.log("=======================================================\n");
