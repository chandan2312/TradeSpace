import assert from "node:assert";
import {
  confirmedFractals,
  displacementAt,
  detectPDArrays,
  detectLiquidityRaids,
} from "./lib/bias/institutional.js";

const pass = (msg) => console.log(`✅ PASS: ${msg}`);

console.log("\n=======================================================");
console.log("TEST SUITE: Institutional Evidence Engine Forensic Audit");
console.log("=======================================================\n");

// ---------------------------------------------------------------------------
// 1. Plateau & Tie-Break Fractal Swings (Eliminates Equal High/Low Deletion)
// ---------------------------------------------------------------------------
console.log("--- 1. Testing Fractal Plateau / Equal Highs & Lows ---");

// Flat top / Double top (bars at index 2 and 3 both have high = 20)
const flatTopBars = [
  { time: 1000, high: 10, low: 5, open: 6, close: 9 },
  { time: 2000, high: 15, low: 9, open: 10, close: 14 },
  { time: 3000, high: 20, low: 14, open: 15, close: 19 }, // plateau start
  { time: 4000, high: 20, low: 13, open: 18, close: 17 }, // plateau end (confirmed swing)
  { time: 5000, high: 15, low: 10, open: 16, close: 11 },
  { time: 6000, high: 10, low: 6, open: 11, close: 8 },
  { time: 7000, high: 8, low: 4, open: 7, close: 5 },
];

const fractalsFlat = confirmedFractals(flatTopBars, 5);
assert.strictEqual(fractalsFlat.highs.length, 1, "Equal high flat top is NOT deleted");
assert.strictEqual(fractalsFlat.highs[0].price, 20, "Equal high price is 20");
assert.strictEqual(fractalsFlat.highs[0].i, 3, "Swing anchored to the right edge of plateau");
assert.strictEqual(fractalsFlat.highs[0].isPlateau, true, "isPlateau flagged as true");
assert.strictEqual(fractalsFlat.highs[0].plateauLength, 2, "plateauLength is 2");
pass("Equal high flat top successfully detected and anchored to plateau right edge");

// Flat bottom / Double bottom (bars at index 2 and 3 both have low = 10)
const flatBottomBars = [
  { time: 1000, high: 30, low: 25, open: 29, close: 26 },
  { time: 2000, high: 25, low: 18, open: 24, close: 19 },
  { time: 3000, high: 18, low: 10, open: 17, close: 12 }, // plateau start
  { time: 4000, high: 17, low: 10, open: 13, close: 14 }, // plateau end
  { time: 5000, high: 22, low: 14, open: 15, close: 20 },
  { time: 6000, high: 28, low: 19, open: 21, close: 26 },
  { time: 7000, high: 32, low: 24, open: 27, close: 30 },
];

const fractalsBottom = confirmedFractals(flatBottomBars, 5);
assert.strictEqual(fractalsBottom.lows.length, 1, "Equal low flat bottom is NOT deleted");
assert.strictEqual(fractalsBottom.lows[0].price, 10, "Equal low price is 10");
assert.strictEqual(fractalsBottom.lows[0].i, 3, "Swing anchored to right edge of plateau");
assert.strictEqual(fractalsBottom.lows[0].isPlateau, true, "isPlateau flagged as true");
pass("Equal low flat bottom successfully detected and anchored to plateau right edge");

// ---------------------------------------------------------------------------
// 2. Volume Extraction Bug Fix & Standardized Displacement
// ---------------------------------------------------------------------------
console.log("\n--- 2. Testing Volume Extraction & Displacement ---");

const tickVolumeBars = [
  { time: 1000, open: 100, high: 101, low: 99, close: 100.5, v: 0, tick_volume: 500 },
  { time: 2000, open: 100.5, high: 102, low: 100, close: 101.5, v: 0, tick_volume: 600 },
  { time: 3000, open: 101.5, high: 105, low: 101, close: 104.8, v: 0, tick_volume: 1800 }, // Displacement bar
];

