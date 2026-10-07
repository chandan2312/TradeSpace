import assert from "node:assert";
import {
  HORIZON_SL_PROFILES,
  resolveHorizonProfile,
  calculateAssetNoiseFloor,
  calculateSpreadNoiseBuffer,
  resolveModelInvalidationAnchor,
  calculateStructuralStopLoss,
  auditStopLossIntegrity,
} from "./lib/autonomous/slEngine.js";

console.log("=======================================================");
console.log("TEST SUITE: Autonomous Stop-Loss Engine (ASLE)");
console.log("=======================================================\n");

let passed = 0;
function pass(msg) {
  passed++;
  console.log(`✅ PASS: ${msg}`);
}

// -------------------------------------------------------------
// 1. Horizon Profiles & Noise Floor Verification
// -------------------------------------------------------------
console.log("--- 1. Testing Horizon Profiles & Noise Floors ---");

const swingProfile = resolveHorizonProfile({ id: "swing" });
assert.strictEqual(swingProfile.id, "swing");
assert.strictEqual(swingProfile.macroTf, "D1");
assert.strictEqual(swingProfile.sessionTf, "H4");
assert.strictEqual(swingProfile.bufferAtrMult, 1.25);
pass("Swing profile correctly maps to D1/H4 with 1.25x ATR multiplier");

const dayProfile = resolveHorizonProfile({ id: "day" });
assert.strictEqual(dayProfile.id, "day");
assert.strictEqual(dayProfile.macroTf, "H4");
assert.strictEqual(dayProfile.sessionTf, "H1");
assert.strictEqual(dayProfile.bufferAtrMult, 0.75);
pass("Day profile correctly maps to H4/H1 with 0.75x ATR multiplier");

const scalpProfile = resolveHorizonProfile({ id: "scalp" });
assert.strictEqual(scalpProfile.id, "scalp");
assert.strictEqual(scalpProfile.macroTf, "M30");
assert.strictEqual(scalpProfile.sessionTf, "15M");
assert.strictEqual(scalpProfile.triggerTf, "M5");
assert.strictEqual(scalpProfile.bufferAtrMult, 0.45);
pass("Scalp profile correctly maps to M30/15M/M5 with 0.45x ATR multiplier");

// Noise floors across asset categories
const nasFloorSwing = calculateAssetNoiseFloor("NAS100", "index", swingProfile, { point: 1 });
const nasFloorDay = calculateAssetNoiseFloor("NAS100", "index", dayProfile, { point: 1 });
const nasFloorScalp = calculateAssetNoiseFloor("NAS100", "index", scalpProfile, { point: 1 });
assert.strictEqual(nasFloorSwing, 80);
assert.strictEqual(nasFloorDay, 25);
assert.strictEqual(nasFloorScalp, 10);
pass("Index noise floors calibrated: Swing 80 pts, Day 25 pts, Scalp 10 pts");

const goldFloorSwing = calculateAssetNoiseFloor("XAUUSD", "metal", swingProfile, { point: 1 });
const goldFloorDay = calculateAssetNoiseFloor("XAUUSD", "metal", dayProfile, { point: 1 });
const goldFloorScalp = calculateAssetNoiseFloor("XAUUSD", "metal", scalpProfile, { point: 1 });
assert.strictEqual(goldFloorSwing, 12);
assert.strictEqual(goldFloorDay, 4.5);
assert.strictEqual(goldFloorScalp, 1.5);
pass("Metal noise floors calibrated: Swing $12.00, Day $4.50, Scalp $1.50");

const eurusdUnits = { pip: 0.0001 };
const fxFloorSwing = calculateAssetNoiseFloor("EURUSD", "fx", swingProfile, eurusdUnits);
const fxFloorDay = calculateAssetNoiseFloor("EURUSD", "fx", dayProfile, eurusdUnits);
const fxFloorScalp = calculateAssetNoiseFloor("EURUSD", "fx", scalpProfile, eurusdUnits);
assert.strictEqual(Number(fxFloorSwing.toFixed(5)), 0.00350); // 35 pips
assert.strictEqual(Number(fxFloorDay.toFixed(5)), 0.00120);   // 12 pips
assert.strictEqual(Number(fxFloorScalp.toFixed(5)), 0.00040); // 4 pips
pass("FX noise floors calibrated: Swing 35 pips, Day 12 pips, Scalp 4 pips");

// -------------------------------------------------------------
// 2. Asymmetric Spread & Wick Noise Clearance
// -------------------------------------------------------------
console.log("\n--- 2. Testing Asymmetric Spread & Wick Noise Clearance ---");

