// scripts/test_rr_tool_geometry_and_theme.mjs
// Rigorous verification of auto RR tool geometry, placement, and dark-theme high-contrast styling.

import assert from "node:assert";
import {
  buildAutonomousDrawings,
  tradeToPositionDrawings,
  buildStagedTradeDrawings,
  buildRadarTradeIdeaDrawing,
} from "../lib/autonomous/tradeDrawing.js";

console.log("=====================================================================");
console.log("TEST SUITE: Auto RR Tool Geometry, Placement & Dark Theme Palette");
console.log("=====================================================================");

const tfSec = 300; // 5-minute candles
const baseTime = 1712500000;
const mockBars = [
  { time: baseTime, open: 1.0800, high: 1.0820, low: 1.0790, close: 1.0810 },
  { time: baseTime + 300, open: 1.0810, high: 1.0830, low: 1.0805, close: 1.0825 },
  { time: baseTime + 600, open: 1.0825, high: 1.0845, low: 1.0815, close: 1.0835 },
  { time: baseTime + 900, open: 1.0835, high: 1.0855, low: 1.0825, close: 1.0840 },
  { time: baseTime + 1200, open: 1.0840, high: 1.0860, low: 1.0830, close: 1.0850 },
  { time: baseTime + 1500, open: 1.0850, high: 1.0870, low: 1.0840, close: 1.0860 },
  { time: baseTime + 1800, open: 1.0860, high: 1.0880, low: 1.0850, close: 1.0870 },
  { time: baseTime + 2100, open: 1.0870, high: 1.0890, low: 1.0860, close: 1.0875 },
  { time: baseTime + 2400, open: 1.0875, high: 1.0895, low: 1.0865, close: 1.0880 },
  { time: baseTime + 2700, open: 1.0880, high: 1.0900, low: 1.0870, close: 1.0885 },
  { time: baseTime + 3000, open: 1.0885, high: 1.0910, low: 1.0875, close: 1.0890 }, // lastBar: index 10
];
const lastBar = mockBars[mockBars.length - 1];

// -------------------------------------------------------------
// TEST 1: Live but UNEXECUTED Trade (Resting Limit Order)
// -------------------------------------------------------------
const unexecutedLimitTrade = {
  _id: "trade_pending_limit_1",
  symbol: "EURUSD",
  dir: 1,
  direction: "BUY",
  status: "pending",
  orderType: "limit",
  entryPrice: 1.0850,
  initialSlPrice: 1.0830, // 20 pips risk
  tpPrice: 1.0910,        // 60 pips reward = 3.0RR
  targetRR: 3.0,
  createdAt: new Date(lastBar.time * 1000).toISOString(),
  // filledAt is NULL — trade is waiting to be filled!
};

const resultUnexecuted = buildAutonomousDrawings(unexecutedLimitTrade, mockBars, tfSec, { index: 0 });
assert(resultUnexecuted !== null && resultUnexecuted.posDrawing !== null, "Drawing must be created");

const dUnexec = resultUnexecuted.posDrawing;
assert.strictEqual(dUnexec.kind, "long-position", "Must be long-position tool");

// Check geometry:
const expectedEntryTime = lastBar.time + (4 * tfSec);
const expectedP2Time = expectedEntryTime + (12 * tfSec);
assert.strictEqual(dUnexec.points[0].time, expectedEntryTime, "Left boundary must project 4 candles right of current live candle");
assert.strictEqual(dUnexec.points[1].time, expectedP2Time, "Right boundary must be exactly 12 bars width");
assert.strictEqual(dUnexec.points[1].time - dUnexec.points[0].time, 12 * tfSec, "Total width must be 12 bars (3600s), NOT 1 bar (300s)!");
assert.strictEqual(dUnexec.style.lineStyle, "dashed", "Unexecuted trade entry line must be dashed");
assert.strictEqual(dUnexec.style.isPendingLimit, true, "Flagged as isPendingLimit: true");
assert.strictEqual(dUnexec.style.isStaged, true, "Flagged as isStaged: true so labels render cleanly");
assert.strictEqual(dUnexec.style.actualR, 0.0, "Actual R is 0.0 before fill");
assert.ok(dUnexec.style.statsLabel.includes("RESTING LIMIT"), "Stats label must indicate RESTING LIMIT");
assert.ok(dUnexec.style.statsLabel.includes("1:3.00RR"), "Stats label must display planned 1:3.00RR");
console.log("✅ PASS: Unexecuted live trade projects 4 candles right of current candle with 12-bar width and dashed line");

// -------------------------------------------------------------
// TEST 2: High-Visibility Theme Colors and Transparency on Black Theme
// -------------------------------------------------------------
// TP side must be Vibrant Emerald Green (#10b981)
assert.strictEqual(dUnexec.style.targetColor, "#10b981", "Target color must be Vibrant Emerald Green (#10b981)");
// SL side must be Crisp Coral Red (#ef4444)
assert.strictEqual(dUnexec.style.stopColor, "#ef4444", "Stop color must be Crisp Coral Red (#ef4444)");
// Entry Line must be Bright Electric Sky Blue (#38bdf8)
assert.strictEqual(dUnexec.style.color, "#38bdf8", "Entry line must be Bright Electric Sky Blue (#38bdf8)");
// Transparency must be 70 (30% fill opacity, NOT 90 / 10% invisible opacity)
assert.strictEqual(dUnexec.style.targetTransparency, 70, "Target transparency must be 70 (30% fill opacity)");
assert.strictEqual(dUnexec.style.stopTransparency, 70, "Stop transparency must be 70 (30% fill opacity)");
console.log("✅ PASS: Dark theme colors (#10b981 Emerald / #ef4444 Coral Red / #38bdf8 Sky Blue) and 30% opacity verified");