const disp = displacementAt(tickVolumeBars, 2, 1, { avg: 1.5 });
assert.strictEqual(disp.valid, true, "Displacement is valid");
assert(disp.volumeRatio != null && disp.volumeRatio > 2.0, `Volume ratio correctly extracted from tick_volume: got ${disp.volumeRatio}`);
assert.strictEqual(disp.volumeConfirmed, true, "Volume confirmed via tick_volume");
assert.strictEqual(disp.closeInExtreme, true, "Bullish bar closes in upper 30% of range");
pass("volumeOf successfully falls back from v:0 to tick_volume and validates displacement");

// ---------------------------------------------------------------------------
// 3. Lifecycle: Non-Drifting respectedAt & Natural RESPECTED State
// ---------------------------------------------------------------------------
console.log("\n--- 3. Testing Non-Drifting respectedAt & RESPECTED State ---");

const fvgBars = [
  { time: 1000, open: 100, high: 101, low: 99, close: 100.5 },
  { time: 2000, open: 100.5, high: 106, low: 100.4, close: 105.8 }, // displacement
  { time: 3000, open: 105.8, high: 108, low: 103, close: 107 }, // FVG formed [101, 103]
  { time: 4000, open: 105, high: 105.5, low: 101.5, close: 102.5 }, // Bar 3: Retest inside [101, 103] -> closes inside
  { time: 5000, open: 102.5, high: 109, low: 102.0, close: 108.5 }, // Bar 4: Expands away and closes above top (103) -> RESPECTED
  { time: 6000, open: 108.5, high: 111, low: 108, close: 110.5 }, // Bar 5: Continues trending up
  { time: 7000, open: 110.5, high: 114, low: 110, close: 113.5 }, // Bar 6: Continues trending up
];

const pdResult = detectPDArrays(fvgBars, { tf: "M15", atr: 2.0 });
const testFvg = pdResult.fvgs.find((z) => z.dir === 1);
assert(testFvg != null, "Bullish FVG detected");
assert.strictEqual(testFvg.state, "RESPECTED", `Natural zone transitions to RESPECTED: got ${testFvg.state}`);
assert.strictEqual(testFvg.mitigatedAt, 3, "mitigatedAt records first test at bar 3");
assert.strictEqual(testFvg.respectedAt, 4, `respectedAt records initial respect at bar 4: got ${testFvg.respectedAt}`);
assert.strictEqual(testFvg.respectTime, 5000, "respectTime does NOT drift to bar 6 timestamp");
pass("Natural zone state transitions to RESPECTED and respectedAt does not drift on subsequent bars");

// ---------------------------------------------------------------------------
// 4. Lifecycle: Distinct originalLife and invertedLife Tracking
// ---------------------------------------------------------------------------
console.log("\n--- 4. Testing Distinct originalLife and invertedLife ---");

const ifvgBars = [
  { time: 1000, open: 100, high: 101, low: 99, close: 100.5 },
  { time: 2000, open: 100.5, high: 106, low: 100.4, close: 105.8 },
  { time: 3000, open: 105.8, high: 108, low: 103, close: 107 }, // FVG formed [101, 103]
  { time: 4000, open: 107, high: 107.5, low: 98, close: 99 },   // Bar 3: Closes below bottom (101) -> INVERTED!
  { time: 5000, open: 99, high: 102.5, low: 98.5, close: 101.8 }, // Bar 4: Retests inside [101, 103] and closes inside
  { time: 6000, open: 101.8, high: 101.9, low: 96, close: 97 },   // Bar 5: Closes below bottom (101) -> RESPECTED_INVERTED!
];

