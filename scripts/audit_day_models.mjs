import { SCENARIOS } from "../lib/autonomous/scenarios.js";
import { ENTRY_MODEL_DEFINITIONS, evaluateAllEntryModels, evaluateExecutionVetoes, symbolUnits } from "../lib/autonomous/models.js";
import { calculateStructuralStopLoss, auditStopLossIntegrity } from "../lib/autonomous/slEngine.js";
import { evaluateEntryModelDecisionEngine } from "../lib/autonomous/entryDecisionEngine.js";
import { calculateRiskSize, lossPerLotAtStop, planPartialVolumes } from "../lib/autonomous/risk.js";
import { calculateOptimalRiskFreeLevel, resolveMasterBiasTargetLevels, validateTargetLadder } from "../lib/autonomous/management.js";

console.log("=== AUDITING DAY TRADE MODEL ONLY (4H-15M) ===");
const scenario = SCENARIOS.DAY;
console.log("Scenario:", scenario.id, "| Macro:", scenario.macroTf, "| Trigger:", scenario.triggerTf, "| MinRR:", scenario.minRR);

// Create synthetic but realistic 15M, 1H, 4H, D1 bars for NAS100
const now = new Date("2026-11-06T10:30:00Z").getTime(); // 10:30 UTC = 12:30 EET (London session)

function createMockFrames(basePrice = 20000) {
  const m15 = [];
  const h1 = [];
  const h4 = [];
  const d1 = [];

  // Generate 100 15M bars
  let cur = basePrice;
  const startM15 = now - 100 * 900 * 1000;
  for (let i = 0; i < 100; i++) {
    const t = Math.floor((startM15 + i * 900 * 1000) / 1000);
    const o = cur;
    const h = o + 15;
    const l = o - 15;
    const c = o + (i % 2 === 0 ? 5 : -5);
    cur = c;
    m15.push({ time: t, open: o, high: h, low: l, close: c, volume: 100 });
  }

  // Generate H1 bars
  for (let i = 0; i < 25; i++) {
    const chunk = m15.slice(i * 4, (i + 1) * 4);
    if (!chunk.length) continue;
    h1.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map(b => b.high)),
      low: Math.min(...chunk.map(b => b.low)),
      close: chunk.at(-1).close,
      volume: 400
    });
  }

  // Generate H4 bars
  for (let i = 0; i < 6; i++) {
    const chunk = h1.slice(i * 4, (i + 1) * 4);
    if (!chunk.length) continue;
    h4.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map(b => b.high)),
      low: Math.min(...chunk.map(b => b.low)),
      close: chunk.at(-1).close,
      volume: 1600
    });
  }

  // Generate D1 bars (3 days)
  d1.push({
    time: Math.floor((now - 86400000 * 2) / 1000),
    open: basePrice - 100,
    high: basePrice + 50,
    low: basePrice - 150,
    close: basePrice - 20,
    volume: 10000
  });
  d1.push({
    time: Math.floor((now - 86400000) / 1000),
    open: basePrice - 20,
    high: basePrice + 80,
    low: basePrice - 60,
    close: basePrice + 40,
    volume: 12000
  });
  d1.push({
    time: Math.floor(now / 1000),
    open: basePrice + 40,
    high: basePrice + 120,
    low: basePrice - 30,
    close: basePrice + 50,
    volume: 5000
  });

  return { M15: m15, H1: h1, H4: h4, D1: d1 };
}

const frames = createMockFrames(20500);

const brain = {
  macroDir: 1,
  macroBias: "BULLISH",
  allowedToLong: true,
  allowedToShort: false,
  action: "READY_TO_BUY",
  verdict: "BULLISH_EXPANSION",
  targetDOL: {
    id: "dol_macro",
    price: 20750,
    targetSide: "BSL",
    direction: 1,
    side: 1,
    causal: true,
    state: "UNCONSUMED",
    name: "H4 Liquidity Pool BSL",
    tf: "H4"
  },
  dealingRange: {
    high: 20750,
    low: 20400,
    eq: 20575,
    coveragePct: 40
  },
  smtEvidence: [
    { dir: 1, confirmed: true, partner: "US500", divergenceType: "BULLISH_SMT" }
  ]
};

const ranges = {
  H4: brain.dealingRange,
  H1: { high: 20650, low: 20450, eq: 20550, coveragePct: 45 }
};

const config = {
  scenario,
  symbol: "NAS100",
  now,
  minRR: 2.0,
  spreadPrice: 1.5,
  riskPerTradePct: 1.0,
  accountSize: 50000
};

console.log("\n--- Testing Model Evaluation under Day Trade Scenario ---");
const modelsResult = evaluateAllEntryModels({
  symbol: "NAS100",
  dir: 1,
  scenario,
  frames,
  ranges,
  targetDOL: brain.targetDOL,
  config,
  brain
});

console.log("Models result:", modelsResult ? `Winner: ${modelsResult.modelId} | Entry: ${modelsResult.entry} | SL: ${modelsResult.sl} | TP: ${modelsResult.tp}` : "None generated on pure synthetic range");

console.log("\n--- Testing slEngine Anchor Resolution for ALL 10 Models ---");
const modelsToTest = [
  "ict_2022", "turtle_soup", "breaker_block", "ote_continuation", "silver_bullet",
  "displacement_breakout", "judas_swing", "smt_divergence_sweep", "fvg_rejection", "po3_daily_cycle"
];

for (const mId of modelsToTest) {
  const entry = 20520;
  const extreme = 20480;
  const zoneLow = 20500;
  const zoneHigh = 20540;
  const evidence = {
    raid: { extreme: 20475, levelPrice: 20490 },
    displacement: { valid: true, bodyRatio: 0.7 },
    mss: { brokenPivot: { price: 20530 } },
    fvg: { top: 20530, bottom: 20510, ce: 20520 },
    origin: 20485,
    judasLevel: 20495,
    smtEvidence: { dir: 1, confirmed: true },
    dailyOpen: 20505,
    manipulationExtreme: 20470,
    impulse: { high: { price: 20550 }, low: { price: 20480 }, brokenPivot: { price: 20530 } },
    chosenPda: { bottom: 20500, top: 20530, ce: 20515, kind: "FVG" }
  };

  const slRes = calculateStructuralStopLoss({
    dir: 1,
    entry,
    modelId: mId,
    zoneLow,
    zoneHigh,
    extreme,
    evidence,
    scenario,
    frames,
    ranges,
    brain,
    symbol: "NAS100",
    config,
    tf: "M15"
  });

  const audit = auditStopLossIntegrity({
    dir: 1,
    entry,
    sl: slRes?.sl,
    symbol: "NAS100",
    currentPrice: 20525,
    scenario,
    config: { ...config, candidate: { structuralStop: true, evidence, slAudit: slRes } },
    spreadPrice: 1.5
  });

  console.log(`[${mId.padEnd(22)}] SL: ${slRes?.sl} | Risk: ${slRes?.riskDistance} pts | Anchor: ${slRes?.anchorType} (${slRes?.anchorPrice}) | NoiseFree: ${slRes?.isNoiseFree} | Audit Pass: ${audit.pass} ${audit.vetoes.length ? JSON.stringify(audit.vetoes) : ""}`);
}
