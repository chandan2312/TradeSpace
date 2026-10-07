// Comprehensive Test Suite for Master Market Bias Brain
// Validates:
//   1. Multi-timeframe Dealing Ranges (M15, H1, H4, D1, % coverage, exhaustion)
//   2. 4H FVG Lifecycle (Respected with CE defense vs Unrespected/Inverted)
//   3. HTF-Only Liquidity Intelligence (ERL/IRL cycles, HTF sweeps, EQH/EQL, DOL)
//   4. The Market Brain Dynamic Synthesis (Execution Readiness, narrative, blockage)
//   5. Full Engine Integration (computeSymbolBias output schema & execution interface)

import { computeDealingRange, analyzeAllDealingRanges } from "./lib/bias/ranges.js";
import { analyze4HFVGs } from "./lib/bias/htfFvg.js";
import { analyzeHTFLiquidity } from "./lib/bias/htfLiquidity.js";
import { evaluateMarketBrain } from "./lib/bias/brain.js";
import { computeSymbolBias } from "./lib/bias/engine.js";
import { smtDivergence } from "./lib/bias/context.js";
import { lensVote } from "./lib/bias/lenses.js";

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`✅ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${msg}`);
    failed++;
  }
}

console.log("\n=======================================================");
console.log("TEST SUITE 1: Multi-Timeframe Structural Dealing Ranges");
console.log("=======================================================");

// Build synthetic bars with known boundaries: Low = 100, High = 200
function createRangeBars(n, low, high, finalClose) {
  const bars = [];
  const t0 = 1700000000;
  for (let i = 0; i < n; i++) {
    const o = 150 + Math.sin(i * 0.5) * 10;
    const c = i === n - 1 ? finalClose : o + Math.cos(i * 0.5) * 5;
    const h = i === 10 ? high : Math.max(o, c) + 2;
    const l = i === 20 ? low : Math.min(o, c) - 2;
    bars.push({ time: t0 + i * 3600, open: o, high: h, low: l, close: c, v: 100 });
  }
  return bars;
}

// Test A: Deep Discount (110 on [100, 200] = 10% covered -> EXHAUSTED_LOW)
const barsLow = createRangeBars(60, 100, 200, 110);
const rLow = computeDealingRange(barsLow, "H4");
assert(rLow !== null, "H4 dealing range successfully calculated");
assert(rLow.high === 200, `Range High is 200 (got ${rLow.high})`);
assert(rLow.low === 100, `Range Low is 100 (got ${rLow.low})`);
assert(rLow.eq === 150, `Range EQ is 150 (got ${rLow.eq})`);
assert(rLow.coveragePct === 10, `Coverage is 10% (got ${rLow.coveragePct}%)`);
assert(rLow.zone === "DEEP_DISCOUNT", `Zone is DEEP_DISCOUNT (got ${rLow.zone})`);
assert(rLow.status === "EXHAUSTED_LOW", `Status is EXHAUSTED_LOW (got ${rLow.status})`);
assert(rLow.isExhausted === true, "Marked as exhausted");

// Test B: Deep Premium (192 on [100, 200] = 92% covered -> EXHAUSTED_HIGH)
const barsHigh = createRangeBars(60, 100, 200, 192);
const rHigh = computeDealingRange(barsHigh, "H4");
assert(rHigh.coveragePct === 92, `Coverage is 92% (got ${rHigh.coveragePct}%)`);
assert(rHigh.zone === "DEEP_PREMIUM", `Zone is DEEP_PREMIUM (got ${rHigh.zone})`);
assert(rHigh.status === "EXHAUSTED_HIGH", `Status is EXHAUSTED_HIGH (got ${rHigh.status})`);

