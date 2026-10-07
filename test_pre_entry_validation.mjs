// Comprehensive Test Suite: Autonomous Pre-Entry Validation Engine (APVE)
import {
  evaluateLevelGeometry,
  evaluateAdverseVelocity,
  evaluateModelSpecificIntegrity,
  evaluateExternalRegime,
  validatePreEntrySetup,
} from "./lib/autonomous/preEntryValidation.js";

let passed = 0;
let failed = 0;

function assert(description, condition, actual = null) {
  if (condition) {
    console.log(`✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${description}`);
    if (actual !== null) console.error("   Actual:", actual);
    failed++;
  }
}

console.log("===============================================================================");
console.log("TEST SUITE: Autonomous Pre-Entry Validation Engine (APVE)");
console.log("===============================================================================");

// ---------------------------------------------------------------------------
// 1. Pillar 1: Level Geometry & Structural Bounds
// ---------------------------------------------------------------------------
console.log("\n--- 1. Testing Pillar 1: Level Geometry & Structural Bounds ---");

const baseTradeBuy = {
  _id: "trade_geo_001",
  symbol: "EURUSD",
  dir: 1,
  entryPrice: 1.0850,
  slPrice: 1.0830,
  tpPrice: 1.0910,
  initialRiskDistance: 0.0020,
  tf: "M15",
  modelId: "ict_2022",
};

// 1.1 Stop Loss breached before entry
const slBreachedResult = evaluateLevelGeometry(baseTradeBuy, 1.0825); // currentPrice 1.0825 < SL 1.0830
assert("Stop Loss breached before entry triggers STOP_ALREADY_BREACHED", slBreachedResult.pass === false && slBreachedResult.vetoes[0]?.code === "STOP_ALREADY_BREACHED", slBreachedResult);

// 1.2 Target already reached before entry
const tpReachedResult = evaluateLevelGeometry(baseTradeBuy, 1.0915); // currentPrice 1.0915 >= TP 1.0910
assert("Target reached before entry triggers TARGET_ALREADY_REACHED", tpReachedResult.pass === false && tpReachedResult.vetoes[0]?.code === "TARGET_ALREADY_REACHED", tpReachedResult);

// 1.3 Dealing range blown
const tradeWithRange = {
  ...baseTradeBuy,
  dealingRange: { high: 1.0950, low: 1.0820 },
};
const blownRangeBars = [
  { open: 1.0830, high: 1.0835, low: 1.0810, close: 1.0815 }, // closed below 1.0820
];
const rangeBlownResult = evaluateLevelGeometry(tradeWithRange, 1.0850, { M15: blownRangeBars });
assert("Dealing range low closed below triggers DEALING_RANGE_BLOWN", rangeBlownResult.pass === false && rangeBlownResult.vetoes[0]?.code === "DEALING_RANGE_BLOWN", rangeBlownResult);

// 1.4 Clean geometry passes
const cleanGeoResult = evaluateLevelGeometry(baseTradeBuy, 1.0855);
assert("Clean geometry passes with full score (25 pts)", cleanGeoResult.pass === true && cleanGeoResult.score === 25, cleanGeoResult);

// ---------------------------------------------------------------------------
// 2. Pillar 2: Adverse Freight Train / Momentum Expansion
// ---------------------------------------------------------------------------
console.log("\n--- 2. Testing Pillar 2: Adverse Freight Train vs Healthy Retracement ---");

// Helper to construct candle series
function makeCandles(arr, avg = 0.0010) {
  return arr.map((c, i) => ({
    time: 1700000000 + i * 900,
    open: c.o,
    high: c.h,
    low: c.l,
    close: c.c,
    volume: 1000,
  }));
}

// 2.1 Freight Train: 3 consecutive massive marubozu bearish candles crashing into buy entry
const baselineBars = Array.from({ length: 30 }, (_, i) => ({
  time: 1700000000 + i * 900,
  open: 1.0900,
  high: 1.0905,
  low: 1.0895,
  close: 1.0902,
  volume: 1000,
})); // avg range is ~0.0010

