/**
 * scripts/backtest_system2_proper.mjs
 *
 * Multi-Asset Institutional 1-Minute High-Resolution Backtester for System #2
 * Replays System #2 candidate setups through true tick-resolution binary feeds (1m.bin).
 * Assets with available 1M feeds: NAS100, GER40, XAUUSD, EURUSD.
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
    console.log(`Loaded 1M binary feed for ${name}: ${this.totalBars.toLocaleString()} bars (${(this.buffer.length / (1024 * 1024)).toFixed(1)} MB)`);
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
    maxPendingBars = 180, // 3 hours
    maxHoldMinutes = 2880, // 48 hours
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

  // Timeout
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
    spreadPoints: 1.5,
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
    spreadPoints: 2.0,
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
    spreadPoints: 0.30,
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
    spreadPoints: 0.00010,
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
console.log("SYSTEM #2: MULTI-ASSET PROPER 1-MINUTE HIGH-RESOLUTION BENCHMARK");
console.log("Simulating Real Limit Order Fill Penetration & 1-Minute Intra-Bar Tracking");
console.log("=========================================================================================\n");

const summaryResults = [];
let portfolioTotalR = 0;
let portfolioTrades = 0;
const allPortfolioTrades = [];

for (const cfg of ASSET_CONFIGS) {
  if (!fs.existsSync(cfg.feedPath) || !fs.existsSync(cfg.data15M)) {
    console.warn(`[WARN] Skipping ${cfg.symbol}: missing data files.`);
    continue;
  }

  process.stdout.write(`\nBenchmarking ${cfg.symbol.padEnd(8)} (${cfg.name})...\n`);
  const t0 = Date.now();

  const feed1M = new FastFeed(cfg.feedPath, cfg.symbol);
  const raw15M = JSON.parse(fs.readFileSync(cfg.data15M, "utf8"));

  const engine = new AutonomousQuantEngine({
    spreadPts: cfg.spreadPoints,
    minSlPoints: cfg.minSlPoints,
    maxSlPoints: cfg.maxSlPoints,
    accountBalance: 100000,
    riskPerTradePct: 0.75,
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
            if (cfg.allowedModels && !cfg.allowedModels.includes(t.modelId)) {
              continue;
            }
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

  const results = [];
  let fillCount = 0;
  const modelStats = {};
  const exitStats = { target_exit: 0, sl_exit: 0, be_exit: 0, timeout: 0 };

  for (const c of candidates) {
    const sim = simulate1MExecution(c, feed1M, {
      spreadPoints: cfg.spreadPoints,
      targetR: cfg.targetR,
      beTriggerR: cfg.beTriggerR,
      beLockR: cfg.beLockR,
      partialAtR: cfg.partialAtR,
      partialPct: cfg.partialPct,
      runnerTargetR: cfg.runnerTargetR,
    });

    if (sim && sim.filled) {
      fillCount++;
      sim.asset = cfg.symbol;
      results.push(sim);
      allPortfolioTrades.push(sim);

      const mId = c.modelId || "UNKNOWN";
      if (!modelStats[mId]) {
        modelStats[mId] = { count: 0, wins: 0, losses: 0, totalR: 0, grossWin: 0, grossLoss: 0 };
      }
      modelStats[mId].count++;
      modelStats[mId].totalR += sim.finalR;
      if (sim.finalR > 0.05) {
        modelStats[mId].wins++;
        modelStats[mId].grossWin += sim.finalR;
      } else if (sim.finalR < -0.05) {
        modelStats[mId].losses++;
        modelStats[mId].grossLoss += Math.abs(sim.finalR);
      }

      if (exitStats[sim.exitReason] !== undefined) {
        exitStats[sim.exitReason]++;
      }
    }
  }

  let wins = 0;
  let losses = 0;
  let bes = 0;
  let totalR = 0;
  let peakR = 0;
  let maxDDR = 0;
  let grossWinR = 0;
  let grossLossR = 0;

  for (const t of results) {
    const r = t.finalR;
    totalR += r;
    if (r > 0.05) {
      wins++;
      grossWinR += r;
    } else if (r < -0.05) {
      losses++;
      grossLossR += Math.abs(r);
    } else {
      bes++;
    }

    if (totalR > peakR) peakR = totalR;
    const dd = peakR - totalR;
    if (dd > maxDDR) maxDDR = dd;
  }

  const durationMs = Date.now() - t0;
  const winRate = results.length > 0 ? ((wins / results.length) * 100).toFixed(1) : "0.0";
  const pf = grossLossR > 0 ? (grossWinR / grossLossR).toFixed(2) : "99.9";
  const netDollarPnl = totalR * 750; // $750 per 1R on $100K account

  portfolioTotalR += totalR;
  portfolioTrades += results.length;

  const resObj = {
    symbol: cfg.symbol,
    name: cfg.name,
    candidates: candidates.length,
    filled: results.length,
    fillRate: ((results.length / candidates.length) * 100).toFixed(1),
    wins,
    losses,
    bes,
    winRate,
    pf,
    totalR: Math.round(totalR * 100) / 100,
    netDollarPnl: Math.round(netDollarPnl * 100) / 100,
    maxDDR: Math.round(maxDDR * 100) / 100,
    durationMs,
    modelStats,
    exitStats,
  };
  summaryResults.push(resObj);

  console.log(`Results for ${cfg.symbol}:`);
  console.log(`  Staged: ${resObj.candidates} | Filled: ${resObj.filled} (${resObj.fillRate}%) | Wins: ${wins} (${winRate}%) | Losses: ${losses} | BE: ${bes}`);
  console.log(`  PF: ${pf} | Net Return: ${totalR >= 0 ? "+" : ""}${totalR.toFixed(2)} R (${netDollarPnl >= 0 ? "+$" : "-$"}${Math.abs(netDollarPnl).toLocaleString()}) | Max DD: -${maxDDR.toFixed(2)} R`);
  console.log(`  Exit Breakdown: Target: ${exitStats.target_exit} | SL: ${exitStats.sl_exit} | BE: ${exitStats.be_exit} | Timeout: ${exitStats.timeout}`);
  console.log(`  Model Breakdown:`);
  for (const [mId, s] of Object.entries(modelStats)) {
    const mPf = s.grossLoss > 0 ? (s.grossWin / s.grossLoss).toFixed(2) : "N/A";
    const mWr = s.count > 0 ? ((s.wins / s.count) * 100).toFixed(1) : "0";
    console.log(`    - ${mId.padEnd(32)}: Trades: ${String(s.count).padStart(3)} | WR: ${mWr.padStart(5)}% | PF: ${mPf.padStart(5)} | Net R: ${s.totalR >= 0 ? "+" : ""}${s.totalR.toFixed(2)} R`);
  }
}

console.log("\n=========================================================================================");
console.log("PROPER 1-MINUTE HIGH-RESOLUTION BENCHMARK SUMMARY TABLE");
console.log("=========================================================================================");
console.log(
  "Symbol".padEnd(8) +
  "Staged".padStart(8) +
  "Filled".padStart(8) +
  "Fill%".padStart(8) +
  "WinRate".padStart(9) +
  "PF".padStart(7) +
  "Net R".padStart(10) +
  "Net PnL ($)".padStart(15) +
  "Max DD (R)".padStart(12)
);
console.log("-".repeat(85));

for (const r of summaryResults) {
  const pnlStr = (r.netDollarPnl >= 0 ? "+$" : "-$") + Math.abs(r.netDollarPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  console.log(
    r.symbol.padEnd(8) +
    r.candidates.toString().padStart(8) +
    r.filled.toString().padStart(8) +
    `${r.fillRate}%`.padStart(8) +
    `${r.winRate}%`.padStart(9) +
    r.pf.padStart(7) +
    `${r.totalR >= 0 ? "+" : ""}${r.totalR.toFixed(1)}R`.padStart(10) +
    pnlStr.padStart(15) +
    `-${r.maxDDR.toFixed(1)}R`.padStart(12)
  );
}
console.log("-".repeat(85));
const totalPnlDollars = portfolioTotalR * 750;
const totalPnlStr = (totalPnlDollars >= 0 ? "+$" : "-$") + Math.abs(totalPnlDollars).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
console.log(
  "PORTFOLIO".padEnd(8) +
  "".padStart(8) +
  portfolioTrades.toString().padStart(8) +
  "".padStart(8) +
  "".padStart(9) +
  "".padStart(7) +
  `${portfolioTotalR >= 0 ? "+" : ""}${portfolioTotalR.toFixed(1)}R`.padStart(10) +
  totalPnlStr.padStart(15)
);
console.log("=========================================================================================\n");

console.log("=========================================================================================");
console.log("PORTFOLIO YEAR-BY-YEAR PERFORMANCE AUDIT (COMBINED 4 ASSETS)");
console.log("=========================================================================================");
console.log("Year    Period         Trades   Win Rate    PF      Net R      Net PnL ($)   Max DD   Result");
console.log("-----------------------------------------------------------------------------------------");

allPortfolioTrades.sort((a, b) => a.fillTime - b.fillTime);

const years = ["2021", "2022", "2023", "2024", "2025", "2026"];
for (const yr of years) {
  const yrTrades = allPortfolioTrades.filter(t => {
    const d = new Date(t.fillTime * 1000);
    return String(d.getUTCFullYear()) === yr;
  });

  if (!yrTrades.length) continue;

  const rs = yrTrades.map(t => t.finalR);
  const wins = rs.filter(r => r > 0.05);
  const losses = rs.filter(r => r < -0.05);
  const wr = ((wins.length / yrTrades.length) * 100).toFixed(1);
  const grossWin = wins.reduce((acc, r) => acc + r, 0);
  const grossLoss = Math.abs(losses.reduce((acc, r) => acc + r, 0));
  const pf = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : "99.9";
  const netR = rs.reduce((acc, r) => acc + r, 0);
  const netDollar = netR * 750;

  let peak = 0;
  let eq = 0;
  let maxDD = 0;
  for (const r of rs) {
    eq += r;
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDD) maxDD = dd;
  }

  const isOOS = parseInt(yr, 10) >= 2024;
  const periodLabel = isOOS ? "Out-of-Sample " : "In-Sample     ";
  const netFormatted = (netR >= 0 ? "+" : "") + netR.toFixed(1).padStart(6) + "R";
  const pnlFormatted = (netDollar >= 0 ? "+$" : "-$") + Math.abs(netDollar).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).padStart(8);
  const status = netR > 0 ? "✅ PROFITABLE" : "❌ LOSS";

  console.log(`${yr}    ${periodLabel}   ${String(yrTrades.length).padStart(4)}     ${wr.padStart(5)}%   ${pf.padStart(5)}   ${netFormatted}   ${pnlFormatted}   -${maxDD.toFixed(1).padStart(4)}R   ${status}`);
}
console.log("=========================================================================================\n");
