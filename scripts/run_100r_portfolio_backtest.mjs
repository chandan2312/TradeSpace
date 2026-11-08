import fs from "fs";
import path from "path";

// Fast binary 1M bar reader with exact 24-byte alignment (<Qffff)
export class FastFeed {
  constructor(filePath) {
    this.buffer = fs.readFileSync(filePath);
    this.barSize = 24;
    this.totalBars = Math.floor(this.buffer.length / this.barSize);
  }

  getBar(idx) {
    if (idx < 0 || idx >= this.totalBars) return null;
    const offset = idx * this.barSize;
    return {
      t: Number(this.buffer.readBigUInt64LE(offset)),
      open: this.buffer.readFloatLE(offset + 8),
      high: this.buffer.readFloatLE(offset + 12),
      low: this.buffer.readFloatLE(offset + 16),
      close: this.buffer.readFloatLE(offset + 20),
    };
  }

  findIndex(targetT) {
    let low = 0;
    let high = this.totalBars - 1;
    let ans = -1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const t = Number(this.buffer.readBigUInt64LE(mid * this.barSize));
      if (t >= targetT) {
        ans = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return ans;
  }
}

export function getSessionName(t) {
  const d = new Date(t * 1000);
  const total = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (total >= 1260 && total < 1380) return "ROLLOVER";
  if (total >= 1380 || total < 480) return "ASIA";
  if (total >= 480 && total < 810) return "LONDON";
  return "NEW_YORK";
}

const ASSET_SPECS = {
  NAS100: {
    binFile: "nas100_1m.bin",
    candidatesFiles: ["nas100_expanded_staged_candidates.json", "nas100_staged_candidates.json"],
    spreadPoints: 1.0,
    pip: 1.0,
    point: 1.0,
    category: "index",
    allowedModels: ["breaker_block", "silver_bullet", "turtle_soup"],
    minConf: 65,
  },
  XAUUSD: {
    binFile: "xauusd_1m.bin",
    candidatesFiles: ["xauusd_expanded_staged_candidates.json", "xauusd_22h_staged_candidates.json", "xauusd_staged_candidates.json"],
    spreadPoints: 0.25,
    pip: 0.1,
    point: 0.01,
    category: "metal",
    allowedModels: ["turtle_soup"],
    allowedSessions: ["LONDON", "NEW_YORK", "ASIA"],
    minConf: 60,
  },
  EURUSD: {
    binFile: "eurusd_1m.bin",
    candidatesFiles: ["eurusd_staged_candidates.json"],
    spreadPoints: 0.00010,
    pip: 0.0001,
    point: 0.00001,
    category: "forex",
    allowedModels: ["fvg_rejection", "breaker_block"],
    allowedSessions: ["LONDON", "NEW_YORK"],
    minConf: 60,
  },
  GER40: {
    binFile: "ger40_1m.bin",
    candidatesFiles: ["ger40_staged_candidates.json"],
    spreadPoints: 1.5,
    pip: 1.0,
    point: 1.0,
    category: "index",
    allowedModels: ["breaker_block", "po3_daily_cycle", "turtle_soup"],
    allowedSessions: ["LONDON", "NEW_YORK"],
    minConf: 60,
  },
};

function simulateExecution(c, feed, params) {
  const {
    spreadPoints = 0,
    targetR = 2.5,
    beTriggerR = 1.2,
    beLockR = 0.1,
    partialAtR = null,
    partialPct = 0.5,
    runnerTargetR = 4.0,
    maxPendingBars = 180,
    maxHoldMinutes = 2880,
    allowOvernight = true,
    intradayCutoffUtcMin = 1260, // 21:00 UTC
  } = params;

  const level = c.candidateLevel;
  if (!level) return null;

  const d = c.dir;
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

  const startT = c.t + 900;
  let idx = feed.findIndex(startT);
  if (idx < 0) return null;

  let isFilled = false;
  let fillPrice = limitPrice;
  let fillTime = 0;

  for (let step = 0; step < maxPendingBars && idx < feed.totalBars; step++, idx++) {
    const bar = feed.getBar(idx);
    if (!bar) break;

    const moveInDir = d === 1 ? (bar.high - c.currentPrice) : (c.currentPrice - bar.low);
    if (moveInDir >= maxRunawayDist) return null;

    const hitEarly = d === 1 ? bar.high >= targetPrice : bar.low <= targetPrice;
    if (hitEarly) return null;

    const canFill = d === 1 ? (bar.low < limitPrice - spreadPoints) : (bar.high > limitPrice + spreadPoints);
    if (canFill) {
      isFilled = true;
      fillTime = bar.t;
      break;
    }
  }

  if (!isFilled) return null;

  let isBE = false;
  let isPartialTaken = false;
  let currentSL = slPrice;
  let finalR = 0;
  let exitReason = "";
  let exitTime = 0;

  for (let step = 0; step < maxHoldMinutes && idx < feed.totalBars; step++, idx++) {
    const bar = feed.getBar(idx);
    if (!bar) break;

    if (!allowOvernight) {
      const dDate = new Date(bar.t * 1000);
      const curMin = dDate.getUTCHours() * 60 + dDate.getUTCMinutes();
      if (curMin >= intradayCutoffUtcMin) {
        exitTime = bar.t;
        const floatingR = (bar.close - fillPrice) * d / riskDist;
        finalR = isPartialTaken ? (partialPct * partialAtR + (1 - partialPct) * floatingR) : floatingR;
        exitReason = "intraday_close";
        return { filled: true, fillTime, exitTime, finalR, exitReason, candidate: c };
      }
    }

    // SL check
    const hitSL = d === 1 ? bar.low <= currentSL + spreadPoints : bar.high >= currentSL - spreadPoints;
    if (hitSL) {
      exitTime = bar.t;
      if (isBE) {
        finalR = isPartialTaken ? (partialPct * partialAtR + (1 - partialPct) * beLockR) : beLockR;
        exitReason = "breakeven";
      } else {
        finalR = -1.0;
        exitReason = "stop_loss";
      }
      return { filled: true, fillTime, exitTime, finalR, exitReason, candidate: c };
    }

    // BE check
    if (!isBE) {
      const hitBE = d === 1 ? bar.high >= beTriggerPrice : bar.low <= beTriggerPrice;
      if (hitBE) {
        isBE = true;
        currentSL = beLockPrice;
      }
    }

    // Partial Target Check
    if (partialPrice && !isPartialTaken) {
      const hitPartial = d === 1 ? bar.high >= partialPrice : bar.low <= partialPrice;
      if (hitPartial) {
        isPartialTaken = true;
        isBE = true;
        currentSL = beLockPrice;
      }
    }

    // Full Target Check
    const hitTarget = partialPrice
      ? (d === 1 ? bar.high >= runnerPrice : bar.low <= runnerPrice)
      : (d === 1 ? bar.high >= targetPrice : bar.low <= targetPrice);

    if (hitTarget) {
      exitTime = bar.t;
      if (partialPrice) {
        finalR = partialPct * partialAtR + (1 - partialPct) * runnerTargetR;
      } else {
        finalR = targetR;
      }
      exitReason = "target_exit";
      return { filled: true, fillTime, exitTime, finalR, exitReason, candidate: c };
    }
  }

  // Timeout
  const lastBar = feed.getBar(idx - 1);
  const px = lastBar ? lastBar.close : fillPrice;
  const floatingR = (px - fillPrice) * d / riskDist;
  finalR = isPartialTaken ? (partialPct * partialAtR + (1 - partialPct) * floatingR) : floatingR;
  return { filled: true, fillTime, exitTime: lastBar?.t || fillTime, finalR, exitReason: "timeout", candidate: c };
}

export function computeStats(trades) {
  if (!trades.length) return { count: 0, winRate: "0.0", pf: "0.00", netR: "0.00", avgR: "0.00", maxDD: "0.00" };
  const rs = trades.map(t => t.finalR);
  const wins = rs.filter(r => r > 0.05);
  const losses = rs.filter(r => r < -0.05);
  const be = rs.filter(r => Math.abs(r) <= 0.05);
  const totalDecided = wins.length + losses.length;

  const winRate = totalDecided > 0 ? (wins.length / totalDecided * 100).toFixed(1) : "0.0";
  const grossProfit = wins.reduce((acc, r) => acc + r, 0);
  const grossLoss = Math.abs(losses.reduce((acc, r) => acc + r, 0));
  const pf = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? "99.9" : "0.00");
  const netR = parseFloat(rs.reduce((acc, r) => acc + r, 0).toFixed(2));
  const avgR = parseFloat((netR / rs.length).toFixed(3));

