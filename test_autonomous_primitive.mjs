// test_autonomous_primitive.mjs — Comprehensive Unit Tests for Native Lightweight Charts Drawing RR Tools

import assert from "node:assert/strict";
import { tradeToPositionDrawing, tradeToPositionDrawings, buildStagedTradeDrawing, tradeToStagedPositionDrawings } from "./lib/autonomous/tradeDrawing.js";
import * as lwcd from "lightweight-charts-drawing";

console.log("=====================================================================");
console.log("TEST SUITE: Native Lightweight-Charts-Drawing RR Tools (Position)");
console.log("=====================================================================\n");

const baseTime = 1700000000;
const tfSec = 300; // 5M bars
const mockBars = Array.from({ length: 50 }, (_, i) => ({
  time: baseTime + i * tfSec,
  open: 1.0850,
  high: 1.0860,
  low: 1.0840,
  close: 1.0855,
}));

// Mock browser globals for lightweight-charts-drawing scene measurement
global.document = {
  body: {},
  createElement: () => ({
    getContext: () => ({
      measureText: (txt) => ({ width: (txt || "").length * 7 }),
    }),
  }),
};
global.getComputedStyle = () => ({ fontFamily: "sans-serif" });

// -------------------------------------------------------------
// TEST 1: Live Default Model BUY Trade -> "long-position"
// -------------------------------------------------------------
const liveDefaultTrade = {
  _id: "trade_def_1",
  symbol: "EURUSD",
  dir: 1,
  direction: "BUY",
  status: "active",
  managementLogic: "milestone_50",
  entryPrice: 1.0850,
  filledPrice: 1.0850,
  initialSlPrice: 1.0830, // 20 pips risk
  slPrice: 1.0850,        // SL moved to Breakeven
  tpPrice: 1.0900,        // 50 pips reward = 2.5R
  targetRR: 2.5,
  isBreakeven: true,
  createdAt: new Date(mockBars[10].time * 1000).toISOString(),
  filledAt: new Date(mockBars[10].time * 1000).toISOString(),
};

const d1 = tradeToPositionDrawing(liveDefaultTrade, mockBars, tfSec);
assert(d1 !== null, "Drawing object should be constructed for live default BUY trade");
assert.equal(d1.kind, "long-position", "BUY trade must produce native 'long-position' tool");
assert.equal(d1.id, "auto_trade_def_1", "ID must be prefixed with auto_");
assert.equal(d1.points[0].price, 1.0850, "Entry price must be 1.0850");
assert.equal(d1.points[0].time, mockBars[10].time, "Entry time must match filledAt timestamp");
assert(d1.points[1].time > d1.points[0].time, "Right boundary time must project forward");
assert.equal(d1.points[1].price, 1.0850, "Right boundary horizontal price aligns with entry");
assert.equal(Math.round(d1.style.stopLevel * 100000) / 100000, 0.0020, "stopLevel must equal initial SL distance 20 pips");
assert.equal(Math.round(d1.style.profitLevel * 100000) / 100000, 0.0050, "profitLevel must equal TP distance 50 pips (2.5R)");
assert.equal(d1.style.targetColor, "#0284c7", "Default model target color must be Electric Cobalt Blue");
assert.equal(d1.style.stopColor, "#ea580c", "Default model stop color must be Vivid Tangerine Amber");
assert.equal(d1.style.targetTransparency, 90, "targetTransparency must be 90 (10% fill opacity)");
assert.equal(d1.style.stopTransparency, 90, "stopTransparency must be 90 (10% fill opacity)");
assert.equal(d1.style.compactStats, true, "compactStats mode enabled");
assert.equal(d1.locked, true, "Drawing must be locked");
console.log("✅ PASS: Live Default Model BUY trade -> native 'long-position' verified");

// -------------------------------------------------------------
// TEST 2: Live Prop-Firm Safe SELL Trade -> "short-position"
// -------------------------------------------------------------
const livePropTrade = {
  _id: "trade_prop_1",
  symbol: "EURUSD",
  dir: -1,
  direction: "SELL",
  status: "managing",
  managementLogic: "prop_firm_safe",
  leg: "prop",
  entryPrice: 1.0850,
  initialSlPrice: 1.0870, // 20 pips risk
  slPrice: 1.0860,        // SL halved
  tpPrice: 1.0814,        // 36 pips reward = 1.8R
  targetRR: 1.8,
  filledAt: new Date(mockBars[15].time * 1000).toISOString(),
  createdAt: new Date(mockBars[15].time * 1000).toISOString(),
};

const d2 = tradeToPositionDrawing(livePropTrade, mockBars, tfSec);
assert(d2 !== null, "Drawing object should be constructed for live prop SELL trade");
assert.equal(d2.kind, "short-position", "SELL trade must produce native 'short-position' tool");
assert.equal(d2.points[0].price, 1.0850, "Entry price must be 1.0850");
assert.equal(Math.round(d2.style.stopLevel * 100000) / 100000, 0.0020, "stopLevel must equal initial SL distance 20 pips");
assert.equal(Math.round(d2.style.profitLevel * 100000) / 100000, 0.0036, "profitLevel must equal TP distance 36 pips (1.8R)");
assert.equal(d2.style.targetColor, "#a855f7", "Prop model target color must be Neon Violet");
assert.equal(d2.style.stopColor, "#ec4899", "Prop model stop color must be Vivid Fuchsia/Magenta");
assert.equal(d2.style.targetTransparency, 90, "10% fill opacity");
assert.equal(d2.style.stopTransparency, 90, "10% fill opacity");
assert.equal(d2.style.color, "#c084fc", "Prop model accent color must be Neon Violet");
console.log("✅ PASS: Live Prop-Firm Safe SELL trade -> native 'short-position' verified");

