import { sweepWickCandle, vReversal, grindThenDisplacement, strongLevels } from "./lib/bias/reversals.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

console.log("=== RUNNING REVERSALS ENGINE FORENSIC AUDIT SUITE ===");

// Helper to generate base candles
function makeBar(i, open, high, low, close, time = 1700000000 + i * 3600) {
  return { time, open, high, low, close, volume: 1000, closed: true };
}

// -------------------------------------------------------------
// Test 1: sweepWickCandle - Intact Pivot Sweep Verification (Grade A vs Grade B)
// -------------------------------------------------------------
console.log("\n--- Test 1: sweepWickCandle Intact Pivot Sweep Verification ---");
{
  const bars = [];
  // Build a swing low at index 5 (price = 100.0)
  bars.push(makeBar(0, 105, 106, 104, 105));
  bars.push(makeBar(1, 105, 105.5, 103, 103.5));
  bars.push(makeBar(2, 103.5, 104, 101.5, 102));
  bars.push(makeBar(3, 102, 102.5, 101, 101.5));
  bars.push(makeBar(4, 101.5, 102, 100.5, 101));
  bars.push(makeBar(5, 101, 101.5, 99.8, 100.5)); // Pivot low at 99.8
  bars.push(makeBar(6, 100.5, 102.5, 100.2, 102));
  bars.push(makeBar(7, 102, 103.5, 101.5, 103));
  bars.push(makeBar(8, 103, 104, 102.5, 103.5));
  
  // Case 1A: Bars 9-11 stay strictly above 99.8 (intact). Bar 12 sweeps 99.8 with lower wick to 99.2 and closes at 101.8.
  const barsIntact = [...bars];
  barsIntact.push(makeBar(9, 103.5, 103.8, 102.0, 102.2));
  barsIntact.push(makeBar(10, 102.2, 102.5, 101.0, 101.5));
  barsIntact.push(makeBar(11, 101.5, 102.0, 100.5, 101.0));
  // Bar 12: Range = 102.0 - 99.2 = 2.8. Lower wick = 100.5 - 99.2 = 1.3 (46%? Let's make wick larger: open 101.2, close 101.8, high 102.0, low 99.2 => range 2.8, lower wick 101.2 - 99.2 = 2.0 (71% of range))
  barsIntact.push(makeBar(12, 101.2, 102.0, 99.2, 101.8));

  const resA = sweepWickCandle(barsIntact, 1.5, 10);
  assert(resA !== null, "Should detect bullish sweep wick candle");
  assert(resA.dir === 1, "Should be bullish direction (1)");
  assert(resA.grade === "A", `Should be Grade A because pivot was intact, got: ${resA.grade}`);
  assert(resA.swept === true, "Should have swept: true");
  assert(resA.sweptLevel && resA.sweptLevel.price === 99.8, "Should report sweptLevel price 99.8");
  assert(resA.wickRatio >= 0.55, `Wick ratio should be >= 0.55, got ${resA.wickRatio}`);

  // Case 1B: Broken pivot (Bar 10 closed below 99.8 at 99.0). Bar 12 sweeps 99.8 again.
  // It should NOT be Grade A because the pivot was already broken and consumed!
  const barsBroken = [...bars];
  barsBroken.push(makeBar(9, 103.5, 103.8, 102.0, 102.2));
  barsBroken.push(makeBar(10, 102.2, 102.5, 98.5, 99.0)); // Closed below pivot low 99.8!
  barsBroken.push(makeBar(11, 99.0, 100.5, 98.8, 100.0));
  barsBroken.push(makeBar(12, 101.2, 102.0, 99.2, 101.8)); // Same hammer candle

  const resB = sweepWickCandle(barsBroken, 1.5, 10);
  assert(resB !== null, "Should still detect hammer rejection candle");
  assert(resB.grade === "B", `Should degrade to Grade B because pivot was previously violated, got: ${resB.grade}`);
  assert(resB.swept === false, "swept flag should be false for pre-violated level");

  console.log("  ✓ Intact swing sweep correctly awarded Grade A");
  console.log("  ✓ Previously breached swing correctly degraded to Grade B");
}

