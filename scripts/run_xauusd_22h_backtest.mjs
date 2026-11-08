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

function getSessionName(epochSec) {
  const d = new Date(epochSec * 1000);
  const hour = d.getUTCHours();
  const min = d.getUTCMinutes();
  const totalMin = hour * 60 + min;

  // 21:00 to 23:00 UTC = Rollover Dead Zone
  if (totalMin >= 1260 && totalMin < 1380) return "Rollover Dead Zone";
  // 23:00 to 08:00 UTC = Asian Session
  if (totalMin >= 1380 || totalMin < 480) return "Asian Session";
  // 08:00 to 13:30 UTC = London Session
  if (totalMin >= 480 && totalMin < 810) return "London Session";
  // 13:30 to 21:00 UTC = New York Session
  return "New York Session";
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
  const propTargetPrice = d === 1 ? limitPrice + 2.0 * riskDist : limitPrice - 2.0 * riskDist;
  const maxRunawayDist = 1.5 * riskDist;

  // Bar close timestamp is bar open + 15 min (900s)
  const startT = candidate.t + 900;
  let idx = feed1M.findIndex(startT);
  if (idx < 0) return { outcome: "truncated", filled: false, candidate };

  const maxPendingMinutes = 180; // 3 hours pending limit window
  const maxHoldMinutes = allowOvernight ? 2880 : 1440; // 48 hours for Mode A

  let isFilled = false;
  let fillIdx = -1;
  let fillPrice = 0;
  let fillTime = 0;

  for (let step = 0; step < maxPendingMinutes && idx < feed1M.totalBars; step++, idx++) {
    const bar = feed1M.getBar(idx);
    if (!bar) break;

    // Runaway invalidation: price blew past limit in trade direction by 1.5R without filling
    const moveInDir = d === 1 ? (bar.high - candidate.currentPrice) : (candidate.currentPrice - bar.low);
    if (moveInDir >= maxRunawayDist) {
      return { outcome: "runaway_cancelled", filled: false, candidate };
    }

    // Target reached before entry: setup cancelled
    const hitTargetEarly = d === 1 ? bar.high >= fullTpPrice : bar.low <= fullTpPrice;
    if (hitTargetEarly) {
      return { outcome: "target_reached_cancelled", filled: false, candidate };
    }

    // Limit fill check with institutional bid/ask spread
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

  // Active Trade Lifecycle State
  let isBreakeven = false;
  let isMilestoneBooked = false;
  let isPropTargetHit = false;
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

    // Mode B: Intraday Flat at 21:00 UTC before rollover dead zone
    if (!allowOvernight) {
      const dt = new Date(bar.t * 1000);
      const totalMin = dt.getUTCHours() * 60 + dt.getUTCMinutes();
      if (totalMin >= 1260 && totalMin < 1380) {
        exitPrice = bar.close;
        exitTime = bar.t;
        exitReason = "intraday_rollover_flat";
        const floatingR = (exitPrice - fillPrice) * d / riskDist;
        if (isMilestoneBooked) {
          defaultLegR = 0.4 * milestoneR + 0.6 * floatingR;
        } else {
          defaultLegR = floatingR;
        }
        propLegR = isPropTargetHit ? 2.0 : Math.max(-1.0, Math.min(2.0, floatingR));
        return { outcome: "intraday_flat", filled: true, fillTime, exitTime, barsHeld, defaultLegR, propLegR, exitReason, candidate };
      }
    }

    // 1. Check Stop Loss
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
      propLegR = isPropTargetHit ? 2.0 : (isBreakeven ? 0.0 : -1.0);
      return { outcome: exitReason, filled: true, fillTime, exitTime, barsHeld, defaultLegR, propLegR, exitReason, candidate };
    }

    // 2. Trailing Breakeven at +1.5R
    const bePrice = d === 1 ? fillPrice + 1.5 * riskDist : fillPrice - 1.5 * riskDist;
    const hitBE = d === 1 ? bar.high >= bePrice : bar.low <= bePrice;
    if (hitBE && !isBreakeven) {
      isBreakeven = true;
      currentSL = fillPrice;
    }

    // 3. TradeProp Target Check at +2.0R
    const hitProp = d === 1 ? bar.high >= propTargetPrice : bar.low <= propTargetPrice;
    if (hitProp && !isPropTargetHit) {
      isPropTargetHit = true;
    }

    // 4. Milestone 50 Partial Booking at +2.5R
    const hitMilestone = d === 1 ? bar.high >= milestonePrice : bar.low <= milestonePrice;
    if (hitMilestone && !isMilestoneBooked) {
      isMilestoneBooked = true;
      isBreakeven = true;
      // Lock +1.5R profit on the runner leg
      currentSL = d === 1 ? fillPrice + 1.5 * riskDist : fillPrice - 1.5 * riskDist;
    }

    // 5. Full Structural DOL Target reached
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

  // Timeout exit
  const lastBar = feed1M.getBar(idx - 1);
  const px = lastBar ? lastBar.close : fillPrice;
  const floatingR = (px - fillPrice) * d / riskDist;
  if (isMilestoneBooked) {
    defaultLegR = 0.4 * milestoneR + 0.6 * floatingR;
  } else {
    defaultLegR = floatingR;
  }
  propLegR = isPropTargetHit ? 2.0 : Math.max(-1.0, Math.min(2.0, floatingR));

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

// Sequential Execution (Single position on Gold, holding up to 48 hours)
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
      nextAvailableTime = c.t + 900; // Next bar close
    }
  }

  return executedTrades;
}