  let peak = 0;
  let equity = 0;
  let maxDD = 0;
  for (const r of rs) {
    equity += r;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    be: be.length,
    winRate,
    pf,
    netR,
    avgR,
    maxDD: parseFloat(maxDD.toFixed(2)),
  };
}

export function runPortfolioSimulation({
  dataDir = path.resolve("quant_service/data"),
  symbols = ["NAS100", "XAUUSD", "EURUSD", "GER40"],
  simParams = {
    targetR: 2.5,
    beTriggerR: 1.2,
    beLockR: 0.1,
    maxPendingBars: 180,
    maxHoldMinutes: 2880,
    allowOvernight: true,
  },
  portfolioParams = {
    maxConcurrent: 5,
    cooldownSecPerSymbol: 1800,
  },
} = {}) {
  console.log("===============================================================================");
  console.log(" TRADE-SPACE MULTI-ASSET PORTFOLIO SIMULATION (100R ALPHA EXPANSION)");
  console.log(` Target R: ${simParams.targetR}R | BE Trigger: +${simParams.beTriggerR}R (Lock: +${simParams.beLockR}R)`);
  console.log(` Overnight Mode: ${simParams.allowOvernight ? "Mode A (Hold Enabled)" : "Mode B (Flat at Day End)"}`);
  console.log(` Max Concurrent Portfolio Positions: ${portfolioParams.maxConcurrent}`);
  console.log("===============================================================================\n");

  const feeds = {};
  const allCandidates = [];

  for (const sym of symbols) {
    const spec = ASSET_SPECS[sym];
    if (!spec) continue;

    const binPath = path.join(dataDir, spec.binFile);
    if (!fs.existsSync(binPath)) {
      console.warn(`[INFO] 1M binary feed missing for ${sym}: ${binPath}`);
      continue;
    }

    let candPath = null;
    for (const f of spec.candidatesFiles) {
      const p = path.join(dataDir, f);
      if (fs.existsSync(p)) {
        candPath = p;
        break;
      }
    }

    if (!candPath) {
      console.warn(`[INFO] Staged candidates file pending for ${sym}`);
      continue;
    }

    feeds[sym] = new FastFeed(binPath);
    const raw = JSON.parse(fs.readFileSync(candPath, "utf-8"));

    // Institutional Selectivity Filter:
    const approved = raw.filter(c => {
      // 1. Must be causally approved without blocking execution vetoes
      const isApproved = c.approved === true || (!c.execution?.vetoes?.length && c.execution?.approved !== false);
      if (!isApproved) return false;

      // 2. Minimum Confluence Score
      const conf = c.candidateLevel?.confluenceScore ?? c.confluenceScore ?? 0;
      if (conf < (spec.minConf || 60)) return false;

      // 3. Exclude toxic displacement breakout
      const mId = c.candidateLevel?.modelId || c.candidateLevel?.modelName || c.model;
      if (mId === "displacement_breakout") return false;

      // 4. Model filter
      if (spec.allowedModels && !spec.allowedModels.some(m => mId?.toLowerCase().includes(m))) return false;

      // 5. Session filter
      if (spec.allowedSessions) {
        const sess = getSessionName(c.t);
        if (!spec.allowedSessions.includes(sess)) return false;
      }

      return true;
    });

    console.log(`[LOADED] ${sym}: ${approved.length} approved setups (from ${raw.length} raw candidates) in ${path.basename(candPath)}`);

    for (const c of approved) {
      allCandidates.push({
        ...c,
        symbol: sym,
        spreadPoints: spec.spreadPoints,
      });
    }
  }

  // Sort chronologically across all assets
  allCandidates.sort((a, b) => a.t - b.t);
  console.log(`\nTotal Portfolio Approved Setups: ${allCandidates.length}\n`);

  if (!allCandidates.length) {
    console.log("No approved candidates ready yet.");
    return null;
  }

  const activePositions = [];
  const lastEntryTimeBySymbol = {};
  const executedTrades = [];

  for (const c of allCandidates) {
    const curTime = c.t;

    for (let i = activePositions.length - 1; i >= 0; i--) {
      if (activePositions[i].exitTime <= curTime) {
        activePositions.splice(i, 1);
      }
    }

    if (activePositions.length >= portfolioParams.maxConcurrent) continue;

    const lastEntry = lastEntryTimeBySymbol[c.symbol] || 0;
    if (curTime - lastEntry < portfolioParams.cooldownSecPerSymbol) continue;

    const feed = feeds[c.symbol];
    if (!feed) continue;

    const sim = simulateExecution(c, feed, {
      ...simParams,
      spreadPoints: c.spreadPoints,
    });

    if (!sim || !sim.filled) continue;

    activePositions.push({ symbol: c.symbol, fillTime: sim.fillTime, exitTime: sim.exitTime, sim });
    lastEntryTimeBySymbol[c.symbol] = sim.fillTime;
    executedTrades.push({
      ...sim,
      symbol: c.symbol,
      model: c.candidateLevel?.modelId || c.candidateLevel?.modelName || c.model,
      year: new Date(sim.fillTime * 1000).getUTCFullYear(),
      month: new Date(sim.fillTime * 1000).toISOString().slice(0, 7),
    });
  }

  console.log(`Executed Trades Across Portfolio: ${executedTrades.length}`);
  const overallStats = computeStats(executedTrades);
  console.log("\n=================== OVERALL PORTFOLIO PERFORMANCE ===================");
  console.log(`Total Trades: ${overallStats.count}`);
  console.log(`Win Rate: ${overallStats.winRate}% (Wins: ${overallStats.wins}, Losses: ${overallStats.losses}, BE: ${overallStats.be})`);
  console.log(`Profit Factor: ${overallStats.pf}`);
  console.log(`Net Profit: +${overallStats.netR} R`);
  console.log(`Expectancy (Avg R): +${overallStats.avgR} R/trade`);
  console.log(`Max Drawdown: -${overallStats.maxDD} R`);
  console.log("=====================================================================\n");

  // Yearly Breakdown
  const yearly = {};
  for (const t of executedTrades) {
    yearly[t.year] = yearly[t.year] || [];
    yearly[t.year].push(t);
  }

  console.log("======================= YEAR-BY-YEAR CONSISTENCY =======================");
  console.log("| Year | Trades | Win Rate | Profit Factor | Net Return (R) | Max DD (R) |");
  console.log("|------|--------|----------|---------------|----------------|------------|");
  for (const y of Object.keys(yearly).sort()) {
    const s = computeStats(yearly[y]);
    console.log(`| ${y} | ${String(s.count).padEnd(6)} | ${String(s.winRate + "%").padEnd(8)} | ${String(s.pf).padEnd(13)} | ${String("+" + s.netR + "R").padEnd(14)} | ${String("-" + s.maxDD + "R").padEnd(10)} |`);
  }
  console.log("========================================================================\n");

  // Per-Asset Breakdown
  const byAsset = {};
  for (const t of executedTrades) {
    byAsset[t.symbol] = byAsset[t.symbol] || [];
    byAsset[t.symbol].push(t);
  }

  console.log("======================= ASSET-BY-ASSET BREAKDOWN =======================");
  console.log("| Asset  | Trades | Win Rate | Profit Factor | Net Return (R) | Max DD (R) |");
  console.log("|--------|--------|----------|---------------|----------------|------------|");
  for (const a of Object.keys(byAsset).sort()) {
    const s = computeStats(byAsset[a]);
    console.log(`| ${a.padEnd(6)} | ${String(s.count).padEnd(6)} | ${String(s.winRate + "%").padEnd(8)} | ${String(s.pf).padEnd(13)} | ${String("+" + s.netR + "R").padEnd(14)} | ${String("-" + s.maxDD + "R").padEnd(10)} |`);
  }
  console.log("========================================================================\n");

  // Per-Model Breakdown
  const byModel = {};
  for (const t of executedTrades) {
    byModel[t.model] = byModel[t.model] || [];
    byModel[t.model].push(t);
  }

  console.log("======================= MODEL-BY-MODEL BREAKDOWN =======================");
  console.log("| Model                 | Trades | Win Rate | Profit Factor | Net Return (R) |");
  console.log("|-----------------------|--------|----------|---------------|----------------|");
  for (const m of Object.keys(byModel).sort()) {
    const s = computeStats(byModel[m]);
    console.log(`| ${m.padEnd(21)} | ${String(s.count).padEnd(6)} | ${String(s.winRate + "%").padEnd(8)} | ${String(s.pf).padEnd(13)} | ${String("+" + s.netR + "R").padEnd(14)} |`);
  }
  console.log("========================================================================\n");

  return {
    overallStats,
    yearly,
    byAsset,
    byModel,
    executedTrades,
  };
}

if (process.argv[1]?.endsWith("run_100r_portfolio_backtest.mjs")) {
  runPortfolioSimulation();
}