// -------------------------------------------------------------
// Test 2: sweepWickCandle - Pin-bar body threshold vs flat doji
// -------------------------------------------------------------
console.log("\n--- Test 2: Pin-bar body threshold & flat doji filtering ---");
{
  const bars = [];
  // Small range bars (0.4 range) that won't qualify as big rejection candles
  for (let i = 0; i < 10; i++) bars.push(makeBar(i, 100, 100.2, 99.8, 100));

  // Pin-bar with body = 0.18 * range (e.g., range = 2.0, body = 0.36) -> Valid!
  // open = 101.5, close = 101.86, high = 102.0, low = 100.0. Range = 2.0, body = 0.36 (18% of range), lower wick = 1.5 (75% of range)
  const pinBars = [...bars, makeBar(10, 101.5, 102.0, 100.0, 101.86)];
  const resPin = sweepWickCandle(pinBars, 1.0, 5);
  assert(resPin !== null, "Clean pin-bar with 18% body should qualify");

  // Flat zero-body doji: open = 101.8, close = 101.82, high = 102.0, low = 100.0. Range = 2.0, body = 0.02 (1% of range)
  const dojiBars = [...bars, makeBar(10, 101.8, 102.0, 100.0, 101.82)];
  const resDoji = sweepWickCandle(dojiBars, 1.0, 5);
  assert(resDoji === null, "Flat zero-body doji should be rejected");

  console.log("  ✓ Clean pin-bars accepted and flat noise dojis rejected");
}

// -------------------------------------------------------------
// Test 3: vReversal - Prompt Recovery Speed & Lower Low Guard
// -------------------------------------------------------------
console.log("\n--- Test 3: vReversal Speed Verification & Lower-Low Protection ---");
{
  // Build a sharp drop into a pivot low at bar 8 (price = 90.0, from high 100.0 at bar 4).
  // tLeg = 4 bars, leg = 10.0 points (10 ATR if ATR=1.0).
  const baseBars = [
    makeBar(0, 95, 96, 94, 95),
    makeBar(1, 95, 97, 94.5, 96.5),
    makeBar(2, 96.5, 98, 96, 97.5),
    makeBar(3, 97.5, 99, 97, 98.5),
    makeBar(4, 98.5, 100.0, 98, 99.5), // Swing high at 100.0
    makeBar(5, 99.5, 99.5, 96.0, 96.5),
    makeBar(6, 96.5, 97.0, 94.0, 94.5),
    makeBar(7, 94.5, 95.0, 92.0, 92.5),
    makeBar(8, 92.5, 93.0, 90.0, 91.0), // Pivot low at 90.0
  ];

  // Case 3A: Prompt recovery within 3 bars: recovered >= 70% of 10.0 = 7.0 points -> price >= 97.0
  const promptBars = [
    ...baseBars,
    makeBar(9, 91.0, 94.0, 90.5, 93.5),
    makeBar(10, 93.5, 96.0, 93.0, 95.5),
    makeBar(11, 95.5, 98.0, 95.0, 97.5), // bar 11 recovered to 97.5. tRec = 11 - 8 = 3 bars <= round(4 * 1.75 = 7).
    makeBar(12, 97.5, 98.5, 97.0, 98.0),
    makeBar(13, 98.0, 99.0, 97.5, 98.5),
    makeBar(14, 98.5, 99.5, 98.0, 99.0),
  ];

  const vPrompt = vReversal(promptBars, 1.0);
  assert(vPrompt !== null, "Prompt recovery should detect V-reversal");
  assert(vPrompt.dir === 1, "Should be bullish V-reversal");
  assert(vPrompt.extreme === 90.0, "V-extreme should be 90.0");
  assert(vPrompt.tRec === 3, `tRec should be 3, got ${vPrompt.tRec}`);
  assert(vPrompt.grade === "A", "Leg of 10 ATR should be Grade A");

  // Case 3B: Lower-low violation between pivot and recovery
  // Bar 8 is a pivot at 90.0. Bar 9 climbs to 92.5, but Bar 10 makes a lower low (89.0) violating Bar 8.
  // The bullish V-reversal at 90.0 MUST be disqualified.
  const violatedBars = [
    ...baseBars,
    makeBar(9, 91.0, 93.0, 90.5, 92.5),
    makeBar(10, 92.5, 92.5, 89.0, 89.5), // Lower low 89.0 violates Bar 8!
    makeBar(11, 89.5, 91.0, 89.2, 90.0),
    makeBar(12, 90.0, 91.0, 89.5, 90.2),
    makeBar(13, 90.2, 91.0, 89.8, 90.5),
    makeBar(14, 90.5, 91.0, 90.0, 90.8),
  ];
  const vViolated = vReversal(violatedBars, 1.0);
  // Bar 8 must not be returned as a bullish V-reversal
  assert(vViolated === null || vViolated.dir !== 1 || vViolated.extreme !== 90.0, "Bullish V-reversal at 90.0 must be disqualified by lower low");

  console.log("  ✓ Prompt V-reversal velocity verified and recorded");
  console.log("  ✓ Lower-low violation properly disqualifies false V-reversal");
}

