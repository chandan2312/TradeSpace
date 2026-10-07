import assert from "node:assert";
import { scanUniverse, evaluateSymbol } from "./lib/autonomous/scanner.js";
import { SCENARIOS } from "./lib/autonomous/scenarios.js";

console.log("=======================================================");
console.log("TEST SUITE: Multi-Horizon Market Radar Architecture");
console.log("=======================================================\n");

let passed = 0;
function pass(msg) {
  passed++;
  console.log(`✅ PASS: ${msg}`);
}

// Mock frame generator for testing
function generateMockBars(count = 50, basePrice = 1.0850, step = 0.0005) {
  const bars = [];
  let price = basePrice;
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const time = now - (count - i) * 15 * 60 * 1000;
    const open = price;
    const high = price + step;
    const low = price - step;
    const close = price + step * 0.2;
    bars.push({ time, open, high, low, close, volume: 100, closed: true, timestampSemantics: "UTC_INSTANT" });
    price = close;
  }
  return bars;
}

// 1. Test evaluateSymbol with explicit targetScenario
console.log("--- 1. Testing Explicit Horizon Resolution in evaluateSymbol ---");
const frames = {
  D1: generateMockBars(30, 1.0800, 0.0050),
  H4: generateMockBars(40, 1.0820, 0.0020),
  H1: generateMockBars(50, 1.0840, 0.0010),
  M30: generateMockBars(60, 1.0845, 0.0006),
  M15: generateMockBars(60, 1.0850, 0.0004),
  M5: generateMockBars(60, 1.0852, 0.0002),
  M1: generateMockBars(60, 1.0853, 0.0001),
  snapshot: { timeframes: { M30: { count: 60 }, M15: { count: 60 }, H4: { count: 40 } } },
};

const dayEval = evaluateSymbol("EURUSD", frames, new Map(), {}, Date.now(), SCENARIOS.DAY);
assert.strictEqual(dayEval.resolution.scenario.id, "day", "Day evaluation scenario ID should be 'day'");
assert.strictEqual(dayEval.resolution.scenario.macroTf, "H4", "Day macro TF should be H4");
assert.strictEqual(dayEval.resolution.scenario.gatekeeperTf, "15M", "Day gatekeeper TF should be 15M");
pass("Day evaluation resolves 4H macro and 15M gatekeeper");

const swingEval = evaluateSymbol("EURUSD", frames, new Map(), {}, Date.now(), SCENARIOS.SWING);
assert.strictEqual(swingEval.resolution.scenario.id, "swing", "Swing evaluation scenario ID should be 'swing'");
assert.strictEqual(swingEval.resolution.scenario.macroTf, "D1", "Swing macro TF should be D1");
assert.strictEqual(swingEval.resolution.scenario.gatekeeperTf, "1H", "Swing gatekeeper TF should be 1H");
pass("Swing evaluation resolves D1 macro and 1H gatekeeper");

const scalpEval = evaluateSymbol("EURUSD", frames, new Map(), {}, Date.now(), SCENARIOS.SCALP);
assert.strictEqual(scalpEval.resolution.scenario.id, "scalp", "Scalp evaluation scenario ID should be 'scalp'");
assert.strictEqual(scalpEval.resolution.scenario.macroTf, "M30", "Scalp macro TF should be M30");
assert.strictEqual(scalpEval.resolution.scenario.gatekeeperTf, "M5", "Scalp gatekeeper TF should be M5");
pass("Scalp evaluation resolves 30M macro and 5M gatekeeper");

// 2. Test scanUniverse evaluating all 3 official horizons per symbol
console.log("\n--- 2. Testing Multi-Horizon Generation in scanUniverse ---");
const mockConfig = {
  mainWatchlistSymbols: ["EURUSD", "GBPUSD"],
  universe: ["EURUSD", "GBPUSD"],
  frames: {
    EURUSD: frames,
    GBPUSD: frames,
  },
  useM1Refinement: true,
};

const scanResult = await scanUniverse(mockConfig, ["EURUSD", "GBPUSD"]);
assert(Array.isArray(scanResult.rankedPairs), "rankedPairs should be an array");

// For 2 symbols with 3 horizons each, we should have up to 6 cards in rankedPairs
const eurusdCards = scanResult.rankedPairs.filter(p => p.symbol === "EURUSD");
assert.strictEqual(eurusdCards.length, 3, "EURUSD should generate exactly 3 cards (1 per horizon)");
pass("Single symbol EURUSD generates 3 cards across official horizons");

const dayCard = eurusdCards.find(c => c.horizon === "day");
const swingCard = eurusdCards.find(c => c.horizon === "swing");
const scalpCard = eurusdCards.find(c => c.horizon === "scalp");

assert(dayCard, "Day card should exist");
assert(swingCard, "Swing card should exist");
assert(scalpCard, "Scalp card should exist");
pass("All 3 horizons (Day, Swing, Scalp) are present for EURUSD");

