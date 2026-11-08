import fs from "fs";
import path from "path";
import { computeSymbolBias } from "../lib/bias/engine.js";
import { evaluateSymbol } from "../lib/autonomous/scanner.js";

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

function isAllowedWindow(epochSec, windowType) {
  const d = new Date(epochSec * 1000);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const totalMin = hour * 60 + minute;

  if (windowType === "ldn_ny") {
    // EURUSD: London (06:30 UTC) to London Close / NY PM (17:30 UTC)
    return totalMin >= 390 && totalMin <= 1050;
  }
  if (windowType === "eu_cash") {
    // GER40: European Cash (06:45 UTC to 16:30 UTC)
    return totalMin >= 405 && totalMin <= 990;
  }
  if (windowType === "nas_sessions") {
    // NAS100: London Open (07:00-10:00 UTC) + US Cash (13:30-20:30 UTC)
    const isLondon = totalMin >= 420 && totalMin <= 600;
    const isNY = totalMin >= 810 && totalMin <= 1230;
    return isLondon || isNY;
  }
  if (windowType === "22h") {
    // Gold: 22h continuous excluding 21:00-23:00 UTC
    return !(totalMin >= 1260 && totalMin < 1380);
  }
  return true;
}

export async function processChunk({
  symbol,
  primaryFile,
  partnerSymbol,
  partnerFile,
  windowType,
  chunkId,
  startIdx,
  endIdx,
  dataDir,
  chunksDirName,
}) {
  const chunksDir = path.join(dataDir, chunksDirName);
  if (!fs.existsSync(chunksDir)) fs.mkdirSync(chunksDir, { recursive: true });

  const chunkFile = path.join(chunksDir, `chunk_${String(chunkId).padStart(2, "0")}.json`);
  const tmpFile = `${chunkFile}.tmp`;

  // Resume check
  if (fs.existsSync(chunkFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(chunkFile, "utf-8"));
      if (Array.isArray(existing)) {
        return { chunkId, skipped: true, candidateCount: existing.length };
      }
    } catch (_) {}
  }

  // Load primary and partner datasets
  const primaryBars = JSON.parse(fs.readFileSync(path.join(dataDir, primaryFile), "utf-8"));
  const partnerBars = JSON.parse(fs.readFileSync(path.join(dataDir, partnerFile), "utf-8"));

  for (let b of primaryBars) b.time = b.t;
  for (let b of partnerBars) b.time = b.t;

  const fullH1 = resampleSeries(primaryBars, 3600);
  const fullH4 = resampleSeries(primaryBars, 14400);
  const fullD1 = resampleSeries(primaryBars, 86400);

  const fullM15_p = partnerBars;
  const fullH1_p = resampleSeries(partnerBars, 3600);
  const fullH4_p = resampleSeries(partnerBars, 14400);

  const cfg = {
    minConviction: 60,
    confluenceThreshold: 60,
    enforceSymbolSessions: false,
    sessionFilters: { london: true, newyork: true, asia: true },
    allowedTimeSlots: {
      asian_range: true,
      off_session_lull: true,
      pre_london_prep: true,
      london_open: true,
      london_lunch: true,
      pre_ny_prep: true,
      ny_open: true,
      ny_silver_bullet: true,
      london_close: true,
      ny_pm: true,
    },
    enabledHorizons: { day: true, scalp: false, swing: false },
    enabledModels: {
      ict_2022: true,
      turtle_soup: true,
      breaker_block: true,
      ote_continuation: true,
      silver_bullet: true,
      judas_swing: true,
      smt_divergence_sweep: true,
      fvg_rejection: true,
      po3_daily_cycle: true,
      displacement_breakout: false,
    },
  };

  const stagedCandidates = [];
  const t0 = performance.now();

  let ptrH1 = 0, ptrH4 = 0, ptrD1 = 0;
  let ptrM15_p = 0, ptrH1_p = 0, ptrH4_p = 0;

  for (let i = startIdx; i <= endIdx && i < primaryBars.length; i++) {
    const curBar = primaryBars[i];
    const targetT = curBar.t;
    const barCloseT = targetT + 900;

    if (!isAllowedWindow(targetT, windowType)) continue;

    const m15Slice = primaryBars.slice(Math.max(0, i - 360), i + 1);

    while (ptrH1 + 1 < fullH1.length && fullH1[ptrH1 + 1].time + 3600 <= barCloseT) ptrH1++;
    const idxH1 = (fullH1[ptrH1]?.time + 3600 <= barCloseT) ? ptrH1 : -1;
    const h1Bars = idxH1 >= 0 ? fullH1.slice(Math.max(0, idxH1 - 259), idxH1 + 1) : [];

    while (ptrH4 + 1 < fullH4.length && fullH4[ptrH4 + 1].time + 14400 <= barCloseT) ptrH4++;
    const idxH4 = (fullH4[ptrH4]?.time + 14400 <= barCloseT) ? ptrH4 : -1;
    const h4Bars = idxH4 >= 0 ? fullH4.slice(Math.max(0, idxH4 - 219), idxH4 + 1) : [];

    while (ptrD1 + 1 < fullD1.length && fullD1[ptrD1 + 1].time + 86400 <= barCloseT) ptrD1++;
    const idxD1 = (fullD1[ptrD1]?.time + 86400 <= barCloseT) ? ptrD1 : -1;
    const d1Bars = idxD1 >= 0 ? fullD1.slice(Math.max(0, idxD1 - 99), idxD1 + 1) : [];

    const frames = { M15: m15Slice, H1: h1Bars, H4: h4Bars, D1: d1Bars };

    while (ptrM15_p + 1 < fullM15_p.length && fullM15_p[ptrM15_p + 1].time + 900 <= barCloseT) ptrM15_p++;
    const idxM15_p = (fullM15_p[ptrM15_p]?.time + 900 <= barCloseT) ? ptrM15_p : -1;
    const pSlice = idxM15_p >= 0 ? fullM15_p.slice(Math.max(0, idxM15_p - 359), idxM15_p + 1) : [];

    while (ptrH1_p + 1 < fullH1_p.length && fullH1_p[ptrH1_p + 1].time + 3600 <= barCloseT) ptrH1_p++;
    const idxH1_p = (fullH1_p[ptrH1_p]?.time + 3600 <= barCloseT) ? ptrH1_p : -1;
    const pH1 = idxH1_p >= 0 ? fullH1_p.slice(Math.max(0, idxH1_p - 259), idxH1_p + 1) : [];

    while (ptrH4_p + 1 < fullH4_p.length && fullH4_p[ptrH4_p + 1].time + 14400 <= barCloseT) ptrH4_p++;
    const idxH4_p = (fullH4_p[ptrH4_p]?.time + 14400 <= barCloseT) ? ptrH4_p : -1;
    const pH4 = idxH4_p >= 0 ? fullH4_p.slice(Math.max(0, idxH4_p - 219), idxH4_p + 1) : [];

    const partnerFramesObj = { [partnerSymbol]: { M15: pSlice, H1: pH1, H4: pH4 } };
    const gathered = new Map();
    gathered.set(partnerSymbol, partnerFramesObj[partnerSymbol]);

    const extras = { now: targetT * 1000, partnerFrames: partnerFramesObj };
    const bias = computeSymbolBias(symbol, frames, extras);
    const evalResult = evaluateSymbol(symbol, frames, gathered, cfg, targetT * 1000, null, bias);

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

  fs.writeFileSync(tmpFile, JSON.stringify(stagedCandidates, null, 2), "utf-8");
  fs.renameSync(tmpFile, chunkFile);

  const durationSec = ((performance.now() - t0) / 1000).toFixed(1);
  return { chunkId, skipped: false, candidateCount: stagedCandidates.length, durationSec };
}

if (process.argv[1]?.endsWith("worker_universal_chunk.mjs")) {
  const args = JSON.parse(process.argv[2]);
  processChunk(args)
    .then(res => {
      console.log(JSON.stringify(res));
      process.exit(0);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