// -------------------------------------------------------------
// Test 4: grindThenDisplacement - Compression and Directional Explosion
// -------------------------------------------------------------
console.log("\n--- Test 4: grindThenDisplacement ---");
{
  const bars = [];
  // 10 bars of pre-history
  for (let i = 0; i < 10; i++) bars.push(makeBar(i, 100, 100.5, 99.5, 100));

  // 8 bars of slow, overlapping downward grind (counter-drift)
  // Each bar has small body (~0.2 ATR, ATR=1.0) drifting down from 100 to 98.5 (drift = -1.5 ATR)
  let p = 100.0;
  for (let i = 10; i < 18; i++) {
    const o = p;
    const c = p - 0.2;
    bars.push(makeBar(i, o, o + 0.2, c - 0.2, c));
    p = c;
  }
  // Drift = 98.4 - 100.0 = -1.6 (downward grind)
  // Now Bar 18: Big impulsive displacement candle blasting UP from 98.4 to 101.5 (body = 3.1 ATR, >= 2.0x meanBody)
  bars.push(makeBar(18, 98.4, 101.6, 98.3, 101.5));

  const gd = grindThenDisplacement(bars, 1.0);
  assert(gd !== null, "Should detect grind-then-displacement");
  assert(gd.dir === 1, "Displacement direction should be bullish (1)");
  assert(gd.ratio >= 2.0, `Ratio should be >= 2.0, got ${gd.ratio}`);

  // Test unclosed candle guard
  const unclosedBars = [...bars.slice(0, 18), { ...bars[18], closed: false }];
  const gdUnclosed = grindThenDisplacement(unclosedBars, 1.0);
  assert(gdUnclosed === null, "Unclosed candle should not trigger displacement signal");

  console.log("  ✓ Grind-then-displacement detected with counter-drift and velocity ratio");
  console.log("  ✓ Unclosed candles safely ignored");
}

// -------------------------------------------------------------
// Test 5: strongLevels - Single-pass linear scan, Proximity Deduplication & Backward Compatibility
// -------------------------------------------------------------
console.log("\n--- Test 5: strongLevels Architecture & Deduplication ---");
{
  const bars = [];
  for (let i = 0; i < 30; i++) {
    bars.push(makeBar(i, 100 + i * 0.1, 100.5 + i * 0.1, 99.5 + i * 0.1, 100.2 + i * 0.1));
  }
  // Insert a strong sweep rejection low at bar 15: low = 95.0, range = 3.0, lower wick = 2.2, close = 97.8
  bars[15] = makeBar(15, 97.0, 98.0, 95.0, 97.8);

  // Insert a second touch at bar 22 very close to 95.0 (low = 95.2 within 0.35 ATR, ATR=1.0)
  bars[22] = makeBar(22, 97.2, 98.0, 95.2, 97.7);

  const levels = strongLevels(bars, 1.0, 30);
  assert(Array.isArray(levels), "strongLevels must return an array");
  assert(levels.length > 0, "Should detect strong levels");

  const lowLevel = levels.find((l) => l.side === "low");
  assert(lowLevel !== null && lowLevel !== undefined, "Should have a 'low' level (backward compatibility for setup.js & context.js)");
  assert(lowLevel.side === "low", `side must be string 'low', got ${lowLevel.side}`);
  assert(lowLevel.sideNum === 1, `sideNum must be 1, got ${lowLevel.sideNum}`);
  assert(lowLevel.price === 95.0, `price should be 95.0, got ${lowLevel.price}`);
  assert(lowLevel.touchCount >= 2, `touchCount should cluster nearby touch, got ${lowLevel.touchCount}`);
  assert(lowLevel.time !== undefined, "Level must have a timestamp");
  assert(lowLevel.id.startsWith("SL:L:"), `Level id should be formatted correctly, got ${lowLevel.id}`);

  // Test violation: if a subsequent bar closes below 95.0, level must be killed
  const violatedBars = [...bars, makeBar(30, 96.0, 96.5, 94.0, 94.5)]; // Closes at 94.5 < 95.0
  const postViolated = strongLevels(violatedBars, 1.0, 31);
  const lowViolated = postViolated.find((l) => l.side === "low" && l.price <= 95.5);
  assert(lowViolated === undefined, "Violated strong level must be removed once price closes through it");

  console.log("  ✓ Single-pass linear scan successfully found and deduplicated levels");
  console.log("  ✓ Cluster touchCount increments properly on proximate retests");
  console.log("  ✓ Backward compatibility for setup.js and context.js verified (side: 'low' | 'high')");
  console.log("  ✓ Close-through invalidation successfully removes broken levels");
}

console.log("\n✅ ALL REVERSALS ENGINE AUDIT TESTS PASSED SUCESSFULLY!");