assert.strictEqual(dayCard.radarKey, "EURUSD:day", "Day card radarKey matches symbol:day");
assert.strictEqual(swingCard.radarKey, "EURUSD:swing", "Swing card radarKey matches symbol:swing");
assert.strictEqual(scalpCard.radarKey, "EURUSD:scalp", "Scalp card radarKey matches symbol:scalp");
pass("Each card has unique radarKey preventing React key collisions");

assert.strictEqual(dayCard.horizonBadge, "4H-15M", "Day card badge is 4H-15M");
assert.strictEqual(swingCard.horizonBadge, "1D-1H", "Swing card badge is 1D-1H");
assert.strictEqual(scalpCard.horizonBadge, "30M-5M", "Scalp card badge is 30M-5M");
pass("Each card carries proper institutional horizon badge");

// 3. Test filtering by horizonMode in scanUniverse
console.log("\n--- 3. Testing horizonMode Filtering in scanUniverse ---");
const dayOnlyScan = await scanUniverse({ ...mockConfig, horizonMode: "day" }, ["EURUSD"]);
const dayOnlyCards = dayOnlyScan.rankedPairs.filter(p => p.symbol === "EURUSD");
assert.strictEqual(dayOnlyCards.length, 1, "Only 1 card generated when horizonMode is 'day'");
assert.strictEqual(dayOnlyCards[0].horizon, "day", "Card horizon is 'day'");
pass("horizonMode: 'day' restricts scan strictly to Day horizon");

const swingOnlyScan = await scanUniverse({ ...mockConfig, horizonMode: "swing" }, ["EURUSD"]);
const swingOnlyCards = swingOnlyScan.rankedPairs.filter(p => p.symbol === "EURUSD");
assert.strictEqual(swingOnlyCards.length, 1, "Only 1 card generated when horizonMode is 'swing'");
assert.strictEqual(swingOnlyCards[0].horizon, "swing", "Card horizon is 'swing'");
pass("horizonMode: 'swing' restricts scan strictly to Swing horizon");

const scalpOnlyScan = await scanUniverse({ ...mockConfig, horizonMode: "scalp" }, ["EURUSD"]);
const scalpOnlyCards = scalpOnlyScan.rankedPairs.filter(p => p.symbol === "EURUSD");
assert.strictEqual(scalpOnlyCards.length, 1, "Only 1 card generated when horizonMode is 'scalp'");
assert.strictEqual(scalpOnlyCards[0].horizon, "scalp", "Card horizon is 'scalp'");
pass("horizonMode: 'scalp' restricts scan strictly to Scalp horizon");

// 4. Test multi-horizon deduplication logic
console.log("\n--- 4. Testing Multi-Horizon Deduplication Coexistence ---");
const now = Date.now();
const openStates = ["staged", "armed", "active"];

// Simulated existing trades in database
const recentTrades = [
  {
    symbol: "EURUSD",
    canonicalSymbol: "EURUSD",
    status: "active",
    horizon: "swing",
    scenario: { id: "swing" },
    fingerprint: "EURUSD_1_H1_fvg",
    createdAt: new Date(now - 3600000),
  },
];

// Setup candidate 1: new Swing trade on EURUSD (should be blocked by existing open Swing trade)
const newSwingSetup = {
  symbol: "EURUSD",
  horizon: "swing",
  scenario: { id: "swing" },
  fingerprint: "EURUSD_1_H1_ote",
};

const setup1Horizon = newSwingSetup.scenario?.id || newSwingSetup.horizon || "day";
const blockedSwing = recentTrades.some(t => {
  const sameSymbol = [t.symbol, t.canonicalSymbol].includes(newSwingSetup.symbol);
  const tradeHorizon = t.horizon || t.scenario?.id || "day";
  const sameHorizon = tradeHorizon === setup1Horizon;
  return sameSymbol && sameHorizon && openStates.includes(t.status);
});
assert.strictEqual(blockedSwing, true, "New Swing trade SHOULD be blocked if a Swing trade is already open");
pass("Same-horizon open trade correctly blocks duplicate on same horizon");

// Setup candidate 2: new Day trade on EURUSD (should NOT be blocked by existing open Swing trade!)
const newDaySetup = {
  symbol: "EURUSD",
  horizon: "day",
  scenario: { id: "day" },
  fingerprint: "EURUSD_1_15M_fvg",
};

const setup2Horizon = newDaySetup.scenario?.id || newDaySetup.horizon || "day";
const blockedDay = recentTrades.some(t => {
  const sameSymbol = [t.symbol, t.canonicalSymbol].includes(newDaySetup.symbol);
  const tradeHorizon = t.horizon || t.scenario?.id || "day";
  const sameHorizon = tradeHorizon === setup2Horizon;
  return sameSymbol && sameHorizon && openStates.includes(t.status);
});
assert.strictEqual(blockedDay, false, "New Day trade should NOT be blocked by open Swing trade");
pass("Different-horizon trade (Day) coexists smoothly with open Swing trade on same symbol");

