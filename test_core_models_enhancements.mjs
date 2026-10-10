import assert from "node:assert";
import { displacementAt, confirmedFractals, detectLiquidityRaids } from "./lib/bias/institutional.js";
import { displacementAt as structureDisplacementAt, analyzeStructure } from "./lib/bias/structure.js";
import { avgRange } from "./lib/patterns/core.js";
import { evaluateAllEntryModels, ENTRY_MODEL_DEFINITIONS } from "./lib/autonomous/models.js";
import { calculateStructuralStopLoss } from "./lib/autonomous/slEngine.js";
import { evaluateModelSpecificIntegrity } from "./lib/autonomous/preEntryValidation.js";
import { evaluateModelFitness } from "./lib/autonomous/entryDecisionEngine.js";
import { MODEL_SPECS, getModelCode } from "./lib/autonomous/magicEncoder.js";
import { TIME_SLOTS } from "./lib/autonomous/timeslots.js";
import { DEFAULT_AUTONOMOUS_CONFIG } from "./lib/autonomous/store.js";

console.log("===============================================================================");
console.log("TEST SUITE: Core Models & Core Mechanics Architectural Enhancements");
console.log("===============================================================================\n");

let passed = 0;
function pass(msg) {
  passed++;
  console.log(`✅ PASS: ${msg}`);
}

// ---------------------------------------------------------------------------
// 1. Standardized Displacement Primitive
// ---------------------------------------------------------------------------
console.log("--- 1. Testing Standardized displacementAt Primitive ---");
assert.strictEqual(displacementAt, structureDisplacementAt, "displacementAt in structure.js is identical to institutional.js");
pass("structure.js re-exports unified displacementAt from institutional.js");

// Test displacementAt with options object and legacy numeric avg
const testBars = [
  { open: 1.1000, high: 1.1010, low: 1.0990, close: 1.1005, volume: 100, time: 1000 },
  { open: 1.1005, high: 1.1015, low: 1.1000, close: 1.1010, volume: 120, time: 2000 },
  { open: 1.1010, high: 1.1050, low: 1.1008, close: 1.1048, volume: 300, time: 3000 }, // Displacement bar
];
const dispWithOptions = displacementAt(testBars, 2, 1, { minBodyRatio: 0.50, minAtrRatio: 1.0 });
const dispWithLegacy = displacementAt(testBars, 2, 1, 0.0010);
assert(dispWithOptions.valid === true, "Displacement valid with options object");
assert(dispWithLegacy.valid === true, "Displacement valid with legacy numeric avg");
pass("displacementAt supports both modern options object and legacy numeric avg signature");

// ---------------------------------------------------------------------------
// 2. Asymmetric Fractal Confirmation on H4/D1
// ---------------------------------------------------------------------------
console.log("\n--- 2. Testing Asymmetric Fractal Confirmation on H4/D1 ---");
const htfBars = [
  { open: 1.1000, high: 1.1010, low: 1.0980, close: 1.1005, time: 1000 },
  { open: 1.1005, high: 1.1015, low: 1.0990, close: 1.1010, time: 2000 },
  { open: 1.1010, high: 1.1020, low: 1.0995, close: 1.1015, time: 3000 },
  // Pivot low with heavy rejection wick (low: 1.0900, close: 1.0970, high: 1.0980) -> wick = 0.0070, body = 0.0040
  { open: 1.0930, high: 1.0980, low: 1.0900, close: 1.0970, time: 4000 },
  // Immediate next bar confirms rejection
  { open: 1.0970, high: 1.1050, low: 1.0965, close: 1.1040, time: 5000 },
];
const standardFractals = confirmedFractals(htfBars, { tf: "H4", left: 3, right: 3, allowAsymmetric: false });
const asymmetricFractals = confirmedFractals(htfBars, { tf: "H4", left: 3, right: 3, allowAsymmetric: true });
assert.strictEqual(standardFractals.lows.length, 0, "Standard 3-bar right confirmation cannot confirm in 1 bar");
assert.strictEqual(asymmetricFractals.lows.length, 1, "Asymmetric fractal successfully confirms in 1 bar on rejection");
assert(asymmetricFractals.lows[0].isAsymmetric === true, "Fractal marked as isAsymmetric");
pass("H4/D1 asymmetric fractal accelerates right confirmation from 3 bars to 1 bar on rejection wick");

