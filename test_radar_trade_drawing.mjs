import assert from "node:assert";
import { buildRadarTradeIdeaDrawing, pairToRadarTradeIdeaDrawings } from "./lib/autonomous/tradeDrawing.js";

console.log("=====================================================================");
console.log("TEST: Market Opportunity Radar Trade Idea Drawing & Color Scheme");
console.log("=====================================================================");

const mockBars = [
  { time: 1712500000, open: 1.0800, high: 1.0850, low: 1.0790, close: 1.0830 },
  { time: 1712500300, open: 1.0830, high: 1.0860, low: 1.0810, close: 1.0840 },
  { time: 1712500600, open: 1.0840, high: 1.0870, low: 1.0820, close: 1.0850 },
];

const mockPairLong = {
  symbol: "EURUSD",
  tradeableSymbol: "EURUSD",
  radarKey: "EURUSD_A_PRIME",
  side: "BUY",
  status: "PRIME_A_PLUS",
  horizon: "DAY",
  entryPrice: 1.0850,
  slPrice: 1.0820,
  tpPrice: 1.0920,
  opportunityScore: 92,
  conviction: 88,
  dealingRange: {
    low: 1.0800,
    high: 1.0950,
    eq: 1.0875,
  },
};

const mockPairShort = {
  symbol: "GBPUSD",
  tradeableSymbol: "GBPUSD",
  radarKey: "GBPUSD_TOP_SETUP",
  side: "SELL",
  status: "TOP_SETUP",
  horizon: "SWING",
  entryPrice: 1.2700,
  slPrice: 1.2750,
  tpPrice: 1.2580,
  opportunityScore: 85,
  conviction: 80,
  dealingRange: {
    low: 1.2550,
    high: 1.2800,
    eq: 1.2675,
  },
};

// 1. Long Radar Idea Drawing
const longDrawing = buildRadarTradeIdeaDrawing(mockPairLong, mockBars, 300, 0);
assert(longDrawing !== null, "Long radar drawing should be generated");
assert.strictEqual(longDrawing.kind, "long-position");
assert.strictEqual(longDrawing.style.targetColor, "#a855f7", "Target color must be Electric Violet (#a855f7)");
assert.strictEqual(longDrawing.style.stopColor, "#ea580c", "Stop color must be Burnt Orange (#ea580c)");
assert.strictEqual(longDrawing.style.color, "#c084fc", "Entry line color must be Lavender (#c084fc)");
assert(longDrawing.points[0].time > mockBars[mockBars.length - 1].time, "Entry time must project to the right of current bars");
console.log("✅ PASS: Long Radar Idea Drawing has correct Electric Violet & Burnt Orange palette and offset");

// 2. Short Radar Idea Drawing
const shortDrawing = buildRadarTradeIdeaDrawing(mockPairShort, mockBars, 300, 1);
assert(shortDrawing !== null, "Short radar drawing should be generated");
assert.strictEqual(shortDrawing.kind, "short-position");
assert.strictEqual(shortDrawing.style.targetColor, "#a855f7", "Target color must be Electric Violet (#a855f7)");
assert.strictEqual(shortDrawing.style.stopColor, "#ea580c", "Stop color must be Burnt Orange (#ea580c)");
assert.strictEqual(shortDrawing.style.color, "#c084fc", "Entry line color must be Lavender (#c084fc)");
console.log("✅ PASS: Short Radar Idea Drawing has correct colors and short-position kind");

// 3. pairToRadarTradeIdeaDrawings returns array
const drawingsArr = pairToRadarTradeIdeaDrawings(mockPairLong, mockBars, 300, 0);
assert(Array.isArray(drawingsArr) && drawingsArr.length === 1);
console.log("✅ PASS: pairToRadarTradeIdeaDrawings returns valid drawings array");

// 4. Color Constraint check: neither side should be standard green or red or blue
assert(longDrawing.style.targetColor !== "#22c55e" && longDrawing.style.targetColor !== "#10b981" && longDrawing.style.targetColor !== "#2563eb", "Target cannot be green or blue");
assert(longDrawing.style.stopColor !== "#ef4444" && longDrawing.style.stopColor !== "#f43f5e", "Stop cannot be standard red");
console.log("✅ PASS: Target and Stop sides strictly avoid green, red, and blue as mandated");

// 5. Ephemeral ID check
assert(longDrawing.id.startsWith("auto_radar_"), "ID must start with auto_radar_ so DrawingManager does not persist it to local user drawings");
console.log("✅ PASS: Ephemeral ID prefix auto_radar_ verified");

console.log("\n🎯 ALL RADAR TRADE IDEA DRAWING TESTS PASSED 100%!\n");
