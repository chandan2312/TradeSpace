import assert from "node:assert/strict";
import { evaluateSymbol, revalidateTradeIdea } from "./lib/autonomous/scanner.js";
import { SCENARIOS } from "./lib/autonomous/scenarios.js";
import { createAutonomousEngine } from "./lib/autonomous/engine.js";

async function runTests() {
  console.log("===================================================================");
  console.log("TEST SUITE: Dynamic Staged Re-anchoring & Brain-Model Harmonization");
  console.log("===================================================================\n");

  const nowMs = 1791288000000;
  const tSec = Math.floor(nowMs / 1000);

  // Mock multi-timeframe candles showing bullish order flow
  const mockFrames = {
    M5: Array.from({ length: 40 }, (_, i) => ({
      time: tSec - (40 - i) * 300,
      open: 1.1000 + i * 0.0002,
      high: 1.1005 + i * 0.0002,
      low: 1.0998 + i * 0.0002,
      close: 1.1003 + i * 0.0002,
      closeTime: tSec - (39 - i) * 300,
    })),
    M15: Array.from({ length: 40 }, (_, i) => ({
      time: tSec - (40 - i) * 900,
      open: 1.0980 + i * 0.0003,
      high: 1.0990 + i * 0.0003,
      low: 1.0975 + i * 0.0003,
      close: 1.0988 + i * 0.0003,
      closeTime: tSec - (39 - i) * 900,
    })),
    H1: Array.from({ length: 40 }, (_, i) => ({
      time: tSec - (40 - i) * 3600,
      open: 1.0900 + i * 0.0005,
      high: 1.0920 + i * 0.0005,
      low: 1.0890 + i * 0.0005,
      close: 1.0915 + i * 0.0005,
      closeTime: tSec - (39 - i) * 3600,
    })),
    H4: Array.from({ length: 40 }, (_, i) => ({
      time: tSec - (40 - i) * 14400,
      open: 1.0800 + i * 0.001,
      high: 1.0850 + i * 0.001,
      low: 1.0780 + i * 0.001,
      close: 1.0840 + i * 0.001,
      closeTime: tSec - (39 - i) * 14400,
    })),
    D1: Array.from({ length: 40 }, (_, i) => ({
      time: tSec - (40 - i) * 86400,
      open: 1.0600 + i * 0.002,
      high: 1.0700 + i * 0.002,
      low: 1.0550 + i * 0.002,
      close: 1.0680 + i * 0.002,
      closeTime: tSec - (39 - i) * 86400,
    })),
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
      },
    },
  };

  const gathered = new Map([["EURUSD", mockFrames]]);

  // =========================================================================
  // TEST 1: Two-Way Team Harmonization between Brain and Entry Model
  // =========================================================================
  console.log("TEST 1: Verifying Brain-Model Two-Way Harmonization...");
  const evalResult = evaluateSymbol("EURUSD", mockFrames, gathered, {
    minConviction: 50,
    minRunwayPct: 10,
    minRR: 1.8,
  }, nowMs, SCENARIOS.DAY);

  assert.ok(evalResult.brain, "Brain should be evaluated");
  assert.ok(evalResult.stagedLevel, "Staged level should be computed from order flow");
  assert.equal(typeof evalResult.brain.conviction, "number", "Brain should have unified conviction");
  assert.equal(evalResult.brain.conviction, evalResult.stagedLevel.conviction, "Brain conviction must equal staged level unified conviction");
  console.log(`✅ TEST 1 PASSED: Unified conviction = ${evalResult.brain.conviction} (Macro: ${evalResult.brain.macroConviction}, Model: ${evalResult.brain.modelScore})\n`);

  // =========================================================================
  // TEST 2: DOL Progression Avoids False Invalidation When Target Advances
  // =========================================================================
  console.log("TEST 2: Verifying DOL Progression (Intermediate sweep advances to next pool)...");
  const oldTrade = {
    _id: "trade_staged_1",
    symbol: "EURUSD",
    canonicalSymbol: "EURUSD",
    dir: 1,
    entryPrice: 1.1000,
    slPrice: 1.0960,
    initialSlPrice: 1.0960,
    tpPrice: 1.1050, // Old DOL target was 1.1050
    targetDOL: {
      id: "old_dol",
      name: "Old 4H High",
      price: 1.1050,
      consumed: true, // Marked swept!
      state: "swept",
      direction: 1,
      targetSide: "BSL",
    },
    brain: {
      macroBias: "BULLISH",
      macroDir: 1,
      targetDOL: {
        id: "next_dol",
        name: "Next Daily High",
        price: 1.1200, // Advanced pool
        consumed: false,
        state: "UNCONSUMED",
        direction: 1,
        targetSide: "BSL",
      },
    },
    stagedLevel: {
      entry: 1.1000,
      sl: 1.0960,
      tp: 1.1050,
      targetRR: 2.5,
      confluenceScore: 80,
    },
  };

  const revalResult = await revalidateTradeIdea(oldTrade, {
    mainWatchlistSymbols: ["EURUSD"],
    frames: { EURUSD: mockFrames },
    minRR: 1.8,
  }, new Date(nowMs));

  const dolChangedVeto = revalResult.vetoes?.find(v => v.code === "DOL_CHANGED");
  assert.equal(dolChangedVeto, undefined, "DOL_CHANGED should NOT veto when target runway progresses favorably");
  assert.ok(revalResult.freshLevel, "revalidateTradeIdea must return freshLevel");
  console.log("✅ TEST 2 PASSED: DOL consumed in profit direction rolls forward without fatal invalidation\n");

  // =========================================================================
  // TEST 3: Dynamic Staged Re-anchoring In Scan Sweep
  // =========================================================================
  console.log("TEST 3: Verifying Dynamic Staged Re-anchoring in Autonomous Engine scan sweep...");
  
  // Stored trades in mock database: Old stale levels from 2 hours ago
  const stagedTrades = [
    {
      _id: "trade_def_1",
      symbol: "EURUSD",
      canonicalSymbol: "EURUSD",
      groupId: "grp_eur_1",
      legId: "default",
      status: "staged",
      dir: 1,
      entryPrice: 1.0950, // Old stale entry
      slPrice: 1.0910,    // Old stale SL
      initialSlPrice: 1.0910,
      tpPrice: 1.1100,    // Old stale TP
      targetRR: 3.75,
      confluenceScore: 70,
      createdAt: new Date(nowMs - 7200000), // 2 hours ago
      updatedAt: new Date(nowMs - 7200000),
      events: [{ type: "STAGED", note: "Original setup", time: new Date(nowMs - 7200000) }],
    },
    {
      _id: "trade_prop_1",
      symbol: "EURUSD",
      canonicalSymbol: "EURUSD",
      groupId: "grp_eur_1",
      legId: "prop_firm",
      status: "staged",
      dir: 1,
      entryPrice: 1.0950, // Old stale entry
      slPrice: 1.0910,    // Old stale SL
      initialSlPrice: 1.0910,
      tpPrice: 1.1030,    // Old Prop TP (2.0R)
      targetRR: 2.0,
      confluenceScore: 70,
      createdAt: new Date(nowMs - 7200000),
      updatedAt: new Date(nowMs - 7200000),
      events: [{ type: "STAGED", note: "Original prop setup", time: new Date(nowMs - 7200000) }],
    },
  ];

  const updatedDocs = [];
  const notifications = [];

  const mockDb = {
    tradesCol: {
      find: (query) => ({
        toArray: async () => {
          if (query?.status === "staged") return stagedTrades.filter(t => t.status === "staged");
          return stagedTrades;
        },
      }),
      findOne: async (query) => stagedTrades.find(t => t._id === query._id),
      updateOne: async (query, update) => {
        const item = stagedTrades.find(t => t._id === query._id);
        if (item) {
          if (update.$set) Object.assign(item, update.$set);
          if (update.$push?.events) item.events.push(update.$push.events);
          updatedDocs.push({ id: query._id, ...update.$set });
        }
        return { modifiedCount: 1 };
      },
    },
    controlCol: {
      updateOne: async () => {},
    },
  };

  const freshLevelData = {
    entry: 1.1005, // Fresh refined entry
    sl: 1.0970,    // Fresh refined SL (tighter risk!)
    tp: 1.1180,    // Fresh refined TP
    targetRR: 5.0,
    targets: [{ id: "tp1", price: 1.1180, kind: "target" }],
    confluenceScore: 88,
    modelId: "fvg_retest",
    modelName: "M15 Fair Value Gap Retest",
    dir: 1,
    tf: "M15",
  };

  const engine = createAutonomousEngine({
    autonomousCols: async () => mockDb,
    getFrames: async () => mockFrames,
    getMainWatchlistSymbols: async () => ["EURUSD"],
    getConfig: async () => ({
      enabled: true,
      executionMode: "copilot", // Keep staged
      pendingExpiryMinutes: 60,
      riskPerTradePct: 1,
      minConviction: 50,
      minRR: 1.8,
    }),
    revalidateTradeIdea: async () => ({
      permitted: true,
      vetoes: [],
      brain: { macroBias: "BULLISH", macroDir: 1, conviction: 88 },
      freshLevel: freshLevelData,
      evaluation: { frames: mockFrames, bias: { ranges: {} } },
    }),
    validatePreEntrySetup: async () => ({ ok: true, vetoes: [] }),
    scanUniverse: async () => ({
      totalScanned: 1,
      primeCount: 0,
      watchingCount: 1,
      blockedCount: 0,
      primeSetups: [],
    }),
    logEvent: async () => {},
    sendTelegram: async (msg) => { notifications.push(msg); },
    now: () => nowMs,
  });

  await engine.runAutonomousScan("manual");

  const defaultLegAfter = stagedTrades.find(t => t.legId === "default");
  const propLegAfter = stagedTrades.find(t => t.legId === "prop_firm");

  assert.equal(defaultLegAfter.entryPrice, 1.1005, "Default leg entry must be re-anchored to fresh level");
  assert.equal(defaultLegAfter.slPrice, 1.0970, "Default leg SL must be re-anchored to fresh level");
  assert.equal(defaultLegAfter.tpPrice, 1.1180, "Default leg TP must be re-anchored to fresh target");
  assert.equal(defaultLegAfter.confluenceScore, 88, "Default leg confluence score must be refreshed");
  assert.ok(defaultLegAfter.lastRefinedAt, "Default leg must record lastRefinedAt timestamp");

  assert.equal(propLegAfter.entryPrice, 1.1005, "Prop leg entry must be re-anchored synchronously with default leg");
  assert.equal(propLegAfter.slPrice, 1.0970, "Prop leg SL must be re-anchored synchronously with default leg");
  assert.ok(propLegAfter.tpPrice > 1.1005, "Prop leg TP must be calculated from fresh entry");
  assert.ok(propLegAfter.lastRefinedAt, "Prop leg must record lastRefinedAt timestamp");

  const refinedEventDef = defaultLegAfter.events.find(e => e.type === "STAGED_REFINED");
  assert.ok(refinedEventDef, "STAGED_REFINED event must be logged on default leg");
  console.log(`✅ Default Leg re-anchored: Entry ${defaultLegAfter.entryPrice}, SL ${defaultLegAfter.slPrice}, TP ${defaultLegAfter.tpPrice}`);
  console.log(`✅ Prop-Firm Leg re-anchored: Entry ${propLegAfter.entryPrice}, SL ${propLegAfter.slPrice}, TP ${propLegAfter.tpPrice}`);
  console.log("✅ TEST 3 PASSED: Dynamic Staged Re-anchoring successfully updated stale setup to live market structure!\n");

  console.log("===================================================================");
  console.log("🎉 ALL DYNAMIC RE-ANCHORING & HARMONIZATION TESTS PASSED WITH 100% SUCCESS!");
  console.log("===================================================================");
}

runTests().catch(err => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