// Test C: Uncovered Upside Runway (130 on [100, 200] = 30% covered -> UNCOVERED_UPSIDE)
const barsMid = createRangeBars(60, 100, 200, 130);
const rMid = computeDealingRange(barsMid, "H4");
assert(rMid.coveragePct === 30, `Coverage is 30% (got ${rMid.coveragePct}%)`);
assert(rMid.zone === "DISCOUNT", `Zone is DISCOUNT (got ${rMid.zone})`);
assert(rMid.status === "UNCOVERED_UPSIDE", `Status is UNCOVERED_UPSIDE (got ${rMid.status})`);
assert(rMid.remainingPctToHigh === 70, `70% uncovered upside remaining (got ${rMid.remainingPctToHigh}%)`);

// Test D: Multi-Timeframe Alignment Warnings
const framesMulti = {
  H4: barsHigh, // 92% covered (Deep Premium)
  M15: createRangeBars(60, 180, 200, 195), // 75% covered (Premium)
};
const allRanges = analyzeAllDealingRanges(framesMulti);
assert(allRanges.warnings.length > 0, "Warning generated for HTF Premium saturation");
assert(allRanges.warnings.some(w => w.type === "HTF_PREMIUM_EXHAUSTION"), "HTF_PREMIUM_EXHAUSTION correctly identified");

console.log("\n=======================================================");
console.log("TEST SUITE 2: 4H FVG Lifecycle (Respected vs Unrespected)");
console.log("=======================================================");

// Scenario:
// Candle 0: Range [90, 92]
// Candle 1: Strong bullish expansion [92, 105] (creates gap above 92)
// Candle 2: Opens 105, Low 98, High 108 -> Bullish FVG formed between [92, 98], CE = 95
// Candle 3: Tests gap: Low 94 (wicks below 98 into gap, bodies close at 99 > 98) -> RESPECTED (CE defended)
// Candle 4: Price pushes away: High 112, Close 110
const fvgBarsRespected = [
  { time: 1000, open: 90, high: 92, low: 89, close: 91 },
  { time: 2000, open: 91, high: 105, low: 91, close: 104 },
  { time: 3000, open: 104, high: 108, low: 98, close: 106 },
  { time: 4000, open: 106, high: 107, low: 94, close: 99 },  // Retrace into gap [92, 98], body respects top/CE
  { time: 5000, open: 99, high: 112, low: 99, close: 110 },   // Closes above top, confirming bounce
];
const htfFvgRes = analyze4HFVGs(fvgBarsRespected, 5);
assert(htfFvgRes.all.length === 1, "Detected 1 Bullish FVG");
assert(htfFvgRes.respected.length === 1, "4H Bullish FVG classified as RESPECTED");
assert(htfFvgRes.respected[0].respectQuality === "B_BOTTOM_DEFENDED" || htfFvgRes.respected[0].respectQuality === "A_PRIME_CE_DEFENDED", `Quality: ${htfFvgRes.respected[0].respectQuality}`);
assert(htfFvgRes.orderFlowState === "STRONG_BULLISH_ORDER_FLOW" || htfFvgRes.orderFlowState === "LEANING_BULLISH", `Order flow is bullish (${htfFvgRes.orderFlowState})`);

// Scenario: Unrespected (violated) Bullish FVG
// Candle 3: Closes at 88 (decisively below bottom 92) -> UNRESPECTED / Inverted
const fvgBarsViolated = [
  { time: 1000, open: 90, high: 92, low: 89, close: 91 },
  { time: 2000, open: 91, high: 105, low: 91, close: 104 },
  { time: 3000, open: 104, high: 108, low: 98, close: 106 },
  { time: 4000, open: 106, high: 106, low: 86, close: 88 },  // Closes below bottom 92!
  { time: 5000, open: 88, high: 89, low: 82, close: 84 },
];
const htfFvgViol = analyze4HFVGs(fvgBarsViolated, 5);
assert(htfFvgViol.unrespected.length === 1, "4H Bullish FVG classified as UNRESPECTED (violated)");
assert(htfFvgViol.orderFlowState === "STRONG_BEARISH_ORDER_FLOW" || htfFvgViol.orderFlowState === "LEANING_BEARISH", `Order flow flipped to bearish (${htfFvgViol.orderFlowState})`);