const freightTrainApproach = [
  ...baselineBars,
  { time: 1700030000, open: 1.0920, high: 1.0922, low: 1.0890, close: 1.0892, volume: 5000 }, // range: 0.0032 (3.2x ATR), body: 0.0028 (>87%)
  { time: 1700030900, open: 1.0892, high: 1.0894, low: 1.0865, close: 1.0867, volume: 6000 }, // range: 0.0029, body: 0.0025 (>86%)
  { time: 1700031800, open: 1.0867, high: 1.0868, low: 1.0845, close: 1.0848, volume: 7000 }, // range: 0.0023, body: 0.0019 (>82%)
];

const freightTrainResult = evaluateAdverseVelocity(baseTradeBuy, { M15: freightTrainApproach });
assert("3 marubozu candles (>2x ATR) triggers ADVERSE_FREIGHT_TRAIN", freightTrainResult.pass === false && freightTrainResult.vetoes[0]?.code === "ADVERSE_FREIGHT_TRAIN", freightTrainResult);

// 2.2 Healthy gradual retracement (overlapping candles, normal wicks, normal ATR)
const healthyRetracementApproach = [
  ...baselineBars,
  { time: 1700030000, open: 1.0870, high: 1.0875, low: 1.0862, close: 1.0865, volume: 1200 }, // normal small candle
  { time: 1700030900, open: 1.0865, high: 1.0868, low: 1.0855, close: 1.0858, volume: 1100 },
  { time: 1700031800, open: 1.0858, high: 1.0860, low: 1.0850, close: 1.0853, volume: 1000 },
];
const healthyVelocityResult = evaluateAdverseVelocity(baseTradeBuy, { M15: healthyRetracementApproach });
assert("Healthy gradual retracement passes velocity check (25 pts)", healthyVelocityResult.pass === true && healthyVelocityResult.score === 25, healthyVelocityResult);

// ---------------------------------------------------------------------------
// 3. Pillar 3: Model-Specific Entry Integrity
// ---------------------------------------------------------------------------
console.log("\n--- 3. Testing Pillar 3: Model-Specific Entry Integrity ---");

// 3.1 Model 1: ICT 2022 — Virgin FVG Inversion Failure
const tradeIct2022 = {
  ...baseTradeBuy,
  modelId: "ict_2022",
  stagedLevel: {
    fvg: { top: 1.0860, bottom: 1.0845, ce: 1.08525 },
  },
};
const invertedFvgBars = [
  { open: 1.0855, high: 1.0858, low: 1.0838, close: 1.0840 }, // closed below fvg.bottom (1.0845)
];
const ictFvgInvertResult = evaluateModelSpecificIntegrity(tradeIct2022, { M15: invertedFvgBars });
assert("M15 close below virgin FVG floor triggers FVG_INVERTED_FAILURE", ictFvgInvertResult.pass === false && ictFvgInvertResult.vetoes[0]?.code === "FVG_INVERTED_FAILURE", ictFvgInvertResult);

// Clean ICT 2022 FVG holding above floor
const cleanFvgBars = [
  { open: 1.0860, high: 1.0862, low: 1.0848, close: 1.0852 }, // low tapped 1.0848, closed at 1.0852 inside FVG
];
const cleanIctResult = evaluateModelSpecificIntegrity(tradeIct2022, { M15: cleanFvgBars });
assert("Clean FVG tap holding above floor passes ICT 2022 check", cleanIctResult.pass === true && cleanIctResult.score === 25, cleanIctResult);

