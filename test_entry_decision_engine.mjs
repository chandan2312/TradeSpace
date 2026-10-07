// Comprehensive Verification Suite: Entry Model Decision Engine (Zone Perfection & Structural Arbitration)
import assert from "node:assert";
import {
  evaluateEntryModelDecisionEngine,
  evaluateZoneDepth,
  evaluateHtfAnchor,
  evaluateModelFitness,
  detectShallowTrap,
  extractHtfAnchorLevels,
} from "./lib/autonomous/entryDecisionEngine.js";
import { evaluateAllEntryModels } from "./lib/autonomous/models.js";

console.log("===============================================================================");
console.log("TEST SUITE: Dedicated Entry Model Decision Engine & Zone Perfection Arbiter");
console.log("===============================================================================\n");

let passedTests = 0;
const test = (desc, fn) => {
  try {
    fn();
    console.log(`✅ PASS: ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ FAIL: ${desc}`);
    console.error(err);
    process.exit(1);
  }
};

// ---------------------------------------------------------------------------
// 1. Dealing Range Location & Depth Scoring
// ---------------------------------------------------------------------------
test("Long entry in Extreme Discount (< 20%) receives top location score (28-30 pts)", () => {
  const range = { high: 1.1000, low: 1.0000 };
  const res = evaluateZoneDepth({ entry: 1.0150, sl: 1.0050, dir: 1, range, evidence: {} });
  assert(res.isExtreme === true, "Must be flagged as extreme");
  assert(res.locationScore >= 28, `Expected >= 28, got ${res.locationScore}`);
  assert.strictEqual(res.depthTier, "EXTREME_DISCOUNT");
});

test("Long entry sweeping below Dealing Range Low receives 30 pts (Raid Zone)", () => {
  const range = { high: 1.1000, low: 1.0000 };
  const res = evaluateZoneDepth({ entry: 0.9990, sl: 0.9950, dir: 1, range, evidence: { raid: { extreme: 0.9980 } } });
  assert(res.isExtreme === true, "Must be flagged as extreme");
  assert.strictEqual(res.locationScore, 30);
  assert.strictEqual(res.depthTier, "EXTREME_SWEEP_DISCOUNT");
});

test("Long entry in Deep Discount OTE (20% - 40%) receives 24 pts", () => {
  const range = { high: 1.1000, low: 1.0000 };
  const res = evaluateZoneDepth({ entry: 1.0300, sl: 1.0100, dir: 1, range, evidence: {} });
  assert(res.isDeep === true, "Must be flagged as deep");
  assert.strictEqual(res.locationScore, 24);
  assert.strictEqual(res.depthTier, "DEEP_DISCOUNT_OTE");
});

test("Long entry in Equilibrium Fair Value (40% - 55%) receives 16 pts", () => {
  const range = { high: 1.1000, low: 1.0000 };
  const res = evaluateZoneDepth({ entry: 1.0480, sl: 1.0350, dir: 1, range, evidence: {} });
  assert.strictEqual(res.locationScore, 16);
  assert.strictEqual(res.depthTier, "EQUILIBRIUM_FAIR_VALUE");
});

test("Long entry in Premium (> 55%) receives 0 pts (Buying Premium)", () => {
  const range = { high: 1.1000, low: 1.0000 };
  const res = evaluateZoneDepth({ entry: 1.0650, sl: 1.0500, dir: 1, range, evidence: {} });
  assert(res.isPremiumChop === true, "Must be flagged as premium chop");
  assert.strictEqual(res.locationScore, 0);
  assert.strictEqual(res.depthTier, "PREMIUM_CHOP");
});

test("Short entry in Extreme Premium (< 20% from high) receives top location score (28-30 pts)", () => {
  const range = { high: 1.1000, low: 1.0000 };
  const res = evaluateZoneDepth({ entry: 1.0850, sl: 1.0950, dir: -1, range, evidence: {} });
  assert(res.isExtreme === true, "Must be flagged as extreme for shorts");
  assert(res.locationScore >= 28);
  assert.strictEqual(res.depthTier, "EXTREME_PREMIUM");
});

