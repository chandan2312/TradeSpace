import fs from "fs";
import path from "path";

class OneMinuteFeed {
  constructor(binPath) {
    this.buffer = fs.readFileSync(binPath);
    this.barSize = 24;
    this.totalBars = Math.floor(this.buffer.length / this.barSize);
    console.log(`Loaded XAUUSD 1M binary feed: ${this.totalBars} bars (${(this.buffer.length / (1024*1024)).toFixed(2)} MB)`);
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

function simulateTradeExecution(candidate, feed1M, options = {}) {
  const { allowOvernight = true, spreadPoints = 0.25 } = options;
  const level = candidate.candidateLevel;
  if (!level) return null;

  const d = candidate.dir;
  const limitPrice = level.entry;
  const slPrice = level.stopLoss;
  const fullTpPrice = level.takeProfit;
  const riskDist = Math.abs(limitPrice - slPrice);
  if (riskDist <= 0) return null;

  const milestoneR = 2.5;
  const milestonePrice = d === 1 ? limitPrice + milestoneR * riskDist : limitPrice - milestoneR * riskDist;
  const maxRunawayDist = 1.5 * riskDist;

  const startT = candidate.t + 900;
  let idx = feed1M.findIndex(startT);
  if (idx < 0) return { outcome: "truncated", filled: false, candidate };

  const maxPendingMinutes = 180;
  const maxHoldMinutes = allowOvernight ? 2880 : 480;

  let isFilled = false;
  let fillIdx = -1;
  let fillPrice = 0;
  let fillTime = 0;

  for (let step = 0; step < maxPendingMinutes && idx < feed1M.totalBars; step++, idx++) {
    const bar = feed1M.getBar(idx);
    if (!bar) break;

    const moveInDir = d === 1 ? (bar.high - candidate.currentPrice) : (candidate.currentPrice - bar.low);
    if (moveInDir >= maxRunawayDist) {
      return { outcome: "runaway_cancelled", filled: false, candidate };
    }

    const hitTargetEarly = d === 1 ? bar.high >= fullTpPrice : bar.low <= fullTpPrice;
    if (hitTargetEarly) {
      return { outcome: "target_reached_cancelled", filled: false, candidate };
    }

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
    return { outcome: "expired_pending", filled: false, candidate };
  }

  let isBreakeven = false;
  let isMilestoneBooked = false;
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

    if (!allowOvernight) {
      const dt = new Date(bar.t * 1000);
      const totalMin = dt.getUTCHours() * 60 + dt.getUTCMinutes();
      if (totalMin >= 1110) {
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
        return { outcome: "intraday_flat", filled: true, fillTime, exitTime, barsHeld, defaultLegR, propLegR, exitReason, candidate };
      }
    }

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
      return { outcome: exitReason, filled: true, fillTime, exitTime, barsHeld, defaultLegR, propLegR, exitReason, candidate };
    }

    const bePrice = d === 1 ? fillPrice + 1.5 * riskDist : fillPrice - 1.5 * riskDist;
    const hitBE = d === 1 ? bar.high >= bePrice : bar.low <= bePrice;
    if (hitBE && !isBreakeven) {
      isBreakeven = true;
      currentSL = fillPrice;
    }

    const hitMilestone = d === 1 ? bar.high >= milestonePrice : bar.low <= milestonePrice;
    if (hitMilestone && !isMilestoneBooked) {
      isMilestoneBooked = true;
      isBreakeven = true;
      currentSL = d === 1 ? fillPrice + 1.5 * riskDist : fillPrice - 1.5 * riskDist;
    }

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
      propLegR = 2.0;
      return { outcome: "closed_tp", filled: true, fillTime, exitTime, barsHeld, defaultLegR, propLegR, exitReason, candidate };
    }
  }

  const lastBar = feed1M.getBar(idx - 1);
  const px = lastBar ? lastBar.close : fillPrice;
  const floatingR = (px - fillPrice) * d / riskDist;
  if (isMilestoneBooked) {
    defaultLegR = 0.4 * milestoneR + 0.6 * floatingR;
  } else {
    defaultLegR = floatingR;
  }
  propLegR = Math.max(-1.0, Math.min(2.0, floatingR));

  return { outcome: "closed_timeout", filled: true, fillTime, exitTime: lastBar?.t || fillTime, barsHeld, defaultLegR, propLegR, exitReason: "timeout", candidate };
}

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

  return { count: rs.length, wins: wins.length, losses: losses.length, be: be.length, winRate, pf, netR, avgR, maxDD: maxDD.toFixed(2) };
}

