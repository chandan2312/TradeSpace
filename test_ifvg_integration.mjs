import { analyze4HFVGs } from "./lib/bias/htfFvg.js";
import { evaluateMarketBrain } from "./lib/bias/brain.js";
import { detectPDArrays } from "./lib/bias/institutional.js";
import { extractHtfAnchorLevels } from "./lib/autonomous/entryDecisionEngine.js";
import { getStructuralCandidatesForTf } from "./lib/autonomous/tpCascadingEngine.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${message}`);
}

console.log("=======================================================");
console.log("TEST SUITE: Complete iFVG Lifecycle & Multi-Engine Integration");
console.log("=======================================================");

// -------------------------------------------------------------
// Test 1: 4H FVG Inversion to iFVG, Retest, Respect & Invalidation
// -------------------------------------------------------------
console.log("\n--- 1. Testing 4H iFVG Inversion, Retest & Defense Lifecycle ---");

// Build synthetic bars:
// Bar 0, 1, 2: Bullish FVG [100, 110] born at bar 2
// Bar 3: Closes below 100 (at 95) -> Inversion to Inverted Resistance (dir: -1)!
// Bar 4: Pulls back up to test inverted zone (high: 105, close: 98 <= 100) -> Tested!
// Bar 5: Decisive downward expansion (high: 96, close: 85 < 100) -> Respected Inverted Resistance!
const barsInversionRespect = [
  { time: 1000, open: 90, high: 100, low: 88, close: 98 },      // Bar 0: candle 1 high = 100
  { time: 2000, open: 98, high: 115, low: 97, close: 114 },     // Bar 1: displacement
  { time: 3000, open: 114, high: 120, low: 110, close: 118 },   // Bar 2: candle 3 low = 110 -> FVG: [100, 110]
  { time: 4000, open: 118, high: 118, low: 90, close: 95 },      // Bar 3: Closes below 100 -> VIOLATED & INVERTED!
  { time: 5000, open: 95, high: 105, low: 94, close: 98 },       // Bar 4: Retest [100, 110] CE=105, close 98 <= 100
  { time: 6000, open: 98, high: 99, low: 80, close: 85 },        // Bar 5: Decisive downward expansion away from 100
];

const res1 = analyze4HFVGs(barsInversionRespect, 10);
assert(res1.unrespected.length === 1, "Natural Bullish FVG flagged as UNRESPECTED");
assert(res1.ifvgs.length === 1, "Inverted into exactly 1 iFVG");
const ifvg1 = res1.ifvgs[0];
assert(ifvg1.role === "INVERTED_RESISTANCE", `iFVG role is INVERTED_RESISTANCE (got ${ifvg1.role})`);
assert(ifvg1.dir === -1, `iFVG operative direction is -1 (got ${ifvg1.dir})`);
assert(ifvg1.tested === true, "iFVG tracked as tested");
assert(ifvg1.respected === true, "iFVG tracked as respected");
assert(ifvg1.state === "RESPECTED_INVERTED", `iFVG state is RESPECTED_INVERTED (got ${ifvg1.state})`);
assert(ifvg1.respectQuality === "A_PRIME_CE_DEFENDED", `iFVG respect quality defended CE (got ${ifvg1.respectQuality})`);
assert(res1.respectedIfvgs.length === 1, "res1.respectedIfvgs includes this defended iFVG");
assert(res1.bearishIfvgRespectedCount === 1, "bearishIfvgRespectedCount incremented to 1");
assert(res1.nearestIfvgResistance !== null, "nearestIfvgResistance populated above current price");

// -------------------------------------------------------------
// Test 2: Invalidation (Reclaim) of an iFVG
// -------------------------------------------------------------
console.log("\n--- 2. Testing iFVG Reclaim / Invalidation ---");
// Add Bar 6 closing back above the top (115 > 110)
const barsReclaimed = [
  ...barsInversionRespect,
  { time: 7000, open: 85, high: 120, low: 84, close: 115 }, // Closes above top 110 -> Reclaimed!
];
const res2 = analyze4HFVGs(barsReclaimed, 10);
assert(res2.ifvgs.length >= 1, "iFVGs exist");
const reclaimedIfvg = res2.ifvgs.find((g) => g.id === "4H-iFVG-3000");
assert(reclaimedIfvg && reclaimedIfvg.reclaimed === true, "iFVG marked as reclaimed");
assert(reclaimedIfvg && reclaimedIfvg.state === "RECLAIMED", `iFVG state is RECLAIMED (got ${reclaimedIfvg?.state})`);
assert(!res2.unreclaimedIfvgs.some((g) => g.id === "4H-iFVG-3000"), "Reclaimed iFVG does not appear in unreclaimedIfvgs");