console.log("\n=======================================================");
console.log("TEST SUITE 3: HTF-Only Liquidity Intelligence (4H & D1)");
console.log("=======================================================");

const DAY = 86400;
const d1Bars = [
  { time: 10 * DAY, open: 100, high: 110, low: 98, close: 105 }, // Day -2: High 110 = PDH
  { time: 11 * DAY, open: 105, high: 112, low: 102, close: 108 }, // Day -1: High 112, Low 102
];

// 4H bars where candle wicks above PDH (110) to 111.5, but closes at 107 -> Swept BSL!
const h4SweepBars = [
  { time: 11 * DAY, open: 106, high: 108, low: 105, close: 107 },
  { time: 11 * DAY + 4 * 3600, open: 107, high: 111.5, low: 106.5, close: 107 }, // High > 110, Close < 110 (PDH swept!)
  { time: 11 * DAY + 8 * 3600, open: 107, high: 107.5, low: 103, close: 104 },
];
const htfLiq = analyzeHTFLiquidity({ H4: h4SweepBars, D1: d1Bars });
assert(htfLiq.keyLevels.PDH !== undefined, "PDH tracked on Daily");
assert(htfLiq.sweeps.some(s => s.name === "PDH" && s.reversalDir === -1), "PDH swept on 4H with bearish reversalDir (-1)");
assert(htfLiq.activeCycle === "ERL_TO_IRL", `Active cycle is ERL_TO_IRL (${htfLiq.activeCycle})`);
assert(htfLiq.drawOnLiquidity !== null, `Draw on Liquidity resolved to: ${htfLiq.drawOnLiquidity?.name}`);

console.log("\n=======================================================");
console.log("TEST SUITE 4: The Market Brain Dynamic Synthesis Engine");
console.log("=======================================================");

// Brain Test 1: Exhausted Bullish Chaser Trap
const brainExhausted = evaluateMarketBrain({
  symbol: "EURUSD",
  ranges: analyzeAllDealingRanges({
    H4: barsHigh, // 92% covered in Deep Premium
    M15: createRangeBars(60, 180, 200, 196), // 80% covered
  }),
  htfFvg: htfFvgRes,
  htfLiq,
  structures: { M15: { dir: 1, seq: "HH+HL" }, H4: { dir: 1, seq: "HH+HL" } },
  score: 65, // naive score would say BUY!
});

assert(brainExhausted.verdict === "EXHAUSTED_BULLISH", `Brain verdict is EXHAUSTED_BULLISH (got ${brainExhausted.verdict})`);
assert(brainExhausted.allowedToLong === false, "Brain strictly BLOCKS long entries due to range exhaustion");
assert(brainExhausted.action === "STAND_ASIDE", `Action is STAND_ASIDE (got ${brainExhausted.action})`);
assert(brainExhausted.warning !== null, "Range exhaustion warning emitted");

// Brain Test 2: Strong Bullish Expansion with Clean Uncovered Runway
const brainExpansion = evaluateMarketBrain({
  symbol: "EURUSD",
  ranges: analyzeAllDealingRanges({
    H4: createRangeBars(60, 100, 200, 135), // 35% in Discount
    M15: createRangeBars(60, 120, 150, 130), // 33% with open runway
  }),
  htfFvg: htfFvgRes, // Bullish FVG respected
  htfLiq: { activeCycle: "IRL_TO_ERL", drawOnLiquidity: { name: "4H EQH BSL", price: 195, targetSide: "BSL" }, sweeps: [] },
  structures: { M15: { dir: 1, seq: "HH+HL" }, H4: { dir: 1, seq: "HH+HL" } },
  score: 75,
});