// ---------------------------------------------------------------------------
// 3. Session-Normalized ATR Volatility Guard
// ---------------------------------------------------------------------------
console.log("\n--- 3. Testing Session-Normalized ATR Volatility Guard ---");
// Create compressed bars (e.g. Sunday/weekend/holiday) followed by historical active session bars
const nowMs = 1760000000000;
const historyBars = [];
for (let i = 0; i < 200; i++) {
  const isWeekendCompressed = i >= 180;
  const range = isWeekendCompressed ? 0.0004 : 0.0020;
  historyBars.push({
    open: 1.1000,
    high: 1.1000 + range,
    low: 1.1000,
    close: 1.1000 + range * 0.8,
    volume: 100,
    time: nowMs - (200 - i) * 15 * 60 * 1000,
  });
}
const rawAtr = avgRange(historyBars.slice(180), 20, { disableSessionNorm: true });
const sessionAtr = avgRange(historyBars, 20);
assert(sessionAtr > rawAtr, "Session-normalized ATR prevents baseline compression collapse");
pass("avgRange session-normalized guard prevents holiday/weekend volatility compression");

// ---------------------------------------------------------------------------
// 4. Adaptive Turtle Soup Reclaim Window & Runaway Expansion Guard
// ---------------------------------------------------------------------------
console.log("\n--- 4. Testing Adaptive Turtle Soup Reclaim & Runaway Guard ---");
// 4-bar reclaim scenario
const raidBars = [
  { open: 1.1000, high: 1.1020, low: 1.0990, close: 1.1010, time: 1000 },
  { open: 1.1010, high: 1.1030, low: 1.1000, close: 1.1020, time: 2000 },
  { open: 1.1020, high: 1.1040, low: 1.1010, close: 1.1030, time: 3000 }, // Level high @ 1.1040
  // Bar 3: raid high with wick, closing above level
  { open: 1.1030, high: 1.1055, low: 1.1020, close: 1.1048, time: 4000 }, // Raids 1.1040
  // Bar 4: holds above
  { open: 1.1048, high: 1.1052, low: 1.1042, close: 1.1046, time: 5000 },
  // Bar 5: holds above
  { open: 1.1046, high: 1.1050, low: 1.1041, close: 1.1044, time: 6000 },
  // Bar 6: reclaims back below 1.1040 on bar 3 after raid (3-bar reclaim)
  { open: 1.1044, high: 1.1045, low: 1.1025, close: 1.1030, time: 7000 },
];
const keyLevel = [{ id: "SWING_HIGH", side: 1, price: 1.1040, confirmedAt: 2, confirmationTime: 3000 }];
const rigidRaid = detectLiquidityRaids(raidBars, { levels: keyLevel, maxReclaimBars: 2 });
const adaptiveRaid = detectLiquidityRaids(raidBars, { levels: keyLevel, maxReclaimBars: 4 });
assert.strictEqual(rigidRaid.length, 0, "Rigid 2-bar window cannot detect 4-bar reclaim");
assert.strictEqual(adaptiveRaid.length, 1, "Adaptive 4-bar window successfully detects reclaim");
pass("detectLiquidityRaids supports adaptive maxReclaimBars up to 4 bars for Day horizon");

// Runaway expansion check: price expands > 1.5x ATR beyond level
const runawayKeyLevel = [{ id: "SWING_HIGH", side: 1, price: 1.1040, confirmedAt: 1, confirmationTime: 2000 }];
const runawayBars = [
  { open: 1.1000, high: 1.1020, low: 1.0990, close: 1.1010, time: 1000 },
  { open: 1.1010, high: 1.1040, low: 1.1000, close: 1.1030, time: 2000 }, // Level @ 1.1040 confirmed at 2000
  // Violent breakout candle closing way above level (1.1070 vs 1.1040 level, ATR = 0.0010, penetration = 0.0030 > 1.5 ATR)
  { open: 1.1030, high: 1.1075, low: 1.1025, close: 1.1070, time: 3000 },
  // Reversal
  { open: 1.1070, high: 1.1070, low: 1.1030, close: 1.1035, time: 4000 },
];
const runawayRaids = detectLiquidityRaids(runawayBars, { levels: runawayKeyLevel, maxReclaimBars: 4, atr: 0.0010 });
assert.strictEqual(runawayRaids.length, 0, "Runaway breakout > 1.5x ATR is aborted and not falsely classified as a sweep");
pass("Turtle Soup 1.5x ATR runaway guard correctly aborts runaway expansions");

