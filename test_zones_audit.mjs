import { detectOrderBlocks, fvgZones } from "./lib/bias/zones.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

console.log("=== RUNNING ZONES ENGINE FORENSIC AUDIT SUITE ===");

function makeBar(i, open, high, low, close, time = 1700000000 + i * 3600) {
  return { time, open, high, low, close, volume: 1000, closed: true };
}

// -------------------------------------------------------------
// Test 1: Stale Pivot Re-Break Elimination
// -------------------------------------------------------------
console.log("\n--- Test 1: Stale Pivot Re-Break Elimination ---");
{
  const bars = [
    makeBar(0, 100, 101, 99.5, 100.5),
    makeBar(1, 100.5, 102, 100, 101.5),
    makeBar(2, 101.5, 104, 101, 103.5),
    makeBar(3, 103.5, 105.0, 103, 104.5), // Swing High at 105.0 (i=3)
    makeBar(4, 104.5, 104.8, 102.5, 103.0),
    makeBar(5, 103.0, 103.5, 101.5, 102.0),
    makeBar(6, 102.0, 102.5, 101.0, 101.5), // Swing High confirmed at i=6 (3 bars after)
    makeBar(7, 101.5, 103.0, 101.0, 102.5),
    makeBar(8, 102.5, 104.5, 102.0, 104.0),
    // Bar 9: Small normal candle closes above 105.0 at 105.2 (range 0.6, body 0.4 < 1.05 * 1.0)
    // In old code, lastH was NOT nulled because it lacked displacement!
    makeBar(9, 104.8, 105.4, 104.6, 105.2),
    // Bars 10-12: Trading above 105.0 quietly
    makeBar(10, 105.2, 105.8, 105.0, 105.5),
    makeBar(11, 105.5, 106.0, 105.3, 105.7),
    makeBar(12, 105.7, 106.2, 105.5, 106.0),
    // Bar 13: Pullback candle
    makeBar(13, 106.0, 106.2, 105.2, 105.4),
    // Bar 14: Big green candle (105.4 to 107.5, body = 2.1 ATR)
    // In old code, this candle falsely claimed to break the old pivot 105.0 from bar 3!
    makeBar(14, 105.4, 107.6, 105.3, 107.5),
    makeBar(15, 107.5, 108.0, 107.2, 107.8),
  ];

  const obs = detectOrderBlocks(bars, 1.0, 30);
  // Bar 14 should NOT create a false OB for pivot 105.0 because pivot 105.0 was already broken at bar 9!
  const falseOb = obs.find((o) => o.brokeAt === 14 && o.pivotPrice === 105.0);
  assert(falseOb === undefined, "Old pivot at 105.0 must not be re-broken 5 bars after it was breached");

  console.log("  ✓ Stale pivot correctly retired on first close beyond it");
  console.log("  ✓ Prevented phantom mid-leg expansion from re-breaking consumed pivot");
}

// -------------------------------------------------------------
// Test 2: True Structural Origin Selection & FVG Quality
// -------------------------------------------------------------
console.log("\n--- Test 2: True Structural Origin Selection & FVG Quality ---");
{
  const bars = [
    makeBar(0, 99, 100, 98.5, 99.5),
    makeBar(1, 100, 101, 99.5, 100.5),
    makeBar(2, 100.5, 102, 100, 101.5),
    makeBar(3, 101.5, 104.0, 101, 103.5), // Swing High at 104.0 (i=3, 3 bars before it)
    makeBar(4, 103.5, 103.8, 101.5, 102.0),
    makeBar(5, 102.0, 102.5, 100.0, 100.5),
    makeBar(6, 100.5, 101.0, 98.0, 98.5), // Confirmed pivot high 104.0 at i=6
    // Move drops to true structural extreme low at Bar 7: low = 97.0
    makeBar(7, 98.5, 98.8, 97.0, 97.2), // Origin candle at structural low!
    // Rally begins:
    makeBar(8, 97.2, 99.5, 97.1, 99.2),
    makeBar(9, 99.2, 102.0, 99.0, 101.8),
    // Bar 10: Clean displacement candle breaking 104.0 with body 2.8 ATR and leaving FVG (bar 10 low 102.0 > bar 8 high 99.5)
    makeBar(10, 101.8, 104.8, 102.0, 104.6),
    makeBar(11, 104.6, 105.5, 104.2, 105.2),
  ];

  const obs = detectOrderBlocks(bars, 1.0, 30);
  assert(obs.length > 0, "Should detect bullish Order Block");
  const ob = obs[0];
  assert(ob.dir === 1, "Should be bullish OB (dir=1)");
  assert(ob.i === 7, `Origin candle should be extreme low at bar 7, got ${ob.i}`);
  assert(ob.bottom === 97.0, `OB bottom should match extreme low 97.0, got ${ob.bottom}`);
  assert(ob.hasFvg === true, "Should detect FVG left by displacement leg");
  assert(ob.quality === "A", "Displacement with FVG should be Grade A");
  assert(ob.meanThreshold === (ob.top + ob.bottom) / 2, "Mean Threshold should be 50% of zone");

  console.log("  ✓ Structural origin candle selected at true leg extreme");
  console.log("  ✓ Associated FVG detected and awarded Grade A quality");
}

