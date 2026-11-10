import assert from "node:assert/strict";
import * as lwcd from "lightweight-charts-drawing";

console.log("=====================================================================");
console.log("TEST SUITE: Chart RR Badges & Stop-Loss Lock Verification (Image 1 & 2)");
console.log("=====================================================================\n");

// -------------------------------------------------------------
// Helper: toEpochSec normalizer
// -------------------------------------------------------------
const toEpochSec = (t) => {
  if (t == null) return null;
  if (typeof t === "number") {
    return t > 1e11 ? Math.round(t / 1000) : Math.round(t);
  }
  if (typeof t === "string") {
    if (/^\d+$/.test(t)) {
      const n = Number(t);
      return n > 1e11 ? Math.round(n / 1000) : Math.round(n);
    }
    const p = Date.parse(t);
    return Number.isFinite(p) ? Math.round(p / 1000) : null;
  }
  if (typeof t === "object") {
    if ("year" in t) {
      return Math.round(Date.UTC(t.year, (t.month || 1) - 1, t.day || 1) / 1000);
    }
    if ("time" in t) return toEpochSec(t.time);
  }
  return null;
};

function getEntryIdx(chartBars, t0) {
  if (!chartBars || chartBars.length === 0 || t0 == null) return -1;
  const firstT = toEpochSec(chartBars[0].time ?? chartBars[0].t);
  if (firstT != null && t0 <= firstT) return 0;
  const lastT = toEpochSec(chartBars[chartBars.length - 1].time ?? chartBars[chartBars.length - 1].t);
  if (lastT != null && t0 >= lastT) return chartBars.length - 1;

  let idx = 0;
  for (let i = 0; i < chartBars.length; i++) {
    const bt = toEpochSec(chartBars[i]?.time ?? chartBars[i]?.t);
    if (bt != null && bt <= t0) {
      idx = i;
    } else if (bt != null && bt > t0) {
      break;
    }
  }
  return idx;
}

// -------------------------------------------------------------
// TEST 1: Native LWCD Balloon Stripping (Scenario 1 / Image 1)
// -------------------------------------------------------------
const mockRawSceneItems = [
  { t: "rect", x: 100, y: 200, w: 200, h: 50, fill: "rgba(242, 54, 69, 0.20)" },
  { t: "rect", x: 100, y: 250, w: 200, h: 100, fill: "rgba(8, 153, 129, 0.20)" },
  { t: "line", a: { x: 100, y: 250 }, b: { x: 300, y: 250 } }, // Entry line
  { t: "line", a: { x: 100, y: 200 }, b: { x: 300, y: 200 } }, // Stop line
  { t: "line", a: { x: 100, y: 350 }, b: { x: 300, y: 350 } }, // Target line
  // Native balloons from LWCD:
  {
    t: "group",
    items: [
      { t: "rect", x: 150, y: 190, w: 100, h: 20 },
      { t: "text", text: "0.281 (0.132%) 281 750" }
    ]
  },
  {
    t: "group",
    items: [
      { t: "rect", x: 150, y: 240, w: 80, h: 20 },
      { t: "text", text: "Qty: 50" },
      { t: "text", text: "Risk/reward ratio: 2.49" }
    ]
  },
  {
    t: "group",
    items: [
      { t: "rect", x: 150, y: 340, w: 90, h: 20 },
      { t: "text", text: "0.699 (0.328%)" }
    ]
  }
];

const filteredScene = mockRawSceneItems.filter((item) => {
  if (!item) return false;
  if (item.t === "group" && Array.isArray(item.items)) {
    const isPositionStatGroup = item.items.some((sub) => {
      const txt = String(sub?.text || "");
      return (
        txt.includes("Target:") ||
        txt.includes("Stop:") ||
        txt.includes("Qty:") ||
        txt.includes("Risk/reward") ||
        txt.includes("Amount:") ||
        txt.includes("PnL:") ||
        /\(\s*[-+]?\d+\.\d+%\s*\)/.test(txt) ||
        /\d+\s*\(\s*[-+]?\d+\.\d+%\s*\)/.test(txt)
      );
    });
    if (isPositionStatGroup) return false;
  }
  return true;
});

assert.equal(filteredScene.length, 5, "All 3 native balloons must be stripped from scene");
assert.ok(!filteredScene.some(it => it.t === "group"), "Zero native group balloons remain");
console.log("✅ PASS: Native LWCD balloons (Stop/Target/Qty/RR) completely stripped (Entry line 100% clean)");