const spread = 2.0; // 2 points spread on index
const avgBar = 10.0;
const units = { point: 1, digits: 2 };

const shortBuffer = calculateSpreadNoiseBuffer({
  dir: -1,
  spread,
  avgBarRange: avgBar,
  units,
  horizonProfile: dayProfile,
});
const longBuffer = calculateSpreadNoiseBuffer({
  dir: 1,
  spread,
  avgBarRange: avgBar,
  units,
  horizonProfile: dayProfile,
});

assert.strictEqual(shortBuffer.spreadComponent, 2.5); // 2.0 * 1.25
assert.strictEqual(longBuffer.spreadComponent, 1.0);  // 2.0 * 0.5
assert(shortBuffer.totalBuffer > longBuffer.totalBuffer, "Short SL buffer must exceed Long SL buffer for Ask-wick protection");
pass(`Short spread clearance (${shortBuffer.spreadComponent}) provides +1.25x Ask protection vs Long (${longBuffer.spreadComponent})`);

// -------------------------------------------------------------
// 3. Model-Specific Invalidation Geometry
// -------------------------------------------------------------
console.log("\n--- 3. Testing Model Invalidation Geometry ---");

// A. ICT 2022 Mentorship Model
const ictRes = resolveModelInvalidationAnchor({
  modelId: "ict_2022",
  dir: 1,
  entry: 20000,
  zoneLow: 19980,
  zoneHigh: 20020,
  evidence: { raid: { extreme: 19950 }, mss: { brokenPivot: { price: 20010 } } },
  horizonProfile: dayProfile,
});
assert.strictEqual(ictRes.anchorType, "ICT_2022_SWEEP_ORIGIN");
assert.strictEqual(ictRes.anchorPrice, 19950);
pass("ICT 2022 anchors to displacement origin of MSS sweep (19950)");

// B. Turtle Soup Liquidity Raid
const tsRes = resolveModelInvalidationAnchor({
  modelId: "turtle_soup",
  dir: -1,
  entry: 20050,
  zoneLow: 20040,
  zoneHigh: 20060,
  evidence: { raid: { extreme: 20120 } },
  horizonProfile: dayProfile,
});
assert.strictEqual(tsRes.anchorType, "TURTLE_SOUP_RAID_WICK");
assert.strictEqual(tsRes.anchorPrice, 20120);
pass("Turtle Soup anchors to extreme wick tip of liquidity raid (20120)");

// C. OTE Continuation (Swing vs Day Horizon)
const oteSwingRes = resolveModelInvalidationAnchor({
  modelId: "ote_continuation",
  dir: -1,
  entry: 20028,
  zoneLow: 19892,
  zoneHigh: 20164,
  dealingRange: { high: 20500, low: 18900 },
  horizonProfile: swingProfile,
});
assert.strictEqual(oteSwingRes.anchorType, "OTE_IMPULSE_ORIGIN_100");
assert.strictEqual(oteSwingRes.anchorPrice, 20500);
pass("OTE Swing anchors to 100% macro dealing range origin (20500)");

const oteDayRes = resolveModelInvalidationAnchor({
  modelId: "ote_continuation",
  dir: -1,
  entry: 20113.2,
  zoneLow: 20024.8,
  zoneHigh: 20201.6,
  dealingRange: { high: 20420, low: 19380 },
  horizonProfile: dayProfile,
});
assert.strictEqual(oteDayRes.anchorType, "OTE_ZONE_BOUNDARY_79");
assert.strictEqual(oteDayRes.anchorPrice, 20201.6);
pass("OTE Day anchors to outer 79% Fibonacci pocket boundary (20201.6)");

// D. Breaker Block Stop Run
const bbRes = resolveModelInvalidationAnchor({
  modelId: "breaker_block",
  dir: 1,
  entry: 19900,
  evidence: { raid: { extreme: 19820 } },
  horizonProfile: dayProfile,
});
assert.strictEqual(bbRes.anchorType, "BREAKER_STOP_RUN_EXTREME");
assert.strictEqual(bbRes.anchorPrice, 19820);
pass("Breaker Block anchors to pre-displacement stop-run extreme (19820)");

// E. Fair Value Gap CE
const fvgRes = resolveModelInvalidationAnchor({
  modelId: "fvg_ce",
  dir: -1,
  entry: 20000,
  zoneLow: 19980,
  zoneHigh: 20020,
  horizonProfile: scalpProfile,
});
assert.strictEqual(fvgRes.anchorType, "FVG_BOUNDARY_EXTREME");
assert.strictEqual(fvgRes.anchorPrice, 20020);
pass("FVG CE anchors to opposing boundary of Fair Value Gap (20020)");