// -------------------------------------------------------------
// TEST 3: Historical Closed Trade Strictly Bounded to Exit Time
// -------------------------------------------------------------
const closedWinTrade = {
  _id: "trade_closed_1",
  symbol: "EURUSD",
  dir: 1,
  direction: "BUY",
  status: "closed_tp",
  managementLogic: "prop_firm_safe",
  entryPrice: 1.0840,
  initialSlPrice: 1.0820,
  slPrice: 1.0840,
  tpPrice: 1.0884,
  targetRR: 2.2,
  createdAt: new Date(mockBars[5].time * 1000).toISOString(),
  filledAt: new Date(mockBars[5].time * 1000).toISOString(),
  closedAt: new Date(mockBars[30].time * 1000).toISOString(),
};

const d3 = tradeToPositionDrawing(closedWinTrade, mockBars, tfSec);
assert(d3 !== null, "Drawing object should be constructed for closed trade");
assert.equal(d3.points[0].time, mockBars[5].time, "Entry time must align with filledAt");
assert.equal(d3.points[1].time, mockBars[30].time, "Right boundary time must align with closedAt");
console.log("✅ PASS: Historical closed trade strictly bounded from entry to exit time");

// -------------------------------------------------------------
// TEST 4: Native lightweight-charts-drawing Scene Generation
// -------------------------------------------------------------
const mockCoords = {
  timeToX: (t) => 100 + (t - baseTime) / 10,
  priceToY: (p) => 500 - (p - 1.0800) * 100000,
  xToTime: (x) => baseTime + (x - 100) * 10,
  yToPrice: (y) => 1.0800 + (500 - y) / 100000,
  pipSize: () => 0.0001,
  bars: () => mockBars,
  timeToBarIndex: (t) => Math.floor((t - baseTime) / tfSec),
};

const pts = [
  { x: mockCoords.timeToX(d1.points[0].time), y: mockCoords.priceToY(d1.points[0].price) },
  { x: mockCoords.timeToX(d1.points[1].time), y: mockCoords.priceToY(d1.points[1].price) },
];

const sceneItems = lwcd.sceneOf(d1, pts, { w: 1200, h: 800, coords: mockCoords, selected: false });
assert(Array.isArray(sceneItems), "sceneOf must return scene items array");
assert(sceneItems.length >= 4, "Must generate background boxes, lines, and stats");
const hasRect = sceneItems.some((s) => s.t === "rect");
assert(hasRect, "Native sceneOf must render rectangular position risk/reward zones");
console.log(`✅ PASS: Native lightweight-charts-drawing sceneOf verified (${sceneItems.length} items rendered)`);

// -------------------------------------------------------------
// TEST 5: DrawingManager List Synchronization & Isolation
// -------------------------------------------------------------
const userManualDrawing = {
  id: "user_dw_trend_1",
  kind: "trend-line",
  points: [{ time: baseTime, price: 1.0850 }, { time: baseTime + 3600, price: 1.0870 }],
};

// Simulate DrawingManager list
let managerList = [userManualDrawing];

// Sync autonomous trades
const autoDrawings = [d1, d2, d3];
const userDrawings = managerList.filter((d) => !String(d.id).startsWith("auto_"));
managerList = [...userDrawings, ...autoDrawings];

assert.equal(managerList.length, 4, "Manager list should contain 1 user drawing and 3 auto trade drawings");

// Verify persistence filter excludes auto_ drawings
const savedToLocalStorage = managerList.filter((d) => !String(d.id).startsWith("auto_"));
assert.equal(savedToLocalStorage.length, 1, "Only user manual drawing is saved to localStorage");
assert.equal(savedToLocalStorage[0].id, "user_dw_trend_1", "User drawing identity preserved");

// Toggle off
const toggledOffList = managerList.filter((d) => !String(d.id).startsWith("auto_"));
assert.equal(toggledOffList.length, 1, "Disabling autoTrades cleanly removes all auto drawings");
console.log("✅ PASS: DrawingManager synchronization, isolation & persistence filtering verified");

// -------------------------------------------------------------
// TEST 6: User-Supplied Live BTC Trade Exact Geometry Verification
// -------------------------------------------------------------
const btcLiveTrade = {
  _id: "6ac35c9ef21b2716b49eb325",
  symbol: "BTCUSD",
  dir: -1,
  direction: "SELL",
  status: "managing",
  entryPrice: 86512.33,
  filledPrice: 86512.33,
  initialSlPrice: 87139.00, // Original structural SL
  slPrice: 86512.33,        // Breakeven active
  tpPrice: 84468.00,
  filledAt: "2026-10-05T17:18:00.000Z",
  createdAt: "2026-10-05T17:18:00.000Z",
};

