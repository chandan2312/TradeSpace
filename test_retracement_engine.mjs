// test_retracement_engine.mjs — Verification of Retracement Quality & Velocity Physics Engine
import assert from "node:assert/strict";
import {
  RETRACEMENT_STAGES,
  analyzeRetracementQuality,
  analyzeAllRetracements,
  computeCausalAtr,
} from "./lib/bias/retracement.js";
import { computeSymbolBias } from "./lib/bias/engine.js";

console.log("===============================================================================");
console.log("TEST SUITE: Institutional SMC Retracement Quality & Velocity Physics Engine");
console.log("===============================================================================\n");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// Helper to generate synthetic candlestick series
function createCandle(i, open, high, low, close, time = 1700000000 + i * 900) {
  return { time, open, high, low, close, volume: 1000, closed: true, isClosed: true };
}

// -----------------------------------------------------------------------------
// 1. DYNAMIC IMPULSE LEG DISCOVERY & FIBONACCI DEPTH
// -----------------------------------------------------------------------------
console.log("--- 1. Testing Fibonacci Depth Zones & Stage Classification ---");

// Build a clean bullish swing:
// Base at 100.0, rallies up to 120.0 over 8 bars, then pulls back
function makeBullishSwing(pullbackClose, pullbackBarsCount = 6) {
  const bars = [];
  // 5 initial base bars
  for (let i = 0; i < 5; i++) {
    bars.push(createCandle(bars.length, 100 + i * 0.1, 100.5, 99.8, 100.2));
  }
  // Low pivot at index 5 (price = 99.5)
  bars.push(createCandle(bars.length, 100.0, 100.2, 99.5, 100.1));
  bars.push(createCandle(bars.length, 100.1, 100.6, 99.8, 100.4));
  bars.push(createCandle(bars.length, 100.4, 101.0, 100.2, 100.9));

  // Impulse expansion to 120.0
  bars.push(createCandle(bars.length, 101.0, 105.0, 100.8, 104.5));
  bars.push(createCandle(bars.length, 104.5, 110.0, 104.2, 109.8));
  bars.push(createCandle(bars.length, 109.8, 116.0, 109.5, 115.5));
  // Apex High Pivot at index 11 (price = 120.0)
  bars.push(createCandle(bars.length, 115.5, 120.0, 115.2, 119.8));
  bars.push(createCandle(bars.length, 119.5, 119.8, 118.5, 118.8));
  bars.push(createCandle(bars.length, 118.8, 119.0, 118.0, 118.4));

  // Pullback bars stepping smoothly from 118.4 down to pullbackClose
  const pbCount = Math.max(1, pullbackBarsCount);
  const startP = 118.4;
  for (let i = 1; i <= pbCount; i++) {
    const prevC = i === 1 ? startP : bars[bars.length - 1].close;
    const c = startP + (pullbackClose - startP) * (i / pbCount);
    const o = prevC;
    const h = Math.max(o, c) + 0.3;
    const l = Math.min(o, c) - 0.3;
    bars.push(createCandle(bars.length, o, h, l, c));
  }
  return bars;
}

test("Stage 1: Shallow Chasing (< 38.2% retracement)", () => {
  // Origin ~ 99.5, Crest = 120.0. Impulse = 20.5.
  // 25% retracement -> close ~ 114.8
  const bars = makeBullishSwing(115.5, 6);
  const res = analyzeRetracementQuality(bars, 1, { tf: "M15", avg: 2.0 });
  assert.ok(res, "Retracement analysis returned result");
  assert.equal(res.stage, RETRACEMENT_STAGES.SHALLOW_CHASING);
  assert.ok(res.depthPct < 38.2, `Depth ${res.depthPct}% is < 38.2%`);
  assert.equal(res.qualityGrade, "C");
  assert.equal(res.brainReadiness.action, "WAIT_PULLBACK");
  assert.equal(res.brainReadiness.allowedToTrade, false);
});

test("Stage 2: Equilibrium Discount (38.2% - 61.8% retracement)", () => {
  // 50% retracement -> close ~ 109.75
  const bars = makeBullishSwing(109.5, 6);
  const res = analyzeRetracementQuality(bars, 1, { tf: "M15", avg: 2.0 });
  assert.ok(res);
  assert.equal(res.stage, RETRACEMENT_STAGES.EQUILIBRIUM_DISCOUNT);
  assert.ok(res.depthPct >= 38.2 && res.depthPct < 61.8);
  assert.ok(["B", "B+"].includes(res.qualityGrade));
});

