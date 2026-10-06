import assert from "node:assert/strict";
import { computeSymbolBias } from "./lib/bias/engine.js";
import { selectOptimalEntryLevel, evaluateExecutionVetoes } from "./lib/autonomous/levels.js";
import { hasModelEvidence } from "./lib/autonomous/models.js";
import { revalidateTradeIdea } from "./lib/autonomous/scanner.js";
import { calculateSpreadFriction, isSpreadAcceptable } from "./lib/autonomous/friction.js";
import { resolveCopierRouting, decodeDecimalMagic } from "./lib/autonomous/magicEncoder.js";
import { evaluatePropFirmSafeAction, calculateHalfTargetLevel, breakevenPrice, planFractionalVolumes } from "./lib/autonomous/management.js";
import { calculateRiskSize } from "./lib/autonomous/risk.js";
import { normalizeJournalRow, calculateJournalKpis } from "./lib/journal/store.js";

async function runFullPipelineVerification() {
  console.log("=====================================================================");
  console.log("TEST SUITE: End-to-End Bias Engine & Autonomous Pipeline Verification");
  console.log("=====================================================================\n");

  // -------------------------------------------------------------------------
  // 1. BIAS ENGINE & MARKET BRAIN DYNAMIC SYNTHESIS
  // -------------------------------------------------------------------------
  console.log("--- 1. Testing Bias Engine & Market Brain Synthesis ---");
  const nowTimeSec = 1791280000;
  const nowMs = nowTimeSec * 1000;
  const testNow = new Date(nowMs);

  const generateBars = (count, startPrice, trendDir, intervalSec) => {
    const bars = [];
    const startSec = nowTimeSec - count * intervalSec;
    let p = startPrice;
    for (let i = 0; i < count; i++) {
      const open = p;
      const change = trendDir * (0.0005 + (i % 3) * 0.0002) + ((i % 2 === 0 ? 1 : -1) * 0.0001);
      const close = open + change;
      const high = Math.max(open, close) + 0.0003;
      const low = Math.min(open, close) - 0.0003;
      bars.push({
        time: startSec + i * intervalSec,
        closeTime: startSec + (i + 1) * intervalSec,
        open, high, low, close, v: 1000 + i * 10
      });
      p = close;
    }
    return bars;
  };

  const frames = {
    D1: generateBars(30, 1.0800, 1, 86400),
    H4: generateBars(60, 1.0900, 1, 14400),
    H1: generateBars(60, 1.0950, 1, 3600),
    M15: generateBars(80, 1.1000, 1, 900),
    M5: generateBars(100, 1.1020, 1, 300),
    snapshot: {
      asOf: nowMs,
      closedOnly: true,
      semantics: "UTC_INSTANT",
      timeframes: {
        D1: { stale: false },
        H4: { stale: false },
        H1: { stale: false },
        M15: { stale: false },
        M5: { stale: false },
      }
    }
  };

  const bias = computeSymbolBias("EURUSD", frames, { now: testNow });
  assert(bias != null, "Bias evaluation returned null");
  assert(Number.isFinite(bias.score), "Bias score must be finite");
  assert(bias.ranges != null, "Bias ranges must be populated");
  assert(bias.htfLiquidity != null, "HTF liquidity must be populated");
  assert(bias.brain != null, "Market Brain must be populated");
  assert(bias.brain.horizons?.DAY != null, "Day Trader horizon must exist");
  assert(bias.brain.horizons?.SWING != null, "Swing horizon must exist");
  assert(bias.brain.horizons?.SCALP != null, "Scalp horizon must exist");
  console.log(`✅ PASS: Bias score computed (${bias.score}), Macro: ${bias.brain.macroCompass}, Conviction: ${bias.brain.conviction}`);

  // -------------------------------------------------------------------------
  // 2. LEVEL DISCOVERY & CAUSAL MODEL EVIDENCE
  // -------------------------------------------------------------------------
  console.log("\n--- 2. Testing Level Discovery & Model Evidence ---");
  const scenario = { id: "day", label: "Day Trade", minRR: 2.0, sessionTf: "15M" };
  const stagedLevel = selectOptimalEntryLevel({
    symbol: "EURUSD",
    dir: 1, // BUY
    scenario,
    frames,
    ranges: bias.ranges,
    htfFvg: bias.htfFvg,
    targetDOL: bias.brain.targetDOL,
    config: { minRR: 2.0 },
    brain: bias.brain,
  });

  assert(stagedLevel != null, "Staged level must be discovered");
  assert(stagedLevel.entry > 0, "Entry price must be positive");
  assert(stagedLevel.sl > 0, "Stop loss must be positive");
  assert(stagedLevel.tp > 0, "Take profit must be positive");
  assert(stagedLevel.targetRR >= 2.0, "Target RR must meet minRR");
  assert(hasModelEvidence(stagedLevel, 1), "Discovered level must satisfy hasModelEvidence");
  console.log(`✅ PASS: Staged Level discovered (${stagedLevel.modelName}) @ ${stagedLevel.entry}, SL: ${stagedLevel.sl}, TP: ${stagedLevel.tp}, RR: ${stagedLevel.targetRR}R`);

  // -------------------------------------------------------------------------
  // 3. EXECUTION VETO GATEKEEPER & SPREAD MITIGATION
  // -------------------------------------------------------------------------
  console.log("\n--- 3. Testing Execution Vetoes & Spread Friction Mitigation ---");
  const gatekeeper = evaluateExecutionVetoes({
    symbol: "EURUSD",
    dir: 1,
    entry: stagedLevel.entry,
    sl: stagedLevel.sl,
    brain: bias.brain,
    frames,
    config: { scenario, candidate: stagedLevel, confluenceThreshold: 50 },
    now: testNow,
  });

  console.log("Execution vetoes check:", gatekeeper.vetoes.map(v => v.code));
  assert.equal(gatekeeper.vetoes.some(v => v.code === "NO_STRICT_MODEL"), false, "Must not have NO_STRICT_MODEL veto");
  assert.equal(gatekeeper.vetoes.some(v => v.code === "INVALID_TARGETS"), false, "Must not have INVALID_TARGETS veto");
  assert.equal(gatekeeper.vetoes.some(v => v.code === "MIN_RR"), false, "Must not have MIN_RR veto");
  console.log("✅ PASS: Execution Gatekeeper validated without synthetic model or target vetoes");

  const spreadPrice = 0.00005; // 0.5 pips realistic EURUSD spread
  const riskDist = Math.abs(stagedLevel.entry - stagedLevel.sl);
  assert(isSpreadAcceptable(spreadPrice, riskDist, 0.15), "Spread should be acceptable for this stop distance");

  const friction = calculateSpreadFriction({
    dir: 1,
    entryPrice: stagedLevel.entry,
    slPrice: stagedLevel.sl,
    tpPrice: stagedLevel.tp,
    spread: spreadPrice,
    digits: 5,
  });
  assert(friction.coveredRR > 0, "Covered RR must be positive");
  assert(friction.brokerLevels.entry > stagedLevel.entry, "Buy limit must be front-run to cover ask spread");
  console.log(`✅ PASS: Spread Friction: Nominal ${stagedLevel.targetRR}R -> Covered ${friction.coveredRR}R (drag: ${friction.frictionDragR}R)`);

  // -------------------------------------------------------------------------
  // 4. DUAL-LEG SIZING & COPIER ROUTING
  // -------------------------------------------------------------------------
  console.log("\n--- 4. Testing Dual-Leg Sizing & Magic Encoder Routing ---");
  const spec = {
    point: 0.00001,
    digits: 5,
    trade_tick_value: 1.0,
    trade_tick_size: 0.00001,
    volume_min: 0.01,
    volume_max: 100.0,
    volume_step: 0.01,
    account_currency: "USD",
  };

  const sizing = calculateRiskSize({
    equity: 50000,
    riskPct: 1.0, // 1% = $500
    entryPrice: stagedLevel.entry,
    slPrice: stagedLevel.sl,
    symInfo: spec,
    requirePartials: true,
  });
  assert(sizing.lotSize > 0, "Sized lot size must be > 0");
  assert(sizing.riskUsd > 0 && sizing.riskUsd <= 505, "Monetary risk must match budget");
  console.log(`✅ PASS: Sizing: $500 Risk -> ${sizing.lotSize} Lots on EURUSD`);

  const routingDefault = resolveCopierRouting({
    symbol: "EURUSD",
    canonicalSymbol: "EURUSD",
    scenario,
    tf: "15M",
    modelId: stagedLevel.modelId,
    managementLogic: "milestone_50",
  });
  const routingProp = resolveCopierRouting({
    symbol: "EURUSD",
    canonicalSymbol: "EURUSD",
    scenario,
    tf: "15M",
    modelId: stagedLevel.modelId,
    managementLogic: "prop_firm_safe",
  });
  assert(routingDefault.magicNumber !== routingProp.magicNumber, "Dual legs must have distinct deterministic magic numbers");
  const decodedDef = decodeDecimalMagic(routingDefault.magicNumber);
  const decodedProp = decodeDecimalMagic(routingProp.magicNumber);
  assert.equal(decodedDef.management.key, "milestone_50");
  assert.equal(decodedProp.management.key, "prop_firm_safe");
  console.log(`✅ PASS: Magic Numbers: Leg A=${routingDefault.magicNumber} (MG1) | Leg B=${routingProp.magicNumber} (MG2)`);

  // -------------------------------------------------------------------------
  // 5. RESTING LIMIT INTEGRITY (TICK SURVIVAL & FILL)
  // -------------------------------------------------------------------------
  console.log("\n--- 5. Testing Resting Limit Tick Survival & Entry Fill ---");
  const trade = {
    _id: "trade_eurusd_pipeline_1",
    symbol: "EURUSD",
    canonicalSymbol: "EURUSD",
    dir: 1,
    entryPrice: stagedLevel.entry,
    slPrice: stagedLevel.sl,
    initialSlPrice: stagedLevel.sl,
    tpPrice: stagedLevel.tp,
    targetRR: stagedLevel.targetRR,
    confluenceScore: stagedLevel.confluenceScore,
    status: "armed",
    modelId: stagedLevel.modelId,
    tf: stagedLevel.tf,
    targets: stagedLevel.targets,
    stagedLevel,
    brain: bias.brain,
  };

  // Simulate tick arrival before fill (price waiting above entry)
  const revalResult = await revalidateTradeIdea(trade, {
    mainWatchlistSymbols: ["EURUSD"],
    frames,
    minRR: 2.0,
    minConviction: 50,
  });
  assert.equal(revalResult.vetoes.some(v => v.code === "MODEL_IDENTITY_CHANGED"), false, "Resting limit must not veto with MODEL_IDENTITY_CHANGED");
  assert.equal(revalResult.vetoes.some(v => v.code === "RANGE_CHANGED"), false, "Resting limit must not veto with RANGE_CHANGED");
  assert.equal(revalResult.vetoes.some(v => v.code === "DOL_CHANGED"), false, "Resting limit must not veto with DOL_CHANGED");
  console.log("✅ PASS: Resting limit order safely survived incoming market price ticks without invalidation");

  // -------------------------------------------------------------------------
  // 6. POSITION MANAGEMENT (MILESTONE 50 & PROP-FIRM SAFE)
  // -------------------------------------------------------------------------
  console.log("\n--- 6. Testing Active Trade Management Logic ---");
  const activeTrade = {
    ...trade,
    status: "active",
    initialVolume: 1.0,
    remainingVolume: 1.0,
    initialRiskDistance: riskDist,
    filledPrice: stagedLevel.entry,
    symbolSpec: spec,
    fractionalVolumes: planFractionalVolumes(1.0, spec, 0.40),
  };

  // Test Milestone 50 calculation
  const halfTarget = calculateHalfTargetLevel(activeTrade);
  assert(halfTarget.price > stagedLevel.entry, "Half target price must be higher than entry for buy");
  assert(halfTarget.halfRR > 0, "Half RR must be positive");
  const bePrice = breakevenPrice(activeTrade, spec);
  assert(bePrice >= stagedLevel.entry, "Breakeven price must cover entry + spread buffer");
  console.log(`✅ PASS: Milestone 50 Target @ ${halfTarget.price} (+${halfTarget.halfRR}R) -> Breakeven @ ${bePrice}`);

  // Test Prop-firm Safe Action at 1.5R
  const propTrade = {
    ...trade,
    status: "active",
    managementLogic: "prop_firm_safe",
    initialRiskDistance: riskDist,
    filledPrice: stagedLevel.entry,
    symbolSpec: spec,
    tpPrice: stagedLevel.entry + 2.0 * riskDist,
    targetRR: 2.0,
  };
  const propActionHalf = evaluatePropFirmSafeAction(propTrade, stagedLevel.entry + 1.0 * riskDist, 1.0, spec);
  assert.equal(propActionHalf?.action, "reduce_sl_half", "At 1.0R, prop firm should reduce SL risk in half");

  const propActionBE = evaluatePropFirmSafeAction({ ...propTrade, slHalfMoved: true }, stagedLevel.entry + 1.5 * riskDist, 1.5, spec);
  assert.equal(propActionBE?.action, "breakeven", "At 1.5R, prop firm should move SL to Breakeven");
  console.log("✅ PASS: Prop-Firm Safe actions: 1.0R -> Reduce SL Half | 1.5R -> Breakeven");

  // -------------------------------------------------------------------------
  // 7. JOURNAL NORMALIZATION & KPI DUAL-R TELEMETRY
  // -------------------------------------------------------------------------
  console.log("\n--- 7. Testing Journal Normalization & Dual-R Telemetry ---");
  const rawWinDoc = {
    _id: "trade_win_1",
    symbol: "EURUSD",
    status: "closed_tp",
    outcome: "WIN",
    dir: 1,
    entryPrice: 1.1000,
    slPrice: 1.0950,
    tpPrice: 1.1150,
    realizedR: 2.65,
    idealR: 3.00,
    realizedPnl: 1325,
    closedAt: new Date(),
    managementLogic: "milestone_50",
  };
  const normWin = normalizeJournalRow(rawWinDoc);
  assert.equal(normWin.outcome, "WIN");
  assert.equal(normWin.actualR, 2.65);
  assert.equal(normWin.idealR, 3.0);
  assert.equal(normWin.managementModel, "Default (50% Milestone + Runner)");

  const rawBEDoc = {
    _id: "trade_be_1",
    symbol: "EURUSD",
    status: "closed_be",
    outcome: "BREAKEVEN",
    dir: 1,
    entryPrice: 1.1000,
    slPrice: 1.0950,
    realizedR: 0.05, // within -0.2 to +0.2
    realizedPnl: 25,
    closedAt: new Date(),
    managementLogic: "milestone_50",
  };
  const normBE = normalizeJournalRow(rawBEDoc);
  assert.equal(normBE.outcome, "BREAKEVEN", "0.05R must normalize to BREAKEVEN");
  assert.equal(normBE.idealR, null, "Breakeven trades must not display misleading Ideal R");

  const kpis = calculateJournalKpis([normWin, normBE]);
  assert.equal(kpis.winRate, 100, "Win rate must exclude Breakeven from denominator: 1W / (1W + 0L) = 100%");
  console.log(`✅ PASS: Journal KPIs: WR=${kpis.winRate}% (excluding BE), Win AR=${normWin.actualR}R vs IR=${normWin.idealR}R`);

  console.log("\n=====================================================================");
  console.log("🎯 ALL END-TO-END PIPELINE VERIFICATION TESTS PASSED WITH 100% SUCCESS!");
  console.log("=====================================================================");
}

runFullPipelineVerification().catch((err) => {
  console.error("❌ Full pipeline verification failed:", err);
  process.exit(1);
});
