import { analyzeHTFLiquidity } from "./lib/bias/htfLiquidity.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${message}`);
}

console.log("=======================================================");
console.log("TEST SUITE: HTF Liquidity Intelligence Forensic Audit");
console.log("=======================================================");

// -------------------------------------------------------------
// Test 1: Index-space bug in EQH with n > 80 and older higher high
// -------------------------------------------------------------
console.log("\n--- 1. Testing Index-Space Bug Elimination (n > 80) ---");
// Create 120 bars:
// Bars 0-30: Has an ancient high at 150
// Bars 40-120 (the 80-bar window):
// Two equal highs at 100 formed at relative indices 20 and 40 (absolute 60 and 80)
const bars120 = [];
for (let i = 0; i < 120; i++) {
  let high = 90;
  let low = 80;
  let close = 85;
  if (i === 15) { high = 150; close = 145; } // Older higher high BEFORE 80-bar window!
  if (i === 60) { high = 100; close = 95; }  // Pivot 1 in window
  if (i === 80) { high = 100; close = 95; }  // Pivot 2 in window
  bars120.push({ time: i * 14400, open: 85, high, low, close });
}

const res1 = analyzeHTFLiquidity({ H4: bars120 });
assert(res1.eqh.length >= 1, `EQH successfully detected despite older higher high (got ${res1.eqh.length})`);
assert(res1.eqh[0].price === 100, `EQH price is 100 (got ${res1.eqh[0].price})`);

// -------------------------------------------------------------
// Test 2: EQH Sweep Detection
// -------------------------------------------------------------
console.log("\n--- 2. Testing EQH Sweep Detection ---");
// Add bar 110 (10 bars ago, well inside 24-bar window) piercing above 100 (high: 104) and closing back at 96
bars120[110].high = 104;
bars120[110].close = 96;
const res2 = analyzeHTFLiquidity({ H4: bars120 });
const eqhSweep = res2.sweeps.find((s) => s.name === "4H EQH");
assert(eqhSweep !== undefined, "EQH sweep successfully detected in sweeps array");
assert(eqhSweep.levelPrice === 100, `Swept level price is 100 (got ${eqhSweep?.levelPrice})`);
assert(eqhSweep.sweptPrice === 104, `Swept price is 104 (got ${eqhSweep?.sweptPrice})`);
assert(eqhSweep.reversalDir === -1, `Reversal direction is -1 (got ${eqhSweep?.reversalDir})`);

// -------------------------------------------------------------
// Test 3: Intermediate Blown High Disqualifies False EQH
// -------------------------------------------------------------
console.log("\n--- 3. Testing Intermediate Price Blow-Through Check ---");
// Create bars with highs: 100 at bar 10, intermediate spike to 120 at bar 15, and 100 at bar 20
const barsSpike = [];
for (let i = 0; i < 40; i++) {
  let high = 80;
  if (i === 10) high = 100;
  if (i === 15) high = 120; // Intervening spike!
  if (i === 20) high = 100;
  barsSpike.push({ time: i * 14400, open: 75, high, low: 70, close: 75 });
}
const res3 = analyzeHTFLiquidity({ H4: barsSpike });
assert(!res3.eqh.some((e) => e.touches?.some((t) => t.absIdx === 10 && e.touches.some((t2) => t2.absIdx === 20))), 
  "Intermediate spike properly disqualified false EQH pairing");

// -------------------------------------------------------------
// Test 4: Equal Highs Clustered into Single Pool with Touch Count
// -------------------------------------------------------------
console.log("\n--- 4. Testing Cluster Deduplication & Touch Counts ---");
// Create 3 equal highs at bars 10, 18, 26 (Triple Top)
const barsTriple = [];
for (let i = 0; i < 40; i++) {
  let high = 80;
  if (i === 10) high = 100;
  if (i === 18) high = 100;
  if (i === 26) high = 100;
  barsTriple.push({ time: i * 14400, open: 75, high, low: 70, close: 75 });
}
const res4 = analyzeHTFLiquidity({ H4: barsTriple });
const cluster = res4.eqh.find((e) => e.price === 100);
assert(cluster !== undefined, "Triple top cluster detected");
assert(cluster.touchCount === 3, `Cluster touchCount is exactly 3 (got ${cluster.touchCount})`);
assert(res4.eqh.filter((e) => e.price === 100).length === 1, "Clustered into exactly 1 pool instead of 3 overlapping pairs");

