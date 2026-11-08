// test_conviction_breakdown_backend.mjs
// Comprehensive verification of the Negative Conviction Architecture & DBCC in Market Brain & Pipeline

import { evaluateMarketBrain } from "./lib/bias/brain.js";
import { computeSymbolBias } from "./lib/bias/engine.js";
import { sanitizeScannedPair } from "./lib/autonomous/engine.js";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

console.log("================================================================================");
console.log("RUNNING NEGATIVE CONVICTION & DBCC BACKEND VERIFICATION");
console.log("================================================================================\n");

// -----------------------------------------------------------------------------
// Test 1: Baseline DBCC Structure Contract
// -----------------------------------------------------------------------------
console.log("Test 1: Baseline Conviction Breakdown Structure Contract");
{
  const brain = evaluateMarketBrain({
    symbol: "EURUSD",
    ranges: {
      ranges: {
        H4: { currentPrice: 1.0850, coveragePct: 40, zone: "DISCOUNT", pos: 0.40 },
        M15: { currentPrice: 1.0850, coveragePct: 35, remainingPctToHigh: 65, zone: "DISCOUNT" },
      },
    },
    htfFvg: { orderFlowState: "BULLISH", bullishFvgs: [{ top: 1.0840, bottom: 1.0820, mitigated: false }] },
    htfLiq: { drawOnLiquidity: { name: "Equal Highs", price: 1.0920, targetSide: "BSL", distancePips: 70 }, sweeps: [] },
    structures: { H4: { trend: 1, structureBreak: "BOS" }, M15: { trend: 1 } },
    retracements: { evaluations: { M15: { stage: "COMPLETED", qualityScore: 85 } }, compositeGrade: "A+", compositeScore: 90 },
    intraday: { setup: { state: "TRIGGER_FIRED" } },
    score: 65,
    stability: 85,
    agreement: 80,
  });

  assert(brain.convictionBreakdown != null, "brain.convictionBreakdown is defined");
  assert(typeof brain.convictionBreakdown.baseConviction === "number", "baseConviction is numeric");
  assert(typeof brain.convictionBreakdown.baseScenario === "string", "baseScenario is string");
  assert(Array.isArray(brain.convictionBreakdown.bonuses), "bonuses is an array");
  assert(Array.isArray(brain.convictionBreakdown.deductions), "deductions is an array");
  assert(typeof brain.convictionBreakdown.positiveMod === "number", "positiveMod is numeric");
  assert(typeof brain.convictionBreakdown.negativeMod === "number", "negativeMod is numeric");
  assert(typeof brain.convictionBreakdown.netConviction === "number", "netConviction is numeric");
  assert(brain.conviction === brain.convictionBreakdown.netConviction, "brain.conviction matches netConviction");
  assert(brain.convictionBreakdown.positiveMod > 0, `Positive modifiers awarded (+${brain.convictionBreakdown.positiveMod} pts)`);
  assert(brain.convictionBreakdown.deductions.length === 0, "No negative deductions in pristine setup");
  assert(brain.primaryDrag === null, "primaryDrag is null when deductions are empty");
}

