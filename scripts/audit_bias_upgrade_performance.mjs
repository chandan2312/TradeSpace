import fs from "fs";
import path from "path";
import { computeSymbolBias } from "../lib/bias/engine.js";
import { evaluateSymbol } from "../lib/autonomous/scanner.js";
import { FastFeed } from "./run_100r_portfolio_backtest.mjs";

function resampleSeries(bars, intervalSec) {
  const buckets = new Map();
  for (const b of bars) {
    const bucketTime = Math.floor(b.t / intervalSec) * intervalSec;
    let buck = buckets.get(bucketTime);
    if (!buck) {
      buck = { time: bucketTime, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0, count: 0 };
      buckets.set(bucketTime, buck);
    } else {
      if (b.high > buck.high) buck.high = b.high;
      if (b.low < buck.low) buck.low = b.low;
      buck.close = b.close;
      buck.volume += (b.volume || 0);
    }
    buck.count++;
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

function getClosedIndex(series, intervalSec, targetCloseT) {
  let low = 0;
  let high = series.length - 1;
  let ans = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const closeT = series[mid].time + intervalSec;
    if (closeT <= targetCloseT) {
      ans = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return ans;
}

function isAllowedTradingWindow(epochSec, isGold = false) {
  const d = new Date(epochSec * 1000);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const totalMin = hour * 60 + minute;
  if (isGold) {
    // Gold 22h trading: avoid rollover 21:00-23:00 UTC
    return totalMin < 1260 || totalMin >= 1380;
  }
  // Indices: London (07:00-10:00 UTC) + NY (13:30-18:30 UTC)
  const isLondon = totalMin >= 420 && totalMin <= 600;
  const isNY = totalMin >= 810 && totalMin <= 1110;
  return isLondon || isNY;
}

function simulateTrade(candidate, feed1M, spreadPoints = 1.0) {
  const level = candidate.candidateLevel;
  if (!level) return null;

  const d = candidate.dir;
  const limitPrice = level.entry;
  const slPrice = level.stopLoss;
  const tpPrice = level.takeProfit;
  const riskDist = Math.abs(limitPrice - slPrice);
  if (riskDist <= 0) return null;

  const startT = candidate.t + 900;
  let idx = feed1M.findIndex(startT);
  if (idx < 0) return null;

  let isFilled = false;
  let fillPrice = 0;
  let fillTime = 0;

  // Pending order fill check (max 3 hours)
  for (let step = 0; step < 180 && idx < feed1M.totalBars; step++, idx++) {
    const bar = feed1M.getBar(idx);
    if (!bar) break;

    // Runaway check (1.5R away before fill -> cancel)
    const moveInDir = d === 1 ? (bar.high - candidate.currentPrice) : (candidate.currentPrice - bar.low);
    if (moveInDir >= 1.5 * riskDist) return { filled: false, outcome: "runaway_cancelled" };

    // Fill check
    const canFill = d === 1 ? (bar.low < limitPrice - spreadPoints) : (bar.high > limitPrice + spreadPoints);
    if (canFill) {
      isFilled = true;
      fillPrice = limitPrice;
      fillTime = bar.t;
      break;
    }
  }

  if (!isFilled) return { filled: false, outcome: "expired" };

  // Trade management with Breakeven (+1.2R) and TP target (2.5R)
  let isBreakeven = false;
  let currentSL = slPrice;
  const beTarget = d === 1 ? fillPrice + 1.2 * riskDist : fillPrice - 1.2 * riskDist;

  for (let step = 1; step <= 2880 && idx < feed1M.totalBars; step++, idx++) {
    const bar = feed1M.getBar(idx);
    if (!bar) break;

    // SL check (pessimistic)
    const hitSL = d === 1 ? bar.low <= currentSL : bar.high >= currentSL;
    if (hitSL) {
      return {
        filled: true,
        fillTime,
        exitTime: bar.t,
        outcome: isBreakeven ? "be" : "sl",
        r: isBreakeven ? 0.1 : -1.0,
      };
    }

    // BE check
    const hitBE = d === 1 ? bar.high >= beTarget : bar.low <= beTarget;
    if (hitBE && !isBreakeven) {
      isBreakeven = true;
      currentSL = d === 1 ? fillPrice + 0.1 * riskDist : fillPrice - 0.1 * riskDist; // Lock +0.1R
    }

    // TP check
    const hitTP = d === 1 ? bar.high >= tpPrice : bar.low <= tpPrice;
    if (hitTP) {
      return {
        filled: true,
        fillTime,
        exitTime: bar.t,
        outcome: "tp",
        r: Math.min(2.5, level.rr || 2.5),
      };
    }
  }

  return { filled: true, fillTime, exitTime: idx < feed1M.totalBars ? feed1M.getBar(idx)?.t : fillTime + 180 * 60, outcome: "timeout", r: 0.0 };
}

function computeMetrics(trades) {
  const rs = trades.map(t => t.r);
  if (!rs.length) return { count: 0, wins: 0, losses: 0, winRate: "0.0%", pf: "0.00", netR: "0.00R", maxDD: "0.00R" };
  const wins = rs.filter(r => r > 0.05);
  const losses = rs.filter(r => r < -0.05);
  const grossProfit = wins.reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r, 0));
  const pf = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? "INF" : "0.00");
  const winRate = ((wins.length / (wins.length + losses.length || 1)) * 100).toFixed(1) + "%";
  const netR = rs.reduce((s, r) => s + r, 0).toFixed(2) + "R";

  let peak = 0, eq = 0, maxDD = 0;
  for (const r of rs) {
    eq += r;
    if (eq > peak) peak = eq;
    if (peak - eq > maxDD) maxDD = peak - eq;
  }

  return {
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    pf,
    netR,
    maxDD: maxDD.toFixed(2) + "R",
  };
}

