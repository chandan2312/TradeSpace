import fs from "fs";
import path from "path";

// Binary reader for nas100_1m.bin (24 bytes per bar: uint64 t, float32 o, h, l, c)
class OneMinuteFeed {
  constructor(binPath) {
    this.buffer = fs.readFileSync(binPath);
    this.barSize = 24;
    this.totalBars = Math.floor(this.buffer.length / this.barSize);
    console.log(`Loaded 1M binary feed: ${this.totalBars} bars (${(this.buffer.length / (1024*1024)).toFixed(2)} MB)`);
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

  // Binary search for exact or next bar index >= targetTime
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

// Replays a candidate setup against the 1M feed
function simulateTradeExecution(candidate, feed1M, options = {}) {
  const { allowOvernight = true, spreadPoints = 1.0 } = options;
  const level = candidate.candidateLevel;
  if (!level) return null;

  const d = candidate.dir; // 1 for BUY, -1 for SELL
  const limitPrice = level.entry;
  const slPrice = level.stopLoss;
  const fullTpPrice = level.takeProfit;
  const riskDist = Math.abs(limitPrice - slPrice);
  if (riskDist <= 0) return null;

  const milestoneR = 2.5; // 50% milestone
  const milestonePrice = d === 1 ? limitPrice + milestoneR * riskDist : limitPrice - milestoneR * riskDist;
  const maxRunawayDist = 1.5 * riskDist;

  // Staged at bar close; execution starts at next minute
  const startT = candidate.t + 900; // M15 bar close
  let idx = feed1M.findIndex(startT);
  if (idx < 0) return { outcome: "truncated", filled: false, candidate };

  const maxPendingMinutes = level.horizon === "scalp" ? 20 : 180;
  const maxHoldMinutes = level.horizon === "scalp" ? 60 : (allowOvernight ? 2880 : 480);

  let isFilled = false;
  let fillIdx = -1;
  let fillPrice = 0;
  let fillTime = 0;

  // 1. Pending Limit Order Replay
  for (let step = 0; step < maxPendingMinutes && idx < feed1M.totalBars; step++, idx++) {
    const bar = feed1M.getBar(idx);
    if (!bar) break;

    // A. Check runaway price
    const moveInDir = d === 1 ? (bar.high - candidate.currentPrice) : (candidate.currentPrice - bar.low);
    if (moveInDir >= maxRunawayDist) {
      return { outcome: "runaway_cancelled", filled: false, reason: "Runaway price expanded >= 1.5R without fill", candidate };
    }

    // B. Check target reached before fill
    const hitTargetEarly = d === 1 ? bar.high >= fullTpPrice : bar.low <= fullTpPrice;
    if (hitTargetEarly) {
      return { outcome: "target_reached_cancelled", filled: false, reason: "Target reached before limit fill", candidate };
    }

    // C. Check limit order penetration
    const canFill = d === 1 ? (bar.low < limitPrice - spreadPoints) : (bar.high > limitPrice + spreadPoints);
    if (canFill) {
      isFilled = true;
      fillIdx = idx;
      fillPrice = limitPrice;
      fillTime = bar.t;
      break;
    }
  }

  if (!isFilled) {
    return { outcome: "expired_pending", filled: false, reason: "Pending limit order expired without fill", candidate };
  }

  // 2. Active Trade Management on 1M Bars
  let isBreakeven = false;
  let isMilestoneBooked = false; // 40% volume booked
  let currentSL = slPrice;
  let exitPrice = 0;
  let exitTime = 0;
  let exitReason = "";
  let barsHeld = 0;

  let defaultLegR = 0;
  let propLegR = 0;

  for (let step = 1; step <= maxHoldMinutes && idx < feed1M.totalBars; step++, idx++) {
    const bar = feed1M.getBar(idx);
    if (!bar) break;
    barsHeld = step;

    // Check No-Overnight intraday cutoff (18:30 UTC = end of NY session)
    if (!allowOvernight) {
      const dt = new Date(bar.t * 1000);
      const totalMin = dt.getUTCHours() * 60 + dt.getUTCMinutes();
      if (totalMin >= 1110) { // 18:30 UTC
        exitPrice = bar.close;
        exitTime = bar.t;
        exitReason = "intraday_eod_flat";
        const floatingR = (exitPrice - fillPrice) * d / riskDist;
        if (isMilestoneBooked) {
          defaultLegR = 0.4 * milestoneR + 0.6 * floatingR;
        } else {
          defaultLegR = floatingR;
        }
        propLegR = Math.max(-1.0, Math.min(2.0, floatingR));
        return {
          outcome: "intraday_flat",
          filled: true,
          fillTime,
          exitTime,
          barsHeld,
          defaultLegR,
          propLegR,
          exitReason,
          candidate,
        };
      }
    }

    // Check Stop Loss hit (Pessimistic tie-breaker: Stop loss always takes precedence)
    const hitSL = d === 1 ? bar.low <= currentSL : bar.high >= currentSL;
    if (hitSL) {
      exitPrice = currentSL;
      exitTime = bar.t;
      exitReason = isBreakeven ? "closed_be" : "closed_sl";
      if (isMilestoneBooked) {
        defaultLegR = 0.4 * milestoneR + 0.6 * (isBreakeven ? 0.0 : -1.0);
      } else {
        defaultLegR = isBreakeven ? 0.0 : -1.0;
      }
      propLegR = isBreakeven ? 0.0 : -1.0;
      return {
        outcome: exitReason,
        filled: true,
        fillTime,
        exitTime,
        barsHeld,
        defaultLegR,
        propLegR,
        exitReason,
        candidate,
      };
    }

    // Check Breakeven Trigger (+1.5R reached)
    const bePrice = d === 1 ? fillPrice + 1.5 * riskDist : fillPrice - 1.5 * riskDist;
    const hitBE = d === 1 ? bar.high >= bePrice : bar.low <= bePrice;
    if (hitBE && !isBreakeven) {
      isBreakeven = true;
      currentSL = fillPrice; // Move SL to entry
    }

    // Check 50% Milestone (+2.5R reached -> Book 40% volume, trail remaining 60% runner)
    const hitMilestone = d === 1 ? bar.high >= milestonePrice : bar.low <= milestonePrice;
    if (hitMilestone && !isMilestoneBooked) {
      isMilestoneBooked = true;
      isBreakeven = true;
      currentSL = d === 1 ? fillPrice + 1.5 * riskDist : fillPrice - 1.5 * riskDist; // Lock +1.5R trail
    }

    // Check Full Take Profit (+5.0R for default, 2.0R for prop)
    const hitTP = d === 1 ? bar.high >= fullTpPrice : bar.low <= fullTpPrice;
    if (hitTP) {
      exitPrice = fullTpPrice;
      exitTime = bar.t;
      exitReason = "closed_tp";
      if (isMilestoneBooked) {
        defaultLegR = 0.4 * milestoneR + 0.6 * (level.rr || 5.0);
      } else {
        defaultLegR = level.rr || 5.0;
      }
      propLegR = 2.0; // Prop target achieved
      return {
        outcome: "closed_tp",
        filled: true,
        fillTime,
        exitTime,
        barsHeld,
        defaultLegR,
        propLegR,
        exitReason,
        candidate,
      };
    }
  }

  // Max hold timeout exit
  const lastBar = feed1M.getBar(idx - 1);
  const px = lastBar ? lastBar.close : fillPrice;
  const floatingR = (px - fillPrice) * d / riskDist;
  if (isMilestoneBooked) {
    defaultLegR = 0.4 * milestoneR + 0.6 * floatingR;
  } else {
    defaultLegR = floatingR;
  }
  propLegR = Math.max(-1.0, Math.min(2.0, floatingR));

  return {
    outcome: "closed_timeout",
    filled: true,
    fillTime,
    exitTime: lastBar?.t || fillTime,
    barsHeld,
    defaultLegR,
    propLegR,
    exitReason: "timeout",
    candidate,
  };
}

// Computes core statistical metrics for a set of R results
function computeMetrics(rs) {
  if (rs.length === 0) {
    return { count: 0, wins: 0, losses: 0, be: 0, winRate: "0.0", pf: "0.0", netR: "0.00", avgR: "0.000", maxDD: "0.00" };
  }
  const wins = rs.filter(r => r > 0.05);
  const losses = rs.filter(r => r < -0.05);
  const be = rs.filter(r => Math.abs(r) <= 0.05);
  const totalDecided = wins.length + losses.length;

  const winRate = totalDecided > 0 ? (wins.length / totalDecided * 100).toFixed(1) : "0.0";
  const grossProfit = wins.reduce((acc, r) => acc + r, 0);
  const grossLoss = Math.abs(losses.reduce((acc, r) => acc + r, 0));
  const pf = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? "INF" : "0.0");
  const netR = rs.reduce((acc, r) => acc + r, 0).toFixed(2);
  const avgR = (netR / rs.length).toFixed(3);

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
    count: rs.length,
    wins: wins.length,
    losses: losses.length,
    be: be.length,
    winRate,
    pf,
    netR,
    avgR,
    maxDD: maxDD.toFixed(2),
  };
}