// -------------------------------------------------------------
// 4. Primary calculateStructuralStopLoss Engine Execution
// -------------------------------------------------------------
console.log("\n--- 4. Testing calculateStructuralStopLoss Engine Execution ---");

const nasH4Bars = [
  { open: 20000, high: 20060, low: 19990, close: 20050 },
  { open: 20050, high: 20080, low: 20020, close: 20070 },
  { open: 20070, high: 20100, low: 20030, close: 20040 },
];

const slResult = calculateStructuralStopLoss({
  dir: -1,
  entry: 20028,
  modelId: "ote_continuation",
  zoneHigh: 20164,
  zoneLow: 19892,
  extreme: 20028,
  scenario: { id: "swing" },
  frames: { H4: nasH4Bars },
  ranges: { D1: { high: 20500, low: 18900 } },
  symbol: "NAS100",
  config: { spreadPrice: 2.0 },
});

assert(slResult, "SL result must be generated");
assert(slResult.sl > 20500, `Swing SL (${slResult.sl}) must clear macro range high (20500)`);
assert(slResult.isNoiseFree, "SL must satisfy asset noise floor");
assert(slResult.isBalanced, "SL risk-to-range ratio must remain structurally balanced");
assert.strictEqual(slResult.horizon, "swing");
pass(`calculateStructuralStopLoss computed valid Swing SL (${slResult.sl}) with full audit metadata`);

// -------------------------------------------------------------
// 5. Deep Structural Stop Loss Audit & Veto Gatekeeper
// -------------------------------------------------------------
console.log("\n--- 5. Testing auditStopLossIntegrity Gatekeeper ---");

// A. Inverted Stop Loss Veto
const invertedLong = auditStopLossIntegrity({
  dir: 1,
  entry: 20000,
  sl: 20010, // Invalid: above entry
  symbol: "NAS100",
});
assert(!invertedLong.pass, "Inverted long SL must fail audit");
assert(invertedLong.vetoes.some(v => v.code === "INVERTED_SL_LONG"), "Must trigger INVERTED_SL_LONG veto");
pass("Audit rejects inverted Long SL (SL >= Entry)");

// B. Noise Floor Violation Veto
const noisyScalp = auditStopLossIntegrity({
  dir: 1,
  entry: 20000,
  sl: 19996, // 4 pts risk on NAS100 (below min floor of 10 pts)
  symbol: "NAS100",
  scenario: { id: "scalp" },
});
assert(!noisyScalp.pass, "Sub-noise SL must fail audit");
assert(noisyScalp.vetoes.some(v => v.code === "SL_IN_NOISE_ZONE"), "Must trigger SL_IN_NOISE_ZONE veto");
pass("Audit rejects sub-noise SL placed inside market noise zone");

// C. Spread Eats SL Friction Gate
const frictionVeto = auditStopLossIntegrity({
  dir: 1,
  entry: 20000,
  sl: 19985, // 15 pts risk
  symbol: "NAS100",
  scenario: { id: "scalp" },
  spreadPrice: 5.0, // Spread is 33% of risk (> 25% max allowed)
});
assert(!frictionVeto.pass, "Excessive spread-to-risk must fail audit");
assert(frictionVeto.vetoes.some(v => v.code === "SPREAD_EATS_SL"), "Must trigger SPREAD_EATS_SL veto");
pass("Audit rejects high friction trade where spread exceeds 25% of SL");

// D. Pre-Entry Market Breach Check
const breachedShort = auditStopLossIntegrity({
  dir: -1,
  entry: 20000,
  sl: 20050,
  symbol: "NAS100",
  currentPrice: 20060, // Already traded through SL before entry limit filled
});
assert(!breachedShort.pass, "Pre-entry breached SL must fail audit");
assert(breachedShort.vetoes.some(v => v.code === "SL_ALREADY_BREACHED"), "Must trigger SL_ALREADY_BREACHED veto");
pass("Audit rejects trade where market has already breached Stop Loss");

console.log("\n=======================================================");
console.log(`TEST SUMMARY: ${passed} PASSED, 0 FAILED`);
console.log("=======================================================");
console.log("🎯 AUTONOMOUS STOP-LOSS ENGINE (ASLE) VALIDATED WITH 100% SUCCESS!\n");