// -------------------------------------------------------------
// TEST 3: Multi-setup Index Offset for Unexecuted Trades
// -------------------------------------------------------------
const unexecutedLimitTrade2 = {
  ...unexecutedLimitTrade,
  _id: "trade_pending_limit_2",
  entryPrice: 1.0830,
};
const resultUnexecuted2 = buildAutonomousDrawings(unexecutedLimitTrade2, mockBars, tfSec, { index: 1 });
const dUnexec2 = resultUnexecuted2.posDrawing;
assert.strictEqual(dUnexec2.points[0].time, lastBar.time + (6 * tfSec), "Second unexecuted trade offset by index (6 candles)");
console.log("✅ PASS: Multiple resting limit orders staggered cleanly by index");

// -------------------------------------------------------------
// TEST 4: Live FILLED & Running Trade (Executed)
// -------------------------------------------------------------
const filledActiveTrade = {
  _id: "trade_filled_active_1",
  symbol: "EURUSD",
  dir: 1,
  direction: "BUY",
  status: "active",
  entryPrice: 1.0825,
  initialSlPrice: 1.0780,
  tpPrice: 1.0950,
  targetRR: 3.0,
  filledAt: new Date(mockBars[2].time * 1000).toISOString(),
  filledPrice: 1.0825,
};

const resultFilled = buildAutonomousDrawings(filledActiveTrade, mockBars, tfSec);
const dFilled = resultFilled.posDrawing;
assert.strictEqual(dFilled.points[0].time, mockBars[2].time, "Filled trade starts at actual fill candle (mockBars[2])");
assert.strictEqual(dFilled.points[1].time, lastBar.time + tfSec, "Live running trade extends to current candle + 1 step");
assert.strictEqual(dFilled.style.lineStyle, "solid", "Executed live trade entry line must be solid");
assert.strictEqual(dFilled.style.isLive, true, "Flagged as isLive: true");
assert.strictEqual(dFilled.style.isPendingLimit, false, "Flagged as isPendingLimit: false");
assert.strictEqual(dFilled.style.targetColor, "#10b981", "Filled trade uses Vibrant Emerald Green");
assert.strictEqual(dFilled.style.stopColor, "#ef4444", "Filled trade uses Crisp Coral Red");
assert.strictEqual(dFilled.style.targetTransparency, 70, "Filled trade uses 70 transparency");
console.log("✅ PASS: Filled active trade starts at actual fill bar and spans forward with solid entry line");

// -------------------------------------------------------------
// TEST 5: Closed Trade (TP Hit)
// -------------------------------------------------------------
const closedTpTrade = {
  _id: "trade_closed_tp_1",
  symbol: "EURUSD",
  dir: 1,
  direction: "BUY",
  status: "closed_tp",
  entryPrice: 1.0825,
  initialSlPrice: 1.0805,
  tpPrice: 1.0875,
  filledAt: new Date(mockBars[2].time * 1000).toISOString(),
  closedAt: new Date(mockBars[8].time * 1000).toISOString(),
};

const resultClosed = buildAutonomousDrawings(closedTpTrade, mockBars, tfSec);
const dClosed = resultClosed.posDrawing;
assert.strictEqual(dClosed.points[0].time, mockBars[2].time, "Closed trade starts at entry");
assert.strictEqual(dClosed.points[1].time, mockBars[6].time, "Closed trade stops at TP hit candle (mockBars[6])");
assert.strictEqual(dClosed.style.lineStyle, "solid", "Closed trade entry line is solid");
console.log("✅ PASS: Closed trade strictly terminates at exit candle");

// -------------------------------------------------------------
// TEST 6: Staged Trade Drawing Transparency
// -------------------------------------------------------------
const stagedSetup = {
  _id: "staged_test_1",
  symbol: "EURUSD",
  dir: 1,
  direction: "BUY",
  status: "staged",
  entryPrice: 1.0850,
  slPrice: 1.0830,
  tpPrice: 1.0910,
};
const stagedResult = buildStagedTradeDrawings(stagedSetup, mockBars, tfSec, 0);
assert(stagedResult !== null && stagedResult.posDrawing !== null, "Staged drawing created");
const stagedDrawing = stagedResult.posDrawing;
assert.strictEqual(stagedDrawing.style.targetTransparency, 70, "Staged drawing target transparency is 70");
assert.strictEqual(stagedDrawing.style.stopTransparency, 70, "Staged drawing stop transparency is 70");
console.log("✅ PASS: Staged trade drawings use 70 transparency for black theme visibility");

// -------------------------------------------------------------
// TEST 7: Radar Trade Idea Drawing Transparency
// -------------------------------------------------------------
const radarPair = {
  symbol: "EURUSD",
  tradeableSymbol: "EURUSD",
  radarKey: "EURUSD_RADAR_TEST",
  side: "BUY",
  status: "PRIME_A_PLUS",
  stagedLevel: {
    entry: 1.0850,
    sl: 1.0830,
    tp: 1.0910,
    rr: 3.0,
  },
};
const radarDrawing = buildRadarTradeIdeaDrawing(radarPair, mockBars, tfSec, 0);
assert(radarDrawing !== null, "Radar drawing created");
assert.strictEqual(radarDrawing.style.targetTransparency, 70, "Radar drawing target transparency is 70");
assert.strictEqual(radarDrawing.style.stopTransparency, 70, "Radar drawing stop transparency is 70");
console.log("✅ PASS: Radar idea drawings use 70 transparency for black theme visibility");

console.log("\n=====================================================================");
console.log("🎯 ALL AUTO RR TOOL GEOMETRY & THEME TESTS PASSED (100% SUCCESS)!");
console.log("=====================================================================");