function simulateSequential(candidatesList, feed1M, allowOvernight) {
  let nextAvailableTime = 0;
  const executedTrades = [];

  for (const c of candidatesList) {
    if (c.t < nextAvailableTime) continue;

    const sim = simulateTradeExecution(c, feed1M, { allowOvernight, spreadPoints: 0.25 });
    if (!sim) continue;

    if (sim.filled) {
      executedTrades.push(sim);
      const cooldownSec = (sim.outcome === "closed_sl") ? 1800 : 900;
      nextAvailableTime = (sim.exitTime || sim.fillTime) + cooldownSec;
    } else {
      nextAvailableTime = c.t + (180 * 60);
    }
  }

  return executedTrades;
}

async function main() {
  const dataDir = path.resolve("quant_service/data");
  const candidatesPath = path.join(dataDir, "xauusd_staged_candidates.json");
  const bin1MPath = path.join(dataDir, "xauusd_1m.bin");

  console.log("===============================================================================");
  console.log(" PASS 2: XAUUSD (GOLD) HIGH-PRECISION 1M EXECUTION SIMULATION ENGINE");
  console.log("===============================================================================");

  const candidates = JSON.parse(fs.readFileSync(candidatesPath, "utf-8"));
  const feed1M = new OneMinuteFeed(bin1MPath);

  // Day horizon only + approved only
  const dayApproved = candidates.filter(c => (c.approved === true || !c.execution?.vetoes?.length) && c.candidateLevel?.horizon === "day");
  dayApproved.sort((a, b) => a.t - b.t);

  console.log(`Loaded ${candidates.length} total candidates across 2021-2026.`);
  console.log(`Approved Day Trading Candidates: ${dayApproved.length}\n`);

  // 1. All Approved Day Trades (Mode A)
  console.log("===============================================================================");
  console.log(" 1. ALL APPROVED DAY TRADES (SINGLE ACTIVE POSITION ON XAUUSD)");
  console.log("===============================================================================");

  const tradesA = simulateSequential(dayApproved, feed1M, true);
  console.log(`MODE A (Overnight Allowed) - Total Trades: ${tradesA.length}`);
  console.log("TradeDefault:", computeMetrics(tradesA.map(t => t.defaultLegR)));
  console.log("TradeProp:   ", computeMetrics(tradesA.map(t => t.propLegR)));

  const tradesB = simulateSequential(dayApproved, feed1M, false);
  console.log(`\nMODE B (Intraday Flat at 18:30 UTC) - Total Trades: ${tradesB.length}`);
  console.log("TradeDefault:", computeMetrics(tradesB.map(t => t.defaultLegR)));
  console.log("TradeProp:   ", computeMetrics(tradesB.map(t => t.propLegR)));

  // 2. Core SMC Models (Breaker Block + Turtle Soup + Silver Bullet)
  const coreDay = dayApproved.filter(c => {
    const m = c.candidateLevel?.modelName || "";
    return m.includes("Breaker") || m.includes("Turtle") || m.includes("Silver Bullet");
  });

  console.log("\n===============================================================================");
  console.log(" 2. CORE SMC DAY TRADING TRIAD (BREAKER BLOCK + TURTLE SOUP + SILVER BULLET)");
  console.log("===============================================================================");

  const coreTradesA = simulateSequential(coreDay, feed1M, true);
  console.log(`MODE A (Overnight Allowed) - Total Trades: ${coreTradesA.length}`);
  console.log("TradeDefault:", computeMetrics(coreTradesA.map(t => t.defaultLegR)));
  console.log("TradeProp:   ", computeMetrics(coreTradesA.map(t => t.propLegR)));

  const coreTradesB = simulateSequential(coreDay, feed1M, false);
  console.log(`\nMODE B (Intraday Flat at 18:30 UTC) - Total Trades: ${coreTradesB.length}`);
  console.log("TradeDefault:", computeMetrics(coreTradesB.map(t => t.defaultLegR)));
  console.log("TradeProp:   ", computeMetrics(coreTradesB.map(t => t.propLegR)));

  // 3. Model-by-Model Breakdown
  console.log("\n===============================================================================");
  console.log(" 3. MODEL-BY-MODEL BREAKDOWN (Mode A: TradeDefault)");
  console.log("===============================================================================");
  const modelsA = [...new Set(tradesA.map(t => t.candidate?.candidateLevel?.modelName || "Unknown"))];
  for (const m of modelsA) {
    const mTrades = tradesA.filter(t => (t.candidate?.candidateLevel?.modelName || "Unknown") === m);
    const met = computeMetrics(mTrades.map(t => t.defaultLegR));
    console.log(`  • ${m.padEnd(35)}: ${String(met.count).padStart(4)} trades | WR: ${met.winRate.padStart(5)}% | PF: ${met.pf.padStart(5)} | Net: ${met.netR >= 0 ? "+" : ""}${met.netR.padStart(7)}R | MaxDD: -${met.maxDD}R`);
  }

  console.log("\n===============================================================================");
  console.log(" 4. MODEL-BY-MODEL BREAKDOWN (Mode B: TradeDefault - Intraday Flat)");
  console.log("===============================================================================");
  const modelsB = [...new Set(tradesB.map(t => t.candidate?.candidateLevel?.modelName || "Unknown"))];
  for (const m of modelsB) {
    const mTrades = tradesB.filter(t => (t.candidate?.candidateLevel?.modelName || "Unknown") === m);
    const met = computeMetrics(mTrades.map(t => t.defaultLegR));
    console.log(`  • ${m.padEnd(35)}: ${String(met.count).padStart(4)} trades | WR: ${met.winRate.padStart(5)}% | PF: ${met.pf.padStart(5)} | Net: ${met.netR >= 0 ? "+" : ""}${met.netR.padStart(7)}R | MaxDD: -${met.maxDD}R`);
  }

  // 5. Yearly Breakdown (Mode A Core SMC)
  console.log("\n===============================================================================");
  console.log(" 5. YEAR-BY-YEAR PERFORMANCE (Core SMC Triad - Mode A)");
  console.log("===============================================================================");
  const years = ["2021", "2022", "2023", "2024", "2025", "2026"];
  for (const yr of years) {
    const yrTrades = coreTradesA.filter(t => (t.candidate?.isoTime || "").startsWith(yr));
    const met = computeMetrics(yrTrades.map(t => t.defaultLegR));
    console.log(`  • ${yr}: ${String(met.count).padStart(4)} trades | WR: ${met.winRate.padStart(5)}% | PF: ${met.pf.padStart(5)} | Net: ${met.netR >= 0 ? "+" : ""}${met.netR.padStart(7)}R | MaxDD: -${met.maxDD}R`);
  }

  // Save report artifact
  const outReportPath = path.join(dataDir, "xauusd_backtest_summary.json");
  fs.writeFileSync(outReportPath, JSON.stringify({
    tradesA: computeMetrics(tradesA.map(t => t.defaultLegR)),
    tradesPropA: computeMetrics(tradesA.map(t => t.propLegR)),
    tradesB: computeMetrics(tradesB.map(t => t.defaultLegR)),
    tradesPropB: computeMetrics(tradesB.map(t => t.propLegR)),
    coreA: computeMetrics(coreTradesA.map(t => t.defaultLegR)),
    corePropA: computeMetrics(coreTradesA.map(t => t.propLegR)),
    coreB: computeMetrics(coreTradesB.map(t => t.defaultLegR)),
    corePropB: computeMetrics(coreTradesB.map(t => t.propLegR)),
  }, null, 2), "utf-8");
  console.log(`\nFull summary saved to: ${outReportPath}`);
}

export { simulateTradeExecution, computeMetrics, simulateSequential, OneMinuteFeed };

if (process.argv[1]?.endsWith("run_xauusd_backtest.mjs")) {
  main().catch(console.error);
}