// Institutional Multi-Trade Concurrency Simulation (TradeSpace default: maxConcurrent = 5, 30m cooldown)
function simulateConcurrent(candidatesList, feed1M, options = {}) {
  const { maxConcurrent = 5, cooldownSec = 1800, allowOvernight = true } = options;
  const activePositions = []; // [{ fillTime, exitTime, sim }]
  const executedTrades = [];
  let lastEntryTime = 0;

  for (const c of candidatesList) {
    const curTime = c.t;

    // Prune positions that have closed by curTime
    for (let i = activePositions.length - 1; i >= 0; i--) {
      if (activePositions[i].exitTime <= curTime) {
        activePositions.splice(i, 1);
      }
    }

    // Check concurrency limit
    if (activePositions.length >= maxConcurrent) continue;

    // Check entry cooldown to avoid pyramiding into the identical candle
    if (curTime - lastEntryTime < cooldownSec) continue;

    const sim = simulateTradeExecution(c, feed1M, { allowOvernight, spreadPoints: 0.25 });
    if (!sim || !sim.filled) continue;

    activePositions.push({
      fillTime: sim.fillTime,
      exitTime: sim.exitTime,
      sim,
    });
    lastEntryTime = sim.fillTime;
    executedTrades.push(sim);
  }

  return executedTrades;
}

