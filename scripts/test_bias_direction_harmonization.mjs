import { evaluateExecutionVetoes } from "../lib/autonomous/models.js";
import { evaluateSymbol } from "../lib/autonomous/scanner.js";

async function runTests() {
  console.log("=== RUNNING BIAS & DIRECTION HARMONIZATION TEST SUITE ===");

  // 1. Test evaluateExecutionVetoes rejects BUY when verdict is BEARISH and allowedToLong is false
  console.log("\n--- TEST 1: evaluateExecutionVetoes Rejects BUY in Bearish Market ---");
  const mockBrain = {
    macroBias: "BEARISH",
    macroDir: -1,
    macroCompass: "BEARISH",
    verdict: "STRONG_BEARISH_EXPANSION",
    action: "WAIT_FOR_15M_PULLBACK",
    allowedToLong: false,
    allowedToShort: false,
    conviction: 84,
  };

  const vetoResult = evaluateExecutionVetoes({
    symbol: "UK100",
    dir: 1, // Attempting to BUY
    entry: 10615.91,
    sl: 10570.00,
    brain: mockBrain,
    frames: { M15: [{ time: 1795012200, open: 10620, high: 10625, low: 10610, close: 10618 }] },
    config: { horizonMode: "day", candidate: { modelId: "turtle_soup" } },
    now: new Date(),
  });

  console.log("Execution Vetoes Result:", vetoResult);
  if (vetoResult.permitted) {
    throw new Error("FAIL: System permitted a BUY trade when Brain verdict was STRONG_BEARISH_EXPANSION!");
  }
  const brainVeto = vetoResult.vetoes.find(v => v.code === "BRAIN_NOT_PERMITTED");
  if (!brainVeto) {
    throw new Error("FAIL: Expected BRAIN_NOT_PERMITTED veto, got: " + JSON.stringify(vetoResult.vetoes));
  }
  console.log(`✓ TEST 1 PASSED: Correctly blocked BUY with: ${brainVeto.reason}`);

  // 2. Test evaluateSymbol Scanner sets dir = 0 and blocks BUY when allowedToLong is false
  console.log("\n--- TEST 2: evaluateSymbol Scanner Blocks BUY when allowedToLong is false ---");
  const mockBias = {
    score: -35,
    brain: {
      macroCompass: "BEARISH",
      verdict: "STRONG_BEARISH_EXPANSION",
      action: "WAIT_FOR_15M_PULLBACK",
      allowedToLong: false,
      allowedToShort: false,
      conviction: 84,
      horizons: {
        DAY: { macroCompass: "BEARISH" }
      }
    },
    htfLiquidity: { macroBias: "BEARISH" },
    ranges: { H4: { high: 10979, low: 10513, eq: 10746, coveragePct: 27, zone: "DISCOUNT" } }
  };

  const evalResult = evaluateSymbol(
    "UK100",
    { M15: [{ time: 1795012200, open: 10620, high: 10625, low: 10610, close: 10618 }] },
    new Map(),
    { horizonMode: "day" },
    Date.now(),
    { id: "day", macroTf: "H4", gatekeeperTf: "15M" },
    mockBias
  );

  console.log("Scanner Evaluation Result:", {
    macroBias: evalResult.brain.macroBias,
    macroDir: evalResult.brain.macroDir,
    dir: evalResult.dir,
    stagedLevel: evalResult.stagedLevel,
    executionPermitted: evalResult.execution?.permitted,
    executionVetoes: evalResult.execution?.vetoes,
  });

  if (evalResult.dir === 1) {
    throw new Error("FAIL: Scanner resolved dir = 1 (BUY) when Brain verdict was STRONG_BEARISH_EXPANSION!");
  }
  if (evalResult.stagedLevel !== null) {
    throw new Error("FAIL: Scanner staged a level when allowedToLong was false!");
  }
  console.log("✓ TEST 2 PASSED: Scanner resolved dir = 0 and staged zero buy levels in bearish market.");

  console.log("\n========================================================");
  console.log("ALL BIAS & DIRECTION TESTS COMPLETED SUCCESSFULLY!");
  console.log("========================================================");
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