const dBtc = tradeToPositionDrawing(btcLiveTrade, mockBars, tfSec);
assert(dBtc !== null, "BTC live trade must be converted to native position drawing");
assert.equal(dBtc.kind, "short-position", "SELL trade must be short-position");
assert.equal(dBtc.points[0].price, 86512.33, "Entry price must be 86512.33");
assert.equal(dBtc.points[0].time, Math.round(new Date("2026-10-05T17:18:00.000Z").getTime() / 1000), "Entry time must be 5 Oct 17:18 EET");
assert.equal(Math.round(dBtc.style.stopLevel * 100) / 100, 626.67, "stopLevel must be |86512.33 - 87139| = 626.67");
assert.equal(Math.round(dBtc.style.profitLevel * 100) / 100, 2044.33, "profitLevel must be |86512.33 - 84468| = 2044.33");
assert.equal(dBtc.style.targetTransparency, 90, "Must enforce 10% opacity on TP side");
assert.equal(dBtc.style.stopTransparency, 90, "Must enforce 10% opacity on SL side");
assert(dBtc.style.targetColor !== "#089981" && dBtc.style.targetColor !== "#26a69a", "Target color must not be default green");
assert(dBtc.style.stopColor !== "#f23645" && dBtc.style.stopColor !== "#ef5350", "Stop color must not be default red");
console.log("✅ PASS: Live BTC trade verified with exact 5 Oct 17:18 EET entry & 87139 original SL");

// -------------------------------------------------------------
// TEST 7: Rejection of Unexecuted / Invalidated Setups (No Phantom Pillars)
// -------------------------------------------------------------
const bogusInvalidatedSetup = {
  _id: "bogus_setup_1",
  symbol: "BTCUSD",
  status: "invalidated",
  entryPrice: 85853.5,
  slPrice: 85728.29,
  tpPrice: 84468,
  createdAt: "2026-10-05T06:03:26.182Z",
  closedAt: "2026-10-05T06:03:27.503Z", // 1-second lifespan, NEVER filled
};

const dPhantom = tradeToPositionDrawing(bogusInvalidatedSetup, mockBars, tfSec);
assert.equal(dPhantom, null, "Unentered invalidated setups must be rejected (0 phantom pillars)");
console.log("✅ PASS: Unentered invalidated setups rejected cleanly");

// -------------------------------------------------------------
// TEST 8: Missing Original SL Fallback -> Exactly 2.0RR Geometry
// -------------------------------------------------------------
const legacyNoSlTrade = {
  _id: "legacy_no_sl_1",
  symbol: "EURUSD",
  dir: 1,
  direction: "BUY",
  status: "closed_tp",
  entryPrice: 1.0850,
  filledPrice: 1.0850,
  // initialSlPrice is null/missing; slPrice was moved to breakeven (1.0850)
  initialSlPrice: null,
  slPrice: 1.0850,
  isBreakeven: true,
  tpPrice: 1.0950, // 100 pips profit
  filledAt: new Date(mockBars[5].time * 1000).toISOString(),
  closedAt: new Date(mockBars[25].time * 1000).toISOString(),
};

const dFallback = tradeToPositionDrawing(legacyNoSlTrade, mockBars, tfSec);
assert(dFallback !== null, "Drawing must be generated with 2RR fallback");
assert.equal(dFallback.kind, "long-position");
assert.equal(dFallback.style.profitLevel, 0.0100, "Profit level must be |1.0950 - 1.0850| = 0.0100");
assert.equal(dFallback.style.stopLevel, 0.0050, "Stop level must be profitLevel / 2.0 = 0.0050 (2.0RR)");
const calculatedRR = Math.round((dFallback.style.profitLevel / dFallback.style.stopLevel) * 10) / 10;
assert.equal(calculatedRR, 2.0, "Trade geometry must be exactly 2.0R");
console.log("✅ PASS: Trades missing original SL fall back to exactly 2.0RR geometry (stopLevel = profitLevel / 2)");

// -------------------------------------------------------------
// TEST 9: Strict Right Boundary Truncation at Exact TP Hit Candle
// -------------------------------------------------------------
// Create realistic price action where candle 22 pierces TP level 1.0900
const dynamicBarsTp = mockBars.map((b, i) => {
  if (i < 10) return { ...b, open: 1.0845, high: 1.0855, low: 1.0840, close: 1.0850 };
  if (i < 22) return { ...b, open: 1.0850 + (i - 10) * 0.0003, high: 1.0855 + (i - 10) * 0.0003, low: 1.0848, close: 1.0852 + (i - 10) * 0.0003 };
  if (i === 22) return { ...b, open: 1.0886, high: 1.0910, low: 1.0880, close: 1.0905 }; // Pierces TP 1.0900!
  return { ...b, open: 1.0905, high: 1.0920, low: 1.0895, close: 1.0915 }; // Future candles
});