assert(brainExpansion.verdict === "STRONG_BULLISH_EXPANSION", `Brain verdict is STRONG_BULLISH_EXPANSION (got ${brainExpansion.verdict})`);
assert(brainExpansion.allowedToLong === true, "Brain APPROVED long entry");
assert(brainExpansion.action === "READY_FOR_LONG", `Action is READY_FOR_LONG (got ${brainExpansion.action})`);
assert(brainExpansion.conviction >= 80, `High institutional conviction: ${brainExpansion.conviction}`);
assert(brainExpansion.targetDOL?.name === "4H EQH BSL", "Target DOL correctly set to 4H EQH BSL");
assert(brainExpansion.narrative.includes("uncovered upside"), "Narrative mentions uncovered upside");
assert(brainExpansion.dayTraderContext?.macroCompass === "BULLISH", "Macro Compass recognized as BULLISH");
assert(brainExpansion.dayTraderContext?.ltfGatekeeper?.vetoActive === false, "15M Gatekeeper approved entry");

// Brain Test 3: Day Trader 15M Overextension Veto (Price in Premium)
const brain15mOverextended = evaluateMarketBrain({
  symbol: "EURUSD",
  ranges: analyzeAllDealingRanges({
    H4: createRangeBars(60, 100, 200, 135), // 35% in Discount
    M15: createRangeBars(60, 100, 200, 178), // 78% in Premium (Overextended!)
  }),
  htfFvg: htfFvgRes,
  htfLiq: { activeCycle: "IRL_TO_ERL", drawOnLiquidity: { name: "4H EQH BSL", price: 195, targetSide: "BSL" }, sweeps: [] },
  structures: { M15: { dir: 1 }, H4: { dir: 1 } },
  score: 60,
});
assert(brain15mOverextended.allowedToLong === false, "15M Gatekeeper strictly VETOES long when 15M is overextended in Premium");
assert(brain15mOverextended.action === "WAIT_FOR_15M_PULLBACK", `Action is WAIT_FOR_15M_PULLBACK (got ${brain15mOverextended.action})`);
assert(brain15mOverextended.dayTraderContext?.ltfGatekeeper?.vetoActive === true, "15M Veto active flag set");
assert(brain15mOverextended.dayTraderContext?.ltfGatekeeper?.triggerStatus === "WAIT_PULLBACK", "15M Trigger status is WAIT_PULLBACK");

// Brain Test 4: Day Trader 15M In Discount but Active Downward Retracement Leg (Catching Falling Knife)
const brain15mFallingLeg = evaluateMarketBrain({
  symbol: "EURUSD",
  ranges: analyzeAllDealingRanges({
    H4: createRangeBars(60, 100, 200, 135), // 35% in Discount
    M15: createRangeBars(60, 100, 200, 138), // 38% in Discount!
  }),
  htfFvg: htfFvgRes,
  htfLiq: { activeCycle: "IRL_TO_ERL", drawOnLiquidity: { name: "4H EQH BSL", price: 195, targetSide: "BSL" }, sweeps: [] },
  structures: { M15: { dir: -1 }, H4: { dir: 1 } }, // 15M is still trending downward!
  score: 60,
});
assert(brain15mFallingLeg.allowedToLong === false, "15M Gatekeeper VETOES long when 15M is still in downward retracement leg");
assert(brain15mFallingLeg.action === "WAIT_FOR_15M_TRIGGER", `Action is WAIT_FOR_15M_TRIGGER (got ${brain15mFallingLeg.action})`);
assert(brain15mFallingLeg.dayTraderContext?.ltfGatekeeper?.triggerStatus === "WAIT_SHIFT", "15M Trigger status is WAIT_SHIFT");