async function main() {
  const dataDir = path.resolve("quant_service/data");
  const candidatesPath = path.join(dataDir, "xauusd_22h_staged_candidates.json");
  const bin1MPath = path.join(dataDir, "xauusd_1m.bin");

  console.log("===============================================================================");
  console.log(" PASS 2: XAUUSD 22-HOUR CONTINUOUS HIGH-PRECISION 1M EXECUTION SIMULATION");
  console.log("===============================================================================");

  if (!fs.existsSync(candidatesPath)) {
    console.error(`Error: Staged candidates file not found: ${candidatesPath}`);
    process.exit(1);
  }

  const candidates = JSON.parse(fs.readFileSync(candidatesPath, "utf-8"));
  const feed1M = new OneMinuteFeed(bin1MPath);

  // Day horizon only + approved only
  const dayApproved = candidates.filter(c => (c.approved === true || !c.execution?.vetoes?.length) && c.candidateLevel?.horizon === "day");
  dayApproved.sort((a, b) => a.t - b.t);

  console.log(`Loaded ${candidates.length} total candidates across 2021-2026.`);
  console.log(`Approved Day Trading Candidates: ${dayApproved.length}\n`);

  // SECTION 1: STRICT SINGLE ACTIVE POSITION
  console.log("===============================================================================");
  console.log(" 1. STRICT SINGLE ACTIVE POSITION (maxConcurrent = 1)");
  console.log("===============================================================================");

  const singleA = simulateSequential(dayApproved, feed1M, true);
  console.log(`MODE A (Overnight Allowed / Continuous) - Total Trades: ${singleA.length}`);
  console.log("TradeDefault:", computeMetrics(singleA.map(t => t.defaultLegR)));
  console.log("TradeProp:   ", computeMetrics(singleA.map(t => t.propLegR)));

  const singleB = simulateSequential(dayApproved, feed1M, false);
  console.log(`\nMODE B (Intraday Flat at 21:00 UTC) - Total Trades: ${singleB.length}`);
  console.log("TradeDefault:", computeMetrics(singleB.map(t => t.defaultLegR)));
  console.log("TradeProp:   ", computeMetrics(singleB.map(t => t.propLegR)));

  // SECTION 2: INSTITUTIONAL REALISTIC CONCURRENCY (maxConcurrent = 5, 30m cooldown)
  console.log("\n===============================================================================");
  console.log(" 2. INSTITUTIONAL MULTI-POSITION CONCURRENCY (maxConcurrent = 5, 30m cooldown)");
  console.log("===============================================================================");

  const multiA = simulateConcurrent(dayApproved, feed1M, { maxConcurrent: 5, cooldownSec: 1800, allowOvernight: true });
  console.log(`MODE A (Overnight Allowed / Continuous) - Total Trades: ${multiA.length}`);
  console.log("TradeDefault:", computeMetrics(multiA.map(t => t.defaultLegR)));
  console.log("TradeProp:   ", computeMetrics(multiA.map(t => t.propLegR)));

  const multiB = simulateConcurrent(dayApproved, feed1M, { maxConcurrent: 5, cooldownSec: 1800, allowOvernight: false });
  console.log(`\nMODE B (Intraday Flat at 21:00 UTC) - Total Trades: ${multiB.length}`);
  console.log("TradeDefault:", computeMetrics(multiB.map(t => t.defaultLegR)));
  console.log("TradeProp:   ", computeMetrics(multiB.map(t => t.propLegR)));

  // SECTION 3: CORE SMC TRIAD (Breaker Block + Turtle Soup + Silver Bullet)
  const coreDay = dayApproved.filter(c => {
    const m = c.candidateLevel?.modelName || "";
    return m.includes("Breaker") || m.includes("Turtle") || m.includes("Silver Bullet");
  });

  console.log("\n===============================================================================");
  console.log(" 3. CORE SMC TRIAD (BREAKER BLOCK + TURTLE SOUP + SILVER BULLET)");
  console.log("===============================================================================");

  const coreMultiA = simulateConcurrent(coreDay, feed1M, { maxConcurrent: 5, cooldownSec: 1800, allowOvernight: true });
  console.log(`MODE A (Overnight Allowed / Continuous) - Total Trades: ${coreMultiA.length}`);
  console.log("TradeDefault:", computeMetrics(coreMultiA.map(t => t.defaultLegR)));
  console.log("TradeProp:   ", computeMetrics(coreMultiA.map(t => t.propLegR)));

  const coreMultiB = simulateConcurrent(coreDay, feed1M, { maxConcurrent: 5, cooldownSec: 1800, allowOvernight: false });
  console.log(`\nMODE B (Intraday Flat at 21:00 UTC) - Total Trades: ${coreMultiB.length}`);
  console.log("TradeDefault:", computeMetrics(coreMultiB.map(t => t.defaultLegR)));
  console.log("TradeProp:   ", computeMetrics(coreMultiB.map(t => t.propLegR)));

  // SECTION 4: MODEL-BY-MODEL BREAKDOWN (Multi A)
  console.log("\n===============================================================================");
  console.log(" 4. MODEL-BY-MODEL BREAKDOWN (Mode A - TradeDefault - Concurrency: 5)");
  console.log("===============================================================================");
  const modelsA = [...new Set(multiA.map(t => t.candidate?.candidateLevel?.modelName || "Unknown"))];
  const modelStatsA = {};
  for (const m of modelsA) {
    const mTrades = multiA.filter(t => (t.candidate?.candidateLevel?.modelName || "Unknown") === m);
    const met = computeMetrics(mTrades.map(t => t.defaultLegR));
    modelStatsA[m] = met;
    console.log(`  • ${m.padEnd(35)}: ${String(met.count).padStart(4)} trades | WR: ${met.winRate.padStart(5)}% | PF: ${met.pf.padStart(5)} | Net: ${met.netR >= 0 ? "+" : ""}${met.netR.padStart(7)}R | MaxDD: -${met.maxDD}R`);
  }

  // SECTION 5: SESSION-BY-SESSION BREAKDOWN
  console.log("\n===============================================================================");
  console.log(" 5. SESSION-BY-SESSION BREAKDOWN (Mode A - TradeDefault - Concurrency: 5)");
  console.log("===============================================================================");
  const sessions = ["Asian Session", "London Session", "New York Session"];
  const sessionStats = {};
  for (const s of sessions) {
    const sTrades = multiA.filter(t => getSessionName(t.candidate.t) === s);
    const met = computeMetrics(sTrades.map(t => t.defaultLegR));
    sessionStats[s] = met;
    console.log(`  • ${s.padEnd(25)}: ${String(met.count).padStart(4)} trades | WR: ${met.winRate.padStart(5)}% | PF: ${met.pf.padStart(5)} | Net: ${met.netR >= 0 ? "+" : ""}${met.netR.padStart(7)}R | MaxDD: -${met.maxDD}R`);
  }

  // SECTION 6: YEAR-BY-YEAR BREAKDOWN
  console.log("\n===============================================================================");
  console.log(" 6. YEAR-BY-YEAR PERFORMANCE (Core SMC Triad - Mode A - Concurrency: 5)");
  console.log("===============================================================================");
  const years = ["2021", "2022", "2023", "2024", "2025", "2026"];
  const yearlyStats = {};
  for (const yr of years) {
    const yrTrades = coreMultiA.filter(t => (t.candidate?.isoTime || "").startsWith(yr));
    const met = computeMetrics(yrTrades.map(t => t.defaultLegR));
    yearlyStats[yr] = met;
    console.log(`  • ${yr}: ${String(met.count).padStart(4)} trades | WR: ${met.winRate.padStart(5)}% | PF: ${met.pf.padStart(5)} | Net: ${met.netR >= 0 ? "+" : ""}${met.netR.padStart(7)}R | MaxDD: -${met.maxDD}R`);
  }

  // Save report summary
  const outReportPath = path.join(dataDir, "xauusd_22h_backtest_summary.json");
  fs.writeFileSync(outReportPath, JSON.stringify({
    singleA: computeMetrics(singleA.map(t => t.defaultLegR)),
    singlePropA: computeMetrics(singleA.map(t => t.propLegR)),
    singleB: computeMetrics(singleB.map(t => t.defaultLegR)),
    singlePropB: computeMetrics(singleB.map(t => t.propLegR)),
    multiA: computeMetrics(multiA.map(t => t.defaultLegR)),
    multiPropA: computeMetrics(multiA.map(t => t.propLegR)),
    multiB: computeMetrics(multiB.map(t => t.defaultLegR)),
    multiPropB: computeMetrics(multiB.map(t => t.propLegR)),
    coreMultiA: computeMetrics(coreMultiA.map(t => t.defaultLegR)),
    coreMultiPropA: computeMetrics(coreMultiA.map(t => t.propLegR)),
    coreMultiB: computeMetrics(coreMultiB.map(t => t.defaultLegR)),
    coreMultiPropB: computeMetrics(coreMultiB.map(t => t.propLegR)),
    modelStatsA,
    sessionStats,
    yearlyStats,
  }, null, 2), "utf-8");
  console.log(`\nFull 22H summary saved to: ${outReportPath}`);
}

export { simulateTradeExecution, computeMetrics, simulateSequential, simulateConcurrent, OneMinuteFeed };

if (process.argv[1]?.endsWith("run_xauusd_22h_backtest.mjs")) {
  main().catch(console.error);
}