// -----------------------------------------------------------------------------
// Test 2: M15 Gatekeeper Negative Deductions (-10 & -8)
// -----------------------------------------------------------------------------
console.log("\nTest 2: M15 Gatekeeper Negative Deductions");
{
  // 2A: Pending Pullback (-10)
  const brainPullback = evaluateMarketBrain({
    symbol: "EURUSD",
    ranges: {
      ranges: {
        H4: { currentPrice: 1.0850, coveragePct: 40, zone: "DISCOUNT", pos: 0.40 },
        M15: { currentPrice: 1.0850, coveragePct: 35, remainingPctToHigh: 65, zone: "DISCOUNT" },
      },
    },
    htfFvg: { orderFlowState: "BULLISH", bullishFvgs: [{ top: 1.0840, bottom: 1.0820, mitigated: false }] },
    htfLiq: { drawOnLiquidity: { name: "Equal Highs", price: 1.0920, targetSide: "BSL" }, sweeps: [] },
    structures: { H4: { trend: 1, structureBreak: "BOS" } },
    retracements: { evaluations: { M15: { stage: "AWAITING_PULLBACK" } } },
    intraday: { setup: { state: "WAIT_FOR_15M_PULLBACK" } },
    score: 60,
    stability: 70,
    agreement: 75,
  });

  const dPullback = brainPullback.convictionBreakdown.deductions.find((d) => d.key === "m15GatekeeperPendingPullback");
  assert(dPullback != null, "m15GatekeeperPendingPullback deduction triggered");
  assert(dPullback?.pts === -10, `Pending pullback deduction is exactly -10 pts (got ${dPullback?.pts})`);
  assert(brainPullback.conviction < brainPullback.convictionBreakdown.baseConviction, "Net conviction reduced by gatekeeper pending pullback");
  assert(brainPullback.primaryDrag?.key === "m15GatekeeperPendingPullback", "primaryDrag correctly identifies pending pullback");

  // 2B: Awaiting Shift (-8)
  const brainShift = evaluateMarketBrain({
    symbol: "GBPUSD",
    ranges: {
      ranges: {
        H4: { currentPrice: 1.2700, coveragePct: 45, zone: "DISCOUNT", pos: 0.45 },
        M15: { currentPrice: 1.2700, coveragePct: 40, remainingPctToHigh: 60, zone: "DISCOUNT" },
      },
    },
    htfFvg: { orderFlowState: "BULLISH" },
    htfLiq: { drawOnLiquidity: { name: "Buy Stops", price: 1.2800, targetSide: "BSL" }, sweeps: [] },
    structures: { H4: { trend: 1 } },
    retracements: { evaluations: { M15: { stage: "PULLBACK_COMPLETE" } } },
    intraday: { setup: { state: "WAIT_FOR_15M_TRIGGER" } },
    score: 60,
    stability: 70,
    agreement: 75,
  });

  const dShift = brainShift.convictionBreakdown.deductions.find((d) => d.key === "m15GatekeeperAwaitingShift");
  assert(dShift != null, "m15GatekeeperAwaitingShift deduction triggered");
  assert(dShift?.pts === -8, `Awaiting shift deduction is exactly -8 pts (got ${dShift?.pts})`);
}

// -----------------------------------------------------------------------------
// Test 3: Adverse Velocity & Poor Retracement Quality (-8 & -4)
// -----------------------------------------------------------------------------
console.log("\nTest 3: Adverse Velocity & Retracement Quality Deductions");
{
  const brainAdverse = evaluateMarketBrain({
    symbol: "NAS100",
    ranges: {
      ranges: {
        H4: { currentPrice: 20000, coveragePct: 45, zone: "DISCOUNT", pos: 0.45 },
        M15: { currentPrice: 20000, coveragePct: 40, remainingPctToHigh: 60, zone: "DISCOUNT" },
      },
    },
    htfFvg: { orderFlowState: "BULLISH" },
    htfLiq: { drawOnLiquidity: { name: "All Time High", price: 20500, targetSide: "BSL" }, sweeps: [] },
    structures: { H4: { trend: 1 } },
    retracements: {
      evaluations: {
        M15: {
          adverseVelocity: true,
          qualityScore: 30,
        },
      },
    },
    intraday: {},
    score: 60,
    stability: 70,
    agreement: 75,
  });

  const dVelocity = brainAdverse.convictionBreakdown.deductions.find((d) => d.key === "adverseVelocityFreightTrain");
  const dQuality = brainAdverse.convictionBreakdown.deductions.find((d) => d.key === "poorRetracementQuality");

  assert(dVelocity != null, "adverseVelocityFreightTrain deduction triggered");
  assert(dVelocity?.pts === -8, `Freight train velocity deduction is -8 pts (got ${dVelocity?.pts})`);
  assert(dQuality != null, "poorRetracementQuality deduction triggered");
  assert(dQuality?.pts === -4, `Poor retracement quality deduction is -4 pts (got ${dQuality?.pts})`);
}

// -----------------------------------------------------------------------------
// Test 4: Consensus & Stability Degradation (-8, -6, -4, -3)
// -----------------------------------------------------------------------------
console.log("\nTest 4: Consensus & Stability Degradation Deductions");
{
  // Severe lens conflict & unstable order flow
  const brainConflict = evaluateMarketBrain({
    symbol: "XAUUSD",
    ranges: {
      ranges: {
        H4: { currentPrice: 2700, coveragePct: 50, zone: "EQUILIBRIUM", pos: 0.50 },
      },
    },
    structures: { H4: { trend: 1 } },
    score: 25,
    stability: 35, // unstable (<40: -6)
    agreement: 30, // severe conflict (<35: -8)
  });

  const dSevere = brainConflict.convictionBreakdown.deductions.find((d) => d.key === "severeLensConflict");
  const dUnstable = brainConflict.convictionBreakdown.deductions.find((d) => d.key === "unstableOrderFlow");

  assert(dSevere != null, "severeLensConflict deduction triggered (-8 pts)");
  assert(dSevere?.pts === -8, `Severe conflict is -8 pts (got ${dSevere?.pts})`);
  assert(dUnstable != null, "unstableOrderFlow deduction triggered (-6 pts)");
  assert(dUnstable?.pts === -6, `Unstable stability is -6 pts (got ${dUnstable?.pts})`);
}

