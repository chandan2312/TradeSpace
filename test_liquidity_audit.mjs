import { liquidityMap, classifyLevel, equalClusters, detectQML } from "./lib/bias/liquidity.js";
import { getTradingDayKey, toUtcSec } from "./lib/time.js";

function assert(msg, condition, extra = "") {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`, extra);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

console.log("=======================================================");
console.log("TEST SUITE: Intraday Liquidity Engine Forensic Audit");
console.log("=======================================================\n");

// Base time: 2026-11-04 10:00:00 UTC (12:00:00 EET - inside London session 10:00-13:00)
// Let's create realistic M15 bars
const baseTime = 1762250400; // Wednesday 10:00 UTC = 12:00 EET
const M15_SEC = 900;

// Helper to generate bars
function makeBars(count, startSec, startPrice = 100) {
  const bars = [];
  let p = startPrice;
  for (let i = 0; i < count; i++) {
    const t = startSec + i * M15_SEC;
    bars.push({
      time: t,
      open: p,
      high: p + 1.0,
      low: p - 1.0,
      close: p + 0.1,
      vol: 100
    });
  }
  return bars;
}

// =====================================================================
// 1. Developing Session High/Low Isolation Test
// =====================================================================
console.log("--- 1. Testing Developing Session High/Low Isolation ---");
{
  // Generate 80 bars spanning yesterday into today at 11:30 EET (London in progress)
  // 11:30 EET is totalMinutes = 690, hour = 11.5. London session is 10:00 to 13:00 EET.
  // Asia session is 02:00 to 06:00 EET (completed).
  // London session is developing.
  const bars = [];
  // Start yesterday at 14:00 EET
  const t0 = baseTime - 24 * 3600;
  for (let i = 0; i < 90; i++) {
    const t = t0 + i * M15_SEC;
    bars.push({
      time: t,
      open: 100,
      high: 102,
      low: 98,
      close: 100.5,
      vol: 100
    });
  }

  // Set the last bar to 11:30 EET today
  // Let's create a specific bar series for today
  // Today starts at 00:00 EET.
  // Let's create an explicit dataset with exact known times
  // 00:00 EET is epoch 1762207200 (winter offset +7200 -> UTC 1762200000)
  // Let's use `toUtcSec` and `getTradingDayKey`
  const tNow = baseTime; // 12:00 EET (London active)
  const fullBars = [];
  const startT = tNow - 60 * M15_SEC; // 15 hours ago
  for (let i = 0; i < 60; i++) {
    const t = startT + i * M15_SEC;
    fullBars.push({
      time: t,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      vol: 100
    });
  }

  const map = liquidityMap(fullBars, 1.0);
  
  // Find London session level
  const londonH = map.levels.find((l) => l.name === "London H");
  const londonL = map.levels.find((l) => l.name === "London L");
  
  assert("London session detected", londonH != null && londonL != null);
  assert("London H marked as developing", londonH.isDeveloping === true);
  assert("London H state is developing", londonH.state === "developing");
  
  // Developing levels MUST NEVER appear in draws!
  const londonInAbove = map.draws.above.some((d) => d.id === londonH.id);
  const londonInBelow = map.draws.below.some((d) => d.id === londonL.id);
  assert("London H strictly excluded from draws.above", !londonInAbove);
  assert("London L strictly excluded from draws.below", !londonInBelow);

  // Completed Asia session (02:00 to 06:00 EET)
  const asiaH = map.levels.find((l) => l.name === "Asia H");
  if (asiaH) {
    assert("Asia H marked as completed", asiaH.isCompleted === true && asiaH.isDeveloping === false);
  }
}

// =====================================================================
// 2. classifyLevel Multi-Bar Sweep Reclaim & Timestamp Test
// =====================================================================
console.log("\n--- 2. Testing classifyLevel Sweep Reclaim & Exact Timestamping ---");
{
  const bars = makeBars(30, baseTime, 100);
  // Level at price 105, formed at bar 5
  const level = { id: "test_h", name: "Test H", price: 105, side: 1, formedAt: 5 };

  // Bar 10 pierces: high = 106.5, close = 105.8 (closed outside)
  bars[10].high = 106.5;
  bars[10].close = 105.8;

  // Bar 11 stays outside: high = 106.0, close = 105.4
  bars[11].high = 106.0;
  bars[11].close = 105.4;

  // Bar 12 reclaims and closes back inside: high = 105.2, close = 104.2 (< 105)
  bars[12].high = 105.2;
  bars[12].close = 104.2;

  const res = classifyLevel(bars, level, 1.0);
  assert("Level classified as swept", res.state === "swept");
  assert("SweptAt matches exact reclaim bar (bar 12, not pierce+3)", res.sweptAt === 12);
  assert("Sweep event recorded with pierceI=10 and reclaimI=12", res.events[0]?.pierceI === 10 && res.events[0]?.reclaimI === 12);
}

// =====================================================================
// 3. Pending Breakout vs Confirmed Breakout Test
// =====================================================================
console.log("\n--- 3. Testing Pending Breakout on Last Candle vs Confirmed Break ---");
{
  const bars = makeBars(20, baseTime, 100);
  const level = { id: "test_h2", name: "Test H2", price: 105, side: 1, formedAt: 5 };

  // Pierce on the very last bar (bar 19): high = 107, close = 106.5
  bars[19].high = 107.0;
  bars[19].close = 106.5;

  const resPending = classifyLevel(bars, level, 1.0);
  assert("Pierce on live candle classified as pending (not prematurely broken)", resPending.state === "pending");

  // Now create confirmed break: pierced at bar 8, bars 9, 10, 11, 12, 13 all close outside
  const barsBroken = makeBars(25, baseTime, 100);
  const levelBroken = { id: "test_h3", name: "Test H3", price: 105, side: 1, formedAt: 5 };
  for (let b = 8; b <= 14; b++) {
    barsBroken[b].high = 107.0;
    barsBroken[b].close = 106.2;
  }
  const resBroken = classifyLevel(barsBroken, levelBroken, 1.0);
  assert("Extended acceptance beyond level classified as broken", resBroken.state === "broken");
  assert("BrokenAt records initial break bar 8", resBroken.brokenAt === 8);
}

// =====================================================================
// 4. Equal Clusters Intermediate Blow-Through & Pullback Test
// =====================================================================
console.log("\n--- 4. Testing Equal Clusters Blow-Through & Pullback Integrity ---");
{
  // Test A: High of 100 at bar 5, intermediate spike to 105 at bar 10, high of 100 at bar 15
  // Must NOT qualify as EQH because bar 10 blew through the level!
  const barsSpike = makeBars(25, baseTime, 95);
  // Bar 5: Pivot High at 100
  barsSpike[5].high = 100; barsSpike[5].close = 99;
  barsSpike[4].high = 98;  barsSpike[6].high = 98;

  // Bar 10: Spike to 105 (blow-through)
  barsSpike[10].high = 105; barsSpike[10].close = 104;

  // Bar 15: Pivot High at 100
  barsSpike[15].high = 100; barsSpike[15].close = 99;
  barsSpike[14].high = 98;  barsSpike[16].high = 98;

  const clustersSpike = equalClusters(barsSpike, 1.0);
  const hasFalseEQH = clustersSpike.some((c) => Math.abs(c.price - 100) < 0.2);
  assert("Intermediate spike properly disqualified false EQH", !hasFalseEQH);

  // Test B: Valid Triple Top with clean pullbacks
  const barsValid = makeBars(35, baseTime, 95);
  // Touch 1 at bar 6: high = 100, pullback to 97 at bar 9
  barsValid[6].high = 100; barsValid[6].close = 99;
  barsValid[5].high = 98;  barsValid[7].high = 98;
  barsValid[9].low = 97;

  // Touch 2 at bar 14: high = 100.05, pullback to 96.5 at bar 18
  barsValid[14].high = 100.05; barsValid[14].close = 99;
  barsValid[13].high = 98;     barsValid[15].high = 98;
  barsValid[18].low = 96.5;

  // Touch 3 at bar 24: high = 100.02
  barsValid[24].high = 100.02; barsValid[24].close = 99;
  barsValid[23].high = 98;     barsValid[25].high = 98;

  const clustersValid = equalClusters(barsValid, 1.0);
  const eqh = clustersValid.find((c) => c.side === 1);
  assert("Clean equal high cluster successfully detected", eqh != null);
  assert("Touch count is exactly 3", eqh?.touches === 3);
}

// =====================================================================
// 5. Symmetric QML Scan & Intact Pivot Test
// =====================================================================
console.log("\n--- 5. Testing Symmetric QML Scanning & Intact Pivot Verification ---");
{
  // Build a clean Bearish QML:
  // 1. Left Shoulder at bar 5 (High = 100)
  // 2. Neck at bar 10 (Low = 95)
  // 3. Head (Sweep) at bar 15 (High = 101, close back under 100)
  // 4. Neck Break at bar 18 (Close = 94.5 < 95)
  const barsBearish = makeBars(30, baseTime, 96);
  // Left shoulder
  barsBearish[5].high = 100; barsBearish[5].close = 99;
  barsBearish[4].high = 98;  barsBearish[6].high = 98;
  // Neck
  barsBearish[10].low = 95;  barsBearish[10].high = 97; barsBearish[10].close = 96;
  barsBearish[9].low = 97;   barsBearish[11].low = 97;
  // Head (Sweep)
  barsBearish[15].high = 101; barsBearish[15].close = 99.5;
  // Neck Break
  barsBearish[18].close = 94.2; barsBearish[18].low = 94.0;

  const qmlBearish = detectQML(barsBearish, 1.0);
  assert("Bearish QML successfully detected", qmlBearish != null && qmlBearish.dir === -1);
  assert("QML Head price is 101", qmlBearish?.headPrice === 101);
  assert("QML Neck price is 95", qmlBearish?.neckPrice === 95);
  assert("QML qmlPrice is left shoulder (100)", qmlBearish?.qmlPrice === 100);

  // Mirror Test: Invert prices to create Bullish QML
  // Bullish QML:
  // 1. Left Shoulder at bar 5 (Low = 100)
  // 2. Neck at bar 10 (High = 105)
  // 3. Head (Sweep) at bar 15 (Low = 99, close back above 100)
  // 4. Neck Break at bar 18 (Close = 105.8 > 105)
  const barsBullish = makeBars(30, baseTime, 104);
  barsBullish[5].low = 100; barsBullish[5].close = 101;
  barsBullish[4].low = 102; barsBullish[6].low = 102;

  barsBullish[10].high = 105; barsBullish[10].low = 103; barsBullish[10].close = 104;
  barsBullish[9].high = 103;  barsBullish[11].high = 103;

  barsBullish[15].low = 99;   barsBullish[15].close = 100.5;
  barsBullish[18].close = 105.8; barsBullish[18].high = 106.0;

  const qmlBullish = detectQML(barsBullish, 1.0);
  assert("Bullish QML successfully detected via symmetric scan", qmlBullish != null && qmlBullish.dir === 1);
  assert("Bullish QML Head price is 99", qmlBullish?.headPrice === 99);
  assert("Bullish QML Neck price is 105", qmlBullish?.neckPrice === 105);

  // Invalidation Test:
  // If price after the neck break trades above Head (101) for bearish QML, it must be invalidated
  barsBearish[22].high = 102.5; // Blown through head!
  const qmlInvalidated = detectQML(barsBearish, 1.0);
  assert("QML with breached Head is strictly invalidated (returns null)", qmlInvalidated == null);

  // Pre-broken Pivot Test:
  // If pivot at bar 5 was closed above at bar 7 and stayed above, later wick at bar 15 must NOT trigger QML
  const barsPreBroken = makeBars(30, baseTime, 96);
  barsPreBroken[5].high = 100; barsPreBroken[5].close = 99;
  barsPreBroken[4].high = 98;  barsPreBroken[6].high = 98;
  // Bar 7-9 breaks through and closes beyond 100 without reclaiming
  barsPreBroken[7].high = 102; barsPreBroken[7].close = 101.5;
  barsPreBroken[8].high = 102; barsPreBroken[8].close = 101.5;
  barsPreBroken[9].high = 102; barsPreBroken[9].close = 101.5;
  barsPreBroken[10].low = 95;  barsPreBroken[10].high = 97;
  barsPreBroken[11].low = 97;
  barsPreBroken[15].high = 101; barsPreBroken[15].close = 99.5;
  barsPreBroken[18].close = 94.2;

  const qmlPreBroken = detectQML(barsPreBroken, 1.0);
  assert("Pre-broken pivot strictly rejected from forming false QML", qmlPreBroken == null);
}

console.log("\n=======================================================");
console.log("🎯 ALL 16 INTRADAY LIQUIDITY TESTS PASSED WITH 100% SUCCESS!");
console.log("=======================================================");