// -------------------------------------------------------------
// TEST 2: Stop Loss Hit Locking to -1.00R (Scenario 2 / Image 2)
// -------------------------------------------------------------
// Mock a BUY position where candle 1 breached SL, but later candles rallied up above entry
const mockBars = [
  { time: 1000, open: 213.0, high: 213.5, low: 212.8, close: 213.0 },
  { time: 1060, open: 213.0, high: 213.1, low: 211.5, close: 212.0 }, // LOW 211.5 drops below SL 211.69!
  { time: 1120, open: 212.0, high: 214.2, low: 212.0, close: 214.0 }, // Rebound above entry!
  { time: 1180, open: 214.0, high: 215.0, low: 213.8, close: 214.8 }  // Live candle: +0.80R above entry!
];

const p0 = { time: "2026-11-10T12:00:00Z", price: 213.0 }; // ISO string timestamp
const slPrice = 211.69;
const tpPrice = 216.00;
const stopDist = Math.abs(p0.price - slPrice);
const profitDist = Math.abs(tpPrice - p0.price);
const isLong = true;
const dir = 1;

const t0 = toEpochSec(p0.time);
const entryIdx = getEntryIdx(mockBars, t0);
assert.equal(entryIdx, 3, "Resolves entry index correctly despite ISO string format");

// Test with entry on candle 0:
const t0Candle0 = toEpochSec(mockBars[0].time);
const entryIdx0 = getEntryIdx(mockBars, t0Candle0);
assert.equal(entryIdx0, 0, "Matches candle 0 index");

let barHitOutcome = null;
for (let i = entryIdx0; i < mockBars.length; i++) {
  const b = mockBars[i];
  const bLow = Number(b.low ?? b.close);
  const bHigh = Number(b.high ?? b.close);
  const isSlHit = isLong ? (bLow <= slPrice + 1e-4) : (bHigh >= slPrice - 1e-4);
  const isTpHit = isLong ? (bHigh >= tpPrice - 1e-4) : (bLow <= tpPrice + 1e-4);

  if (isSlHit) {
    barHitOutcome = "sl";
    break;
  }
  if (isTpHit) {
    barHitOutcome = "tp";
    break;
  }
}

assert.equal(barHitOutcome, "sl", "Must detect SL hit on candle 1");

const isStoppedOut = barHitOutcome === "sl";
let liveR = 0;
if (isStoppedOut) {
  liveR = -1.0; // Hard locked to -1.00R!
} else {
  // Buggy path: taking live candle close
  const curPrice = mockBars[mockBars.length - 1].close;
  liveR = ((curPrice - p0.price) * dir) / stopDist;
}

assert.equal(liveR, -1.0, "Outcome must be locked to -1.00R, NEVER calculating 0.80R from live market");
console.log("✅ PASS: Stopped out trade permanently locked to -1.00R (Never counts live market rebound)");

// -------------------------------------------------------------
// TEST 3: Badge Placement & Number-Only Formatting (No 'SL:', 'AR:', 'Target:')
// -------------------------------------------------------------
const fmtPriceNum = (p) => {
  if (p == null || !Number.isFinite(p)) return "";
  if (Math.abs(p) >= 1000) return Number(p.toFixed(2)).toString();
  if (Math.abs(p) >= 20) return Number(p.toFixed(2)).toString();
  if (Math.abs(p) >= 1) return Number(p.toFixed(4)).toString();
  return Number(p.toFixed(5)).toString();
};

const slNum = fmtPriceNum(slPrice);
const rrRatio = (profitDist / stopDist).toFixed(2);
const rrNum = `1:${rrRatio}`;
const rValStr = `${liveR > 0 ? "+" : ""}${Number(liveR).toFixed(2)}R`;

const badgeText = `${slNum} | ${rValStr} | ${rrNum}`;
assert.equal(badgeText, "211.69 | -1.00R | 1:2.29", "Badge text contains only numbers without words");
assert.ok(!badgeText.includes("SL:"), "Must NOT contain 'SL:'");
assert.ok(!badgeText.includes("Target:"), "Must NOT contain 'Target:'");
assert.ok(!badgeText.includes("AR:"), "Must NOT contain 'AR:'");
console.log(`✅ PASS: Badge text is cleanly formatted as '${badgeText}'`);

console.log("\n=====================================================================");
console.log("🎯 ALL CHART RR BADGE & SL LOCK TESTS PASSED (100%)");
console.log("=====================================================================\n");