async function benchmarkAsset(symbol, isGold, startBar, endBar) {
  const dataDir = path.resolve("quant_service/data");
  const symbolFile = isGold ? "xauusd_15m.json" : "nas100_15m.json";
  const binFile = isGold ? "xauusd_1m.bin" : "nas100_1m.bin";
  const partnerFile = isGold ? "xagusd_15m.json" : "spx500_15m.json";
  const partnerKey = isGold ? "XAGUSD" : "SP500";
  const spread = isGold ? 0.25 : 1.0;

  console.log(`\n===============================================================================`);
  console.log(` BENCHMARKING ASSET: ${symbol} (Bars ${startBar} .. ${endBar})`);
  console.log(`===============================================================================`);

  const bars = JSON.parse(fs.readFileSync(path.join(dataDir, symbolFile), "utf-8"));
  const pBars = JSON.parse(fs.readFileSync(path.join(dataDir, partnerFile), "utf-8"));
  const feed1M = new FastFeed(path.join(dataDir, binFile));

  // Pre-resample
  const fullH1 = resampleSeries(bars, 3600);
  const fullH4 = resampleSeries(bars, 14400);
  const fullD1 = resampleSeries(bars, 86400);

  const fullM15_p = pBars.map(b => ({ ...b, time: b.t }));
  const fullH1_p = resampleSeries(pBars, 3600);
  const fullH4_p = resampleSeries(pBars, 14400);

  const cfg = {
    minConviction: 60,
    confluenceThreshold: 40,
    minRR: 1.5,
    maxRunwayConsumedPct: 80,
    maxEntryDistanceR: 3.5,
    allowLondonForIndices: true,
    enabledHorizons: { day: true, scalp: false, swing: true },
    enabledModels: isGold
      ? { turtle_soup: true, breaker_block: true, ote_continuation: true, silver_bullet: true, displacement_breakout: false }
      : { breaker_block: true, silver_bullet: true, turtle_soup: true, ote_continuation: true, displacement_breakout: false },
  };

  const rawTradesWithoutBrain = [];
  const brainApprovedTrades = [];
  let rawActiveUntil = 0;
  let brainActiveUntil = 0;
  const vetoTally = {};
  let brainNotApprovedCount = 0;
  let vetoesExhaustion = 0;
  let vetoes15MPullback = 0;
  let vetoes15MShift = 0;

  const t0 = performance.now();
  let steps = 0;

  for (let i = startBar; i <= endBar; i++) {
    const curBar = bars[i];
    const targetT = curBar.t;
    const barCloseT = targetT + 900;

    if (!isAllowedTradingWindow(targetT, isGold)) continue;

    const m15Slice = bars.slice(Math.max(0, i - 360), i + 1).map(b => ({ ...b, time: b.t }));

    const idxH1 = getClosedIndex(fullH1, 3600, barCloseT);
    const h1Bars = idxH1 >= 0 ? fullH1.slice(Math.max(0, idxH1 - 259), idxH1 + 1) : [];

    const idxH4 = getClosedIndex(fullH4, 14400, barCloseT);
    const h4Bars = idxH4 >= 0 ? fullH4.slice(Math.max(0, idxH4 - 219), idxH4 + 1) : [];

    const idxD1 = getClosedIndex(fullD1, 86400, barCloseT);
    const d1Bars = idxD1 >= 0 ? fullD1.slice(Math.max(0, idxD1 - 99), idxD1 + 1) : [];

    const frames = { M15: m15Slice, H1: h1Bars, H4: h4Bars, D1: d1Bars };

    const idxM15_p = getClosedIndex(fullM15_p, 900, barCloseT);
    const pSlice = idxM15_p >= 0 ? fullM15_p.slice(Math.max(0, idxM15_p - 359), idxM15_p + 1) : [];
    const idxH1_p = getClosedIndex(fullH1_p, 3600, barCloseT);
    const pH1 = idxH1_p >= 0 ? fullH1_p.slice(Math.max(0, idxH1_p - 259), idxH1_p + 1) : [];
    const idxH4_p = getClosedIndex(fullH4_p, 14400, barCloseT);
    const pH4 = idxH4_p >= 0 ? fullH4_p.slice(Math.max(0, idxH4 - 219), idxH4_p + 1) : [];

    const partnerFrame = { M15: pSlice, H1: pH1, H4: pH4 };
    const partnerFrames = { [partnerKey]: partnerFrame };
    const gathered = new Map();
    gathered.set(partnerKey, partnerFrame);

    const extras = { now: targetT * 1000, partnerFrames };

    // Compute Upgraded Bias Engine
    const bias = computeSymbolBias(symbol, frames, extras);

    // Track Brain Vetoes
    if (bias.brain?.action === "STAND_ASIDE" && bias.brain?.blockReasons?.some(r => r.includes("exhaustion"))) {
      vetoesExhaustion++;
    } else if (bias.brain?.action === "WAIT_FOR_15M_PULLBACK") {
      vetoes15MPullback++;
    } else if (bias.brain?.action === "WAIT_FOR_15M_TRIGGER") {
      vetoes15MShift++;
    }

    // Evaluate Setup
    const evalResult = evaluateSymbol(symbol, frames, gathered, cfg, targetT * 1000, null, bias);
    steps++;

    if (evalResult.stagedLevel) {
      const cand = {
        t: targetT,
        currentPrice: curBar.close,
        dir: evalResult.dir,
        candidateLevel: {
          entry: evalResult.stagedLevel.entry,
          stopLoss: evalResult.stagedLevel.sl,
          takeProfit: evalResult.stagedLevel.tp,
          rr: evalResult.stagedLevel.rr,
          modelName: evalResult.stagedLevel.modelName,
        },
      };

      // 1. Raw Execution (Without Brain Gatekeeper/Exhaustion Filter)
      if (targetT >= rawActiveUntil) {
        const rawSim = simulateTrade(cand, feed1M, spread);
        if (rawSim && rawSim.filled) {
          rawTradesWithoutBrain.push(rawSim);
          rawActiveUntil = rawSim.exitTime || (targetT + 3600);
        }
      }

      // 2. Brain-Approved Execution (Strictly checks execution.permitted & Brain Gatekeeper)
      const brainApproved = (bias.executionReadiness?.allowedToLong && evalResult.dir === 1)
        || (bias.executionReadiness?.allowedToShort && evalResult.dir === -1);
      const isPermitted = evalResult.execution?.permitted === true || (!evalResult.execution?.vetoes?.length);

      if (!brainApproved) {
        brainNotApprovedCount++;
      }
      for (const v of evalResult.execution?.vetoes || []) {
        vetoTally[v.code] = (vetoTally[v.code] || 0) + 1;
      }

      if (brainApproved && isPermitted && targetT >= brainActiveUntil) {
        const brainSim = simulateTrade(cand, feed1M, spread);
        if (brainSim && brainSim.filled) {
          brainSim.t = targetT;
          brainSim.dir = evalResult.dir;
          brainSim.model = evalResult.stagedLevel?.modelName;
          brainApprovedTrades.push(brainSim);
          brainActiveUntil = brainSim.exitTime || (targetT + 3600);
        }
      }
    }
  }

  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`Evaluated ${steps} bars in ${elapsed}s.`);

  if (brainApprovedTrades.length) {
    console.log(`\nBrain Approved Trades Detail (${symbol}):`);
    for (const tr of brainApprovedTrades) {
      const dt = new Date(tr.t * 1000).toISOString().replace("T", " ").substring(0, 16);
      console.log(`  [${dt}] Dir: ${tr.dir === 1 ? "BUY " : "SELL"} | Model: ${tr.model} | Outcome: ${tr.outcome} | R: ${tr.r}`);
    }
  }

  const rawStats = computeMetrics(rawTradesWithoutBrain);
  const brainStats = computeMetrics(brainApprovedTrades);

  console.log(`\n--- RESULTS FOR ${symbol} ---`);
  console.log(`[RAW SYSTEM WITHOUT BRAIN FILTER]`);
  console.log(`  Trades: ${rawStats.count} | WR: ${rawStats.winRate} | PF: ${rawStats.pf} | Net: ${rawStats.netR} | MaxDD: ${rawStats.maxDD}`);
  console.log(`[UPGRADED ENGINE WITH MARKET BRAIN VETOES]`);
  console.log(`  Trades: ${brainStats.count} | WR: ${brainStats.winRate} | PF: ${brainStats.pf} | Net: ${brainStats.netR} | MaxDD: ${brainStats.maxDD}`);
  console.log(`[INSTITUTIONAL TRAP VETOES APPLIED]`);
  console.log(`  • Dealing Range Exhaustion Vetoes: ${vetoesExhaustion}`);
  console.log(`  • 15M Gatekeeper Wait for Pullback: ${vetoes15MPullback}`);
  console.log(`  • 15M Gatekeeper Wait for Shift: ${vetoes15MShift}`);
  console.log(`  • Brain Not Approved Trades Count: ${brainNotApprovedCount}`);
  console.log(`  • Execution Veto Tally on Staged Levels:`, JSON.stringify(vetoTally, null, 2));

  return { symbol, rawStats, brainStats, vetoesExhaustion, vetoes15MPullback, vetoes15MShift };
}