// Brain Test 5: Day Trader 15M In Discount + MSS Shift Confirmed (Execution Unlocked)
const brain15mUnlocked = evaluateMarketBrain({
  symbol: "EURUSD",
  ranges: analyzeAllDealingRanges({
    H4: createRangeBars(60, 100, 200, 135), // 35% in Discount
    M15: createRangeBars(60, 100, 200, 138), // 38% in Discount!
  }),
  htfFvg: htfFvgRes,
  htfLiq: { activeCycle: "IRL_TO_ERL", drawOnLiquidity: { name: "4H EQH BSL", price: 195, targetSide: "BSL" }, sweeps: [] },
  structures: { M15: { dir: 1 }, H4: { dir: 1 } }, // 15M shifted bullish!
  score: 60,
});
assert(brain15mUnlocked.allowedToLong === true, "15M Gatekeeper UNLOCKS long when 15M is in Discount and structure aligns");
assert(brain15mUnlocked.action === "READY_FOR_LONG", `Action is READY_FOR_LONG (got ${brain15mUnlocked.action})`);
assert(brain15mUnlocked.dayTraderContext?.ltfGatekeeper?.triggerStatus === "APPROVED", "15M Trigger status is APPROVED");
assert(brain15mUnlocked.horizons !== undefined, "Brain output contains horizons matrix");
assert(brain15mUnlocked.horizons.SWING?.timeframeCombo === "1D-1H", "Swing horizon configured as 1D-1H");
assert(brain15mUnlocked.horizons.DAY?.timeframeCombo === "4H-15M", "Day Trade horizon configured as 4H-15M");
assert(brain15mUnlocked.horizons.SCALP?.timeframeCombo === "30M-5M", "Scalp horizon configured as 30M-5M");

console.log("\n=======================================================");
console.log("TEST SUITE 5: Full Engine Integration & Schema Verification");
console.log("=======================================================");

const framesFull = {
  D1: d1Bars,
  H4: createRangeBars(80, 100, 200, 135),
  H1: createRangeBars(70, 120, 160, 135),
  M15: createRangeBars(60, 125, 145, 135),
};

const fullBias = computeSymbolBias("EURUSD", framesFull, {});

assert(typeof fullBias.score === "number", `Numeric score: ${fullBias.score}`);
assert(fullBias.ranges !== undefined, "fullBias contains ranges object");
assert(fullBias.ranges.H4 !== undefined, "ranges contains H4 dealing range");
assert(fullBias.ranges.M15 !== undefined, "ranges contains M15 dealing range");
assert(fullBias.htfFvg !== undefined, "fullBias contains htfFvg object");
assert(Array.isArray(fullBias.htfFvg.respected), "htfFvg contains respected array");
assert(Array.isArray(fullBias.htfFvg.unrespected), "htfFvg contains unrespected array");
assert(fullBias.htfLiquidity !== undefined, "fullBias contains htfLiquidity object");
assert(fullBias.brain !== undefined, "fullBias contains brain object");
assert(typeof fullBias.brain.verdict === "string", `Brain verdict: ${fullBias.brain.verdict}`);
assert(typeof fullBias.brain.narrative === "string", "Brain narrative populated");
assert(fullBias.executionReadiness !== undefined, "fullBias contains executionReadiness interface");
assert(typeof fullBias.executionReadiness.allowedToLong === "boolean", "executionReadiness.allowedToLong is boolean");
assert(typeof fullBias.executionReadiness.action === "string", `executionReadiness.action: ${fullBias.executionReadiness.action}`);

console.log("\n=======================================================");
console.log("TEST SUITE 6: Heuristic Review & Anti-Bias Verification");
console.log("=======================================================");

