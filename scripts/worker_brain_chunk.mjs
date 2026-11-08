import fs from "fs";
import path from "path";
import { computeSymbolBias } from "../lib/bias/engine.js";
import { evaluateSymbol } from "../lib/autonomous/scanner.js";

// Helper to resample series
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

export async function processChunk(chunkId, startIdx, endIdx, dataDir) {
  const chunkFile = path.join(dataDir, "chunks", `chunk_${String(chunkId).padStart(2, "0")}.json`);
  const tmpFile = `${chunkFile}.tmp`;

  // Check if already completed (Resume capability)
  if (fs.existsSync(chunkFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(chunkFile, "utf-8"));
      if (Array.isArray(existing)) {
        return { chunkId, skipped: true, candidateCount: existing.length };
      }
    } catch (_) {}
  }

  // Load data
  const nasBars = JSON.parse(fs.readFileSync(path.join(dataDir, "nas100_15m.json"), "utf-8"));
  const djBars = JSON.parse(fs.readFileSync(path.join(dataDir, "dj30_15m.json"), "utf-8"));
  const spxBars = JSON.parse(fs.readFileSync(path.join(dataDir, "spx500_15m.json"), "utf-8"));

  // Pre-normalize time property once to avoid millions of allocations during iteration
  for (let b of nasBars) b.time = b.t;
  for (let b of djBars) b.time = b.t;
  for (let b of spxBars) b.time = b.t;

  const fullH1_nas = resampleSeries(nasBars, 3600);
  const fullH4_nas = resampleSeries(nasBars, 14400);
  const fullD1_nas = resampleSeries(nasBars, 86400);

  const fullM15_dj = djBars;
  const fullH1_dj = resampleSeries(djBars, 3600);
  const fullH4_dj = resampleSeries(djBars, 14400);

  const fullM15_spx = spxBars;
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
  const t0 = performance.now();

  let ptrH1 = 0, ptrH4 = 0, ptrD1 = 0;
  let ptrM15_dj = 0, ptrH1_dj = 0, ptrH4_dj = 0;
  let ptrM15_spx = 0, ptrH1_spx = 0, ptrH4_spx = 0;

  for (let i = startIdx; i <= endIdx && i < nasBars.length; i++) {
    const curBar = nasBars[i];
    const targetT = curBar.t;
    const barCloseT = targetT + 900;

    if (!isAllowedTradingWindow(targetT)) continue;

    const m15Slice = nasBars.slice(Math.max(0, i - 360), i + 1);

    while (ptrH1 + 1 < fullH1_nas.length && fullH1_nas[ptrH1 + 1].time + 3600 <= barCloseT) ptrH1++;
    const idxH1 = (fullH1_nas[ptrH1]?.time + 3600 <= barCloseT) ? ptrH1 : -1;
    const h1Bars = idxH1 >= 0 ? fullH1_nas.slice(Math.max(0, idxH1 - 259), idxH1 + 1) : [];

    while (ptrH4 + 1 < fullH4_nas.length && fullH4_nas[ptrH4 + 1].time + 14400 <= barCloseT) ptrH4++;
    const idxH4 = (fullH4_nas[ptrH4]?.time + 14400 <= barCloseT) ? ptrH4 : -1;
    const h4Bars = idxH4 >= 0 ? fullH4_nas.slice(Math.max(0, idxH4 - 219), idxH4 + 1) : [];

    while (ptrD1 + 1 < fullD1_nas.length && fullD1_nas[ptrD1 + 1].time + 86400 <= barCloseT) ptrD1++;
    const idxD1 = (fullD1_nas[ptrD1]?.time + 86400 <= barCloseT) ? ptrD1 : -1;
    const d1Bars = idxD1 >= 0 ? fullD1_nas.slice(Math.max(0, idxD1 - 99), idxD1 + 1) : [];

    const frames = { M15: m15Slice, H1: h1Bars, H4: h4Bars, D1: d1Bars };

    while (ptrM15_dj + 1 < fullM15_dj.length && fullM15_dj[ptrM15_dj + 1].time + 900 <= barCloseT) ptrM15_dj++;
    const idxM15_dj = (fullM15_dj[ptrM15_dj]?.time + 900 <= barCloseT) ? ptrM15_dj : -1;
    const djSlice = idxM15_dj >= 0 ? fullM15_dj.slice(Math.max(0, idxM15_dj - 359), idxM15_dj + 1) : [];

    while (ptrH1_dj + 1 < fullH1_dj.length && fullH1_dj[ptrH1_dj + 1].time + 3600 <= barCloseT) ptrH1_dj++;
    const idxH1_dj = (fullH1_dj[ptrH1_dj]?.time + 3600 <= barCloseT) ? ptrH1_dj : -1;
    const djH1 = idxH1_dj >= 0 ? fullH1_dj.slice(Math.max(0, idxH1_dj - 259), idxH1_dj + 1) : [];

    while (ptrH4_dj + 1 < fullH4_dj.length && fullH4_dj[ptrH4_dj + 1].time + 14400 <= barCloseT) ptrH4_dj++;
    const idxH4_dj = (fullH4_dj[ptrH4_dj]?.time + 14400 <= barCloseT) ? ptrH4_dj : -1;
    const djH4 = idxH4_dj >= 0 ? fullH4_dj.slice(Math.max(0, idxH4_dj - 219), idxH4_dj + 1) : [];

    while (ptrM15_spx + 1 < fullM15_spx.length && fullM15_spx[ptrM15_spx + 1].time + 900 <= barCloseT) ptrM15_spx++;
    const idxM15_spx = (fullM15_spx[ptrM15_spx]?.time + 900 <= barCloseT) ? ptrM15_spx : -1;
    const spxSlice = idxM15_spx >= 0 ? fullM15_spx.slice(Math.max(0, idxM15_spx - 359), idxM15_spx + 1) : [];

    while (ptrH1_spx + 1 < fullH1_spx.length && fullH1_spx[ptrH1_spx + 1].time + 3600 <= barCloseT) ptrH1_spx++;
    const idxH1_spx = (fullH1_spx[ptrH1_spx]?.time + 3600 <= barCloseT) ? ptrH1_spx : -1;
    const spxH1 = idxH1_spx >= 0 ? fullH1_spx.slice(Math.max(0, idxH1_spx - 259), idxH1_spx + 1) : [];

    while (ptrH4_spx + 1 < fullH4_spx.length && fullH4_spx[ptrH4_spx + 1].time + 14400 <= barCloseT) ptrH4_spx++;
    const idxH4_spx = (fullH4_spx[ptrH4_spx]?.time + 14400 <= barCloseT) ? ptrH4_spx : -1;
    const spxH4 = idxH4_spx >= 0 ? fullH4_spx.slice(Math.max(0, idxH4_spx - 219), idxH4_spx + 1) : [];

    const partnerDJ = { M15: djSlice, H1: djH1, H4: djH4 };
    const partnerSPX = { M15: spxSlice, H1: spxH1, H4: spxH4 };

    const partnerFrames = { DJ30: partnerDJ, SP500: partnerSPX };
    const gathered = new Map();
    gathered.set("DJ30", partnerDJ);
    gathered.set("SP500", partnerSPX);

    const extras = { now: targetT * 1000, partnerFrames };

    const bias = computeSymbolBias("NAS100", frames, extras);
    const evalResult = evaluateSymbol("NAS100", frames, gathered, cfg, targetT * 1000, null, bias);

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
  }

  // Atomic checkpoint write
  fs.writeFileSync(tmpFile, JSON.stringify(stagedCandidates, null, 2), "utf-8");
  fs.renameSync(tmpFile, chunkFile);

  const durationSec = ((performance.now() - t0) / 1000).toFixed(1);
  return { chunkId, skipped: false, candidateCount: stagedCandidates.length, durationSec };
}

// CLI entrypoint when run as a standalone worker process
if (process.argv[1]?.endsWith("worker_brain_chunk.mjs")) {
  const chunkId = parseInt(process.argv[2], 10);
  const startIdx = parseInt(process.argv[3], 10);
  const endIdx = parseInt(process.argv[4], 10);
  const dataDir = process.argv[5] || path.resolve("quant_service/data");

  processChunk(chunkId, startIdx, endIdx, dataDir)
    .then(res => {
      console.log(JSON.stringify(res));
      process.exit(0);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
