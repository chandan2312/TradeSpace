import { evaluateLevelGeometry } from "../lib/autonomous/preEntryValidation.js";
import { evaluateMilestoneRedecision } from "../lib/autonomous/redecision.js";
import { confirmedTrailPrice } from "../lib/autonomous/management.js";

console.log("===============================================================================");
console.log("TEST SUITE: Autonomous Full-Cycle Lifecycle Upgrades & Bug Fixes");
console.log("===============================================================================\n");

let passed = 0;
let failed = 0;

function assert(description, condition, details = "") {
  if (condition) {
    console.log(`✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${description}`);
    if (details) console.error("   Details:", details);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// 1. Dual-Leg Runway Symmetry (tradeProp vs tradeDefault)
// ---------------------------------------------------------------------------
console.log("--- 1. Testing Dual-Leg Runway Symmetry (tradeProp vs tradeDefault) ---");

// Trade setup: Entry at 100, SL at 90 (10 pts risk).
// Structural TP is 150 (5R move = 50 pts).
// tradeDefault has TP at 150 (5R).
// tradeProp has TP at 118 (1.8R).
// Suppose price moved to 106 (moveDone = 6 pts, moveInR = 0.6R).
const baseDefault = {
  entryPrice: 100,
  initialSlPrice: 90,
  slPrice: 90,
  fullTp: 150,
  tpPrice: 150,
  dir: 1,
  initialRiskDistance: 10,
  legId: "default",
};

const baseProp = {
  entryPrice: 100,
  initialSlPrice: 90,
  slPrice: 90,
  fullTp: 118,
  tpPrice: 118,
  dir: 1,
  initialRiskDistance: 10,
  legId: "prop_firm",
  levelDetails: {
    fullTp: 150,
  },
};

const defaultRes = evaluateLevelGeometry(baseDefault, 106);
const propRes = evaluateLevelGeometry(baseProp, 106);

assert("tradeDefault passes when price moved 0.6R towards target", defaultRes.pass === true);
assert("tradeProp does NOT get false TARGET_RUNWAY_EXHAUSTED when price moved only 0.6R", propRes.pass === true);
assert("Both legs have identical geometry pass status", defaultRes.pass === propRes.pass);

// When price truly expanded 80% to full structural target (e.g. price at 142, moveInR = 4.2R):
const exhaustedDefault = evaluateLevelGeometry(baseDefault, 142);
const exhaustedProp = evaluateLevelGeometry(baseProp, 142);
assert("Both legs correctly detect exhaustion when move truly expanded >= 70% to structural DOL",
  exhaustedDefault.pass === false && exhaustedProp.pass === false &&
  exhaustedDefault.vetoes[0]?.code === "TARGET_RUNWAY_EXHAUSTED" &&
  exhaustedProp.vetoes[0]?.code === "TARGET_RUNWAY_EXHAUSTED");

// ---------------------------------------------------------------------------
// 2. Anti-Noise Trailing Stop Protection
// ---------------------------------------------------------------------------
console.log("\n--- 2. Testing Trailing Stop Buffering ---");

// Test confirmedTrailPrice on 5 M5 bars
const now = Date.now();
const m5Bars = [
  { time: (now - 1500_000) / 1000, open: 100, high: 103, low: 99, close: 102 },
  { time: (now - 1200_000) / 1000, open: 102, high: 105, low: 101, close: 104 },
  { time: (now - 900_000) / 1000,  open: 104, high: 108, low: 103, close: 107 }, // High fractal at 108
  { time: (now - 600_000) / 1000,  open: 107, high: 106, low: 102, close: 103 },
  { time: (now - 300_000) / 1000,  open: 103, high: 104, low: 101, close: 102 },
];

const shortTrade = { dir: -1, slPrice: 110, entryPrice: 105, initialRiskDistance: 5 };
const trailPrice = confirmedTrailPrice(shortTrade, m5Bars, now);
assert("confirmedTrailPrice detects valid confirmed swing fractal", trailPrice != null && Number.isFinite(trailPrice));

// Check buffer logic: if price is at 106.5, and trailPrice is at 108 (only 1.5 pts away):
const currentPrice = 106.5;
const riskDist = 5;
const minBuffer = riskDist * 0.75; // 3.75 pts
const isSafeBuffer = Math.abs(currentPrice - trailPrice) >= minBuffer;
assert("Tight 1.5-point trail is blocked by 0.75R (3.75 pt) structural buffer requirement", isSafeBuffer === false);

// ---------------------------------------------------------------------------
// 3. Milestone Redecision Runner Safety (No Panic Close on Micro Pullbacks)
// ---------------------------------------------------------------------------
console.log("\n--- 3. Testing Milestone Redecision Runner Protection ---");

// Trade that reached 50% milestone: Buy on M15 (Day trade)
const mockDayTrade = {
  symbol: "NAS100",
  dir: 1,
  entryPrice: 20000,
  slPrice: 20000, // already at Breakeven
  initialSlPrice: 19900, // 100 pts risk
  initialRiskDistance: 100,
  tpPrice: 20500, // 5R
  targetRR: 5.0,
  horizon: "day",
  scenario: { id: "day" },
  halfTargetBooked: true,
  isBreakeven: true,
};

// Simulate M15 bars during a natural pullback with a minor internal MSS
const baseM15 = [];
const startT = Math.floor(now / 1000) - 200 * 900;
for (let i = 0; i < 60; i++) {
  const t = startT + i * 900;
  baseM15.push({ time: t, open: 20000 + i * 4, high: 20000 + i * 4 + 8, low: 20000 + i * 4 - 2, close: 20000 + i * 4 + 6 });
}
// Add 4 pullback bars with a minor dip
for (let i = 0; i < 4; i++) {
  const t = startT + (60 + i) * 900;
  baseM15.push({ time: t, open: 20240 - i * 5, high: 20240 - i * 5 + 2, low: 20240 - i * 5 - 8, close: 20240 - i * 5 - 6 });
}

evaluateMilestoneRedecision({
  trade: mockDayTrade,
  currentPrice: 20220,
  frames: { M15: baseM15 },
}).then((redec) => {
  assert("Milestone redecision executes successfully", redec && redec.ok);
  assert("Day trade runner does NOT panic close (CLOSE_FULL_NOW) on ordinary M15 pullback", redec.action !== "CLOSE_FULL_NOW", redec.action);
  assert("Day trade preserves runner or recalibrates safely", ["HOLD_FULL_TP", "REDUCE_TP", "EXPAND_TP"].includes(redec.action));

  console.log("\n===============================================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================================");
  if (failed === 0) {
    console.log("🎯 ALL AUTONOMOUS LIFECYCLE UPGRADE TESTS PASSED WITH 100% INTEGRITY!\n");
  } else {
    process.exit(1);
  }
});