test("Stage 3: OTE Golden Pocket (61.8% - 78.6% retracement)", () => {
  // 70.5% sweet spot -> close ~ 105.5
  const bars = makeBullishSwing(105.5, 8);
  const res = analyzeRetracementQuality(bars, 1, { tf: "M15", avg: 2.0 });
  assert.ok(res);
  assert.equal(res.stage, RETRACEMENT_STAGES.OTE_GOLDEN_POCKET);
  assert.ok(res.inOtePocket, "inOtePocket flag is true");
  assert.ok(res.depthPct >= 61.8 && res.depthPct <= 78.6);
  assert.ok(["A", "A+"].includes(res.qualityGrade));
  assert.equal(res.brainReadiness.action, "APPROVED");
  assert.equal(res.brainReadiness.allowedToTrade, true);
  assert.ok(res.score >= 8, `Score ${res.score} >= 8`);
});

test("Stage 4: Deep Origin Test (78.6% - 100.0% retracement)", () => {
  // 90% retracement -> close ~ 101.5
  const bars = makeBullishSwing(101.5, 8);
  const res = analyzeRetracementQuality(bars, 1, { tf: "M15", avg: 2.0 });
  assert.ok(res);
  assert.equal(res.stage, RETRACEMENT_STAGES.DEEP_ORIGIN_TEST);
  assert.ok(res.depthPct > 78.6 && res.depthPct <= 100.0);
  assert.ok(res.score <= 4);
});

test("Stage 5: Origin Violated (> 100.0% structural invalidation)", () => {
  // 110% retracement -> close 97.0 (below origin 99.5)
  const bars = makeBullishSwing(97.0, 8);
  const res = analyzeRetracementQuality(bars, 1, { tf: "M15", avg: 2.0 });
  assert.ok(res);
  assert.equal(res.stage, RETRACEMENT_STAGES.ORIGIN_VIOLATED);
  assert.ok(res.isOriginBreached, "isOriginBreached is true");
  assert.equal(res.qualityGrade, "F");
  assert.equal(res.score, -14);
  assert.equal(res.brainReadiness.action, "STAND_ASIDE");
  assert.equal(res.brainReadiness.allowedToTrade, false);
});

// -----------------------------------------------------------------------------
// 2. CANDLE VELOCITY PHYSICS (CORRECTIVE COMPRESSION VS FREIGHT TRAIN)
// -----------------------------------------------------------------------------
console.log("\n--- 2. Testing Candle Velocity Physics ---");

test("Velocity Physics: Corrective Compression into OTE yields A+ grade", () => {
  // 12 bars of slow, tight-range overlapping candles into OTE (105.5)
  // Low velocity ratio <= 0.75, avg body < 0.75x ATR
  const slowBars = [];
  // base
  for (let i = 0; i < 5; i++) slowBars.push(createCandle(slowBars.length, 100, 100.4, 99.8, 100.1));
  slowBars.push(createCandle(slowBars.length, 100.0, 100.2, 99.5, 100.1));
  slowBars.push(createCandle(slowBars.length, 100.1, 100.6, 99.8, 100.4));
  slowBars.push(createCandle(slowBars.length, 100.4, 101.0, 100.2, 100.9));
  // Fast 3-bar explosive impulse to 120.0
  slowBars.push(createCandle(slowBars.length, 101.0, 108.0, 100.8, 107.5));
  slowBars.push(createCandle(slowBars.length, 107.5, 115.0, 107.2, 114.8));
  slowBars.push(createCandle(slowBars.length, 114.8, 120.0, 114.5, 119.8));
  slowBars.push(createCandle(slowBars.length, 119.5, 119.8, 118.5, 118.7));
  slowBars.push(createCandle(slowBars.length, 118.7, 118.9, 118.0, 118.2));

  // 10 slow corrective grind bars reaching 105.5 (each candle body only 0.8)
  for (let i = 0; i < 10; i++) {
    const p = 118.0 - i * 1.25;
    slowBars.push(createCandle(slowBars.length, p, p + 0.5, p - 0.8, p - 0.6));
  }

  const res = analyzeRetracementQuality(slowBars, 1, { tf: "M15", avg: 2.0 });
  assert.ok(res);
  assert.equal(res.stage, RETRACEMENT_STAGES.OTE_GOLDEN_POCKET);
  assert.ok(res.isCorrective, "isCorrective is true");
  assert.equal(res.isFreightTrain, false, "isFreightTrain is false");
  assert.equal(res.qualityGrade, "A+");
  assert.ok(res.score >= 10, `Score ${res.score} >= 10 for A+ corrective OTE`);
});

