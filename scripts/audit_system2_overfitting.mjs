/**
 * scripts/audit_system2_overfitting.mjs
 *
 * Forensic Overfitting & Robustness Audit for System #2
 * 1. Walk-Forward / Out-of-Sample Partitioning (In-Sample: 2021-2023 vs Out-of-Sample: 2024-2026)
 * 2. Parameter Sensitivity & Cliff Testing (Target R, BE Trigger, Partial %)
 * 3. Spread & Slippage Toxicity Stress Test (1.0x, 1.5x, 2.0x spread)
 * 4. Model Selection Bias Verification (Does edge exist per-asset in-sample first?)
 */

import fs from "fs";
import path from "path";
import { AutonomousQuantEngine } from "../lib/autonomous_system2/index.js";

class FastFeed {
  constructor(binPath, name) {
    this.name = name;
    this.buffer = fs.readFileSync(binPath);
    this.barSize = 24;
    this.totalBars = Math.floor(this.buffer.length / this.barSize);
  }

  getBar(index) {
    if (index < 0 || index >= this.totalBars) return null;
    const offset = index * this.barSize;
    return {
      t: Number(this.buffer.readBigUInt64LE(offset)),
      open: this.buffer.readFloatLE(offset + 8),
      high: this.buffer.readFloatLE(offset + 12),
      low: this.buffer.readFloatLE(offset + 16),
      close: this.buffer.readFloatLE(offset + 20),
    };
  }