// -----------------------------------------------------------------------------
// Test 5: Dealing Range Saturation & Dead Zone (-6, -4, -8)
// -----------------------------------------------------------------------------
console.log("\nTest 5: Dealing Range Saturation & Timing Dead Zone Deductions");
{
  const brainSaturatedDeadZone = evaluateMarketBrain({
    symbol: "USDJPY",
    ranges: {
      ranges: {
        H4: { currentPrice: 155.0, coveragePct: 88, zone: "PREMIUM", pos: 0.88 },
      },
    },
    structures: { H4: { trend: 1 } },
    activeTimeSlot: { isDeadZone: true },
    score: 55,
    stability: 65,
    agreement: 70,
  });

  const dSaturation = brainSaturatedDeadZone.convictionBreakdown.deductions.find((d) => d.key === "severeRangeSaturation");
  const dDeadZone = brainSaturatedDeadZone.convictionBreakdown.deductions.find((d) => d.key === "timingDeadZone");

  assert(dSaturation != null, "severeRangeSaturation deduction triggered (>=80% coverage)");
  assert(dSaturation?.pts === -6, `Range saturation is -6 pts (got ${dSaturation?.pts})`);
  assert(dDeadZone != null, "timingDeadZone deduction triggered (dead zone off-peak)");
  assert(dDeadZone?.pts === -8, `Dead zone deduction is -8 pts (got ${dDeadZone?.pts})`);
}

// -----------------------------------------------------------------------------
// Test 6: Primary Drag Identification
// -----------------------------------------------------------------------------
console.log("\nTest 6: Primary Drag Selection");
{
  const brainMultiDeductions = evaluateMarketBrain({
    symbol: "GER40",
    ranges: {
      ranges: {
        H4: { currentPrice: 19500, coveragePct: 75, zone: "PREMIUM", pos: 0.75 }, // -4
      },
    },
    retracements: {
      evaluations: {
        M15: { stage: "AWAITING_PULLBACK" }, // -10
      },
    },
    intraday: { setup: { state: "WAIT_FOR_15M_PULLBACK" } },
    activeTimeSlot: { isDeadZone: true }, // -8
    score: 60,
    stability: 45, // -4
    agreement: 45, // -6
  });

  const bd = brainMultiDeductions.convictionBreakdown;
  assert(bd.deductions.length >= 4, `Multiple deductions present (found ${bd.deductions.length})`);
  assert(brainMultiDeductions.primaryDrag != null, "primaryDrag identified");
  assert(brainMultiDeductions.primaryDrag.key === "m15GatekeeperPendingPullback", `primaryDrag is most severe deduction: ${brainMultiDeductions.primaryDrag.key} (${brainMultiDeductions.primaryDrag.pts} pts)`);
  assert(brainMultiDeductions.primaryDrag.pts === -10, "primaryDrag points are -10");
}

// -----------------------------------------------------------------------------
// Test 7: Integration with computeSymbolBias (lib/bias/engine.js)
// -----------------------------------------------------------------------------
console.log("\nTest 7: Integration with computeSymbolBias");
{
  const generateMockBars = (basePrice, count, step) => {
    const bars = [];
    let p = basePrice;
    const nowSec = 1710000000;
    for (let i = 0; i < count; i++) {
      const open = p;
      const close = p + step;
      const high = Math.max(open, close) + 0.0005;
      const low = Math.min(open, close) - 0.0005;
      bars.push({
        time: nowSec - (count - i) * 900,
        open, high, low, close,
        volume: 1000,
      });
      p = close;
    }
    return bars;
  };

  const frames = {
    M15: generateMockBars(1.0800, 50, 0.0001),
    H1: generateMockBars(1.0750, 50, 0.0002),
    H4: generateMockBars(1.0600, 50, 0.0005),
    D1: generateMockBars(1.0500, 50, 0.0010),
  };

  const biasResult = computeSymbolBias("EURUSD", frames, {
    activeTimeSlot: { isDeadZone: false, session: "LONDON" },
  });

  assert(biasResult.brain != null, "biasResult.brain is defined");
  assert(biasResult.brain.convictionBreakdown != null, "biasResult.brain.convictionBreakdown is present");
  assert(biasResult.executionReadiness != null, "biasResult.executionReadiness is defined");
  assert(biasResult.executionReadiness.convictionBreakdown != null, "executionReadiness contains convictionBreakdown");
  assert(biasResult.executionReadiness.conviction === biasResult.brain.conviction, "executionReadiness.conviction matches brain.conviction");
}