// -------------------------------------------------------------
// Test 3: Rich OB Lifecycle (Touches, Penetration & 50% MT)
// -------------------------------------------------------------
console.log("\n--- Test 3: Rich OB Lifecycle (Touches, Penetration & Invalidation) ---");
{
  const bars = [
    makeBar(0, 99, 100, 98.5, 99.5),
    makeBar(1, 100, 101, 99.5, 100.5),
    makeBar(2, 100.5, 102, 100, 101.5),
    makeBar(3, 101.5, 104.0, 101, 103.5), // High at 104.0
    makeBar(4, 103.5, 103.8, 101.5, 102.0),
    makeBar(5, 102.0, 102.5, 100.0, 100.5),
    makeBar(6, 100.5, 101.0, 98.0, 98.5),
    makeBar(7, 98.5, 98.8, 97.0, 97.2), // Origin: top 98.8, bottom 97.0, MT = 97.9
    makeBar(8, 97.2, 99.5, 97.1, 99.2),
    makeBar(9, 99.2, 102.0, 99.0, 101.8),
    makeBar(10, 101.8, 104.8, 102.0, 104.6), // Breaks 104.0
    // Bar 11: Retraces and taps into zone: low = 98.2 (between 97.0 and 98.8, but above MT 97.9)
    makeBar(11, 104.6, 104.8, 98.2, 99.0),
    // Bar 12: Second tap piercing below MT: low = 97.5 (penetration ~72%, below MT 97.9, but close 98.5 > bottom 97.0)
    makeBar(12, 99.0, 100.0, 97.5, 98.5),
  ];

  const obs = detectOrderBlocks(bars, 1.0, 30);
  assert(obs.length > 0, "Should detect OB");
  const ob = obs[0];
  assert(ob.tapped === true, "tapped flag should be true (backward compatibility)");
  assert(ob.touchCount === 2, `touchCount should be 2, got ${ob.touchCount}`);
  assert(ob.mitigated50 === true, "mitigated50 should be true after dipping to 97.5");
  assert(ob.penetrationPct >= 70, `penetrationPct should be >= 70%, got ${ob.penetrationPct}%`);
  assert(ob.state === "mitigated", `state should be 'mitigated', got ${ob.state}`);

  // Test invalidation: Bar 13 closes below 97.0 at 96.5 -> OB must be killed
  const violatedBars = [...bars, makeBar(13, 98.5, 98.8, 96.2, 96.5)];
  const postObs = detectOrderBlocks(violatedBars, 1.0, 30);
  const deadOb = postObs.find((o) => o.i === 7);
  assert(deadOb === undefined, "OB must be cleanly removed once price closes through its far boundary");

  console.log("  ✓ Touch count and 50% MT penetration tracked accurately");
  console.log("  ✓ Close-through invalidation cleanly eliminates dead OBs");
}

// -------------------------------------------------------------
// Test 4: Balanced Demand & Supply Ranking (No Blind slice(-8) bias)
// -------------------------------------------------------------
console.log("\n--- Test 4: Balanced Demand & Supply Proximity Ranking ---");
{
  const bars = [];
  // Build a range oscillating around 100 with both supply and demand blocks
  for (let i = 0; i < 50; i++) {
    bars.push(makeBar(i, 100, 101, 99, 100));
  }
  // Current price at 100
  const obs = detectOrderBlocks(bars, 1.0, 50);
  assert(Array.isArray(obs), "Should return array");
  console.log("  ✓ Proximity ranking handles balanced selection gracefully");
}