  findIndex(targetTime) {
    let low = 0;
    let high = this.totalBars - 1;
    let ans = -1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const t = Number(this.buffer.readBigUInt64LE(mid * this.barSize));
      if (t >= targetTime) {
        ans = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return ans;
  }
}

function simulate1MExecution(candidate, feed, params = {}) {
  const {
    spreadPoints = 1.0,
    targetR = 2.5,
    beTriggerR = 1.2,
    beLockR = 0.2,
    partialAtR = 2.0,
    partialPct = 0.5,
    runnerTargetR = 4.0,
    maxPendingBars = 180,
    maxHoldMinutes = 2880,
  } = params;

  const level = candidate.candidateLevel;
  if (!level) return null;

  const d = candidate.dir;
  const limitPrice = level.entry;
  const slPrice = level.stopLoss;
  const riskDist = Math.abs(limitPrice - slPrice);
  if (riskDist <= 0) return null;

  const beTriggerPrice = d === 1 ? limitPrice + beTriggerR * riskDist : limitPrice - beTriggerR * riskDist;
  const beLockPrice = d === 1 ? limitPrice + beLockR * riskDist : limitPrice - beLockR * riskDist;
  const targetPrice = d === 1 ? limitPrice + targetR * riskDist : limitPrice - targetR * riskDist;
  const partialPrice = partialAtR ? (d === 1 ? limitPrice + partialAtR * riskDist : limitPrice - partialAtR * riskDist) : null;
  const runnerPrice = runnerTargetR ? (d === 1 ? limitPrice + runnerTargetR * riskDist : limitPrice - runnerTargetR * riskDist) : null;
  const maxRunawayDist = 1.5 * riskDist;

  const startT = candidate.t + 900;
  let idx = feed.findIndex(startT);
  if (idx < 0) return null;

  let isFilled = false;
  let fillPrice = limitPrice;
  let fillTime = 0;

  for (let step = 0; step < maxPendingBars && idx < feed.totalBars; step++, idx++) {
    const bar = feed.getBar(idx);
    if (!bar) break;

    const moveInDir = d === 1 ? (bar.high - candidate.currentPrice) : (candidate.currentPrice - bar.low);
    if (moveInDir >= maxRunawayDist) {
      return { filled: false, outcome: "runaway_cancelled", candidate };
    }

    const hitEarly = d === 1 ? bar.high >= targetPrice : bar.low <= targetPrice;
    if (hitEarly) {
      return { filled: false, outcome: "target_reached_cancelled", candidate };
    }

    const canFill = d === 1 ? (bar.low <= limitPrice - spreadPoints) : (bar.high >= limitPrice + spreadPoints);
    if (canFill) {
      isFilled = true;
      fillTime = bar.t;
      break;
    }
  }

  if (!isFilled) {
    return { filled: false, outcome: "pending_expired", candidate };
  }

  let isBE = false;
  let isPartialTaken = false;
  let currentSL = slPrice;
  let finalR = 0;
  let exitTime = 0;
  let exitReason = "";

  for (let step = 1; step <= maxHoldMinutes && idx < feed.totalBars; step++, idx++) {
    const bar = feed.getBar(idx);
    if (!bar) break;

    // Check Stop Loss
    const hitSL = d === 1 ? bar.low <= currentSL : bar.high >= currentSL;
    if (hitSL) {
      exitTime = bar.t;
      const lossR = isBE ? beLockR : -1.0;
      finalR = isPartialTaken ? (partialPct * partialAtR + (1 - partialPct) * lossR) : lossR;
      exitReason = isBE ? "be_exit" : "sl_exit";
      return { filled: true, fillTime, exitTime, finalR, exitReason, candidate };
    }

    // Check BE Trigger
    const hitBE = d === 1 ? bar.high >= beTriggerPrice : bar.low <= beTriggerPrice;
    if (hitBE && !isBE) {
      isBE = true;
      currentSL = beLockPrice;
    }

    // Check Partial Target
    if (partialPrice && !isPartialTaken) {
      const hitPartial = d === 1 ? bar.high >= partialPrice : bar.low <= partialPrice;
      if (hitPartial) {
        isPartialTaken = true;
        isBE = true;
        currentSL = beLockPrice;
      }
    }

    // Check Runner / Full Target
    const hitTarget = partialPrice
      ? (d === 1 ? bar.high >= runnerPrice : bar.low <= runnerPrice)
      : (d === 1 ? bar.high >= targetPrice : bar.low <= targetPrice);

    if (hitTarget) {
      exitTime = bar.t;
      finalR = partialPrice ? (partialPct * partialAtR + (1 - partialPct) * runnerTargetR) : targetR;
      exitReason = "target_exit";
      return { filled: true, fillTime, exitTime, finalR, exitReason, candidate };
    }
  }

  const lastBar = feed.getBar(idx - 1);
  const px = lastBar ? lastBar.close : fillPrice;
  const floatingR = (px - fillPrice) * d / riskDist;
  finalR = isPartialTaken ? (partialPct * partialAtR + (1 - partialPct) * floatingR) : floatingR;
  return { filled: true, fillTime, exitTime: lastBar?.t || fillTime, finalR, exitReason: "timeout", candidate };
}

const ASSET_CONFIGS = [
  {
    symbol: "NAS100",
    name: "Nasdaq 100 Index",
    feedPath: "quant_service/data/nas100_1m.bin",
    data15M: "quant_service/data/nas100_15m.json",
    baseSpread: 1.5,
    minSlPoints: 30.0,
    maxSlPoints: 140.0,
    targetR: 2.5,
    beTriggerR: 1.2,
    beLockR: 0.2,
    partialAtR: 2.0,
    partialPct: 0.5,
    runnerTargetR: 4.0,
    allowedModels: ["MODEL_INITIATIVE_VALUE_RETEST", "MODEL_IB_FAILED_AUCTION_TRAP"],
  },
  {
    symbol: "GER40",
    name: "DAX 40 Index",
    feedPath: "quant_service/data/ger40_1m.bin",
    data15M: "quant_service/data/ger40_15m.json",
    baseSpread: 2.0,
    minSlPoints: 25.0,
    maxSlPoints: 130.0,
    targetR: 2.5,
    beTriggerR: 1.2,
    beLockR: 0.2,
    partialAtR: 2.0,
    partialPct: 0.5,
    runnerTargetR: 4.0,
    allowedModels: ["MODEL_INITIATIVE_VALUE_RETEST"],
  },
  {
    symbol: "XAUUSD",
    name: "Gold / US Dollar",
    feedPath: "quant_service/data/xauusd_1m.bin",
    data15M: "quant_service/data/xauusd_15m.json",
    baseSpread: 0.30,
    minSlPoints: 4.0,
    maxSlPoints: 25.0,
    targetR: 2.5,
    beTriggerR: 1.2,
    beLockR: 0.2,
    partialAtR: 2.0,
    partialPct: 0.5,
    runnerTargetR: 3.5,
    allowedModels: ["STEIDLMAYER_80_PERCENT_RULE"],
  },
  {
    symbol: "EURUSD",
    name: "Euro / US Dollar",
    feedPath: "quant_service/data/eurusd_1m.bin",
    data15M: "quant_service/data/eurusd_15m.json",
    baseSpread: 0.00010,
    minSlPoints: 0.0006,
    maxSlPoints: 0.0035,
    targetR: 2.0,
    beTriggerR: 1.0,
    beLockR: 0.1,
    partialAtR: 1.8,
    partialPct: 0.5,
    runnerTargetR: 3.0,
    allowedModels: ["STEIDLMAYER_80_PERCENT_RULE"],
  },
];

console.log("=========================================================================================");
console.log("FORENSIC OVERFITTING & ROBUSTNESS STRESS TEST AUDIT FOR SYSTEM #2");
console.log("=========================================================================================\n");

// Phase 1: Extract all candidates once per asset
const allAssetData = [];

for (const cfg of ASSET_CONFIGS) {
  if (!fs.existsSync(cfg.feedPath) || !fs.existsSync(cfg.data15M)) continue;
  const feed1M = new FastFeed(cfg.feedPath, cfg.symbol);
  const raw15M = JSON.parse(fs.readFileSync(cfg.data15M, "utf-8"));

  const engine = new AutonomousQuantEngine({
    spreadPts: cfg.baseSpread,
    minSlPoints: cfg.minSlPoints,
    maxSlPoints: cfg.maxSlPoints,
    accountBalance: 100000,
  });

  const candidates = [];
  for (let i = 0; i < raw15M.length; i++) {
    const bar = raw15M[i];
    const res = engine.onBar(bar);
    if (res && res.stepActions) {
      for (const act of res.stepActions) {
        if (act.type === "OPEN_POSITION") {
          const t = engine.activeTrades.find((at) => at.id === act.tradeId);
          if (t) {
            candidates.push({
              t: bar.t ?? bar.time,
              dir: t.direction,
              currentPrice: bar.close ?? bar.c,
              modelId: t.modelId,
              candidateLevel: {
                entry: t.entryPrice,
                stopLoss: t.initialStopLoss,
                takeProfit: t.targets.tp2.price,
                tp1: t.targets.tp1.price,
                tp2: t.targets.tp2.price,
                confluenceScore: t.confluenceScore,
              },
            });
          }
        }
      }
    }
  }

  allAssetData.push({ cfg, feed1M, candidates });
}

// -------------------------------------------------------------------------
// TEST 1: STRICT IN-SAMPLE (2021-2023) VS OUT-OF-SAMPLE (2024-2026) PER MODEL
// -------------------------------------------------------------------------
console.log("=========================================================================================");
console.log("TEST 1: MODEL-BY-MODEL IN-SAMPLE (2021-2023) VS OUT-OF-SAMPLE (2024-2026) AUDIT");
console.log("Checking if positive expectancy existed In-Sample BEFORE Out-of-Sample verification");
console.log("=========================================================================================");
console.log(
  "Symbol".padEnd(8) +
  "Model".padEnd(32) +
  "IS Trades".padStart(10) +
  "IS Net R".padStart(10) +
  "IS PF".padStart(8) +
  "OOS Trades".padStart(12) +
  "OOS Net R".padStart(11) +
  "OOS PF".padStart(9) +
  "Degradation Status".padStart(20)
);
console.log("-".repeat(120));

for (const { cfg, feed1M, candidates } of allAssetData) {
  const models = [...new Set(candidates.map((c) => c.modelId))];

  for (const mId of models) {
    const modelCandidates = candidates.filter((c) => c.modelId === mId);

    const isSims = [];
    const oosSims = [];

    for (const c of modelCandidates) {
      const yr = new Date(c.t * 1000).getUTCFullYear();
      const sim = simulate1MExecution(c, feed1M, {
        spreadPoints: cfg.baseSpread,
        targetR: cfg.targetR,
        beTriggerR: cfg.beTriggerR,
        beLockR: cfg.beLockR,
        partialAtR: cfg.partialAtR,
        partialPct: cfg.partialPct,
        runnerTargetR: cfg.runnerTargetR,
      });

      if (sim && sim.filled) {
        if (yr < 2024) isSims.push(sim);
        else oosSims.push(sim);
      }
    }

    const computeMetrics = (sims) => {
      const totalR = sims.reduce((acc, s) => acc + s.finalR, 0);
      const wins = sims.filter((s) => s.finalR > 0.05);
      const losses = sims.filter((s) => s.finalR < -0.05);
      const grossWin = wins.reduce((acc, s) => acc + s.finalR, 0);
      const grossLoss = Math.abs(losses.reduce((acc, s) => acc + s.finalR, 0));
      const pf = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : grossWin > 0 ? "99.9" : "0.00";
      return { count: sims.length, netR: totalR, pf };
    };

    const is = computeMetrics(isSims);
    const oos = computeMetrics(oosSims);

    let status = "INCONSISTENT";
    if (is.netR > 0 && oos.netR > 0) status = "ROBUST (IS + OOS)";
    else if (is.netR <= 0 && oos.netR > 0) status = "OOS EMERGENCE";
    else if (is.netR > 0 && oos.netR <= 0) status = "OVERFITTED DECAY";
    else status = "NEGATIVE EXPECTANCY";

    console.log(
      cfg.symbol.padEnd(8) +
      mId.padEnd(32) +
      is.count.toString().padStart(10) +
      `${is.netR >= 0 ? "+" : ""}${is.netR.toFixed(1)}R`.padStart(10) +
      is.pf.padStart(8) +
      oos.count.toString().padStart(12) +
      `${oos.netR >= 0 ? "+" : ""}${oos.netR.toFixed(1)}R`.padStart(11) +
      oos.pf.padStart(9) +
      status.padStart(20)
    );
  }
}

// -------------------------------------------------------------------------
// TEST 2: PARAMETER SENSITIVITY & CLIFF AUDIT (SURFACE ANALYSIS)
// -------------------------------------------------------------------------
console.log("\n=========================================================================================");
console.log("TEST 2: PARAMETER PERTURBATION & CLIFF AUDIT (PORTFOLIO WIDE)");
console.log("Varying Target R, Breakeven Trigger, and Partial R by +/- 20% to check for parameter cliffs");
console.log("=========================================================================================");
console.log(
  "Test Configuration".padEnd(45) +
  "Total Trades".padStart(14) +
  "Win Rate".padStart(10) +
  "Net Return (R)".padStart(16) +
  "PF".padStart(8) +
  "Result".padStart(15)
);
console.log("-".repeat(110));

const PERTURBATION_CONFIGS = [
  { label: "BASELINE (Target 2.5R, BE 1.2R, Partial 2.0R)", targetMult: 1.0, beMult: 1.0, partialMult: 1.0 },
  { label: "CONSERVATIVE TARGET (Target -20%: 2.0R, BE 1.0R)", targetMult: 0.8, beMult: 0.83, partialMult: 0.85 },
  { label: "AGGRESSIVE TARGET (Target +20%: 3.0R, BE 1.5R)", targetMult: 1.2, beMult: 1.25, partialMult: 1.15 },
  { label: "LATE BREAKEVEN (BE Trigger +25%: 1.5R)", targetMult: 1.0, beMult: 1.25, partialMult: 1.0 },
  { label: "EARLY BREAKEVEN (BE Trigger -25%: 0.9R)", targetMult: 1.0, beMult: 0.75, partialMult: 1.0 },
  { label: "NO PARTIAL (Full 100% Exit at 2.5R Target)", targetMult: 1.0, beMult: 1.0, partialPct: 0.0 },
];

for (const p of PERTURBATION_CONFIGS) {
  let portTrades = 0;
  let portNetR = 0;
  let portWins = 0;
  let grossWin = 0;
  let grossLoss = 0;

  for (const { cfg, feed1M, candidates } of allAssetData) {
    const allowed = candidates.filter((c) => cfg.allowedModels.includes(c.modelId));
    const targetR = cfg.targetR * p.targetMult;
    const beTriggerR = cfg.beTriggerR * p.beMult;
    const partialAtR = cfg.partialAtR * (p.partialMult ?? 1.0);
    const partialPct = p.partialPct !== undefined ? p.partialPct : cfg.partialPct;

    for (const c of allowed) {
      const sim = simulate1MExecution(c, feed1M, {
        spreadPoints: cfg.baseSpread,
        targetR,
        beTriggerR,
        beLockR: cfg.beLockR,
        partialAtR,
        partialPct,
        runnerTargetR: cfg.runnerTargetR,
      });

      if (sim && sim.filled) {
        portTrades++;
        portNetR += sim.finalR;
        if (sim.finalR > 0.05) {
          portWins++;
          grossWin += sim.finalR;
        } else if (sim.finalR < -0.05) {
          grossLoss += Math.abs(sim.finalR);
        }
      }
    }
  }

  const wr = portTrades > 0 ? ((portWins / portTrades) * 100).toFixed(1) : "0.0";
  const pf = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : "99.9";
  const status = portNetR > 40 ? "✅ ROBUST ZONE" : portNetR > 0 ? "⚠️ MARGINAL" : "❌ COLLAPSE";

  console.log(
    p.label.padEnd(45) +
    portTrades.toString().padStart(14) +
    `${wr}%`.padStart(10) +
    `${portNetR >= 0 ? "+" : ""}${portNetR.toFixed(1)}R`.padStart(16) +
    pf.padStart(8) +
    status.padStart(15)
  );
}

// -------------------------------------------------------------------------
// TEST 3: FRICTION & SLIPPAGE TOXICITY STRESS TEST
// -------------------------------------------------------------------------
console.log("\n=========================================================================================");
console.log("TEST 3: EXECUTION FRICTION & SPREAD TOXICITY STRESS TEST");
console.log("Testing spread degradation: 1.0x (normal), 1.5x (stressed), 2.0x (extreme toxic flow)");
console.log("=========================================================================================");
console.log(
  "Spread Multiplier".padEnd(30) +
  "Filled Trades".padStart(15) +
  "Win Rate".padStart(10) +
  "Net Return (R)".padStart(16) +
  "PF".padStart(8) +
  "Expectancy Status".padStart(20)
);
console.log("-".repeat(100));

const SPREAD_MULTS = [1.0, 1.25, 1.5, 1.75, 2.0];

for (const sm of SPREAD_MULTS) {
  let portTrades = 0;
  let portNetR = 0;
  let portWins = 0;
  let grossWin = 0;
  let grossLoss = 0;

  for (const { cfg, feed1M, candidates } of allAssetData) {
    const allowed = candidates.filter((c) => cfg.allowedModels.includes(c.modelId));
    const spreadPoints = cfg.baseSpread * sm;

    for (const c of allowed) {
      const sim = simulate1MExecution(c, feed1M, {
        spreadPoints,
        targetR: cfg.targetR,
        beTriggerR: cfg.beTriggerR,
        beLockR: cfg.beLockR,
        partialAtR: cfg.partialAtR,
        partialPct: cfg.partialPct,
        runnerTargetR: cfg.runnerTargetR,
      });

      if (sim && sim.filled) {
        portTrades++;
        portNetR += sim.finalR;
        if (sim.finalR > 0.05) {
          portWins++;
          grossWin += sim.finalR;
        } else if (sim.finalR < -0.05) {
          grossLoss += Math.abs(sim.finalR);
        }
      }
    }
  }

  const wr = portTrades > 0 ? ((portWins / portTrades) * 100).toFixed(1) : "0.0";
  const pf = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : "99.9";
  const status = portNetR > 50 ? "✅ EXTREMELY RESILIENT" : portNetR > 0 ? "⚠️ ABSORBABLE" : "❌ UNPROFITABLE";

  console.log(
    `${sm.toFixed(2)}x Spread (${sm === 1.0 ? "Baseline" : sm === 2.0 ? "Severe Stress" : "Elevated"})`.padEnd(30) +
    portTrades.toString().padStart(15) +
    `${wr}%`.padStart(10) +
    `${portNetR >= 0 ? "+" : ""}${portNetR.toFixed(1)}R`.padStart(16) +
    pf.padStart(8) +
    status.padStart(20)
  );
}

console.log("=========================================================================================\n");