const ifvgResult = detectPDArrays(ifvgBars, { tf: "M15", atr: 2.0 });
const invZone = ifvgResult.ifvgs[0];
assert(invZone != null, "iFVG detected");
assert.strictEqual(invZone.state, "RESPECTED_INVERTED", "Inverted zone state is RESPECTED_INVERTED");
assert.strictEqual(invZone.type, "INVERTED_RESISTANCE", `Inverted type updated to INVERTED_RESISTANCE: got ${invZone.type}`);
assert.strictEqual(invZone.dir, -1, "Operative dir flipped to -1");
assert.strictEqual(invZone.originalDir, 1, "Original dir preserved as 1");

// Verify separate life records
assert(invZone.originalLife != null, "originalLife record exists");
assert.strictEqual(invZone.originalLife.dir, 1, "originalLife dir is 1");
assert.strictEqual(invZone.originalLife.state, "INVERTED", "originalLife state is INVERTED");

assert(invZone.invertedLife != null, "invertedLife record exists");
assert.strictEqual(invZone.invertedLife.dir, -1, "invertedLife dir is -1");
assert.strictEqual(invZone.invertedLife.state, "RESPECTED_INVERTED", "invertedLife state is RESPECTED_INVERTED");
assert.strictEqual(invZone.invertedLife.mitigatedAt, 4, "invertedLife mitigatedAt is bar 4");
assert.strictEqual(invZone.invertedLife.respectedAt, 5, "invertedLife respectedAt is bar 5");
pass("iFVG tracks separate originalLife and invertedLife records with proper type polarity");

// ---------------------------------------------------------------------------
// 5. Order Blocks: Mean Threshold (MT) & Pre-Mitigation Protection
// ---------------------------------------------------------------------------
console.log("\n--- 5. Testing Order Block MT & Pre-Mitigation Protection ---");

// Construct pre-mitigated OB scenario:
// Bar 1: Swing High (pivot)
// Bar 2: Down candle (candidate OB)
// Bar 3: Candle breaches and closes below Bar 2 low (pre-mitigation violation)
// Bar 4: Massive spike breaks pivot
const preMitigatedBars = [
  { time: 1000, open: 100, high: 102, low: 98, close: 101 },
  { time: 2000, open: 101, high: 105, low: 100, close: 104 }, // Swing high (105)
  { time: 3000, open: 104, high: 104.5, low: 99, close: 99.5 },
  { time: 4000, open: 99.5, high: 100, low: 98, close: 98.5 },
  { time: 5000, open: 98.5, high: 101, low: 96, close: 97 }, // Pivot confirmed
  { time: 6000, open: 97, high: 98, low: 94, close: 94.5 }, // Candidate OB candle [high: 98, low: 94]
  { time: 7000, open: 94.5, high: 95, low: 91, close: 92 }, // Bar 7 closes at 92 (violates OB before the break!)
  { time: 8000, open: 92, high: 110, low: 91.5, close: 109 }, // Bar 8 breaks swing high
];

const preMitRes = detectPDArrays(preMitigatedBars, { tf: "H1", atr: 3.0 });
const hasPreMitOb = preMitRes.orderBlocks.some((ob) => ob.born === 7 && ob.originTime === 6000);
assert.strictEqual(hasPreMitOb, false, "Pre-mitigated candle is rejected from becoming an Order Block");
pass("Pre-mitigated candles strictly rejected from forming false Order Blocks");

// ---------------------------------------------------------------------------
// 6. Breaker Blocks Output
// ---------------------------------------------------------------------------
console.log("\n--- 6. Testing Breaker Blocks Generation ---");

