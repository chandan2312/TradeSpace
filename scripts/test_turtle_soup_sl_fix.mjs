import { calculateAssetNoiseFloor, calculateStructuralStopLoss, auditStopLossIntegrity, HORIZON_SL_PROFILES } from "../lib/autonomous/slEngine.js";
import { symbolUnits } from "../lib/autonomous/models.js";

async function runTests() {
  console.log("=== RUNNING ASLE & TURTLE SOUP VERIFICATION SUITE ===");

  // 1. Noise Floor Calibrations
  console.log("\n--- TEST 1: Noise Floor Values ---");
  const uk100Floor = calculateAssetNoiseFloor("UK100", "index", HORIZON_SL_PROFILES.DAY);
  const nas100Floor = calculateAssetNoiseFloor("NAS100", "index", HORIZON_SL_PROFILES.DAY);
  const us30Floor = calculateAssetNoiseFloor("US30", "index", HORIZON_SL_PROFILES.DAY);
  const ger40Floor = calculateAssetNoiseFloor("GER40", "index", HORIZON_SL_PROFILES.DAY);
  const goldFloor = calculateAssetNoiseFloor("XAUUSD", "metal", HORIZON_SL_PROFILES.DAY);
  const btcFloor = calculateAssetNoiseFloor("BTCUSD", "crypto", HORIZON_SL_PROFILES.DAY);

  console.log({ uk100Floor, nas100Floor, us30Floor, ger40Floor, goldFloor, btcFloor });

  if (uk100Floor < 45) throw new Error(`UK100 floor too low: ${uk100Floor}`);
  if (nas100Floor < 60) throw new Error(`NAS100 floor too low: ${nas100Floor}`);
  if (us30Floor < 120) throw new Error(`US30 floor too low: ${us30Floor}`);
  if (ger40Floor < 50) throw new Error(`GER40 floor too low: ${ger40Floor}`);
  if (goldFloor < 6) throw new Error(`Gold floor too low: ${goldFloor}`);
  if (btcFloor < 400) throw new Error(`BTC floor too low: ${btcFloor}`);
  console.log("✓ TEST 1 PASSED: Institutional noise floors properly calibrated.");

  // 2. Structural Stop Loss on UK100 with micro-wick
  console.log("\n--- TEST 2: Structural SL Calculation for UK100 Micro-Raid ---");
  const entry = 10615.91;
  const raidExtreme = 10610.14; // 5.77 points below entry
  const slResult = calculateStructuralStopLoss({
    dir: 1,
    entry,
    modelId: "turtle_soup",
    extreme: raidExtreme,
    evidence: {
      raid: { extreme: raidExtreme },
      rejectionBar: { bar: { low: raidExtreme, high: 10626.99, open: 10623.39, close: 10619.72 } },
    },
    symbol: "UK100",
    config: { horizonMode: "day" },
    tf: "15M",
  });

  console.log("SL Result:", {
    entry,
    sl: slResult.sl,
    riskDistance: slResult.riskDistance,
    noiseFloorApplied: slResult.noiseFloorApplied,
    assetNoiseFloor: slResult.assetNoiseFloor,
    anchorPrice: slResult.anchorPrice,
  });

  if (slResult.riskDistance < 45.0) {
    throw new Error(`FAIL: Risk distance (${slResult.riskDistance}) is less than UK100 noise floor (45.0)`);
  }
  if (!slResult.noiseFloorApplied) {
    throw new Error("FAIL: noiseFloorApplied should be true when anchor wick is too close");
  }
  console.log("✓ TEST 2 PASSED: SL correctly expanded to clear UK100 noise floor (at least 45 points).");

  // 3. Stop Loss Integrity Audit Veto
  console.log("\n--- TEST 3: Stop Loss Integrity Audit on Suicidal Trade ---");
  const suicidalAudit = auditStopLossIntegrity({
    dir: 1,
    entry: 10615.91,
    sl: 10594.00, // 21.91 points risk on UK100
    symbol: "UK100",
    config: { horizonMode: "day" },
    spreadPrice: 1.70,
  });

  console.log("Suicidal trade audit:", suicidalAudit);
  if (suicidalAudit.pass) {
    throw new Error("FAIL: Suicidal trade (21.91 pt SL on UK100) should have been VETOED!");
  }
  const noiseVeto = suicidalAudit.vetoes.find(v => v.code === "SL_IN_NOISE_ZONE");
  if (!noiseVeto) {
    throw new Error("FAIL: Expected SL_IN_NOISE_ZONE veto");
  }
  console.log(`✓ TEST 3 PASSED: Suicidal trade correctly vetoed with: ${noiseVeto.reason}`);

  // 4. Safe Trade Passes Audit
  console.log("\n--- TEST 4: Safe Structural SL Passes Audit ---");
  const safeAudit = auditStopLossIntegrity({
    dir: 1,
    entry: 10615.91,
    sl: 10570.00, // 45.91 points risk on UK100
    symbol: "UK100",
    config: { horizonMode: "day" },
    spreadPrice: 1.70,
  });

  console.log("Safe trade audit:", safeAudit);
  if (!safeAudit.pass) {
    throw new Error(`FAIL: Safe trade was unexpectedly vetoed: ${JSON.stringify(safeAudit.vetoes)}`);
  }
  console.log("✓ TEST 4 PASSED: Structurally safe trade passed audit without issues.");

  // 5. Pre-Entry Validation: Price Too Close to SL Veto
  console.log("\n--- TEST 5: Pre-Entry Validation Distance Check ---");
  const { evaluateLevelGeometry } = await import("../lib/autonomous/preEntryValidation.js");
  const geometryCheck = evaluateLevelGeometry(
    {
      entryPrice: 10615.91,
      initialSlPrice: 10594.00,
      dir: 1,
      slAudit: { assetNoiseFloor: 45.0 },
      initialRiskDistance: 21.91,
    },
    10601.38 // Current price plunged to 10601.38, only 7.38 from SL!
  );
  console.log("Pre-entry geometry check:", geometryCheck);
  const closeVeto = geometryCheck.vetoes.find(v => v.code === "PRICE_TOO_CLOSE_TO_SL");
  if (!closeVeto) {
    throw new Error("FAIL: Expected PRICE_TOO_CLOSE_TO_SL veto when price is only 7.38 from SL!");
  }
  console.log(`✓ TEST 5 PASSED: Correctly vetoed entry when price plunged near SL: ${closeVeto.reason}`);

  console.log("\n========================================================");
  console.log("ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY!");
  console.log("========================================================");
}

runTests();