async function main() {
  const start = parseInt(process.argv[2] || "23500", 10);
  const end = parseInt(process.argv[3] || "24500", 10);

  console.log(`Starting Dual-Asset Benchmark (NAS100 + XAUUSD) across bars ${start}..${end}...`);
  const nas = await benchmarkAsset("NAS100", false, start, end);
  const gold = await benchmarkAsset("XAUUSD", true, start, end);

  console.log("\n===============================================================================");
  console.log("                  FINAL DUAL-ASSET VERIFICATION SUMMARY                        ");
  console.log("===============================================================================");
  console.log(`Asset  | System Mode                     | Trades | Win Rate | PF     | Net Return | Max DD`);
  console.log(`-------|---------------------------------|--------|----------|--------|------------|--------`);
  console.log(`NAS100 | Raw (No Brain Filters)          | ${String(nas.rawStats.count).padEnd(6)} | ${nas.rawStats.winRate.padEnd(8)} | ${nas.rawStats.pf.padEnd(6)} | ${nas.rawStats.netR.padEnd(10)} | ${nas.rawStats.maxDD}`);
  console.log(`NAS100 | Upgraded (With Brain Gatekeeper)| ${String(nas.brainStats.count).padEnd(6)} | ${nas.brainStats.winRate.padEnd(8)} | ${nas.brainStats.pf.padEnd(6)} | ${nas.brainStats.netR.padEnd(10)} | ${nas.brainStats.maxDD}`);
  console.log(`-------|---------------------------------|--------|----------|--------|------------|--------`);
  console.log(`XAUUSD | Raw (No Brain Filters)          | ${String(gold.rawStats.count).padEnd(6)} | ${gold.rawStats.winRate.padEnd(8)} | ${gold.rawStats.pf.padEnd(6)} | ${gold.rawStats.netR.padEnd(10)} | ${gold.rawStats.maxDD}`);
  console.log(`XAUUSD | Upgraded (With Brain Gatekeeper)| ${String(gold.brainStats.count).padEnd(6)} | ${gold.brainStats.winRate.padEnd(8)} | ${gold.brainStats.pf.padEnd(6)} | ${gold.brainStats.netR.padEnd(10)} | ${gold.brainStats.maxDD}`);
  console.log(`===============================================================================\n`);
}

main().catch(console.error);