// 3.2 Model 2: Turtle Soup — Runaway Breakout vs Sweep Reclaim
const tradeTurtle = {
  ...baseTradeBuy,
  modelId: "turtle_soup",
  stagedLevel: {
    sweptLevel: 1.0850,
  },
  initialRiskDistance: 0.0020,
};
const runawayBreakoutBars = [
  { open: 1.0840, high: 1.0842, low: 1.0820, close: 1.0822 }, // closed at 1.0822 (well below 1.0850 - 0.0024 = 1.0826)
];
const turtleRunawayResult = evaluateModelSpecificIntegrity(tradeTurtle, { M15: runawayBreakoutBars });
assert("Closed bar well below swept level triggers SWEEP_FAILED_BREAKOUT", turtleRunawayResult.pass === false && turtleRunawayResult.vetoes[0]?.code === "SWEEP_FAILED_BREAKOUT", turtleRunawayResult);

const cleanTurtleBars = [
  { open: 1.0855, high: 1.0858, low: 1.0846, close: 1.0852 }, // pierced 1.0850 down to 1.0846, closed back at 1.0852
];
const cleanTurtleResult = evaluateModelSpecificIntegrity(tradeTurtle, { M15: cleanTurtleBars });
assert("Clean liquidity raid and wick reclaim passes Turtle Soup check", cleanTurtleResult.pass === true && cleanTurtleResult.score === 25, cleanTurtleResult);

// 3.3 Model 3: Breaker Block — Breaker Structure Broken
const tradeBreaker = {
  ...baseTradeBuy,
  modelId: "breaker_block",
  stagedLevel: {
    breaker: { top: 1.0865, bottom: 1.0848 },
  },
};
const breakerBrokenBars = [
  { open: 1.0850, high: 1.0852, low: 1.0840, close: 1.0844 }, // closed below breaker.bottom (1.0848)
];
const breakerBrokenResult = evaluateModelSpecificIntegrity(tradeBreaker, { M15: breakerBrokenBars });
assert("Candle close below breaker bottom triggers BREAKER_STRUCTURE_BROKEN", breakerBrokenResult.pass === false && breakerBrokenResult.vetoes[0]?.code === "BREAKER_STRUCTURE_BROKEN", breakerBrokenResult);

const cleanBreakerBars = [
  { open: 1.0862, high: 1.0865, low: 1.0850, close: 1.0855 }, // tested inside breaker [1.0848, 1.0865]
];
const cleanBreakerResult = evaluateModelSpecificIntegrity(tradeBreaker, { M15: cleanBreakerBars });
assert("Retest holding inside breaker passes Breaker Block check", cleanBreakerResult.pass === true && cleanBreakerResult.score === 25, cleanBreakerResult);

// 3.4 Model 4: OTE Continuation — 100% Swing Anchor Invalidation
const tradeOte = {
  ...baseTradeBuy,
  modelId: "ote_continuation",
  stagedLevel: {
    ote: { swingOrigin: 1.0835, fib62: 1.0860, fib79: 1.0845 },
  },
};
const oteBreachedBars = [
  { open: 1.0840, high: 1.0842, low: 1.0830, close: 1.0832 }, // closed below swingOrigin (1.0835)
];
const oteBreachedResult = evaluateModelSpecificIntegrity(tradeOte, { M15: oteBreachedBars });
assert("Close beyond 100% retracement triggers OTE_SWING_ANCHOR_BREACHED", oteBreachedResult.pass === false && oteBreachedResult.vetoes[0]?.code === "OTE_SWING_ANCHOR_BREACHED", oteBreachedResult);

const cleanOteBars = [
  { open: 1.0865, high: 1.0868, low: 1.0848, close: 1.0852 }, // tapped 62-79% pocket, held above 1.0835
];
const cleanOteResult = evaluateModelSpecificIntegrity(tradeOte, { M15: cleanOteBars });
assert("Clean retracement into 62-79% pocket passes OTE check", cleanOteResult.pass === true && cleanOteResult.score === 25, cleanOteResult);

// ---------------------------------------------------------------------------
// 4. Pillar 4: External Market & Macro Regime
// ---------------------------------------------------------------------------
console.log("\n--- 4. Testing Pillar 4: External Market & Macro Regime ---");

