// test_counter_trend_veto_hardening.mjs
// Verification of Sovereign Veto Enforcement against Suicidal Counter-Trend Trades

import assert from "node:assert/strict";
import { evaluateExecutionVetoes } from "./lib/autonomous/models.js";
import { computeSymbolBias } from "./lib/bias/engine.js";
import { SCENARIOS } from "./lib/autonomous/scenarios.js";

console.log("=====================================================================");
console.log("TEST SUITE: Counter-Trend Veto Hardening & Sovereign Gatekeeper Audit");
console.log("=====================================================================\n");

let passed = 0;
function pass(msg) {
  passed++;
  console.log(`✅ PASS: ${msg}`);
}

// ---------------------------------------------------------------------------
// TEST 1: Unconditional allowedToLong === false Veto (Turtle Soup & PO3)
// ---------------------------------------------------------------------------
console.log("--- 1. Testing Unconditional allowedToLong / allowedToShort Veto ---");

const mockBrainFreightTrainLong = {
  action: "WAIT_FOR_15M_TRIGGER",
  verdict: "BULLISH_PULLBACK_DEFENDED",
  macroCompass: "BULLISH",
  macroDir: 1,
  allowedToLong: false,
  allowedToShort: false,
  blockReasons: ["15M adverse freight train velocity detected (12.88x impulse speed). Awaiting structural deceleration or MSS."],
  horizons: {
    DAY: {
      gatekeeper: {
        vetoActive: true,
        triggerStatus: "WAIT_SHIFT",
        vetoReason: "15M adverse freight train velocity detected (12.88x impulse speed). Awaiting structural deceleration or MSS."
      }
    }
  }
};

// Turtle soup (limit order / reversal model)
const turtleSoupCandidate = {
  modelId: "turtle_soup",
  id: "turtle_soup",
  entry: 208.936,
  sl: 208.630,
  tp: 209.786,
  targetRR: 2.7,
  targets: [{ price: 209.786, side: 1 }]
};

const resultTurtleSoup = evaluateExecutionVetoes({
  symbol: "GBPJPY",
  dir: 1,
  entry: 208.936,
  sl: 208.630,
  brain: mockBrainFreightTrainLong,
  frames: { D1: [{}], H4: [{}], H1: [{}], M15: [{}], M5: [{}] },
  config: { scenario: SCENARIOS.DAY, candidate: turtleSoupCandidate },
  now: new Date()
});

assert.strictEqual(resultTurtleSoup.permitted, false, "Turtle Soup must be strictly vetoed when allowedToLong is false");
const hasBrainVetoTS = resultTurtleSoup.vetoes.some(v => v.code === "BRAIN_NOT_PERMITTED");
assert.strictEqual(hasBrainVetoTS, true, "Must include BRAIN_NOT_PERMITTED veto for Turtle Soup");
const hasGatekeeperVetoTS = resultTurtleSoup.vetoes.some(v => v.code === "LTF_GATEKEEPER");
assert.strictEqual(hasGatekeeperVetoTS, true, "Must include LTF_GATEKEEPER veto for WAIT_SHIFT adverse velocity");
pass("Turtle Soup limit order strictly vetoed with BRAIN_NOT_PERMITTED and LTF_GATEKEEPER");

// PO3 Daily Cycle (limit order)
const po3Candidate = {
  modelId: "po3_daily_cycle",
  id: "po3_daily_cycle",
  entry: 208.936,
  sl: 208.630,
  tp: 209.786,
  targetRR: 2.7,
  targets: [{ price: 209.786, side: 1 }]
};

const resultPo3 = evaluateExecutionVetoes({
  symbol: "GBPJPY",
  dir: 1,
  entry: 208.936,
  sl: 208.630,
  brain: mockBrainFreightTrainLong,
  frames: { D1: [{}], H4: [{}], H1: [{}], M15: [{}], M5: [{}] },
  config: { scenario: SCENARIOS.DAY, candidate: po3Candidate },
  now: new Date()
});

assert.strictEqual(resultPo3.permitted, false, "PO3 Daily Cycle must be strictly vetoed when allowedToLong is false");
assert.strictEqual(resultPo3.vetoes.some(v => v.code === "BRAIN_NOT_PERMITTED"), true, "Must include BRAIN_NOT_PERMITTED veto for PO3");
pass("PO3 Daily Cycle limit order strictly vetoed with BRAIN_NOT_PERMITTED");

// ---------------------------------------------------------------------------
// TEST 2: Symmetrical Short Direction Veto (allowedToShort === false)
// ---------------------------------------------------------------------------
console.log("\n--- 2. Testing Symmetrical allowedToShort === false Veto ---");

const mockBrainFreightTrainShort = {
  action: "WAIT_FOR_15M_TRIGGER",
  verdict: "BEARISH_PULLBACK_DEFENDED",
  macroCompass: "BEARISH",
  macroDir: -1,
  allowedToLong: false,
  allowedToShort: false,
  blockReasons: ["15M adverse freight train velocity detected (10.5x impulse speed)."],
  horizons: {
    DAY: {
      gatekeeper: {
        vetoActive: true,
        triggerStatus: "WAIT_SHIFT",
        vetoReason: "15M adverse freight train velocity detected (10.5x impulse speed)."
      }
    }
  }
};