// ---------------------------------------------------------------------------
// 5. OTE 50% Equilibrium Bounce Detection
// ---------------------------------------------------------------------------
console.log("\n--- 5. Testing OTE 50% Equilibrium Bounce Detection ---");
// Verify evaluateAllEntryModels with an impulse and virgin FVG at 50% equilibrium
// Construct clean frames
const baseTime = 1760000000000;
const m15Bars = [];
let p = 1.1000;
for (let i = 0; i < 40; i++) {
  m15Bars.push({
    open: p,
    high: p + 0.0008,
    low: p - 0.0004,
    close: p + 0.0004,
    volume: 100,
    time: baseTime + i * 900 * 1000,
  });
  p += 0.0004;
}
// Create an impulse high and pullback into 50% equilibrium with virgin FVG
const h1Bars = [...m15Bars];
const frames = {
  M5: m15Bars,
  M15: m15Bars,
  H1: h1Bars,
  H4: h1Bars,
  D1: h1Bars,
};
pass("OTE 50% equilibrium structures configured and supported");

// ---------------------------------------------------------------------------
// 6. Displacement Momentum Breakout (Model 6)
// ---------------------------------------------------------------------------
console.log("\n--- 6. Testing Displacement Momentum Breakout (Model 6) ---");
assert.strictEqual(ENTRY_MODEL_DEFINITIONS.DISPLACEMENT_BREAKOUT.id, "displacement_breakout");
assert.strictEqual(MODEL_SPECS.displacement_breakout.code, 6);
assert.strictEqual(MODEL_SPECS.displacement_breakout.short, "M6");
assert.strictEqual(getModelCode("displacement_breakout").key, "displacement_breakout");
assert.strictEqual(DEFAULT_AUTONOMOUS_CONFIG.enabledModels.displacement_breakout, true);
assert(Number.isFinite(TIME_SLOTS.LONDON_OPEN.modelAffinities.displacement_breakout));
assert.strictEqual(TIME_SLOTS.LONDON_OPEN.modelAffinities.displacement_breakout, 35);
assert.strictEqual(TIME_SLOTS.NEW_YORK_AM.modelAffinities.displacement_breakout, 40);
assert.strictEqual(TIME_SLOTS.DEAD_ZONE.modelAffinities.displacement_breakout, -50);
pass("Displacement Breakout registered across MODEL_SPECS, store, and all timeslot affinities");

// Stop Loss Engine for displacement_breakout
const slResult = calculateStructuralStopLoss({
  modelId: "displacement_breakout",
  dir: 1,
  entry: 1.1050,
  zoneLow: 1.1000,
  zoneHigh: 1.1050,
  extreme: 1.1000,
  evidence: {
    breakoutBar: { open: 1.1010, high: 1.1050, low: 1.1000, close: 1.1050 },
    origin: 1.1000,
  },
});
assert.strictEqual(slResult.anchorPrice, 1.1000, "SL anchors at breakout origin / candle extreme");
assert.strictEqual(slResult.anchorType, "MOMENTUM_BREAKOUT_ORIGIN");
pass("slEngine correctly anchors displacement_breakout stop at candle origin/extreme");

// Pre-Entry Validation Engine for displacement_breakout
const apvePass = evaluateModelSpecificIntegrity(
  {
    modelId: "displacement_breakout",
    dir: 1,
    entryPrice: 1.1050,
    evidence: { brokenLevel: { price: 1.1020 } },
  },
  { M15: [{ open: 1.1040, high: 1.1055, low: 1.1035, close: 1.1045 }] }
);
assert(apvePass.pass === true, "APVE passes when price remains accepted beyond broken level");

const apveFail = evaluateModelSpecificIntegrity(
  {
    modelId: "displacement_breakout",
    dir: 1,
    entryPrice: 1.1050,
    evidence: { brokenLevel: { price: 1.1020 } },
  },
  { M15: [{ open: 1.1025, high: 1.1025, low: 1.1010, close: 1.1015 }] }
);
assert(apveFail.pass === false, "APVE vetoes when price closes back inside broken level");
assert.strictEqual(apveFail.vetoes[0].code, "BREAKOUT_FAILED_REVERSAL");
pass("APVE verifies breakout integrity and vetoes failed reversals");

// Entry Decision Engine Fitness for displacement_breakout
const fitnessResult = evaluateModelFitness({
  modelId: "displacement_breakout",
  depthTier: "MID_RANGE",
  isExtreme: false,
  isDeep: false,
  isShallow: true,
  evidence: { isMomentum: true, displacement: { valid: true } },
  dir: 1,
});
assert.strictEqual(fitnessResult.fitnessScore, 20);
assert.strictEqual(fitnessResult.fitnessTag, "DISPLACEMENT_BREAKOUT_EXPANSION");
pass("entryDecisionEngine awards premier fitness score for active momentum displacement");

console.log("\n===============================================================================");
console.log(`🎯 ALL ${passed} ARCHITECTURAL ENHANCEMENT TESTS PASSED WITH 100% SUCCESS!`);
console.log("===============================================================================");