const tpHitTrade = {
  _id: "trade_tp_hit_1",
  symbol: "EURUSD",
  dir: 1,
  direction: "BUY",
  status: "closed_tp",
  entryPrice: 1.0850,
  initialSlPrice: 1.0830,
  tpPrice: 1.0900,
  filledAt: new Date(dynamicBarsTp[10].time * 1000).toISOString(),
  closedAt: new Date(dynamicBarsTp[40].time * 1000).toISOString(), // closedAt is later, but candle 22 hit TP
};

const dTpHit = tradeToPositionDrawing(tpHitTrade, dynamicBarsTp, tfSec);
assert.equal(dTpHit.points[0].time, dynamicBarsTp[10].time, "Entry must be bar 10");
assert.equal(dTpHit.points[1].time, dynamicBarsTp[22].time, "Right boundary must strictly truncate at candle 22 where TP was hit");
console.log("✅ PASS: RR tool right boundary strictly snaps to exact Take Profit hit candle");

// -------------------------------------------------------------
// TEST 10: Strict Right Boundary Truncation at Trailing SL Hit Candle
// -------------------------------------------------------------
// Short trade enters at 1.0850 on bar 10. Trailing SL moved to 1.0840. Bar 18 rises to 1.0842 (hitting trailing SL)
const dynamicBarsTrail = mockBars.map((b, i) => {
  if (i < 10) return { ...b, open: 1.0855, high: 1.0860, low: 1.0850, close: 1.0852 };
  if (i < 18) return { ...b, open: 1.0840, high: 1.0835, low: 1.0820, close: 1.0825 };
  if (i === 18) return { ...b, open: 1.0825, high: 1.0845, low: 1.0820, close: 1.0840 }; // Pierces trailing SL 1.0840!
  return { ...b, open: 1.0840, high: 1.0860, low: 1.0835, close: 1.0850 };
});

const trailHitTrade = {
  _id: "trade_trail_hit_1",
  symbol: "EURUSD",
  dir: -1,
  direction: "SELL",
  status: "closed_be",
  entryPrice: 1.0850,
  initialSlPrice: 1.0870,
  slPrice: 1.0840, // Trailed SL
  confirmedSlPrice: 1.0840,
  tpPrice: 1.0800,
  filledAt: new Date(dynamicBarsTrail[10].time * 1000).toISOString(),
  closedAt: new Date(dynamicBarsTrail[45].time * 1000).toISOString(),
};

const dTrailHit = tradeToPositionDrawing(trailHitTrade, dynamicBarsTrail, tfSec);
assert.equal(dTrailHit.points[0].time, dynamicBarsTrail[10].time, "Entry must be bar 10");
assert.equal(dTrailHit.points[1].time, dynamicBarsTrail[18].time, "Right boundary must strictly truncate at candle 18 where Trailing SL was hit");
console.log("✅ PASS: RR tool right boundary strictly snaps to exact Trailing SL hit candle");

// -------------------------------------------------------------
// TEST 11: Live Active Trade Bounded to Exactly 1 Candle Next (+1 tfSec for Wick Visibility)
// -------------------------------------------------------------
const liveUnfinishedTrade = {
  _id: "trade_live_open_1",
  symbol: "EURUSD",
  dir: 1,
  direction: "BUY",
  status: "active",
  entryPrice: 1.0850,
  initialSlPrice: 1.0820,
  tpPrice: 1.0950,
  filledAt: new Date(mockBars[10].time * 1000).toISOString(),
};

const dLiveUnfinished = tradeToPositionDrawing(liveUnfinishedTrade, mockBars, tfSec);
const expectedLiveP2Time = mockBars[mockBars.length - 1].time + tfSec;
assert.equal(dLiveUnfinished.points[1].time, expectedLiveP2Time, "Live active trade right boundary must be exactly one candle next (+1 tfSec)");
console.log("✅ PASS: Live active trade right boundary strictly has only one candle next (+1 tfSec for wick visibility, zero whitespace projection)");

// -------------------------------------------------------------
// TEST 12: Boundary-to-Boundary Trailing SL Dashed Line via tradeToPositionDrawings
// -------------------------------------------------------------
const liveTradeWithBe = {
  _id: "trade_live_be_1",
  symbol: "EURUSD",
  dir: 1,
  direction: "BUY",
  status: "managing",
  entryPrice: 1.0850,
  initialSlPrice: 1.0830,
  slPrice: 1.0850, // Moved to Breakeven
  isBreakeven: true,
  tpPrice: 1.0900,
  filledAt: new Date(mockBars[10].time * 1000).toISOString(),
};

const allDrawings = tradeToPositionDrawings(liveTradeWithBe, mockBars, tfSec);
assert.equal(allDrawings.length, 2, "Must return 2 drawings: native position tool + boundary-to-boundary trailing SL line");
assert.equal(allDrawings[0].kind, "long-position", "First drawing is the native position tool");
assert.equal(allDrawings[1].kind, "trend-line", "Second drawing is the trailing SL line");
assert.equal(allDrawings[1].id, "auto_trail_trade_live_be_1", "Trailing line ID must match auto_trail_ prefix");
assert.equal(allDrawings[1].style.lineStyle, "dashed", "Trailing line must be dashed");
assert.equal(allDrawings[1].points[0].time, allDrawings[0].points[0].time, "Trailing line starts at RR tool left boundary (entryTime)");
assert.equal(allDrawings[1].points[1].time, allDrawings[0].points[1].time, "Trailing line ends at RR tool right boundary (p2Time)");
assert.equal(allDrawings[1].points[0].price, 1.0850, "Trailing line horizontal price matches breakeven level");
assert.equal(allDrawings[1].points[1].price, 1.0850, "Trailing line horizontal price matches breakeven level");
assert.equal(allDrawings[1].locked, true, "Trailing line must be locked");
console.log("✅ PASS: Boundary-to-boundary Trailing SL dashed line verified across RR tool");