// ---------------------------------------------------------------------------
// 2. HTF Structural Anchor Confluence
// ---------------------------------------------------------------------------
test("Candidate overlapping Major PDL receives 25 anchor points", () => {
  const anchors = [
    { id: "PDL:1", name: "PDL", price: 1.0800, side: -1, type: "PDL", major: true },
    { id: "EQ:1", name: "EQ", price: 1.0850, side: 0, type: "RANGE_EQ", major: false },
  ];
  const units = { pip: 0.0001, point: 0.00001 };
  const res = evaluateHtfAnchor({ entry: 1.0802, zoneLow: 1.0800, zoneHigh: 1.0804, dir: 1, anchors, units });
  assert.strictEqual(res.anchorScore, 25);
  assert.strictEqual(res.anchorTag, "MAJOR_PDL_ANCHOR");
});

test("Candidate overlapping HTF Order Block receives 22 anchor points", () => {
  const anchors = [
    { id: "H4:OB", name: "H4 Order Block", price: 1.0820, top: 1.0830, bottom: 1.0810, side: -1, type: "HTF_OB", major: true },
  ];
  const units = { pip: 0.0001, point: 0.00001 };
  const res = evaluateHtfAnchor({ entry: 1.0818, zoneLow: 1.0815, zoneHigh: 1.0825, dir: 1, anchors, units });
  assert.strictEqual(res.anchorScore, 22);
  assert.strictEqual(res.anchorTag, "HTF_ORDER_BLOCK_ANCHOR");
});

test("Floating candidate with no HTF level receives baseline 4 points", () => {
  const anchors = [
    { id: "PDL:1", name: "PDL", price: 1.0700, side: -1, type: "PDL", major: true },
  ];
  const units = { pip: 0.0001, point: 0.00001 };
  const res = evaluateHtfAnchor({ entry: 1.0850, zoneLow: 1.0848, zoneHigh: 1.0852, dir: 1, anchors, units });
  assert.strictEqual(res.anchorScore, 4);
  assert.strictEqual(res.anchorTag, "LOCAL_INTRADAY_ONLY");
});

// ---------------------------------------------------------------------------
// 3. Model-to-Context Fitness Matrix
// ---------------------------------------------------------------------------
test("Turtle Soup at an Extreme Raid receives maximum 20 fitness points", () => {
  const res = evaluateModelFitness({ modelId: "turtle_soup", depthTier: "EXTREME_SWEEP_DISCOUNT", isExtreme: true, dir: 1 });
  assert.strictEqual(res.fitnessScore, 20);
  assert.strictEqual(res.fitnessTag, "TURTLE_SOUP_PREMIER_EXTREME_RAID");
});

test("Turtle Soup in shallow zone receives penalty fitness score (6 pts)", () => {
  const res = evaluateModelFitness({ modelId: "turtle_soup", depthTier: "SHALLOW_DISCOUNT", isShallow: true, dir: 1 });
  assert.strictEqual(res.fitnessScore, 6);
  assert.strictEqual(res.fitnessTag, "TURTLE_SOUP_SHALLOW_CHOP_RISK");
});

test("Breaker Block displacing through failed OB receives maximum 20 fitness points", () => {
  const evidence = { failedOrderBlock: { top: 1.0850, bottom: 1.0840 }, displacement: { valid: true } };
  const res = evaluateModelFitness({ modelId: "breaker_block", depthTier: "EQUILIBRIUM_FAIR_VALUE", isShallow: true, evidence, dir: 1 });
  assert.strictEqual(res.fitnessScore, 20);
  assert.strictEqual(res.fitnessTag, "BREAKER_DISPLACED_STRUCTURE_FLIP");
});

test("OTE in the 0.618 - 0.786 deep pocket receives maximum 20 fitness points", () => {
  const res = evaluateModelFitness({ modelId: "ote_continuation", depthTier: "DEEP_DISCOUNT_OTE", isDeep: true, dir: 1 });
  assert.strictEqual(res.fitnessScore, 20);
  assert.strictEqual(res.fitnessTag, "OTE_PERFECT_FIBONACCI_POCKET");
});