const cleanObBars = [
  { time: 500,  open: 98,  high: 100, low: 97, close: 99 },   // 0
  { time: 1000, open: 99,  high: 102, low: 98, close: 101 },  // 1
  { time: 2000, open: 101, high: 105, low: 100, close: 104 }, // 2: Swing high (105) (left: 0, 1)
  { time: 3000, open: 104, high: 104.5, low: 99, close: 99.5 }, // 3: right 1
  { time: 4000, open: 99.5, high: 100, low: 98, close: 98.5 }, // 4: right 2 -> Confirmed at bar 4!
  { time: 5000, open: 98.5, high: 99, low: 94, close: 94.5 }, // 5: Valid OB candle [99, 94]
  { time: 6000, open: 94.5, high: 110, low: 94.2, close: 108 }, // 6: Break candle (breaks 105 with displacement)
  { time: 7000, open: 108, high: 108.5, low: 92, close: 93 }, // 7: Price crashes through OB -> Invalidates OB & creates Breaker!
];

const obWithBreaker = detectPDArrays(cleanObBars, { tf: "H1", atr: 3.0 });
assert.strictEqual(obWithBreaker.orderBlocks.length, 1, "Order block formed");
assert.strictEqual(obWithBreaker.orderBlocks[0].state, "INVALIDATED", "Order block was invalidated");
assert.strictEqual(obWithBreaker.breakers.length, 1, "Breaker block emitted");
assert.strictEqual(obWithBreaker.breakers[0].kind, "BREAKER", "Breaker kind is BREAKER");
assert.strictEqual(obWithBreaker.breakers[0].dir, -1, "Breaker polarity flipped to -1");
pass("Invalidated Order Block cleanly generates institutional Breaker Block");

// ---------------------------------------------------------------------------
// 7. Micro-Gap Filtering & Timeframe Passing
// ---------------------------------------------------------------------------
console.log("\n--- 7. Testing Micro-Gap Filtering ---");

const microGapBars = [
  { time: 1000, open: 100, high: 101.00000, low: 99, close: 100.5 },
  { time: 2000, open: 100.5, high: 106, low: 100.4, close: 105.8 },
  { time: 3000, open: 105.8, high: 108, low: 101.00001, close: 107 }, // 0.00001 gap (1 tick micro-gap)
];

const microPd = detectPDArrays(microGapBars, { tf: "M15", atr: 2.0 });
assert.strictEqual(microPd.fvgs.length, 0, "1-tick micro-gap rejected by minGapSize");
pass("Micro-gaps below 0.10 * ATR threshold are filtered out");

// ---------------------------------------------------------------------------
// 8. Liquidity Raids Epsilon Tolerance & Input Guard
// ---------------------------------------------------------------------------
console.log("\n--- 8. Testing Liquidity Raids Tolerance & Guards ---");

const raidBars = [
  { time: 1000, open: 100, high: 105, low: 99, close: 104 },
  { time: 2000, open: 104, high: 104.5, low: 101, close: 102 },
  { time: 3000, open: 102, high: 105.02, low: 101.5, close: 103 }, // Pierce by 0.02 (inside 0.05 * 2.0 = 0.10 eps)
  { time: 4000, open: 103, high: 105.25, low: 102, close: 103.5 }, // Pierce by 0.25 (exceeds 0.10 eps) -> Genuine sweep!
  { time: 5000, open: 103.5, high: 104, low: 101, close: 102 },
];

const level = { price: 105, side: 1, formedAt: 0, time: 1000 };
const raidsWithEps = detectLiquidityRaids(raidBars, { levels: [level], atr: 2.0, maxReclaimBars: 2 });
assert.strictEqual(raidsWithEps.length, 1, "Raid detected");
assert.strictEqual(raidsWithEps[0].raidIndex, 3, "Raid identified at bar 3 (exceeding epsilon tolerance)");

// NaN guard check
const nanRaid = detectLiquidityRaids(raidBars, { levels: [level], maxReclaimBars: NaN });
assert(Array.isArray(nanRaid), "Handles NaN maxReclaimBars gracefully without throwing");
pass("detectLiquidityRaids respects epsilon tolerance and handles NaN options gracefully");

console.log("\n=======================================================");
console.log("🎯 ALL 8 INSTITUTIONAL EVIDENCE AUDIT TESTS PASSED 100%!");
console.log("=======================================================\n");