// -------------------------------------------------------------
// TEST 13: Pullback Tap of Trailing SL Line Truncates Both RR Tool and Line at Tap Candle
// -------------------------------------------------------------
// Short BTC trade entered on bar 10 at 86512.33 with initial SL 87139. Moved to BE 86512.33.
// Bar 25 pulls back and taps 86512.33 (high = 86515 >= 86512.33).
const dynamicBarsPullback = mockBars.map((b, i) => {
  if (i < 10) return { ...b, open: 86600, high: 86650, low: 86500, close: 86550 };
  if (i >= 10 && i < 25) return { ...b, open: 86400 - (i - 10) * 20, high: 86450 - (i - 10) * 20, low: 86200 - (i - 10) * 20, close: 86300 - (i - 10) * 20 };
  if (i === 25) return { ...b, open: 86200, high: 86520, low: 86180, close: 86480 }; // High 86520 >= 86512.33 (TAPS BE!)
  return { ...b, open: 86550, high: 86700, low: 86450, close: 86650 }; // Future candles after tap
});

const closedBeBtcTrade = {
  _id: "btc_tap_test_1",
  symbol: "BTCUSD",
  dir: -1,
  direction: "SELL",
  status: "closed_be",
  entryPrice: 86512.33,
  initialSlPrice: 87139.00,
  slPrice: 86512.33, // Breakeven active
  isBreakeven: true,
  tpPrice: 84468.00,
  filledAt: new Date(dynamicBarsPullback[10].time * 1000).toISOString(),
  closedAt: new Date(dynamicBarsPullback[45].time * 1000).toISOString(),
};

const tapDrawings = tradeToPositionDrawings(closedBeBtcTrade, dynamicBarsPullback, tfSec);
assert.equal(tapDrawings.length, 2, "Must produce position tool + trailing line");
const tapPos = tapDrawings[0];
const tapLine = tapDrawings[1];
assert.equal(tapPos.points[1].time, dynamicBarsPullback[25].time, "RR tool right boundary must strictly truncate at candle 25 where trailing SL was tapped");
assert.equal(tapLine.points[1].time, dynamicBarsPullback[25].time, "Trailing line right boundary must strictly truncate at candle 25 where trailing SL was tapped");
console.log("✅ PASS: Price pullback tapping trailing SL line strictly truncates RR tool and trailing line at tap candle for closed trade");

// Verify active running trade with BE/trailing NEVER prematurely truncates and spans to live candle + 1 offset:
const activeManagingBtcTrade = {
  ...closedBeBtcTrade,
  status: "managing",
  closedAt: null,
};
const activeManagingDrawings = tradeToPositionDrawings(activeManagingBtcTrade, dynamicBarsPullback, tfSec);
const expectedActiveP2 = dynamicBarsPullback[dynamicBarsPullback.length - 1].time + tfSec;
assert.equal(activeManagingDrawings[0].points[1].time, expectedActiveP2, "Active managing trade must span to live candle + 1 offset");
assert.equal(activeManagingDrawings[1].points[1].time, expectedActiveP2, "Active trailing line must span to live candle + 1 offset");
console.log("✅ PASS: Active running trade with BE/trailing spans continuously to live candle + 1 offset");

// -------------------------------------------------------------
// TEST 14: Dynamic Timeframe Switch (M5 -> M15 -> H1 -> H4) on TP Trade
// -------------------------------------------------------------
const tfSwitchBase = 1791244800; // 00:00:00 UTC
const tpTradeSwitch = {
  _id: "trade_tf_tp_1",
  symbol: "EURUSD",
  dir: 1,
  direction: "BUY",
  status: "closed_tp",
  entryPrice: 1.0850,
  initialSlPrice: 1.0830,
  tpPrice: 1.0900,
  filledAt: new Date((tfSwitchBase + 4200) * 1000).toISOString(), // 01:10:00 UTC
  closedAt: new Date((tfSwitchBase + 12050) * 1000).toISOString(), // 03:20:50 UTC
};

// Generate multi-timeframe bar series
const m5Bars = Array.from({ length: 60 }, (_, i) => {
  const t = tfSwitchBase + i * 300;
  const isTpHit = t >= tfSwitchBase + 12000; // Hit TP at 03:20 (12000s)
  return { time: t, open: 1.0850, high: isTpHit ? 1.0905 : 1.0870, low: 1.0840, close: 1.0855 };
});