const shortCandidate = {
  modelId: "turtle_soup",
  id: "turtle_soup",
  entry: 1.1000,
  sl: 1.1030,
  tp: 1.0920,
  targetRR: 2.6,
  targets: [{ price: 1.0920, side: -1 }]
};

const resultShort = evaluateExecutionVetoes({
  symbol: "EURUSD",
  dir: -1,
  entry: 1.1000,
  sl: 1.1030,
  brain: mockBrainFreightTrainShort,
  frames: { D1: [{}], H4: [{}], H1: [{}], M15: [{}], M5: [{}] },
  config: { scenario: SCENARIOS.DAY, candidate: shortCandidate },
  now: new Date()
});

assert.strictEqual(resultShort.permitted, false, "Short must be strictly vetoed when allowedToShort is false");
assert.strictEqual(resultShort.vetoes.some(v => v.code === "BRAIN_NOT_PERMITTED"), true, "Must include BRAIN_NOT_PERMITTED for short");
assert.strictEqual(resultShort.vetoes.some(v => v.code === "LTF_GATEKEEPER"), true, "Must include LTF_GATEKEEPER for short");
pass("Short limit order strictly vetoed when allowedToShort is false");

// ---------------------------------------------------------------------------
// TEST 3: Approved Case (allowedToLong === true && gatekeeper APPROVED)
// ---------------------------------------------------------------------------
console.log("\n--- 3. Testing Legitimate Approved Setup Passes ---");

const mockBrainApproved = {
  action: "READY_FOR_LONG",
  verdict: "STRONG_BULLISH_EXPANSION",
  macroCompass: "BULLISH",
  macroDir: 1,
  allowedToLong: true,
  allowedToShort: false,
  conviction: 85,
  horizons: {
    DAY: {
      gatekeeper: {
        vetoActive: false,
        triggerStatus: "APPROVED",
      }
    }
  }
};

const resultApproved = evaluateExecutionVetoes({
  symbol: "EURUSD",
  dir: 1,
  entry: 1.0850,
  sl: 1.0830,
  brain: mockBrainApproved,
  frames: { D1: [{}], H4: [{}], H1: [{}], M15: [{}], M5: [{}] },
  config: { scenario: SCENARIOS.DAY, candidate: { ...turtleSoupCandidate, entry: 1.0850, sl: 1.0830, tp: 1.0900, targets: [{ price: 1.0900, side: 1 }] } },
  now: new Date()
});

assert.strictEqual(resultApproved.vetoes.some(v => v.code === "BRAIN_NOT_PERMITTED"), false, "Approved long must NOT have BRAIN_NOT_PERMITTED");
assert.strictEqual(resultApproved.vetoes.some(v => v.code === "LTF_GATEKEEPER"), false, "Approved long must NOT have LTF_GATEKEEPER");
pass("Legitimate approved long correctly passes brain and gatekeeper checks");

// ---------------------------------------------------------------------------
// TEST 4: DOL Anti-Rotation in Active 4H Downtrend
// ---------------------------------------------------------------------------
console.log("\n--- 4. Testing DOL Selection in 4H Downtrend with PDL Sweep ---");

import { analyzeHTFLiquidity } from "./lib/bias/htfLiquidity.js";

const nowSec = 1700000000;
// Generate 4H bars in an active downtrend
const h4Downtrend = Array.from({ length: 60 }, (_, i) => {
  const price = 215 - i * 0.1;
  return {
    time: nowSec - (60 - i) * 14400,
    open: price + 0.05,
    high: price + 0.08,
    low: price - 0.08,
    close: price - 0.04,
    volume: 1000,
    closed: true,
    timestampSemantics: "UTC_INSTANT"
  };
});

// Last bar pierces PDL (e.g. 209.10) with a wick and closes at 209.05
const lastBar = h4Downtrend.at(-1);
lastBar.low = 208.90; // sweeps PDL @ 209.00
lastBar.close = 209.05;

const mockStructures = {
  H4: { dir: -1 },
  D1: { dir: -1 }
};

const d1Bars = [
  { time: nowSec - 86400 * 2, open: 212, high: 213, low: 209.00, close: 210, closed: true, timestampSemantics: "UTC_INSTANT" },
  { time: nowSec - 86400, open: 210, high: 211, low: 209.00, close: 209.5, closed: true, timestampSemantics: "UTC_INSTANT" }
];

const htfLiqResult = analyzeHTFLiquidity({
  H4: h4Downtrend,
  D1: d1Bars,
}, {
  structures: mockStructures,
  currentPrice: 209.05
});

assert.notStrictEqual(htfLiqResult.drawOnLiquidity?.direction, 1, "In a 4H downtrend, sweeping PDL must NOT flip DOL to direction +1 (BSL)");
assert.strictEqual(htfLiqResult.activeCycle, "IRL_TO_ERL", "Active cycle in 4H downtrend must remain IRL_TO_ERL (continuation downward)");
pass("PDL sweep in 4H downtrend strictly maintains downward DOL and rejects false BSL rotation");

console.log("\n=====================================================================");
console.log(`🎯 ALL ${passed} COUNTER-TREND HARDENING TESTS PASSED WITH 100% SUCCESS!`);
console.log("=====================================================================");
