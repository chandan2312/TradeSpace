import fs from "fs";
import path from "path";
import { computeSymbolBias } from "../lib/bias/engine.js";
import { evaluateSymbol } from "../lib/autonomous/scanner.js";

// Resample raw M15 bars into higher timeframe bars once
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

// Binary search for highest index where bar.time + intervalSec <= targetCloseT
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

// Allowed trading windows in UTC
// London initial 3h: 07:00 - 10:00 UTC (10:00 - 13:00 EET)
// NY initial 5h:     13:30 - 18:30 UTC (16:30 - 21:30 EET)
function isAllowedTradingWindow(epochSec) {
  const d = new Date(epochSec * 1000);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const totalMin = hour * 60 + minute;

  const isLondon = totalMin >= 420 && totalMin <= 600;
  const isNY = totalMin >= 810 && totalMin <= 1110;
  return isLondon || isNY;
}

async function runPass1() {
  const dataDir = path.resolve("quant_service/data");
  console.log("===============================================================================");
  console.log(" PASS 1: POINT-IN-TIME MARKET BRAIN & SCANNER PRE-COMPUTATION (2021 - 2026)");
  console.log("===============================================================================");

  console.log("Loading aligned M15 datasets...");
  const nasBars = JSON.parse(fs.readFileSync(path.join(dataDir, "nas100_15m.json"), "utf-8"));
  const djBars = JSON.parse(fs.readFileSync(path.join(dataDir, "dj30_15m.json"), "utf-8"));
  const spxBars = JSON.parse(fs.readFileSync(path.join(dataDir, "spx500_15m.json"), "utf-8"));

  console.log(`Loaded bars: NAS100=${nasBars.length}, DJ30=${djBars.length}, SPX500=${spxBars.length}`);

  console.log("Pre-resampling clean closed series (Zero Lookahead)...");
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
    minConviction: 60,
    confluenceThreshold: 60,
    allowLondonForIndices: true,
    sessionFilters: { london: true, newyork: true, asia: false },
    allowedTimeSlots: { london_open: true, ny_open: true, ny_silver_bullet: true, london_close: true, pre_ny_prep: true },
    enabledHorizons: { day: true, scalp: true, swing: true },
    models: {
      ict_2022: true,
      turtle_soup: true,
      breaker_block: true,
      ote_continuation: true,
      silver_bullet: true,
    },
  };

  const stagedCandidates = [];
  const totalBars = nasBars.length;
  const startIdx = 500;
  let evaluatedSteps = 0;
  let inSessionSteps = 0;
  const t0 = performance.now();

  console.log(`Starting High-Speed Point-in-Time scan from bar ${startIdx} to ${totalBars}...`);

  for (let i = startIdx; i < totalBars; i++) {
    const curBar = nasBars[i];
    const targetT = curBar.t;
    const barCloseT = targetT + 900; // M15 bar close time

    if (!isAllowedTradingWindow(targetT)) {
      continue;
    }
    inSessionSteps++;

    // 1. Slices strictly <= targetT (0% lookahead)
    const m15Slice = nasBars.slice(Math.max(0, i - 360), i + 1).map(b => ({ ...b, time: b.t }));

    // 2. High timeframe closed bars up to barCloseT
    const idxH1 = getClosedIndex(fullH1_nas, 3600, barCloseT);
    const h1Bars = idxH1 >= 0 ? fullH1_nas.slice(Math.max(0, idxH1 - 259), idxH1 + 1) : [];

    const idxH4 = getClosedIndex(fullH4_nas, 14400, barCloseT);
    const h4Bars = idxH4 >= 0 ? fullH4_nas.slice(Math.max(0, idxH4 - 219), idxH4 + 1) : [];

    const idxD1 = getClosedIndex(fullD1_nas, 86400, barCloseT);
    const d1Bars = idxD1 >= 0 ? fullD1_nas.slice(Math.max(0, idxD1 - 99), idxD1 + 1) : [];

    const frames = { M15: m15Slice, H1: h1Bars, H4: h4Bars, D1: d1Bars };

    // 3. Partner slices strictly <= targetT
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

    // 4. Compute Point-in-Time Market Bias
    const bias = computeSymbolBias("NAS100", frames, extras);

    // 5. Evaluate Autonomous Scanner
    const evalResult = evaluateSymbol("NAS100", frames, gathered, cfg, targetT * 1000, null, bias);
    evaluatedSteps++;

    if (evalResult.stagedLevel) {
      stagedCandidates.push({
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
          conviction: bias.brain?.horizons?.DAY?.convictionScore || bias.score,
          dol: bias.brain?.targetDOL?.price || bias.htfLiquidity?.drawOnLiquidity?.price,
        },
      });
    }

    if (evaluatedSteps % 2000 === 0) {
      const elapsedSec = (performance.now() - t0) / 1000;
      const progress = ((i / totalBars) * 100).toFixed(1);
      console.log(`[Pass 1 Progress] ${progress}% | Date: ${new Date(targetT * 1000).toISOString().split('T')[0]} | Evaluated: ${evaluatedSteps} | Staged Candidates: ${stagedCandidates.length} (${(evaluatedSteps/elapsedSec).toFixed(0)} steps/s)`);
    }
  }

  const elapsedTotal = ((performance.now() - t0) / 1000).toFixed(2);
  console.log(`\n===============================================================================`);
  console.log(`PASS 1 COMPLETE in ${elapsedTotal} seconds!`);
  console.log(`Total In-Session Steps: ${inSessionSteps}`);
  console.log(`Evaluated Steps: ${evaluatedSteps}`);
  console.log(`Total Staged Candidates Found: ${stagedCandidates.length}`);
  console.log(`===============================================================================`);

  const outPath = path.join(dataDir, "nas100_staged_candidates.json");
  fs.writeFileSync(outPath, JSON.stringify(stagedCandidates, null, 2), "utf-8");
  console.log(`Saved candidates to: ${outPath} (${(fs.statSync(outPath).size / (1024*1024)).toFixed(2)} MB)`);
}

runPass1().catch(console.error);