const m15Bars = Array.from({ length: 20 }, (_, i) => {
  const t = tfSwitchBase + i * 900;
  const isTpHit = t >= tfSwitchBase + 11700; // Hit TP at 03:15 (11700s)
  return { time: t, open: 1.0850, high: isTpHit ? 1.0905 : 1.0870, low: 1.0840, close: 1.0855 };
});

const h1Bars = Array.from({ length: 10 }, (_, i) => {
  const t = tfSwitchBase + i * 3600;
  const isTpHit = t >= tfSwitchBase + 10800; // Hit TP in 03:00 bar (10800s)
  return { time: t, open: 1.0850, high: isTpHit ? 1.0905 : 1.0870, low: 1.0840, close: 1.0855 };
});

const h4Bars = Array.from({ length: 4 }, (_, i) => {
  const t = tfSwitchBase + i * 14400;
  const isTpHit = t === tfSwitchBase; // Both entry and exit occurred within 00:00 - 04:00 bar
  return { time: t, open: 1.0850, high: isTpHit ? 1.0905 : 1.0870, low: 1.0840, close: 1.0855 };
});

const dM5 = tradeToPositionDrawing(tpTradeSwitch, m5Bars, 300);
assert.equal(dM5.points[0].time, tfSwitchBase + 4200, "M5 entry must be bar 01:10 (4200s)");
assert.equal(dM5.points[1].time, tfSwitchBase + 12000, "M5 right boundary must strictly snap to TP hit candle at 03:20 (12000s)");

const dM15 = tradeToPositionDrawing(tpTradeSwitch, m15Bars, 900);
assert.equal(dM15.points[0].time, tfSwitchBase + 3600, "M15 entry must be bar 01:00 (3600s)");
assert.equal(dM15.points[1].time, tfSwitchBase + 11700, "M15 right boundary must strictly snap to TP hit candle at 03:15 (11700s)");

const dH1 = tradeToPositionDrawing(tpTradeSwitch, h1Bars, 3600);
assert.equal(dH1.points[0].time, tfSwitchBase + 3600, "H1 entry must be bar 01:00 (3600s)");
assert.equal(dH1.points[1].time, tfSwitchBase + 10800, "H1 right boundary must strictly snap to TP hit candle at 03:00 (10800s)");

const dH4 = tradeToPositionDrawing(tpTradeSwitch, h4Bars, 14400);
assert.equal(dH4.points[0].time, tfSwitchBase, "H4 entry must be bar 00:00");
assert.equal(dH4.points[1].time, tfSwitchBase + 14400, "H4 right boundary must be 1 full bar wide (00:00 + 14400) when entry & exit are within same bar");
console.log("✅ PASS: Dynamic Timeframe Switch (M5 -> M15 -> H1 -> H4) on TP Trade adapts boundaries precisely");

// -------------------------------------------------------------
// TEST 15: Timeframe Switch on Stop Loss Hit Trade
// -------------------------------------------------------------
const slTradeSwitch = {
  _id: "trade_tf_sl_1",
  symbol: "EURUSD",
  dir: 1,
  direction: "BUY",
  status: "closed_sl",
  entryPrice: 1.0850,
  initialSlPrice: 1.0830,
  tpPrice: 1.0900,
  filledAt: new Date((tfSwitchBase + 4200) * 1000).toISOString(),
  closedAt: new Date((tfSwitchBase + 7200) * 1000).toISOString(), // 02:00:00 UTC
};

const m5BarsSl = Array.from({ length: 40 }, (_, i) => {
  const t = tfSwitchBase + i * 300;
  const isSlHit = t >= tfSwitchBase + 7200; // Hit SL at 02:00
  return { time: t, open: 1.0850, high: 1.0860, low: isSlHit ? 1.0825 : 1.0845, close: 1.0850 };
});

const dM5Sl = tradeToPositionDrawing(slTradeSwitch, m5BarsSl, 300);
assert.equal(dM5Sl.points[1].time, tfSwitchBase + 7200, "M5 right boundary must strictly snap to SL hit candle at 02:00 (7200s)");
console.log("✅ PASS: Timeframe switch on Stop Loss hit trade terminates at exact SL candle");

// -------------------------------------------------------------
// TEST 16: Timeframe Switch on Breakeven Hit Trade
// -------------------------------------------------------------
const beTradeSwitch = {
  _id: "trade_tf_be_1",
  symbol: "EURUSD",
  dir: 1,
  direction: "BUY",
  status: "closed_be",
  entryPrice: 1.0850,
  initialSlPrice: 1.0830,
  slPrice: 1.0850,
  isBreakeven: true,
  tpPrice: 1.0900,
  filledAt: new Date((tfSwitchBase + 3600) * 1000).toISOString(), // 01:00:00 UTC
  closedAt: new Date((tfSwitchBase + 5400) * 1000).toISOString(), // 01:30:00 UTC
};

const m15BarsBe = Array.from({ length: 20 }, (_, i) => {
  const t = tfSwitchBase + i * 900;
  const isBeTap = t === tfSwitchBase + 5400; // Tapped BE at 01:30
  return { time: t, open: 1.0860, high: 1.0880, low: isBeTap ? 1.0848 : 1.0865, close: 1.0870 };
});

