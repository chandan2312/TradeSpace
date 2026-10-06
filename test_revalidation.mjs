import assert from "node:assert/strict";
import { revalidateTradeIdea } from "./lib/autonomous/scanner.js";

async function runTests() {
  console.log("=======================================================");
  console.log("TEST SUITE: Resting Limit & Pending Trade Revalidation");
  console.log("=======================================================\n");

  const nowMs = 1791288000000; // Realistic test epoch
  const now = new Date(nowMs);
  const tSec = Math.floor(nowMs / 1000);

  const mockFrames = {
    M5: [
      { time: tSec - 600, open: 1.1000, high: 1.1020, low: 1.0990, close: 1.1010, closeTime: tSec - 300 },
      { time: tSec - 300, open: 1.1010, high: 1.1030, low: 1.1005, close: 1.1025, closeTime: tSec },
    ],
    M15: [
      { time: tSec - 900, open: 1.0990, high: 1.1030, low: 1.0980, close: 1.1025, closeTime: tSec },
    ],
    H1: [
      { time: tSec - 3600, open: 1.0950, high: 1.1040, low: 1.0940, close: 1.1025, closeTime: tSec },
    ],
    H4: [
      { time: tSec - 14400, open: 1.0900, high: 1.1050, low: 1.0880, close: 1.1025, closeTime: tSec },
    ],
    D1: [
      { time: tSec - 86400, open: 1.0850, high: 1.1100, low: 1.0820, close: 1.1025, closeTime: tSec },
    ],
    snapshot: {
      asOf: nowMs,
      closedOnly: true,
      semantics: "UTC_INSTANT",
      timeframes: {
        M5: { stale: false },
        M15: { stale: false },
        H1: { stale: false },
        H4: { stale: false },
        D1: { stale: false },
      }
    }
  };

  const trade = {
    _id: "trade_eurusd_buy_1",
    symbol: "EURUSD",
    canonicalSymbol: "EURUSD",
    dir: 1, // BUY
    entryPrice: 1.1000, // Resting limit below current market price 1.1025
    slPrice: 1.0960,
    initialSlPrice: 1.0960,
    tpPrice: 1.1120,
    targetRR: 3.0,
    confluenceScore: 78,
    status: "armed",
    modelId: "fvg_retest",
    tf: "M15",
    targets: [
      { id: "tp1", price: 1.1060, targetSide: "BSL" },
      { id: "tp2", price: 1.1120, targetSide: "BSL" },
    ],
    stagedLevel: {
      entry: 1.1000,
      sl: 1.0960,
      tp: 1.1120,
      targetRR: 3.0,
      confluenceScore: 78,
      modelId: "fvg_retest",
      targets: [
        { id: "tp1", price: 1.1060, targetSide: "BSL" },
        { id: "tp2", price: 1.1120, targetSide: "BSL" },
      ]
    },
    brain: {
      macroDir: 1,
      macroBias: "BULLISH",
      conviction: 85,
    }
  };

  const cfg = {
    mainWatchlistSymbols: ["EURUSD", "GBPUSD", "XAUUSD"],
    frames: { EURUSD: mockFrames },
    minRR: 2.0,
    minConviction: 70,
    enabledTimeslots: ["asia", "london_open", "london_lunch", "ny_open", "ny_pm"],
    priorState: {
      action: "READY_FOR_LONG",
      allowedToLong: true,
      conviction: 85,
      macroBias: "BULLISH",
      macroDir: 1,
    }
  };

  // 1. Normal resting limit order (current price 1.1025, waiting for pullback to 1.1000)
  const result1 = await revalidateTradeIdea(trade, cfg, now);
  console.log("Resting limit test vetoes:", result1.vetoes.map(v => v.code));
  assert.equal(result1.vetoes.some(v => v.code === "MODEL_IDENTITY_CHANGED"), false, "Must not veto with MODEL_IDENTITY_CHANGED");
  assert.equal(result1.vetoes.some(v => v.code === "CONFLUENCE_THRESHOLD"), false, "Must not zero out confluence score");
  assert.equal(result1.vetoes.some(v => v.code === "NO_STRICT_MODEL"), false, "Must retain strict model qualification");
  assert.equal(result1.vetoes.some(v => v.code === "RANGE_CHANGED"), false, "Must not falsely flag range changed");
  console.log("✅ PASS: Normal resting limit order retains model evidence and avoids false veto cascade");

  // 2. Stop loss breached before fill (current price dropped to 1.0950 <= sl 1.0960)
  const breachedFrames = {
    ...mockFrames,
    M5: [{ time: 1000, open: 1.0980, high: 1.0985, low: 1.0945, close: 1.0950, closeTime: 1300 }]
  };
  const result2 = await revalidateTradeIdea(trade, { ...cfg, frames: { EURUSD: breachedFrames } });
  assert.equal(result2.permitted, false, "Must be vetoed when SL is breached");
  assert.equal(result2.vetoes.some(v => v.code === "STRUCTURE_INVALIDATED"), true, "Must have STRUCTURE_INVALIDATED veto");
  console.log("✅ PASS: Breached stop loss correctly yields STRUCTURE_INVALIDATED");

  // 3. Target already hit before fill (current price surged to 1.1130 >= tp 1.1120)
  const targetHitFrames = {
    ...mockFrames,
    M5: [{ time: 1000, open: 1.1090, high: 1.1135, low: 1.1085, close: 1.1130, closeTime: 1300 }]
  };
  const result3 = await revalidateTradeIdea(trade, { ...cfg, frames: { EURUSD: targetHitFrames } });
  assert.equal(result3.permitted, false, "Must be vetoed when TP hit before entry");
  assert.equal(result3.vetoes.some(v => v.code === "TARGET_ALREADY_HIT"), true, "Must have TARGET_ALREADY_HIT veto");
  console.log("✅ PASS: Target hit before entry correctly yields TARGET_ALREADY_HIT");

  console.log("\n=======================================================");
  console.log("🎯 ALL REVALIDATION TESTS PASSED WITH 100% SUCCESS!");
  console.log("=======================================================");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
