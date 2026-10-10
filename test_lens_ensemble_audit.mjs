import assert from "node:assert";
import { LENSES, lensFitness, lensVote, stability } from "./lib/bias/lenses.js";
import { computeSymbolBias } from "./lib/bias/engine.js";

console.log("===============================================================================");
console.log("TEST SUITE: Lens Ensemble Architectural Hardening & Parity Suite");
console.log("===============================================================================\n");

let passed = 0;
function pass(msg) {
  passed++;
  console.log(`✅ PASS: ${msg}`);
}

// ---------------------------------------------------------------------------
// 1. Lens Count & Taxonomy Synchronization (8 Lenses)
// ---------------------------------------------------------------------------
console.log("--- 1. Testing Lens Taxonomy & Count (8 Lenses) ---");
assert.strictEqual(LENSES.length, 8, "LENSES contains exactly 8 models");
const expectedLenses = ["structure", "liquidity", "reversal", "fvg", "ob", "sr", "volume", "flow"];
assert.deepStrictEqual(LENSES.map(l => l.id), expectedLenses, "All 8 lenses correctly registered");
assert(LENSES.some(l => l.id === "volume"), "Volume lens present in ensemble");
pass("Lens ensemble taxonomy correctly registers 8 models including Volume");

// ---------------------------------------------------------------------------
// 2. Agreement Threshold Synchronization (Dead-Zone Eliminated)
// ---------------------------------------------------------------------------
console.log("\n--- 2. Testing Agreement Threshold Synchronization ---");
// An agreement of 62% previously was contested in lenses.js (< 70%) but skipped dampening in engine.js (< 60%)
const splitDrives = [
  { lens: "structure", dir: 1, w: 12 },
  { lens: "fvg", dir: 1, w: 10 },
  { lens: "reversal", dir: -1, w: 14 },
];
const fit = lensFitness({ er: 0.30 });
const voteSplit = lensVote(splitDrives, fit);
// Contested should be strictly synchronized at agreement < 65
assert.strictEqual(voteSplit.contested, voteSplit.agreement < 65, "vote.contested synchronizes strictly with agreement threshold");
pass("vote.contested agreement threshold synchronized without dead-zone");

// ---------------------------------------------------------------------------
// 3. Sequential ICT Reversal Override (Democracy Paradox Eliminated)
// ---------------------------------------------------------------------------
console.log("\n--- 3. Testing Sequential ICT Reversal Override ---");
// Scenario: Bullish trend structure (+18 w) and FVG (+12 w), followed by decisive Bearish MSS Reversal (-20 w)
const revDrives = [
  { lens: "structure", dir: 1, w: 18 },
  { lens: "fvg", dir: 1, w: 12 },
  { lens: "reversal", dir: -1, w: 20 },
];
const baselineVote = lensVote(revDrives, fit, { setupActive: false });
const sequentialVote = lensVote(revDrives, fit, { setupActive: true, setupDir: -1 });

// Without override, bullish structure + FVG dilutes or flips reversal:
// With sequential override, the active sweep -> MSS subordinates opposing continuation lenses
assert(sequentialVote.final < -20, `Sequential override produces decisive bearish conviction (got ${sequentialVote.final})`);
assert(sequentialVote.final < baselineVote.final, "Sequential reversal override strengthens reversal authority over prior trend");
pass("Sequential ICT Reversal Override prevents democracy paradox and preserves A+ reversal conviction");

// ---------------------------------------------------------------------------
// 4. Smoothstep Efficiency Ratio (ER) Transition
// ---------------------------------------------------------------------------
console.log("\n--- 4. Testing Smoothstep Efficiency Ratio Transition ---");
// Compare fitness at 0.20, 0.25, 0.35, 0.45
const fitAt20 = lensFitness({ er: 0.20 });
const fitAt25 = lensFitness({ er: 0.25 });
const fitAt45 = lensFitness({ er: 0.45 });
// Ensure smooth progression without cliff
assert(fitAt20.structure < fitAt25.structure, "ER 0.25 higher structure fitness than 0.20");
assert(fitAt25.structure < fitAt45.structure, "ER 0.45 higher structure fitness than 0.25");
assert(fitAt45.structure <= 1.0, "Structure fitness capped at 1.0");
pass("Smoothstep ER transition provides continuous, smooth fitness modulation without knife-edge jumps");

