import fs from "fs";
import path from "path";
import { computeSymbolBias } from "../lib/bias/engine.js";
import { evaluateSymbol } from "../lib/autonomous/scanner.js";
import { simulateTradeExecution, computeMetrics, OneMinuteFeed } from "./run_nas100_backtest.mjs";

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

function isAllowedTradingWindow(epochSec) {
  const d = new Date(epochSec * 1000);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const totalMin = hour * 60 + minute;
  const isLondon = totalMin >= 420 && totalMin <= 600;
  const isNY = totalMin >= 810 && totalMin <= 1110;
  return isLondon || isNY;
}

async function runComparisonBenchmark() {
  const dataDir = path.resolve("quant_service/data");
  console.log("===============================================================================");
  console.log(" FORENSIC BACKTEST COMPARISON: PREVIOUS VS UPGRADED BIAS ENGINE");
  console.log(" Symbol: NAS100 | Benchmark Span: Bars 500 .. 2500 (Early 2021 High-Volatility)");
  console.log("===============================================================================");

  const nasBars = JSON.parse(fs.readFileSync(path.join(dataDir, "nas100_15m.json"), "utf-8"));
  const djBars = JSON.parse(fs.readFileSync(path.join(dataDir, "dj30_15m.json"), "utf-8"));
  const spxBars = JSON.parse(fs.readFileSync(path.join(dataDir, "spx500_15m.json"), "utf-8"));

  const oldCandidatesAll = JSON.parse(fs.readFileSync(path.join(dataDir, "nas100_staged_candidates.json"), "utf-8"));
  const feed1M = new OneMinuteFeed(path.join(dataDir, "nas100_1m.bin"));

  const START_BAR = 500;
  const END_BAR = 2500; // 2,000 M15 bars (~500 active trading hours)

  // Filter previous baseline candidates within this bar window
  const oldCandidatesInSpan = oldCandidatesAll.filter(c => c.barIdx >= START_BAR && c.barIdx <= END_BAR);
  console.log(`Baseline (Previous Engine) Staged in Window: ${oldCandidatesInSpan.length} candidates`);

  // Pre-resample higher timeframes
  console.log("Pre-resampling series for new engine scan...");
  const fullH1_nas = resampleSeries(nasBars, 3600);
  const fullH4_nas = resampleSeries(nasBars, 14400);
  const fullD1_nas = resampleSeries(nasBars, 86400);

  const fullM15_dj = djBars.map(b => ({ ...b, time: b.t }));
  const fullH1_dj = resampleSeries(djBars, 3600);
  const fullH4_dj = resampleSeries(djBars, 14400);

  const fullM15_spx = spxBars.map(b => ({ ...b, time: b.t }));
  const fullH1_spx = resampleSeries(spxBars, 3600);
  const fullH4_spx = resampleSeries(spxBars, 14400);

  const cfg = {
    minConviction: 50,
    confluenceThreshold: 55,
    enabledHorizons: { day: true, scalp: false, swing: true },
    models: {
      ict_2022: true,
      turtle_soup: true,
      breaker_block: true,
      ote_continuation: true,
      silver_bullet: true,
      displacement_breakout: true,
    },
  };

  const newCandidates = [];
  const vetoBreakdown = {
    RANGE_EXHAUSTION: 0,
    WAIT_FOR_15M_PULLBACK: 0,
    WAIT_FOR_15M_TRIGGER: 0,
    LOW_CONFLUENCE_OR_FITNESS: 0,
    SHALLOW_TRAP: 0,
  };

  console.log(`\nEvaluating Upgraded Bias Engine & Brain across bars ${START_BAR}..${END_BAR}...`);
  const t0 = performance.now();
  let evaluatedSteps = 0;

  for (let i = START_BAR; i <= END_BAR; i++) {
    const curBar = nasBars[i];
    const targetT = curBar.t;
    const barCloseT = targetT + 900;

    if (!isAllowedTradingWindow(targetT)) continue;

    const m15Slice = nasBars.slice(Math.max(0, i - 360), i + 1).map(b => ({ ...b, time: b.t }));

    const idxH1 = getClosedIndex(fullH1_nas, 3600, barCloseT);
    const h1Bars = idxH1 >= 0 ? fullH1_nas.slice(Math.max(0, idxH1 - 259), idxH1 + 1) : [];

    const idxH4 = getClosedIndex(fullH4_nas, 14400, barCloseT);
    const h4Bars = idxH4 >= 0 ? fullH4_nas.slice(Math.max(0, idxH4 - 219), idxH4 + 1) : [];

    const idxD1 = getClosedIndex(fullD1_nas, 86400, barCloseT);
    const d1Bars = idxD1 >= 0 ? fullD1_nas.slice(Math.max(0, idxD1 - 99), idxD1 + 1) : [];

    const frames = { M15: m15Slice, H1: h1Bars, H4: h4Bars, D1: d1Bars };

    const idxM15_dj = getClosedIndex(fullM15_dj, 900, barCloseT);
    const djSlice = idxM15_dj >= 0 ? fullM15_dj.slice(Math.max(0, idxM15_dj - 359), idxM15_dj + 1) : [];
    const idxH1_dj = getClosedIndex(fullH1_dj, 3600, barCloseT);
    const djH1 = idxH1_dj >= 0 ? fullH1_dj.slice(Math.max(0, idxH1_dj - 259), idxH1_dj + 1) : [];
    const idxH4_dj = getClosedIndex(fullH4_dj, 14400, barCloseT);
    const djH4 = idxH4_dj >= 0 ? fullH4_dj.slice(Math.max(0, idxH4 - 219), idxH4_dj + 1) : [];

    const idxM15_spx = getClosedIndex(fullM15_spx, 900, barCloseT);
    const spxSlice = idxM15_spx >= 0 ? fullM15_spx.slice(Math.max(0, idxM15_spx - 359), idxM15_spx + 1) : [];
    const idxH1_spx = getClosedIndex(fullH1_spx, 3600, barCloseT);
    const spxH1 = idxH1_spx >= 0 ? fullH1_spx.slice(Math.max(0, idxH1_spx - 259), idxH1_spx + 1) : [];
    const idxH4_spx = getClosedIndex(fullH4_spx, 14400, barCloseT);
    const spxH4 = idxH4_spx >= 0 ? fullH4_spx.slice(Math.max(0, idxH4 - 219), idxH4_spx + 1) : [];

    const partnerDJ = { M15: djSlice, H1: djH1, H4: djH4 };
    const partnerSPX = { M15: spxSlice, H1: spxH1, H4: spxH4 };
    const partnerFrames = { DJ30: partnerDJ, SP500: partnerSPX };
    const gathered = new Map();
    gathered.set("DJ30", partnerDJ);
    gathered.set("SP500", partnerSPX);

    const extras = { now: targetT * 1000, partnerFrames };

    // Upgraded Bias & Brain Evaluation
    const bias = computeSymbolBias("NAS100", frames, extras);

    // Track active veto reasons emitted by the Brain
    if (bias.brain?.action === "STAND_ASIDE" && bias.brain?.blockReasons?.some(r => r.includes("exhaustion"))) {
      vetoBreakdown.RANGE_EXHAUSTION++;
    } else if (bias.brain?.action === "WAIT_FOR_15M_PULLBACK") {
      vetoBreakdown.WAIT_FOR_15M_PULLBACK++;
    } else if (bias.brain?.action === "WAIT_FOR_15M_TRIGGER") {
      vetoBreakdown.WAIT_FOR_15M_TRIGGER++;
    }

    const evalResult = evaluateSymbol("NAS100", frames, gathered, cfg, targetT * 1000, null, bias);
    evaluatedSteps++;

    if (evalResult.stagedLevel) {
      newCandidates.push({
        barIdx: i,
        t: targetT,
        isoTime: new Date(targetT * 1000).toISOString(),
        currentPrice: curBar.close,
        dir: evalResult.dir,
        tier: evalResult.execution?.tier || "watching",
        approved: evalResult.execution?.approved === true || (!evalResult.execution?.vetoes?.length),
        candidateLevel: {
          entry: evalResult.stagedLevel.entry,
          stopLoss: evalResult.stagedLevel.sl,
          takeProfit: evalResult.stagedLevel.tp,
          rr: evalResult.stagedLevel.rr,
          modelId: evalResult.stagedLevel.modelId || evalResult.stagedLevel.id,
          modelName: evalResult.stagedLevel.modelName || evalResult.stagedLevel.model,
          horizon: evalResult.resolution?.scenario?.id || "day",
          confluenceScore: evalResult.stagedLevel.confluenceScore,
        },
        execution: {
          vetoes: evalResult.execution?.vetoes || [],
          approved: evalResult.execution?.approved,
        },
        biasSnapshot: {
          score: bias.score,
          brainVerdict: bias.brain?.verdict,
          action: bias.brain?.action,
          conviction: bias.brain?.conviction,
        },
      });
    }

    if (evaluatedSteps % 250 === 0) {
      console.log(`  Processed ${evaluatedSteps} steps... (${newCandidates.length} new candidates staged)`);
    }
  }

  const scanSec = ((performance.now() - t0) / 1000).toFixed(2);
  console.log(`\nScan Complete in ${scanSec}s (${(evaluatedSteps / scanSec).toFixed(0)} steps/s).`);

  // -------------------------------------------------------------
  // SIMULATION & COMPARISON
  // -------------------------------------------------------------
  console.log("\n===============================================================================");
  console.log(" REPLAYING BOTH GENERATIONS AGAINST 1M TICK FEED...");
  console.log("===============================================================================");

  // 1. Previous Engine Baseline Simulation
  const oldFilled = oldCandidatesInSpan.map(c => simulateTradeExecution(c, feed1M, { allowOvernight: true })).filter(r => r.filled);
  const oldRs = oldFilled.map(t => t.defaultLegR).filter(x => Number.isFinite(x));
  const oldMetrics = computeMetrics(oldRs);

  // 2. Upgraded Engine Simulation
  const newFilled = newCandidates.map(c => simulateTradeExecution(c, feed1M, { allowOvernight: true })).filter(r => r.filled);
  const newRs = newFilled.map(t => t.defaultLegR).filter(x => Number.isFinite(x));
  const newMetrics = computeMetrics(newRs);

  // 3. Approved Subsets
  const oldAppFilled = oldCandidatesInSpan.filter(c => c.approved).map(c => simulateTradeExecution(c, feed1M, { allowOvernight: true })).filter(r => r.filled);
  const oldAppMetrics = computeMetrics(oldAppFilled.map(t => t.defaultLegR).filter(x => Number.isFinite(x)));

  const newAppFilled = newCandidates.filter(c => c.approved).map(c => simulateTradeExecution(c, feed1M, { allowOvernight: true })).filter(r => r.filled);
  const newAppMetrics = computeMetrics(newAppFilled.map(t => t.defaultLegR).filter(x => Number.isFinite(x)));

  console.log("\n===============================================================================");
  console.log("                   HEAD-TO-HEAD COMPARATIVE AUDIT MATRIX                       ");
  console.log("===============================================================================");
  console.log(`Metric                      | Previous Baseline   | Upgraded Engine     | Delta / Improvement`);
  console.log(`----------------------------|---------------------|---------------------|--------------------`);
  console.log(`Total Staged Candidates     | ${String(oldCandidatesInSpan.length).padEnd(19)} | ${String(newCandidates.length).padEnd(19)} | ${newCandidates.length - oldCandidatesInSpan.length} (${((newCandidates.length/oldCandidatesInSpan.length - 1)*100).toFixed(1)}%)`);
  console.log(`Filled Trades (All)         | ${String(oldMetrics.count).padEnd(19)} | ${String(newMetrics.count).padEnd(19)} | ${newMetrics.count - oldMetrics.count} trades`);
  console.log(`Win Rate (All Filled)       | ${(oldMetrics.winRate + "%").padEnd(19)} | ${(newMetrics.winRate + "%").padEnd(19)} | ${(parseFloat(newMetrics.winRate) - parseFloat(oldMetrics.winRate)).toFixed(1)}%`);
  console.log(`Profit Factor (All Filled)  | ${String(oldMetrics.pf).padEnd(19)} | ${String(newMetrics.pf).padEnd(19)} | ${(parseFloat(newMetrics.pf) - parseFloat(oldMetrics.pf)).toFixed(2)}`);
  console.log(`Net Return (All Filled)     | ${(oldMetrics.netR + "R").padEnd(19)} | ${(newMetrics.netR + "R").padEnd(19)} | ${(parseFloat(newMetrics.netR) - parseFloat(oldMetrics.netR)).toFixed(2)}R`);
  console.log(`Max Drawdown (All Filled)   | ${("-" + oldMetrics.maxDD + "R").padEnd(19)} | ${("-" + newMetrics.maxDD + "R").padEnd(19)} | ${(parseFloat(oldMetrics.maxDD) - parseFloat(newMetrics.maxDD)).toFixed(2)}R reduction`);
  console.log(`----------------------------|---------------------|---------------------|--------------------`);
  console.log(`Approved Trades Taken       | ${String(oldAppMetrics.count).padEnd(19)} | ${String(newAppMetrics.count).padEnd(19)} | ${newAppMetrics.count - oldAppMetrics.count} trades`);
  console.log(`Approved Win Rate           | ${(oldAppMetrics.winRate + "%").padEnd(19)} | ${(newAppMetrics.winRate + "%").padEnd(19)} | ${(parseFloat(newAppMetrics.winRate) - parseFloat(oldAppMetrics.winRate)).toFixed(1)}%`);
  console.log(`Approved Profit Factor      | ${String(oldAppMetrics.pf).padEnd(19)} | ${String(newAppMetrics.pf).padEnd(19)} | ${(parseFloat(newAppMetrics.pf) - parseFloat(oldAppMetrics.pf)).toFixed(2)}`);
  console.log(`Approved Net Return         | ${(oldAppMetrics.netR + "R").padEnd(19)} | ${(newAppMetrics.netR + "R").padEnd(19)} | ${(parseFloat(newAppMetrics.netR) - parseFloat(oldAppMetrics.netR)).toFixed(2)}R`);
  console.log(`Approved Max Drawdown       | ${("-" + oldAppMetrics.maxDD + "R").padEnd(19)} | ${("-" + newAppMetrics.maxDD + "R").padEnd(19)} | ${(parseFloat(oldAppMetrics.maxDD) - parseFloat(newAppMetrics.maxDD)).toFixed(2)}R reduction`);
  console.log(`===============================================================================\n`);

  console.log("===============================================================================");
  console.log(" INSTITUTIONAL SAFETY GATES: TRAP VETO BREAKDOWN IN UPGRADED ENGINE");
  console.log("===============================================================================");
  console.log(` • Dealing Range Exhaustion Vetoes:      ${vetoBreakdown.RANGE_EXHAUSTION} instances (prevented buying top of HTF moves)`);
  console.log(` • 15M Gatekeeper Wait for Pullback:    ${vetoBreakdown.WAIT_FOR_15M_PULLBACK} instances (prevented buying overextended 15M green candles)`);
  console.log(` • 15M Gatekeeper Wait for Shift:       ${vetoBreakdown.WAIT_FOR_15M_TRIGGER} instances (prevented catching falling knife without MSS/QML)`);
  console.log("===============================================================================\n");
}

runComparisonBenchmark().catch(console.error);