// 4.1 Macro Bias Inversion (H4 macro shifted from Bullish to Bearish with high conviction)
const invertedBrain = {
  macroBias: "BEARISH",
  macroDir: -1,
  conviction: 80,
};
const macroInvertedResult = evaluateExternalRegime(baseTradeBuy, invertedBrain, {}, new Date("2026-10-07T14:00:00Z"));
assert("Macro bias flipped to Bearish on Buy trade triggers MACRO_BIAS_INVERTED", macroInvertedResult.pass === false && macroInvertedResult.vetoes[0]?.code === "MACRO_BIAS_INVERTED", macroInvertedResult);

// 4.2 Aligned Macro Bias passes
const alignedBrain = {
  macroBias: "BULLISH",
  macroDir: 1,
  conviction: 75,
};
const alignedMacroResult = evaluateExternalRegime(baseTradeBuy, alignedBrain, {}, new Date("2026-10-07T14:00:00Z"));
assert("Aligned macro bias passes external regime check (25 pts)", alignedMacroResult.pass === true && alignedMacroResult.score === 25, alignedMacroResult);

// 4.3 Dead Zone (00:00 - 02:00 EET spread spike window)
// 01:30 EET = 23:30 UTC previous day (or e.g. 01:30 Athens time)
const deadZoneDate = new Date("2026-10-07T01:30:00+03:00"); // 01:30 EET
const deadZoneResult = evaluateExternalRegime(baseTradeBuy, alignedBrain, { allowedTimeSlots: { dead_zone: false } }, deadZoneDate);
assert("Entry triggered during 00:00-02:00 EET dead zone triggers DEAD_ZONE_RESTRICTION", deadZoneResult.pass === false && deadZoneResult.vetoes[0]?.code === "DEAD_ZONE_RESTRICTION", deadZoneResult);

// ---------------------------------------------------------------------------
// 5. Master Coordinator: validatePreEntrySetup
// ---------------------------------------------------------------------------
console.log("\n--- 5. Testing Master Coordinator validatePreEntrySetup ---");

// 5.1 Fully valid setup -> PROCEED, Score 100/100
const fullValidResult = await validatePreEntrySetup({
  trade: tradeIct2022,
  frames: { M15: cleanFvgBars },
  currentPrice: 1.0852,
  brain: alignedBrain,
  config: { allowedTimeSlots: { dead_zone: false } },
  now: new Date("2026-10-07T15:30:00+03:00"), // NY Open
});

assert("Fully valid setup returns ok: true", fullValidResult.ok === true, fullValidResult.ok);
assert("Fully valid setup returns action: PROCEED", fullValidResult.action === "PROCEED", fullValidResult.action);
assert("Fully valid setup receives perfect 100/100 score", fullValidResult.score === 100, fullValidResult.score);
assert("Fully valid setup has zero vetoes", fullValidResult.vetoes.length === 0, fullValidResult.vetoes);

// 5.2 Invalidated setup (FVG failed + Macro bias inverted) -> VETO
const invalidatedSetupResult = await validatePreEntrySetup({
  trade: tradeIct2022,
  frames: { M15: invertedFvgBars },
  currentPrice: 1.0840,
  brain: invertedBrain,
  config: { allowedTimeSlots: { dead_zone: false } },
  now: new Date("2026-10-07T15:30:00+03:00"),
});

assert("Invalidated setup returns ok: false", invalidatedSetupResult.ok === false, invalidatedSetupResult.ok);
assert("Invalidated setup returns action: VETO", invalidatedSetupResult.action === "VETO", invalidatedSetupResult.action);
assert("Invalidated setup captures specific structural reasons", invalidatedSetupResult.vetoes.some(v => v.code === "FVG_INVERTED_FAILURE"), invalidatedSetupResult.reasons);
assert("Invalidated setup captures external macro reason", invalidatedSetupResult.vetoes.some(v => v.code === "MACRO_BIAS_INVERTED"), invalidatedSetupResult.reasons);

console.log("\n===============================================================================");
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("===============================================================================");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("🎯 ALL PRE-ENTRY VALIDATION ENGINE TESTS PASSED WITH 100% SUCCESS!\n");
  process.exit(0);
}
