import assert from "node:assert";
import { computeDealingRange, analyzeAllDealingRanges } from "./lib/bias/ranges.js";

const pass = (msg) => console.log(`✅ PASS: ${msg}`);

console.log("\n=======================================================");
console.log("TEST SUITE: Dealing Ranges Engine Forensic Audit");
console.log("=======================================================\n");

// ---------------------------------------------------------------------------
// 1. Equilibrium Band Reachability (Float Equality Elimination)
// ---------------------------------------------------------------------------
console.log("--- 1. Testing Equilibrium Band Reachability ---");

const eqBars = [
  { time: 1000, high: 200, low: 180, close: 190 },
  { time: 2000, high: 190, low: 100, close: 110 },
  { time: 3000, high: 155, low: 145, close: 151.25 }, // 151.25 on [100, 200] = 51.25% (inside 45-55% band)
];

const rEq = computeDealingRange(eqBars, "H4", 10.0);
assert(rEq != null, "Dealing range exists");
assert.strictEqual(rEq.zone, "EQUILIBRIUM", `Zone around 50% is EQUILIBRIUM: got ${rEq.zone}`);
pass("Equilibrium band (45-55%) correctly classifies price near midpoint as EQUILIBRIUM");

// ---------------------------------------------------------------------------
// 2. Honest rangeQuality Classification
// ---------------------------------------------------------------------------
console.log("\n--- 2. Testing Honest rangeQuality ---");

// Truncated bars with no fractals (fallback path)
const fallbackBars = [
  { time: 1000, open: 100, high: 105, low: 99, close: 103 },
  { time: 2000, open: 103, high: 108, low: 102, close: 107 },
];
const rFallback = computeDealingRange(fallbackBars, "H4", 5.0);
assert(rFallback != null, "Fallback range created");
assert.strictEqual(rFallback.rangeQuality, "FALLBACK_WINDOW_EXTREMES", `Fallback labeled correctly: got ${rFallback.rangeQuality}`);
pass("Fallback window extremes labeled as FALLBACK_WINDOW_EXTREMES (not falsely claimed as confirmed fractals)");

// Tiny sub-ATR compressed range
const compressedBars = [
  { time: 1000, open: 100, high: 101, low: 99.8, close: 100.5 },
  { time: 2000, open: 100.5, high: 101.2, low: 99.9, close: 100.8 },
  { time: 3000, open: 100.8, high: 101.3, low: 100.0, close: 100.6 },
];
const rCompressed = computeDealingRange(compressedBars, "H4", 5.0); // ATR = 5.0, range = 1.5 (<0.8 ATR)
assert.strictEqual(rCompressed.rangeQuality, "SUB_ATR_COMPRESSION", `Sub-ATR range flagged: got ${rCompressed.rangeQuality}`);
pass("Sub-ATR compressed range identified with SUB_ATR_COMPRESSION");

// ---------------------------------------------------------------------------
// 3. Structural Leg Direction, Fibs & OTE Levels
// ---------------------------------------------------------------------------
console.log("\n--- 3. Testing Direction, Fibs & Institutional OTE ---");

const bullLegBars = [];
// Bar 10 is low at 100 (t = 2000), Bar 20 is high at 200 (t = 4000) -> Bullish leg (Low formed before High)
for (let i = 0; i < 40; i++) {
  const t = 1000 + i * 100;
  const h = i === 20 ? 200 : 150;
  const l = i === 10 ? 100 : 140;
  bullLegBars.push({ time: t, open: 145, high: h, low: l, close: 146 });
}

const rBull = computeDealingRange(bullLegBars, "H4", 10.0, { currentPrice: 150 });
assert.strictEqual(rBull.direction, 1, `Bullish leg direction is 1: got ${rBull.direction}`);
assert.strictEqual(rBull.fibs.eq, 150, "Fibs EQ is 150");
assert.strictEqual(rBull.fibs.ote705, 170.5, `Bullish OTE 70.5% is 170.5: got ${rBull.fibs.ote705}`);
assert.strictEqual(rBull.fibs.premium618, 161.8, `Bullish 61.8% is 161.8: got ${rBull.fibs.premium618}`);
assert.strictEqual(rBull.erl.high.price, 200, "ERL High is 200");
assert.strictEqual(rBull.erl.low.price, 100, "ERL Low is 100");
pass("Structural leg direction and institutional Fibonacci/OTE levels computed accurately");

// ---------------------------------------------------------------------------
// 4. Live Price Synchronization Across Timeframes
// ---------------------------------------------------------------------------
console.log("\n--- 4. Testing Live Price Synchronization ---");

const h4Bars = [
  { time: 1000, high: 200, low: 100, close: 110 }, // 4H closed at 110 (4 hours ago)
  { time: 5000, high: 200, low: 100, close: 120 },
];
const m15Bars = [
  { time: 4500, high: 170, low: 130, close: 160 },
  { time: 4800, high: 180, low: 130, close: 175 }, // Live price is 175 on M15!
];

const allR = analyzeAllDealingRanges({ H4: h4Bars, M15: m15Bars }, {}, { currentPrice: 175 });
assert.strictEqual(allR.ranges.H4.currentPrice, 175, `H4 evaluated with synchronized live price 175: got ${allR.ranges.H4.currentPrice}`);
assert.strictEqual(allR.ranges.M15.currentPrice, 175, `M15 evaluated with synchronized live price 175: got ${allR.ranges.M15.currentPrice}`);
pass("analyzeAllDealingRanges synchronizes all timeframe ranges to current live price");

// ---------------------------------------------------------------------------
// 5. Dynamic & Honest Alignment Strings
// ---------------------------------------------------------------------------
console.log("\n--- 5. Testing Dynamic Alignment Notes ---");

// Bullish expansion in Premium (65% covered)
const framesPrem = {
  H4: [
    { time: 1000, high: 200, low: 100, close: 165 },
    { time: 2000, high: 200, low: 100, close: 165 },
  ],
  M15: [
    { time: 1800, high: 180, low: 150, close: 160 },
    { time: 1900, high: 180, low: 150, close: 165 },
  ],
};
const resPrem = analyzeAllDealingRanges(framesPrem, { H4: { dir: 1 } }, { currentPrice: 165 });
const bullAlign = resPrem.alignments.find((a) => a.type === "BULLISH_UNCOVERED_EXPANSION");
assert(bullAlign != null, "Bullish alignment generated");
assert(bullAlign.note.includes("Premium"), `Note honestly identifies Premium when coverage > 50%: got "${bullAlign.note}"`);
pass("Alignment notes dynamically and honestly distinguish between Discount and Premium");

// ---------------------------------------------------------------------------
// 6. Timeframe Alias Resolution
// ---------------------------------------------------------------------------
console.log("\n--- 6. Testing Timeframe Alias Normalization ---");

const framesAlias = {
  "15M": m15Bars,
  "30M": m15Bars,
  "4H": h4Bars,
  "1D": h4Bars,
};
const resAlias = analyzeAllDealingRanges(framesAlias);
assert(resAlias.ranges.M15 != null, "15M resolved to M15");
assert(resAlias.ranges.M30 != null, "30M resolved to M30");
assert(resAlias.ranges.H4 != null, "4H resolved to H4");
assert(resAlias.ranges.D1 != null, "1D resolved to D1");
pass("All common timeframe aliases (15M, 30M, 4H, 1D) resolved seamlessly");

console.log("\n=======================================================");
console.log("🎯 ALL 6 DEALING RANGES AUDIT TESTS PASSED 100%!");
console.log("=======================================================\n");