function analyzeBacktestResults(results, title) {
  const filledTrades = results.filter(r => r.filled);
  const totalStaged = results.length;
  const fillCount = filledTrades.length;
  const fillRate = totalStaged > 0 ? (fillCount / totalStaged * 100).toFixed(1) : "0.0";

  console.log(`\n===============================================================================`);
  console.log(` ${title.toUpperCase()}`);
  console.log(` (Total Staged: ${totalStaged} | Filled: ${fillCount} | Fill Rate: ${fillRate}%)`);
  console.log(`===============================================================================`);

  const summary = {
    title,
    totalStaged,
    fillCount,
    fillRate,
    legs: {},
    byModel: {},
    byYear: {},
  };

  for (const [legName, key] of [["TradeDefault (Milestone 50 + Runner)", "defaultLegR"], ["TradeProp (Prop-Firm Safe 2.0R)", "propLegR"]]) {
    const rs = filledTrades.map(t => t[key]).filter(x => Number.isFinite(x));
    const m = computeMetrics(rs);
    summary.legs[legName] = m;

    console.log(`--- ${legName} ---`);
    console.log(`  Total Trades:     ${m.count} (Wins: ${m.wins}, Losses: ${m.losses}, BE: ${m.be})`);
    console.log(`  Win Rate:         ${m.winRate}%`);
    console.log(`  Profit Factor:    ${m.pf}`);
    console.log(`  Net R:            ${m.netR >= 0 ? "+" : ""}${m.netR}R`);
    console.log(`  Average Trade:    ${m.avgR}R`);
    console.log(`  Max Drawdown:     -${m.maxDD}R`);
    console.log(``);
  }

  // Model breakdown (TradeDefault)
  console.log(`--- BREAKDOWN BY SMC MODEL (TradeDefault) ---`);
  const models = [...new Set(filledTrades.map(t => t.candidate?.candidateLevel?.modelName || t.candidate?.candidateLevel?.modelId || "Unknown"))];
  for (const model of models) {
    const modelTrades = filledTrades.filter(t => (t.candidate?.candidateLevel?.modelName || t.candidate?.candidateLevel?.modelId || "Unknown") === model);
    const rs = modelTrades.map(t => t.defaultLegR).filter(x => Number.isFinite(x));
    const m = computeMetrics(rs);
    summary.byModel[model] = m;
    console.log(`  • ${model.padEnd(35)}: ${String(m.count).padStart(5)} trades | WR: ${m.winRate.padStart(5)}% | PF: ${m.pf.padStart(5)} | Net: ${m.netR >= 0 ? "+" : ""}${m.netR.padStart(7)}R | MaxDD: -${m.maxDD}R`);
  }

  // Yearly breakdown (TradeDefault)
  console.log(`\n--- BREAKDOWN BY YEAR (TradeDefault) ---`);
  const years = ["2021", "2022", "2023", "2024", "2025", "2026"];
  for (const yr of years) {
    const yrTrades = filledTrades.filter(t => {
      const iso = t.candidate?.isoTime || "";
      return iso.startsWith(yr);
    });
    const rs = yrTrades.map(t => t.defaultLegR).filter(x => Number.isFinite(x));
    const m = computeMetrics(rs);
    summary.byYear[yr] = m;
    console.log(`  • ${yr}: ${String(m.count).padStart(5)} trades | WR: ${m.winRate.padStart(5)}% | PF: ${m.pf.padStart(5)} | Net: ${m.netR >= 0 ? "+" : ""}${m.netR.padStart(7)}R | MaxDD: -${m.maxDD}R`);
  }

  return summary;
}