// -------------------------------------------------------------
// Test 5: Lookahead Prevention: No Pre-Creation Sweeps
// -------------------------------------------------------------
console.log("\n--- 5. Testing Causal Lookahead Prevention ---");
// D1 bars: Day 10 (High 110 = PDH), Day 11 (High 115)
// 4H bars from Day 8 (time 8*86400) has high 112
// In the old code, Day 8's 4H bar claimed to sweep Day 10's PDH!
const d1 = [
  { time: 10 * 86400, open: 100, high: 110, low: 98, close: 105, closeTime: 11 * 86400 },
  { time: 11 * 86400, open: 105, high: 115, low: 102, close: 112 },
];
const h4PreBars = [
  { time: 8 * 86400, open: 108, high: 112, low: 106, close: 109 }, // 2 days before PDH formed!
  { time: 11 * 86400 + 14400, open: 109, high: 109.5, low: 105, close: 106 }, // after PDH, no sweep
];
const res5 = analyzeHTFLiquidity({ H4: h4PreBars, D1: d1 });
assert(!res5.sweeps.some((s) => s.name === "PDH" && s.time < 11 * 86400), 
  "Bars occurring prior to PDH confirmation time strictly prevented from registering false sweeps");

// -------------------------------------------------------------
// Test 6: Pool Consumption: Swept Levels Excluded from Unconsumed Pools
// -------------------------------------------------------------
console.log("\n--- 6. Testing Pool Consumption State ---");
// PDH at 110 was swept by 4H bar wicking to 112 and closing at 108.
// Current price is 108 (< 110). In old code, PDH was listed as an unconsumed BSL!
const h4SweptBars = [
  { time: 11 * 86400, open: 106, high: 107, low: 105, close: 106 },
  { time: 11 * 86400 + 14400, open: 108, high: 112, low: 107, close: 108 },
  { time: 11 * 86400 + 28800, open: 108, high: 109, low: 104, close: 105 },
];
const res6 = analyzeHTFLiquidity({ H4: h4SweptBars, D1: d1 });
assert(!res6.pools.bsl.some((p) => p.name === "PDH"), "Swept PDH excluded from unconsumed BSL pools");
assert(res6.pools.consumed.some((p) => p.name === "PDH"), "Swept PDH properly tracked in consumed pools");

// -------------------------------------------------------------
// Test 7: Pivot Times & IDs are Never Undefined
// -------------------------------------------------------------
console.log("\n--- 7. Testing ID & Timestamp Integrity ---");
assert(!res4.eqh.some((e) => e.id.includes("undefined") || e.time == null), 
  "All EQH pool IDs and timestamps are strictly defined and valid");
assert(!res4.pools.bsl.some((p) => p.id.includes("undefined") || (p.time == null && p.confirmationTime == null)), 
  "All BSL pool IDs and timestamps are strictly defined and valid");

// -------------------------------------------------------------
// Test 8: All-Time High / Blue Sky: Bullish Macro with No BSL Above
// -------------------------------------------------------------
console.log("\n--- 8. Testing All-Time High / Blue Sky Protection ---");
// Bullish structure (macroDir = 1), current price is 200, highest SSL is at 100, zero BSL above
const barsATH = [];
for (let i = 0; i < 20; i++) {
  barsATH.push({ time: i * 14400, open: 100 + i * 5, high: 105 + i * 5, low: 98 + i * 5, close: 104 + i * 5 });
}
const res8 = analyzeHTFLiquidity({ H4: barsATH }, { structures: { H4: { dir: 1 }, D1: { dir: 1 } } });
assert(res8.pools.bsl.length === 0, "Zero BSL above current price (ATH)");
assert(res8.drawOnLiquidity === null, "Bullish macro with no BSL above returns null (never falsely flips to a bearish SSL DOL)");

console.log("\n=======================================================");
console.log("🎯 ALL 8 HTF LIQUIDITY AUDIT TESTS PASSED WITH 100% SUCCESS!");
console.log("=======================================================");
