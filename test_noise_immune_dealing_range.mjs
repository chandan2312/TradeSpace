import assert from 'node:assert';
import fs from 'node:fs';
import { computeDealingRange, analyzeAllDealingRanges } from './lib/bias/ranges.js';

const pass = (msg) => console.log(`✅ PASS: ${msg}`);

console.log('\n======================================================================');
console.log('TEST SUITE: Noise-Immune BOS / CHoCH Structural Dealing Range Engine');
console.log('======================================================================\n');

// ---------------------------------------------------------------------------
// 1. Wick Sweep Rejection (Wicks Raid, Bodies Break)
// ---------------------------------------------------------------------------
console.log('--- 1. Testing Wick Sweep Rejection (Liquidity Grab / Turtle Soup) ---');
// Construct a series where swing high is at 1.3000 (bar 5).
// At bar 10, price spikes to 1.3020 (20 pip wick) but CLOSES at 1.2970 (well below 1.3000).
const wickSweepBars = [
  { time: 1000, open: 1.2900, high: 1.2930, low: 1.2890, close: 1.2920, isClosed: true },
  { time: 2000, open: 1.2920, high: 1.2950, low: 1.2910, close: 1.2940, isClosed: true },
  { time: 3000, open: 1.2940, high: 1.2970, low: 1.2930, close: 1.2960, isClosed: true },
  { time: 4000, open: 1.2960, high: 1.2980, low: 1.2940, close: 1.2970, isClosed: true },
  { time: 5000, open: 1.2970, high: 1.3000, low: 1.2960, close: 1.2990, isClosed: true }, // High = 1.3000
  { time: 6000, open: 1.2990, high: 1.2995, low: 1.2950, close: 1.2960, isClosed: true },
  { time: 7000, open: 1.2960, high: 1.2970, low: 1.2920, close: 1.2930, isClosed: true },
  { time: 8000, open: 1.2930, high: 1.2940, low: 1.2880, close: 1.2900, isClosed: true }, // Low = 1.2880
  { time: 9000, open: 1.2900, high: 1.2950, low: 1.2890, close: 1.2940, isClosed: true },
  // Bar 10: Spikes to 1.3020 (wick), but closes at 1.2970
  { time: 10000, open: 1.2940, high: 1.3020, low: 1.2930, close: 1.2970, isClosed: true },
  { time: 11000, open: 1.2970, high: 1.2980, low: 1.2920, close: 1.2940, isClosed: true },
  { time: 12000, open: 1.2940, high: 1.2960, low: 1.2910, close: 1.2930, isClosed: true },
  { time: 13000, open: 1.2930, high: 1.2950, low: 1.2900, close: 1.2920, isClosed: true },
];

const rSweep = computeDealingRange(wickSweepBars, 'H4', 0.0050);
assert(rSweep != null, 'Range exists');
// The wick sweep at 1.3020 MUST NOT trigger a displaced BOS!
assert.strictEqual(rSweep.structuralLegType !== 'BOS', true, 'Wick sweep does not trigger BOS');
pass('Wick sweep (spike high 1.3020 with close 1.2970) rejected; structural anchors preserved');

// ---------------------------------------------------------------------------
// 2. Anemic Session Drift Rejection (No Displacement)
// ---------------------------------------------------------------------------
console.log('\n--- 2. Testing Anemic Session Drift Rejection (Lack of Displacement) ---');
// Price creeps 1 pip above 1.3000 to close at 1.3001, but with a tiny 0.1x ATR doji candle.
const anemicBars = [
  ...wickSweepBars.slice(0, 9),
  { time: 10000, open: 1.2998, high: 1.3003, low: 1.2995, close: 1.3001, isClosed: true }, // Doji close 1.3001 > 1.3000
  { time: 11000, open: 1.3001, high: 1.3004, low: 1.2996, close: 1.2999, isClosed: true },
  { time: 12000, open: 1.2999, high: 1.3002, low: 1.2994, close: 1.2997, isClosed: true },
];

const rAnemic = computeDealingRange(anemicBars, 'H4', 0.0050);
assert(rAnemic != null, 'Range exists');
assert.strictEqual(rAnemic.structuralLegType !== 'BOS', true, 'Anemic drift without displacement does not trigger BOS');
pass('Anemic drift (0.1x ATR close above swing) rejected due to lack of displacement');