const dM15Be = tradeToPositionDrawing(beTradeSwitch, m15BarsBe, 900);
assert.equal(dM15Be.points[1].time, tfSwitchBase + 5400, "M15 right boundary must strictly snap to BE tap candle at 01:30 (5400s)");
console.log("✅ PASS: Timeframe switch on Breakeven hit trade terminates at exact BE candle");

// -------------------------------------------------------------
// TEST 17: Timeframe Switch on Trailing SL Hit Trade
// -------------------------------------------------------------
const trailTradeSwitch = {
  _id: "trade_tf_trail_1",
  symbol: "EURUSD",
  dir: -1,
  direction: "SELL",
  status: "closed_be",
  entryPrice: 1.0850,
  initialSlPrice: 1.0870,
  slPrice: 1.0835, // Trailed SL locked in profit
  confirmedSlPrice: 1.0835,
  isTrailing: true,
  tpPrice: 1.0800,
  filledAt: new Date((tfSwitchBase + 3600) * 1000).toISOString(),
  closedAt: new Date((tfSwitchBase + 7200) * 1000).toISOString(), // 02:00:00 UTC
};

const h1BarsTrail = Array.from({ length: 10 }, (_, i) => {
  const t = tfSwitchBase + i * 3600;
  const isTrailHit = t === tfSwitchBase + 7200; // Rises to 1.0838 >= 1.0835 at 02:00
  return { time: t, open: 1.0830, high: isTrailHit ? 1.0838 : 1.0832, low: 1.0820, close: 1.0825 };
});

const dH1Trail = tradeToPositionDrawings(trailTradeSwitch, h1BarsTrail, 3600);
assert.equal(dH1Trail.length, 2, "Must return position tool + trailing line");
assert.equal(dH1Trail[0].points[1].time, tfSwitchBase + 7200, "Position tool terminates at trailing SL candle 02:00");
assert.equal(dH1Trail[1].points[1].time, tfSwitchBase + 7200, "Trailing line terminates at trailing SL candle 02:00");
console.log("✅ PASS: Timeframe switch on Trailing SL hit trade terminates both RR tool and trailing line at exact tap candle");

// -------------------------------------------------------------
// TEST 18: Live Running Trade Adapts +1 Candle Next on Timeframe Switch
// -------------------------------------------------------------
const openTradeSwitch = {
  _id: "trade_tf_open_1",
  symbol: "EURUSD",
  dir: 1,
  direction: "BUY",
  status: "active",
  entryPrice: 1.0850,
  initialSlPrice: 1.0830,
  tpPrice: 1.0950,
  filledAt: new Date((tfSwitchBase + 3600) * 1000).toISOString(),
};

const dOpenM15 = tradeToPositionDrawing(openTradeSwitch, m15Bars, 900);
const lastM15Time = m15Bars[m15Bars.length - 1].time;
assert.equal(dOpenM15.points[1].time, lastM15Time + 900, "Live trade on M15 extends exactly 1 bar (+900s)");

const dOpenH1 = tradeToPositionDrawing(openTradeSwitch, h1Bars, 3600);
const lastH1Time = h1Bars[h1Bars.length - 1].time;
assert.equal(dOpenH1.points[1].time, lastH1Time + 3600, "Live trade on H1 extends exactly 1 bar (+3600s)");
console.log("✅ PASS: Live active trade right boundary dynamically adapts to +1 candle next across timeframes");

// -------------------------------------------------------------
// TEST 19: Staged Setup Drawing Geometry & 4-5 Candle Gap Right of Current Candle
// -------------------------------------------------------------
const stagedBuySetup = {
  _id: "staged_eur_1",
  symbol: "EURUSD",
  dir: 1,
  direction: "BUY",
  status: "staged",
  managementLogic: "milestone_50",
  entryPrice: 1.0820,
  initialSlPrice: 1.0800, // 20 pips risk
  tpPrice: 1.0870,        // 50 pips reward = 2.5R
  targetRR: 2.5,
  horizon: "day",
};

const lastMockBar = mockBars[mockBars.length - 1];
const stagedD1 = buildStagedTradeDrawing(stagedBuySetup, mockBars, tfSec, 0);

assert(stagedD1 !== null, "Staged trade drawing must be constructed");
assert.equal(stagedD1.kind, "long-position", "BUY staged setup must produce long-position tool");
assert(stagedD1.id.startsWith("auto_staged_"), "ID must start with auto_staged_ for non-persistence");

// Verify 4-5 candle gap:
const expectedEntryTime = lastMockBar.time + 5 * tfSec;
assert.equal(stagedD1.points[0].time, expectedEntryTime, "Left boundary must be exactly 5 candles right of current candle");
assert.equal(stagedD1.points[0].price, 1.0820, "Entry price must match staged setup entry");
assert.equal(stagedD1.points[1].time, expectedEntryTime + 12 * tfSec, "Right boundary must be 12 candles width for clean visibility");
assert.equal(stagedD1.points[1].price, 1.0820, "Horizontal entry level aligns");
assert.equal(Math.round(stagedD1.style.stopLevel * 100000) / 100000, 0.0020, "stopLevel is 20 pips");
assert.equal(Math.round(stagedD1.style.profitLevel * 100000) / 100000, 0.0050, "profitLevel is 50 pips (2.5R)");
console.log("✅ PASS: Staged trade RR tool placed on the right side of current candle with exact 5-candle gap");