// ---------------------------------------------------------------------------
// 4. Impending Extreme & Shallow Trap Detector (User's Core Insight!)
// ---------------------------------------------------------------------------
test("Shallow model formed right ahead of unmitigated HTF Extreme is flagged as SHALLOW TRAP", () => {
  const candidate = { entry: 1.0860, sl: 1.0840 }; // 20 pip stop
  const anchors = [
    { name: "Daily Order Block", price: 1.0845, type: "HTF_OB", major: true }, // Lies between entry and SL!
  ];
  const units = { pip: 0.0001, point: 0.00001 };
  const trap = detectShallowTrap({ candidate, anchors, dir: 1, isShallow: true, isExtreme: false, units });
  
  assert.strictEqual(trap.shallowTrap, true);
  assert.strictEqual(trap.trapPenalty, 25);
  assert(trap.trapWarning.includes("Impending HTF Extreme"), "Must warn of looming extreme");
  assert.strictEqual(trap.sovereigntyTag, "SHALLOW_TRAP_AHEAD_OF_EXTREME");
});

test("Extreme model receives EXTREME_ZONE_SOVEREIGNTY bonus (+15 pts) and zero trap penalty", () => {
  const candidate = { entry: 1.0800, sl: 1.0780 };
  const anchors = [{ name: "PDL", price: 1.0800, type: "PDL", major: true }];
  const units = { pip: 0.0001, point: 0.00001 };
  const trap = detectShallowTrap({ candidate, anchors, dir: 1, isShallow: false, isExtreme: true, units });

  assert.strictEqual(trap.shallowTrap, false);
  assert.strictEqual(trap.trapPenalty, 0);
  assert.strictEqual(trap.extremeBonus, 15);
  assert.strictEqual(trap.sovereigntyTag, "EXTREME_ZONE_SOVEREIGNTY");
});

test("Strict extreme preference vetoes shallow trap candidate with SHALLOW_AHEAD_OF_EXTREME", () => {
  const candidates = [
    {
      id: "ict_2022",
      modelId: "ict_2022",
      entry: 1.0835,
      sl: 1.0815,
      rr: 3.5,
      permitted: true,
      confluenceScore: 75,
      evidence: { displacement: { valid: true } },
    },
  ];
  const anchors = [
    { name: "PDL", price: 1.0845, type: "PDL", major: true },
  ];
  const range = { high: 1.0950, low: 1.0750 }; // EQ is 1.0850. 1.0860 is shallow discount / EQ
  const res = evaluateEntryModelDecisionEngine({
    candidates,
    symbol: "EURUSD",
    dir: 1,
    ranges: { H4: range },
    brain: {
      dealingRange: range,
      htfLiquidity: { keyLevels: { L1: { name: "PDL", price: 1.0820, side: -1, type: "PDL" } } },
    },
    config: { strictExtremePreference: true },
  });

  assert.strictEqual(res.permitted, false);
  assert(res.vetoes.some(v => v.code === "SHALLOW_AHEAD_OF_EXTREME"), "Must have SHALLOW_AHEAD_OF_EXTREME veto");
});