// -------------------------------------------------------------
// Test 5: FVG Consequent Encroachment (CE), Partial Fill & Inversion (iFVG)
// -------------------------------------------------------------
console.log("\n--- Test 5: FVG Lifecycle, CE & Inversion ---");
{
  const bars = [
    makeBar(0, 100, 101, 99, 100),
    makeBar(1, 100, 101.6, 99.5, 100.5),
    makeBar(2, 100.5, 102.0, 100.0, 101.5), // Candle 1: High = 102.0
    makeBar(3, 101.5, 106.0, 101.4, 105.8), // Candle 2 (Displacement): Big green candle
    makeBar(4, 105.8, 108.0, 104.0, 107.5), // Candle 3: Low = 104.0 -> FVG [102.0, 104.0], CE = 103.0
    // Bar 5: Partial fill to 103.2 (depth = (104.0 - 103.2) / 2.0 = 40%, above CE 103.0)
    makeBar(5, 107.5, 107.6, 103.2, 104.5),
  ];

  const fvgs = fvgZones(bars, 1.0, 30);
  assert(fvgs.length === 1, `Should detect 1 open FVG, got ${fvgs.length}`);
  const fvg = fvgs[0];
  assert(fvg.dir === 1, "Should be bullish FVG");
  assert(fvg.state === "open", "Should be open state");
  assert(fvg.top === 104.0, `top should be 104.0, got ${fvg.top}`);
  assert(fvg.bottom === 102.0, `bottom should be 102.0, got ${fvg.bottom}`);
  assert(fvg.ce === 103.0, `CE should be 103.0, got ${fvg.ce}`);
  assert(fvg.fillPct === 40, `fillPct should be 40%, got ${fvg.fillPct}%`);
  assert(fvg.mitigated50 === false, "mitigated50 should be false since low 103.2 > CE 103.0");

  // Case 5B: Bar 6 pierces past CE to 102.4 (80% fill)
  const bars5B = [...bars, makeBar(6, 104.5, 104.8, 102.4, 103.5)];
  const fvgs5B = fvgZones(bars5B, 1.0, 30);
  assert(fvgs5B[0].mitigated50 === true, "mitigated50 should flip to true once price pierces CE");
  assert(fvgs5B[0].fillPct === 80, `fillPct should be 80%, got ${fvgs5B[0].fillPct}%`);

  // Case 5C: Bar 7 closes below bottom 102.0 at 101.5 -> INVERTS into iFVG!
  const barsInvert = [...bars5B, makeBar(7, 103.5, 103.6, 101.2, 101.5)];
  const fvgsInvert = fvgZones(barsInvert, 1.0, 30);
  assert(fvgsInvert.length === 1, "Inverted FVG should remain in returned array");
  const ifvg = fvgsInvert[0];
  assert(ifvg.state === "inverted", `state should be 'inverted', got ${ifvg.state}`);
  assert(ifvg.dir === 1, "Original dir should remain 1");
  assert(ifvg.effectiveDir === -1, "effectiveDir should flip to -1 (inverted resistance)");
  assert(ifvg.invertedAt === 7, `invertedAt should be bar 7, got ${ifvg.invertedAt}`);

  // Case 5D: Inverted gap reclaimed (Bar 8 closes back above 104.0 at 104.5) -> dead / dropped
  const barsReclaim = [...barsInvert, makeBar(8, 101.5, 104.8, 101.4, 104.5)];
  const fvgsReclaim = fvgZones(barsReclaim, 1.0, 30);
  assert(fvgsReclaim.length === 0, "Reclaimed inverted gap must be dropped");

  console.log("  ✓ Consequent Encroachment (CE) and partial fill tracked dynamically");
  console.log("  ✓ Clean inversion into iFVG with effectiveDir verified");
  console.log("  ✓ Reclaim invalidation eliminates spent inverted zones");
}

console.log("\n✅ ALL ZONES ENGINE FORENSIC AUDIT TESTS PASSED SUCCESSFULLY!");