// ---------------------------------------------------------------------------
// 5. Order Block Continuous Exponential Distance Decay & Fresh OB Awareness
// ---------------------------------------------------------------------------
console.log("\n--- 5. Testing Continuous OB Distance Decay & Fresh OB Awareness ---");
const fitInsideOb = lensFitness({ obDist: 0.0, hasFreshOb: false });
const fitNearOb = lensFitness({ obDist: 0.5, hasFreshOb: false });
const fitFarOb = lensFitness({ obDist: 2.5, hasFreshOb: false });
const fitFreshObFar = lensFitness({ obDist: 2.0, hasFreshOb: true });

assert(fitInsideOb.ob > fitNearOb.ob, "Inside OB fitness higher than near OB");
assert(fitNearOb.ob > fitFarOb.ob, "Near OB fitness higher than far OB");
assert(Math.abs(fitFarOb.ob - 0.60) < 0.02, "Far OB fitness decays asymptotically to 0.60 floor");
assert(fitFreshObFar.ob >= 0.85, "Fresh OB displacement footprint preserves high fitness floor (>= 0.85)");
pass("Continuous exponential OB distance decay and fresh OB awareness operating smoothly");

// ---------------------------------------------------------------------------
// 6. Intra-Lens Deadlock & Weight Sink Hole Resolution
// ---------------------------------------------------------------------------
console.log("\n--- 6. Testing Intra-Lens Deadlock & Weight Sink Hole ---");
// Conflicted liquidity lens: 14 w BSL magnet above, 14 w SSL magnet below -> score = 0
const deadlockedLiquidity = [
  { lens: "structure", dir: 1, w: 16 },
  { lens: "liquidity", dir: 1, w: 14 },
  { lens: "liquidity", dir: -1, w: 14 },
];
const deadlockVote = lensVote(deadlockedLiquidity, fit);
// Structure is 100% bullish (w=16). Conflicted liquidity (score=0) should NOT crush score to near 0
assert(deadlockVote.final >= 50, `Decisive structure maintains strong score despite conflicted liquidity (got ${deadlockVote.final})`);
// And agreement must reflect that liquidity is deadlocked/contested
assert(deadlockVote.contested === true, "Deadlocked lens with significant mass correctly flags contested = true");
pass("Intra-lens deadlock resolved: conflicted lens does not sink score and correctly reflects contestation");

// ---------------------------------------------------------------------------
// 7. Volume Lens Saturation Ceiling (Cap = 9)
// ---------------------------------------------------------------------------
console.log("\n--- 7. Testing Volume Lens Saturation Ceiling ---");
const volDrives = [
  { lens: "volume", dir: 1, w: 5 }, // VAH acceptance
  { lens: "volume", dir: 1, w: 4 }, // POC rotation
];
const volVote = lensVote(volDrives, fit);
// With cap = 9, w=9 reaches full 1.0 massMult (score = 100)
assert.strictEqual(volVote.lenses.volume.score, 100);
pass("Volume lens achieves full saturation authority at realistic concurrent weight thresholds");

// ---------------------------------------------------------------------------
// 8. Stability Perturbation (Model-Level Shock)
// ---------------------------------------------------------------------------
console.log("\n--- 8. Testing Stability Perturbation ---");
const singleBigDrive = [{ lens: "structure", dir: 1, w: 20 }];
const multiSmallDrives = [
  { lens: "structure", dir: 1, w: 5 },
  { lens: "structure", dir: 1, w: 5 },
  { lens: "structure", dir: 1, w: 5 },
  { lens: "structure", dir: 1, w: 5 },
];
const stabSingle = stability(singleBigDrive, fit, 80);
const stabMulti = stability(multiSmallDrives, fit, 80);
assert.strictEqual(stabSingle, 100);
assert.strictEqual(stabMulti, 100);
pass("Stability stress-test evaluates model-level authority consistently across single and multi-drive regimes");

console.log("\n===============================================================================");
console.log(`🎯 ALL ${passed} LENS ENSEMBLE AUDIT TESTS PASSED WITH 100% SUCCESS!`);
console.log("===============================================================================");