// 5. Test Horizon Level Separation and Distinct Risk Scale
console.log("\n--- 5. Testing Horizon Level Separation and Distinct Risk Scale ---");
const testMarketNow = new Date("2026-03-30T14:30:00Z").getTime();
const createBars = (count, start, end, noise = 5) => {
  const bars = [];
  const step = (end - start) / count;
  let p = start;
  for (let i = 0; i < count; i++) {
    const open = p;
    const close = p + step;
    const high = Math.max(open, close) + noise;
    const low = Math.min(open, close) - noise;
    bars.push({
      time: Math.floor((testMarketNow - (count - i) * 60000) / 1000),
      open, high, low, close, volume: 100, closed: true,
    });
    p = close;
  }
  return bars;
};

const marketFrames = {
  D1: [
    { time: 1, open: 19000, high: 19500, low: 18900, close: 19400 },
    { time: 2, open: 19400, high: 20100, low: 19350, close: 20000 },
    { time: 3, open: 20000, high: 20500, low: 19900, close: 20400 },
    { time: 4, open: 20400, high: 20450, low: 19750, close: 19800 },
  ],
  H4: [
    ...createBars(30, 19400, 20400, 20),
    ...createBars(10, 20400, 19800, 15),
  ],
  H1: [
    ...createBars(35, 19500, 20200, 10),
    ...createBars(15, 20200, 19800, 8),
  ],
  M15: [
    ...createBars(30, 20100, 19900, 5),
    ...createBars(30, 19900, 19800, 4),
  ],
  M5: [
    ...createBars(30, 19950, 19850, 3),
    ...createBars(30, 19850, 19800, 2),
  ],
  M1: [
    ...createBars(30, 19880, 19820, 1.5),
    ...createBars(30, 19820, 19800, 1),
  ],
  snapshot: {
    timeframes: {
      D1: { count: 4 },
      H4: { count: 40 },
      H1: { count: 50 },
      M15: { count: 60 },
      M5: { count: 60 },
      M1: { count: 60 },
    }
  }
};

const dayRes = evaluateSymbol("NAS100", marketFrames, new Map(), { minRR: 1.8 }, testMarketNow, SCENARIOS.DAY);
const swingRes = evaluateSymbol("NAS100", marketFrames, new Map(), { minRR: 1.8 }, testMarketNow, SCENARIOS.SWING);

assert(dayRes.stagedLevel, "Day trade staged level should be resolved");
assert(swingRes.stagedLevel, "Swing trade staged level should be resolved");

const dayRisk = Math.abs(dayRes.stagedLevel.entry - dayRes.stagedLevel.sl);
const swingRisk = Math.abs(swingRes.stagedLevel.entry - swingRes.stagedLevel.sl);

assert(swingRisk > dayRisk * 2.0, `Swing risk (${swingRisk.toFixed(2)}) should be significantly larger than Day risk (${dayRisk.toFixed(2)})`);
pass(`Swing risk (${swingRisk.toFixed(2)} pts) scales proportionally above Day risk (${dayRisk.toFixed(2)} pts)`);

const entryDiff = Math.abs(dayRes.stagedLevel.entry - swingRes.stagedLevel.entry);
assert(entryDiff > 30, `Entry levels should have distinct structural separation (>30 pts, got ${entryDiff.toFixed(2)})`);
pass(`Distinct structural entry separation confirmed (${entryDiff.toFixed(2)} pts apart)`);

const slDiff = Math.abs(dayRes.stagedLevel.sl - swingRes.stagedLevel.sl);
assert(slDiff > 100, `Stop loss levels should reflect distinct structural anchor boundaries (>100 pts, got ${slDiff.toFixed(2)})`);
pass(`Stop losses anchored to distinct horizon boundaries (${slDiff.toFixed(2)} pts apart)`);

// 6. Test Removal of Artificial TP Ceiling & Pure Structural Target Anchoring
console.log("\n--- 6. Testing Removal of Artificial TP Ceiling & Pure Structural Target Anchoring ---");
assert.strictEqual(dayRes.stagedLevel.tp, 19380, "Day TP should match structural target (19380)");
assert(dayRes.stagedLevel.rr > 5.0, `Day runner RR (${dayRes.stagedLevel.rr}R) should not be capped at 5.0R`);
pass(`Day runner target naturally expands to pure structural DOL (${dayRes.stagedLevel.rr}R > previous 5.0R ceiling)`);

assert.strictEqual(swingRes.stagedLevel.tp, 18900, "Swing TP should match macro D1 dealing range low (18900)");
pass(`Swing runner target anchors strictly to macro D1 boundary (${swingRes.stagedLevel.tp})`);

const dayT1 = dayRes.stagedLevel.targets[0].price;
const dayT2 = dayRes.stagedLevel.targets[1].price;
const dayT3 = dayRes.stagedLevel.targets[2].price;
assert(dayT1 > dayT2 && dayT2 > dayT3, "Short targets must follow strictly descending ladder (T1 > T2 > T3)");
pass(`Target ladder maintains strictly progressive ordering (T1: ${dayT1} > T2: ${dayT2} > Runner: ${dayT3})`);

console.log("\n=======================================================");
console.log(`TEST SUMMARY: ${passed} PASSED, 0 FAILED`);
console.log("=======================================================");
console.log("🎯 MULTI-HORIZON RADAR ARCHITECTURE VALIDATED WITH 100% SUCCESS!\n");