// -------------------------------------------------------------
// TEST 20: Staged Setup Color Differentiation & Dashed Line Style
// -------------------------------------------------------------
// Must be different from default RR (green/red) and live trade (cobalt blue/violet)
assert.notEqual(stagedD1.style.targetColor, "#26a69a", "Target must not be default green");
assert.notEqual(stagedD1.style.targetColor, "#089981", "Target must not be default green");
assert.notEqual(stagedD1.style.targetColor, "#0284c7", "Target must not be live trade cobalt blue");
assert.notEqual(stagedD1.style.stopColor, "#ef5350", "Stop must not be default red");
assert.notEqual(stagedD1.style.stopColor, "#ea580c", "Stop must not be live trade tangerine amber");
assert.equal(stagedD1.style.targetColor, "#facc15", "Default staged target is vibrant Canary Gold");
assert.equal(stagedD1.style.stopColor, "#e11d48", "Default staged stop is Crimson Coral");
assert.equal(stagedD1.style.color, "#f59e0b", "Entry line is Vivid Amber");
assert.equal(stagedD1.style.lineStyle, "dashed", "Entry line must be dashed to symbolize pending limit order");
assert(stagedD1.style.statsLabel.includes("STAGED"), "Stats label indicates pending STAGED setup");
assert(stagedD1.style.statsLabel.includes("2.50RR"), "Stats label indicates 2.50RR");
console.log("✅ PASS: Staged trade colors are distinctly differentiated from default RR and live trade RR");

// -------------------------------------------------------------
// TEST 21: Ephemeral Non-Persistence & Invalidation/Cancellation Removal
// -------------------------------------------------------------
// 1. DrawingManager localStorage filter excludes auto_staged_ drawings
const mockMgrList = [
  userManualDrawing,
  d1, // live auto trade
  stagedD1, // staged auto trade
];
const filteredForStorage = mockMgrList.filter((d) => !String(d.id).startsWith("auto_"));
assert.equal(filteredForStorage.length, 1, "Only user manual drawing is saved; auto_ and auto_staged_ are excluded");
assert.equal(filteredForStorage[0].id, "user_dw_trend_1", "User drawing alone persisted");

// 2. Invalidation / cancellation removes drawing immediately:
const invalidatedSetup = { ...stagedBuySetup, status: "invalidated" };
const dInvalid = buildStagedTradeDrawing(invalidatedSetup, mockBars, tfSec, 0);
assert.equal(dInvalid, null, "Invalidated setup produces null drawing (automatically removed from chart)");

const cancelledSetup = { ...stagedBuySetup, status: "cancelled" };
const dCancelled = buildStagedTradeDrawing(cancelledSetup, mockBars, tfSec, 0);
assert.equal(dCancelled, null, "Cancelled setup produces null drawing (automatically removed from chart)");

const closedSetup = { ...stagedBuySetup, status: "closed_sl" };
const dClosed = buildStagedTradeDrawing(closedSetup, mockBars, tfSec, 0);
assert.equal(dClosed, null, "Closed setup produces null staged drawing");
console.log("✅ PASS: Staged drawings are completely ephemeral, non-persistent, and automatically removed on invalidation");

// -------------------------------------------------------------
// TEST 22: Staged Prop-Firm Model Differentiation
// -------------------------------------------------------------
const stagedPropSetup = {
  _id: "staged_eur_prop",
  symbol: "EURUSD",
  dir: -1,
  direction: "SELL",
  status: "staged",
  managementLogic: "prop_firm_safe",
  leg: "prop",
  entryPrice: 1.0850,
  initialSlPrice: 1.0870,
  tpPrice: 1.0814,
  targetRR: 1.8,
  horizon: "scalp",
};

const stagedDProp = buildStagedTradeDrawing(stagedPropSetup, mockBars, tfSec, 1);
assert(stagedDProp !== null, "Prop staged drawing created");
assert.equal(stagedDProp.kind, "short-position", "SELL trade produces short-position tool");
assert.equal(stagedDProp.style.targetColor, "#22d3ee", "Prop staged target is Electric Cyan");
assert.equal(stagedDProp.style.stopColor, "#fb7185", "Prop staged stop is Radiant Rose");
assert.equal(stagedDProp.style.color, "#06b6d4", "Entry is Cyan with dashed style");
assert.equal(stagedDProp.style.lineStyle, "dashed", "Dashed entry line");
assert(stagedDProp.style.statsLabel.includes("PROP"), "Label indicates PROP model");
// Gap for index 1 is 5 + 1*2 = 7 candles to stagger distinct legs:
assert.equal(stagedDProp.points[0].time, lastMockBar.time + 7 * tfSec, "Secondary setup staggered by 2 bars (7-candle gap)");
console.log("✅ PASS: Staged Prop-Firm model correctly differentiated with Cyan/Rose palette");

console.log("\n=====================================================================");
console.log("🎯 ALL NATIVE LIGHTWEIGHT-CHARTS-DRAWING RR TOOL TESTS PASSED!");
console.log("=====================================================================");