// 1. Bidirectional SMT Divergence Test (Partner runs high, Base fails -> Bearish SMT)
function createSmtBars(h2) {
  const bars = [];
  const baseTime = 1700000000;
  // bar 0..3 flat
  for (let i = 0; i <= 3; i++) bars.push({ time: baseTime + i * 900, open: 100, high: 102, low: 98, close: 100 });
  // bar 4: Low 1 = 90
  bars.push({ time: baseTime + 4 * 900, open: 98, high: 99, low: 90, close: 95 });
  // bar 5..8 rising
  for (let i = 5; i <= 8; i++) bars.push({ time: baseTime + i * 900, open: 95 + (i - 4)*3, high: 97 + (i - 4)*3, low: 94 + (i - 4)*3, close: 96 + (i - 4)*3 });
  // bar 9: High 1 = 110
  bars.push({ time: baseTime + 9 * 900, open: 107, high: 110, low: 105, close: 108 });
  // bar 10..14 falling
  for (let i = 10; i <= 14; i++) bars.push({ time: baseTime + i * 900, open: 108 - (i - 9)*3, high: 109 - (i - 9)*3, low: 104 - (i - 9)*3, close: 105 - (i - 9)*3 });
  // bar 15: Low 2 = 92
  bars.push({ time: baseTime + 15 * 900, open: 94, high: 96, low: 92, close: 95 });
  // bar 16..20 rising
  for (let i = 16; i <= 20; i++) bars.push({ time: baseTime + i * 900, open: 95 + (i - 15)*2, high: 97 + (i - 15)*2, low: 94 + (i - 15)*2, close: 96 + (i - 15)*2 });
  // bar 21: High 2 = h2
  bars.push({ time: baseTime + 21 * 900, open: 105, high: h2, low: 103, close: 106 });
  // bar 22..25 pulling back
  for (let i = 22; i <= 25; i++) bars.push({ time: baseTime + i * 900, open: 104, high: 105, low: 101, close: 102 });
  return bars;
}

const m15Base = createSmtBars(108); // High 1 = 110, High 2 = 108 (Lower High)
const m15Partner = createSmtBars(114); // High 1 = 110, High 2 = 114 (Higher High)
const smtResult = smtDivergence(m15Base, m15Partner, "GBPUSD");
assert(smtResult !== null, "Bidirectional SMT divergence detected when partner makes HH and base fails");
assert(smtResult?.dir === -1, `SMT direction is bearish (-1) (got ${smtResult?.dir})`);
assert(smtResult?.note.includes("divergence"), "SMT note explains the divergence");

// 2. Evidence Mass Scaling in Lens Voting Test
// A lone micro-drive (w=4) should NOT have the same score contribution as a deep evidence lens (w=24)
const drivesThin = [{ lens: "flow", dir: 1, w: 4 }];
const drivesDeep = [{ lens: "structure", dir: -1, w: 24 }];
const fitnessMock = { flow: 0.8, structure: 0.8, reversal: 0.8, fvg: 0.8, ob: 0.8, sr: 0.8, volume: 0.8 };
const voteResult = lensVote([...drivesThin, ...drivesDeep], fitnessMock);
// With mass scaling, structure (-1 with w=24) decisively wins over flow (+1 with w=4)
assert(voteResult.final < -30, `Deep structure evidence overpowers lone micro-signal (got ${voteResult.final})`);

// 3. Dealing Range Runway in Uptrend (Uptrend in Premium is NOT a Bearish Expansion)
const rangesUptrendInPremium = analyzeAllDealingRanges({
  H4: createRangeBars(60, 100, 200, 165), // 65% covered (in Premium!)
  M15: createRangeBars(60, 140, 180, 165), // M15 has room to range high
}, {
  H4: { dir: 1, seq: "HH+HL" }, // Bullish trend structure!
});
const hasFalseBearishExpansion = rangesUptrendInPremium.alignments.some(a => a.type === "BEARISH_UNCOVERED_EXPANSION");
assert(!hasFalseBearishExpansion, "Uptrend delivering through Premium is NOT falsely labeled as a Bearish Expansion");
const hasBullishDelivery = rangesUptrendInPremium.alignments.some(a => a.type === "BULLISH_UNCOVERED_EXPANSION" && a.dir === 1);
assert(hasBullishDelivery, "Uptrend in Premium correctly recognized as Bullish upside delivery");

console.log("\n=======================================================");
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("=======================================================");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("🎯 ALL TESTS PASSED WITH 100% SUCCESS!\n");
}