async function main() {
  const dataDir = path.resolve("quant_service/data");
  const candidatesPath = path.join(dataDir, "nas100_staged_candidates.json");
  const bin1MPath = path.join(dataDir, "nas100_1m.bin");

  if (!fs.existsSync(candidatesPath)) {
    console.log(`Error: Candidates file missing: ${candidatesPath}`);
    return;
  }

  console.log("===============================================================================");
  console.log(" PASS 2: HIGH-PRECISION 1M EXECUTION SIMULATION ENGINE");
  console.log("===============================================================================");
  console.log("Loading staged candidates and 1M feed...");
  const candidates = JSON.parse(fs.readFileSync(candidatesPath, "utf-8"));
  const feed1M = new OneMinuteFeed(bin1MPath);

  console.log(`Loaded ${candidates.length} staged candidates across 2021-2026.`);

  // Mode A: Overnight Allowed
  console.log("\nSimulating Mode A: Overnight Holding Allowed...");
  const t0_A = performance.now();
  const resultsA = candidates.map(c => simulateTradeExecution(c, feed1M, { allowOvernight: true }));
  const durationA = ((performance.now() - t0_A) / 1000).toFixed(2);
  console.log(`Mode A simulated in ${durationA}s.`);
  const summaryA = analyzeBacktestResults(resultsA, "Mode A: Overnight Holding Allowed");

  // Mode B: No Overnight (Intraday Flat at 18:30 UTC)
  console.log("\nSimulating Mode B: Strict Intraday Flat (No Overnight)...");
  const t0_B = performance.now();
  const resultsB = candidates.map(c => simulateTradeExecution(c, feed1M, { allowOvernight: false }));
  const durationB = ((performance.now() - t0_B) / 1000).toFixed(2);
  console.log(`Mode B simulated in ${durationB}s.`);
  const summaryB = analyzeBacktestResults(resultsB, "Mode B: No Overnight Holding (Flat at 18:30 UTC)");

  // Save report artifact
  const outReportPath = path.join(dataDir, "nas100_backtest_summary.json");
  fs.writeFileSync(outReportPath, JSON.stringify({ modeA: summaryA, modeB: summaryB }, null, 2), "utf-8");
  console.log(`\nFull summary saved to: ${outReportPath}`);
}

export { simulateTradeExecution, analyzeBacktestResults, computeMetrics, OneMinuteFeed };

if (process.argv[1]?.endsWith("run_nas100_backtest.mjs")) {
  main().catch(console.error);
}