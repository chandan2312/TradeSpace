import assert from "node:assert";
import { calculateSlDistance, resolveRadarTradeIdeaPricing, buildRadarTradeIdeaDrawing, buildStagedTradeDrawings, buildAutonomousDrawings } from "./lib/autonomous/tradeDrawing.js";

console.log("=======================================================");
console.log("TESTING STOP LOSS DISTANCE (PIPS & POINTS) ENGINE");
console.log("=======================================================\n");

// 1. Forex Standard (EURUSD, GBPUSD, USDCHF)
const eurusdDist = calculateSlDistance(1.08500, 1.08380, "EURUSD");
assert.strictEqual(eurusdDist.unit, "pips");
assert.strictEqual(eurusdDist.short, "12.0p");
assert.strictEqual(eurusdDist.formatted, "12.0 pips");
console.log("✅ PASS: EURUSD 12.0 pips calculated accurately");

const usdchfDist = calculateSlDistance(0.88450, 0.88350, "USDCHF");
assert.strictEqual(usdchfDist.unit, "pips");
assert.strictEqual(usdchfDist.short, "10.0p");
console.log("✅ PASS: USDCHF 10.0 pips calculated accurately");

// 2. Forex JPY (USDJPY, GBPJPY, CADJPY)
const gbpjpyDist = calculateSlDistance(195.400, 195.150, "GBPJPY");
assert.strictEqual(gbpjpyDist.unit, "pips");
assert.strictEqual(gbpjpyDist.short, "25.0p");
console.log("✅ PASS: GBPJPY 25.0 pips calculated accurately (JPY 0.01 pip standard)");

// 3. Metals (Gold - XAUUSD)
const xauusdDist = calculateSlDistance(2680.00, 2676.50, "XAUUSD");
assert.strictEqual(xauusdDist.unit, "pips");
assert.strictEqual(xauusdDist.short, "35.0p");
assert.strictEqual(xauusdDist.formatted, "35.0 pips ($3.50)");
console.log("✅ PASS: Gold (XAUUSD) 35.0 pips ($3.50) calculated accurately");

// 4. Indices (NAS100, DJ30, GER40, UK100, SP500)
const nas100Dist = calculateSlDistance(20500.0, 20455.0, "NAS100");
assert.strictEqual(nas100Dist.unit, "pts");
assert.strictEqual(nas100Dist.short, "45.0 pts");
console.log("✅ PASS: NAS100 45.0 pts calculated accurately");

const dj30Dist = calculateSlDistance(43500.0, 43410.0, "DJ30");
assert.strictEqual(dj30Dist.unit, "pts");
assert.strictEqual(dj30Dist.short, "90.0 pts");
console.log("✅ PASS: DJ30 90.0 pts calculated accurately");

const ger40Dist = calculateSlDistance(19250.0, 19215.0, "GER40");
assert.strictEqual(ger40Dist.unit, "pts");
assert.strictEqual(ger40Dist.short, "35.0 pts");
console.log("✅ PASS: GER40 35.0 pts calculated accurately");

// 5. Crypto (BTCUSD)
const btcusdDist = calculateSlDistance(88500.0, 87800.0, "BTCUSD");
assert.strictEqual(btcusdDist.unit, "pts");
assert.strictEqual(btcusdDist.short, "700.0 pts");
console.log("✅ PASS: BTCUSD 700.0 pts calculated accurately");

// 6. Radar Trade Idea Pricing integration
const mockPair = {
  symbol: "EURUSD",
  tradeableSymbol: "EURUSD.I",
  dir: 1,
  stagedLevel: {
    entry: 1.08500,
    sl: 1.08380,
    tp: 1.08860,
    rr: 3.0,
  },
};
const pricing = resolveRadarTradeIdeaPricing(mockPair);
assert.strictEqual(pricing.hasSetup, true);
assert.strictEqual(pricing.slDistanceShort, "12.0p");
assert.strictEqual(pricing.slDistanceFormatted, "12.0 pips");
console.log("✅ PASS: resolveRadarTradeIdeaPricing returns slDistanceShort & slDistanceFormatted");

// 7. Radar Drawing statsLabel integration
const mockBars = [
  { time: 1000, open: 1.0840, high: 1.0845, low: 1.0838, close: 1.0842 },
  { time: 1300, open: 1.0842, high: 1.0848, low: 1.0840, close: 1.0846 },
];
const radarDrawing = buildRadarTradeIdeaDrawing(mockPair, mockBars, 300, 0);
assert(radarDrawing.style.statsLabel.includes("SL: 12.0p"), "Radar drawing statsLabel must include SL: 12.0p");
console.log(`✅ PASS: Radar chart RR tool displays statsLabel: "${radarDrawing.style.statsLabel}"`);

// 8. Staged Trade Drawing statsLabel integration
const mockStagedTrade = {
  id: "staged_1",
  symbol: "NAS100",
  dir: 1,
  status: "staged",
  entryPrice: 20500.0,
  slPrice: 20455.0,
  tpPrice: 20635.0,
  targetRR: 3.0,
  horizon: "day",
};
const stagedDrawing = buildStagedTradeDrawings(mockStagedTrade, mockBars, 300, 0);
assert(stagedDrawing.posDrawing.style.statsLabel.includes("SL: 45.0 pts"), "Staged drawing statsLabel must include SL: 45.0 pts");
console.log(`✅ PASS: Staged chart RR tool displays statsLabel: "${stagedDrawing.posDrawing.style.statsLabel}"`);

// 9. Active Trade Drawing statsLabel integration
const mockActiveTrade = {
  id: "active_1",
  symbol: "GBPJPY",
  dir: 1,
  status: "active",
  filledAt: 1000,
  entryPrice: 195.400,
  slPrice: 195.150,
  tpPrice: 196.150,
  idealR: 3.0,
  actualR: 1.2,
};
const activeDrawing = buildAutonomousDrawings(mockActiveTrade, mockBars, 300);
assert(activeDrawing.posDrawing.style.statsLabel.includes("SL: 25.0p"), "Active drawing statsLabel must include SL: 25.0p");
console.log(`✅ PASS: Active chart RR tool displays statsLabel: "${activeDrawing.posDrawing.style.statsLabel}"`);

console.log("\n=======================================================");
console.log("🎯 ALL SL DISTANCE TESTS PASSED (100% SUCCESS)");
console.log("=======================================================");