// -----------------------------------------------------------------------------
// Test 8: Integration with sanitizeScannedPair (lib/autonomous/engine.js)
// -----------------------------------------------------------------------------
console.log("\nTest 8: Integration with sanitizeScannedPair");
{
  const mockPair = {
    symbol: "EURUSD",
    radarKey: "EURUSD:day",
    opportunityScore: 78,
    rawScore: 82,
    brain: {
      conviction: 68,
      convictionBreakdown: {
        baseConviction: 82,
        baseScenario: "STRONG_BULLISH_EXPANSION",
        bonuses: [],
        deductions: [{ key: "m15GatekeeperPendingPullback", label: "Pending", pts: -10 }, { key: "rangeSaturation", label: "Saturated", pts: -4 }],
        positiveMod: 0,
        negativeMod: -14,
        netConviction: 68,
      },
      primaryDrag: { key: "m15GatekeeperPendingPullback", label: "Pending", pts: -10 },
      bias: "BULLISH",
      biasLabel: "Bullish",
      verdict: "STRONG_BULLISH_EXPANSION",
      narrative: "Bullish expansion",
      action: "WAIT_FOR_15M_PULLBACK",
    },
    convictionBreakdown: {
      baseConviction: 82,
      baseScenario: "STRONG_BULLISH_EXPANSION",
      bonuses: [],
      deductions: [{ key: "m15GatekeeperPendingPullback", label: "Pending", pts: -10 }, { key: "rangeSaturation", label: "Saturated", pts: -4 }],
      positiveMod: 0,
      negativeMod: -14,
      netConviction: 68,
    },
    primaryDrag: { key: "m15GatekeeperPendingPullback", label: "Pending", pts: -10 },
  };

  const sanitized = sanitizeScannedPair(mockPair);
  assert(sanitized != null, "sanitized pair is returned");
  assert(sanitized.convictionBreakdown != null, "sanitized.convictionBreakdown preserved at top level");
  assert(sanitized.primaryDrag != null, "sanitized.primaryDrag preserved at top level");
  assert(sanitized.brain.convictionBreakdown != null, "sanitized.brain.convictionBreakdown preserved in leanBrain");
  assert(sanitized.brain.primaryDrag != null, "sanitized.brain.primaryDrag preserved in leanBrain");
  assert(sanitized.brain.convictionBreakdown.netConviction === 68, "netConviction correctly matches 68 in leanBrain");
}

// -----------------------------------------------------------------------------
// Test 9: Data Contract on Staged Trade Object & Dynamic Re-anchoring
// -----------------------------------------------------------------------------
console.log("\nTest 9: Data Contract on Staged Trade Object");
{
  const mockSetup = {
    symbol: "EURUSD",
    dir: 1,
    dirLabel: "BUY",
    currentPrice: 1.0850,
    brain: {
      conviction: 72,
      convictionBreakdown: {
        baseConviction: 80,
        deductions: [{ key: "lowLensConsensus", label: "Low Consensus", pts: -6 }, { key: "degradedStability", label: "Degraded", pts: -4 }],
        bonuses: [{ key: "smtDivergence", label: "SMT", pts: 2 }],
        positiveMod: 2,
        negativeMod: -10,
        netConviction: 72,
      },
      primaryDrag: { key: "lowLensConsensus", pts: -6 },
    },
  };

  const stagedTradeDoc = {
    symbol: mockSetup.symbol,
    status: "staged",
    convictionBreakdown: mockSetup.brain?.convictionBreakdown || null,
    primaryDrag: mockSetup.brain?.primaryDrag || null,
    brain: mockSetup.brain,
  };

  assert(stagedTradeDoc.convictionBreakdown != null, "Trade document preserves convictionBreakdown at root");
  assert(stagedTradeDoc.primaryDrag != null, "Trade document preserves primaryDrag at root");
  assert(stagedTradeDoc.convictionBreakdown.negativeMod === -10, "negativeMod is preserved correctly (-10 pts)");
  assert(stagedTradeDoc.primaryDrag.key === "lowLensConsensus", "primaryDrag is identified correctly");
}

console.log("\n================================================================================");
console.log(`VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
console.log("================================================================================");

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