// ---------------------------------------------------------------------------
// 5. Arbitration: Extreme Zone Beats Shallow Model with Higher Nominal R:R
// ---------------------------------------------------------------------------
test("ARBITRATION PROOF: Extreme Model (2.3R) decisively beats Shallow Model claiming 4.5R", () => {
  const range = { high: 1.1000, low: 1.0000 }; // 1000 pips range
  const anchors = [
    { id: "PDL", name: "PDL", price: 1.0020, type: "PDL", major: true },
  ];

  // Candidate A: Shallow ICT 2022 FVG at 48% discount with tiny stop claiming 4.5R
  const candShallow = {
    id: "ict_2022",
    modelId: "ict_2022",
    name: "ICT 2022 Mentorship",
    badge: "2022 Mentorship",
    entry: 1.0480,
    sl: 1.0420,
    rr: 4.5,
    permitted: true,
    confluenceScore: 80,
    evidence: { displacement: { valid: true, bodyRatio: 0.62 } },
  };

  // Candidate B: Extreme Turtle Soup at PDL with wide structural stop offering 2.3R
  const candExtreme = {
    id: "turtle_soup",
    modelId: "turtle_soup",
    name: "Turtle Soup Liquidity Raid",
    badge: "Turtle Soup",
    entry: 1.0020,
    sl: 0.9980,
    rr: 2.3,
    permitted: true,
    confluenceScore: 80,
    evidence: {
      raid: { extreme: 0.9990, levelPrice: 1.0020 },
      displacement: { valid: true, bodyRatio: 0.68 },
    },
  };

  const decision = evaluateEntryModelDecisionEngine({
    candidates: [candShallow, candExtreme],
    symbol: "EURUSD",
    dir: 1,
    ranges: { H4: range },
    brain: {
      dealingRange: range,
      htfLiquidity: { keyLevels: { L1: { price: 1.0020, side: -1 } } },
    },
    config: { strictExtremePreference: false },
  });

  // VERIFICATION:
  // Under naive sorting (b.rr - a.rr), candShallow (4.5R) would falsely win!
  // Under EntryModelDecisionEngine, candExtreme (Grade A+, Extreme Sovereignty) MUST WIN!
  const shallowEvaluated = decision.allCandidates.find(c => c.id === "ict_2022");
  assert.strictEqual(decision.modelId, "turtle_soup", "Extreme Turtle Soup must beat shallow model");
  assert(decision.zoneScore > shallowEvaluated.zoneScore, `Extreme zone score (${decision.zoneScore}) must exceed shallow (${shallowEvaluated.zoneScore})`);
  assert(decision.decisionEngine.winnerTier.includes("EXTREME"), "Winner tier must be EXTREME");
  console.log(`   --> Cand Extreme Zone Score: ${decision.zoneScore} | Cand Shallow Zone Score: ${shallowEvaluated.zoneScore}`);
  console.log(`   --> Decisive Winner: [${decision.modelId.toUpperCase()}] with Zone Score ${decision.zoneScore}/100 (Grade ${decision.zoneGrade})`);
});

// ---------------------------------------------------------------------------
// 6. Balanced Portfolio Verification Across All 4 Core Models
// ---------------------------------------------------------------------------
test("All 4 models receive institutional grade evaluation and valid zone breakdowns", () => {
  const range = { high: 1.1000, low: 1.0000 };
  const models = [
    { id: "turtle_soup", entry: 1.0100, sl: 1.0050, rr: 2.5, permitted: true, evidence: { raid: { extreme: 1.0080, levelPrice: 1.0100 } } },
    { id: "ote_continuation", entry: 1.0350, sl: 1.0100, rr: 2.8, permitted: true, evidence: { impulse: { high: 1.0900, low: 1.0100 }, fib705: 1.0350 } },
    { id: "breaker_block", entry: 1.0450, sl: 1.0250, rr: 2.2, permitted: true, evidence: { failedOrderBlock: { top: 1.0470, bottom: 1.0430 }, displacement: { valid: true } } },
    { id: "ict_2022", entry: 1.0250, sl: 1.0120, rr: 2.4, permitted: true, evidence: { mss: { displacement: { valid: true } }, fvg: { ce: 1.0250 } } },
  ];

  const decision = evaluateEntryModelDecisionEngine({
    candidates: models,
    symbol: "EURUSD",
    dir: 1,
    ranges: { H4: range },
    brain: { dealingRange: range },
  });

  assert(decision != null, "Decision must not be null");
  assert(decision.allCandidates.length === 4, "Must score all 4 candidates");
  for (const c of decision.allCandidates) {
    assert(c.zoneScore > 0 && c.zoneScore <= 100, `Model ${c.id} zone score must be 0-100: got ${c.zoneScore}`);
    assert(["A+", "A", "B", "C"].includes(c.zoneGrade), `Model ${c.id} must receive valid grade: got ${c.zoneGrade}`);
    assert(c.zoneBreakdown != null, `Model ${c.id} must include full zone breakdown`);
  }
});

console.log("\n===============================================================================");
console.log(`🎯 ALL ${passedTests} ENTRY MODEL DECISION ENGINE TESTS PASSED WITH 100% SUCCESS!`);
console.log("===============================================================================");