// -------------------------------------------------------------
// Test 3: Active iFVG Test Detection
// -------------------------------------------------------------
console.log("\n--- 3. Testing Active iFVG Test Detection ---");
// Last bar sits actively inside [100, 110]
const barsActiveTest = [
  barsInversionRespect[0],
  barsInversionRespect[1],
  barsInversionRespect[2],
  barsInversionRespect[3],
  { time: 5000, open: 95, high: 106, low: 94, close: 104 }, // current price 104 is actively inside [100, 110]
];
const res3 = analyze4HFVGs(barsActiveTest, 10);
assert(res3.ifvgs[0].isCurrentlyInside === true, "iFVG isCurrentlyInside is true");
assert(res3.activeIfvgs.length === 1, "activeIfvgs populated");
assert(res3.activeIfvg !== null, "activeIfvg points to the live tested iFVG");

// -------------------------------------------------------------
// Test 4: Market Brain Integration with iFVG
// -------------------------------------------------------------
console.log("\n--- 4. Testing Market Brain iFVG Thesis & Catalysts ---");
const brainRes = evaluateMarketBrain({
  symbol: "NAS100",
  ranges: {
    ranges: {
      H4: { currentPrice: 115, high: 150, low: 70, eq: 110, zone: "PREMIUM", coveragePct: 60 },
      M15: { currentPrice: 115, high: 125, low: 110, eq: 117.5, zone: "DISCOUNT", coveragePct: 40 },
    },
  },
  htfFvg: res1, // Respected Bearish iFVG
  htfLiq: { drawOnLiquidity: { side: -1, price: 65, type: "SSL" } },
  structures: { H4: { dir: -1 }, M15: { dir: -1 } },
  intraday: { setup: { dir: -1 } },
  score: -28,
});

assert(brainRes.catalysts.some((c) => c.includes("Inverted Resistance (iFVG) tested and respected")), 
  "Brain catalysts include iFVG defense confirmation");
assert(brainRes.macroCompass === "BEARISH", `Macro compass resolves to BEARISH via iFVG order flow (got ${brainRes.macroCompass})`);
assert(brainRes.verdict === "STRONG_BEARISH_EXPANSION", `Verdict resolves to STRONG_BEARISH_EXPANSION (got ${brainRes.verdict})`);
assert(brainRes.action === "READY_FOR_SHORT", `Action is READY_FOR_SHORT (got ${brainRes.action})`);
assert(brainRes.htfFvg.respectedIfvgs.length === 1, "Brain output telemetry preserves respectedIfvgs");

// -------------------------------------------------------------
// Test 5: PD Arrays & Structural Anchors Integration
// -------------------------------------------------------------
console.log("\n--- 5. Testing PD Arrays & Structural Anchors Integration ---");
const pdRes = detectPDArrays(barsInversionRespect, { tf: "H4" });
assert(Array.isArray(pdRes.ifvgs), "detectPDArrays returns ifvgs array");
assert(pdRes.ifvgs.length >= 1, `detectPDArrays populated ifvgs (count: ${pdRes.ifvgs.length})`);
assert(pdRes.ifvgs[0].state === "RESPECTED_INVERTED" || pdRes.ifvgs[0].state === "INVERTED", 
  `PD Array iFVG state tracked properly (got ${pdRes.ifvgs[0].state})`);

// Test structural anchors in entryDecisionEngine
const anchors = extractHtfAnchorLevels({
  frames: { H4: barsInversionRespect },
  ranges: { H4: { high: 150, low: 70, eq: 110 } },
  brain: brainRes,
  dir: -1, // looking for short anchors
});
const ifvgAnchor = anchors.find((a) => a.type === "HTF_IFVG");
assert(ifvgAnchor !== undefined, "extractHtfAnchorLevels discovered HTF_IFVG anchor");
assert(ifvgAnchor?.name?.includes("Inverse Fair Value Gap"), `Anchor name mentions iFVG (got ${ifvgAnchor?.name})`);

// -------------------------------------------------------------
// Test 6: Take Profit Cascading Engine Opposing iFVG Integration
// -------------------------------------------------------------
console.log("\n--- 6. Testing TP Cascading Engine Opposing iFVG Target ---");
const tpCandidates = getStructuralCandidatesForTf({
  tf: "H4",
  entry: 70,
  sl: 65,
  dir: 1, // Long trade aiming up into opposing Bearish iFVG [100, 110]
  frames: { H4: barsInversionRespect },
  ranges: {},
  brain: {},
  htfFvg: res1,
  htfLiq: {},
  evidence: {},
  targets: [],
  targetDOL: null,
  dealingRange: null,
  digits: 2,
});

const ifvgTpTarget = tpCandidates.find((c) => c.name.includes("iFVG"));
assert(ifvgTpTarget !== undefined, "TP Cascading engine successfully registered opposing iFVG target");
assert(ifvgTpTarget.price === 105 || ifvgTpTarget.price === 100, `TP target price aligns with iFVG boundary/CE (got ${ifvgTpTarget.price})`);

console.log("\n=======================================================");
console.log("🎯 ALL 6 iFVG INTEGRATION TESTS PASSED WITH 100% SUCCESS!");
console.log("=======================================================");