// ---------------------------------------------------------------------------
// 3. Genuine Displaced Bullish BOS (Body Close + High Energy Displacement)
// ---------------------------------------------------------------------------
console.log('\n--- 3. Testing Genuine Displaced Bullish BOS ---');
// Swing High at 1.3000 (bar 4), Origin Low at 1.2880 (bar 7).
// Bar 10 explodes with a huge body closing at 1.3060 (60 pips > 1.3000, 1.8x ATR).
// Bar 11 reaches peak at 1.3100.
// Bar 12-14 pull back to 1.2950 (Discount zone of the 1.2880 - 1.3100 leg!).
const bullBOSBars = [
  { time: 1000, open: 1.2920, high: 1.2940, low: 1.2900, close: 1.2930, isClosed: true },
  { time: 2000, open: 1.2930, high: 1.2960, low: 1.2920, close: 1.2950, isClosed: true },
  { time: 3000, open: 1.2950, high: 1.2980, low: 1.2940, close: 1.2970, isClosed: true },
  { time: 4000, open: 1.2970, high: 1.3000, low: 1.2950, close: 1.2990, isClosed: true }, // Swing High = 1.3000
  { time: 5000, open: 1.2990, high: 1.2995, low: 1.2940, close: 1.2950, isClosed: true },
  { time: 6000, open: 1.2950, high: 1.2960, low: 1.2900, close: 1.2910, isClosed: true },
  { time: 7000, open: 1.2910, high: 1.2920, low: 1.2880, close: 1.2890, isClosed: true }, // Origin Low = 1.2880
  { time: 8000, open: 1.2890, high: 1.2940, low: 1.2880, close: 1.2930, isClosed: true },
  { time: 9000, open: 1.2930, high: 1.2980, low: 1.2920, close: 1.2970, isClosed: true },
  // Bar 10: Powerful Bullish Displacement! Body = 80 pips (1.2970 to 1.3050), Close = 1.3050 > 1.3000
  { time: 10000, open: 1.2970, high: 1.3060, low: 1.2960, close: 1.3050, isClosed: true },
  // Bar 11: Expansion crest at 1.3100
  { time: 11000, open: 1.3050, high: 1.3100, low: 1.3040, close: 1.3080, isClosed: true },
  // Bar 12-14: Orderly pullback into Discount
  { time: 12000, open: 1.3080, high: 1.3090, low: 1.3010, close: 1.3020, isClosed: true },
  { time: 13000, open: 1.3020, high: 1.3030, low: 1.2960, close: 1.2970, isClosed: true }, // Close = 1.2970
];

const rBOS = computeDealingRange(bullBOSBars, 'H4', 0.0050);
assert(rBOS != null, 'Range exists');
assert.strictEqual(rBOS.isStructuralLeg, true, 'Detected as structural leg');
assert.strictEqual(rBOS.low, 1.2880, `Low anchored to origin low 1.2880: got ${rBOS.low}`);
assert.strictEqual(rBOS.high, 1.3100, `High anchored to expansion crest 1.3100: got ${rBOS.high}`);
assert.strictEqual(rBOS.eq, (1.3100 + 1.2880) / 2, `EQ is exact midpoint 1.2990: got ${rBOS.eq}`);
// At close 1.2970, price is in DISCOUNT of the 1.2880 - 1.3100 leg!
assert.strictEqual(rBOS.zone, 'DISCOUNT', `Zone correctly identified as DISCOUNT: got ${rBOS.zone}`);
pass('Genuine Bullish BOS confirmed; anchored from origin low 1.2880 to crest 1.3100; discount pullback detected');

// ---------------------------------------------------------------------------
// 4. Genuine Displaced Bearish CHoCH (Character Change / Trend Shift)
// ---------------------------------------------------------------------------
console.log('\n--- 4. Testing Genuine Displaced Bearish CHoCH ---');
// After the bullish leg, price forms a swing high at 1.3100, then plunges with heavy displacement
// and CLOSES below the origin low 1.2880 at 1.2840!
const chochBars = [
  ...bullBOSBars,
  { time: 14000, open: 1.2970, high: 1.2990, low: 1.2940, close: 1.2950, isClosed: true },
  // Bar 15: Huge bearish impulse breakdown! Body from 1.2950 to 1.2840, closing below 1.2880
  { time: 15000, open: 1.2950, high: 1.2960, low: 1.2830, close: 1.2840, isClosed: true },
  { time: 16000, open: 1.2840, high: 1.2850, low: 1.2800, close: 1.2810, isClosed: true }, // Trough = 1.2800
  { time: 17000, open: 1.2810, high: 1.2900, low: 1.2810, close: 1.2880, isClosed: true }, // Retrace into Premium
];

const rChoch = computeDealingRange(chochBars, 'H4', 0.0050);
assert(rChoch != null, 'Range exists');
assert.strictEqual(rChoch.isStructuralLeg, true, 'Detected as structural leg');
assert.strictEqual(rChoch.structuralLegType, 'CHOCH', `Leg type is CHOCH: got ${rChoch.structuralLegType}`);
assert.strictEqual(rChoch.direction, -1, `Direction flipped to Bearish (-1): got ${rChoch.direction}`);
assert.strictEqual(rChoch.high, 1.3100, `High anchored to CHoCH origin high 1.3100: got ${rChoch.high}`);
assert.strictEqual(rChoch.low, 1.2800, `Low anchored to breakdown trough 1.2800: got ${rChoch.low}`);
pass('Bearish CHoCH confirmed; flipped direction to -1; high anchored to 1.3100, low anchored to 1.2800');

// ---------------------------------------------------------------------------
// 5. Existing Legacy & Master Brain Suite Integrity
// ---------------------------------------------------------------------------
console.log('\n--- 5. Testing Backward Compatibility & Legacy Fallback ---');
// Running fallback path when no displaced break exists
const flatBars = [
  { time: 1000, open: 100, high: 110, low: 95, close: 105, isClosed: true },
  { time: 2000, open: 105, high: 112, low: 98, close: 108, isClosed: true },
  { time: 3000, open: 108, high: 115, low: 102, close: 106, isClosed: true },
  { time: 4000, open: 106, high: 114, low: 101, close: 107, isClosed: true },
];
const rFlat = computeDealingRange(flatBars, 'H4', 10.0);
assert(rFlat != null, 'Flat range exists');
assert(rFlat.high === 115, 'Fallback high is 115');
assert(rFlat.low === 95, 'Fallback low is 95');
pass('Flat market gracefully falls back to confirmed external container');

console.log('\n======================================================================');
console.log('🎯 ALL NOISE-IMMUNE DEALING RANGE TESTS PASSED 100%!');
console.log('======================================================================\n');
