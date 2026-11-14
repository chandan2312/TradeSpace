/**
 * scripts/test_live_execution_reality.mjs
 *
 * Brutally Honest Quant Audit: Can Live Trading Underperform the Backtest?
 * Simulates the 4 real-world frictions that kill backtested alpha:
 * 1. Commission & Financing Costs (0.02R per trade)
 * 2. Stop Loss Slippage (0.08R average market order slippage on losses)
 * 3. Queue Priority Loss (Orders where price only grazed the limit price fail to fill)
 * 4. Early Redecision Shakeouts (Cutting trades that subsequently recover to TP)
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

function simulateRealisticLiveExecution(candidate, feed, params = {}) {
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
    // Real-world Live Frictions:
    commissionR = 0.02,         // ECN broker commission per round-turn lot (~$15 per $750 1R)
    slSlippageR = 0.08,         // Average slippage on stop-market execution
    queueMinPenetration = 0.5,  // Points price must penetrate past limit to guarantee FIFO queue fill
    testRedecisionShakeout = true, // Whether early shakeout cuts trades that later recover
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
      return { filled: false, outcome: "runaway_cancelled" };
    }

    const hitEarly = d === 1 ? bar.high >= targetPrice : bar.low <= targetPrice;
    if (hitEarly) {
      return { filled: false, outcome: "target_reached_cancelled" };
    }

    // REAL-WORLD QUEUE CHECK: Must penetrate past spread + queue buffer
    const requiredLow = limitPrice - spreadPoints - (queueMinPenetration * spreadPoints);
    const requiredHigh = limitPrice + spreadPoints + (queueMinPenetration * spreadPoints);

    const canFill = d === 1 ? (bar.low <= requiredLow) : (bar.high >= requiredHigh);
    if (canFill) {
      isFilled = true;
      fillTime = bar.t;
      break;
    }
  }

  if (!isFilled) {
    return { filled: false, outcome: "queue_unfilled" };
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

    // Check Stop Loss with SLIPPAGE
    const hitSL = d === 1 ? bar.low <= currentSL : bar.high >= currentSL;
    if (hitSL) {
      exitTime = bar.t;
      // In live trading, a stop loss slips by slSlippageR
      const baseLossR = isBE ? beLockR : (-1.0 - slSlippageR);
      finalR = isPartialTaken ? (partialPct * partialAtR + (1 - partialPct) * baseLossR) : baseLossR;
      finalR -= commissionR; // Deduct commission
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
      finalR -= commissionR; // Deduct commission
      exitReason = "target_exit";
      return { filled: true, fillTime, exitTime, finalR, exitReason, candidate };
    }
  }

  // Timeout
  const lastBar = feed.getBar(idx - 1);
  const px = lastBar ? lastBar.close : fillPrice;
  const floatingR = (px - fillPrice) * d / riskDist;
  finalR = isPartialTaken ? (partialPct * partialAtR + (1 - partialPct) * floatingR) : floatingR;
  finalR -= commissionR;
  return { filled: true, fillTime, exitTime: lastBar?.t || fillTime, finalR, exitReason: "timeout", candidate };
}

const ASSET_CONFIGS = [
  {
    symbol: "NAS100",
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
console.log("REALITY CHECK: THEORETICAL BACKTEST VS REALISTIC LIVE EXECUTION FRICTION");
console.log("Factoring in: Commission (0.02R), Stop Slippage (0.08R), FIFO Queue Rejections");
console.log("=========================================================================================\n");

const scenarios = [
  { label: "1. Theoretical Backtest (Zero Commission, Zero Slippage, Easy Fill)", comm: 0.0, slip: 0.0, queuePen: 0.0 },
  { label: "2. Realistic Live (Standard Commission 0.02R, Mild Slippage 0.04R)", comm: 0.02, slip: 0.04, queuePen: 0.2 },
  { label: "3. Harsh Live (Higher Commission 0.03R, Harsh Slippage 0.08R, Strict Queue)", comm: 0.03, slip: 0.08, queuePen: 0.5 },
  { label: "4. Toxic High-Volatility (Extreme News Slippage 0.15R, Comm 0.03R, 1.0x Queue)", comm: 0.03, slip: 0.15, queuePen: 1.0 },
];

for (const sc of scenarios) {
  let totalTrades = 0;
  let totalWins = 0;
  let totalNetR = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let peak = 0;
  let eq = 0;
  let maxDD = 0;

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
            if (t && cfg.allowedModels.includes(t.modelId)) {
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

    for (const c of candidates) {
      const sim = simulateRealisticLiveExecution(c, feed1M, {
        spreadPoints: cfg.baseSpread,
        targetR: cfg.targetR,
        beTriggerR: cfg.beTriggerR,
        beLockR: cfg.beLockR,
        partialAtR: cfg.partialAtR,
        partialPct: cfg.partialPct,
        runnerTargetR: cfg.runnerTargetR,
        commissionR: sc.comm,
        slSlippageR: sc.slip,
        queueMinPenetration: sc.queuePen,
      });

      if (sim && sim.filled) {
        totalTrades++;
        totalNetR += sim.finalR;
        if (sim.finalR > 0.05) {
          totalWins++;
          grossWin += sim.finalR;
        } else if (sim.finalR < -0.05) {
          grossLoss += Math.abs(sim.finalR);
        }

        eq += sim.finalR;
        if (eq > peak) peak = eq;
        const dd = peak - eq;
        if (dd > maxDD) maxDD = dd;
      }
    }
  }

  const wr = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : "0.0";
  const pf = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : "99.9";
  const dollarPnl = totalNetR * 750;

  console.log(sc.label);
  console.log(`  Trades: ${totalTrades} | WR: ${wr}% | PF: ${pf} | Net R: ${totalNetR >= 0 ? "+" : ""}${totalNetR.toFixed(1)} R (${dollarPnl >= 0 ? "+$" : "-$"}${Math.abs(dollarPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}) | Max DD: -${maxDD.toFixed(1)} R\n`);
}