test("Velocity Physics: Adverse Freight Train plunge into zone triggers Grade F", () => {
  // Violent 2-bar liquidation marubozus plunging from 120 to 105 (each candle body 7.5 = >3.5x ATR)
  const freightBars = [];
  // base
  for (let i = 0; i < 5; i++) freightBars.push(createCandle(freightBars.length, 100, 100.4, 99.8, 100.1));
  freightBars.push(createCandle(freightBars.length, 100.0, 100.2, 99.5, 100.1));
  freightBars.push(createCandle(freightBars.length, 100.1, 100.6, 99.8, 100.4));
  freightBars.push(createCandle(freightBars.length, 100.4, 101.0, 100.2, 100.9));
  // 6-bar impulse to 120
  for (let i = 1; i <= 6; i++) {
    const p = 101 + i * 3.1;
    freightBars.push(createCandle(freightBars.length, p - 3, p + 0.5, p - 3.2, p));
  }
  freightBars.push(createCandle(freightBars.length, 119.5, 119.8, 118.5, 118.7));
  freightBars.push(createCandle(freightBars.length, 118.7, 118.9, 118.0, 118.2));

  // 2 giant adverse freight train candles
  freightBars.push(createCandle(freightBars.length, 118.0, 118.2, 110.0, 110.5)); // 7.5 body
  freightBars.push(createCandle(freightBars.length, 110.5, 110.8, 104.5, 105.0)); // 5.5 body

  const res = analyzeRetracementQuality(freightBars, 1, { tf: "M15", avg: 2.0 });
  assert.ok(res);
  assert.equal(res.isFreightTrain, true, "isFreightTrain is detected");
  assert.equal(res.qualityGrade, "F");
  assert.equal(res.score, -12);
  assert.equal(res.brainReadiness.action, "WAIT_FOR_MSS");
  assert.equal(res.brainReadiness.allowedToTrade, false);
});

// -----------------------------------------------------------------------------
// 3. MULTI-TIMEFRAME SYNTHESIS (analyzeAllRetracements)
// -----------------------------------------------------------------------------
console.log("\n--- 3. Testing Multi-Timeframe Retracement Synthesis ---");

test("Multi-Timeframe: Dual-Timeframe OTE Nesting scores A+ (composite score 12)", () => {
  const m15Bars = makeBullishSwing(105.5, 8); // OTE
  const h1Bars = makeBullishSwing(105.5, 8);  // OTE

  const frames = { M15: m15Bars, H1: h1Bars };
  const structures = { M15: { dir: 1 }, H1: { dir: 1 } };
  const dealingRanges = { ranges: { M15: { zone: "DISCOUNT", pos: 0.35, currentPrice: 105.5, eq: 110 }, H1: { zone: "DISCOUNT", pos: 0.35, currentPrice: 105.5, eq: 110 } } };

  const synthesis = analyzeAllRetracements(frames, structures, dealingRanges, 1);
  assert.ok(synthesis.m15, "M15 evaluated");
  assert.ok(synthesis.h1, "H1 evaluated");
  assert.equal(synthesis.compositeGrade, "A+");
  assert.equal(synthesis.compositeScore, 12);
  const dualOteDrive = synthesis.drives.find((d) => d.label === "Dual-Timeframe OTE Nesting");
  assert.ok(dualOteDrive, "Dual-Timeframe OTE Nesting drive emitted");
  assert.equal(dualOteDrive.w, 10);
});

// -----------------------------------------------------------------------------
// 4. BIAS ENGINE & BRAIN INTEGRATION
// -----------------------------------------------------------------------------
console.log("\n--- 4. Testing Bias Engine & Brain Integration ---");

test("Bias Engine & Brain: computeSymbolBias populates retracements and brainReadiness", () => {
  const m15Bars = makeBullishSwing(105.5, 8);
  const h1Bars = makeBullishSwing(105.5, 8);
  const h4Bars = makeBullishSwing(105.5, 8);
  const d1Bars = makeBullishSwing(105.5, 8);

  const frames = { M15: m15Bars, H1: h1Bars, H4: h4Bars, D1: d1Bars };
  const bias = computeSymbolBias("EURUSD", frames);

  assert.ok(bias, "Bias computed successfully");
  assert.ok(bias.retracements, "bias.retracements is attached");
  assert.ok(bias.retracements.M15, "bias.retracements.M15 is present");
  assert.ok(bias.retracementSummary, "bias.retracementSummary is present");
  assert.ok(bias.brain, "bias.brain is present");
  assert.ok(bias.brain.retracement, "bias.brain.retracement is present");
  assert.equal(bias.brain.retracement.compositeGrade, "A+");
  assert.ok(bias.executionReadiness, "bias.executionReadiness is present");
  assert.ok(bias.executionReadiness.allowedToShort || bias.executionReadiness.allowedToLong, "executionReadiness approves trade in OTE sweet spot");
});

console.log("\n===============================================================================");
console.log(`TEST SUMMARY: ${passed} PASSED, 0 FAILED`);
console.log("===============================================================================");
console.log("🎯 ALL RETRACEMENT ENGINE TESTS PASSED WITH 100% SUCCESS!");
